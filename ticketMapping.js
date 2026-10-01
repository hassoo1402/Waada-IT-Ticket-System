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

module.exports = {
  saveTicketMapping,
  getTicketMapping,
  updateTicketState,
};