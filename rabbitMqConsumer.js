const amqp = require("amqplib");
const { isEventCompleted, markEventCompleted } = require("./eventStore");

const MAIN_QUEUE = "glpi_notifications";
const RETRY_QUEUE = "glpi_notifications_retry";
const DEAD_QUEUE = "glpi_notifications_dlq";

const MAX_RETRIES = 3;
const RETRY_DELAY = 10000; // 10 seconds

async function startRabbitMQConsumer(processGlpiWebhook, getGlpiTicket) {
  const connection = await amqp.connect(process.env.RABBITMQ_URL);

  connection.on("error", (error) => {
    console.error("RabbitMQ consumer connection error:", error);
  });

  const channel = await connection.createConfirmChannel();

  channel.on("error", (error) => {
    console.error("RabbitMQ consumer channel error:", error);
  });

  // Failed messages permanently stored here
  await channel.assertQueue(DEAD_QUEUE, {
    durable: true,
  });

  // Retry messages wait here for 10 seconds
  await channel.assertQueue(RETRY_QUEUE, {
    durable: true,
    arguments: {
      "x-message-ttl": RETRY_DELAY,
      "x-dead-letter-exchange": "",
      "x-dead-letter-routing-key": MAIN_QUEUE,
    },
  });

  await channel.assertQueue(MAIN_QUEUE, {
    durable: true,
  });

  await channel.prefetch(1);

  function publishConfirmed(queue, content, headers = {}) {
    return new Promise((resolve, reject) => {
      channel.sendToQueue(
        queue,
        content,
        {
          persistent: true,
          headers,
        },
        (error) => {
          if (error) return reject(error);
          resolve();
        },
      );
    });
  }

  await channel.consume(
    MAIN_QUEUE,
    async (message) => {
      if (!message) return;

      try {
        const event = JSON.parse(message.content.toString());

        if (!event.event_id || !event.payload) {
          throw new Error("Invalid event envelope");
        }

        const eventId = event.event_id;

        if (await isEventCompleted(eventId)) {
          console.log(`Duplicate event skipped: ${eventId}`);
          channel.ack(message);
          return;
        }

        await processGlpiWebhook(event.payload, getGlpiTicket);

        await markEventCompleted(eventId);

        channel.ack(message);

        console.log(`Event completed: ${eventId}`);

        console.log("RabbitMQ message processed successfully");
      } catch (error) {
        console.error("RabbitMQ processing failed:", error);

        const retries = Number(
          message.properties.headers?.["x-retry-count"] || 0,
        );

        const nextRetry = retries + 1;

        try {
          if (retries < MAX_RETRIES) {
            await publishConfirmed(RETRY_QUEUE, message.content, {
              ...message.properties.headers,
              "x-retry-count": nextRetry,
            });

            console.log(
              `Message scheduled for retry ${nextRetry}/${MAX_RETRIES}`,
            );
          } else {
            await publishConfirmed(DEAD_QUEUE, message.content, {
              ...message.properties.headers,
              "x-retry-count": retries,
              "x-error": String(error.message).slice(0, 500),
            });

            console.error("Message moved to Dead Letter Queue");
          }

          // Acknowledge original only after retry/DLQ publish confirmation
          channel.ack(message);
        } catch (publishError) {
          console.error("Failed to publish retry/DLQ message:", publishError);

          // Requeue original rather than lose it
          try {
            channel.nack(message, false, true);
          } catch (ackError) {
            console.error("Unable to requeue message:", ackError);
          }
        }
      }
    },
    { noAck: false },
  );

  console.log("RabbitMQ consumer started with retry + DLQ");
}

module.exports = { startRabbitMQConsumer };
