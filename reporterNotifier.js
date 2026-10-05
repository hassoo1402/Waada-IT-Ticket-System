async function notifyReporter(slackUserId, ticket) {
  if (!slackUserId) {
    console.log(`Reporter Slack ID missing for Ticket #${ticket.id}`);
    return;
  }

  // GLPI last update time
  const updatedAt =
    ticket.date_mod ||
    ticket.date_update ||
    ticket.date;

  let formattedDate = "Unknown";

  if (updatedAt) {
    formattedDate = new Date(updatedAt).toLocaleString("en-PK", {
      timeZone: "Asia/Karachi",
      dateStyle: "medium",
      timeStyle: "short",
    });
  }

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: slackUserId,
      text:
        `🎫 *Ticket #${ticket.id} Updated*\n` +
        `*${ticket.name}*\n\n` +
        `📌 *Status:* ${ticket.status?.name || "Unknown"}\n` +
        `🕒 *Updated At:* ${formattedDate}`,
    }),
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      `Reporter notification failed: ${data.error}`
    );
  }

  console.log(
    `Reporter notified for Ticket #${ticket.id}`
  );
}

function stripHtml(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

async function notifyReporterAboutFollowup(
  slackUserId,
  {
    ticketId,
    ticketName,
    reply,
    repliedBy,
    repliedAt,
    status,
  }
) {
  if (!slackUserId) {
    console.log(`Reporter Slack ID missing for Ticket #${ticketId}`);
    return;
  }

  const replyText = stripHtml(reply);

  const replyDate = new Date(repliedAt);

  const formattedDate = replyDate.toLocaleString("en-PK", {
    timeZone: "Asia/Karachi",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const response = await fetch(
    "https://slack.com/api/chat.postMessage",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: slackUserId,
        text:
          `🎫 *Ticket #${ticketId} Update*\n` +
          `*${ticketName}*\n\n` +
          `💬 *New Reply:*\n${replyText}\n\n` +
          `👤 *Replied By:* ${repliedBy}\n` +
          `🕒 *Replied At:* ${formattedDate}\n` +
          `📌 *Status:* ${status}`,
      }),
    }
  );

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      `Followup notification failed: ${data.error}`
    );
  }

  console.log(
    `Followup notification sent for Ticket #${ticketId}`
  );
}

async function notifyAssignedHandler(slackUserId, ticket) {
  if (!slackUserId) {
    console.log(
      `Assigned handler Slack ID missing for Ticket #${ticket.id}`
    );
    return;
  }

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `🎫 *New Ticket Assigned to You — #${ticket.id}*\n\n` +
          `*Issue:* ${ticket.issue}\n` +
          `*Department:* ${ticket.department}\n` +
          `*Priority:* ${ticket.priority}\n` +
          `*Status:* ${ticket.status}\n\n` +
          `*Reported By:* ${ticket.reportedBy}\n` +
          `*Reported At:* ${ticket.reportedAt}\n` +
          `*Channel:* ${ticket.channel}\n\n` +
          `*Description:*\n${ticket.description}`,
      },
    },
  ];

  // Permalink available ho to button show karo
  if (ticket.permalink) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "View Ticket in Channel",
          },
          url: ticket.permalink,
          action_id: "view_ticket_in_channel",
        },
      ],
    });
  }

  const response = await fetch(
    "https://slack.com/api/chat.postMessage",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: slackUserId,

        // Slack notification/fallback text
        text: `New Ticket Assigned to You — #${ticket.id}`,

        blocks,
      }),
    }
  );

  const data = await response.json();

  if (!data.ok) {
    throw new Error(
      `Assigned handler notification failed: ${data.error}`
    );
  }

  console.log(
    `Assigned handler notified for Ticket #${ticket.id}`
  );
}

module.exports = {
  notifyReporter,
  notifyReporterAboutFollowup,
  notifyAssignedHandler,
};