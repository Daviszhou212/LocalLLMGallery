const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const request = require("supertest");

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function loadApp(testDir, env = {}) {
  process.env.GALLERY_DIR = testDir;
  process.env.GALLERY_INDEX_FILE = path.join(testDir, "index.json");
  process.env.LOCAL_API_TOKEN = env.LOCAL_API_TOKEN || "";
  process.env.ALLOW_INSECURE_LOCAL = env.ALLOW_INSECURE_LOCAL || "";
  process.env.PUBLIC_DIR = path.resolve("public");

  clearModule("../server/constants");
  clearModule("../server/gallery-store");
  clearModule("../server/index");

  const { createApp } = require("../server/index");
  return createApp();
}

test("api: health should include queue depth and uptime", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "img-api-health-"));
  const app = loadApp(dir);
  const res = await request(app).get("/api/health");

  assert.equal(res.status, 200);
  assert.equal(typeof res.body.storeReady, "boolean");
  assert.equal(typeof res.body.writeLockQueueDepth, "number");
  assert.equal(typeof res.body.uptimeSec, "number");
  await fs.rm(dir, { recursive: true, force: true });
});

test("api: write endpoint should require local token when configured", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "img-api-token-"));
  const app = loadApp(dir, { LOCAL_API_TOKEN: "abc123" });

  const res = await request(app).post("/api/gallery/save").send({
    dataUrl: "data:image/png;base64,aGVsbG8=",
    prompt: "p",
  });

  assert.equal(res.status, 401);
  assert.equal(res.body.code, "LOCAL_TOKEN_MISSING");
  await fs.rm(dir, { recursive: true, force: true });
});

test("api: save should reject payload when imageUrl and dataUrl both provided", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "img-api-payload-"));
  const app = loadApp(dir, { LOCAL_API_TOKEN: "abc123" });

  const res = await request(app).post("/api/gallery/save").set("x-local-token", "abc123").send({
    imageUrl: "http://example.com/a.png",
    dataUrl: "data:image/png;base64,aGVsbG8=",
    prompt: "p",
  });

  assert.equal(res.status, 400);
  assert.equal(res.body.code, "INVALID_IMAGE_PAYLOAD");
  await fs.rm(dir, { recursive: true, force: true });
});
