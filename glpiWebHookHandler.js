const {
  getTicketMapping,
  updateTicketState,
} = require("./ticketMapping");

const {
  updateSlackTicket,
} = require("./slackTicketUpdater");

const {
  notifyReporter,
  notifyReporterAboutFollowup,
} = require("./reporterNotifier");

function createGlpiWebhookHandler(getGlpiTicket) {
  return (req, res) => {
    let rawBody = "";

    req.setEncoding("utf8");

    req.on("data", (chunk) => {
      rawBody += chunk;
    });

    req.on("end", async () => {
      try {
        const payload = JSON.parse(rawBody);

        console.log(
          "GLPI WEBHOOK PAYLOAD:",
          JSON.stringify(payload, null, 2)
        );

        // ==================================================
        // 1. NEW FOLLOWUP / REPLY
        // ==================================================

        if (
          payload.event === "new" &&
          payload.item?.itemtype === "Ticket" &&
          payload.item?.items_id
        ) {
          const ticketId = Number(payload.item.items_id);

          console.log(
            `New followup received for Ticket #${ticketId}`
          );

          const mapping =
            await getTicketMapping(ticketId);

          if (!mapping) {
            console.log(
              `No Slack mapping found for Ticket #${ticketId}`
            );

            return res.sendStatus(200);
          }

          // ---------- Reply Author ----------

          const authorId =
            Number(payload.item.user?.id);

          const teamMember =
            payload.parent_item?.team?.find(
              (member) =>
                Number(member.id) === authorId
            );

          const repliedBy =
            teamMember?.display_name ||
            [
              teamMember?.firstname,
              teamMember?.realname,
            ]
              .filter(Boolean)
              .join(" ") ||
            payload.item.user?.name ||
            "Unknown";

          // ---------- Reporter DM ----------

          await notifyReporterAboutFollowup(
            mapping.reporter_slack_user_id,
            {
              ticketId,

              ticketName:
                payload.parent_item?.name ||
                mapping.issue ||
                "Ticket",

              reply:
                payload.item.content,

              repliedBy,

              repliedAt:
                payload.item.date_creation ||
                payload.item.date,

              status:
                payload.parent_item?.status?.name ||
                mapping.status ||
                "Unknown",
            }
          );

          console.log(
            `Followup processed for Ticket #${ticketId}`
          );

          return res.sendStatus(200);
        }

        // ==================================================
        // 2. NORMAL TICKET UPDATE
        // ==================================================

        if (
          payload.event !== "update" ||
          !payload.item?.id
        ) {
          return res.sendStatus(200);
        }

        const ticketId =
          Number(payload.item.id);

        console.log(
          `GLPI webhook: Ticket #${ticketId} updated`
        );

        // IMPORTANT:
        // Change se PEHLE current DB state
        const existingState =
          await getTicketMapping(ticketId);

        if (!existingState) {
          console.log(
            `No Slack mapping found for Ticket #${ticketId}`
          );

          return res.sendStatus(200);
        }

        // Fresh GLPI state
        const ticket =
          await getGlpiTicket(ticketId);

        // ---------- Priority ----------

        const priorities = {
          1: "Very Low",
          2: "Low",
          3: "Medium",
          4: "High",
          5: "Very High",
          6: "Major",
        };

        const priorityName =
          priorities[ticket.priority] || null;

        // ---------- Assigned User ----------

        const assignedUser =
          ticket.team?.find(
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

        // ---------- Department ----------

        const departmentMatch =
          ticket.content?.match(
            /^Department:\s*(.+)$/im
          );

        const department =
          departmentMatch
            ? departmentMatch[1].trim()
            : null;

        // ---------- Status ----------

        const status =
          ticket.status?.name || null;

        // ==================================================
        // 3. CHECK IF SOMETHING MEANINGFUL ACTUALLY CHANGED
        // IMPORTANT: DB update se PEHLE comparison
        // ==================================================

        const statusChanged =
          status !== null &&
          existingState.status !== status;

        const priorityChanged =
          priorityName !== null &&
          existingState.priority !== priorityName;

        const assigneeChanged =
          assignedTo !== null &&
          existingState.assigned_to !== assignedTo;

        const shouldNotifyReporter =
          statusChanged ||
          priorityChanged ||
          assigneeChanged;

        console.log("Change detection:", {
          statusChanged,
          priorityChanged,
          assigneeChanged,
          shouldNotifyReporter,
        });

        // ==================================================
        // 4. UPDATE DB STATE
        // ==================================================

        await updateTicketState(
          ticketId,
          {
            issue: ticket.name || null,
            department,
            priority: priorityName,
            assignedTo,
            status,
          }
        );

        // Updated COMPLETE state DB se
        const updatedState =
          await getTicketMapping(ticketId);

        // ==================================================
        // 5. SLACK CARD SYNC
        // ==================================================

        await updateSlackTicket(updatedState);

        console.log(
          `Slack card synced for Ticket #${ticketId}`
        );

        // ==================================================
        // 6. REPORTER DM
        // Only meaningful change par
        // ==================================================

        if (shouldNotifyReporter) {
          await notifyReporter(
            updatedState.reporter_slack_user_id,
            ticket
          );

          console.log(
            `Reporter notified for Ticket #${ticketId}`
          );
        } else {
          console.log(
            `No meaningful change - reporter DM skipped for Ticket #${ticketId}`
          );
        }

        return res.sendStatus(200);

      } catch (error) {
        console.error(
          "GLPI webhook processing failed:",
          error.message
        );

        return res.sendStatus(500);
      }
    });
  };
}

module.exports = {
  createGlpiWebhookHandler,
};