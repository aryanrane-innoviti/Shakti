import { pool } from '../db.js';

const STARTS = {
  user: { prefix: 'UIN', start: 10001, pad: 5 },
  contact: { prefix: 'NIN', start: 10001, pad: 5 },
  vendor: { prefix: 'VEN', start: 10001, pad: 5 },
  sku: { prefix: 'INN', start: 10001, pad: 5 },
  parent_sku: { prefix: 'PNN', start: 10001, pad: 5 },
  location: { prefix: 'LIN', start: 10000001, pad: 8 },
};

export async function nextIndex(kind, client) {
  const spec = STARTS[kind];
  if (!spec) throw new Error(`Unknown counter: ${kind}`);
  const runner = client || pool;
  const { rows } = await runner.query(
    `INSERT INTO counters (name, value) VALUES ($1, $2)
       ON CONFLICT (name) DO UPDATE SET value = counters.value + 1
       RETURNING value`,
    [kind, spec.start]
  );
  const value = Number(rows[0].value);
  return `${spec.prefix}-${String(value).padStart(spec.pad, '0')}`;
}
