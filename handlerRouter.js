const pool = require("./db");

// POC mein counter; persistent round-robin state baad mein DB mein jayegi
async function getNextITExecutive() {
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();

    const [dbInfo] = await connection.query(
        "SELECT DATABASE() AS current_database"
        );

        const [rrRows] = await connection.query(
        "SELECT * FROM round_robin_state"
        );

        console.log("NODE DATABASE:", dbInfo);
        console.log("NODE ROUND ROBIN:", rrRows);

    // Round-robin ki current state ko lock/read karo
    const [stateRows] = await connection.query(
      `SELECT last_handler_id
       FROM round_robin_state
       WHERE category = 'IT Executives'
       FOR UPDATE`
    );

    const lastHandlerId = stateRows[0]?.last_handler_id ?? null;

    // Saare active IT Executives
    const [handlers] = await connection.query(
      `SELECT id, glpi_user_id
       FROM handlers
       WHERE category = 'IT Executive'
         AND active = TRUE
       ORDER BY id`
    );

    if (handlers.length === 0) {
      throw new Error("No active IT Executives found");
    }

    // First ticket / ya last handler list mein nahi mila
    let nextIndex = 0;

    if (lastHandlerId !== null) {
      const lastIndex = handlers.findIndex(
        (handler) => handler.id === lastHandlerId
      );

      if (lastIndex !== -1) {
        nextIndex = (lastIndex + 1) % handlers.length;
      }
    }

    console.log("LAST HANDLER ID:", lastHandlerId);

    const nextHandler = handlers[nextIndex];

    // Yaad rakho kis handler ko latest ticket mila
    const [result] = await connection.query(
        `UPDATE round_robin_state
        SET last_handler_id = ?
        WHERE category = 'IT Executives'`,
        [nextHandler.id]
        );

        console.log("NEXT HANDLER:", nextHandler);
        console.log("ROUND ROBIN UPDATE:", result);

    await connection.commit();

    // GLPI ko hamari internal DB ID nahi, GLPI user ID chahiye
    return nextHandler.glpi_user_id;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function selectHandler(issue) {
  const text = issue.toLowerCase();

  console.log("ROUTER ISSUE:", JSON.stringify(issue));

  if (
    text.includes("call") ||
    text.includes("voice") ||
    text.includes("telephony") ||
    text.includes("asterisk") ||
    text.includes("vicidial")
  ) {
    return 15;
  }

  if (
    text.includes("docker") ||
    text.includes("kubernetes") ||
    text.includes("deployment") ||
    text.includes("pipeline") ||
    text.includes("ci/cd") ||
    text.includes("bitbucket")
  ) {
    return 11;
  }

  if (
    text.includes("laptop") ||
    text.includes("desktop") ||
    text.includes("printer") ||
    text.includes("windows") ||
    text.includes("keyboard") ||
    text.includes("mouse") ||
    text.includes("headphone") ||
    text.includes("headset") ||
    text.includes("anydesk") ||
    text.includes("software") ||
    text.includes("email") ||
    text.includes("password") ||
    text.includes("wifi") ||
    text.includes("wi-fi") ||
    text.includes("internet")
  ) {
    return await getNextITExecutive();
  }

  if (
    text.includes("network") ||
    text.includes("server") ||
    text.includes("firewall") ||
    text.includes("vpn") ||
    text.includes("switch") ||
    text.includes("router")
  ) {
    return 10;
  }

  // Unknown → Hassam
  return 10;
}

module.exports = {
    selectHandler,
};