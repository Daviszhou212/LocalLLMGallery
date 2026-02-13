const test = require("node:test");
const assert = require("node:assert/strict");

const { parseDataImage, fetchRemoteImage } = require("../server/image-fetcher");

test("parseDataImage: invalid data url should throw", () => {
  assert.throws(() => parseDataImage("data:text/plain;base64,Zm9v"), /dataUrl 格式不合法/);
});

test("fetchRemoteImage: should reject oversized response", async () => {
  const fetchImpl = async () =>
    new Response(Buffer.alloc(1024), {
      status: 200,
      headers: {
        "content-type": "image/png",
      },
    });

  await assert.rejects(
    () =>
      fetchRemoteImage("http://example.com/a.png", {
        fetchImpl,
        maxBytes: 100,
      }),
    /超过限制/
  );
});

test("fetchRemoteImage: should reject non-image content-type", async () => {
  const fetchImpl = async () =>
    new Response("hello", {
      status: 200,
      headers: {
        "content-type": "text/plain",
      },
    });

  await assert.rejects(
    () => fetchRemoteImage("http://example.com/a.txt", { fetchImpl }),
    /不是图片/
  );
});

test("fetchRemoteImage: should timeout", async () => {
  const fetchImpl = (_url, options) =>
    new Promise((_, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    });

  await assert.rejects(
    () =>
      fetchRemoteImage("http://example.com/a.png", {
        fetchImpl,
        timeoutMs: 10,
      }),
    /超时/
  );
});
