const pool = require("./db");

async function saveTicketMapping({
  glpiTicketId,
  slackChannelId,
  slackMessageTs,
  slackThreadTs,
  issue,
  department,
  priority,
  assignedTo,
  reporterName,
  reporterSlackUserId,
  status,
}) {
  await pool.query(
    `INSERT INTO ticket_mappings (
      glpi_ticket_id,
      slack_channel_id,
      slack_message_ts,
      slack_thread_ts,
      issue,
      department,
      priority,
      assigned_to,
      reporter_name,
      reporter_slack_user_id,
      status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)

    ON DUPLICATE KEY UPDATE
      slack_channel_id = VALUES(slack_channel_id),
      slack_message_ts = VALUES(slack_message_ts),
      slack_thread_ts = VALUES(slack_thread_ts),
      issue = VALUES(issue),
      department = VALUES(department),
      priority = VALUES(priority),
      assigned_to = VALUES(assigned_to),
      reporter_name = VALUES(reporter_name),
      reporter_slack_user_id = VALUES(reporter_slack_user_id),
      status = VALUES(status)`,
    [
      glpiTicketId,
      slackChannelId,
      slackMessageTs,
      slackThreadTs,
      issue,
      department,
      priority,
      assignedTo,
      reporterName,
      reporterSlackUserId,
      status,
    ]
  );
}

async function getTicketMapping(glpiTicketId) {
  const [rows] = await pool.query(
    `SELECT *
     FROM ticket_mappings
     WHERE glpi_ticket_id = ?`,
    [glpiTicketId]
  );

  return rows[0] || null;
}

async function updateTicketState(
  glpiTicketId,
  {
    issue,
    department,
    priority,
    assignedTo,
    status,
  }
) {
  await pool.query(
    `UPDATE ticket_mappings
     SET
       issue = COALESCE(?, issue),
       department = COALESCE(?, department),
       priority = COALESCE(?, priority),
       assigned_to = COALESCE(?, assigned_to),
       status = COALESCE(?, status)
     WHERE glpi_ticket_id = ?`,
    [
      issue ?? null,
      department ?? null,
      priority ?? null,
      assignedTo ?? null,
      status ?? null,
      glpiTicketId,
    ]
  );
}

async function getHandlerSlackUserId(glpiUserId) {
  const [rows] = await pool.query(
    `SELECT slack_user_ids
     FROM handlers
     WHERE glpi_user_id = ?
       AND active = 1
     LIMIT 1`,
    [glpiUserId]
  );

  return rows[0]?.slack_user_ids || null;
}

async function getRandomITNotificationRecipients(count = 2) {
  // IT notification pool:
  // Hassam + saare active IT Executives
  const [rows] = await pool.query(
    `SELECT glpi_user_id, handler_name, slack_user_ids
     FROM handlers
     WHERE active = 1
       AND (
         category = 'IT Executive'
         OR glpi_user_id = 10
       )
       AND slack_user_ids IS NOT NULL`
  );

  if (rows.length < count) {
    throw new Error(
      `Not enough active handlers for IT notification. Found ${rows.length}`
    );
  }

  // Shuffle without changing DB / round-robin state
  const shuffled = [...rows].sort(() => Math.random() - 0.5);

  // First 2 unique handlers
  return shuffled.slice(0, count);
}

module.exports = {
  saveTicketMapping,
  getTicketMapping,
  updateTicketState,
  getHandlerSlackUserId,
  getRandomITNotificationRecipients,
};