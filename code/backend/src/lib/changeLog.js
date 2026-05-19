import { pool } from '../db.js';

export async function logChange(objectType, objectId, actor, action, client) {
  const runner = client || pool;
  await runner.query(
    `INSERT INTO change_log (object_type, object_id, actor_user_id, actor_user_index, action)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      objectType,
      String(objectId),
      actor ? actor.user_id : null,
      actor ? actor.user_index : null,
      action,
    ]
  );
}
