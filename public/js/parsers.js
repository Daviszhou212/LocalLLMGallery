export function parseChatImages(data, baseUrl) {
  const images = [];
  const message = data?.choices?.[0]?.message || {};

  collectImagesField(message.images, images, "images");

  const contentText = getContentText(message.content);
  if (contentText) {
    collectFromMarkdown(contentText, images);
    collectFromDataUrls(contentText, images);
    collectFromPlainUrls(contentText, images);
  }

  return normalizeParsedImages(dedupeImages(images), baseUrl);
}

export function parseImagesGeneration(data, baseUrl) {
  const images = [];
  const items = Array.isArray(data?.data) ? data.data : [];

  items.forEach((item) => {
    if (!item) {
      return;
    }

    if (typeof item.url === "string" && item.url.trim()) {
      images.push({ url: item.url.trim(), source: "images" });
    }

    if (typeof item.b64_json === "string" && item.b64_json.trim()) {
      images.push({
        url: `data:image/png;base64,${item.b64_json.trim()}`,
        source: "data_url",
      });
    }
  });

  return normalizeParsedImages(dedupeImages(images), baseUrl);
}

export function consumeSseTextBuffer(previousBuffer, incomingChunk) {
  const merged = `${String(previousBuffer || "")}${String(incomingChunk || "")}`;
  if (!merged) {
    return { events: [], buffer: "" };
  }

  const segments = merged.split(/\r?\n\r?\n/);
  const buffer = segments.pop() || "";
  const events = [];

  segments.forEach((segment) => {
    const parsed = parseSseSegment(segment);
    if (parsed) {
      events.push(parsed);
    }
  });

  return { events, buffer };
}

export function extractImagesFromStreamEvent(event, baseUrl) {
  const payload =
    event && event.data && typeof event.data === "object"
      ? event.data
      : event && typeof event === "object"
        ? event
        : null;
  if (!payload) {
    return [];
  }

  const output = [];
  collectStreamPayloadImages(payload, output);
  return normalizeParsedImages(dedupeImages(output), baseUrl);
}

export function normalizeImageUrl(rawUrl, baseUrl) {
  const text = String(rawUrl || "").trim();
  if (!text) {
    return "";
  }

  if (text.startsWith("data:image/")) {
    return text;
  }

  const baseOrigin = getOriginFromBaseUrl(baseUrl);
  const baseReference = baseOrigin || window.location.origin;

  let parsed;
  try {
    parsed = new URL(text, baseReference);
  } catch {
    return text;
  }

  if (!isHttpProtocol(parsed.protocol)) {
    return text;
  }

  const baseHost = getHostFromBaseUrl(baseUrl);
  if (
    isLocalHost(parsed.hostname) &&
    parsed.port === "9000" &&
    baseHost &&
    isLocalHost(baseHost.hostname)
  ) {
    parsed.protocol = baseHost.protocol;
    parsed.hostname = baseHost.hostname;
    parsed.port = baseHost.port;
  }

  return parsed.toString();
}

export function sanitizeBaseUrl(url) {
  return String(url || "")
    .trim()
    .replace(/\/+$/, "");
}

export function uniqueStrings(values) {
  return Array.from(
    new Set(
      values
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean)
    )
  );
}

export function formatTime(isoText) {
  if (!isoText) {
    return "";
  }
  const date = new Date(isoText);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleString();
}

export function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

export function toNullableNumber(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function collectImagesField(rawImages, output, source) {
  if (!Array.isArray(rawImages)) {
    return;
  }

  rawImages.forEach((entry) => {
    if (typeof entry === "string" && entry.trim()) {
      output.push({ url: entry.trim(), source });
      return;
    }

    if (entry && typeof entry === "object") {
      const directUrl = firstValidString([entry.url, entry.image_url, entry.src]);
      if (directUrl) {
        output.push({ url: directUrl, source });
      }

      if (typeof entry.b64_json === "string" && entry.b64_json.trim()) {
        output.push({
          url: `data:image/png;base64,${entry.b64_json.trim()}`,
          source: "data_url",
        });
      }
    }
  });
}

function getContentText(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part.text === "string") {
          return part.text;
        }
        return "";
      })
      .join("\n");
  }

  return "";
}

function collectFromMarkdown(text, output) {
  const markdownImagePattern = /!\[[^\]]*]\(([^)\s]+)\)/g;
  let match = markdownImagePattern.exec(text);
  while (match) {
    output.push({ url: match[1], source: "content" });
    match = markdownImagePattern.exec(text);
  }
}

function collectFromDataUrls(text, output) {
  const dataUrlPattern = /data:image\/[a-zA-Z0-9.+-]+;base64,[A-Za-z0-9+/=]+/g;
  const matches = text.match(dataUrlPattern) || [];
  matches.forEach((url) => output.push({ url, source: "data_url" }));
}

function collectFromPlainUrls(text, output) {
  const plainUrlPattern = /\bhttps?:\/\/[^\s)]+/g;
  const matches = text.match(plainUrlPattern) || [];
  matches.forEach((url) => output.push({ url, source: "content" }));
}

function parseSseSegment(segment) {
  const lines = String(segment || "").split(/\r?\n/);
  let event = "message";
  const dataLines = [];

  lines.forEach((line) => {
    const text = String(line || "").trimEnd();
    if (!text || text.startsWith(":")) {
      return;
    }
    if (text.startsWith("event:")) {
      const name = text.slice(6).trim();
      if (name) {
        event = name;
      }
      return;
    }
    if (text.startsWith("data:")) {
      dataLines.push(text.slice(5).trim());
    }
  });

  if (!dataLines.length) {
    return null;
  }

  const rawData = dataLines.join("\n").trim();
  if (!rawData || rawData === "[DONE]") {
    return null;
  }

  let data = null;
  try {
    data = JSON.parse(rawData);
  } catch {
    data = null;
  }

  return { event, rawData, data };
}

function collectStreamPayloadImages(payload, output) {
  if (!payload || typeof payload !== "object") {
    return;
  }

  appendImageUrl(output, payload.url, "stream");
  appendImageBase64(output, payload.b64_json, "stream");
  appendImageBase64(output, payload.base64, "stream");

  if (Array.isArray(payload.data)) {
    payload.data.forEach((item) => {
      if (!item || typeof item !== "object") {
        return;
      }
      appendImageUrl(output, item.url, "stream");
      appendImageBase64(output, item.b64_json, "stream");
      appendImageBase64(output, item.base64, "stream");
    });
  }

  if (payload.image && typeof payload.image === "object") {
    appendImageUrl(output, payload.image.url, "stream");
    appendImageBase64(output, payload.image.b64_json, "stream");
    appendImageBase64(output, payload.image.base64, "stream");
  }
}

function appendImageUrl(output, url, source) {
  if (typeof url === "string" && url.trim()) {
    output.push({ url: url.trim(), source });
  }
}

function appendImageBase64(output, b64, source) {
  if (typeof b64 === "string" && b64.trim()) {
    output.push({
      url: `data:image/png;base64,${b64.trim()}`,
      source,
    });
  }
}

function dedupeImages(images) {
  const seen = new Set();
  const result = [];

  images.forEach((item) => {
    if (!item || typeof item.url !== "string") {
      return;
    }
    const clean = item.url.trim();
    if (!clean || seen.has(clean)) {
      return;
    }
    seen.add(clean);
    result.push({ url: clean, source: item.source || "content" });
  });

  return result;
}

function normalizeParsedImages(images, baseUrl) {
  const normalized = images
    .map((item) => ({
      ...item,
      url: normalizeImageUrl(item.url, baseUrl),
    }))
    .filter((item) => typeof item.url === "string" && item.url.trim());

  return dedupeImages(normalized);
}

function firstValidString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function getOriginFromBaseUrl(baseUrl) {
  try {
    return new URL(String(baseUrl || "").trim()).origin;
  } catch {
    return "";
  }
}

function getHostFromBaseUrl(baseUrl) {
  try {
    const parsed = new URL(String(baseUrl || "").trim());
    return {
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port,
    };
  } catch {
    return null;
  }
}

function isHttpProtocol(protocol) {
  return protocol === "http:" || protocol === "https:";
}

function isLocalHost(hostname) {
  const host = String(hostname || "").toLowerCase();
  return host === "127.0.0.1" || host === "localhost";
}
