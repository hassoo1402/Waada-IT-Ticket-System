const { buildTicketCard } = require("./ticketCardBuilder");

async function updateSlackTicket(ticketState) {
  const blocks = buildTicketCard(ticketState);

  const response = await fetch(
    "https://slack.com/api/chat.update",
    {
      method: "POST",
      headers: {
        Authorization:
          `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: ticketState.slack_channel_id,
        ts: ticketState.slack_message_ts,
        text:
          `Ticket #${ticketState.glpi_ticket_id} — ` +
          `${ticketState.status}`,
        blocks,
      }),
    }
  );

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      `Slack update failed: ${data.error}`
    );
  }

  return data;
}

module.exports = {
  updateSlackTicket,
};