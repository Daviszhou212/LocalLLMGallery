import { requestJson, buildReadableError, buildAuthHeaders } from "./js/api.js";
import {
  parseChatImages,
  parseImagesGeneration,
  normalizeImageUrl,
  sanitizeBaseUrl,
  uniqueStrings,
  toInt,
  toNullableNumber,
  formatTime,
} from "./js/parsers.js";
import {
  DEFAULTS,
  hydrateFromStorage,
  persistFormState,
  clearPersistedState,
  migrateProxyBaseUrl,
} from "./js/state.js";
import { createPreviewController } from "./js/preview.js";
import { createGalleryController } from "./js/gallery.js";

const els = {
  form: document.getElementById("generate-form"),
  mode: document.getElementById("mode"),
  baseUrl: document.getElementById("baseUrl"),
  apiKey: document.getElementById("apiKey"),
  rememberApiKey: document.getElementById("rememberApiKey"),
  localToken: document.getElementById("localToken"),
  proxyBaseUrl: document.getElementById("proxyBaseUrl"),
  connectBtn: document.getElementById("connect-btn"),
  modelSelect: document.getElementById("modelSelect"),
  modelManual: document.getElementById("modelManual"),
  modelHint: document.getElementById("model-hint"),
  editModelHint: document.getElementById("edit-model-hint"),
  prompt: document.getElementById("prompt"),
  editInputType: document.getElementById("editInputType"),
  editImageUrl: document.getElementById("editImageUrl"),
  editImageFile: document.getElementById("editImageFile"),
  editFileHint: document.getElementById("edit-file-hint"),
  editImagePreviewWrap: document.getElementById("edit-image-preview-wrap"),
  editImagePreview: document.getElementById("edit-image-preview"),
  size: document.getElementById("size"),
  n: document.getElementById("n"),
  seed: document.getElementById("seed"),
  temperature: document.getElementById("temperature"),
  guidance: document.getElementById("guidance"),
  submitBtn: document.getElementById("submit-btn"),
  clearBtn: document.getElementById("clear-btn"),
  resetBtn: document.getElementById("reset-btn"),
  refreshGalleryBtn: document.getElementById("refresh-gallery-btn"),
  tabBtns: Array.from(document.querySelectorAll(".tab-btn")),
  resultsView: document.getElementById("results-view"),
  galleryView: document.getElementById("gallery-view"),
  status: document.getElementById("status"),
  error: document.getElementById("error"),
  protocolTip: document.getElementById("protocol-tip"),
  resultCount: document.getElementById("result-count"),
  galleryCount: document.getElementById("gallery-count"),
  results: document.getElementById("results"),
  galleryGrid: document.getElementById("gallery-grid"),
  imageCardTemplate: document.getElementById("image-card-template"),
  galleryCardTemplate: document.getElementById("gallery-card-template"),
  previewModal: document.getElementById("preview-modal"),
  previewBackdrop: document.getElementById("preview-backdrop"),
  previewImage: document.getElementById("preview-image"),
  previewCloseBtn: document.getElementById("preview-close-btn"),
  previewPrevBtn: document.getElementById("preview-prev-btn"),
  previewNextBtn: document.getElementById("preview-next-btn"),
  previewMeta: document.getElementById("preview-meta"),
  previewDownloadBtn: document.getElementById("preview-download-btn"),
};

const state = {
  isSubmitting: false,
  isConnecting: false,
  activeTab: "results",
  models: [],
  editModels: [],
  preferredModel: "",
  editImageDataUrl: "",
};

const previewController = createPreviewController(els, {
  setStatus,
  setError,
  buildReadableError,
  downloadImage,
});

const galleryController = createGalleryController({
  els,
  requestJson,
  buildAuthHeaders,
  buildReadableError,
  normalizeImageUrl,
  formatTime,
  copyText,
  downloadImage,
  getProxyBaseUrl: () => sanitizeBaseUrl(els.proxyBaseUrl.value),
  getBaseUrl: () => els.baseUrl.value,
  getLocalToken: () => els.localToken.value,
  getPrompt: () => els.prompt.value.trim(),
  getModel: () => resolveModelValue(),
  getActiveTab: () => state.activeTab,
  setStatus,
  setError,
  previewController,
});

init();

function init() {
  applyForm(hydrateFromStorage());
  renderModelOptions([], state.preferredModel);
  bindEvents();
  updateModeUI();
  updateProtocolTip();
  updateModelHint();
  syncEditImagePreview(resolveEditImageSource());
  updateSubmitAvailability();
  switchTab("results");
  setStatus("就绪：先连接模型，然后生成图像。");
}

function bindEvents() {
  els.form.addEventListener("submit", onSubmit);
  els.connectBtn.addEventListener("click", onConnectModels);
  els.clearBtn.addEventListener("click", clearResults);
  els.resetBtn.addEventListener("click", resetDefaults);
  els.refreshGalleryBtn.addEventListener("click", galleryController.loadGallery);

  els.tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  const persistTargets = [
    els.mode,
    els.baseUrl,
    els.apiKey,
    els.rememberApiKey,
    els.localToken,
    els.proxyBaseUrl,
    els.modelSelect,
    els.modelManual,
    els.editInputType,
    els.editImageUrl,
    els.prompt,
    els.size,
    els.n,
    els.seed,
    els.temperature,
    els.guidance,
  ];

  persistTargets.forEach((el) => {
    el.addEventListener("input", persistCurrentFormState);
    el.addEventListener("change", persistCurrentFormState);
  });

  els.mode.addEventListener("change", updateModeUI);
  els.modelSelect.addEventListener("change", () => {
    if (els.modelSelect.value) {
      els.modelManual.value = "";
    }
    updateModelHint();
    persistCurrentFormState();
  });
  els.modelManual.addEventListener("input", updateModelHint);
  els.editInputType.addEventListener("change", () => {
    updateEditInputUI();
    syncEditImagePreview(resolveEditImageSource());
    updateSubmitAvailability();
  });
  els.editImageUrl.addEventListener("input", () => {
    if (els.editInputType.value === "url") {
      syncEditImagePreview(els.editImageUrl.value.trim());
      updateSubmitAvailability();
    }
  });
  els.editImageFile.addEventListener("change", onEditImageFileChange);
}

async function onConnectModels() {
  if (state.isConnecting) {
    return;
  }

  const baseUrl = sanitizeBaseUrl(els.baseUrl.value);
  const apiKey = els.apiKey.value.trim();
  const proxyBaseUrl = sanitizeBaseUrl(els.proxyBaseUrl.value);
  const localToken = els.localToken.value.trim();

  if (!baseUrl) {
    setError("请先填写 Base URL。");
    return;
  }
  if (!proxyBaseUrl) {
    setError("请先填写画廊服务 URL。");
    return;
  }

  clearError();
  setConnecting(true);
  setStatus(`连接中：${baseUrl}/models`);

  try {
    const data = await requestJson(`${proxyBaseUrl}/api/models/fetch`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...buildAuthHeaders(localToken),
      },
      body: JSON.stringify({ baseUrl, apiKey }),
    });
    const models = Array.isArray(data.models) ? uniqueStrings(data.models) : [];
    const preferred = resolveModelValue() || state.preferredModel;
    renderModelOptions(models, preferred);

    if (!models.length) {
      els.modelHint.textContent = "未获取到模型列表，请手动填写模型名。";
      updateEditModelHint();
      updateSubmitAvailability();
      setStatus("连接成功，但未返回可用模型。");
      return;
    }

    if (!resolveModelValue()) {
      const firstEditModel = state.editModels[0] || "";
      els.modelSelect.value =
        els.mode.value === "image-edit" && firstEditModel ? firstEditModel : models[0];
    }
    state.preferredModel = resolveModelValue();
    updateModelHint();
    updateSubmitAvailability();
    setStatus(`连接成功：已加载 ${models.length} 个模型。`);
  } catch (error) {
    setError(`连接失败：${buildReadableError(error)}`);
    setStatus("连接失败：请检查 URL、API Key、Local Token 或后端服务状态。");
  } finally {
    setConnecting(false);
  }
}

async function onSubmit(event) {
  event.preventDefault();
  if (state.isSubmitting) {
    return;
  }

  clearError();
  setSubmitting(true);

  const form = collectFormValues();
  if (!form.model) {
    setError("请先选择模型或手动输入模型名。");
    setStatus("缺少模型参数。");
    setSubmitting(false);
    return;
  }
  if (!form.prompt) {
    setError("prompt 不能为空。");
    setStatus("缺少 prompt 参数。");
    setSubmitting(false);
    return;
  }
  if (form.mode === "image-edit") {
    if (!hasAvailableEditModels()) {
      setError("当前模型列表中没有可用的 image-edit 模型（名称需包含 edit）。");
      setStatus("image-edit 不可用：请连接包含 edit 模型的服务。");
      setSubmitting(false);
      return;
    }
    if (!modelSupportsImageEdit(form.model)) {
      setError("当前模型不支持 image-edit，请选择名称包含 edit 的模型。");
      setStatus("image-edit 校验失败：模型不匹配。");
      setSubmitting(false);
      return;
    }
    if (!form.editImageSource) {
      setError("image-edit 需要提供原图 URL 或上传文件。");
      setStatus("缺少 image-edit 原图参数。");
      setSubmitting(false);
      return;
    }
  }

  const endpoint = buildEndpoint(form.baseUrl, form.mode);

  try {
    const requestOptions = await buildRequestOptions(form);
    setStatus(`请求发送中：${endpoint}`);
    const data = await requestJson(endpoint, requestOptions);

    const parsed =
      form.mode === "chat"
        ? parseChatImages(data, form.baseUrl)
        : parseImagesGeneration(data, form.baseUrl);
    if (!parsed.length) {
      throw new Error("请求成功，但未解析到可展示的图片。");
    }

    renderResults(parsed);
    setStatus(`成功：共解析到 ${parsed.length} 张图。`);
  } catch (error) {
    setError(buildReadableError(error));
    setStatus("失败：请检查参数、接口返回格式或服务日志。");
    console.error(error);
  } finally {
    setSubmitting(false);
  }
}

function renderResults(images) {
  els.results.innerHTML = "";
  els.resultCount.textContent = `${images.length} 张`;

  const previewItems = images.map((item, index) => ({
    url: item.url,
    source: item.source || "result",
    label: `结果 #${index + 1}`,
    origin: "results",
  }));

  const fragment = document.createDocumentFragment();
  images.forEach((item, index) => {
    const card = els.imageCardTemplate.content.firstElementChild.cloneNode(true);
    const imageWrap = card.querySelector(".image-wrap");
    const img = card.querySelector("img");
    const sourceTag = card.querySelector(".source-tag");
    const imageIndex = card.querySelector(".image-index");
    const downloadBtn = card.querySelector(".download-btn");
    const copyBtn = card.querySelector(".copy-btn");
    const saveBtn = card.querySelector(".save-btn");

    previewController.makePreviewTargetInteractive(imageWrap, previewItems, index);
    img.src = item.url;
    sourceTag.textContent = item.source;
    imageIndex.textContent = `#${index + 1}`;

    downloadBtn.addEventListener("click", async () => {
      try {
        await downloadImage(item.url, `result-${index + 1}`);
        setStatus(`已下载第 ${index + 1} 张图。`);
      } catch (error) {
        setError(`下载失败：${buildReadableError(error)}`);
      }
    });

    if (item.url.startsWith("data:image/")) {
      copyBtn.disabled = true;
      copyBtn.title = "data URL 不适合复制为外链。";
    } else {
      copyBtn.addEventListener("click", async () => {
        try {
          await copyText(item.url);
          setStatus(`已复制第 ${index + 1} 张图链接。`);
        } catch (error) {
          setError(`复制失败：${buildReadableError(error)}`);
        }
      });
    }

    saveBtn.addEventListener("click", () => galleryController.saveImageToGallery(item, index));
    fragment.appendChild(card);
  });

  els.results.appendChild(fragment);
}

function collectFormValues() {
  const editImageSource = resolveEditImageSource();
  return {
    mode: els.mode.value,
    baseUrl: sanitizeBaseUrl(els.baseUrl.value),
    apiKey: els.apiKey.value.trim(),
    proxyBaseUrl: sanitizeBaseUrl(els.proxyBaseUrl.value),
    model: resolveModelValue(),
    editInputType: els.editInputType.value,
    editImageUrl: els.editImageUrl.value.trim(),
    editImageDataUrl: state.editImageDataUrl,
    editImageSource,
    prompt: els.prompt.value.trim(),
    size: els.size.value,
    n: Math.min(toInt(els.n.value, DEFAULTS.n), 8),
    seed: toNullableNumber(els.seed.value),
    temperature: toNullableNumber(els.temperature.value),
    guidance: toNullableNumber(els.guidance.value),
  };
}

function buildEndpoint(baseUrl, mode) {
  if (mode === "chat") {
    return `${baseUrl}/chat/completions`;
  }
  if (mode === "image-edit") {
    return `${baseUrl}/images/edits`;
  }
  return `${baseUrl}/images/generations`;
}

function buildPayload(form) {
  if (form.mode === "chat") {
    return buildChatPayload(form);
  }
  return buildImagesPayload(form);
}

async function buildRequestOptions(form) {
  if (form.mode === "image-edit") {
    return buildImageEditRequestOptions(form);
  }

  const body = buildPayload(form);
  return {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${form.apiKey}`,
    },
    body: JSON.stringify(body),
  };
}

function buildChatPayload(form) {
  const payload = {
    model: form.model,
    messages: [
      { role: "system", content: "You are an assistant that generates image links." },
      { role: "user", content: form.prompt },
    ],
    stream: false,
    size: form.size,
    n: form.n,
  };
  appendOptionalNumber(payload, "seed", form.seed);
  appendOptionalNumber(payload, "temperature", form.temperature);
  appendOptionalNumber(payload, "guidance", form.guidance);
  return payload;
}

function buildImagesPayload(form) {
  const payload = {
    model: form.model,
    prompt: form.prompt,
    size: form.size,
    n: form.n,
  };
  appendOptionalNumber(payload, "seed", form.seed);
  appendOptionalNumber(payload, "guidance", form.guidance);
  appendOptionalNumber(payload, "temperature", form.temperature);
  return payload;
}

async function buildImageEditRequestOptions(form) {
  const imageFile = await resolveEditImageFile(form.editImageSource);
  const body = new FormData();
  body.set("model", form.model);
  body.set("prompt", form.prompt);
  body.set("n", String(form.n));
  body.set("size", form.size);
  body.append("image", imageFile.blob, imageFile.filename);

  return {
    method: "POST",
    headers: {
      Authorization: `Bearer ${form.apiKey}`,
    },
    body,
  };
}

function appendOptionalNumber(target, key, value) {
  if (value !== null && Number.isFinite(value)) {
    target[key] = value;
  }
}

function switchTab(tab) {
  if (!tab) {
    return;
  }
  state.activeTab = tab;

  els.tabBtns.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.tab === tab);
  });

  const showResults = tab === "results";
  els.resultsView.hidden = !showResults;
  els.galleryView.hidden = showResults;

  if (!showResults) {
    galleryController.loadGallery();
  }
}

function renderModelOptions(models, preferred = "") {
  state.models = models;
  state.editModels = getEditModels(models);
  els.modelSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = models.length
    ? "请选择模型（或使用手动输入）"
    : "请先点击“连接 URL”加载模型列表";
  els.modelSelect.appendChild(placeholder);

  models.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = name;
    els.modelSelect.appendChild(option);
  });

  const preferredValue = String(preferred || "").trim();
  if (preferredValue && models.includes(preferredValue)) {
    els.modelSelect.value = preferredValue;
  } else if (!els.modelManual.value.trim()) {
    els.modelSelect.value = "";
  }

  updateEditModelHint();
}

function resolveModelValue() {
  const manual = els.modelManual.value.trim();
  if (manual) {
    return manual;
  }
  return els.modelSelect.value.trim();
}

function updateModelHint() {
  const manual = els.modelManual.value.trim();
  const selected = els.modelSelect.value.trim();

  if (manual) {
    els.modelHint.textContent = `当前使用手动模型：${manual}`;
  } else if (selected) {
    els.modelHint.textContent = `当前使用下拉模型：${selected}`;
  } else if (state.models.length) {
    els.modelHint.textContent = `已加载 ${state.models.length} 个模型，请从下拉选择或手动输入。`;
  } else {
    els.modelHint.textContent = "点击“连接 URL”可获取模型列表";
  }

  updateEditModelHint();
  updateSubmitAvailability();
}

function clearResults() {
  if (previewController.isPreviewOpen()) {
    previewController.closePreview();
  }
  els.results.innerHTML = "";
  els.resultCount.textContent = "0 张";
  clearError();
  setStatus("结果已清空。");
}

function resetDefaults() {
  applyForm(DEFAULTS);
  state.preferredModel = "";
  state.editImageDataUrl = "";
  clearPersistedState();
  renderModelOptions([]);
  updateModelHint();
  updateEditInputUI();
  syncEditImagePreview("");
  clearResults();
  setStatus("已恢复默认配置。");
}

function applyForm(values) {
  els.mode.value = values.mode || DEFAULTS.mode;
  els.baseUrl.value = values.baseUrl || DEFAULTS.baseUrl;
  els.apiKey.value = values.apiKey || DEFAULTS.apiKey;
  els.rememberApiKey.checked = Boolean(values.rememberApiKey);
  els.localToken.value = values.localToken || DEFAULTS.localToken;
  els.proxyBaseUrl.value = migrateProxyBaseUrl(values.proxyBaseUrl || DEFAULTS.proxyBaseUrl);
  els.modelManual.value = values.modelManual || values.model || "";
  els.editInputType.value = values.editInputType || DEFAULTS.editInputType;
  els.editImageUrl.value = values.editImageUrl || DEFAULTS.editImageUrl;
  els.editImageFile.value = "";
  els.editFileHint.textContent = "未选择文件";
  els.prompt.value = values.prompt || DEFAULTS.prompt;
  els.size.value = values.size || DEFAULTS.size;
  els.n.value = values.n ?? DEFAULTS.n;
  els.seed.value = values.seed ?? DEFAULTS.seed;
  els.temperature.value = values.temperature ?? DEFAULTS.temperature;
  els.guidance.value = values.guidance ?? DEFAULTS.guidance;
  state.editImageDataUrl = "";
  state.preferredModel = values.modelSelected || values.model || "";
}

function persistCurrentFormState() {
  const formState = {
    mode: els.mode.value,
    baseUrl: els.baseUrl.value.trim(),
    apiKey: els.apiKey.value.trim(),
    rememberApiKey: els.rememberApiKey.checked,
    localToken: els.localToken.value.trim(),
    proxyBaseUrl: migrateProxyBaseUrl(els.proxyBaseUrl.value.trim()),
    modelManual: els.modelManual.value.trim(),
    modelSelected: els.modelSelect.value.trim(),
    model: resolveModelValue(),
    editInputType: els.editInputType.value,
    editImageUrl: els.editImageUrl.value.trim(),
    editImageDataUrl: state.editImageDataUrl,
    prompt: els.prompt.value,
    size: els.size.value,
    n: els.n.value,
    seed: els.seed.value,
    temperature: els.temperature.value,
    guidance: els.guidance.value,
  };
  state.preferredModel = formState.modelSelected || formState.model || "";
  persistFormState(formState);
}

function updateModeUI() {
  const showTemperature = els.mode.value === "chat";
  const showImageEdit = isImageEditMode();
  document.querySelectorAll(".mode-chat-only").forEach((el) => {
    el.hidden = !showTemperature;
  });
  document.querySelectorAll(".mode-edit-only").forEach((el) => {
    el.hidden = !showImageEdit;
  });

  if (
    showImageEdit &&
    state.editModels.length &&
    !modelSupportsImageEdit(resolveModelValue()) &&
    !els.modelManual.value.trim()
  ) {
    els.modelSelect.value = state.editModels[0];
    state.preferredModel = resolveModelValue();
  }

  updateEditInputUI();
  updateEditModelHint();
  updateSubmitAvailability();
}

function isImageEditMode() {
  return els.mode.value === "image-edit";
}

function isEditModelName(modelName) {
  return /edit/i.test(String(modelName || "").trim());
}

function getEditModels(models) {
  if (!Array.isArray(models)) {
    return [];
  }
  return models.filter((name) => isEditModelName(name));
}

function hasAvailableEditModels() {
  return state.editModels.length > 0;
}

function modelSupportsImageEdit(modelName) {
  return isEditModelName(modelName);
}

function resolveEditImageSource() {
  if (els.editInputType.value === "upload") {
    return String(state.editImageDataUrl || "").trim();
  }
  return els.editImageUrl.value.trim();
}

async function resolveEditImageFile(sourceUrl) {
  const source = String(sourceUrl || "").trim();
  if (!source) {
    throw new Error("缺少 image-edit 原图。");
  }

  let response;
  try {
    response = await fetch(source);
  } catch (error) {
    throw new Error(`无法读取原图，请检查 URL 或 CORS：${buildReadableError(error)}`);
  }

  if (!response.ok) {
    throw new Error(`原图下载失败：HTTP ${response.status}`);
  }

  const blob = await response.blob();
  const mime = String(blob.type || "").toLowerCase();
  if (!mime.startsWith("image/")) {
    throw new Error(`原图内容不是图片：${mime || "unknown"}`);
  }

  const ext = extensionFromMime(mime) || guessExtension(source) || "png";
  return {
    blob,
    filename: `image-edit-source.${ext}`,
  };
}

function extensionFromMime(mime) {
  const normalized = String(mime || "").toLowerCase();
  if (normalized === "image/jpeg" || normalized === "image/jpg") {
    return "jpg";
  }
  if (normalized === "image/png") {
    return "png";
  }
  if (normalized === "image/webp") {
    return "webp";
  }
  if (normalized === "image/gif") {
    return "gif";
  }
  if (normalized === "image/bmp") {
    return "bmp";
  }
  if (normalized === "image/tiff") {
    return "tiff";
  }
  return "";
}

function updateEditModelHint() {
  if (!els.editModelHint) {
    return;
  }

  if (!state.models.length) {
    els.editModelHint.textContent = "image-edit 将在连接后自动检测可用模型";
    return;
  }

  if (!state.editModels.length) {
    els.editModelHint.textContent = "未检测到含 edit 的模型，image-edit 已禁用";
    return;
  }

  els.editModelHint.textContent = `已检测到 ${state.editModels.length} 个 edit 模型，可用于 image-edit`;
}

function updateSubmitAvailability() {
  if (state.isSubmitting) {
    return;
  }

  if (!isImageEditMode()) {
    els.submitBtn.disabled = false;
    els.submitBtn.title = "";
    return;
  }

  const modelName = resolveModelValue();
  const imageSource = resolveEditImageSource();
  const hasEditModel = hasAvailableEditModels();
  const modelMatched = modelSupportsImageEdit(modelName);
  const hasSourceImage = Boolean(imageSource);
  const canSubmit = hasEditModel && modelMatched && hasSourceImage;

  els.submitBtn.disabled = !canSubmit;
  if (!hasEditModel) {
    els.submitBtn.title = "当前没有可用的 edit 模型";
    return;
  }
  if (!modelMatched) {
    els.submitBtn.title = "请选择名称包含 edit 的模型";
    return;
  }
  if (!hasSourceImage) {
    els.submitBtn.title = "请提供 image-edit 原图";
    return;
  }
  els.submitBtn.title = "";
}

function updateEditInputUI() {
  const useUpload = els.editInputType.value === "upload";
  document.querySelectorAll(".mode-edit-url-only").forEach((el) => {
    el.hidden = useUpload;
  });
  document.querySelectorAll(".mode-edit-upload-only").forEach((el) => {
    el.hidden = !useUpload;
  });
}

async function onEditImageFileChange() {
  const file = els.editImageFile.files && els.editImageFile.files[0];
  if (!file) {
    state.editImageDataUrl = "";
    els.editFileHint.textContent = "未选择文件";
    syncEditImagePreview("");
    updateSubmitAvailability();
    persistCurrentFormState();
    return;
  }

  if (!String(file.type || "").startsWith("image/")) {
    state.editImageDataUrl = "";
    els.editFileHint.textContent = `文件类型不支持：${file.type || "unknown"}`;
    syncEditImagePreview("");
    updateSubmitAvailability();
    persistCurrentFormState();
    return;
  }

  try {
    const dataUrl = await readFileAsDataUrl(file);
    state.editImageDataUrl = dataUrl;
    els.editFileHint.textContent = `已选择：${file.name}`;
    syncEditImagePreview(dataUrl);
    clearError();
    updateSubmitAvailability();
    persistCurrentFormState();
  } catch (error) {
    state.editImageDataUrl = "";
    els.editFileHint.textContent = "读取文件失败";
    syncEditImagePreview("");
    setError(`读取上传图片失败：${buildReadableError(error)}`);
    updateSubmitAvailability();
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

function syncEditImagePreview(sourceUrl) {
  const imageUrl = String(sourceUrl || "").trim();
  if (!imageUrl) {
    els.editImagePreview.removeAttribute("src");
    els.editImagePreviewWrap.classList.remove("has-image");
    return;
  }

  els.editImagePreview.src = imageUrl;
  els.editImagePreviewWrap.classList.add("has-image");
}

function updateProtocolTip() {
  if (window.location.protocol === "file:") {
    els.protocolTip.hidden = false;
  }
}

function setSubmitting(flag) {
  state.isSubmitting = flag;
  els.submitBtn.textContent = flag ? "生成中..." : "生成图像";
  if (flag) {
    els.submitBtn.disabled = true;
    return;
  }
  updateSubmitAvailability();
}

function setConnecting(flag) {
  state.isConnecting = flag;
  els.connectBtn.disabled = flag;
  els.connectBtn.textContent = flag ? "连接中..." : "连接 URL";
}

function setStatus(message) {
  els.status.textContent = message;
}

function setError(message) {
  els.error.hidden = false;
  els.error.textContent = message;
}

function clearError() {
  els.error.hidden = true;
  els.error.textContent = "";
}

async function copyText(text) {
  if (!navigator.clipboard) {
    throw new Error("当前环境不支持 Clipboard API。");
  }
  await navigator.clipboard.writeText(text);
}

async function downloadImage(url, prefix) {
  const extension = guessExtension(url);
  const filename = `${prefix}-${Date.now()}.${extension}`;

  if (url.startsWith("data:image/")) {
    triggerDownload(url, filename);
    return;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`下载返回状态 ${response.status}`);
    }
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);
    triggerDownload(blobUrl, filename);
    URL.revokeObjectURL(blobUrl);
  } catch {
    window.open(url, "_blank", "noopener,noreferrer");
  }
}

function triggerDownload(href, filename) {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

function guessExtension(url) {
  if (url.startsWith("data:image/")) {
    const mime = url.slice(5, url.indexOf(";"));
    return mime.split("/")[1] || "png";
  }
  const clean = url.split("?")[0];
  const ext = clean.split(".").pop();
  if (!ext || ext.length > 5) {
    return "png";
  }
  return ext.toLowerCase();
}
