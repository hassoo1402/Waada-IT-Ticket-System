const { getTicketMapping } = require("./ticketMapping");
const {
  updateSlackTicketFromGlpi,
} = require("./slackTicketUpdater");

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

        // Sirf Ticket update events process karo
        if (
          payload.event !== "update" ||
          !payload.item?.id
        ) {
          return res.sendStatus(200);
        }

        const ticketId = Number(payload.item.id);

        console.log(`GLPI webhook: Ticket #${ticketId} updated`);

        // GLPI Ticket → Slack card mapping
        const mapping = await getTicketMapping(ticketId);

        if (!mapping) {
          console.log(
            `No Slack mapping found for Ticket #${ticketId}`
          );

          return res.sendStatus(200);
        }

        // GLPI se fresh/current ticket lo
        const ticket = await getGlpiTicket(ticketId);

        // Correct Slack card update
        await updateSlackTicketFromGlpi(
          mapping.slack_channel_id,
          mapping.slack_message_ts,
          ticket
        );

        console.log(
          `Slack card synced for Ticket #${ticketId}`
        );

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