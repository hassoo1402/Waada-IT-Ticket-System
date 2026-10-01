function buildTicketCard(ticket) {
  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `🎫 *Ticket #${ticket.glpi_ticket_id}*\n` +
          `*${ticket.issue}*\n` +
          `Department: ${ticket.department}\n` +
          `Priority: ${ticket.priority}\n` +
          `Assigned To: ${ticket.assigned_to}\n` +
          `Reported By: ${ticket.reporter_name}\n` +
          `Status: *${ticket.status}*`,
      },
    },
  ];

  const closedStatuses = ["Solved", "Closed"];

  if (!closedStatuses.includes(ticket.status)) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Processing (Planned)",
          },
          action_id: "planned_ticket",
          value: String(ticket.glpi_ticket_id),
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Resolve",
          },
          action_id: "resolve_ticket",
          value: String(ticket.glpi_ticket_id),
        },
      ],
    });
  }

  return blocks;
}

module.exports = {
  buildTicketCard,
};