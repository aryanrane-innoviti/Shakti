export const NAME_RE = /^[A-Za-z][A-Za-z '\-]{0,49}$/;
export const MOBILE_RE = /^[6-9]\d{9}$/;
export const EMPLOYEE_ID_RE = /^(IC|INN)\/\d{4}$/;
export const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export const PINCODE_RE = /^\d{6}$/;
export const LABEL_RE = /^[A-Za-z0-9 \-]{1,50}$/;

export class ValidationError extends Error {
  // `fields` may be either an array of field names OR a { field: reason } map.
  // The server returns it as-is so the client can render per-field hints.
  constructor(message, fields) {
    super(message);
    this.status = 422;
    this.fields = fields;
  }
}

export function required(obj, keys) {
  const missing = {};
  for (const k of keys) {
    const v = obj[k];
    if (v === undefined || v === null || v === '') {
      missing[k] = 'required';
    }
  }
  if (Object.keys(missing).length) {
    throw new ValidationError(`Missing required field(s): ${Object.keys(missing).join(', ')}`, missing);
  }
}

export function emailValid(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}
