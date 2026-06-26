import crypto from "node:crypto";
import {
  cleanField,
  handleError,
  hashSecret,
  json,
  makeAdmin,
  MAX_ADMINS,
  publicAdmin,
  publicAdmins,
  readAdmins,
  readJson,
  requireAdmin,
  requireOwner,
  signAdminSession,
  text,
  validPasscode,
  writeAdmins
} from "./_shared/inner-time.mjs";

export const config = {
  path: ["/api/admins", "/api/admins/*"]
};

export default async function handler(request) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/api/admins";

    if (path === "/api/admins/bootstrap" && request.method === "GET") {
      const admins = await readAdmins();
      return json({ hasAdmins: admins.length > 0, maxAdmins: MAX_ADMINS });
    }

    if (path === "/api/admins/bootstrap" && request.method === "POST") {
      return text("Public owner setup is disabled. The prime admin is provisioned from Netlify environment variables.", 403);
    }

    if (path === "/api/admins/recover" && request.method === "POST") {
      return text("Prime owner recovery is deployment-controlled. Reset the owner passcode in Netlify environment variables.", 403);
    }

    if (path === "/api/admins/login" && request.method === "POST") {
      return loginAdmin(request);
    }

    if (path === "/api/admins" && request.method === "GET") {
      await requireAdmin(request);
      return json({ admins: publicAdmins(await readAdmins()), maxAdmins: MAX_ADMINS });
    }

    if (path === "/api/admins" && request.method === "POST") {
      return createAdmin(request);
    }

    const match = path.match(/^\/api\/admins\/([^/]+)$/);
    if (match && request.method === "PATCH") {
      return resetAdminPasscode(match[1], request);
    }

    if (match && request.method === "DELETE") {
      return removeAdmin(match[1], request);
    }

    return text("Admin API route not found.", 404);
  } catch (error) {
    return handleError(error, "Admin API error.");
  }
}

async function loginAdmin(request) {
  const body = await readJson(request);
  const name = cleanField(body.name);
  const passcode = String(body.passcode || "");
  const admins = await readAdmins();
  const admin = admins.find((item) => item.name.toLowerCase() === name.toLowerCase());

  if (!admin || admin.passHash !== hashSecret(passcode, admin.salt)) {
    return text("Admin name or passcode did not match.", 401);
  }

  admin.lastLoginAt = new Date().toISOString();
  await writeAdmins(admins);
  return json({ admin: publicAdmin(admin), token: signAdminSession(admin) });
}

async function createAdmin(request) {
  await requireOwner(request);
  const body = await readJson(request);
  const admins = await readAdmins();

  if (admins.length >= MAX_ADMINS) {
    return text(`Maximum ${MAX_ADMINS} admins allowed.`, 400);
  }

  const name = cleanField(body.name);
  if (!name) {
    return text("Admin name is required.", 400);
  }
  if (admins.some((item) => item.name.toLowerCase() === name.toLowerCase())) {
    return text("Admin name already exists.", 400);
  }
  if (!validPasscode(body.passcode)) {
    return text("Passcode must be at least 6 characters.", 400);
  }

  const admin = makeAdmin({ name, role: "admin", passcode: body.passcode });
  admins.push(admin);
  await writeAdmins(admins);
  return json({ admin: publicAdmin(admin) }, 201);
}

async function resetAdminPasscode(id, request) {
  await requireOwner(request);
  const body = await readJson(request);
  const admins = await readAdmins();
  const admin = admins.find((item) => item.id === decodeURIComponent(id));

  if (!admin) {
    return text("Admin not found.", 404);
  }
  if (!validPasscode(body.passcode)) {
    return text("New passcode must be at least 6 characters.", 400);
  }

  admin.salt = crypto.randomBytes(16).toString("hex");
  admin.passHash = hashSecret(body.passcode, admin.salt);
  admin.passwordResetAt = new Date().toISOString();
  admin.updatedAt = admin.passwordResetAt;
  await writeAdmins(admins);
  return json({ admin: publicAdmin(admin) });
}

async function removeAdmin(id, request) {
  await requireOwner(request);
  const admins = await readAdmins();
  const index = admins.findIndex((item) => item.id === decodeURIComponent(id));

  if (index < 0) {
    return text("Admin not found.", 404);
  }
  if (admins[index].role === "owner") {
    return text("Prime owner cannot be removed.", 400);
  }

  admins.splice(index, 1);
  await writeAdmins(admins);
  return json({ ok: true });
}
