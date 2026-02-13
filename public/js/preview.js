export function createPreviewController(els, handlers) {
  const state = {
    items: [],
    index: 0,
    lastFocusedElement: null,
  };

  els.previewCloseBtn.addEventListener("click", closePreview);
  els.previewPrevBtn.addEventListener("click", showPrevPreview);
  els.previewNextBtn.addEventListener("click", showNextPreview);
  els.previewDownloadBtn.addEventListener("click", onPreviewDownload);
  els.previewModal.addEventListener("click", onPreviewModalClick);
  document.addEventListener("keydown", onPreviewKeyDown);

  function makePreviewTargetInteractive(target, previewItems, index) {
    if (!(target instanceof HTMLElement)) {
      return;
    }

    target.setAttribute("role", "button");
    target.setAttribute("tabindex", "0");

    const open = () => openPreview(previewItems, index, target);
    target.addEventListener("click", () => open());
    target.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open();
      }
    });
  }

  function openPreview(items, index, triggerElement) {
    const previewItems = Array.isArray(items)
      ? items.filter((item) => item && typeof item.url === "string" && item.url.trim())
      : [];
    if (!previewItems.length) {
      return;
    }

    state.items = previewItems;
    state.lastFocusedElement =
      triggerElement instanceof HTMLElement ? triggerElement : document.activeElement;

    els.previewModal.hidden = false;
    document.body.classList.add("preview-open");
    setPreviewIndex(index);
    els.previewCloseBtn.focus();
  }

  function closePreview() {
    if (!isPreviewOpen()) {
      return;
    }

    els.previewModal.hidden = true;
    document.body.classList.remove("preview-open");
    els.previewImage.removeAttribute("src");
    els.previewMeta.textContent = "";
    state.items = [];
    state.index = 0;

    const focusTarget = state.lastFocusedElement;
    state.lastFocusedElement = null;
    if (focusTarget && typeof focusTarget.focus === "function") {
      focusTarget.focus();
    }
  }

  function showPrevPreview() {
    if (!isPreviewOpen() || state.items.length <= 1) {
      return;
    }
    setPreviewIndex(state.index - 1);
  }

  function showNextPreview() {
    if (!isPreviewOpen() || state.items.length <= 1) {
      return;
    }
    setPreviewIndex(state.index + 1);
  }

  function setPreviewIndex(nextIndex) {
    const total = state.items.length;
    if (!total) {
      return;
    }

    const numeric = Number.isFinite(nextIndex) ? Math.trunc(nextIndex) : 0;
    state.index = ((numeric % total) + total) % total;
    renderPreviewFrame();
  }

  function renderPreviewFrame() {
    const total = state.items.length;
    if (!total) {
      return;
    }

    const current = state.items[state.index];
    els.previewImage.src = current.url;
    els.previewImage.alt = `预览图 ${state.index + 1}`;

    const parts = [`${state.index + 1} / ${total}`];
    if (current.source) {
      parts.push(current.source);
    }
    if (current.label) {
      parts.push(current.label);
    }
    els.previewMeta.textContent = parts.join(" · ");

    const disableNav = total <= 1;
    els.previewPrevBtn.disabled = disableNav;
    els.previewNextBtn.disabled = disableNav;
  }

  function onPreviewModalClick(event) {
    if (event.target === els.previewModal || event.target === els.previewBackdrop) {
      closePreview();
    }
  }

  function onPreviewKeyDown(event) {
    if (!isPreviewOpen()) {
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closePreview();
      return;
    }

    if (event.key === "ArrowLeft") {
      event.preventDefault();
      showPrevPreview();
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      showNextPreview();
    }
  }

  async function onPreviewDownload() {
    if (!isPreviewOpen() || !state.items.length) {
      return;
    }

    const current = state.items[state.index];
    try {
      await handlers.downloadImage(current.url, `preview-${state.index + 1}`);
      handlers.setStatus(`已下载预览图第 ${state.index + 1} 张。`);
    } catch (error) {
      handlers.setError(`下载失败：${handlers.buildReadableError(error)}`);
    }
  }

  function isPreviewOpen() {
    return !!els.previewModal && !els.previewModal.hidden;
  }

  return {
    makePreviewTargetInteractive,
    openPreview,
    closePreview,
    isPreviewOpen,
  };
}
