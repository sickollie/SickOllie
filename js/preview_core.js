import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const TARGET = "SOFitPreview";

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

function loadExecutedPreviewImages(node, output) {
    const imageData = output?.images || output?.ui?.images || [];
    if (!Array.isArray(imageData)) return;

    node.__soFitImages = [];
    node.__soFitImageIndex = 0;

    for (const data of imageData) {
        const image = new Image();
        image.onload = () => node.setDirtyCanvas?.(true, true);
        image.onerror = () => console.error("[Sick Ollie Preview Core] Failed to load preview image", data);
        image.src = imageDataToUrl(data);
        node.__soFitImages.push(image);
    }

    node.setDirtyCanvas?.(true, true);
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
            ctx.fillText("Waiting for image…", width / 2, y + height / 2);
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
        ctx.strokeStyle = "rgba(255,255,255,.15)";
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
        ctx.restore();
    };
}

app.registerExtension({
    name: "SickOllie.PreviewCore",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== TARGET) return;
        const originalCreated = nodeType.prototype.onNodeCreated;
        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            installPreviewCore(this);
            return result;
        };
        nodeType.prototype.onConfigure = function (info) {
            const result = originalConfigure?.apply(this, arguments);
            installPreviewCore(this);
            return result;
        };
    },
});
