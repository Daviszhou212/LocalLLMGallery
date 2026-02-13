export function createGalleryController(ctx) {
  const {
    els,
    requestJson,
    buildAuthHeaders,
    buildReadableError,
    normalizeImageUrl,
    formatTime,
    copyText,
    downloadImage,
    getProxyBaseUrl,
    getBaseUrl,
    getLocalToken,
    getPrompt,
    getModel,
    getActiveTab,
    setStatus,
    setError,
    previewController,
  } = ctx;

  async function saveImageToGallery(item, index) {
    const proxyBaseUrl = getProxyBaseUrl();
    if (!proxyBaseUrl) {
      setError("请先填写画廊服务 URL。");
      return;
    }

    const payload = {
      prompt: getPrompt(),
      model: getModel(),
      source: item.source,
    };

    if (item.url.startsWith("data:image/")) {
      payload.dataUrl = item.url;
    } else {
      payload.imageUrl = normalizeImageUrl(item.url, getBaseUrl());
    }

    try {
      const data = await requestJson(`${proxyBaseUrl}/api/gallery/save`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...buildAuthHeaders(getLocalToken()),
        },
        body: JSON.stringify(payload),
      });

      if (data.duplicated) {
        setStatus(`第 ${index + 1} 张图已在画廊中，无需重复保存。`);
      } else {
        setStatus(`已将第 ${index + 1} 张图保存到画廊。`);
      }

      if (getActiveTab() === "gallery") {
        await loadGallery();
      }
    } catch (error) {
      setError(`保存失败：${buildReadableError(error)}`);
    }
  }

  async function loadGallery() {
    const proxyBaseUrl = getProxyBaseUrl();
    if (!proxyBaseUrl) {
      setError("请先填写画廊服务 URL。");
      return [];
    }

    try {
      const data = await requestJson(`${proxyBaseUrl}/api/gallery/list`);
      const items = Array.isArray(data.items) ? data.items : [];
      renderGallery(items);
      els.galleryCount.textContent = `${items.length} 张`;
      return items;
    } catch (error) {
      setError(`加载画廊失败：${buildReadableError(error)}`);
      return [];
    }
  }

  function renderGallery(items) {
    els.galleryGrid.innerHTML = "";

    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "tip";
      empty.textContent = "画廊为空。先在结果里点击“保存到画廊”。";
      els.galleryGrid.appendChild(empty);
      return;
    }

    const previewItems = items.map((item, index) => ({
      url: item.url,
      source: item.model || item.source || "gallery",
      label: formatTime(item.createdAt) || `画廊 #${index + 1}`,
      origin: "gallery",
    }));

    const fragment = document.createDocumentFragment();
    items.forEach((item, index) => {
      const card = els.galleryCardTemplate.content.firstElementChild.cloneNode(true);
      const imageWrap = card.querySelector(".image-wrap");
      const img = card.querySelector("img");
      const sourceTag = card.querySelector(".source-tag");
      const imageIndex = card.querySelector(".image-index");
      const promptNode = card.querySelector(".gallery-prompt");
      const downloadBtn = card.querySelector(".download-btn");
      const copyBtn = card.querySelector(".copy-btn");
      const deleteBtn = card.querySelector(".delete-btn");

      previewController.makePreviewTargetInteractive(imageWrap, previewItems, index);
      img.src = item.url;
      sourceTag.textContent = item.model || item.source || "gallery";
      imageIndex.textContent = formatTime(item.createdAt) || `#${index + 1}`;
      promptNode.textContent = item.prompt || "无 prompt";

      downloadBtn.addEventListener("click", async () => {
        try {
          await downloadImage(item.url, `gallery-${index + 1}`);
          setStatus(`已下载画廊第 ${index + 1} 张图。`);
        } catch (error) {
          setError(`下载失败：${buildReadableError(error)}`);
        }
      });

      copyBtn.addEventListener("click", async () => {
        try {
          await copyText(item.url);
          setStatus(`已复制画廊第 ${index + 1} 张图链接。`);
        } catch (error) {
          setError(`复制失败：${buildReadableError(error)}`);
        }
      });

      deleteBtn.addEventListener("click", async () => {
        await deleteGalleryItem(item.id);
      });

      fragment.appendChild(card);
    });

    els.galleryGrid.appendChild(fragment);
  }

  async function deleteGalleryItem(id) {
    const proxyBaseUrl = getProxyBaseUrl();
    if (!proxyBaseUrl) {
      setError("请先填写画廊服务 URL。");
      return;
    }

    try {
      await requestJson(`${proxyBaseUrl}/api/gallery/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: {
          ...buildAuthHeaders(getLocalToken()),
        },
      });
      setStatus("已从画廊删除该图片。");
      await loadGallery();
    } catch (error) {
      setError(`删除失败：${buildReadableError(error)}`);
    }
  }

  return {
    saveImageToGallery,
    loadGallery,
    renderGallery,
    deleteGalleryItem,
  };
}
