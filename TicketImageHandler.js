async function downloadSlackFile(file) {
  const response = await fetch(file.url_private_download || file.url_private, {
    headers: {
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Slack file download failed: ${response.status} ${response.statusText}`,
    );
  }

  const arrayBuffer = await response.arrayBuffer();

  return {
    buffer: Buffer.from(arrayBuffer),
    filename: file.name || `slack-file-${Date.now()}`,
    mimeType: file.mimetype || "application/octet-stream",
  };
}

async function uploadGlpiDocument(file, sessionToken) {
  const form = new FormData();

  const manifest = {
    input: {
      name: file.filename,
      _filename: [file.filename],
    },
  };

  form.append(
    "uploadManifest",
    JSON.stringify(manifest)
  );

  form.append(
    "filename[0]",
    new Blob([file.buffer], {
      type: file.mimeType,
    }),
    file.filename
  );

  const response = await fetch(
    `${process.env.GLPI_LEGACY_URL}/Document/`,
    {
      method: "POST",
      headers: {
        "Session-Token": sessionToken,
        "App-Token": process.env.GLPI_LEGACY_APP_TOKEN,
      },
      body: form,
    }
  );

  const rawResponse = await response.text();

  let result;

  try {
    result = JSON.parse(rawResponse);
  } catch {
    throw new Error(
      `GLPI document upload returned invalid JSON: HTTP ${response.status} ${rawResponse.slice(0, 500)}`
    );
  }

  if (!response.ok || !result.id) {
    throw new Error(
      `GLPI document upload failed: HTTP ${response.status} ${rawResponse}`
    );
  }

  console.log(
    `GLPI Document uploaded successfully: ID ${result.id}`
  );

  return result.id;
}

async function attachDocumentToTicket(documentId, ticketId, sessionToken) {
  const response = await fetch(
    `${process.env.GLPI_LEGACY_URL}/Document_Item/`,
    {
      method: "POST",
      headers: {
        "Session-Token": sessionToken,
        "App-Token": process.env.GLPI_LEGACY_APP_TOKEN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          documents_id: documentId,
          itemtype: "Ticket",
          items_id: Number(ticketId),
        },
      }),
    },
  );

  const result = await response.json();

  if (!response.ok) {
    throw new Error(
      `GLPI document attachment failed: ${response.status} ${JSON.stringify(result)}`,
    );
  }

  return result;
}

module.exports = {
  downloadSlackFile,
  uploadGlpiDocument,
  attachDocumentToTicket,
};
