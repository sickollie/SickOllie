import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const TARGET = "SOFitPreviewStudio";
const STORED_IMAGES_PROPERTY = "so_fit_preview_images";
const STORED_INDEX_PROPERTY = "so_fit_preview_index";

function widgetValue(node, name, fallback) {
    const item = node.widgets?.find((w) => w.name === name);
    return item?.value ?? fallback;
}

function drawChecker(ctx, x, y, w, h) {
    const size = 18;
    for (let py = y; py < y + h; py += size) {
        for (let px = x; px < x + w; px += size) {
            ctx.fillStyle = ((Math.floor((px - x) / size) + Math.floor((py - y) / size)) % 2)
                ? "#26292e"
                : "#3a3e45";
            ctx.fillRect(px, py, size, size);
        }
    }
}

function cleanImageData(data) {
    if (!data || typeof data !== "object") return null;

    const filename = String(data.filename || "");
    if (!filename) return null;

    return {
        filename,
        type: String(data.type || "temp"),
        subfolder: String(data.subfolder || ""),
    };
}

function imageDataToUrl(data) {
    const filename = encodeURIComponent(data?.filename || "");
    const type = encodeURIComponent(data?.type || "temp");
    const subfolder = encodeURIComponent(data?.subfolder || "");

    return api.apiURL(
        `/view?filename=${filename}` +
            `&type=${type}` +
            `&subfolder=${subfolder}` +
            `${app.getPreviewFormatParam?.() || ""}` +
            `${app.getRandParam?.() || ""}`,
    );
}

function persistPreviewState(node, imageData) {
    node.properties = node.properties || {};
    node.properties[STORED_IMAGES_PROPERTY] = imageData.map((item) => ({ ...item }));
    node.properties[STORED_INDEX_PROPERTY] = Number(node.__soFitImageIndex || 0);
}

function loadPreviewImages(node, sourceData, { persist = false, force = false } = {}) {
    const imageData = (Array.isArray(sourceData) ? sourceData : [])
        .map(cleanImageData)
        .filter(Boolean);

    if (!imageData.length) return false;

    const key = JSON.stringify(imageData);
    if (!force && node.__soFitImageDataKey === key && node.__soFitImages?.length) {
        return true;
    }

    node.__soFitImageData = imageData;
    node.__soFitImageDataKey = key;
    node.__soFitImages = [];
    node.__soFitImageIndex = Math.min(
        Math.max(0, Number(node.__soFitImageIndex || 0)),
        imageData.length - 1,
    );
    node.__soFitImageLoadFailed = false;
    node.__soFitImageLoadsPending = imageData.length;

    for (const data of imageData) {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => {
            node.__soFitImageLoadsPending = Math.max(
                0,
                Number(node.__soFitImageLoadsPending || 1) - 1,
            );
            node.setDirtyCanvas?.(true, true);
        };
        image.onerror = () => {
            node.__soFitImageLoadsPending = Math.max(
                0,
                Number(node.__soFitImageLoadsPending || 1) - 1,
            );
            node.__soFitImageLoadFailed = true;
            console.warn(
                "[Sick Ollie Preview Core] Stored preview could not be restored. Queue once to refresh it.",
                data,
            );
            node.setDirtyCanvas?.(true, true);
        };
        image.src = imageDataToUrl(data);
        node.__soFitImages.push(image);
    }

    if (persist) {
        persistPreviewState(node, imageData);
    }

    node.setDirtyCanvas?.(true, true);
    return true;
}

function restoreStoredPreview(node, force = false) {
    const stored = node.properties?.[STORED_IMAGES_PROPERTY];
    if (!Array.isArray(stored) || !stored.length) return false;

    const storedIndex = Number(node.properties?.[STORED_INDEX_PROPERTY] || 0);
    node.__soFitImageIndex = Number.isFinite(storedIndex) ? storedIndex : 0;
    return loadPreviewImages(node, stored, { persist: false, force });
}

function loadExecutedPreviewImages(node, output) {
    const imageData = output?.images || output?.ui?.images || [];
    if (!Array.isArray(imageData)) return;
    loadPreviewImages(node, imageData, { persist: true, force: true });
}

function installPreviewCore(node) {
    if (node.__soPreviewCoreInstalled) return;
    node.__soPreviewCoreInstalled = true;
    node.__soFitImages = node.__soFitImages || [];
    node.__soFitImageIndex = node.__soFitImageIndex || 0;
    node.size = [Math.max(node.size?.[0] || 0, 480), Math.max(node.size?.[1] || 0, 620)];

    const originalExecuted = node.onExecuted;
    node.onExecuted = function (output) {
        try {
            originalExecuted?.apply(this, arguments);
        } catch (error) {
            console.warn("[Sick Ollie Preview Core] Original onExecuted failed", error);
        }
        loadExecutedPreviewImages(this, output);
    };

    const originalDrawBackground = node.onDrawBackground;
    node.onDrawBackground = function (ctx) {
        if (this.flags?.collapsed) {
            return originalDrawBackground?.apply(this, arguments);
        }

        if (!this.__soFitImages?.length && !this.__soFitImageLoadFailed) {
            restoreStoredPreview(this, false);
        }

        const images = this.__soFitImages || [];
        const image = images[this.__soFitImageIndex || 0] || images[0];
        const lastWidget = this.widgets?.reduce((maximum, item) => Math.max(maximum, (item.last_y || 0) + 28), 74) || 74;
        const x = 0;
        const y = lastWidget + 6;
        const width = this.size[0];
        const height = Math.max(20, this.size[1] - y);

        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, width, height);
        ctx.clip();

        const backgroundMode = widgetValue(this, "background_mode", "Solid");
        const backgroundColor = widgetValue(this, "background_color", "#111111");

        if (backgroundMode === "Checkerboard") {
            drawChecker(ctx, x, y, width, height);
        } else {
            ctx.fillStyle = backgroundColor;
            ctx.fillRect(x, y, width, height);
        }

        if (!image?.complete || !image?.naturalWidth || !image?.naturalHeight) {
            ctx.fillStyle = "rgba(255,255,255,.35)";
            ctx.font = "16px Segoe UI";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(
                this.__soFitImageLoadFailed
                    ? "Preview expired • queue once to refresh"
                    : "Waiting for image…",
                width / 2,
                y + height / 2,
            );
            ctx.restore();
            return;
        }

        const imageWidth = image.naturalWidth;
        const imageHeight = image.naturalHeight;

        if (backgroundMode === "Blurred Image") {
            const backgroundScale = Math.max(width / imageWidth, height / imageHeight);
            const backgroundWidth = imageWidth * backgroundScale;
            const backgroundHeight = imageHeight * backgroundScale;
            ctx.save();
            ctx.filter = "blur(26px) brightness(.45)";
            ctx.drawImage(image, x + (width - backgroundWidth) / 2, y + (height - backgroundHeight) / 2, backgroundWidth, backgroundHeight);
            ctx.restore();
        }

        const mode = widgetValue(this, "fit_mode", "Contain + Upscale");
        let drawX = x;
        let drawY = y;
        let drawWidth = width;
        let drawHeight = height;

        if (mode !== "Stretch") {
            let scale = 1;
            if (mode === "Contain + Upscale") {
                scale = Math.min(width / imageWidth, height / imageHeight);
            } else if (mode === "Cover") {
                scale = Math.max(width / imageWidth, height / imageHeight);
            } else if (mode === "Fit Width") {
                scale = width / imageWidth;
            } else if (mode === "Fit Height") {
                scale = height / imageHeight;
            } else if (mode === "Actual Size") {
                scale = 1;
            }
            drawWidth = imageWidth * scale;
            drawHeight = imageHeight * scale;
            drawX = x + (width - drawWidth) / 2;
            drawY = y + (height - drawHeight) / 2;
        }

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
        const border = ctx.createLinearGradient(x, y, x + width, y + height);
        border.addColorStop(0, "#35d7ff");
        border.addColorStop(.34, "#ff4ab8");
        border.addColorStop(.67, "#f6e65a");
        border.addColorStop(1, "#6ee7a2");
        ctx.globalAlpha = .58;
        ctx.strokeStyle = border;
        ctx.lineWidth = 1.25;
        ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
        ctx.globalAlpha = 1;
        ctx.restore();
    };

    // A workflow tab can recreate the graph without re-executing the node.
    // Restore the last temp-preview metadata after the node is installed.
    setTimeout(() => restoreStoredPreview(node, true), 0);
}

app.registerExtension({
    name: "SickOllie.Studio.PreviewCore",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== TARGET) return;
        const originalCreated = nodeType.prototype.onNodeCreated;
        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            this.bgcolor = "#000000";
            this.color = "#222222";
            installPreviewCore(this);
            return result;
        };
        nodeType.prototype.onConfigure = function (info) {
            const result = originalConfigure?.apply(this, arguments);
            this.bgcolor = "#000000";
            this.color = "#222222";
            installPreviewCore(this);
            setTimeout(() => restoreStoredPreview(this, true), 0);
            return result;
        };
    },
});
