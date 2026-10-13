const amqp = require("amqplib");
const { randomUUID } = require("node:crypto");

let connection;
let channel;

async function connectRabbitMQ() {
  connection = await amqp.connect(process.env.RABBITMQ_URL);
  channel = await connection.createConfirmChannel();

  await channel.assertQueue("glpi_notifications", {
    durable: true,
  });

  console.log("RabbitMQ connected successfully");

  return channel;
}

async function publishNotification(event) {
  if (!channel) {
    throw new Error("RabbitMQ channel not initialized");
  }

  const eventId = randomUUID();

  const message = Buffer.from(
    JSON.stringify({
      event_id: eventId,
      payload: event,
    })
  );

  await new Promise((resolve, reject) => {
    channel.sendToQueue(
      "glpi_notifications",
      message,
      { persistent: true, messageId: eventId },
      (error) => {
        if (error) return reject(error);
        resolve();
      }
    );
  });

  console.log(`RabbitMQ event published: ${eventId}`);
  return eventId;
}

module.exports = { connectRabbitMQ, publishNotification };