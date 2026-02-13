import { sanitizeBaseUrl } from "./parsers.js";

export const STORAGE_KEY = "llm-image-console:v3";

export const DEFAULTS = {
  mode: "chat",
  baseUrl: "http://127.0.0.1:8000/v1",
  apiKey: "123123",
  rememberApiKey: false,
  localToken: "",
  proxyBaseUrl: "http://127.0.0.1:8086",
  modelManual: "",
  modelSelected: "",
  editInputType: "url",
  editImageUrl: "",
  prompt: "",
  size: "1024x1024",
  n: 1,
  seed: "",
  temperature: "0.7",
  guidance: "",
};

export function hydrateFromStorage() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    saved = {};
  }

  const merged = { ...DEFAULTS, ...saved };
  if (!merged.rememberApiKey) {
    merged.apiKey = DEFAULTS.apiKey;
  }
  if (merged.editInputType !== "upload") {
    merged.editInputType = "url";
  }
  merged.editImageUrl = typeof merged.editImageUrl === "string" ? merged.editImageUrl : "";
  merged.proxyBaseUrl = migrateProxyBaseUrl(merged.proxyBaseUrl);
  return merged;
}

export function persistFormState(formState) {
  const payload = {
    ...formState,
    proxyBaseUrl: migrateProxyBaseUrl(formState.proxyBaseUrl),
  };

  // data URL may be large; keep it runtime-only instead of writing to localStorage.
  delete payload.editImageDataUrl;

  if (!payload.rememberApiKey) {
    payload.apiKey = "";
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
}

export function clearPersistedState() {
  localStorage.removeItem(STORAGE_KEY);
}

export function migrateProxyBaseUrl(value) {
  const clean = sanitizeBaseUrl(value);
  if (clean === "http://127.0.0.1:8787" || clean === "http://localhost:8787") {
    return DEFAULTS.proxyBaseUrl;
  }
  return clean || DEFAULTS.proxyBaseUrl;
}
