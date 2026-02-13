const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");

const {
  PUBLIC_DIR,
  GALLERY_DIR,
  HOST,
  PORT,
  LOCAL_API_TOKEN,
  ALLOW_INSECURE_LOCAL,
  REQUEST_TIMEOUT_MS,
  IMAGE_FETCH_TIMEOUT_MS,
  IMAGE_FETCH_MAX_BYTES,
  JSON_BODY_LIMIT,
  WRITE_RATE_LIMIT_WINDOW_MS,
  WRITE_RATE_LIMIT_MAX,
} = require("./constants");
const {
  ensureStore,
  readIndex,
  saveImageEntry,
  deleteImageEntry,
  toClientItem,
  getWriteLockQueueDepth,
} = require("./gallery-store");
const { parseDataImage, fetchRemoteImage } = require("./image-fetcher");
const { AppError, toHttpError, toErrorMessage } = require("./errors");

const SERVER_START_AT = Date.now();
const LOCAL_TOKEN_HEADER = "x-local-token";

function createApp() {
  const app = express();
  const writeRateLimiter = createRateLimiter({
    windowMs: WRITE_RATE_LIMIT_WINDOW_MS,
    max: WRITE_RATE_LIMIT_MAX,
  });

  app.disable("x-powered-by");
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || isAllowedLocalOrigin(origin)) {
          return callback(null, true);
        }
        return callback(
          new AppError(403, `不允许的跨域来源：${origin}`, { code: "CORS_ORIGIN_DENIED" })
        );
      },
      credentials: false,
    })
  );
  app.use(morgan("dev"));
  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  app.get("/api/health", async (_req, res, next) => {
    try {
      await ensureStore();
      res.json({
        ok: true,
        storeReady: true,
        writeLockQueueDepth: getWriteLockQueueDepth(),
        uptimeSec: Math.floor((Date.now() - SERVER_START_AT) / 1000),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/models/fetch", requireLocalToken, writeRateLimiter, async (req, res, next) => {
    try {
      const baseUrl = normalizeBaseUrl(req.body?.baseUrl);
      const apiKey = limitText(req.body?.apiKey, 512, "apiKey");
      const endpoint = `${baseUrl}/models`;
      const headers = {};
      if (apiKey) {
        headers.Authorization = `Bearer ${apiKey}`;
      }

      const response = await fetchWithTimeout(endpoint, {
        method: "GET",
        headers,
      });
      const payload = await parseJsonOrText(response);
      if (!response.ok) {
        const detail = pickError(payload);
        throw new AppError(
          mapUpstreamStatus(response.status),
          detail || `拉取模型失败，HTTP ${response.status}`,
          {
            code: "MODEL_FETCH_FAILED",
          }
        );
      }

      const models = Array.isArray(payload?.data)
        ? payload.data
            .map((item) => (item && typeof item.id === "string" ? item.id.trim() : ""))
            .filter(Boolean)
        : [];

      return res.json({
        ok: true,
        models: unique(models),
        endpoint,
        total: models.length,
      });
    } catch (error) {
      return next(error);
    }
  });

  app.get("/api/gallery/list", async (req, res, next) => {
    try {
      const items = await readIndex();
      const origin = `${req.protocol}://${req.get("host")}`;
      const result = items.map((item) => toClientItem(item, origin));
      res.json({ ok: true, items: result });
    } catch (error) {
      next(error);
    }
  });

  app.post("/api/gallery/save", requireLocalToken, writeRateLimiter, async (req, res, next) => {
    try {
      const imageUrl = limitText(req.body?.imageUrl, 2048, "imageUrl");
      const dataUrl = limitText(req.body?.dataUrl, 20 * 1024 * 1024, "dataUrl");
      const prompt = limitText(req.body?.prompt, 4000, "prompt");
      const model = limitText(req.body?.model, 200, "model");
      const source = limitText(req.body?.source, 200, "source");

      if ((imageUrl && dataUrl) || (!imageUrl && !dataUrl)) {
        throw new AppError(400, "imageUrl 与 dataUrl 必须二选一。", {
          code: "INVALID_IMAGE_PAYLOAD",
        });
      }

      const parsed = dataUrl
        ? parseDataImage(dataUrl)
        : await fetchRemoteImage(imageUrl, {
            timeoutMs: IMAGE_FETCH_TIMEOUT_MS,
            maxBytes: IMAGE_FETCH_MAX_BYTES,
          });

      const saved = await saveImageEntry({
        buffer: parsed.buffer,
        ext: parsed.ext,
        prompt,
        model,
        source,
        originKey: parsed.originKey,
      });

      const origin = `${req.protocol}://${req.get("host")}`;
      return res.json({
        ok: true,
        duplicated: saved.duplicated,
        item: toClientItem(saved.item, origin),
      });
    } catch (error) {
      return next(error);
    }
  });

  app.delete("/api/gallery/:id", requireLocalToken, writeRateLimiter, async (req, res, next) => {
    try {
      const id = limitText(req.params.id, 200, "id");
      if (!id) {
        throw new AppError(400, "id 不能为空。", { code: "MISSING_ID" });
      }

      const removed = await deleteImageEntry(id);
      if (!removed) {
        throw new AppError(404, "目标不存在或已删除。", { code: "GALLERY_ITEM_NOT_FOUND" });
      }

      return res.json({ ok: true });
    } catch (error) {
      return next(error);
    }
  });

  app.use("/gallery", express.static(GALLERY_DIR, { fallthrough: true }));
  app.use(express.static(PUBLIC_DIR, { fallthrough: true }));

  app.get("/", (_req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, "index.html"));
  });

  app.use((req, res) => {
    res
      .status(404)
      .json({ ok: false, code: "NOT_FOUND", message: `未找到路由：${req.method} ${req.path}` });
  });

  app.use((error, _req, res, _next) => {
    if (isBodyTooLargeError(error)) {
      return res.status(413).json({
        ok: false,
        code: "PAYLOAD_TOO_LARGE",
        message: `请求体过大，请控制在 ${JSON_BODY_LIMIT} 以内。`,
      });
    }

    const httpError = toHttpError(error);
    return res.status(httpError.status).json({
      ok: false,
      code: httpError.code || "UNKNOWN_ERROR",
      message: httpError.message,
    });
  });

  return app;
}

function startServer() {
  const app = createApp();
  app.listen(PORT, HOST, async () => {
    await ensureStore();
    console.log(`Server started at http://${HOST}:${PORT}`);
    console.log(`Static dir: ${PUBLIC_DIR}`);
    console.log(`Gallery dir: ${GALLERY_DIR}`);
    if (!LOCAL_API_TOKEN) {
      if (ALLOW_INSECURE_LOCAL) {
        console.warn(
          `[WARN] LOCAL_API_TOKEN 未设置，当前依赖 ALLOW_INSECURE_LOCAL=true 运行（仅建议本机临时调试）。`
        );
      } else {
        console.warn(`[WARN] LOCAL_API_TOKEN 未设置：写接口将拒绝请求。`);
      }
    }
  });
  return app;
}

function requireLocalToken(req, _res, next) {
  if (!LOCAL_API_TOKEN) {
    if (ALLOW_INSECURE_LOCAL) {
      return next();
    }
    return next(
      new AppError(503, "服务端未配置 LOCAL_API_TOKEN，写接口已禁用。", {
        code: "LOCAL_TOKEN_NOT_CONFIGURED",
      })
    );
  }

  const received = String(req.get(LOCAL_TOKEN_HEADER) || "").trim();
  if (!received) {
    return next(
      new AppError(401, `缺少鉴权头 ${LOCAL_TOKEN_HEADER}。`, {
        code: "LOCAL_TOKEN_MISSING",
      })
    );
  }
  if (received !== LOCAL_API_TOKEN) {
    return next(new AppError(403, "鉴权失败，token 不匹配。", { code: "LOCAL_TOKEN_INVALID" }));
  }
  return next();
}

function normalizeBaseUrl(input) {
  const value = String(input || "")
    .trim()
    .replace(/\/+$/, "");
  if (!value) {
    throw new AppError(400, "baseUrl 不能为空。", { code: "MISSING_BASE_URL" });
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new AppError(400, "baseUrl 不是合法 URL。", { code: "INVALID_BASE_URL" });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new AppError(400, "baseUrl 仅支持 http/https。", { code: "INVALID_BASE_URL_PROTOCOL" });
  }
  return parsed.toString().replace(/\/+$/, "");
}

function limitText(value, maxLength, fieldName) {
  const text = String(value || "").trim();
  if (text.length > maxLength) {
    throw new AppError(400, `${fieldName} 长度不能超过 ${maxLength}。`, { code: "FIELD_TOO_LONG" });
  }
  return text;
}

function unique(values) {
  return Array.from(new Set(values));
}

async function parseJsonOrText(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function pickError(payload) {
  if (!payload) {
    return "";
  }
  const candidates = [
    payload?.error?.message,
    payload?.message,
    payload?.detail,
    typeof payload === "string" ? payload : "",
  ];

  for (const item of candidates) {
    if (typeof item === "string" && item.trim()) {
      return item.trim().slice(0, 240);
    }
  }
  return "";
}

function mapUpstreamStatus(status) {
  if (status === 408 || status === 504) {
    return 504;
  }
  if (status >= 500) {
    return 502;
  }
  return 400;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new AppError(504, `请求上游超时（${REQUEST_TIMEOUT_MS}ms）。`, {
        code: "UPSTREAM_TIMEOUT",
      });
    }
    throw new AppError(502, `请求上游失败：${toErrorMessage(error)}`, {
      code: "UPSTREAM_FETCH_ERROR",
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function isAllowedLocalOrigin(origin) {
  try {
    const parsed = new URL(String(origin || ""));
    const protocolOk = parsed.protocol === "http:" || parsed.protocol === "https:";
    const hostname = parsed.hostname.toLowerCase();
    const hostOk = hostname === "127.0.0.1" || hostname === "localhost";
    return protocolOk && hostOk;
  } catch {
    return false;
  }
}

function isBodyTooLargeError(error) {
  return !!(error && (error.type === "entity.too.large" || error.status === 413));
}

function createRateLimiter(options) {
  const windowMs = Math.max(Number(options.windowMs) || 60_000, 1000);
  const max = Math.max(Number(options.max) || 60, 1);
  const buckets = new Map();

  return function rateLimitMiddleware(req, _res, next) {
    const ip = String(req.ip || req.socket?.remoteAddress || "unknown");
    const now = Date.now();
    const timestamps = buckets.get(ip) || [];
    const valid = timestamps.filter((ts) => now - ts < windowMs);
    if (valid.length >= max) {
      return next(
        new AppError(429, `请求过于频繁，请在 ${Math.ceil(windowMs / 1000)} 秒后重试。`, {
          code: "RATE_LIMITED",
        })
      );
    }
    valid.push(now);
    buckets.set(ip, valid);
    return next();
  };
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createApp,
  startServer,
  requireLocalToken,
  normalizeBaseUrl,
  limitText,
};
