const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

function clearModule(modulePath) {
  delete require.cache[require.resolve(modulePath)];
}

function loadStoreModule(testDir) {
  process.env.GALLERY_DIR = testDir;
  process.env.GALLERY_INDEX_FILE = path.join(testDir, "index.json");

  clearModule("../server/constants");
  clearModule("../server/gallery-store");

  return require("../server/gallery-store");
}

test("gallery-store: concurrent save should not lose entries", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "img-gallery-"));
  const store = loadStoreModule(dir);

  const tasks = Array.from({ length: 40 }, (_, index) =>
    store.saveImageEntry({
      buffer: Buffer.from(`image-${index}`),
      ext: "png",
      prompt: `prompt-${index}`,
      model: "test-model",
      source: "test",
      originKey: `origin-${index}`,
    })
  );
  await Promise.all(tasks);

  const items = await store.readIndex();
  assert.equal(items.length, 40);
  await fs.rm(dir, { recursive: true, force: true });
});

test("gallery-store: corrupted index should create backup", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "img-gallery-broken-"));
  const indexFile = path.join(dir, "index.json");
  await fs.writeFile(indexFile, "{not-json}", "utf8");

  const store = loadStoreModule(dir);

  await assert.rejects(() => store.readIndex(), /损坏/);

  const files = await fs.readdir(dir);
  const backup = files.find((item) => item.startsWith("index.json.bak-"));
  assert.ok(backup, "should create backup file when index is corrupted");
  await fs.rm(dir, { recursive: true, force: true });
});
