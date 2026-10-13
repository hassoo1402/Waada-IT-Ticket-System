const pool = require("./db");

async function isEventCompleted(eventId) {
  const [rows] = await pool.execute(
    "SELECT status FROM processed_events WHERE event_id = ?",
    [eventId]
  );

  return rows.length > 0 && rows[0].status === "completed";
}

async function markEventCompleted(eventId) {
  await pool.execute(
    `INSERT INTO processed_events
       (event_id, status, completed_at)
     VALUES (?, 'completed', NOW())
     ON DUPLICATE KEY UPDATE
       status = 'completed',
       completed_at = COALESCE(completed_at, NOW())`,
    [eventId]
  );
}

module.exports = {
  isEventCompleted,
  markEventCompleted,
};
