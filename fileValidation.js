
const path = require("node:path");

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_TOTAL_SIZE = 10 * 1024 * 1024;
const MAX_FILES = 3;

const ALLOWED_EXTENSIONS = new Set([
  ".pdf", ".docx", ".xlsx", ".txt", ".csv", ".jpg", ".jpeg", ".png"
]);

function validateFileName(filename) {
  if (
    typeof filename !== "string" ||
    !filename.trim() ||
    filename.includes("/") ||
    filename.includes("\\") ||
    filename.includes("\0")
  ) {
    throw new Error("Invalid filename");
  }

  const extension = path.extname(filename).toLowerCase();

  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error(`File type not allowed: ${filename}`);
  }

  return extension;
}

function validateFileSize(size, filename) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_FILE_SIZE) {
    throw new Error(`File exceeds 5 MB limit or has invalid size: ${filename}`);
  }
}

// Read a response without allowing an unlimited memory allocation.
async function readLimitedFile(response, filename) {
  const declaredLength = response.headers.get("content-length");

  if (declaredLength !== null) {
    validateFileSize(Number(declaredLength), filename);
  }

  if (!response.body) {
    throw new Error(`Empty download response: ${filename}`);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      total += value.byteLength;

      if (total > MAX_FILE_SIZE) {
        throw new Error(`File exceeds 5 MB: ${filename}`);
      }

      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }

  validateFileSize(total, filename);
  return Buffer.concat(chunks, total);
}

// Validate actual file contents, not just the extension.
// OOXML formats (DOCX/XLSX) are ZIP containers internally.
function validateFileContent(file) {
  const extension = validateFileName(file.filename);
  const buffer = file.buffer;

  if (!Buffer.isBuffer(buffer)) {
    throw new Error("Invalid file buffer");
  }

  validateFileSize(buffer.length, file.filename);

  const isZip =
    buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));

  const isRar =
    buffer.subarray(0, 6).equals(Buffer.from([0x52, 0x61, 0x72, 0x21, 0x1a, 0x07]));

  const isExe =
    buffer.subarray(0, 2).equals(Buffer.from([0x4d, 0x5a]));

  if (isRar || isExe) {
    throw new Error(`Unsafe file content: ${file.filename}`);
  }

  if (extension === ".pdf" &&
      !buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    throw new Error("Invalid PDF signature");
  }

  if (extension === ".png" &&
      !buffer.subarray(0, 8).equals(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
      )) {
    throw new Error("Invalid PNG signature");
  }

  if ([".jpg", ".jpeg"].includes(extension) &&
      !(buffer[0] === 0xff && buffer[1] === 0xd8 &&
        buffer[buffer.length - 2] === 0xff &&
        buffer[buffer.length - 1] === 0xd9)) {
    throw new Error("Invalid JPEG signature");
  }

  if ([".docx", ".xlsx"].includes(extension)) {
    if (!isZip) {
      throw new Error(`Invalid Office document: ${file.filename}`);
    }
    // ZIP header alone is insufficient: Office package structure
    // must be verified separately before production deployment.
    throw new Error(
      `Office document structural validation not yet configured: ${file.filename}`
    );
  }

  if (isZip) {
    throw new Error(`ZIP files are not allowed: ${file.filename}`);
  }

  if ([".txt", ".csv"].includes(extension)) {
    if (buffer.includes(0)) {
      throw new Error(`Binary content not allowed: ${file.filename}`);
    }
  }

  return true;
}

function validateFileBatch(files) {
  if (files.length > MAX_FILES) {
    throw new Error("Maximum 3 files allowed per follow-up");
  }

  let total = 0;

  for (const file of files) {
    validateFileContent(file);
    total += file.buffer.length;

    if (total > MAX_TOTAL_SIZE) {
      throw new Error("Combined files exceed 10 MB");
    }
  }
}

module.exports = {
    validateFileName,
    validateFileSize,
    readLimitedFile,
    validateFileContent,
    validateFileBatch,
}