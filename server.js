require("dotenv").config();
const { selectHandler } = require("./handlerRouter");
const {
  saveTicketMapping,
  getTicketMapping,
  updateTicketState,
} = require("./ticketMapping");
const { buildTicketCard } = require("./ticketCardBuilder");
const {
  createGlpiWebhookHandler,
} = require("./glpiWebHookHandler");


const express = require("express");
const crypto = require("crypto");

const app = express();
const processedEvents = new Set();

async function getGlpiTicket(ticketId) {
  const accessToken = await getGlpiAccessToken();

  const response = await fetch(
    `${process.env.GLPI_URL}/api.php/v2.3/Assistance/Ticket/${ticketId}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `GLPI ticket fetch failed: ${response.status} ${JSON.stringify(data)}`,
    );
  }

  return data;
}


function getAssignedHandlerName(ticket) {
  const assignedUser = ticket.team?.find(
    (member) => member.role === "assigned" && member.type === "User",
  );

  if (!assignedUser) {
    return "Unassigned";
  }

  const fullName = [assignedUser.firstname, assignedUser.realname]
    .filter(Boolean)
    .join(" ");

  return fullName || assignedUser.display_name || assignedUser.name;
}

async function updateGlpiTicketStatus(ticketId, statusId) {
  const accessToken = await getGlpiAccessToken();

  const response = await fetch(
    `${process.env.GLPI_URL}/api.php/v2.3/Assistance/Ticket/${ticketId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: {
          id: statusId,
        },
      }),
    },
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      `GLPI status update failed: ${response.status} ${JSON.stringify(data)}`,
    );
  }

  console.log("GLPI STATUS UPDATED:", data);
  return data;
}

function isAuthorizedITAgent(userId) {
  const authorizedUsers = (process.env.IT_AGENTS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);

  return authorizedUsers.includes(userId);
}

async function updateSlackTicketCard(
  channel,
  messageTs,
  ticketId,
  ticket,
  status,
) {
  const statusText =
    status === "in_progress" ? "🟡 *IN PROGRESS*" : "✅ *RESOLVED*";

  // Department GLPI content se extract karo
  const departmentMatch = ticket.content?.match(/^Department:\s*(.+)$/im);
  const department = departmentMatch ? departmentMatch[1].trim() : "Unknown";

  const blocks = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text:
          `🎫 *Ticket #${ticketId}*\n` +
          `*${ticket.name}*\n` +
          `Department: ${department}\n` +
          `Priority: ${getPriorityName(ticket.priority)}\n` +
          `Status: ${statusText}`,
      },
    },
  ];

  // Resolve button sirf active ticket par
  if (status !== "resolved") {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          text: {
            type: "plain_text",
            text: "Resolve",
          },
          action_id: "resolve_ticket",
          value: String(ticketId),
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
      text: `Ticket #${ticketId} — ${status.toUpperCase()}`,
      blocks,
    }),
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(`Slack update failed: ${data.error}`);
  }

  return data;
}

function getPriorityName(priority) {
  const priorities = {
    1: "Very Low",
    2: "Low",
    3: "Medium",
    4: "High",
    5: "Very High",
    6: "Major",
  };

  return priorities[priority] || "Unknown";
}

app.use((req, res, next) => {
  console.log("\n>>> INCOMING REQUEST");
  console.log("Method:", req.method);
  console.log("URL:", req.url);
  console.log(
    "Slack Signature:",
    req.headers["x-slack-signature"] ? "PRESENT" : "MISSING",
  );
  next();
});

async function getGlpiAccessToken() {
  const body = new URLSearchParams({
    grant_type: "password",
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    username: process.env.GLPI_USERNAME,
    password: process.env.GLPI_PASSWORD,
    scope: "api",
  });

  const response = await fetch(process.env.GLPI_URL + "/api.php/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!response.ok) {
    throw new Error(
      `GLPI authentication failed: ${response.status} ${await response.text()}`,
    );
  }

  const data = await response.json();
  return data.access_token;
}

async function createGlpiTicket(ticket) {
  const accessToken = await getGlpiAccessToken();

  const priorityMap = {
    low: 2,
    medium: 3,
    high: 4,
    urgent: 5,
    critical: 5,
  };

  const priority = priorityMap[ticket.priority?.toLowerCase()] || 3;

  const payload = {
    name: ticket.issue,

    content: `Department: ${ticket.department}
Reported At: ${ticket.createdAt}
Slack User: ${ticket.slackUser}
Slack Channel: ${ticket.slackChannel}

Description:
${ticket.description}`,

    urgency: priority,
    impact: priority,
    priority: priority,
    type: 1,
  };

  const response = await fetch(
    `${process.env.GLPI_URL}/api.php/v2.3/Assistance/Ticket`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      `GLPI ticket creation failed: ${response.status} ${JSON.stringify(result)}`,
    );
  }

  return result;
}

async function assignHandlerToTicket(ticketId, handlerId) {
  const accessToken = await getGlpiAccessToken();

  const response = await fetch(
    `${process.env.GLPI_URL}/api.php/v2.3/Assistance/Ticket/${ticketId}/TeamMember`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "User",
        id: handlerId,
        role: "assigned",
      }),
    },
  );

  const text = await response.text();

    console.log("ASSIGN STATUS:", response.status);
    console.log("ASSIGN RESPONSE:", text);

    if (!response.ok) {
    throw new Error(
        `GLPI handler assignment failed: ${response.status} ${text}`
    );
    }

    return text;

}

async function getSlackUserName(userId) {
  const response = await fetch(
    `https://slack.com/api/users.info?user=${userId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
    },
  );

  const data = await response.json();

  if (!data.ok) {
    console.error("Slack users.info error:", data.error);
    return userId;
  }

  return (
    data.user.profile.display_name || data.user.real_name || data.user.name
  );
}

async function getSlackChannelName(channelId) {
  const response = await fetch(
    `https://slack.com/api/conversations.info?channel=${channelId}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
    },
  );

  const data = await response.json();

  if (!data.ok) {
    console.error("Slack conversations.info error:", data.error);
    return channelId;
  }

  return `#${data.channel.name}`;
}

// https://necklace-ordinance-exhibitions-knife.trycloudflare.com/slack/events

async function sendSlackTicketConfirmation(
  channel,
  threadTs,
  ticketId,
  ticket,
  handlerName,
) {
  const initialTicketState = {
    glpi_ticket_id: ticketId,
    issue: ticket.issue,
    department: ticket.department,
    priority: ticket.priority,
    assigned_to: handlerName,
    reporter_name: ticket.slackUser,
    status: "OPEN",
  };

  const blocks = buildTicketCard(initialTicketState);

  const response = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: channel,
      thread_ts: threadTs,
      text: `Ticket #${ticketId} — OPEN`,
      blocks: blocks,
    }),
  });

  const data = await response.json();

  if (!data.ok) {
    throw new Error(`Slack reply failed: ${data.error}`);
  }

  return data;
}

function verifySlackRequest(req, res, next) {
  const timestamp = req.headers["x-slack-request-timestamp"];
  const slackSignature = req.headers["x-slack-signature"];

  if (!timestamp || !slackSignature) {
    return res.status(401).send("Missing Slack signature");
  }

  // Reject requests older than 5 minutes
  const fiveMinutes = 60 * 5;

  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > fiveMinutes) {
    return res.status(401).send("Request too old");
  }

  const rawBody = req.body.toString("utf8");

  const baseString = `v0:${timestamp}:${rawBody}`;

  const mySignature =
    "v0=" +
    crypto
      .createHmac("sha256", process.env.SLACK_SIGNING_SECRET)
      .update(baseString)
      .digest("hex");

  const slackBuffer = Buffer.from(slackSignature);
  const myBuffer = Buffer.from(mySignature);

  if (
    slackBuffer.length !== myBuffer.length ||
    !crypto.timingSafeEqual(slackBuffer, myBuffer)
  ) {
    return res.status(401).send("Invalid Slack signature");
  }

  // Convert raw body to JSON after verification
  req.rawBody = rawBody;

  next();
}

// IMPORTANT: raw body required for Slack signature verification
app.post(
  "/slack/events",
  express.raw({ type: "application/json" }),
  verifySlackRequest,
  async (req, res) => {
    req.body = JSON.parse(req.rawBody);
    // Slack URL verification
    if (req.body.type === "url_verification") {
      console.log("Slack is verifying our endpoint...");

      return res.json({
        challenge: req.body.challenge,
      });
    }

    // Slack message event
    if (req.body.type === "event_callback") {
      const eventId = req.body.event_id;

      // Duplicate Slack event ignore karo
      if (processedEvents.has(eventId)) {
        console.log(`Duplicate event ignored: ${eventId}`);
        return res.sendStatus(200);
      }

      // Event ko processed mark karo
      processedEvents.add(eventId);

      setTimeout(
        () => {
          processedEvents.delete(eventId);
        },
        10 * 60 * 1000,
      );

      const event = req.body.event;

      if (event.type === "message" && !event.bot_id && !event.subtype) {
        const text = event.text;

        // 2. Department tag nikalo
        // Example: #TICKET #operations
        const departmentMatch = text.match(/^#([a-zA-Z0-9_-]+)(?:\s|\n)+/);

        if (!departmentMatch) {
          console.log("Department tag missing - ignored.");
          return res.sendStatus(200);
        }

        const department = departmentMatch[1].toLowerCase();

        const rawDescription = text.slice(departmentMatch[0].length).trim();

        if (!rawDescription) {
        console.log("Ticket description missing - ignored.");
        return res.sendStatus(200);
        }

        // Priority line find karo
        // Example: priority: high
        const priorityMatch = rawDescription.match(
        /^priority:\s*(low|medium|high|critical)\s*$/im
        );

        // Priority mention na ho to Medium
        const priority = priorityMatch
        ? priorityMatch[1].toLowerCase()
        : "medium";

        // Priority wali line description se remove karo
        const description = rawDescription
        .replace(/^priority:\s*(low|medium|high|critical)\s*$/im, "")
        .trim();

        // Description ki first line = issue
        const issue = description.split("\n")[0].trim();

        if (!issue) {
        console.log("Ticket issue missing - ignored.");
        return res.sendStatus(200);
        }

        const slackDate = new Date(Number(event.ts) * 1000);

        const slackUserName = await getSlackUserName(event.user);
        const slackChannelName = await getSlackChannelName(event.channel);

        // 4. Ticket object
        const ticket = {
          department: department,
          issue: issue,
          description: description,
          priority: priority,

          slackChannel: slackChannelName,
          slackUser: slackUserName,
          slackTimestamp: event.ts,
          slackUserId: event.user,

          createdAt: slackDate.toLocaleString("en-PK", {
            timeZone: "Asia/Karachi",
          }),
        };

        // 3. Mandatory fields validation
        if (
          !ticket.department ||
          !ticket.issue ||
          !ticket.description ||
          !ticket.priority
        ) {
          console.log("Invalid ticket template - ignored.");
          return res.sendStatus(200);
        }

        // 4. Valid ticket
        console.log("\n========== VALID TICKET ==========");
        console.log(ticket);
        console.log("==================================\n");

        try {
          const handlerId = await selectHandler(ticket.issue);

          const glpiTicket = await createGlpiTicket(ticket);
          const ticketId = glpiTicket.id;

          await assignHandlerToTicket(ticketId, handlerId);

          const fullGlpiTicket = await getGlpiTicket(ticketId);
          const handlerName = getAssignedHandlerName(fullGlpiTicket);

          const slackMessage = await sendSlackTicketConfirmation(
            event.channel,
            event.ts,
            ticketId,
            ticket,
            handlerName,
          );

          await saveTicketMapping({
            glpiTicketId: ticketId,
            slackChannelId: event.channel,
            slackMessageTs: slackMessage.ts,
            slackThreadTs: event.ts,

            issue: ticket.issue,
            department: ticket.department,
            priority: ticket.priority,
            assignedTo: handlerName,

            reporterName: ticket.slackUser,
            reporterSlackUserId: ticket.slackUserId,

            status: "OPEN",
          });

          console.log(`Ticket mapping saved for Ticket #${ticketId}`);

          console.log(`Slack confirmation sent for Ticket #${ticketId}`);
        } catch (error) {
          console.error("GLPI ERROR:", error.message);
        }
      }
    }

    res.sendStatus(200);
  },
);

app.post(
  "/slack/interactions",
  express.raw({ type: "application/x-www-form-urlencoded" }),
  verifySlackRequest,
  async (req, res) => {
    try {
      const formData = new URLSearchParams(req.rawBody);
      const payloadString = formData.get("payload");

      if (!payloadString) {
        return res.status(400).send("Missing payload");
      }

      const payload = JSON.parse(payloadString);
      const action = payload.actions?.[0];

      if (!action) {
        return res.sendStatus(200);
      }

      const actionId = action.action_id;
      const ticketId = Number(action.value);
      const userId = payload.user.id;

      console.log("\n========== SLACK INTERACTION ==========");
      console.log("User:", payload.user?.username || userId);
      console.log("Action:", actionId);
      console.log("Ticket:", ticketId);
      console.log("=======================================\n");

      // Slack ko immediately ACK
      res.sendStatus(200);

      try {
        // ----------------------------------------
        // 1. Existing complete state DB se lo
        // ----------------------------------------
        const existingState = await getTicketMapping(ticketId);

        if (!existingState) {
          console.log(`No DB mapping found for Ticket #${ticketId}`);
          return;
        }

        // ----------------------------------------
        // 2. Department DB se lo
        // ----------------------------------------
        const department =
          existingState.department?.toLowerCase() || null;

        console.log("Department:", department);

        // ----------------------------------------
        // 3. IT Authorization
        // ----------------------------------------
        if (department === "it") {
          if (!isAuthorizedITAgent(userId)) {
            await fetch(
              "https://slack.com/api/chat.postEphemeral",
              {
                method: "POST",
                headers: {
                  Authorization:
                    `Bearer ${process.env.SLACK_BOT_TOKEN}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  channel: payload.channel.id,
                  user: userId,
                  text: "⛔ You are not authorized to update this ticket.",
                }),
              }
            );

            console.log(
              `Unauthorized IT ticket action by ${userId}`
            );

            return;
          }

          console.log(`Authorized IT agent: ${userId}`);
        }

        // ----------------------------------------
        // 4. Action → GLPI status
        // ----------------------------------------
        let glpiStatusId;

        if (actionId === "planned_ticket") {
          glpiStatusId = 3; // Processing (planned)
        } else if (actionId === "resolve_ticket") {
          glpiStatusId = 5; // Solved
        } else {
          console.log(`Unhandled action: ${actionId}`);
          return;
        }

        // ----------------------------------------
        // 5. GLPI status update
        // ----------------------------------------
        await updateGlpiTicketStatus(
          ticketId,
          glpiStatusId
        );

        // ----------------------------------------
        // 6. Fresh ticket GLPI se lo
        // ----------------------------------------
        const freshTicket =
          await getGlpiTicket(ticketId);

        console.log(
          `Ticket #${ticketId} → ${freshTicket.status?.name}`
        );

        // ----------------------------------------
        // 7. Priority convert
        // ----------------------------------------
        const priorities = {
          1: "Very Low",
          2: "Low",
          3: "Medium",
          4: "High",
          5: "Very High",
          6: "Major",
        };

        const priorityName =
          priorities[freshTicket.priority] || null;

        // ----------------------------------------
        // 8. Assigned user extract
        // ----------------------------------------
        const assignedUser =
          freshTicket.team?.find(
            (member) =>
              member.role === "assigned" &&
              member.type === "User"
          );

        let assignedTo = null;

        if (assignedUser) {
          const fullName = [
            assignedUser.firstname,
            assignedUser.realname,
          ]
            .filter(Boolean)
            .join(" ");

          assignedTo =
            fullName ||
            assignedUser.display_name ||
            assignedUser.name ||
            null;
        }

        // ----------------------------------------
        // 9. DB state update
        // ----------------------------------------
        await updateTicketState(
          ticketId,
          {
            issue: freshTicket.name || null,

            // Department already DB mein correct hai.
            // null dene par COALESCE old value preserve karega.
            department: null,

            priority: priorityName,
            assignedTo: assignedTo,
            status: freshTicket.status?.name || null,
          }
        );

        // ----------------------------------------
        // 10. COMPLETE state dobara DB se lo
        // ----------------------------------------
        const updatedState =
          await getTicketMapping(ticketId);

        if (!updatedState) {
          console.log(
            `Updated DB state missing for Ticket #${ticketId}`
          );
          return;
        }

        // ----------------------------------------
        // 11. SAME canonical card builder/update
        // ----------------------------------------
        await updateSlackTicket(updatedState);

        console.log(
          `Slack card immediately updated for Ticket #${ticketId}`
        );

      } catch (error) {
        console.error(
          "Ticket processing error:",
          error.message
        );
      }

    } catch (error) {
      console.error(
        "Interaction error:",
        error.message
      );

      if (!res.headersSent) {
        res.sendStatus(500);
      }
    }
  }
);

app.post("/glpi/webhook", createGlpiWebhookHandler(getGlpiTicket), (req, res) => {
  let rawBody = "";

  req.setEncoding("utf8");

  req.on("data", (chunk) => {
    rawBody += chunk;
  });

  req.on("end", () => {
    console.log("\n========== GLPI WEBHOOK ==========");
    console.log("Raw Body:", rawBody);
    console.log("==================================\n");

    res.sendStatus(200);
  });
});

const PORT = process.env.port || 3000;

// getGlpiTicket(7);
// updateGlpiTicketStatus(7, 2);

app.listen(PORT, () => {
  console.log(`Slack integration running on port ${PORT}`);
});