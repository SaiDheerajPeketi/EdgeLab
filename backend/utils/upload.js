import fs from "node:fs/promises";
import path from "node:path";

export async function resolveCsvUpload(req, uploadsDir) {
  const contentType = req.headers["content-type"] ?? "";

  if (req.body?.path) {
    return {
      path: String(req.body.path),
      originalname: req.body.filename ? String(req.body.filename) : path.basename(String(req.body.path)),
      cleanup: false,
    };
  }

  if (!contentType.includes("multipart/form-data")) {
    const error = new Error("Upload a multipart CSV file or JSON body with a local path.");
    error.status = 400;
    error.code = "missing_file";
    throw error;
  }

  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/);
  if (!boundaryMatch) {
    const error = new Error("Multipart upload is missing a boundary.");
    error.status = 400;
    throw error;
  }

  const boundary = Buffer.from(`--${boundaryMatch[1] ?? boundaryMatch[2]}`);
  const parts = splitMultipart(req.rawBody, boundary);
  let file = null;
  const fields = {};

  for (const part of parts) {
    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const header = part.subarray(0, headerEnd).toString("utf8");
    let body = part.subarray(headerEnd + 4);
    if (body.subarray(-2).toString("utf8") === "\r\n") {
      body = body.subarray(0, -2);
    }

    const name = header.match(/name="([^"]+)"/)?.[1];
    const filename = header.match(/filename="([^"]*)"/)?.[1];
    if (!name) continue;

    if (filename !== undefined) {
      file = { filename: filename || "instrument.csv", body };
    } else {
      fields[name] = body.toString("utf8");
    }
  }

  if (!file) {
    const error = new Error("Multipart request did not include a file field.");
    error.status = 400;
    error.code = "missing_file";
    throw error;
  }

  req.body = { ...req.body, ...fields };
  await fs.mkdir(uploadsDir, { recursive: true });
  const uploadPath = path.join(
    uploadsDir,
    `${Date.now()}-${Math.random().toString(36).slice(2)}-${sanitizeFilename(file.filename)}`,
  );
  await fs.writeFile(uploadPath, file.body);

  return {
    path: uploadPath,
    originalname: file.filename,
    cleanup: true,
  };
}

function splitMultipart(buffer, boundary) {
  const parts = [];
  let cursor = 0;

  while (cursor < buffer.length) {
    const start = buffer.indexOf(boundary, cursor);
    if (start === -1) break;
    const next = buffer.indexOf(boundary, start + boundary.length);
    if (next === -1) break;

    const part = buffer.subarray(start + boundary.length + 2, next);
    if (part.length > 0 && part.subarray(0, 2).toString("utf8") !== "--") {
      parts.push(part);
    }
    cursor = next;
  }

  return parts;
}

function sanitizeFilename(filename) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}
