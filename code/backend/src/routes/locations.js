import { Router } from 'express';
import { pool, one, many, withTransaction } from '../db.js';
import { requireAuth, requireAdmin } from '../lib/auth.js';
import { logChange } from '../lib/changeLog.js';
import { nextIndex } from '../lib/ids.js';
import { getInnovitiVendorId } from '../lib/seedRefs.js';
import { PINCODE_RE, ValidationError, required } from '../lib/validate.js';

const router = Router();

// Admin roles are never assigned a home location.
const ADMIN_TYPES = ['SA', 'ADMIN'];

// A user's home/audit location lives on users.location_id. The "assigned users"
// of a location is the projection: the non-admin users whose location_id points
// here, regardless of which type they are (ASO/STU/ALU/RLU/FNU/LOU).
async function assignedNonAdminUsers(locationId, client) {
  const q = (client || pool).query.bind(client || pool);
  const { rows } = await q(
    `SELECT u.user_id, u.user_index, u.first_name, u.last_name, u.email,
            ut.code AS user_type_code, ut.label AS user_type_label
       FROM users u
       JOIN user_types ut ON ut.user_type_id = u.user_type_id
      WHERE u.location_id = $1 AND u.deleted_at IS NULL
        AND ut.code <> ALL($2::text[])
      ORDER BY u.user_id`,
    [locationId, ADMIN_TYPES]
  );
  return rows;
}

router.get('/', requireAuth, async (req, res, next) => {
  try {
    const { vendor_id, include_deleted } = req.query;
    const where = [];
    const params = [];
    if (!include_deleted) where.push('l.deleted_at IS NULL');
    if (vendor_id) { params.push(Number(vendor_id)); where.push(`l.vendor_id = $${params.length}`); }
    const sql = `
      SELECT l.*, v.company_name AS vendor_name,
             pc.first_name AS pc_first, pc.last_name AS pc_last, pc.deleted_at AS pc_deleted, pc.vendor_id AS pc_vendor_id,
             sc.first_name AS sc_first, sc.last_name AS sc_last, sc.deleted_at AS sc_deleted, sc.vendor_id AS sc_vendor_id
        FROM locations l
        JOIN vendors v ON v.vendor_id = l.vendor_id
        LEFT JOIN contacts pc ON pc.contact_id = l.principal_contact_id
        LEFT JOIN contacts sc ON sc.contact_id = l.secondary_contact_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY l.location_id`;
    const rows = await many(sql, params);
    res.json(
      rows.map((r) => ({
        ...r,
        principal_contact_display: r.pc_first
          ? `${r.pc_first} ${r.pc_last}${r.pc_deleted ? ' (deleted)' : ''}${
              r.pc_vendor_id && r.pc_vendor_id !== r.vendor_id ? ' (other vendor)' : ''
            }`
          : null,
        secondary_contact_display: r.sc_first
          ? `${r.sc_first} ${r.sc_last}${r.sc_deleted ? ' (deleted)' : ''}${
              r.sc_vendor_id && r.sc_vendor_id !== r.vendor_id ? ' (other vendor)' : ''
            }`
          : null,
      }))
    );
  } catch (e) { next(e); }
});

router.get('/:id', requireAuth, async (req, res, next) => {
  try {
    const row = await one(
      `SELECT l.*, v.company_name AS vendor_name
         FROM locations l JOIN vendors v ON v.vendor_id = l.vendor_id
        WHERE l.location_id = $1`,
      [Number(req.params.id)]
    );
    if (!row) return res.status(404).json({ error: 'not_found' });
    res.json({ ...row, assigned_users: await assignedNonAdminUsers(row.location_id) });
  } catch (e) { next(e); }
});

function validate(body, { existing, isCreate } = {}) {
  const ownerType = body.owner_type ?? existing?.owner_type ?? 'Contact';
  if (isCreate) {
    required(body, ['vendor_id', 'location_name']);
    // A Contact-owned location must name its principal contact; an ASO-owned
    // one has no contact at all (the ASO users carry the relationship).
    if (ownerType === 'Contact') required(body, ['principal_contact_id']);
  }
  const errors = {};
  if (!['Contact', 'ASO'].includes(ownerType)) errors.owner_type = "must be 'Contact' or 'ASO'";
  const pincode = body.pincode ?? existing?.pincode;
  if (pincode && !PINCODE_RE.test(pincode)) errors.pincode = 'must be exactly 6 digits';
  const name = body.location_name ?? existing?.location_name;
  if (name && (name.length < 1 || name.length > 100))
    errors.location_name = 'must be 1–100 characters';
  if (Object.keys(errors).length) {
    const summary = Object.entries(errors).map(([f, r]) => `${f}: ${r}`).join(' | ');
    throw new ValidationError(summary, errors);
  }
}

const FIELDS = [
  'location_name', 'address_line_1', 'address_line_2',
  'pincode', 'city', 'state',
  'principal_contact_id', 'secondary_contact_id',
];

router.post('/', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    validate(req.body, { isCreate: true });
    const ownerType = req.body.owner_type ?? 'Contact';
    const vendor = await one(`SELECT vendor_id FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`, [req.body.vendor_id]);
    if (!vendor) throw new ValidationError('vendor_id: must reference an existing, active vendor', { vendor_id: 'must reference an existing, active vendor' });

    // Contacts and ASO ownership are mutually exclusive. In ASO mode the
    // location stores no contact, must sit under the Innoviti vendor (the only
    // vendor whose locations can hold ASO users), and the actual ASO users are
    // attached afterwards via PUT /locations/:id/assigned-users.
    if (ownerType === 'ASO') {
      if (req.body.principal_contact_id || req.body.secondary_contact_id)
        throw new ValidationError('An ASO-owned location cannot have contacts.', { owner_type: 'an ASO-owned location cannot have contacts' });
      const innoviti = await getInnovitiVendorId();
      if (!innoviti || req.body.vendor_id !== innoviti)
        throw new ValidationError('An ASO-owned location must belong to the Innoviti vendor.', { owner_type: 'ASO ownership is only available for the Innoviti vendor' });
    } else {
      const pc = await one(`SELECT * FROM contacts WHERE contact_id = $1 AND deleted_at IS NULL`, [req.body.principal_contact_id]);
      if (!pc) throw new ValidationError('principal_contact_id: must reference an existing, active contact', { principal_contact_id: 'must reference an existing, active contact' });
      if (pc.vendor_id !== req.body.vendor_id)
        throw new ValidationError('principal_contact_id: contact must belong to the selected vendor', { principal_contact_id: 'must belong to the selected vendor' });
      if (req.body.secondary_contact_id) {
        if (req.body.secondary_contact_id === req.body.principal_contact_id)
          throw new ValidationError('secondary_contact_id: must differ from principal contact', { secondary_contact_id: 'must differ from principal contact' });
        const sc = await one(`SELECT * FROM contacts WHERE contact_id = $1 AND deleted_at IS NULL`, [req.body.secondary_contact_id]);
        if (!sc) throw new ValidationError('secondary_contact_id: must reference an existing, active contact', { secondary_contact_id: 'must reference an existing, active contact' });
        if (sc.vendor_id !== req.body.vendor_id)
          throw new ValidationError('secondary_contact_id: contact must belong to the selected vendor', { secondary_contact_id: 'must belong to the selected vendor' });
      }
    }
    const idx = await nextIndex('location');
    // In ASO mode force both contacts to NULL regardless of what was sent.
    const contactVal = (f) => (ownerType === 'ASO' ? null : req.body[f] ?? null);
    const cols = ['location_index', 'vendor_id', 'owner_type', ...FIELDS];
    const values = [idx, req.body.vendor_id, ownerType, ...FIELDS.map((f) =>
      f === 'principal_contact_id' || f === 'secondary_contact_id' ? contactVal(f) : req.body[f] ?? null
    )];
    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
    const { rows } = await pool.query(
      `INSERT INTO locations (${cols.join(', ')}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    await logChange('Location', idx, req.session, 'Create');
    res.status(201).json(rows[0]);
  } catch (e) { next(e); }
});

router.patch('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM locations WHERE location_id = $1`, [id]);
    if (!existing) return res.status(404).json({ error: 'not_found' });
    validate(req.body, { existing });

    const effectiveOwner = req.body.owner_type ?? existing.owner_type;
    const effectiveVendor = req.body.vendor_id ?? existing.vendor_id;

    if (req.body.vendor_id !== undefined && req.body.vendor_id !== existing.vendor_id) {
      if (req.session.user_type_code !== 'SA' && req.session.user_type_code !== 'ADMIN')
        return res.status(403).json({ error: 'only_sa_or_admin_can_change_vendor' });
      const v = await one(`SELECT 1 FROM vendors WHERE vendor_id = $1 AND deleted_at IS NULL`, [req.body.vendor_id]);
      if (!v) throw new ValidationError('invalid vendor_id', ['vendor_id']);
    }

    if (effectiveOwner === 'ASO') {
      // ASO ownership excludes contacts and is gated on the Innoviti vendor.
      if (req.body.principal_contact_id || req.body.secondary_contact_id)
        throw new ValidationError('An ASO-owned location cannot have contacts.', { owner_type: 'an ASO-owned location cannot have contacts' });
      const innoviti = await getInnovitiVendorId();
      if (!innoviti || effectiveVendor !== innoviti)
        throw new ValidationError('An ASO-owned location must belong to the Innoviti vendor.', { owner_type: 'ASO ownership is only available for the Innoviti vendor' });
    } else {
      // Note: assigned users (users.location_id) are independent of ownership,
      // so switching owner type never disturbs them.
      const principalId = req.body.principal_contact_id ?? existing.principal_contact_id;
      if (!principalId)
        throw new ValidationError('principal_contact_id: required for a Contact-owned location', { principal_contact_id: 'required' });
      if (req.body.principal_contact_id !== undefined) {
        const pc = await one(`SELECT * FROM contacts WHERE contact_id = $1`, [req.body.principal_contact_id]);
        if (!pc || pc.deleted_at)
          throw new ValidationError('principal_contact_id: must reference an existing, active contact', { principal_contact_id: 'must reference an existing, active contact' });
        if (pc.vendor_id !== effectiveVendor)
          throw new ValidationError('principal_contact_id: contact must belong to the selected vendor', { principal_contact_id: 'must belong to the selected vendor' });
      }
      if (req.body.secondary_contact_id) {
        const sc = await one(`SELECT * FROM contacts WHERE contact_id = $1`, [req.body.secondary_contact_id]);
        if (!sc || sc.deleted_at)
          throw new ValidationError('secondary_contact_id: must reference an existing, active contact', { secondary_contact_id: 'must reference an existing, active contact' });
        if (sc.vendor_id !== effectiveVendor)
          throw new ValidationError('secondary_contact_id: contact must belong to the selected vendor', { secondary_contact_id: 'must belong to the selected vendor' });
        if (sc.contact_id === principalId)
          throw new ValidationError('secondary_contact_id: must differ from principal contact', { secondary_contact_id: 'must differ from principal contact' });
      }
    }

    const sets = [];
    const params = [];
    const push = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

    if (req.body.vendor_id !== undefined) push('vendor_id', req.body.vendor_id);
    for (const f of ['location_name', 'address_line_1', 'address_line_2', 'pincode', 'city', 'state']) {
      if (req.body[f] !== undefined) push(f, req.body[f] === '' ? null : req.body[f]);
    }
    if (req.body.owner_type !== undefined) push('owner_type', effectiveOwner);
    if (effectiveOwner === 'ASO') {
      // Clear any lingering contacts whenever the location is ASO-owned.
      push('principal_contact_id', null);
      push('secondary_contact_id', null);
    } else {
      if (req.body.principal_contact_id !== undefined) push('principal_contact_id', req.body.principal_contact_id === '' ? null : req.body.principal_contact_id);
      if (req.body.secondary_contact_id !== undefined) push('secondary_contact_id', req.body.secondary_contact_id === '' ? null : req.body.secondary_contact_id);
    }

    if (!sets.length) return res.json(existing);
    sets.push(`updated_at = NOW()`);
    params.push(id);
    const { rows } = await pool.query(
      `UPDATE locations SET ${sets.join(', ')} WHERE location_id = $${params.length} RETURNING *`,
      params
    );
    await logChange('Location', existing.location_index, req.session, 'Update');
    res.json(rows[0]);
  } catch (e) { next(e); }
});

// PUT /locations/:id/assigned-users — set the FULL list of non-admin users
// whose home/audit location is this Location. SA or Admin. users.location_id is
// the single source of truth; this endpoint is its sole writer. Assignment is
// independent of the Contact/ASO ownership toggle. Constraints: each user must
// be active, non-admin, and belong to the SAME vendor as the location. The
// Phase-3 in-flight-audit guard still blocks any affected user mid-audit. All
// writes happen in one transaction. The two former per-user loops are batched.
router.put('/:id/assigned-users', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const loc = await one(`SELECT * FROM locations WHERE location_id = $1 AND deleted_at IS NULL`, [id]);
    if (!loc) return res.status(404).json({ error: 'not_found' });

    if (!Array.isArray(req.body?.user_ids)) {
      throw new ValidationError('user_ids: must be an array of user ids', { user_ids: 'must be an array' });
    }
    // De-dupe; keep only positive integers.
    const newIds = [...new Set(req.body.user_ids.map(Number))].filter((n) => Number.isInteger(n) && n > 0);

    // Validate every requested user in ONE query: must exist & be active,
    // must not be an admin, and must belong to this location's vendor.
    let requested = [];
    if (newIds.length) {
      requested = await many(
        `SELECT u.user_id, u.location_id, u.vendor_id, ut.code AS user_type_code
           FROM users u JOIN user_types ut ON ut.user_type_id = u.user_type_id
          WHERE u.user_id = ANY($1::int[]) AND u.deleted_at IS NULL`,
        [newIds]
      );
      const found = new Set(requested.map((r) => r.user_id));
      const missing = newIds.filter((x) => !found.has(x));
      if (missing.length)
        return res.status(422).json({ error: `User(s) not found: ${missing.join(', ')}.`, code: 'user_not_found', fields: { user_ids: missing } });
      const admins = requested.filter((r) => ADMIN_TYPES.includes(r.user_type_code)).map((r) => r.user_id);
      if (admins.length)
        return res.status(422).json({ error: 'Admin users cannot be assigned to a location.', code: 'cannot_assign_admin', fields: { user_ids: admins } });
      const wrongVendor = requested.filter((r) => r.vendor_id !== loc.vendor_id).map((r) => r.user_id);
      if (wrongVendor.length)
        return res.status(422).json({ error: "A user can only be assigned to a location belonging to their own vendor.", code: 'user_vendor_mismatch', fields: { user_ids: wrongVendor } });
    }

    // Compute the affected set: removals (here now, not in new list) +
    // additions/reassignments (in new list, not already pointing here).
    const current = await assignedNonAdminUsers(id);
    const newSet = new Set(newIds);
    const toClear = current.filter((r) => !newSet.has(r.user_id)).map((r) => r.user_id);
    const toSet = requested.filter((r) => r.location_id !== id).map((r) => r.user_id);
    const affected = [...new Set([...toClear, ...toSet])];

    // In-flight-audit guard — one query: if ANY affected user has a non-terminal
    // session, block the whole call (additions, removals, reassignments alike).
    if (affected.length) {
      const busy = await many(
        `SELECT s.auditor_user_id, s.audit_index, u.user_index
           FROM audit_sessions s JOIN users u ON u.user_id = s.auditor_user_id
          WHERE s.auditor_user_id = ANY($1::int[])
            AND s.status IN ('Incomplete','PendingReview') AND s.deleted_at IS NULL
          LIMIT 1`,
        [affected]
      );
      if (busy.length) {
        const b = busy[0];
        return res.status(409).json({
          error: `Cannot change the user's location while they have an active or pending audit (${b.audit_index}).`,
          code: 'audit_location_in_use',
          fields: { user_id: b.auditor_user_id, user_index: b.user_index, audit_index: b.audit_index },
        });
      }
    }

    if (affected.length) {
      await withTransaction(async (client) => {
        if (toSet.length) {
          await client.query(`UPDATE users SET location_id = $1, updated_at = NOW() WHERE user_id = ANY($2::int[])`, [id, toSet]);
        }
        if (toClear.length) {
          await client.query(`UPDATE users SET location_id = NULL, updated_at = NOW() WHERE user_id = ANY($1::int[])`, [toClear]);
        }
        // One (User, <user_index>, actor, Update) row per affected user —
        // preserves the symmetry PATCH /users/{id} would have produced. Written
        // as a single INSERT...SELECT instead of a SELECT + per-row INSERT loop.
        await client.query(
          `INSERT INTO change_log (object_type, object_id, actor_user_id, actor_user_index, action)
             SELECT 'User', u.user_index, $2, $3, 'Update'
               FROM users u
              WHERE u.user_id = ANY($1::int[])`,
          [affected, req.session?.user_id ?? null, req.session?.user_index ?? null]
        );
      });
    }

    res.json({ location_id: id, assigned_users: await assignedNonAdminUsers(id) });
  } catch (e) { next(e); }
});

router.delete('/:id', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = Number(req.params.id);
    const existing = await one(`SELECT * FROM locations WHERE location_id = $1`, [id]);
    if (!existing || existing.deleted_at) return res.status(404).json({ error: 'not_found' });
    // Cannot retire a location that still has assigned users.
    const assigned = await assignedNonAdminUsers(id);
    if (assigned.length) {
      return res.status(409).json({
        error: 'This location has assigned users. Clear the user assignment before deleting it.',
        code: 'location_has_assigned_users',
        fields: { assigned_users: assigned.map((u) => u.user_id) },
      });
    }
    await pool.query(`UPDATE locations SET deleted_at = NOW() WHERE location_id = $1`, [id]);
    await logChange('Location', existing.location_index, req.session, 'SoftDelete');
    res.json({ ok: true });
  } catch (e) { next(e); }
});

export default router;
