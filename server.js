import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { extname, join, normalize, relative } from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const DATA_DIR = join(ROOT, "data");
const UPLOAD_DIR = join(ROOT, "media", "uploads");
const CATALOG_FILE = join(DATA_DIR, "media-catalog.json");
const ADMINS_FILE = join(DATA_DIR, "admins.json");
const PORT = Number(process.env.PORT || 4173);
const MAX_UPLOAD_BYTES = 250 * 1024 * 1024;
const MAX_ADMINS = 10;

const MIME_TYPES = {
  ".aac": "audio/aac",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".m4a": "audio/mp4",
  ".manifest": "application/manifest+json",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webm": "audio/webm"
};

await ensureStorage();

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);

    if (url.pathname === "/api/admins/bootstrap" && request.method === "GET") {
      const admins = await readAdmins();
      await sendJson(response, { hasAdmins: admins.length > 0, maxAdmins: MAX_ADMINS });
      return;
    }

    if (url.pathname === "/api/admins/bootstrap" && request.method === "POST") {
      await handleAdminBootstrap(request, response);
      return;
    }

    if (url.pathname === "/api/admins/login" && request.method === "POST") {
      await handleAdminLogin(request, response);
      return;
    }

    if (url.pathname === "/api/admins/recover" && request.method === "POST") {
      await handleAdminRecovery(request, response);
      return;
    }

    if (url.pathname === "/api/admins" && request.method === "GET") {
      await sendJson(response, { admins: publicAdmins(await readAdmins()), maxAdmins: MAX_ADMINS });
      return;
    }

    if (url.pathname === "/api/admins" && request.method === "POST") {
      await handleAdminCreate(request, response);
      return;
    }

    const adminMatch = url.pathname.match(/^\/api\/admins\/([^/]+)$/);
    if (adminMatch && request.method === "PATCH") {
      await handleAdminPatch(adminMatch[1], request, response);
      return;
    }

    if (adminMatch && request.method === "DELETE") {
      await handleAdminDelete(adminMatch[1], request, response);
      return;
    }

    if (url.pathname === "/api/media" && request.method === "GET") {
      await sendJson(response, { media: await readCatalog() });
      return;
    }

    if (url.pathname === "/api/media" && request.method === "POST") {
      await handleUpload(request, response);
      return;
    }

    const mediaItemMatch = url.pathname.match(/^\/api\/media\/([^/]+)$/);
    if (mediaItemMatch && request.method === "PATCH") {
      await handlePatch(mediaItemMatch[1], request, response);
      return;
    }

    if (mediaItemMatch && request.method === "DELETE") {
      await handleDelete(mediaItemMatch[1], response);
      return;
    }

    if (!["GET", "HEAD"].includes(request.method || "")) {
      sendText(response, 405, "Method not allowed");
      return;
    }

    await serveStatic(url.pathname, request, response);
  } catch (error) {
    console.error(error);
    sendText(response, 500, "Local preview server error");
  }
}).listen(PORT, () => {
  console.log(`InnerTime preview running at http://localhost:${PORT}/`);
  console.log(`Uploaded audio is saved in ${UPLOAD_DIR}`);
});

async function ensureStorage() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(UPLOAD_DIR, { recursive: true });
  try {
    await readFile(CATALOG_FILE, "utf8");
  } catch {
    await writeCatalog([]);
  }
  try {
    await readFile(ADMINS_FILE, "utf8");
  } catch {
    await writeAdmins([]);
  }
}

async function handleAdminBootstrap(request, response) {
  const admins = await readAdmins();
  if (admins.length) {
    sendText(response, 409, "Owner admin already exists.");
    return;
  }
  const body = await readJsonBody(request);
  if (!validPasscode(body.passcode)) {
    sendText(response, 400, "Passcode must be at least 6 characters.");
    return;
  }
  const recoveryCode = makeRecoveryCode();
  const owner = makeAdmin({
    name: cleanField(body.name) || "Owner",
    role: "owner",
    passcode: body.passcode,
    recoveryCode
  });
  await writeAdmins([owner]);
  await sendJson(response, { admin: publicAdmin(owner), recoveryCode }, 201);
}

async function handleAdminLogin(request, response) {
  const body = await readJsonBody(request);
  const name = cleanField(body.name);
  const passcode = String(body.passcode || "");
  const admins = await readAdmins();
  const admin = admins.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (!admin || admin.passHash !== hashSecret(passcode, admin.salt)) {
    sendText(response, 401, "Admin name or passcode did not match.");
    return;
  }
  admin.lastLoginAt = new Date().toISOString();
  await writeAdmins(admins);
  await sendJson(response, { admin: publicAdmin(admin) });
}

async function handleAdminRecovery(request, response) {
  const body = await readJsonBody(request);
  const admins = await readAdmins();
  const admin = admins.find((item) => item.name.toLowerCase() === cleanField(body.name).toLowerCase());
  if (!admin || admin.role !== "owner" || !admin.recoveryHash || !admin.recoverySalt) {
    sendText(response, 404, "Owner recovery is not configured.");
    return;
  }
  if (admin.recoveryHash !== hashSecret(String(body.recoveryCode || ""), admin.recoverySalt)) {
    sendText(response, 401, "Recovery code did not match.");
    return;
  }
  if (!validPasscode(body.passcode)) {
    sendText(response, 400, "New passcode must be at least 6 characters.");
    return;
  }
  admin.salt = crypto.randomBytes(16).toString("hex");
  admin.passHash = hashSecret(body.passcode, admin.salt);
  admin.passwordResetAt = new Date().toISOString();
  await writeAdmins(admins);
  await sendJson(response, { admin: publicAdmin(admin) });
}

async function handleAdminCreate(request, response) {
  const body = await readJsonBody(request);
  const admins = await readAdmins();
  if (!requestIsOwner(body, admins)) {
    sendText(response, 403, "Only the original owner can add admins.");
    return;
  }
  if (admins.length >= MAX_ADMINS) {
    sendText(response, 400, `Maximum ${MAX_ADMINS} admins allowed.`);
    return;
  }
  const name = cleanField(body.name);
  if (!name) {
    sendText(response, 400, "Admin name is required.");
    return;
  }
  if (admins.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
    sendText(response, 400, "Admin name already exists.");
    return;
  }
  if (!validPasscode(body.passcode)) {
    sendText(response, 400, "Passcode must be at least 6 characters.");
    return;
  }
  const admin = makeAdmin({ name, role: "admin", passcode: body.passcode });
  admins.push(admin);
  await writeAdmins(admins);
  await sendJson(response, { admin: publicAdmin(admin) }, 201);
}

async function handleAdminPatch(id, request, response) {
  const body = await readJsonBody(request);
  const admins = await readAdmins();
  if (!requestIsOwner(body, admins)) {
    sendText(response, 403, "Only the original owner can reset admin passwords.");
    return;
  }
  const admin = admins.find((item) => item.id === decodeURIComponent(id));
  if (!admin) {
    sendText(response, 404, "Admin not found.");
    return;
  }
  if (!validPasscode(body.passcode)) {
    sendText(response, 400, "New passcode must be at least 6 characters.");
    return;
  }
  admin.salt = crypto.randomBytes(16).toString("hex");
  admin.passHash = hashSecret(body.passcode, admin.salt);
  admin.passwordResetAt = new Date().toISOString();
  await writeAdmins(admins);
  await sendJson(response, { admin: publicAdmin(admin) });
}

async function handleAdminDelete(id, request, response) {
  const body = await readJsonBody(request);
  const admins = await readAdmins();
  if (!requestIsOwner(body, admins)) {
    sendText(response, 403, "Only the original owner can remove admins.");
    return;
  }
  const index = admins.findIndex((item) => item.id === decodeURIComponent(id));
  if (index < 0) {
    sendText(response, 404, "Admin not found.");
    return;
  }
  if (admins[index].role === "owner") {
    sendText(response, 400, "Original owner cannot be removed.");
    return;
  }
  admins.splice(index, 1);
  await writeAdmins(admins);
  await sendJson(response, { ok: true });
}

async function handleUpload(request, response) {
  const contentType = request.headers["content-type"] || "";
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[1] || contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/)?.[2];
  if (!boundary) {
    sendText(response, 400, "Upload must use multipart form data.");
    return;
  }

  const body = await readBody(request, MAX_UPLOAD_BYTES);
  const parts = parseMultipart(body, boundary);
  const file = parts.files.file;
  if (!file) {
    sendText(response, 400, "Choose an audio file first.");
    return;
  }
  if (!isAudioFile(file)) {
    sendText(response, 400, "Only audio uploads are allowed.");
    return;
  }

  const title = cleanField(parts.fields.title) || file.fileName.replace(/\.[^.]+$/, "");
  const duration = Number(parts.fields.duration || 15);
  const id = crypto.randomUUID();
  const extension = audioExtension(file);
  const storedFileName = `${Date.now()}-${slugify(title)}-${id.slice(0, 8)}${extension}`;
  const storedPath = join(UPLOAD_DIR, storedFileName);
  await writeFile(storedPath, file.data);

  const now = new Date().toISOString();
  const media = {
    id,
    title,
    duration,
    source: cleanField(parts.fields.source),
    permission: cleanField(parts.fields.permission) || "private-test",
    status: cleanField(parts.fields.status) || "draft",
    type: "audio",
    fileName: file.fileName,
    storedFileName,
    mimeType: file.mimeType || MIME_TYPES[extension] || "audio/mpeg",
    size: file.data.length,
    url: `/media/uploads/${encodeURIComponent(storedFileName)}`,
    downloadUrl: `/media/uploads/${encodeURIComponent(storedFileName)}`,
    createdAt: now,
    updatedAt: now
  };

  const catalog = await readCatalog();
  catalog.unshift(media);
  await writeCatalog(catalog);
  await sendJson(response, { media }, 201);
}

async function handlePatch(id, request, response) {
  const updates = JSON.parse((await readBody(request, 1024 * 1024)).toString("utf8") || "{}");
  const catalog = await readCatalog();
  const index = catalog.findIndex((item) => item.id === decodeURIComponent(id));
  if (index < 0) {
    sendText(response, 404, "Media item not found.");
    return;
  }

  const item = catalog[index];
  catalog[index] = {
    ...item,
    title: updates.title === undefined ? item.title : cleanField(updates.title),
    duration: updates.duration === undefined ? item.duration : Number(updates.duration),
    source: updates.source === undefined ? item.source : cleanField(updates.source),
    permission: updates.permission === undefined ? item.permission : cleanField(updates.permission),
    status: updates.status === undefined ? item.status : cleanField(updates.status),
    updatedAt: new Date().toISOString()
  };
  await writeCatalog(catalog);
  await sendJson(response, { media: catalog[index] });
}

async function handleDelete(id, response) {
  const catalog = await readCatalog();
  const index = catalog.findIndex((item) => item.id === decodeURIComponent(id));
  if (index < 0) {
    sendText(response, 404, "Media item not found.");
    return;
  }
  const [item] = catalog.splice(index, 1);
  await writeCatalog(catalog);
  if (item.storedFileName) {
    await rm(join(UPLOAD_DIR, item.storedFileName), { force: true });
  }
  await sendJson(response, { ok: true });
}

async function readCatalog() {
  try {
    const data = JSON.parse(await readFile(CATALOG_FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writeCatalog(catalog) {
  const tempFile = `${CATALOG_FILE}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(catalog, null, 2)}\n`);
  await rename(tempFile, CATALOG_FILE);
}

async function readAdmins() {
  try {
    const data = JSON.parse(await readFile(ADMINS_FILE, "utf8"));
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

async function writeAdmins(admins) {
  const tempFile = `${ADMINS_FILE}.tmp`;
  await writeFile(tempFile, `${JSON.stringify(admins, null, 2)}\n`);
  await rename(tempFile, ADMINS_FILE);
}

function makeAdmin({ name, role, passcode, recoveryCode = "" }) {
  const salt = crypto.randomBytes(16).toString("hex");
  const recoverySalt = recoveryCode ? crypto.randomBytes(16).toString("hex") : "";
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    role,
    salt,
    passHash: hashSecret(passcode, salt),
    recoverySalt,
    recoveryHash: recoveryCode ? hashSecret(recoveryCode, recoverySalt) : "",
    createdAt: now,
    updatedAt: now,
    lastLoginAt: ""
  };
}

function publicAdmins(admins) {
  return admins.map(publicAdmin);
}

function publicAdmin(admin) {
  return {
    id: admin.id,
    name: admin.name,
    role: admin.role,
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
    lastLoginAt: admin.lastLoginAt || "",
    passwordResetAt: admin.passwordResetAt || ""
  };
}

function requestIsOwner(body, admins) {
  const actor = admins.find((item) => item.id === cleanField(body.actorId));
  return Boolean(actor && actor.role === "owner");
}

function validPasscode(passcode) {
  return String(passcode || "").length >= 6;
}

function hashSecret(secret, salt) {
  return crypto.createHash("sha256").update(`${salt}:${secret}`).digest("hex");
}

function makeRecoveryCode() {
  return crypto.randomBytes(12).toString("base64url").replace(/(.{4})/g, "$1-").replace(/-$/, "");
}

async function serveStatic(pathname, request, response) {
  const decodedPath = decodeURIComponent(pathname);
  const requestedPath = decodedPath.endsWith("/")
    ? join(ROOT, decodedPath, "index.html")
    : join(ROOT, decodedPath);
  const filePath = safePath(requestedPath);
  if (!filePath) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const info = await stat(filePath);
    if (!info.isFile()) {
      sendText(response, 404, "Not found");
      return;
    }
    await sendFile(filePath, info, request, response);
  } catch {
    sendText(response, 404, "Not found");
  }
}

async function sendFile(filePath, info, request, response) {
  const type = MIME_TYPES[extname(filePath).toLowerCase()] || "application/octet-stream";
  const range = request.headers.range;
  response.setHeader("Content-Type", type);
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("Cache-Control", type.startsWith("audio/") ? "no-store" : "no-cache");

  if (range) {
    const match = range.match(/bytes=(\d*)-(\d*)/);
    const start = match?.[1] ? Number(match[1]) : 0;
    const end = match?.[2] ? Number(match[2]) : info.size - 1;
    if (start >= info.size || end >= info.size || start > end) {
      response.writeHead(416, { "Content-Range": `bytes */${info.size}` });
      response.end();
      return;
    }
    response.writeHead(206, {
      "Content-Length": end - start + 1,
      "Content-Range": `bytes ${start}-${end}/${info.size}`
    });
    if (request.method === "HEAD") {
      response.end();
      return;
    }
    createReadStream(filePath, { start, end }).pipe(response);
    return;
  }

  response.writeHead(200, { "Content-Length": info.size });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

function safePath(filePath) {
  const normalized = normalize(filePath);
  const rel = relative(ROOT, normalized);
  if (rel.startsWith("..") || rel.includes("..")) return "";
  return normalized;
}

function parseMultipart(buffer, boundary) {
  const delimiter = Buffer.from(`--${boundary}`);
  const headerDivider = Buffer.from("\r\n\r\n");
  const fields = {};
  const files = {};
  let cursor = buffer.indexOf(delimiter);

  while (cursor >= 0) {
    cursor += delimiter.length;
    if (buffer[cursor] === 45 && buffer[cursor + 1] === 45) break;
    if (buffer[cursor] === 13 && buffer[cursor + 1] === 10) cursor += 2;

    const headerEnd = buffer.indexOf(headerDivider, cursor);
    if (headerEnd < 0) break;
    const headers = buffer.slice(cursor, headerEnd).toString("utf8");
    const dataStart = headerEnd + headerDivider.length;
    const next = buffer.indexOf(delimiter, dataStart);
    if (next < 0) break;
    const dataEnd = buffer[next - 2] === 13 && buffer[next - 1] === 10 ? next - 2 : next;
    const data = buffer.slice(dataStart, dataEnd);

    const disposition = headers.match(/content-disposition:[^\n]+/i)?.[0] || "";
    const name = disposition.match(/name="([^"]+)"/)?.[1];
    const fileName = disposition.match(/filename="([^"]*)"/)?.[1];
    const mimeType = headers.match(/content-type:\s*([^\r\n]+)/i)?.[1]?.trim() || "";

    if (name && fileName) {
      files[name] = { fileName: fileName.split(/[\\/]/).pop(), mimeType, data };
    } else if (name) {
      fields[name] = data.toString("utf8");
    }

    cursor = next;
  }

  return { fields, files };
}

function readBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("Request body is too large."));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

async function readJsonBody(request) {
  const body = await readBody(request, 1024 * 1024);
  try {
    return JSON.parse(body.toString("utf8") || "{}");
  } catch {
    return {};
  }
}

async function sendJson(response, data, status = 200) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(data));
}

function sendText(response, status, text) {
  response.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(text);
}

function cleanField(value) {
  return String(value || "").trim();
}

function isAudioFile(file) {
  return file.mimeType.startsWith("audio/") || [".mp3", ".m4a", ".wav", ".aac", ".ogg", ".webm"].includes(extname(file.fileName).toLowerCase());
}

function audioExtension(file) {
  const fromName = extname(file.fileName).toLowerCase();
  if (fromName && MIME_TYPES[fromName]?.startsWith("audio/")) return fromName;
  if (file.mimeType === "audio/mpeg") return ".mp3";
  if (file.mimeType === "audio/mp4") return ".m4a";
  if (file.mimeType === "audio/wav") return ".wav";
  if (file.mimeType === "audio/ogg") return ".ogg";
  if (file.mimeType === "audio/webm") return ".webm";
  return ".audio";
}

function slugify(value) {
  return String(value || "audio")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "audio";
}
