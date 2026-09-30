const pool = require("./db");

async function saveTicketMapping(
  glpiTicketId,
  slackChannelId,
  slackMessageTs,
  slackThreadTs
) {
  await pool.query(
    `INSERT INTO ticket_mappings
      (glpi_ticket_id, slack_channel_id, slack_message_ts, slack_thread_ts)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       slack_channel_id = VALUES(slack_channel_id),
       slack_message_ts = VALUES(slack_message_ts),
       slack_thread_ts = VALUES(slack_thread_ts)`,
    [
      glpiTicketId,
      slackChannelId,
      slackMessageTs,
      slackThreadTs
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

module.exports = {
  saveTicketMapping,
  getTicketMapping,
};