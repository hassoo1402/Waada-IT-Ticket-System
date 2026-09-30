async function updateSlackTicketFromGlpi(channel, messageTs, ticket) {
  const departmentMatch = ticket.content?.match(/^Department:\s*(.+)$/im);

  const department = departmentMatch
    ? departmentMatch[1].trim()
    : "Unknown";

  const assignedUser = ticket.team?.find(
    (member) => member.role === "assigned" && member.type === "User"
  );

  let handlerName = "Unassigned";

  if (assignedUser) {
    const fullName = [assignedUser.firstname, assignedUser.realname]
      .filter(Boolean)
      .join(" ");

    handlerName =
      fullName ||
      assignedUser.display_name ||
      assignedUser.name ||
      "Unassigned";
  }

  const priorities = {
    1: "Very Low",
    2: "Low",
    3: "Medium",
    4: "High",
    5: "Very High",
    6: "Major",
  };

  const priorityName = priorities[ticket.priority] || "Unknown";

  const statusName = ticket.status?.name || "Unknown";
  const statusId = Number(ticket.status?.id);

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `🎫 *Ticket #${ticket.id}*\n` +
          `*${ticket.name}*\n` +
          `Department: ${department}\n` +
          `Priority: ${priorityName}\n` +
          `Assigned To: ${handlerName}\n` +
          `Status: *${statusName}*`,
      },
    },
  ];

  // Active ticket ho to buttons
  if (![5, 6].includes(statusId)) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "In Progress",
          },
          action_id: "in_progress_ticket",
          value: String(ticket.id),
        },
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Resolve",
          },
          action_id: "resolve_ticket",
          value: String(ticket.id),
        },
      ],
    });
  }

  const response = await fetch("https://slack.com/api/chat.update", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      ts: messageTs,
      text: `Ticket #${ticket.id} — ${statusName}`,
      blocks,
    }),
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(`Slack update failed: ${data.error}`);
  }

  return data;
}

module.exports = {
  updateSlackTicketFromGlpi,
};