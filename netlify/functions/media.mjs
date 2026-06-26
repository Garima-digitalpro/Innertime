import { getStore } from "@netlify/blobs";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";
import {
  adminFromRequest,
  cleanField,
  env,
  handleError,
  json,
  readJson,
  requireAdmin,
  slugify,
  text
} from "./_shared/inner-time.mjs";

export const config = {
  path: ["/api/media", "/api/media/*"]
};

const MEDIA_STORE = "inner-time-media";
const MEDIA_KEY = "catalog.json";
const SIGNED_READ_SECONDS = 60 * 60 * 24 * 7;
const MAX_AUDIO_BYTES = 300 * 1024 * 1024;

export default async function handler(request) {
  try {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/api/media";

    if (path === "/api/media" && request.method === "GET") {
      return listMedia(request);
    }

    if (path === "/api/media/upload-url" && request.method === "POST") {
      return createUploadUrl(request);
    }

    if (path === "/api/media/complete-upload" && request.method === "POST") {
      return completeUpload(request);
    }

    const match = path.match(/^\/api\/media\/([^/]+)$/);
    if (match && request.method === "PATCH") {
      return patchMedia(match[1], request);
    }

    if (match && request.method === "DELETE") {
      return deleteMedia(match[1], request);
    }

    return text("Media API route not found.", 404);
  } catch (error) {
    return handleError(error, "Media API error.");
  }
}

async function listMedia(request) {
  const admin = await adminFromRequest(request);
  const catalog = await readCatalog();
  const visible = admin ? catalog : catalog.filter((item) => item.status === "published");
  return json({ media: await attachPlaybackUrls(visible, Boolean(admin)) });
}

async function createUploadUrl(request) {
  await requireAdmin(request);
  const body = await readJson(request);
  const fileName = cleanFileName(body.fileName || "audio.mp3");
  const mimeType = cleanField(body.mimeType) || "audio/mpeg";
  const size = Number(body.size || 0);
  const title = cleanField(body.title) || fileName.replace(/\.[^.]+$/, "");
  const duration = Number(body.duration || 15);

  if (!isAudioUpload({ fileName, mimeType })) {
    return text("Only audio uploads are allowed.", 400);
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_AUDIO_BYTES) {
    return text("Audio file size is not valid for this upload.", 400);
  }

  const id = crypto.randomUUID();
  const extension = audioExtension({ fileName, mimeType });
  const storagePath = [
    "uploads",
    `${duration}-minute`,
    `${Date.now()}-${slugify(title)}-${id.slice(0, 8)}${extension}`
  ].join("/");

  const { data, error } = await supabaseAdmin()
    .storage
    .from(storageBucket())
    .createSignedUploadUrl(storagePath, { upsert: false });

  if (error) {
    return text(error.message || "Could not create Supabase upload URL.", 500);
  }

  return json({
    upload: {
      id,
      bucket: storageBucket(),
      path: data?.path || storagePath,
      token: data?.token || "",
      signedUrl: data?.signedUrl || ""
    },
    supabase: {
      url: supabaseUrl(),
      anonKey: supabaseAnonKey()
    }
  });
}

async function completeUpload(request) {
  await requireAdmin(request);
  const body = await readJson(request);
  const now = new Date().toISOString();
  const media = normalizeMedia({
    ...body,
    id: cleanField(body.id) || crypto.randomUUID(),
    storagePath: cleanStoragePath(body.storagePath),
    createdAt: now,
    updatedAt: now
  });

  if (!media.storagePath) {
    return text("Uploaded storage path is required.", 400);
  }

  const signed = await createPlaybackUrl(media.storagePath);
  if (!signed) {
    return text("Supabase upload was not found after transfer.", 400);
  }

  media.url = "";
  media.downloadUrl = "";

  const catalog = await readCatalog();
  catalog.unshift(media);
  await writeCatalog(catalog);

  const [withUrl] = await attachPlaybackUrls([media], true);
  return json({ media: withUrl }, 201);
}

async function patchMedia(id, request) {
  await requireAdmin(request);
  const updates = await readJson(request);
  const catalog = await readCatalog();
  const index = catalog.findIndex((item) => item.id === decodeURIComponent(id));

  if (index < 0) {
    return text("Media item not found.", 404);
  }

  const item = catalog[index];
  catalog[index] = normalizeMedia({
    ...item,
    title: updates.title === undefined ? item.title : updates.title,
    duration: updates.duration === undefined ? item.duration : updates.duration,
    source: updates.source === undefined ? item.source : updates.source,
    permission: updates.permission === undefined ? item.permission : updates.permission,
    status: updates.status === undefined ? item.status : updates.status,
    updatedAt: new Date().toISOString()
  });

  await writeCatalog(catalog);
  const [withUrl] = await attachPlaybackUrls([catalog[index]], true);
  return json({ media: withUrl });
}

async function deleteMedia(id, request) {
  await requireAdmin(request);
  const catalog = await readCatalog();
  const index = catalog.findIndex((item) => item.id === decodeURIComponent(id));

  if (index < 0) {
    return text("Media item not found.", 404);
  }

  const [item] = catalog.splice(index, 1);
  await writeCatalog(catalog);

  if (item.storagePath) {
    await supabaseAdmin().storage.from(storageBucket()).remove([item.storagePath]);
  }

  return json({ ok: true });
}

async function attachPlaybackUrls(media, includeDownloadUrl = false) {
  const withUrls = [];
  for (const item of media) {
    const signedUrl = item.storagePath ? await createPlaybackUrl(item.storagePath) : item.url;
    withUrls.push({
      ...item,
      url: signedUrl || item.url || "",
      downloadUrl: includeDownloadUrl ? (signedUrl || item.downloadUrl || item.url || "") : ""
    });
  }
  return withUrls;
}

async function createPlaybackUrl(storagePath) {
  const { data, error } = await supabaseAdmin()
    .storage
    .from(storageBucket())
    .createSignedUrl(storagePath, SIGNED_READ_SECONDS, { download: false });

  if (error) return "";
  return data?.signedUrl || "";
}

async function readCatalog() {
  const store = getStore({ name: MEDIA_STORE, consistency: "strong" });
  const catalog = (await store.get(MEDIA_KEY, { type: "json" })) || [];
  return Array.isArray(catalog) ? catalog : [];
}

async function writeCatalog(catalog) {
  const store = getStore({ name: MEDIA_STORE, consistency: "strong" });
  await store.setJSON(MEDIA_KEY, catalog);
}

function normalizeMedia(item) {
  return {
    id: cleanField(item.id),
    title: cleanField(item.title),
    duration: Number(item.duration || 15),
    source: cleanField(item.source),
    permission: cleanField(item.permission) || "private-test",
    status: ["published", "draft"].includes(cleanField(item.status)) ? cleanField(item.status) : "draft",
    type: "audio",
    fileName: cleanFileName(item.fileName || "audio.mp3"),
    storedFileName: "",
    storagePath: cleanStoragePath(item.storagePath),
    mimeType: cleanField(item.mimeType) || "audio/mpeg",
    size: Number(item.size || 0),
    url: "",
    downloadUrl: "",
    createdAt: item.createdAt || new Date().toISOString(),
    updatedAt: item.updatedAt || new Date().toISOString()
  };
}

function supabaseAdmin() {
  const url = supabaseUrl();
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) {
    throw Object.assign(new Error("Supabase URL and service role key must be set in Netlify."), { status: 500 });
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

function supabaseUrl() {
  return env("SUPABASE_URL");
}

function supabaseAnonKey() {
  const anonKey = env("SUPABASE_ANON_KEY");
  if (!anonKey) {
    throw Object.assign(new Error("Supabase anon key must be set in Netlify."), { status: 500 });
  }
  return anonKey;
}

function storageBucket() {
  return env("SUPABASE_STORAGE_BUCKET", "inner-time-audio");
}

function isAudioUpload(file) {
  return String(file.mimeType || "").startsWith("audio/") || /\.(aac|m4a|mp3|ogg|wav|webm)$/i.test(file.fileName || "");
}

function audioExtension(file) {
  const nameMatch = String(file.fileName || "").match(/\.(aac|m4a|mp3|ogg|wav|webm)$/i);
  if (nameMatch) return `.${nameMatch[1].toLowerCase()}`;
  const mime = String(file.mimeType || "").toLowerCase();
  if (mime.includes("mpeg")) return ".mp3";
  if (mime.includes("mp4")) return ".m4a";
  if (mime.includes("ogg")) return ".ogg";
  if (mime.includes("wav")) return ".wav";
  if (mime.includes("webm")) return ".webm";
  return ".mp3";
}

function cleanFileName(value) {
  return String(value || "audio.mp3")
    .split(/[\\/]/)
    .pop()
    .replace(/[^\w.\- ()]+/g, "")
    .slice(0, 120) || "audio.mp3";
}

function cleanStoragePath(value) {
  const path = String(value || "").replace(/^\/+/, "");
  if (!path || path.includes("..") || !path.startsWith("uploads/")) return "";
  return path;
}
