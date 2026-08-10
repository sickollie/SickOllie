import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

const TARGET = "SOImageMetadataCoreStudio";
const PREVIEW_PROP = "so_metadata_preview_images";
const HIDDEN_FIELDS = [
    "status",
    "final_prompt_display",
    "source_prompt_display",
    "generation_display",
    "models_display",
    "prompt_log_display",
    "outfit_a_display",
    "outfit_b_display",
    "outfit_c_display",
    "scene_display",
    "substitutions_display",
];

const MIN_WIDTH = 1280;
const DEFAULT_WIDTH = 1340;
const MIN_HEIGHT = 1120;
const DEFAULT_HEIGHT = 1340;
const MAX_AUTO_WIDTH = 2320;
const LEFT_MIN = 500;
const LEFT_MAX = 610;
const GAP = 16;
const PAD = 14;

function widget(node, name) {
    return node.widgets?.find((item) => item.name === name);
}

function unwrap(value) {
    let current = value;
    while (Array.isArray(current) && current.length === 1) current = current[0];
    return current;
}

function normalizePayload(value) {
    let current = unwrap(value);
    if (typeof current === "string") {
        try { current = JSON.parse(current); }
        catch (error) { current = {}; }
    }
    return current && typeof current === "object" ? current : {};
}

function setWidgetText(node, name, value) {
    const target = widget(node, name);
    if (!target) return;
    const text = value == null ? "" : String(value);
    target.value = text;
    if (target.inputEl) target.inputEl.value = text;
}

function hideBackingWidget(target) {
    if (!target) return;
    target.computeSize = () => [0, 0];
    target.hidden = true;
    if (target.inputEl) {
        target.inputEl.style.display = "none";
        target.inputEl.style.height = "0px";
        target.inputEl.style.minHeight = "0px";
        target.inputEl.style.maxHeight = "0px";
    }
}

async function copyText(text) {
    const value = String(text ?? "");
    if (!value.trim()) return false;
    try {
        await navigator.clipboard.writeText(value);
        return true;
    } catch (error) {
        try {
            const input = document.createElement("textarea");
            input.value = value;
            input.style.position = "fixed";
            input.style.opacity = "0";
            document.body.append(input);
            input.select();
            document.execCommand("copy");
            input.remove();
            return true;
        } catch (fallbackError) {
            return false;
        }
    }
}

function imageDataToUrl(data) {
    const filename = encodeURIComponent(data?.filename || "");
    const type = encodeURIComponent(data?.type || "input");
    const subfolder = encodeURIComponent(data?.subfolder || "");
    return api.apiURL(
        `/view?filename=${filename}&type=${type}&subfolder=${subfolder}` +
        `${app.getPreviewFormatParam?.() || ""}${app.getRandParam?.() || ""}`,
    );
}

function cleanImageData(data) {
    if (!data || typeof data !== "object" || !data.filename) return null;
    return {
        filename: String(data.filename),
        type: String(data.type || "input"),
        subfolder: String(data.subfolder || ""),
    };
}

function clearPreview(node) {
    node.__soMetadataPreviewData = [];
    node.__soMetadataPreviewImages = [];
    node.properties = node.properties || {};
    node.properties[PREVIEW_PROP] = [];
    node.images = [];
    node.imgs = [];
    node.imageRects = [];
    node.imageIndex = null;
    node.overIndex = null;
    node.animatedImages = false;
    node.setDirtyCanvas?.(true, true);
}

function loadPreview(node, sourceData, persist = true) {
    const data = (Array.isArray(sourceData) ? sourceData : []).map(cleanImageData).filter(Boolean);
    if (!data.length) {
        clearPreview(node);
        return;
    }

    node.__soMetadataPreviewData = data;
    node.__soMetadataPreviewImages = [];
    if (persist) {
        node.properties = node.properties || {};
        node.properties[PREVIEW_PROP] = data.map((item) => ({ ...item }));
    }

    for (const item of data) {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => {
            autoFitMetadataWidth(node, image.naturalWidth, image.naturalHeight);
            node.setDirtyCanvas?.(true, true);
        };
        image.onerror = () => node.setDirtyCanvas?.(true, true);
        image.src = imageDataToUrl(item);
        node.__soMetadataPreviewImages.push(image);
    }

    node.images = [];
    node.imgs = [];
    node.imageRects = [];
    node.imageIndex = null;
    node.overIndex = null;
    node.animatedImages = false;
    node.setDirtyCanvas?.(true, true);
}

async function fetchUploadedMetadata(imageFile) {
    const value = String(imageFile ?? "").trim();
    if (!value || value === "[None]") return null;
    const response = await fetch(`/sickollie/metadata-core/read?image_file=${encodeURIComponent(value)}`, { method: "GET" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
}

function currentImageToken(node) {
    return String(widget(node, "image_file")?.value || "").trim();
}

function setImageToken(node, value) {
    const imageFile = widget(node, "image_file");
    if (!imageFile) return;
    imageFile.value = value || "[None]";
    if (imageFile.inputEl) imageFile.inputEl.value = imageFile.value;
}

async function clearTempOnServer(token) {
    const value = String(token || "").trim();
    if (!value.startsWith("so-temp::")) return;
    try {
        await fetch("/sickollie/metadata-core/clear-temp", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ image_file: value }),
        });
    } catch (error) {
        console.warn("[Sick Ollie Image Metadata Core] Could not remove temp image", error);
    }
}

async function clearLoadedImage(node, deleteTemp = true) {
    const previous = currentImageToken(node);
    node.__soMetadataRequest = Symbol("metadata_clear");
    setImageToken(node, "[None]");
    applyPayload(node, {});
    clearPreview(node);
    if (deleteTemp) await clearTempOnServer(previous);
}

async function refreshFromImageFile(node, imageFile) {
    const token = Symbol("metadata_request");
    node.__soMetadataRequest = token;
    const value = String(imageFile ?? "").trim();
    if (!value || value === "[None]") {
        applyPayload(node, {});
        clearPreview(node);
        return;
    }

    try {
        const result = await fetchUploadedMetadata(value);
        if (node.__soMetadataRequest !== token) return;
        applyPayload(node, result?.payload || {});
        loadPreview(node, result?.images || [], true);
    } catch (error) {
        // A temp file may legitimately disappear between Comfy sessions.
        // Clear it quietly instead of leaving a broken saved path behind.
        console.warn("[Sick Ollie Image Metadata Core] Could not preload metadata", error);
        if (String(value).startsWith("so-temp::")) {
            setImageToken(node, "[None]");
            applyPayload(node, {});
            clearPreview(node);
        }
    }
}

async function uploadTempFile(node, file) {
    if (!file) return;
    const lower = String(file.name || "").toLowerCase();
    if (!/\.(png|jpe?g|webp)$/.test(lower)) {
        console.warn("[Sick Ollie Image Metadata Core] Unsupported image type", file.name);
        return;
    }

    const requestToken = Symbol("metadata_upload");
    node.__soMetadataRequest = requestToken;
    const previous = currentImageToken(node);
    const form = new FormData();
    // Append the old temp token first so the server can safely dispose of it
    // after the new image has been validated.
    form.append("previous_token", previous);
    form.append("file", file, file.name);

    try {
        const response = await fetch("/sickollie/metadata-core/upload-temp", {
            method: "POST",
            body: form,
        });
        const result = await response.json();
        if (!response.ok || !result?.ok) throw new Error(result?.error || `HTTP ${response.status}`);
        if (node.__soMetadataRequest !== requestToken) return;

        setImageToken(node, result.image_file || "[None]");
        applyPayload(node, result.payload || {});
        loadPreview(node, result.images || [], true);
    } catch (error) {
        console.warn("[Sick Ollie Image Metadata Core] Could not upload temp image", error);
    }
}

function chooseTempFile(node) {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp";
    input.style.display = "none";
    input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (file) uploadTempFile(node, file);
        input.remove();
    }, { once: true });
    document.body.appendChild(input);
    input.click();
}

function makeUploadButton(node) {
    if (node.__soUploadButton) return node.__soUploadButton;
    const button = node.addWidget("button", "choose file to upload", null, () => chooseTempFile(node), { serialize: false });
    button.serialize = false;
    button.options = { ...(button.options || {}), serialize: false };
    node.__soUploadButton = button;
    return button;
}

function makeClearButton(node) {
    if (node.__soClearButton) return node.__soClearButton;
    const button = node.addWidget("button", "Clear loaded image", null, () => clearLoadedImage(node, true), { serialize: false });
    button.serialize = false;
    button.options = { ...(button.options || {}), serialize: false };
    node.__soClearButton = button;
    return button;
}

function makeSeedButton(node) {
    if (node.__soSeedButton) return node.__soSeedButton;
    const button = node.addWidget("button", "", null, async () => {
        const seed = String(node.__soMetadataPayload?.seed_text || "").trim();
        if (!seed) return;
        if (await copyText(seed)) {
            const normal = `📋 Copy seed: ${seed}`;
            button.name = "✓ Copied seed";
            node.setDirtyCanvas?.(true, true);
            clearTimeout(button.__soTimer);
            button.__soTimer = setTimeout(() => {
                button.name = normal;
                node.setDirtyCanvas?.(true, true);
            }, 850);
        }
    }, { serialize: false });
    button.serialize = false;
    button.options = { ...(button.options || {}), serialize: false };
    node.__soSeedButton = button;
    return button;
}

function moveWidgetToIndex(node, moving, targetIndex) {
    if (!moving || !node.widgets) return;
    const from = node.widgets.indexOf(moving);
    if (from >= 0) node.widgets.splice(from, 1);
    const bounded = Math.max(0, Math.min(targetIndex, node.widgets.length));
    node.widgets.splice(bounded, 0, moving);
}

function constrainTopWidget(target) {
    if (!target) return;
    target.computeSize = (width) => [width || 0, 30];
}

function arrangeTopWidgets(node) {
    const imageFile = widget(node, "image_file");
    const upload = makeUploadButton(node);
    const clear = makeClearButton(node);
    const seed = makeSeedButton(node);

    // image_file remains serialized as our private source token, but is not a
    // user-facing path/dropdown anymore.
    hideBackingWidget(imageFile);

    moveWidgetToIndex(node, upload, 0);
    moveWidgetToIndex(node, clear, 1);
    moveWidgetToIndex(node, seed, 2);

    constrainTopWidget(upload);
    constrainTopWidget(clear);
    if (seed) constrainTopWidget(seed);
}

function applyPayload(node, payloadValue) {
    const payload = normalizePayload(payloadValue);
    node.__soMetadataPayload = payload;
    node.properties = node.properties || {};
    node.properties.so_metadata_core_payload = payload;

    setWidgetText(node, "status", payload.status || "");
    setWidgetText(node, "final_prompt_display", payload.final_prompt || "");
    setWidgetText(node, "source_prompt_display", payload.source_prompt || "");
    setWidgetText(node, "generation_display", payload.generation || "");
    setWidgetText(node, "models_display", payload.models || "");
    setWidgetText(node, "prompt_log_display", payload.resolved_inputs || "");

    const seed = makeSeedButton(node);
    const seedText = String(payload.seed_text || "").trim();
    seed.name = seedText ? `📋 Copy seed: ${seedText}` : "";
    seed.computeSize = (width) => [width || 0, seedText ? 30 : 0];

    node.setDirtyCanvas?.(true, true);
}

function hasWiredImage(node) {
    const input = node.inputs?.find((item) => item.name === "images");
    return input?.link != null;
}

function clearForExecution(node) {
    if (!hasWiredImage(node)) return;
    const previous = currentImageToken(node);
    node.__soMetadataRequest = Symbol("cleared_for_execution");
    setImageToken(node, "[None]");
    applyPayload(node, {});
    clearPreview(node);
    // Fire-and-forget cleanup; execution should never wait on housekeeping.
    clearTempOnServer(previous);
}

function contentTop(node) {
    const seed = node.__soSeedButton;
    const clear = node.__soClearButton;
    const upload = node.__soUploadButton;
    const ys = [seed?.last_y, clear?.last_y, upload?.last_y].filter((v) => Number.isFinite(v));
    if (ys.length) return Math.max(...ys) + 48;
    return 245;
}

function autoFitMetadataWidth(node, imageWidth, imageHeight) {
    const iw = Number(imageWidth), ih = Number(imageHeight);
    if (!(iw > 0 && ih > 0) || !node?.size) return;
    const height = Math.max(Number(node.size[1] || DEFAULT_HEIGHT), MIN_HEIGHT);
    const top = contentTop(node);
    const contentH = Math.max(260, height - top - PAD);
    const aspect = iw / ih;
    let target = Math.max(MIN_WIDTH, Number(node.size[0] || DEFAULT_WIDTH));
    for (let i = 0; i < 4; i++) {
        const leftW = Math.max(LEFT_MIN, Math.min(LEFT_MAX, Math.round(target * .36)));
        target = PAD + leftW + GAP + contentH * aspect + PAD;
    }
    target = Math.max(MIN_WIDTH, Math.min(MAX_AUTO_WIDTH, Math.round(target)));
    if (Math.abs(Number(node.size[0] || 0) - target) > 8) node.size[0] = target;
    node.setDirtyCanvas?.(true, true);
}

function columnGeometry(node) {
    const width = node.size?.[0] || MIN_WIDTH;
    const height = node.size?.[1] || MIN_HEIGHT;
    const top = contentTop(node);
    const leftW = Math.max(LEFT_MIN, Math.min(LEFT_MAX, Math.round(width * 0.36)));
    const rightX = PAD + leftW + GAP;
    return {
        top,
        bottom: height - PAD,
        leftX: PAD,
        leftW,
        rightX,
        rightW: Math.max(320, width - rightX - PAD),
        contentH: Math.max(260, height - top - PAD),
    };
}

function roundedRect(ctx, x, y, w, h, r = 8) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
}

function wrapLines(ctx, text, maxWidth) {
    const output = [];
    for (const paragraph of String(text || "").split(/\r?\n/)) {
        if (!paragraph.trim()) {
            output.push("");
            continue;
        }
        const words = paragraph.split(/\s+/);
        let line = "";
        for (const word of words) {
            const test = line ? `${line} ${word}` : word;
            if (ctx.measureText(test).width <= maxWidth || !line) {
                line = test;
            } else {
                output.push(line);
                line = word;
            }
        }
        if (line) output.push(line);
    }
    return output;
}

const SO_META_CMYKG = {
    cyan: "#35d7ff",
    magenta: "#ff4ab8",
    yellow: "#f6e65a",
    green: "#6ee7a2",
};

function metadataAccentForTitle(title) {
    const key = String(title || "").toUpperCase();
    if (key.includes("FINAL")) return SO_META_CMYKG.magenta;
    if (key.includes("SOURCE")) return SO_META_CMYKG.yellow;
    if (key.includes("META")) return SO_META_CMYKG.green;
    return SO_META_CMYKG.cyan;
}

function drawTextBox(ctx, rect, title, text) {
    roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, 8);
    ctx.fillStyle = "#202020";
    ctx.fill();
    const accent = metadataAccentForTitle(title);
    const border = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
    border.addColorStop(0, SO_META_CMYKG.cyan);
    border.addColorStop(.34, SO_META_CMYKG.magenta);
    border.addColorStop(.67, SO_META_CMYKG.yellow);
    border.addColorStop(1, SO_META_CMYKG.green);
    ctx.save();
    ctx.globalAlpha = .58;
    ctx.strokeStyle = border;
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.beginPath();
    ctx.rect(rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2);
    ctx.clip();

    ctx.fillStyle = accent;
    ctx.font = "700 12px Segoe UI";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText(title, rect.x + 10, rect.y + 8);

    ctx.fillStyle = "#f2f2f2";
    ctx.font = "13px Consolas, monospace";
    const lines = wrapLines(ctx, text, rect.w - 20);
    const lineH = 16;
    const textY = rect.y + 29;
    const maxLines = Math.max(1, Math.floor((rect.h - 38) / lineH));
    const shown = lines.slice(0, maxLines);
    for (let i = 0; i < shown.length; i++) {
        let line = shown[i];
        if (i === maxLines - 1 && lines.length > maxLines && line) line = `${line} …`;
        ctx.fillText(line, rect.x + 10, textY + i * lineH);
    }
    ctx.restore();
}

function drawCopyButton(ctx, rect, label, enabled) {
    roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, 6);
    ctx.fillStyle = enabled ? "#252529" : "#18181b";
    ctx.fill();
    const accent = metadataAccentForTitle(label);
    ctx.strokeStyle = enabled ? `${accent}77` : "rgba(255,255,255,.08)";
    ctx.stroke();
    ctx.fillStyle = enabled ? "#f3f3f3" : "rgba(255,255,255,.25)";
    ctx.font = "13px Segoe UI";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 0.5);
}

function drawPreviewPanel(node, ctx, rect) {
    roundedRect(ctx, rect.x, rect.y, rect.w, rect.h, 10);
    ctx.fillStyle = "#080808";
    ctx.fill();
    const previewGradient = ctx.createLinearGradient(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h);
    previewGradient.addColorStop(0, `${SO_META_CMYKG.cyan}88`);
    previewGradient.addColorStop(.55, `${SO_META_CMYKG.magenta}66`);
    previewGradient.addColorStop(1, `${SO_META_CMYKG.green}66`);
    ctx.strokeStyle = previewGradient;
    ctx.lineWidth = 1.25;
    ctx.stroke();

    const image = node.__soMetadataPreviewImages?.[0];
    if (!image?.complete || !image.naturalWidth || !image.naturalHeight) {
        ctx.fillStyle = "rgba(255,255,255,.30)";
        ctx.font = "14px Segoe UI";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(hasWiredImage(node) ? "Waiting for next image…" : "Load an image to inspect", rect.x + rect.w / 2, rect.y + rect.h / 2);
        return;
    }

    ctx.save();
    roundedRect(ctx, rect.x + 1, rect.y + 1, rect.w - 2, rect.h - 2, 9);
    ctx.clip();
    const scale = Math.min(rect.w / image.naturalWidth, rect.h / image.naturalHeight);
    const drawW = image.naturalWidth * scale;
    const drawH = image.naturalHeight * scale;
    const drawX = rect.x + (rect.w - drawW) / 2;
    const drawY = rect.y + (rect.h - drawH) / 2;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, drawX, drawY, drawW, drawH);
    ctx.restore();
}

function layoutInspector(node) {
    const g = columnGeometry(node);
    const payload = node.__soMetadataPayload || {};
    const status = String(payload.status || "").trim();
    const finalPrompt = String(payload.final_prompt || "").trim();
    const sourcePrompt = String(payload.source_prompt || "").trim();
    const metadata = String(payload.resolved_inputs || "").trim();

    const buttonH = 30;
    const sectionGap = 10;
    const statusH = status ? 76 : 0;
    const finalH = finalPrompt ? 220 : 0;
    const sourceH = sourcePrompt ? 175 : 0;
    const buttonCount = (finalPrompt ? 1 : 0) + (sourcePrompt ? 1 : 0) + (metadata ? 1 : 0);
    const fixed = statusH + finalH + sourceH + buttonCount * buttonH + sectionGap * 7;
    const metaH = metadata ? Math.max(230, g.contentH - fixed) : 0;

    let y = g.top;
    const layout = { buttons: {}, preview: { x: g.rightX, y: g.top, w: g.rightW, h: g.contentH } };
    if (status) {
        layout.status = { x: g.leftX, y, w: g.leftW, h: statusH };
        y += statusH + sectionGap;
    }
    if (finalPrompt) {
        layout.final = { x: g.leftX, y, w: g.leftW, h: finalH };
        y += finalH + 6;
        layout.buttons.final = { x: g.leftX, y, w: g.leftW, h: buttonH };
        y += buttonH + sectionGap;
    }
    if (sourcePrompt) {
        layout.source = { x: g.leftX, y, w: g.leftW, h: sourceH };
        y += sourceH + 6;
        layout.buttons.source = { x: g.leftX, y, w: g.leftW, h: buttonH };
        y += buttonH + sectionGap;
    }
    if (metadata) {
        layout.metadata = { x: g.leftX, y, w: g.leftW, h: Math.max(180, Math.min(metaH, g.bottom - y - buttonH - 8)) };
        y += layout.metadata.h + 6;
        layout.buttons.report = { x: g.leftX, y, w: g.leftW, h: buttonH };
    }
    return layout;
}

function drawInspector(node, ctx) {
    if (node.flags?.collapsed) return;
    const payload = node.__soMetadataPayload || {};
    const layout = layoutInspector(node);
    node.__soMetadataHitRects = layout.buttons;

    ctx.save();
    if (layout.status) drawTextBox(ctx, layout.status, "IMAGE", payload.status || "");
    if (layout.final) drawTextBox(ctx, layout.final, "FINAL PROMPT", payload.final_prompt || "");
    if (layout.source) drawTextBox(ctx, layout.source, "SOURCE PROMPT", payload.source_prompt || "");
    if (layout.metadata) drawTextBox(ctx, layout.metadata, "METADATA", payload.resolved_inputs || "");

    if (layout.buttons.final) drawCopyButton(ctx, layout.buttons.final, "📋 Copy final prompt", Boolean(payload.final_prompt));
    if (layout.buttons.source) drawCopyButton(ctx, layout.buttons.source, "📋 Copy source prompt", Boolean(payload.source_prompt));
    if (layout.buttons.report) drawCopyButton(ctx, layout.buttons.report, "📋 Copy full metadata report", Boolean(payload.full_report));
    drawPreviewPanel(node, ctx, layout.preview);
    ctx.restore();
}

function pointInRect(pos, rect) {
    if (!rect || !Array.isArray(pos)) return false;
    return pos[0] >= rect.x && pos[0] <= rect.x + rect.w && pos[1] >= rect.y && pos[1] <= rect.y + rect.h;
}

function installNode(node) {
    node.properties = node.properties || {};
    node.bgcolor = "#000000";
    for (const name of HIDDEN_FIELDS) hideBackingWidget(widget(node, name));
    arrangeTopWidgets(node);

    if (!node.__soMetadataDrawInstalled) {
        node.__soMetadataDrawInstalled = true;
        // This node renders its own preview panel. Do not let Comfy's native
        // image-preview hooks paint the same image a second time underneath/
        // beside our custom preview.
        node.onDrawBackground = function () {};
        node.onDrawForeground = function (ctx) {
            drawInspector(this, ctx);
        };

        const originalDragOver = node.onDragOver;
        node.onDragOver = function (event) {
            if (event?.dataTransfer?.types?.includes?.("Files")) return true;
            return originalDragOver?.apply(this, arguments);
        };

        const originalDragDrop = node.onDragDrop;
        node.onDragDrop = function (event) {
            const file = event?.dataTransfer?.files?.[0];
            if (file && /\.(png|jpe?g|webp)$/i.test(file.name || "")) {
                uploadTempFile(this, file);
                return true;
            }
            return originalDragDrop?.apply(this, arguments);
        };

        const originalMouseDown = node.onMouseDown;
        node.onMouseDown = function (event, pos, graphCanvas) {
            const rects = this.__soMetadataHitRects || {};
            const payload = this.__soMetadataPayload || {};
            if (pointInRect(pos, rects.final)) {
                copyText(payload.final_prompt || "");
                return true;
            }
            if (pointInRect(pos, rects.source)) {
                copyText(payload.source_prompt || "");
                return true;
            }
            if (pointInRect(pos, rects.report)) {
                copyText(payload.full_report || "");
                return true;
            }
            return originalMouseDown?.apply(this, arguments);
        };
    }

    if (node.properties.so_metadata_core_payload) applyPayload(node, node.properties.so_metadata_core_payload);
    else applyPayload(node, {});

    const storedPreview = node.properties?.[PREVIEW_PROP];
    if (Array.isArray(storedPreview) && storedPreview.length && !node.__soMetadataPreviewImages?.length) {
        loadPreview(node, storedPreview, false);
    }

    node.size = [Math.max(node.size?.[0] || DEFAULT_WIDTH, MIN_WIDTH), Math.max(node.size?.[1] || DEFAULT_HEIGHT, MIN_HEIGHT)];
    setTimeout(() => arrangeTopWidgets(node), 0);
    setTimeout(() => arrangeTopWidgets(node), 150);
    node.setDirtyCanvas?.(true, true);
}

app.registerExtension({
    name: "SickOllie.Studio.ImageMetadataCore",
    async setup() {
        api.addEventListener("execution_start", () => {
            for (const node of app.graph?._nodes || []) {
                if (node?.type === TARGET || node?.comfyClass === TARGET) clearForExecution(node);
            }
        });
    },
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== TARGET) return;

        const originalCreated = nodeType.prototype.onNodeCreated;
        const originalConfigured = nodeType.prototype.onConfigure;
        const originalExecuted = nodeType.prototype.onExecuted;
        const originalSerialized = nodeType.prototype.onSerialize;

        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            this.size = [Math.max(DEFAULT_WIDTH, MIN_WIDTH), DEFAULT_HEIGHT];
            setTimeout(() => {
                installNode(this);
                const imageFile = widget(this, "image_file")?.value;
                if (imageFile && imageFile !== "[None]") refreshFromImageFile(this, imageFile);
            }, 0);
            return result;
        };

        nodeType.prototype.onConfigure = function (info) {
            const result = originalConfigured?.apply(this, arguments);
            this.properties = this.properties || {};
            const payload = info?.properties?.so_metadata_core_payload || this.properties.so_metadata_core_payload;
            setTimeout(() => {
                installNode(this);
                if (payload) applyPayload(this, payload);
                const imageFile = widget(this, "image_file")?.value;
                if (imageFile && imageFile !== "[None]" && !hasWiredImage(this)) refreshFromImageFile(this, imageFile);
            }, 0);
            return result;
        };

        nodeType.prototype.onExecuted = function (message) {
            // Do not call Comfy's inherited image-preview execution handler here.
            // It creates the stock preview in addition to our custom side panel.
            applyPayload(this, message?.metadata_payload || {});
            loadPreview(this, message?.images || message?.ui?.images || [], true);
            this.images = [];
            this.imgs = [];
            this.imageRects = [];
            this.imageIndex = null;
            this.overIndex = null;
            this.animatedImages = false;
            this.setDirtyCanvas?.(true, true);
        };

        nodeType.prototype.onSerialize = function (data) {
            const result = originalSerialized?.apply(this, arguments);
            data.properties = data.properties || {};
            data.properties.so_metadata_core_payload = {
                ...(this.__soMetadataPayload || this.properties?.so_metadata_core_payload || {}),
            };
            data.properties[PREVIEW_PROP] = (this.__soMetadataPreviewData || []).map((item) => ({ ...item }));
            return result;
        };
    },
});
