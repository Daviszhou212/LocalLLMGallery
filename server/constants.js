const path = require("path");

const ROOT_DIR = path.resolve(__dirname, "..");
const PUBLIC_DIR = process.env.PUBLIC_DIR
  ? path.resolve(process.env.PUBLIC_DIR)
  : path.join(ROOT_DIR, "public");
const GALLERY_DIR = process.env.GALLERY_DIR
  ? path.resolve(process.env.GALLERY_DIR)
  : path.join(ROOT_DIR, "gallery");
const INDEX_FILE = process.env.GALLERY_INDEX_FILE
  ? path.resolve(process.env.GALLERY_INDEX_FILE)
  : path.join(GALLERY_DIR, "index.json");

const HOST = process.env.HOST || "127.0.0.1";
const PORT = Number(process.env.PORT || 8086);
const LOCAL_API_TOKEN = String(process.env.LOCAL_API_TOKEN || "").trim();
const ALLOW_INSECURE_LOCAL = String(process.env.ALLOW_INSECURE_LOCAL || "")
  .trim()
  .toLowerCase();
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 15000);
const IMAGE_FETCH_TIMEOUT_MS = Number(process.env.IMAGE_FETCH_TIMEOUT_MS || 15000);
const IMAGE_FETCH_MAX_BYTES = Number(process.env.IMAGE_FETCH_MAX_BYTES || 15 * 1024 * 1024);
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT || "20mb";
const WRITE_RATE_LIMIT_WINDOW_MS = Number(process.env.WRITE_RATE_LIMIT_WINDOW_MS || 60_000);
const WRITE_RATE_LIMIT_MAX = Number(process.env.WRITE_RATE_LIMIT_MAX || 60);

module.exports = {
  ROOT_DIR,
  PUBLIC_DIR,
  GALLERY_DIR,
  INDEX_FILE,
  HOST,
  PORT,
  LOCAL_API_TOKEN,
  ALLOW_INSECURE_LOCAL: ALLOW_INSECURE_LOCAL === "1" || ALLOW_INSECURE_LOCAL === "true",
  REQUEST_TIMEOUT_MS,
  IMAGE_FETCH_TIMEOUT_MS,
  IMAGE_FETCH_MAX_BYTES,
  JSON_BODY_LIMIT,
  WRITE_RATE_LIMIT_WINDOW_MS,
  WRITE_RATE_LIMIT_MAX,
};
