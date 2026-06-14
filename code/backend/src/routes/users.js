import { Router } from 'express';
import { pool, one, many } from '../db.js';
import {
  requireAuth,
  requireRole,
  requireAdminRead,
  hashPassword,
  newToken,
  hoursFromNow,
} from '../lib/auth.js';

// Users are CRUD'able by both SA and ADMIN (product decision).
const requireUserWrite = requireRole('SA', 'ADMIN');
import { logChange } from '../lib/changeLog.js';
import { nextIndex } from '../lib/ids.js';
import { getInnovitiVendorId } from '../lib/seedRefs.js';
import { config } from '../config.js';
import {
  NAME_RE,
  MOBILE_RE,
  EMPLOYEE_ID_RE,
  PINCODE_RE,
  ValidationError,
  emailValid,
  required,
} from '../lib/validate.js';

const router = Router();

async function isSAUser(userId) {
  const r = await one(
    `SELECT 1 FROM users u JOIN user_types ut ON ut.user_type_id = u.user_type_id
      WHERE u.user_id = $1 AND ut.code = 'SA'`,
    [userId]
  );
  return !!r;
}

// Returns true and sends a 403 if the caller is not SA. Caller should `return` immediately.
function blockNonSAFromSA(req, res) {
  if (req.session.user_type_code !== 'SA') {
    res.status(403).json({ error: 'Only the Super Admin can modify the SA account.' });
    return true;
  }
  return false;
}

function stripPassword(row) {
  if (!row) return null;
  const { password_hash, ...rest } = row;
  return rest;
}

// Phase-3 in-flight-audit guard (relocated here from the old Locations
// assign-users endpoint — task1.md §3, task3-aso.md §5.1). An ASO/STU who has a
// non-terminal audit session cannot have their location_id changed. Returns a
// ready-to-send 409 envelope when blocked, else null. (Only ASO sessions live
// in audit_sessions today; the STU store-audit table is a future slice.)
async function inFlightAuditBlock(userId, typeCode) {
  if (typeCode !== 'ASO' && typeCode !== 'STU') return null;
  const busy = await one(
    `SELECT s.audit_index, u.user_index
       FROM audit_sessions s JOIN users u ON u.user_id = s.auditor_user_id
      WHERE s.auditor_user_id = $1
        AND s.status IN ('Incomplete','PendingReview') AND s.deleted_at IS NULL
      LIMIT 1`,
    [userId]
  );
  if (!busy) return null;
  return {
    error: `Cannot change the user's location while they have an active or pending audit (${busy.audit_index}).`,
    code: 'audit_location_in_use',
    fields: { user_id: userId, user_index: busy.user_index, audit_index: busy.audit_index },
  };
}

router.get('/dashboard/summary', requireAuth, requireAdminRead, async (req, res, next) => {
  try {
    const r = await one(`SELECT COUNT(*)::int AS c FROM users WHERE deleted_at IS NULL`);
    res.json({ total: r.c });
  } catch (e) { next(e); }
});

router.get('/', requireAuth, requireAdminRead, async (req, res, next) => {
  try {
    const { status, user_type_id, vendor_id, include_deleted } = req.query;
    const where = [];
    const params = [];
    if (!include_deleted) where.push('u.deleted_at IS NULL');
    if (status) { params.push(status); where.push(`u.status = $${params.length}`); }
    if (user_type_id) { params.push(Number(user_type_id)); where.push(`u.user_type_id = $${params.length}`); }
    if (vendor_id) { params.push(Number(vendor_id)); where.push(`u.vendor_id = $${params.length}`); }
    const sql = `
      SELECT u.user_id, u.user_index, u.first_name, u.last_name, u.email, u.mobile, u.status,
             u.vendor_id, u.employee_id, u.address_line_1, u.address_line_2,
             u.pincode, u.city, u.state, u.user_type_id, u.location_id,
             ut.code AS user_type_code, ut.label AS user_type_label,
             v.company_name AS vendor_name, v.status AS vendor_status,
             l.location_name AS location_name, l.location_index AS location_index
        FROM users u
        JOIN user_types ut ON ut.user_type_id = u.user_type_id
        LEFT JOIN vendors v ON v.vendor_id = u.vendor_id
        LEFT JOIN locations l ON l.location_id = u.location_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY u.user_id`;
    res.json(await many(sql, params));
  } catch (e) { next(e); }
});

router.get('/:id', requireAuth, requireAdminRead, async (req, res, next) => {
  try {
    const row = await one(
      `SELECT u.*, ut.code AS user_type_code, ut.label AS user_type_label,
              v.company_name AS vendor_name, v.status AS vendor_status,
              l.location_name AS location_name, l.location_index AS location_index
         FROM users u
         JOIN user_types ut ON ut.user_type_id = u.user_type_id
         LEFT JOIN vendors v ON v.vendor_id = u.vendor_id
         LEFT JOIN locations l ON l.location_id = u.location_id
        WHERE u.user_id = $1`,
      [Number(req.params.id)]
    );
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json(stripPassword(row));
  } catch (e) { next(e); }
});

const NAME_REASON =
  "must start with a letter (A–Z) and use only letters, space, hyphen (-), or apostrophe ('). Digits and other symbols are not allowed.";
const EMAIL_REASON = 'not a valid email address.';
const MOBILE_REASON =
  'must be exactly 10 digits starting with 6, 7, 8, or 9 — no country prefix or punctuation.';
const PINCODE_REASON = 'must be exactly 6 digits.';

function validateUserPayload(body, { isCreate, existing } = {}) {
  if (isCreate) required(body, ['first_name', 'last_name', 'user_type_id', 'email']);

  const errors = {};
  const first_name = body.first_name ?? existing?.first_name;
  const last_name  = body.last_name  ?? existing?.last_name;
  if (first_name && !NAME_RE.test(first_name)) errors.first_name = NAME_REASON;
  if (last_name  && !NAME_RE.test(last_name))  errors.last_name  = NAME_REASON;

  const email = body.email ?? existing?.email;
  if (email && !emailValid(email)) errors.email = EMAIL_REASON;

  const mobile = body.mobile ?? existing?.mobile;
  if (mobile && !MOBILE_RE.test(mobile)) errors.mobile = MOBILE_REASON;

  const pincode = body.pincode ?? existing?.pincode;
  if (pincode && !PINCODE_RE.test(pincode)) errors.pincode = PINCODE_REASON;

  if (Object.keys(errors).length) {
    const summary = Object.entries(errors)
      .map(([f, r]) => `${f}: ${r}`)
      .join(' | ');
    throw new ValidationError(summary, errors);
  }
}

router.post('/', requireAuth, requireUserWrite, async (req, res, next) => {
  try {
    validateUserPayload(req.body, { isCreate: true });
    const {
      first_name, last_name, user_type_id, password, email, mobile, vendor_id,
      employee_id, address_line_1, address_line_2, pincode, city, state,
    } = req.body;

    const ut = await one(`SELECT * FROM user_types WHERE user_type_id = $1`, [user_type_id]);
    if (!ut || ut.deleted_at)
      throw new ValidationError('User type not found', { user_type_id: 'must reference an active user type' });
    if (ut.code === 'SA')
      return res.status(409).json({ error: 'Only one Super Admin is allowed.', fields: { user_type_id: 'cannot create another SA' } });

    const innovitiId = await getInnovitiVendorId();
    let resolvedVendorId = vendor_id;
    if (!resolvedVendorId && !['RLU', 'LOU'].includes(ut.code)) resolvedVendorId = innovitiId;
    if (!resolvedVendorId)
      throw new ValidationError('Vendor required', { vendor_id: 'required for this user type' });
    const vendor = await one(`SELECT * FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`, [resolvedVendorId]);
    if (!vendor)
      throw new ValidationError('Vendor not found', { vendor_id: 'must be an existing, non-deleted vendor' });

    const isInnoviti = vendor.vendor_id === innovitiId;
    if (isInnoviti) {
      if (!employee_id)
        throw new ValidationError('Employee ID required', { employee_id: 'required when vendor is Innoviti' });
      if (!EMPLOYEE_ID_RE.test(employee_id))
        throw new ValidationError('Employee ID format invalid', {
          employee_id: 'must match IC/NNNN or INN/NNNN — exactly 4 digits after the prefix (e.g. IC/0001 or INN/9999). All uppercase.',
        });
    } else if (employee_id) {
      throw new ValidationError('Employee ID not allowed', {
        employee_id: 'must be empty when vendor is not Innoviti',
      });
    }

    const emailDup = await one(
      `SELECT 1 FROM users WHERE LOWER(email) = LOWER($1) AND deleted_at IS NULL`,
      [email]
    );
    if (emailDup)
      return res.status(409).json({ error: 'Email already in use', fields: { email: 'another user already has this email' } });

    // employee_id carries a partial unique index (idx_users_employee_id, over
    // active users). Pre-check it so a clash returns a friendly 409 instead of
    // a raw unique-violation 500.
    if (employee_id) {
      const empDup = await one(
        `SELECT 1 FROM users WHERE employee_id = $1 AND deleted_at IS NULL`,
        [employee_id]
      );
      if (empDup)
        return res.status(409).json({ error: 'Employee ID already in use', fields: { employee_id: 'another active user already has this Employee ID' } });
    }

    // Location (task1.md §3): set on the User form only when the user's type is
    // location-eligible; ignored for any other type. The chosen Location must
    // belong to the user's own vendor (no Innoviti-specific gate — an ASO/STU
    // defaults to Innoviti, so its locations are Innoviti by vendor-match). A
    // brand-new user has no audit session, so the in-flight guard is N/A here.
    let locationId = null;
    if (ut.location_eligible && req.body.location_id != null && req.body.location_id !== '') {
      const loc = await one(
        `SELECT location_id, vendor_id FROM locations WHERE location_id = $1 AND deleted_at IS NULL`,
        [Number(req.body.location_id)]
      );
      if (!loc)
        return res.status(422).json({ error: 'Location not found', code: 'location_not_found', fields: { location_id: 'must reference an existing, non-deleted location' } });
      if (loc.vendor_id !== resolvedVendorId)
        return res.status(422).json({ error: "A user can only be tied to a location belonging to their own vendor.", code: 'user_vendor_mismatch', fields: { location_id: "must belong to the user's vendor" } });
      locationId = loc.location_id;
    }

    const hash = password ? hashPassword(password) : null;
    const idx = await nextIndex('user');

    // ASO users carry no address (task1.md §3): the form hides the section and
    // the API silently drops any address payload for an ASO.
    const aso = ut.code === 'ASO';
    const { rows } = await pool.query(
      `INSERT INTO users (user_index, first_name, last_name, user_type_id, password_hash, email, mobile,
                          vendor_id, employee_id, address_line_1, address_line_2, pincode, city, state, location_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'Active') RETURNING *`,
      [
        idx, first_name, last_name, user_type_id, hash, email, mobile || null,
        resolvedVendorId, employee_id || null,
        aso ? null : (address_line_1 || null), aso ? null : (address_line_2 || null),
        aso ? null : (pincode || null), aso ? null : (city || null), aso ? null : (state || null),
        locationId,
      ]
    );
    await logChange('User', idx, req.session, 'Create');
    res.status(201).json(stripPassword(rows[0]));
  } catch (e) { next(e); }
});

router.patch('/:id', requireAuth, requireUserWrite, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM users WHERE user_id = $1`, [id]);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (await isSAUser(id)) {
      if (blockNonSAFromSA(req, res)) return;
    }
    validateUserPayload(req.body, { isCreate: false, existing });

    // Same partial-unique guard as create: reject a clashing employee_id with a
    // friendly 409 rather than letting the index throw a 500. Exclude self.
    if (req.body.employee_id) {
      const empDup = await one(
        `SELECT 1 FROM users WHERE employee_id = $1 AND deleted_at IS NULL AND user_id <> $2`,
        [req.body.employee_id, id]
      );
      if (empDup)
        return res.status(409).json({ error: 'Employee ID already in use', fields: { employee_id: 'another active user already has this Employee ID' } });
    }

    // ASO users carry no address (task1.md §3) — drop any address fields from
    // the update so they can't be set via PATCH.
    const existingType = await one(`SELECT code, location_eligible FROM user_types WHERE user_type_id = $1`, [existing.user_type_id]);
    const ADDRESS_FIELDS = ['address_line_1', 'address_line_2', 'pincode', 'city', 'state'];
    const fields = [
      'first_name', 'last_name', 'email', 'mobile', 'vendor_id', 'employee_id',
      ...(existingType?.code === 'ASO' ? [] : ADDRESS_FIELDS),
    ];
    const sets = [];
    const params = [];
    for (const f of fields) {
      if (req.body[f] !== undefined) {
        params.push(req.body[f] === '' ? null : req.body[f]);
        sets.push(`${f} = $${params.length}`);
      }
    }

    // Location (task1.md §3): settable for location-eligible types; ignored
    // otherwise. Vendor-match against the user's effective vendor, and the
    // Phase-3 in-flight-audit guard fires when the value actually changes.
    if (existingType?.location_eligible && req.body.location_id !== undefined) {
      const raw = req.body.location_id;
      const effectiveVendor = req.body.vendor_id ?? existing.vendor_id;
      if (raw === null || raw === '') {
        if (existing.location_id != null) {
          const blocked = await inFlightAuditBlock(id, existingType.code);
          if (blocked) return res.status(409).json(blocked);
          params.push(null); sets.push(`location_id = $${params.length}`);
        }
      } else {
        const newLocId = Number(raw);
        const loc = await one(
          `SELECT location_id, vendor_id FROM locations WHERE location_id = $1 AND deleted_at IS NULL`,
          [newLocId]
        );
        if (!loc)
          return res.status(422).json({ error: 'Location not found', code: 'location_not_found', fields: { location_id: 'must reference an existing, non-deleted location' } });
        if (loc.vendor_id !== effectiveVendor)
          return res.status(422).json({ error: "A user can only be tied to a location belonging to their own vendor.", code: 'user_vendor_mismatch', fields: { location_id: "must belong to the user's vendor" } });
        if (newLocId !== existing.location_id) {
          const blocked = await inFlightAuditBlock(id, existingType.code);
          if (blocked) return res.status(409).json(blocked);
        }
        params.push(newLocId); sets.push(`location_id = $${params.length}`);
      }
    }

    if (!sets.length) return res.json(stripPassword(existing));
    sets.push(`updated_at = NOW()`);
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE user_id = $${params.length} RETURNING *`,
      params
    );
    await logChange('User', existing.user_index, req.session, 'Update');
    res.json(stripPassword(rows[0]));
  } catch (e) { next(e); }
});

router.delete('/:id', requireAuth, requireUserWrite, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT user_index, deleted_at FROM users WHERE user_id = $1`, [id]);
    if (!existing || existing.deleted_at) return res.status(404).json({ error: 'not_found' });
    if (await isSAUser(id)) {
      if (blockNonSAFromSA(req, res)) return;
    }
    await pool.query(
      `UPDATE users SET status = 'Inactive', deleted_at = NOW() WHERE user_id = $1`,
      [id]
    );
    await logChange('User', existing.user_index, req.session, 'SoftDelete');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/:id/restore', requireAuth, requireUserWrite, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM users WHERE user_id = $1`, [id]);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (!existing.deleted_at) return res.status(409).json({ error: 'not_deleted' });
    if (await isSAUser(id)) {
      if (blockNonSAFromSA(req, res)) return;
    }
    await pool.query(
      `UPDATE users SET deleted_at = NULL, updated_at = NOW() WHERE user_id = $1`,
      [id]
    );
    await logChange('User', existing.user_index, req.session, 'Restore');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

router.post('/:id/status', requireAuth, requireUserWrite, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM users WHERE user_id = $1`, [id]);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (await isSAUser(id)) {
      if (blockNonSAFromSA(req, res)) return;
    }
    const newStatus = existing.status === 'Active' ? 'Inactive' : 'Active';
    await pool.query(
      `UPDATE users
          SET status = $1,
              updated_at = NOW(),
              deleted_at = CASE WHEN $1 = 'Active' THEN NULL ELSE deleted_at END
        WHERE user_id = $2`,
      [newStatus, id]
    );
    await logChange('User', existing.user_index, req.session, 'StatusToggle');
    if (newStatus === 'Active' && existing.status === 'Inactive') {
      await pool.query(
        `UPDATE password_resets SET invalidated_at = NOW()
          WHERE user_id = $1 AND consumed_at IS NULL AND invalidated_at IS NULL`,
        [id]
      );
      const token = newToken();
      await pool.query(
        `INSERT INTO password_resets (token, user_id, expires_at) VALUES ($1, $2, $3)`,
        [token, id, hoursFromNow(config.resetTtlHours)]
      );
      return res.json({
        status: newStatus,
        password_reset_token: token,
      });
    }
    res.json({ status: newStatus });
  } catch (e) { next(e); }
});

router.post('/:id/password-reset-url', requireAuth, requireUserWrite, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT user_id FROM users WHERE user_id = $1 AND deleted_at IS NULL`, [id]);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    if (await isSAUser(id)) {
      if (blockNonSAFromSA(req, res)) return;
    }
    await pool.query(
      `UPDATE password_resets SET invalidated_at = NOW()
        WHERE user_id = $1 AND consumed_at IS NULL AND invalidated_at IS NULL`,
      [id]
    );
    const token = newToken();
    await pool.query(
      `INSERT INTO password_resets (token, user_id, expires_at) VALUES ($1, $2, $3)`,
      [token, id, hoursFromNow(config.resetTtlHours)]
    );
    res.json({ token });
  } catch (e) { next(e); }
});

export default router;
