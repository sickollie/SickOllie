import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { STUDIO_THEME, applyStudioNodeColors, drawStudioSectionFrame } from "./studio_theme.js";

const TARGET = "SOFitPreviewStudio";
const LEGACY_PREVIEW_TYPES = new Set(["SOFitPreview"]);
const STORED_IMAGES_PROPERTY = "so_fit_preview_images";
const STORED_INDEX_PROPERTY = "so_fit_preview_index";
const PINNED_IMAGES_PROPERTY = "so_fit_preview_pins";
const MAX_PINS = 6;
const PREVIEW_MIN_WIDTH = 620;
const COMPARE_GAP = 10;
const BASE_WIDTH_PROPERTY = "so_fit_preview_base_width";
const PREVIEW_UPDATED_PROPERTY = "so_fit_preview_updated_at";
const PREVIEW_CONTROLS_TOP = 58;
const PREVIEW_CONTROLS_HEIGHT = 40;
const PREVIEW_IMAGE_TOP = PREVIEW_CONTROLS_TOP + PREVIEW_CONTROLS_HEIGHT + 8;
const FIT_MODES = ["Contain + Upscale", "Cover", "Fit Width", "Fit Height", "Stretch", "Actual Size"];
const BACKGROUND_MODES = ["Solid", "Checkerboard", "Blurred Image"];

function migrateLegacyPreviewNodes(graphData) {
    let migrated = 0;
    const visited = new Set();

    const visit = (value) => {
        if (!value || typeof value !== "object" || visited.has(value)) return;
        visited.add(value);

        if (Array.isArray(value)) {
            for (const item of value) visit(item);
            return;
        }

        if (Array.isArray(value.nodes)) {
            for (const node of value.nodes) {
                if (node && typeof node === "object" && LEGACY_PREVIEW_TYPES.has(node.type)) {
                    node.type = TARGET;
                    migrated += 1;
                }
            }
        }

        for (const child of Object.values(value)) visit(child);
    };

    visit(graphData);
    return migrated;
}

function widgetValue(node, name, fallback) {
    const item = node.widgets?.find((w) => w.name === name);
    return item?.value ?? fallback;
}

function setWidgetValue(node, name, value) {
    const item = node.widgets?.find(widget => widget.name === name);
    if (!item) return;
    item.value = value;
    try { item.callback?.(value); } catch (error) {}
    node.setDirtyCanvas?.(true, true);
}

function hideBackingWidget(item) {
    if (!item || item.__soPreviewHidden) return;
    item.__soPreviewHidden = true;
    item.hidden = true;
    item.type = "so-preview-backing-widget";
    item.computeSize = () => [0, -4];
    if (item.inputEl) item.inputEl.style.visibility = "hidden";
}

function roundRect(ctx, x, y, width, height, radius, fill, stroke) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, width, height, radius);
    else { ctx.rect(x, y, width, height); }
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

function drawControl(ctx, hitMap, key, x, y, width, height, label, value, tone = STUDIO_THEME.cyan, active = false) {
    roundRect(ctx, x, y, width, height, 7, active ? `${tone}2e` : STUDIO_THEME.row, active ? tone : `${tone}88`);
    ctx.textBaseline = "middle"; ctx.font = "10px Segoe UI,Arial"; ctx.fillStyle = STUDIO_THEME.label; ctx.textAlign = "left"; ctx.fillText(label, x + 9, y + height / 2);
    ctx.font = "700 10px Segoe UI,Arial"; ctx.fillStyle = active ? tone : STUDIO_THEME.text; ctx.textAlign = "right"; ctx.fillText(String(value), x + width - 9, y + height / 2);
    hitMap[key] = { x, y, width, height };
}

function drawAction(ctx, hitMap, key, x, y, width, height, label, tone, active = false, pressed = false) {
    const lit = active || pressed;
    roundRect(ctx, x, y, width, height, 7, lit ? `${tone}46` : "rgba(35,32,42,.98)", lit ? tone : `${tone}88`);
    ctx.textBaseline = "middle"; ctx.textAlign = "center"; ctx.font = "700 10px Segoe UI,Arial"; ctx.fillStyle = lit ? "#fff" : tone;
    while (ctx.measureText(label).width > width - 14 && Number.parseInt(ctx.font, 10) > 8) {
        ctx.font = `${Number.parseInt(ctx.font, 10) - 1}px Segoe UI,Arial`;
    }
    ctx.fillText(label, x + width / 2, y + height / 2);
    hitMap[key] = { x, y, width, height };
}

function previewActionFeedback(node, key, message) {
    node.__soPreviewActionFeedback = { key, message, expiresAt: Date.now() + 950 };
    try { navigator?.vibrate?.(16); } catch (error) {}
    clearTimeout(node.__soPreviewActionFeedbackTimer);
    node.__soPreviewActionFeedbackTimer = setTimeout(() => {
        node.__soPreviewActionFeedback = null;
        node.setDirtyCanvas?.(true, true);
    }, 970);
    node.setDirtyCanvas?.(true, true);
}

function pointInHit(pos, hit) {
    return hit && pos && pos[0] >= hit.x && pos[0] <= hit.x + hit.width && pos[1] >= hit.y && pos[1] <= hit.y + hit.height;
}

function chooseValue(event, title, values, callback) {
    const items = values.map(value => ({ content: value, callback: () => callback(value) }));
    new LiteGraph.ContextMenu(items, { title, event });
}

function drawPreviewControls(node, ctx) {
    if (node.flags?.collapsed) return;
    const x = 10, y = PREVIEW_CONTROLS_TOP, width = previewPaneWidth(node) - 20, gap = 6, rowHeight = 29;
    node.__soPreviewHits = {};
    drawStudioSectionFrame(ctx, x - 3, y - 5, width + 6, PREVIEW_CONTROLS_HEIGHT, STUDIO_THEME.cyan, 9, .55);
    // Keep the display controls compact so the actions read as a single, useful toolbar.
    const fitWidth = Math.min(148, Math.max(78, Math.round(width * .10)));
    const backgroundWidth = Math.min(130, Math.max(64, Math.round(width * .09)));
    const colorWidth = Math.min(200, Math.max(50, Math.round(width * .11)));
    drawControl(ctx, node.__soPreviewHits, "fit", x, y, fitWidth, rowHeight, "FIT", widgetValue(node, "fit_mode", "Contain + Upscale"), STUDIO_THEME.cyan);
    drawControl(ctx, node.__soPreviewHits, "background", x + fitWidth + gap, y, backgroundWidth, rowHeight, "BG", widgetValue(node, "background_mode", "Solid"), STUDIO_THEME.magenta);
    drawControl(ctx, node.__soPreviewHits, "color", x + fitWidth + backgroundWidth + gap * 2, y, colorWidth, rowHeight, "BACKGROUND COLOR", widgetValue(node, "background_color", "#111111"), STUDIO_THEME.yellow);
    const actionX = x + fitWidth + backgroundWidth + colorWidth + gap * 3;
    const actionWidth = (width - fitWidth - backgroundWidth - colorWidth - gap * 7) / 5;
    const feedback = node.__soPreviewActionFeedback?.expiresAt > Date.now() ? node.__soPreviewActionFeedback : null;
    const actionLabel = (key, fallback) => feedback?.key === key ? feedback.message : fallback;
    const pressed = (key) => feedback?.key === key;
    drawAction(ctx, node.__soPreviewHits, "pin", actionX, y, actionWidth, rowHeight, actionLabel("pin", "📌 PIN"), STUDIO_THEME.cyan, false, pressed("pin"));
    drawAction(ctx, node.__soPreviewHits, "compare", actionX + (actionWidth + gap), y, actionWidth, rowHeight, actionLabel("compare", "◫ COMPARE"), STUDIO_THEME.magenta, Boolean(node.properties?.so_fit_preview_compare), pressed("compare"));
    drawAction(ctx, node.__soPreviewHits, "clear", actionX + (actionWidth + gap) * 2, y, actionWidth, rowHeight, actionLabel("clear", "CLEAR"), STUDIO_THEME.yellow, false, pressed("clear"));
    drawAction(ctx, node.__soPreviewHits, "library", actionX + (actionWidth + gap) * 3, y, actionWidth, rowHeight, actionLabel("library", "★ LIBRARY THUMB"), STUDIO_THEME.magenta, false, pressed("library"));
    drawAction(ctx, node.__soPreviewHits, "recipe", actionX + (actionWidth + gap) * 4, y, actionWidth, rowHeight, actionLabel("recipe", "📚 RECIPE"), STUDIO_THEME.green, false, pressed("recipe"));
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

function pinnedPreviewData(node) {
    const items = node.properties?.[PINNED_IMAGES_PROPERTY];
    return (Array.isArray(items) ? items : []).map(cleanImageData).filter(Boolean);
}

function previewPaneWidth(node) {
    const stored = Number(node.properties?.[BASE_WIDTH_PROPERTY]);
    if (Number.isFinite(stored) && stored >= PREVIEW_MIN_WIDTH) return stored;
    const current = Math.max(Number(node.size?.[0] || 0), PREVIEW_MIN_WIDTH);
    return node.__soCompareExpanded ? Math.max(PREVIEW_MIN_WIDTH, (current - COMPARE_GAP) / 2) : current;
}

function rememberPreviewPaneWidth(node, width) {
    const value = Math.max(PREVIEW_MIN_WIDTH, Math.round(Number(width) || PREVIEW_MIN_WIDTH));
    node.properties = node.properties || {};
    node.properties[BASE_WIDTH_PROPERTY] = value;
    return value;
}

function compareLayoutActive(node) {
    return Boolean(node.properties?.so_fit_preview_compare) && pinnedPreviewData(node).length > 0;
}

function syncCompareLayout(node) {
    node.properties = node.properties || {};
    let base = previewPaneWidth(node);
    const active = compareLayoutActive(node);
    const wasActive = Boolean(node.__soCompareExpanded);
    let changed = false;
    if (!Number.isFinite(Number(node.properties[BASE_WIDTH_PROPERTY]))) {
        base = rememberPreviewPaneWidth(node, node.__soCompareExpanded ? base : Math.max(Number(node.size?.[0] || 0), PREVIEW_MIN_WIDTH));
    }
    const desiredWidth = active ? base * 2 + COMPARE_GAP : base;
    if (Math.abs(Number(node.size?.[0] || 0) - desiredWidth) > 0.5) { node.size[0] = desiredWidth; changed = true; }
    const desiredHeight = Math.max(Number(node.size?.[1] || 0), 620);
    if (desiredHeight !== Number(node.size?.[1] || 0)) { node.size[1] = desiredHeight; changed = true; }
    node.__soCompareExpanded = active;
    if (wasActive !== active) changed = true;
    if (changed) node.setDirtyCanvas?.(true, true);
    return active;
}

function loadPinnedImages(node) {
    const data = pinnedPreviewData(node);
    const key = JSON.stringify(data);
    if (node.__soPinnedImageKey === key) return;
    node.__soPinnedImageKey = key;
    node.__soPinnedImages = data.map((entry) => {
        const image = new Image(); image.decoding = "async";
        image.onload = () => node.setDirtyCanvas?.(true, true);
        image.src = imageDataToUrl(entry);
        return image;
    });
    syncCompareLayout(node);
}

function pinCurrentPreview(node) {
    const current = cleanImageData(node.__soFitImageData?.[node.__soFitImageIndex || 0]);
    if (!current) return;
    node.properties = node.properties || {};
    const pins = pinnedPreviewData(node).filter((item) => JSON.stringify(item) !== JSON.stringify(current));
    pins.unshift(current);
    node.properties[PINNED_IMAGES_PROPERTY] = pins.slice(0, MAX_PINS);
    node.__soPinnedImageKey = "";
    loadPinnedImages(node);
    syncCompareLayout(node);
    node.setDirtyCanvas?.(true, true);
}

function clearPinnedPreviews(node) {
    node.properties = node.properties || {};
    node.properties[PINNED_IMAGES_PROPERTY] = [];
    node.__soPinnedImageKey = "";
    node.__soPinnedImages = [];
    syncCompareLayout(node);
    node.setDirtyCanvas?.(true, true);
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
    if (loadPreviewImages(node, imageData, { persist: true, force: true })) {
        node.properties = node.properties || {};
        node.properties[PREVIEW_UPDATED_PROPERTY] = Date.now();
    }
}

function drawPreviewPane(node, ctx, image, x, y, width, height, placeholder, label = "") {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();

    const backgroundMode = widgetValue(node, "background_mode", "Solid");
    const backgroundColor = widgetValue(node, "background_color", "#111111");
    if (backgroundMode === "Checkerboard") drawChecker(ctx, x, y, width, height);
    else { ctx.fillStyle = backgroundColor; ctx.fillRect(x, y, width, height); }

    if (image?.complete && image?.naturalWidth && image?.naturalHeight) {
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

        const mode = widgetValue(node, "fit_mode", "Contain + Upscale");
        let drawX = x, drawY = y, drawWidth = width, drawHeight = height;
        if (mode !== "Stretch") {
            let scale = 1;
            if (mode === "Contain + Upscale") scale = Math.min(width / imageWidth, height / imageHeight);
            else if (mode === "Cover") scale = Math.max(width / imageWidth, height / imageHeight);
            else if (mode === "Fit Width") scale = width / imageWidth;
            else if (mode === "Fit Height") scale = height / imageHeight;
            drawWidth = imageWidth * scale; drawHeight = imageHeight * scale;
            drawX = x + (width - drawWidth) / 2; drawY = y + (height - drawHeight) / 2;
        }
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    } else {
        ctx.fillStyle = "rgba(255,255,255,.35)";
        ctx.font = "16px Segoe UI"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(placeholder, x + width / 2, y + height / 2);
    }

    if (label) {
        ctx.font = "700 10px Segoe UI,Arial";
        const labelWidth = Math.ceil(ctx.measureText(label).width) + 18;
        roundRect(ctx, x + 10, y + 10, labelWidth, 24, 6, "rgba(5,5,8,.74)", "rgba(246,230,90,.72)");
        ctx.fillStyle = "#f6e65a"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
        ctx.fillText(label, x + 19, y + 22);
    }

    const border = ctx.createLinearGradient(x, y, x + width, y + height);
    border.addColorStop(0, "#35d7ff"); border.addColorStop(.34, "#ff4ab8"); border.addColorStop(.67, "#f6e65a"); border.addColorStop(1, "#6ee7a2");
    ctx.globalAlpha = .58; ctx.strokeStyle = border; ctx.lineWidth = 1.25;
    ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
    ctx.globalAlpha = 1;
    ctx.restore();
}

function installPreviewCore(node) {
    if (node.__soPreviewCoreInstalled) return;
    node.__soPreviewCoreInstalled = true;
    node.__soFitImages = node.__soFitImages || [];
    node.__soFitImageIndex = node.__soFitImageIndex || 0;
    node.__soPinnedImages = node.__soPinnedImages || [];
    node.size = [Math.max(node.size?.[0] || 0, PREVIEW_MIN_WIDTH), Math.max(node.size?.[1] || 0, 620)];
    if (!Number.isFinite(Number(node.properties?.[BASE_WIDTH_PROPERTY]))) rememberPreviewPaneWidth(node, node.size[0]);
    syncCompareLayout(node);
    applyStudioNodeColors(node);
    for (const name of ["fit_mode", "background_mode", "background_color"]) hideBackingWidget(node.widgets?.find(widget => widget.name === name));
    node.widgets_start_y = PREVIEW_IMAGE_TOP;

    const originalExecuted = node.onExecuted;
    node.onExecuted = function (output) {
        try {
            originalExecuted?.apply(this, arguments);
        } catch (error) {
            console.warn("[Sick Ollie Preview Core] Original onExecuted failed", error);
        }
        loadExecutedPreviewImages(this, output);
        const previewData = cleanImageData(this.__soFitImageData?.[this.__soFitImageIndex || 0]);
        if (previewData) {
            window.dispatchEvent(new CustomEvent("sickollie:preview-executed", {
                detail: { source: "preview", nodeId: this.id, previewData },
            }));
        }
    };

    const originalDrawBackground = node.onDrawBackground;
    node.onDrawBackground = function (ctx) {
        if (this.flags?.collapsed) return originalDrawBackground?.apply(this, arguments);
        if (!this.__soFitImages?.length && !this.__soFitImageLoadFailed) restoreStoredPreview(this, false);
        loadPinnedImages(this);
        const compareActive = syncCompareLayout(this);
        const paneWidth = previewPaneWidth(this);
        const y = PREVIEW_IMAGE_TOP;
        const height = Math.max(20, this.size[1] - y);
        const images = this.__soFitImages || [];
        const image = images[this.__soFitImageIndex || 0] || images[0];
        drawPreviewPane(
            this, ctx, image, 0, y, paneWidth, height,
            this.__soFitImageLoadFailed ? "Preview expired • queue once to refresh" : "Waiting for image…",
        );
        if (compareActive) {
            const pinned = (this.__soPinnedImages || [])[0];
            drawPreviewPane(this, ctx, pinned, paneWidth + COMPARE_GAP, y, paneWidth, height, "Loading pinned reference…", "PINNED REFERENCE");
        }
    };

    const originalDrawForeground = node.onDrawForeground;
    node.onDrawForeground = function (ctx) {
        try { originalDrawForeground?.apply(this, arguments); } catch (error) {}
        drawPreviewControls(this, ctx);
    };

    const originalMouseDown = node.onMouseDown;
    node.onMouseDown = function (event, pos, canvas) {
        const hits = this.__soPreviewHits || {};
        if (pointInHit(pos, hits.fit)) { chooseValue(event, "Preview fit", FIT_MODES, value => setWidgetValue(this, "fit_mode", value)); return true; }
        if (pointInHit(pos, hits.background)) { chooseValue(event, "Preview background", BACKGROUND_MODES, value => setWidgetValue(this, "background_mode", value)); return true; }
        if (pointInHit(pos, hits.color)) { app.canvas.prompt("Preview background color", widgetValue(this, "background_color", "#111111"), value => setWidgetValue(this, "background_color", String(value || "#111111")), event); return true; }
        if (pointInHit(pos, hits.pin)) { pinCurrentPreview(this); previewActionFeedback(this, "pin", "✓ PINNED"); return true; }
        if (pointInHit(pos, hits.compare)) {
            this.properties = this.properties || {};
            this.properties.so_fit_preview_compare = !Boolean(this.properties.so_fit_preview_compare);
            syncCompareLayout(this);
            previewActionFeedback(this, "compare", this.properties.so_fit_preview_compare ? "✓ COMPARE ON" : "✓ COMPARE OFF");
            return true;
        }
        if (pointInHit(pos, hits.clear)) { clearPinnedPreviews(this); previewActionFeedback(this, "clear", "✓ CLEARED"); return true; }
        if (pointInHit(pos, hits.library)) {
            const previewData = cleanImageData(this.__soFitImageData?.[this.__soFitImageIndex || 0]);
            window.dispatchEvent(new CustomEvent("sickollie:set-lora-thumbnail", {
                detail: { source: "preview", previewData },
            }));
            previewActionFeedback(this, "library", "✓ THUMBNAIL SET");
            return true;
        }
        if (pointInHit(pos, hits.recipe)) {
            const previewData = cleanImageData(this.__soFitImageData?.[this.__soFitImageIndex || 0]);
            window.dispatchEvent(new CustomEvent("sickollie:save-studio-recipe", {
                detail: { source: "preview", defaultName: "New prompt recipe", previewData },
            }));
            previewActionFeedback(this, "recipe", "✓ RECIPE SAVED");
            return true;
        }
        return originalMouseDown?.apply(this, arguments);
    };

    const originalResize = node.onResize;
    node.onResize = function (size) {
        const active = compareLayoutActive(this);
        const requestedWidth = Math.max(Number(size?.[0] ?? this.size?.[0] ?? PREVIEW_MIN_WIDTH), PREVIEW_MIN_WIDTH);
        const base = rememberPreviewPaneWidth(this, active ? (requestedWidth - COMPARE_GAP) / 2 : requestedWidth);
        if (Array.isArray(size) || (size && typeof size === "object")) size[0] = active ? base * 2 + COMPARE_GAP : base;
        const result = originalResize?.apply(this, arguments);
        this.size[0] = active ? base * 2 + COMPARE_GAP : base;
        this.size[1] = Math.max(Number(this.size?.[1] || 0), 620);
        this.__soCompareExpanded = active;
        this.setDirtyCanvas?.(true, true);
        return result;
    };

    // A workflow tab can recreate the graph without re-executing the node.
    // Restore the last temp-preview metadata after the node is installed.
    setTimeout(() => restoreStoredPreview(node, true), 0);
}

app.registerExtension({
    name: "SickOllie.Studio.PreviewCore",
    async beforeConfigureGraph(graphData) {
        const migrated = migrateLegacyPreviewNodes(graphData);
        if (migrated > 0) {
            console.info(`[Sick Ollie] Upgraded ${migrated} legacy Preview Core node${migrated === 1 ? "" : "s"} to Studio Preview Core.`);
        }
    },
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
            installPreviewCore(this);
            this.size[1] = Math.max(this.size?.[1] || 0, 620);
            syncCompareLayout(this);
            applyStudioNodeColors(this);
            for (const name of ["fit_mode", "background_mode", "background_color"]) hideBackingWidget(this.widgets?.find(widget => widget.name === name));
            this.widgets_start_y = PREVIEW_IMAGE_TOP;
            setTimeout(() => restoreStoredPreview(this, true), 0);
            return result;
        };
    },
});
