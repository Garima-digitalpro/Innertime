import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";

export const MAX_ADMINS = 10;

const ADMIN_STORE = "inner-time-admins";
const ADMINS_KEY = "admins.json";

export function env(name, fallback = "") {
  return globalThis.Netlify?.env?.get?.(name) || process.env[name] || fallback;
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export function text(message, status = 400) {
  return new Response(message, {
    status,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

export async function readJson(request, maxBytes = 1024 * 1024) {
  const body = await request.text();
  if (body.length > maxBytes) throw new Error("Request body is too large.");
  return body ? JSON.parse(body) : {};
}

export async function readAdmins() {
  const store = getStore({ name: ADMIN_STORE, consistency: "strong" });
  const admins = (await store.get(ADMINS_KEY, { type: "json" })) || [];
  const normalized = Array.isArray(admins) ? admins : [];
  if (!normalized.length) {
    return provisionOwner(store);
  }
  return normalized;
}

export async function writeAdmins(admins) {
  const store = getStore({ name: ADMIN_STORE, consistency: "strong" });
  await store.setJSON(ADMINS_KEY, admins);
}

export async function provisionOwner(store = getStore({ name: ADMIN_STORE, consistency: "strong" })) {
  const ownerName = cleanField(env("INNER_TIME_OWNER_NAME", "Garima")) || "Garima";
  const ownerPasscode = String(env("INNER_TIME_OWNER_PASSCODE"));
  if (!validPasscode(ownerPasscode)) {
    return [];
  }

  const owner = makeAdmin({
    name: ownerName,
    role: "owner",
    passcode: ownerPasscode
  });
  await store.setJSON(ADMINS_KEY, [owner]);
  return [owner];
}

export function makeAdmin({ name, role, passcode }) {
  const salt = crypto.randomBytes(16).toString("hex");
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    name,
    role,
    salt,
    passHash: hashSecret(passcode, salt),
    createdAt: now,
    updatedAt: now,
    lastLoginAt: ""
  };
}

export function publicAdmins(admins) {
  return admins.map(publicAdmin);
}

export function publicAdmin(admin) {
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

export function validPasscode(passcode) {
  return typeof passcode === "string" && passcode.length >= 6;
}

export function hashSecret(secret, salt) {
  return crypto.createHash("sha256").update(`${salt}:${secret}`).digest("hex");
}

export function cleanField(value) {
  return String(value || "").trim().replace(/\s+/g, " ").slice(0, 240);
}

export function signAdminSession(admin) {
  const secret = sessionSecret();
  const payload = {
    id: admin.id,
    role: admin.role,
    name: admin.name,
    exp: Date.now() + 1000 * 60 * 60 * 12
  };
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = hmac(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

export async function adminFromRequest(request) {
  const token = bearerToken(request);
  if (!token) return null;

  const payload = verifyAdminToken(token);
  if (!payload) return null;

  const admins = await readAdmins();
  const admin = admins.find((item) => item.id === payload.id);
  if (!admin) return null;
  return admin;
}

export async function requireAdmin(request) {
  const admin = await adminFromRequest(request);
  if (!admin) throw Object.assign(new Error("Admin login required."), { status: 401 });
  return admin;
}

export async function requireOwner(request) {
  const admin = await requireAdmin(request);
  if (admin.role !== "owner") {
    throw Object.assign(new Error("Only the prime owner can manage admins."), { status: 403 });
  }
  return admin;
}

export function handleError(error, fallback = "Server error.") {
  return text(error?.message || fallback, error?.status || 500);
}

export function slugify(value) {
  return String(value || "inner-time-audio")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "inner-time-audio";
}

function bearerToken(request) {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1] || "";
}

function verifyAdminToken(token) {
  const [encodedPayload, signature] = String(token || "").split(".");
  if (!encodedPayload || !signature) return null;
  const expected = hmac(encodedPayload, sessionSecret());
  if (!constantEqual(signature, expected)) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
    if (!payload?.id || Number(payload.exp) < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function sessionSecret() {
  return env("INNER_TIME_SESSION_SECRET") || env("SUPABASE_SERVICE_ROLE_KEY") || env("NETLIFY_SITE_ID") || "inner-time-local-session-secret";
}

function hmac(value, secret) {
  return crypto.createHmac("sha256", secret).update(value).digest("base64url");
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function constantEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}
