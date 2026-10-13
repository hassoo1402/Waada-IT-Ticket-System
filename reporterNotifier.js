const {
  getTicketMapping,
  saveReporterDmDetails,
} = require("./ticketMapping");

async function notifyReporter(slackUserId, ticket) {
  if (!slackUserId) return;

  const mapping = await getTicketMapping(ticket.id);

  if (!mapping) {
    throw new Error(`Ticket #${ticket.id} mapping not found`);
  }

  const updatedAt = ticket.date_mod || ticket.date_update || ticket.date;

  const formattedDate = updatedAt
    ? new Date(updatedAt).toLocaleString("en-PK", {
        timeZone: "Asia/Karachi",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Unknown";

  const message =
    `🎫 *Ticket #${ticket.id} Updated*\n` +
    `*${ticket.name}*\n\n` +
    `👤 *Assigned To:* ${mapping.assigned_to || "Unassigned"}\n` +
    `📌 *Status:* ${ticket.status?.name || "Unknown"}\n` +
    `🕒 *Updated At:* ${formattedDate}`;

  const isExistingDm = Boolean(
    mapping.reporter_dm_channel && mapping.reporter_dm_ts,
  );

  const endpoint = isExistingDm ? "chat.update" : "chat.postMessage";

  const payload = isExistingDm
    ? {
        channel: mapping.reporter_dm_channel,
        ts: mapping.reporter_dm_ts,
        text: message,
      }
    : {
        channel: slackUserId,
        text: message,
      };

  const response = await fetch(`https://slack.com/api/${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(`Slack ${endpoint} failed: ${data.error}`);
  }

  if (!isExistingDm) {
    await saveReporterDmDetails(ticket.id, data.channel, data.ts);
  }

  console.log(
    `Reporter DM ${isExistingDm ? "updated" : "created"} for Ticket #${ticket.id}`,
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
  { ticketId, followupId, ticketName, reply, repliedBy, repliedAt, status },
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

  const response = await fetch("https://slack.com/api/chat.postMessage", {
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
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(`Followup notification failed: ${data.error}`);
  }

  if (followupId) {
    try {
      const images = await getFollowupImages(followupId);

      for (const image of images) {
        await uploadImageToSlack(data.channel, data.ts, image);
      }
    } catch (error) {
      console.error(
        `Followup image notification failed for Ticket #${ticketId}:`,
        error.message,
      );
    }
  }

  console.log(`Followup notification sent for Ticket #${ticketId}`);
}

async function notifyAssignedHandler(slackUserId, ticket) {
  if (!slackUserId) {
    console.log(`Assigned handler Slack ID missing for Ticket #${ticket.id}`);
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

  const response = await fetch("https://slack.com/api/chat.postMessage", {
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
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(`Assigned handler notification failed: ${data.error}`);
  }

  console.log(`Assigned handler notified for Ticket #${ticket.id}`);
}

async function getFollowupImages(followupId) {
  const { getGlpiLegacySession } = require("./glpiAuth");
  const sessionToken = await getGlpiLegacySession();

  const headers = {
    "Session-Token": sessionToken,
    "App-Token": process.env.GLPI_LEGACY_APP_TOKEN,
  };

  const linksResponse = await fetch(
    `${process.env.GLPI_LEGACY_URL}/ITILFollowup/${followupId}/Document_Item/`,
    { headers }
  );

  if (!linksResponse.ok) {
    throw new Error(`GLPI document links failed: ${linksResponse.status}`);
  }

  const links = await linksResponse.json();

  const linkedDocuments = links.filter((item) => Number(item.documents_id) > 0);

  const images = [];

  for (const link of linkedDocuments) {
    const documentId = Number(link.documents_id);

    const metadataResponse = await fetch(
      `${process.env.GLPI_LEGACY_URL}/Document/${documentId}`,
      { headers }
    );

    if (!metadataResponse.ok) {
      throw new Error(`GLPI document metadata failed: ${metadataResponse.status}`);
    }

    const metadata = await metadataResponse.json();

    if (!["image/png", "image/jpeg"].includes(metadata.mime)) {
      continue;
    }

    const fileResponse = await fetch(
      `${process.env.GLPI_LEGACY_URL}/Document/${documentId}?alt=media`,
      {
        headers: {
          ...headers,
          Accept: "application/octet-stream",
        },
      }
    );

    if (!fileResponse.ok) {
      throw new Error(`GLPI image download failed: ${fileResponse.status}`);
    }

    images.push({
      filename: metadata.filename,
      buffer: Buffer.from(await fileResponse.arrayBuffer()),
    });
  }

  return images;
}

async function uploadImageToSlack(channelId, threadTs, image) {
  const token = process.env.SLACK_BOT_TOKEN;

  const uploadResponse = await fetch(
    "https://slack.com/api/files.getUploadURLExternal",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        filename: image.filename,
        length: image.buffer.length,
      }),
    }
  );

  const uploadData = await uploadResponse.json();

  if (!uploadResponse.ok || !uploadData.ok) {
    throw new Error(`Slack upload URL failed: ${uploadData.error}`);
  }

  const binaryResponse = await fetch(uploadData.upload_url, {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
    },
    body: image.buffer,
  });

  if (!binaryResponse.ok) {
    throw new Error(`Slack binary upload failed: ${binaryResponse.status}`);
  }

  const completeResponse = await fetch(
    "https://slack.com/api/files.completeUploadExternal",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        files: [
          {
            id: uploadData.file_id,
            title: image.filename,
          },
        ],
        channel_id: channelId,
        thread_ts: threadTs,
      }),
    }
  );

  const completeData = await completeResponse.json();

  if (!completeResponse.ok || !completeData.ok) {
    throw new Error(`Slack image sharing failed: ${completeData.error}`);
  }
}

module.exports = {
  notifyReporter,
  notifyReporterAboutFollowup,
  notifyAssignedHandler,
  uploadImageToSlack,
  getFollowupImages,
};
