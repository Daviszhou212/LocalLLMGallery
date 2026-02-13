const crypto = require("crypto");
const net = require("net");
const { URL } = require("url");

const { AppError, toErrorMessage } = require("./errors");

const MIME_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
  "image/svg+xml": "svg",
};

function parseDataImage(dataUrl) {
  const text = String(dataUrl || "").trim();
  const matched = text.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!matched) {
    throw new AppError(422, "dataUrl 格式不合法，必须是 data:image/*;base64,...", {
      code: "INVALID_DATA_URL",
    });
  }

  const mime = matched[1].toLowerCase();
  const base64 = matched[2].replace(/\s/g, "");
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) {
    throw new AppError(422, "dataUrl 解码后为空。", { code: "EMPTY_DATA_URL" });
  }

  return {
    buffer,
    ext: extensionFromMime(mime),
    originKey: `data:${sha1(buffer)}`,
  };
}

async function fetchRemoteImage(imageUrl, options = {}) {
  const fetchImpl = typeof options.fetchImpl === "function" ? options.fetchImpl : global.fetch;
  if (typeof fetchImpl !== "function") {
    throw new AppError(500, "当前 Node 版本不支持 fetch。", { code: "FETCH_NOT_AVAILABLE" });
  }

  const timeoutMs = normalizeLimit(options.timeoutMs, 15000);
  const maxBytes = normalizeLimit(options.maxBytes, 15 * 1024 * 1024);
  const maxRedirects = normalizeLimit(options.maxRedirects, 3);
  const originUrl = normalizeHttpUrl(imageUrl);
  const candidates = buildCandidateUrls(originUrl);
  const errors = [];

  for (const candidate of candidates) {
    try {
      const fetched = await fetchImageBytes(candidate, {
        fetchImpl,
        timeoutMs,
        maxBytes,
        maxRedirects,
      });
      const ext =
        extensionFromMime(fetched.contentType) ||
        extensionFromUrl(candidate) ||
        extensionFromUrl(originUrl) ||
        "png";

      return {
        buffer: fetched.buffer,
        ext,
        originKey: `url:${originUrl}`,
      };
    } catch (error) {
      errors.push(`${candidate} -> ${toErrorMessage(error)}`);
    }
  }

  throw new AppError(502, `下载图片失败：${errors.join("; ")}`, {
    code: "REMOTE_IMAGE_FETCH_FAILED",
  });
}

function normalizeHttpUrl(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    throw new AppError(400, "imageUrl 不能为空。", { code: "MISSING_IMAGE_URL" });
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new AppError(400, "imageUrl 不是合法 URL。", { code: "INVALID_IMAGE_URL" });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError(400, "imageUrl 仅支持 http/https 协议。", {
      code: "INVALID_IMAGE_PROTOCOL",
    });
  }

  if (parsed.username || parsed.password) {
    throw new AppError(400, "imageUrl 不允许包含用户名或密码。", { code: "UNSAFE_IMAGE_URL" });
  }

  if (isBlockedHost(parsed.hostname)) {
    throw new AppError(403, "imageUrl 指向了受限地址。", { code: "BLOCKED_IMAGE_HOST" });
  }

  return parsed.toString();
}

function buildCandidateUrls(originUrl) {
  const candidates = [originUrl];
  const parsed = new URL(originUrl);

  // Some local OpenAI-compatible backends return file URLs on :9000 while assets are actually reachable on :8000.
  if (isLocalHost(parsed.hostname) && parsed.port === "9000") {
    const fallback = new URL(originUrl);
    fallback.port = "8000";
    candidates.push(fallback.toString());
  }

  return Array.from(new Set(candidates));
}

async function fetchImageBytes(originUrl, options) {
  const { fetchImpl, timeoutMs, maxBytes, maxRedirects } = options;
  let currentUrl = originUrl;
  const visited = new Set([currentUrl]);

  for (let step = 0; step <= maxRedirects; step += 1) {
    const response = await fetchWithTimeout(fetchImpl, currentUrl, timeoutMs);

    if (isRedirectStatus(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new AppError(502, "上游返回重定向但缺少 location。", {
          code: "REDIRECT_WITHOUT_LOCATION",
        });
      }
      const nextUrl = normalizeHttpUrl(new URL(location, currentUrl).toString());
      if (visited.has(nextUrl)) {
        throw new AppError(502, "检测到循环重定向。", { code: "REDIRECT_LOOP" });
      }
      visited.add(nextUrl);
      currentUrl = nextUrl;
      continue;
    }

    if (!response.ok) {
      throw new AppError(mapUpstreamStatus(response.status), `HTTP ${response.status}`, {
        code: "UPSTREAM_HTTP_ERROR",
      });
    }

    const contentTypeRaw = (response.headers.get("content-type") || "").toLowerCase();
    const contentType = contentTypeRaw.split(";")[0].trim();
    if (contentType && !contentType.startsWith("image/")) {
      throw new AppError(422, `远端资源不是图片，content-type=${contentType}`, {
        code: "UNSUPPORTED_CONTENT_TYPE",
      });
    }

    const contentLength = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(contentLength) && contentLength > 0 && contentLength > maxBytes) {
      throw new AppError(413, `图片体积超过限制（${maxBytes} bytes）。`, {
        code: "IMAGE_TOO_LARGE",
      });
    }

    const buffer = await readBodyLimited(response, maxBytes);
    if (!buffer.length) {
      throw new AppError(422, "响应内容为空。", { code: "EMPTY_IMAGE_RESPONSE" });
    }

    return {
      buffer,
      contentType,
    };
  }

  throw new AppError(502, "重定向次数超过限制。", { code: "TOO_MANY_REDIRECTS" });
}

async function fetchWithTimeout(fetchImpl, url, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
      headers: {
        accept: "image/*",
      },
    });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new AppError(504, `请求图片超时（${timeoutMs}ms）。`, { code: "IMAGE_FETCH_TIMEOUT" });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readBodyLimited(response, maxBytes) {
  if (!response.body) {
    return Buffer.alloc(0);
  }

  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  let finished = false;
  while (!finished) {
    const { done, value } = await reader.read();
    if (done) {
      finished = true;
      continue;
    }
    const chunk = Buffer.from(value);
    received += chunk.length;
    if (received > maxBytes) {
      throw new AppError(413, `图片体积超过限制（${maxBytes} bytes）。`, {
        code: "IMAGE_TOO_LARGE",
      });
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function isRedirectStatus(status) {
  return status >= 300 && status < 400;
}

function mapUpstreamStatus(status) {
  if (status >= 500) {
    return 502;
  }
  if (status === 408) {
    return 504;
  }
  return 400;
}

function normalizeLimit(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function isBlockedHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host) {
    return true;
  }
  if (host === "0.0.0.0" || host === "::" || host === "[::]") {
    return true;
  }
  if (host === "169.254.169.254" || host === "metadata.google.internal") {
    return true;
  }

  const ipVersion = net.isIP(host);
  if (!ipVersion) {
    return false;
  }
  if (ipVersion === 4) {
    return isBlockedIPv4(host);
  }
  return isBlockedIPv6(host);
}

function isBlockedIPv4(ip) {
  if (ip === "255.255.255.255") {
    return true;
  }
  const parts = ip.split(".").map((part) => Number(part));
  if (parts.some((part) => !Number.isFinite(part))) {
    return true;
  }
  const [a, b] = parts;
  if (a === 0) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  return false;
}

function isBlockedIPv6(ip) {
  const text = ip.toLowerCase();
  return text === "::" || text === "::ffff:0.0.0.0";
}

function isLocalHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "127.0.0.1" || host === "localhost";
}

function extensionFromMime(mime) {
  return MIME_EXT[String(mime || "").toLowerCase()] || "png";
}

function extensionFromUrl(url) {
  const clean = String(url).split("?")[0];
  const tail = clean.split("/").pop() || "";
  const ext = tail.includes(".") ? tail.split(".").pop().toLowerCase() : "";
  if (!ext || ext.length > 5 || /[^a-z0-9]/.test(ext)) {
    return "";
  }
  return ext;
}

function sha1(buffer) {
  return crypto.createHash("sha1").update(buffer).digest("hex");
}

module.exports = {
  parseDataImage,
  fetchRemoteImage,
};
