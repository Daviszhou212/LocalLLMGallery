const DEFAULT_TIMEOUT_MS = 15000;

export class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = "TimeoutError";
  }
}

export class HttpError extends Error {
  constructor(status, message, payload = null) {
    super(message);
    this.name = "HttpError";
    this.status = Number(status) || 0;
    this.payload = payload;
  }
}

export async function requestJson(url, options = {}) {
  const timeoutMs = toPositiveInt(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const response = await fetchWithTimeout(url, options, timeoutMs);
  if (!response.ok) {
    throw await normalizeHttpError(response);
  }
  return response.json();
}

export async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new TimeoutError(`请求超时（${timeoutMs}ms）`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function normalizeHttpError(response) {
  let payload = null;
  let detail = "";
  try {
    payload = await response.json();
    detail = firstValidString([
      payload?.error?.message,
      payload?.message,
      payload?.detail,
      payload?.code,
      JSON.stringify(payload),
    ]);
  } catch {
    detail = await response.text();
  }

  const message = `HTTP ${response.status}${detail ? ` - ${detail.trim().slice(0, 400)}` : ""}`;
  return new HttpError(response.status, message, payload);
}

export function buildReadableError(error) {
  if (error instanceof TimeoutError) {
    return `请求超时：${error.message}`;
  }

  if (error instanceof HttpError) {
    if (error.status === 401 || error.status === 403) {
      return `${error.message}（请检查 Local Token）`;
    }
    if (error.status === 413) {
      return `${error.message}（请求体或图片过大）`;
    }
    if (error.status === 502 || error.status === 504) {
      return `${error.message}（上游服务不可用或超时）`;
    }
    return error.message;
  }

  if (error instanceof Error && error.message) {
    return error.message;
  }

  return String(error || "未知错误");
}

export function buildAuthHeaders(localToken) {
  const token = String(localToken || "").trim();
  if (!token) {
    return {};
  }
  return {
    "x-local-token": token,
  };
}

function firstValidString(values) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return "";
}

function toPositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}
