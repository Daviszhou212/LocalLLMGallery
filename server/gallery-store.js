const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");

const { GALLERY_DIR, INDEX_FILE } = require("./constants");
const { AppError } = require("./errors");

let writeQueue = Promise.resolve();
let queuedWrites = 0;

async function ensureStore() {
  await fs.mkdir(GALLERY_DIR, { recursive: true });
  try {
    await fs.access(INDEX_FILE);
  } catch {
    await fs.writeFile(INDEX_FILE, "[]\n", "utf8");
  }
}

async function readIndexUnsafe() {
  await ensureStore();
  const raw = await fs.readFile(INDEX_FILE, "utf8");
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    await backupCorruptedIndex(raw);
    throw new AppError(500, "画廊索引文件已损坏，请修复后重试。", {
      code: "INDEX_CORRUPTED",
    });
  }
}

async function writeIndexUnsafe(items) {
  await ensureStore();
  const tmp = `${INDEX_FILE}.tmp`;
  const body = JSON.stringify(items, null, 2);
  await fs.writeFile(tmp, `${body}\n`, "utf8");
  await fs.rename(tmp, INDEX_FILE);
}

async function backupCorruptedIndex(rawText) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = `${INDEX_FILE}.bak-${timestamp}`;
  try {
    await fs.writeFile(backupPath, String(rawText || ""), "utf8");
  } catch {
    // Ignore backup failures to preserve original parse exception.
  }
}

function withWriteLock(task) {
  queuedWrites += 1;
  const run = writeQueue.then(task);
  writeQueue = run
    .catch(() => undefined)
    .finally(() => {
      queuedWrites = Math.max(queuedWrites - 1, 0);
    });
  return run;
}

function getWriteLockQueueDepth() {
  return queuedWrites;
}

async function readIndex() {
  return readIndexUnsafe();
}

async function writeIndex(items) {
  return withWriteLock(async () => {
    await writeIndexUnsafe(items);
  });
}

function buildFilename(ext) {
  const now = new Date();
  const ts = [
    now.getFullYear().toString(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "-",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
  const suffix = crypto.randomBytes(3).toString("hex");
  return `${ts}-${suffix}.${sanitizeExt(ext)}`;
}

function createId() {
  return `${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

function sanitizeExt(ext) {
  const safe = String(ext || "png")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!safe || safe.length > 5) {
    return "png";
  }
  return safe;
}

function buildPublicPath(filename) {
  return `/gallery/${encodeURIComponent(filename)}`;
}

async function saveImageEntry({ buffer, ext, prompt, model, source, originKey }) {
  if (!Buffer.isBuffer(buffer) || buffer.length <= 0) {
    throw new AppError(422, "图片内容为空或格式不合法。", { code: "EMPTY_IMAGE" });
  }

  return withWriteLock(async () => {
    const items = await readIndexUnsafe();
    const duplicated = originKey ? items.find((item) => item.originKey === originKey) : null;
    if (duplicated) {
      return { item: duplicated, duplicated: true };
    }

    const filename = buildFilename(ext);
    const filePath = path.join(GALLERY_DIR, filename);
    await fs.writeFile(filePath, buffer);

    const item = {
      id: createId(),
      filename,
      path: buildPublicPath(filename),
      prompt: prompt || "",
      model: model || "",
      source: source || "",
      originKey: originKey || "",
      size: buffer.length,
      createdAt: new Date().toISOString(),
    };

    const next = [item, ...items];
    await writeIndexUnsafe(next);
    return { item, duplicated: false };
  });
}

async function deleteImageEntry(id) {
  return withWriteLock(async () => {
    const items = await readIndexUnsafe();
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) {
      return false;
    }

    const [removed] = items.splice(index, 1);
    await writeIndexUnsafe(items);

    const filePath = path.join(GALLERY_DIR, removed.filename);
    try {
      await fs.unlink(filePath);
    } catch {
      // File may have been removed manually, keep index consistent.
    }

    return true;
  });
}

function toClientItem(item, origin) {
  const url = `${origin}${item.path}`;
  return {
    id: item.id,
    filename: item.filename,
    url,
    path: item.path,
    prompt: item.prompt || "",
    model: item.model || "",
    source: item.source || "",
    size: item.size || 0,
    createdAt: item.createdAt || "",
  };
}

function pad(num) {
  return String(num).padStart(2, "0");
}

module.exports = {
  ensureStore,
  readIndex,
  writeIndex,
  saveImageEntry,
  deleteImageEntry,
  toClientItem,
  getWriteLockQueueDepth,
};
