const { getTicketMapping, updateTicketState } = require("./ticketMapping");
const { publishNotification } = require("./rabbiqmq");
const { updateSlackTicket } = require("./slackTicketUpdater");
const {
  notifyReporter,
  notifyReporterAboutFollowup,
} = require("./reporterNotifier");

async function processGlpiWebhook(payload, getGlpiTicket) {
  console.log("GLPI WEBHOOK PAYLOAD:", JSON.stringify(payload, null, 2));

  // ==================================================
  // 1. NEW FOLLOWUP / REPLY
  // ==================================================

  if (
    payload.event === "new" &&
    payload.item?.itemtype === "Ticket" &&
    payload.item?.items_id
  ) {
    const ticketId = Number(payload.item.items_id);

    console.log(`New followup received for Ticket #${ticketId}`);

    const mapping = await getTicketMapping(ticketId);

    if (!mapping) {
      console.log(`No Slack mapping found for Ticket #${ticketId}`);
      return;
    }

    // ---------- Reply Author ----------

    const authorId = Number(payload.item.user?.id);

    const teamMember = payload.parent_item?.team?.find(
      (member) => Number(member.id) === authorId,
    );

    const repliedBy =
      teamMember?.display_name ||
      [teamMember?.firstname, teamMember?.realname].filter(Boolean).join(" ") ||
      payload.item.user?.name ||
      "Unknown";

    // ---------- Reporter DM ----------

    await notifyReporterAboutFollowup(mapping.reporter_slack_user_id, {
      ticketId,
      followupId: Number(payload.item.id),
      ticketName: payload.parent_item?.name || mapping.issue || "Ticket",

      reply: payload.item.content,

      repliedBy,

      repliedAt: payload.item.date_creation || payload.item.date,

      status: payload.parent_item?.status?.name || mapping.status || "Unknown",
    });

    console.log(`Followup processed for Ticket #${ticketId}`);
    return;
  }

  // ==================================================
  // 2. NORMAL TICKET UPDATE
  // ==================================================

  if (payload.event !== "update" || !payload.item?.id) {
    return;
  }

  const ticketId = Number(payload.item.id);

  console.log(`GLPI webhook: Ticket #${ticketId} updated`);

  // IMPORTANT: DB state BEFORE changes
  const existingState = await getTicketMapping(ticketId);

  if (!existingState) {
    console.log(`No Slack mapping found for Ticket #${ticketId}`);
    return;
  }

  // Fresh GLPI state
  const ticket = await getGlpiTicket(ticketId);

  // ---------- Priority ----------

  const priorities = {
    1: "Very Low",
    2: "Low",
    3: "Medium",
    4: "High",
    5: "Very High",
    6: "Major",
  };

  const fiveLevels = {
    1: "Very Low",
    2: "Low",
    3: "Medium",
    4: "High",
    5: "Very High",
  };

  const urgencyName = fiveLevels[ticket.urgency] || null;
  const impactName = fiveLevels[ticket.impact] || null;

  const ticketTypes = {
    1: "Incident",
    2: "Request",
  };

  const typeName = ticketTypes[ticket.type] || null;

  const priorityName = priorities[ticket.priority] || null;

  // ---------- Assigned User ----------

  const assignedUser = ticket.team?.find(
    (member) => member.role === "assigned" && member.type === "User",
  );

  let assignedTo = null;

  if (assignedUser) {
    const fullName = [assignedUser.firstname, assignedUser.realname]
      .filter(Boolean)
      .join(" ");

    assignedTo =
      fullName || assignedUser.display_name || assignedUser.name || null;
  }

  // ---------- Department ----------

  const departmentMatch = ticket.content?.match(/^Department:\s*(.+)$/im);

  const department = departmentMatch ? departmentMatch[1].trim() : null;

  // ---------- Status ----------

  const status = ticket.status?.name || null;

  // ==================================================
  // 3. CHECK MEANINGFUL CHANGES
  // ==================================================

  const statusChanged = status !== null && existingState.status !== status;

  const priorityChanged =
    priorityName !== null && existingState.priority !== priorityName;

  const assigneeChanged =
    assignedTo !== null && existingState.assigned_to !== assignedTo;

  const urgencyChanged =
    urgencyName !== null &&
    existingState.urgency != null &&
    existingState.urgency !== urgencyName;

  const impactChanged =
    impactName !== null &&
    existingState.impact != null &&
    existingState.impact !== impactName;

  const typeChanged =
    typeName !== null &&
    existingState.ticket_type != null &&
    existingState.ticket_type !== typeName;

  const shouldNotifyReporter =
    statusChanged ||
    priorityChanged ||
    assigneeChanged ||
    urgencyChanged ||
    impactChanged ||
    typeChanged;

  console.log("Change detection:", {
    statusChanged,
    priorityChanged,
    assigneeChanged,
    shouldNotifyReporter,
  });

  // ==================================================
  // 4. UPDATE DB STATE
  // ==================================================

  await updateTicketState(ticketId, {
    issue: ticket.name || null,
    department,
    priority: priorityName,
    assignedTo,
    status,
  });

  const updatedState = await getTicketMapping(ticketId);

  // ==================================================
  // 5. SLACK CARD SYNC
  // ==================================================

  await updateSlackTicket(updatedState);

  console.log(`Slack card synced for Ticket #${ticketId}`);

  // ==================================================
  // 6. REPORTER DM
  // ==================================================

  if (shouldNotifyReporter) {
    await notifyReporter(updatedState.reporter_slack_user_id, ticket);

    console.log(`Reporter notified for Ticket #${ticketId}`);
  } else {
    console.log(
      `No meaningful change - reporter DM skipped for Ticket #${ticketId}`,
    );
  }

  // if (assigneeChanged && updatedState.reporter_slack_user_id) {
  //   const response = await fetch("https://slack.com/api/chat.postMessage", {
  //     method: "POST",
  //     headers: {
  //       Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
  //       "Content-Type": "application/json",
  //     },
  //     body: JSON.stringify({
  //       channel: updatedState.reporter_slack_user_id,
  //       text: `🎫 *Ticket #${ticketId} Reassigned*\n👤 *Assigned To:* ${assignedTo}`,
  //     }),
  //   });

  //   const data = await response.json();

  //   if (!response.ok || !data.ok) {
  //     throw new Error(`Reassignment notification failed: ${data.error || response.status}`);
  //   }

  //   console.log(`Reassignment DM sent for Ticket #${ticketId}`);
  // }

  const changes = [];

  if (urgencyChanged)
    changes.push(`🚨 Urgency: ${existingState.urgency} → ${urgencyName}`);

  if (impactChanged)
    changes.push(`🎯 Impact: ${existingState.impact} → ${impactName}`);

  if (typeChanged)
    changes.push(`📋 Type: ${existingState.ticket_type} → ${typeName}`);

  if (priorityChanged && existingState.priority != null)
    changes.push(`⚡ Priority: ${existingState.priority} → ${priorityName}`);

  if (changes.length && updatedState.reporter_slack_user_id) {
    const response = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: updatedState.reporter_slack_user_id,
        text:
          `🎫 *Ticket #${ticketId} — Details Updated*\n\n` + changes.join("\n"),
      }),
    });

    const data = await response.json();

    if (!data.ok) {
      throw new Error(`Change notification failed: ${data.error}`);
    }
  }
}

// ==================================================
// HTTP WEBHOOK HANDLER
// ==================================================

function createGlpiWebhookHandler() {
  return (req, res) => {
    let rawBody = "";

    req.setEncoding("utf8");

    req.on("data", (chunk) => {
      rawBody += chunk;
    });

    req.on("end", async () => {
      try {
        const payload = JSON.parse(rawBody);

        await publishNotification(payload);

        return res.sendStatus(200);
      } catch (error) {
        console.error("GLPI webhook processing failed:", error.message);

        return res.sendStatus(500);
      }
    });

    req.on("error", (error) => {
      console.error("GLPI webhook request error:", error.message);

      if (!res.headersSent) {
        res.sendStatus(400);
      }
    });
  };
}

// Existing exports ke saath dono functions export karo.
module.exports = {
  createGlpiWebhookHandler,
  processGlpiWebhook,
};
