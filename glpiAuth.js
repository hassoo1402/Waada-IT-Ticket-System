
async function getGlpiLegacySession() {
  const response = await fetch(`${process.env.GLPI_LEGACY_URL}/initSession`, {
    method: "GET",
    headers: {
      Authorization: `user_token ${process.env.GLPI_LEGACY_USER_TOKEN}`,
      "App-Token": process.env.GLPI_LEGACY_APP_TOKEN,
    },
  });

  const result = await response.json();

  if (!response.ok || !result.session_token) {
    throw new Error(
      `GLPI legacy session failed: ${response.status} ${JSON.stringify(result)}`,
    );
  }

  return result.session_token;
}

module.exports = {
  getGlpiLegacySession,
};