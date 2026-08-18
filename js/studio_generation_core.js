import { app } from "../../../scripts/app.js";
import {
    STUDIO_LAYOUT,
    STUDIO_THEME,
    applyStudioNodeColors,
    drawStudioChrome,
    drawStudioSectionFrame,
} from "./studio_theme.js";

const TARGET = "SOGenerationPipelineStudio";
const SCHEMA_VERSION = 40;
const SEED_MAX = 1125899906842624;
const MIN_WIDTH = STUDIO_LAYOUT.minWidth;
const PAD = STUDIO_LAYOUT.pad;
const ROW_H = STUDIO_LAYOUT.rowHeight;
const GAP = STUDIO_LAYOUT.gap;
const SECTION_GAP = STUDIO_LAYOUT.sectionGap;

const CMYKG = {
    cyan: STUDIO_THEME.cyan,
    magenta: STUDIO_THEME.magenta,
    yellow: STUDIO_THEME.yellow,
    green: STUDIO_THEME.green,
    text: STUDIO_THEME.text,
    muted: STUDIO_THEME.label,
    row: STUDIO_THEME.row,
    rowHover: STUDIO_THEME.rowHover,
    outline: STUDIO_THEME.outline,
    black: STUDIO_THEME.body,
};

const CLIP_TYPES = new Set([
    "krea2",
    "sd3",
    "stable_diffusion",
    "stable_cascade",
    "pixart",
    "flux",
    "default",
]);

const RESOLUTION_MODES = new Set(["custom", "preset"]);

const CANONICAL_NAMES = [
    "clip_name",
    "clip_type",
    "clip_device",
    "vae_name",
    "resolution_mode",
    "custom_width",
    "custom_height",
    "aspect_preset",
    "megapixels",
    "batch_size",
    "steps",
    "cfg",
    "sampler_name",
    "scheduler",
    "denoise",
    "shift",
    "seed_value",
];

const ASPECTS = {
    "1:1 (Square)": [1, 1],
    "2:3 (Portrait)": [2, 3],
    "3:4 (Portrait Standard)": [3, 4],
    "4:5 (Portrait Tall)": [4, 5],
    "9:16 (Portrait Phone)": [9, 16],
    "4:3 (Landscape Standard)": [4, 3],
    "3:2 (Landscape)": [3, 2],
    "16:9 (Widescreen)": [16, 9],
};

function widget(node, name) {
    return node.widgets?.find((item) => item.name === name);
}

function readValues(target) {
    const source = target?.options?.values;
    if (Array.isArray(source)) return [...source];
    if (typeof source === "function") {
        try {
            const values = source();
            return Array.isArray(values) ? [...values] : [];
        } catch (error) {}
    }
    return [];
}

function setWidgetValue(node, name, value) {
    const target = widget(node, name);
    if (!target) return;
    target.value = value;
    try { target.callback?.(value); } catch (error) {}
    node.setDirtyCanvas?.(true, true);
}

function swapCustomDimensions(node) {
    const width = Number(widget(node, "custom_width")?.value ?? 1440);
    const height = Number(widget(node, "custom_height")?.value ?? 1920);
    setWidgetValue(node, "custom_width", height);
    setWidgetValue(node, "custom_height", width);
}

function hideNativeWidget(target) {
    if (!target) return;
    target.hidden = true;
    target.type = "so-hidden-backing-widget";
    target.computeSize = () => [0, -4];
    target.draw = () => {};
    target.mouse = () => false;
    if (target.inputEl) {
        target.inputEl.style.display = "none";
        target.inputEl.style.visibility = "hidden";
        target.inputEl.style.pointerEvents = "none";
    }
}

function randomSeed() {
    return Math.floor(Math.random() * (SEED_MAX + 1));
}

async function copyText(value) {
    const text = String(value ?? "");
    if (!text) return false;
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (error) {}
    try {
        const input = document.createElement("textarea");
        input.value = text;
        input.style.position = "fixed";
        input.style.opacity = "0";
        document.body.append(input);
        input.select();
        document.execCommand("copy");
        input.remove();
        return true;
    } catch (error) {
        return false;
    }
}

function looksLikeLegacyFull(values) {
    return (
        Array.isArray(values) &&
        values.length >= 21 &&
        typeof values[1] === "string" &&
        CLIP_TYPES.has(String(values[2])) &&
        RESOLUTION_MODES.has(String(values[5])) &&
        typeof values[12] === "number" &&
        typeof values[15] === "number"
    );
}

function looksLikeV24(values) {
    // Old v24 order placed seed before steps/cfg. Require the numeric CFG at
    // slot 12 so the current canonical 17-value layout can never match this.
    return (
        Array.isArray(values) &&
        values.length >= 17 &&
        typeof values[0] === "string" &&
        CLIP_TYPES.has(String(values[1])) &&
        RESOLUTION_MODES.has(String(values[4])) &&
        typeof values[10] === "number" &&
        typeof values[11] === "number" &&
        typeof values[12] === "number" &&
        typeof values[13] === "string" &&
        typeof values[14] === "string"
    );
}

function migrateValuesOnce(info) {
    info.properties = info.properties || {};

    // Critical: migration is only for genuinely old saved layouts. dev40/41
    // accidentally omitted this guard, causing the canonical 17 values to be
    // remapped again on every tab switch / configure pass.
    if (Number(info.properties.so_generation_core_schema_version) >= SCHEMA_VERSION) {
        return;
    }

    const values = info.widgets_values;

    if (looksLikeLegacyFull(values)) {
        info.widgets_values = [
            values[1], values[2], values[3], values[4], values[5], values[6],
            values[7], values[8], values[9], values[11], values[15], values[16],
            values[17], values[18], values[19], values[20], values[12],
        ];
    } else if (looksLikeV24(values)) {
        info.widgets_values = [
            values[0], values[1], values[2], values[3], values[4], values[5],
            values[6], values[7], values[8], values[9], values[11], values[12],
            values[13], values[14], values[15], values[16], values[10],
        ];
    }

    info.properties.so_generation_core_schema_version = SCHEMA_VERSION;
}

function roundRect(ctx, x, y, w, h, radius = 8, fill = null, stroke = null) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

function gradientFrame(ctx, x, y, w, h, radius = 9, alpha = .44, accent = CMYKG.magenta) {
    drawStudioSectionFrame(ctx, x, y, w, h, accent, radius, alpha);
}

function text(ctx, value, x, y, options = {}) {
    ctx.save();
    ctx.font = options.font || "12px Segoe UI, Arial";
    ctx.fillStyle = options.color || CMYKG.text;
    ctx.textAlign = options.align || "left";
    ctx.textBaseline = options.baseline || "middle";
    ctx.fillText(String(value ?? ""), x, y);
    ctx.restore();
}

function fitText(ctx, value, maxWidth, font = "12px Segoe UI, Arial") {
    const raw = String(value ?? "");
    ctx.save(); ctx.font = font;
    if (ctx.measureText(raw).width <= maxWidth) { ctx.restore(); return raw; }
    let lo = 0, hi = raw.length;
    while (lo < hi) {
        const mid = Math.ceil((lo + hi) / 2);
        const candidate = `${raw.slice(0, mid)}…`;
        if (ctx.measureText(candidate).width <= maxWidth) lo = mid;
        else hi = mid - 1;
    }
    const result = `${raw.slice(0, lo)}…`;
    ctx.restore();
    return result;
}

function section(ctx, label, x, y, color, right = "") {
    text(ctx, String(label).toUpperCase(), x, y, { font: "700 10px Segoe UI, Arial", color });
    if (right) text(ctx, right, x + 1, y, { align: "right", color: CMYKG.muted, font: "10px Segoe UI, Arial" });
}

function valueRow(ctx, x, y, w, h, label, value, options = {}) {
    roundRect(ctx, x, y, w, h, 7, options.fill || CMYKG.row, options.stroke || CMYKG.outline);
    text(ctx, label, x + 11, y + h / 2, { color: CMYKG.muted, font: "11px Segoe UI, Arial" });
    ctx.save(); ctx.font = options.valueFont || "12px Segoe UI, Arial";
    const shown = fitText(ctx, value, Math.max(30, w - 130), options.valueFont || "12px Segoe UI, Arial");
    ctx.restore();
    text(ctx, shown, x + w - (options.chevron === false ? 11 : 24), y + h / 2, {
        align: "right", color: options.valueColor || CMYKG.text, font: options.valueFont || "12px Segoe UI, Arial",
    });
    if (options.chevron !== false) text(ctx, "▾", x + w - 10, y + h / 2, { align: "right", color: "#898994", font: "10px Arial" });
}

function statusRow(ctx, x, y, w, h, label, value, active, color) {
    roundRect(ctx, x, y, w, h, 7, CMYKG.row, active ? color.replace("#", "") ? `${color}88` : color : CMYKG.outline);
    text(ctx, label, x + 11, y + h / 2, { color: CMYKG.muted, font: "11px Segoe UI, Arial" });
    text(ctx, value, x + w - 11, y + h / 2, { align: "right", color: active ? color : CMYKG.text, font: "700 11px Segoe UI, Arial" });
}

function hit(node, key, x, y, w, h, callback) {
    node.__soGenHits = node.__soGenHits || {};
    node.__soGenHits[key] = { x, y, w, h, callback };
}

function inHit(pos, area) {
    return area && pos[0] >= area.x && pos[0] <= area.x + area.w && pos[1] >= area.y && pos[1] <= area.y + area.h;
}

function ensurePointerTracker() {
    if (window.__soGenPointerTracker) return;
    window.__soGenPointerTracker = true;
    window.__soGenPointer = { x: window.innerWidth / 2, y: 180 };
    document.addEventListener("pointerdown", (event) => {
        window.__soGenPointer = { x: event.clientX, y: event.clientY };
    }, true);
}

function closeChoicePopup() {
    document.getElementById("so-generation-choice-popup")?.remove();
    if (window.__soGenOutside) document.removeEventListener("pointerdown", window.__soGenOutside, true);
    if (window.__soGenEscape) document.removeEventListener("keydown", window.__soGenEscape, true);
    window.__soGenOutside = null;
    window.__soGenEscape = null;
}

function openChoice(node, title, widgetName, values, formatter = null) {
    const target = widget(node, widgetName);
    if (!target) return;
    const choices = (values || []).map((v) => String(v));
    if (!choices.length) return;
    ensurePointerTracker();
    closeChoicePopup();

    const root = document.createElement("div");
    root.id = "so-generation-choice-popup";
    Object.assign(root.style, {
        position: "fixed", zIndex: "100000", width: "470px", maxWidth: "calc(100vw - 24px)",
        background: "#151519", border: "1px solid rgba(53,215,255,.62)", borderRadius: "9px",
        boxShadow: "0 14px 38px rgba(0,0,0,.62), 0 0 0 1px rgba(255,74,184,.10) inset",
        color: "#eee", font: "13px Segoe UI, Arial", overflow: "hidden",
    });
    const head = document.createElement("div");
    Object.assign(head.style, { padding: "10px 12px 7px", borderBottom: "1px solid rgba(255,74,184,.30)" });
    const t = document.createElement("div"); t.textContent = title; t.style.fontWeight = "700";
    const s = document.createElement("div"); s.textContent = String(target.value ?? ""); Object.assign(s.style, { color: "#999", marginTop: "3px", fontSize: "11px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
    head.append(t, s);
    const search = document.createElement("input"); search.placeholder = `Filter ${title.toLowerCase()}`;
    Object.assign(search.style, { boxSizing: "border-box", width: "calc(100% - 20px)", margin: "9px 10px 6px", padding: "7px 9px", background: "#0d0d10", border: "1px solid rgba(246,230,90,.48)", borderRadius: "4px", color: "#fff", outline: "none" });
    const list = document.createElement("div"); Object.assign(list.style, { maxHeight: "480px", overflowY: "auto", padding: "3px 0 7px" });
    root.append(head, search, list); document.body.append(root);

    function render(q = "") {
        const needle = q.trim().toLowerCase(); list.replaceChildren();
        for (const value of choices.filter((v) => !needle || String(formatter ? formatter(v) : v).toLowerCase().includes(needle)).slice(0, 350)) {
            const row = document.createElement("div");
            const shown = formatter ? formatter(value) : value;
            row.textContent = `${String(target.value) === value ? "✓  " : ""}${shown}`;
            Object.assign(row.style, { padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,.055)", background: String(target.value) === value ? "rgba(53,215,255,.08)" : "transparent" });
            row.onmouseenter = () => row.style.background = "rgba(255,74,184,.10)";
            row.onmouseleave = () => row.style.background = String(target.value) === value ? "rgba(53,215,255,.08)" : "transparent";
            row.onclick = () => { setWidgetValue(node, widgetName, value); closeChoicePopup(); layout(node, true); };
            list.append(row);
        }
    }
    search.oninput = () => render(search.value); render();

    const p = window.__soGenPointer || { x: innerWidth / 2, y: 180 };
    root.style.left = `${Math.max(10, Math.min(p.x - 20, innerWidth - 490))}px`;
    root.style.top = `${Math.max(10, Math.min(p.y + 10, innerHeight - 570))}px`;
    window.__soGenOutside = (event) => { if (!root.contains(event.target)) closeChoicePopup(); };
    window.__soGenEscape = (event) => { if (event.key === "Escape") closeChoicePopup(); };
    setTimeout(() => document.addEventListener("pointerdown", window.__soGenOutside, true), 0);
    document.addEventListener("keydown", window.__soGenEscape, true);
    setTimeout(() => search.focus(), 0);
}

function editNumber(node, widgetName, label, event) {
    const target = widget(node, widgetName);
    if (!target) return;
    app.canvas.prompt(label, target.value, (value) => {
        let number = Number(value);
        if (!Number.isFinite(number)) return;
        const min = Number(target.options?.min); const max = Number(target.options?.max);
        if (Number.isFinite(min)) number = Math.max(min, number);
        if (Number.isFinite(max)) number = Math.min(max, number);
        if (String(target.type).toLowerCase().includes("number") && Number.isInteger(target.value)) number = Math.trunc(number);
        setWidgetValue(node, widgetName, number);
        layout(node, true);
    }, event);
}

function inputConnected(node, name) {
    const target = node.inputs?.find((input) => input.name === name);
    if (!target) return false;
    if (target.link != null) return true;
    if (Array.isArray(target.links) && target.links.length) return true;
    return false;
}

function round8(value) {
    return Math.max(8, Math.round(Number(value) / 8) * 8);
}

const GENERATION_VISIBLE_INPUTS = [
    "model",
    "positive_text",
    "positive_conditioning",
    "negative_conditioning",
];

function generationInputName(input) {
    return String(input?.name ?? input?.label ?? "").trim();
}

function generationInputIsConnected(input) {
    return input?.link != null || (Array.isArray(input?.links) && input.links.length > 0);
}

function generationShouldExposeInput(input) {
    const name = generationInputName(input);
    return GENERATION_VISIBLE_INPUTS.includes(name) || generationInputIsConnected(input);
}

function layoutGenerationInputSockets(node) {
    node.__soGenerationInputAnchors = {};
    let y = STUDIO_LAYOUT.socketStart;
    for (const input of node.inputs || []) {
        const name = generationInputName(input);
        if (!name) continue;
        if (generationShouldExposeInput(input)) {
            node.__soGenerationInputAnchors[name] = y;
            input.pos = [0, y];
            if (!input.label) input.label = name;
            y += 21;
        } else {
            // Old converted-widget inputs can survive inside saved workflows.
            // Keep the graph object intact, but remove unused sockets from the
            // visible node so they cannot create a giant blank input reserve.
            node.__soGenerationInputAnchors[name] = -10000;
            input.pos = [-10000, -10000];
            input.label = "";
        }
    }
    return y;
}

function layoutGenerationOutputSockets(node) {
    const right = Number(node.size?.[0] || MIN_WIDTH);
    for (let index = 0; index < (node.outputs?.length || 0); index++) {
        node.outputs[index].pos = [right, STUDIO_LAYOUT.socketStart + index * STUDIO_LAYOUT.socketStep];
    }
}

function generationVisibleInputCount(node) {
    return (node.inputs || []).filter((input) => generationShouldExposeInput(input)).length;
}

function generationOutputBottom(node) {
    layoutGenerationOutputSockets(node);
    const count = node.outputs?.length || 0;
    return count ? STUDIO_LAYOUT.socketStart + count * STUDIO_LAYOUT.socketStep + 5 : STUDIO_LAYOUT.headerHeight;
}

function generationInputBottom(node) {
    const count = generationVisibleInputCount(node);
    return count ? STUDIO_LAYOUT.socketStart + count * STUDIO_LAYOUT.socketStep + 5 : STUDIO_LAYOUT.headerHeight;
}

function generationInputAnchor(node, slotIndex) {
    const input = node.inputs?.[slotIndex];
    if (!input) return null;
    const name = generationInputName(input);
    const y = Number(node.__soGenerationInputAnchors?.[name]);
    if (!Number.isFinite(y)) return null;
    return { x: y < 0 ? -10000 : 0, y };
}

function generationOutputAnchor(node, slotIndex) {
    const output = node.outputs?.[Number(slotIndex)];
    if (!output) return null;
    layoutGenerationOutputSockets(node);
    const y = Number(output.pos?.[1]);
    if (!Number.isFinite(y)) return null;
    return { x: Number(node.size?.[0] || MIN_WIDTH), y };
}

function resolvedDimensions(node) {
    if (String(widget(node, "resolution_mode")?.value) === "preset") {
        const ratio = ASPECTS[String(widget(node, "aspect_preset")?.value)] || [3, 4];
        const mp = Math.max(.05, Number(widget(node, "megapixels")?.value ?? 1));
        const total = mp * 1000000;
        const width = Math.sqrt(total * ratio[0] / ratio[1]);
        const height = width * ratio[1] / ratio[0];
        return [round8(width), round8(height)];
    }
    return [Number(widget(node, "custom_width")?.value ?? 1440), Number(widget(node, "custom_height")?.value ?? 1920)];
}

function dashboardTop(node) {
    // Only reserve room for sockets that are actually visible. Outputs can
    // share the upper-right area with inputs on the left, so there is no need
    // to reserve space for stale converted-widget inputs.
    layoutGenerationInputSockets(node);
    layoutGenerationOutputSockets(node);
    return Math.max(
        STUDIO_LAYOUT.headerHeight + STUDIO_LAYOUT.socketGap,
        Math.max(generationInputBottom(node), generationOutputBottom(node)) + STUDIO_LAYOUT.socketGap,
    );
}

function dashboardHeight(node) {
    const preset = String(widget(node, "resolution_mode")?.value) === "preset";
    const advanced = Boolean(node.properties?.so_generation_dashboard_advanced);
    let h = 0;
    h += 17 + ROW_H + 13;       // encoding
    h += 17 + ROW_H + 13;       // conditioning
    h += 17 + ROW_H * 2 + GAP + 13; // canvas
    h += 17 + ROW_H * 2 + GAP + 13; // sampling
    h += 17 + ROW_H * 3 + GAP * 2 + 13; // seed
    h += 34;                    // advanced
    if (advanced) h += ROW_H + GAP;
    return h + SECTION_GAP * 5 + 8;
}

function layout(node, refit = false) {
    if (!node.__soGenDashboardReady) return;
    layoutGenerationInputSockets(node);
    for (const name of CANONICAL_NAMES) hideNativeWidget(widget(node, name));
    applyStudioNodeColors(node);
    node.size[0] = Math.max(Number(node.size?.[0] || 0), MIN_WIDTH);
    const desired = dashboardTop(node) + dashboardHeight(node) + 18;
    if (refit) node.size[1] = desired;
    else node.size[1] = Math.max(Number(node.size?.[1] || 0), desired);
    node.widgets_start_y = desired;
    node.setDirtyCanvas?.(true, true);
}

function drawDashboard(node, ctx) {
    if (!node.__soGenDashboardReady) return;
    node.__soGenHits = {};
    const x = PAD, w = node.size[0] - PAD * 2;
    let y = dashboardTop(node);
    const half = (w - GAP) / 2;
    const third = (w - GAP * 2) / 3;
    const quarter = (w - GAP * 3) / 4;
    const [rw, rh] = resolvedDimensions(node);
    const batch = Number(widget(node, "batch_size")?.value ?? 1);
    ctx.save();

    // Encoding
    gradientFrame(ctx, x - 4, y - 5, w + 8, 68, 9, .43, CMYKG.cyan);
    section(ctx, "Encoding", x + 2, y + 7, CMYKG.cyan);
    y += 17;
    const encW = w * .62;
    valueRow(ctx, x, y, encW, ROW_H, "Text encoder", widget(node, "clip_name")?.value ?? "");
    valueRow(ctx, x + encW + GAP, y, w - encW - GAP, ROW_H, "VAE", widget(node, "vae_name")?.value ?? "");
    hit(node, "clip", x, y, encW, ROW_H, () => openChoice(node, "Text encoder", "clip_name", readValues(widget(node, "clip_name"))));
    hit(node, "vae", x + encW + GAP, y, w - encW - GAP, ROW_H, () => openChoice(node, "VAE", "vae_name", readValues(widget(node, "vae_name"))));
    y += ROW_H + 13 + SECTION_GAP;

    // Conditioning status
    gradientFrame(ctx, x - 4, y - 5, w + 8, 68, 9, .43, CMYKG.magenta);
    section(ctx, "Conditioning", x + 2, y + 7, CMYKG.magenta);
    y += 17;
    const posExternal = inputConnected(node, "positive_conditioning");
    const negExternal = inputConnected(node, "negative_conditioning");
    statusRow(ctx, x, y, half, ROW_H, "Positive", posExternal ? "External conditioning" : "Prompt text", posExternal, CMYKG.magenta);
    statusRow(ctx, x + half + GAP, y, half, ROW_H, "Negative", negExternal ? "External conditioning" : "Empty fallback", negExternal, CMYKG.magenta);
    y += ROW_H + 13 + SECTION_GAP;

    // Canvas
    gradientFrame(ctx, x - 4, y - 5, w + 8, 114, 9, .43, CMYKG.yellow);
    section(ctx, "Canvas", x + 2, y + 7, CMYKG.yellow);
    text(ctx, `${rw} × ${rh} · batch ${batch}`, x + w - 2, y + 7, { align: "right", color: "#b8b172", font: "10px Segoe UI, Arial" });
    y += 17;
    valueRow(ctx, x, y, half, ROW_H, "Resolution", widget(node, "resolution_mode")?.value ?? "custom");
    valueRow(ctx, x + half + GAP, y, half, ROW_H, "Batch", batch, { chevron: false });
    hit(node, "resmode", x, y, half, ROW_H, () => openChoice(node, "Resolution mode", "resolution_mode", readValues(widget(node, "resolution_mode"))));
    hit(node, "batch", x + half + GAP, y, half, ROW_H, (event) => editNumber(node, "batch_size", "Batch size", event));
    y += ROW_H + GAP;
    if (String(widget(node, "resolution_mode")?.value) === "preset") {
        valueRow(ctx, x, y, half, ROW_H, "Aspect", widget(node, "aspect_preset")?.value ?? "");
        valueRow(ctx, x + half + GAP, y, half, ROW_H, "Megapixels", Number(widget(node, "megapixels")?.value ?? 1).toFixed(2), { chevron: false });
        hit(node, "aspect", x, y, half, ROW_H, () => openChoice(node, "Aspect preset", "aspect_preset", readValues(widget(node, "aspect_preset"))));
        hit(node, "mp", x + half + GAP, y, half, ROW_H, (event) => editNumber(node, "megapixels", "Megapixels", event));
    } else {
        const swapW = 42;
        const dimensionW = (w - GAP * 2 - swapW) / 2;
        const swapX = x + dimensionW + GAP;
        const heightX = swapX + swapW + GAP;
        valueRow(ctx, x, y, dimensionW, ROW_H, "Width", widget(node, "custom_width")?.value ?? 1440, { chevron: false });
        roundRect(ctx, swapX, y, swapW, ROW_H, 7, "rgba(246,230,90,.12)", `${CMYKG.yellow}88`);
        text(ctx, "⇄", swapX + swapW / 2, y + ROW_H / 2, { align: "center", color: CMYKG.yellow, font: "700 18px Segoe UI Symbol, Arial" });
        valueRow(ctx, heightX, y, dimensionW, ROW_H, "Height", widget(node, "custom_height")?.value ?? 1920, { chevron: false });
        hit(node, "width", x, y, dimensionW, ROW_H, (event) => editNumber(node, "custom_width", "Width", event));
        hit(node, "swap_dimensions", swapX, y, swapW, ROW_H, () => swapCustomDimensions(node));
        hit(node, "height", heightX, y, dimensionW, ROW_H, (event) => editNumber(node, "custom_height", "Height", event));
    }
    y += ROW_H + 13 + SECTION_GAP;

    // Sampling
    gradientFrame(ctx, x - 4, y - 5, w + 8, 114, 9, .43, CMYKG.green);
    section(ctx, "Sampling", x + 2, y + 7, CMYKG.green);
    y += 17;
    valueRow(ctx, x, y, half, ROW_H, "Sampler", widget(node, "sampler_name")?.value ?? "euler");
    valueRow(ctx, x + half + GAP, y, half, ROW_H, "Scheduler", widget(node, "scheduler")?.value ?? "beta");
    hit(node, "sampler", x, y, half, ROW_H, () => openChoice(node, "Sampler", "sampler_name", readValues(widget(node, "sampler_name"))));
    hit(node, "scheduler", x + half + GAP, y, half, ROW_H, () => openChoice(node, "Scheduler", "scheduler", readValues(widget(node, "scheduler"))));
    y += ROW_H + GAP;
    const numeric = [
        ["Steps", "steps"], ["CFG", "cfg"], ["Denoise", "denoise"], ["Shift", "shift"],
    ];
    numeric.forEach(([label, name], index) => {
        const px = x + index * (quarter + GAP);
        let value = widget(node, name)?.value ?? "";
        if (["cfg", "denoise", "shift"].includes(name)) value = Number(value).toFixed(name === "denoise" ? 2 : 2);
        valueRow(ctx, px, y, quarter, ROW_H, label, value, { chevron: false });
        hit(node, name, px, y, quarter, ROW_H, (event) => editNumber(node, name, label, event));
    });
    y += ROW_H + 13 + SECTION_GAP;

    // Seed
    gradientFrame(ctx, x - 4, y - 5, w + 8, 160, 9, .43, CMYKG.cyan);
    section(ctx, "Seed", x + 2, y + 7, CMYKG.cyan);
    y += 17;
    const seedValue = Number(widget(node, "seed_value")?.value ?? -1);
    const seedDisplay = seedValue === -1 ? "Random every run" : String(seedValue);
    valueRow(ctx, x, y, w, ROW_H, "Current seed", seedDisplay, { chevron: false, stroke: "rgba(53,215,255,.34)" });
    hit(node, "seed", x, y, w, ROW_H, (event) => editNumber(node, "seed_value", "Seed (-1 = random each run)", event));
    y += ROW_H + GAP;
    const seedThird = (w - GAP * 2) / 3;
    const seedButtons = [
        ["🎲 Random each run", () => setWidgetValue(node, "seed_value", -1)],
        ["🎯 New fixed random", () => setWidgetValue(node, "seed_value", randomSeed())],
        ["♻ Use last queued", () => { if (node.__soLastUsedSeed != null) setWidgetValue(node, "seed_value", Number(node.__soLastUsedSeed)); }],
    ];
    seedButtons.forEach(([label, callback], index) => {
        const px = x + index * (seedThird + GAP);
        roundRect(ctx, px, y, seedThird, ROW_H, 7, CMYKG.row, "rgba(53,215,255,.22)");
        text(ctx, label, px + seedThird / 2, y + ROW_H / 2, { align: "center", color: CMYKG.text, font: "11px Segoe UI, Arial" });
        hit(node, `seedbtn${index}`, px, y, seedThird, ROW_H, callback);
    });
    y += ROW_H + GAP;
    const copied = Boolean(node.__soSeedCopied);
    roundRect(ctx, x, y, w, ROW_H, 7, copied ? "rgba(74,132,101,.34)" : CMYKG.row, copied ? "rgba(137,213,166,.82)" : "rgba(255,74,184,.30)");
    const last = node.__soLastUsedSeed == null ? "none yet" : String(node.__soLastUsedSeed);
    text(ctx, copied ? `✓ Copied last used seed: ${last}` : `📋 Copy last used seed: ${last}`, x + w / 2, y + ROW_H / 2, { align: "center", color: copied ? "#b9efca" : CMYKG.text, font: "11px Segoe UI, Arial" });
    hit(node, "copyseed", x, y, w, ROW_H, async () => {
        if (node.__soLastUsedSeed == null) return;
        if (await copyText(node.__soLastUsedSeed)) {
            node.__soSeedCopied = true;
            try { navigator.vibrate?.(18); } catch (error) {}
            node.setDirtyCanvas?.(true, true);
            clearTimeout(node.__soSeedCopiedTimer);
            node.__soSeedCopiedTimer = setTimeout(() => { node.__soSeedCopied = false; node.setDirtyCanvas?.(true, true); }, 900);
        }
    });
    y += ROW_H + 13 + SECTION_GAP;

    // Advanced encoding controls
    const advanced = Boolean(node.properties?.so_generation_dashboard_advanced);
    gradientFrame(ctx, x - 4, y - 5, w + 8, advanced ? 86 : 42, 9, .36, CMYKG.yellow);
    roundRect(ctx, x, y, w, 30, 7, "rgba(31,31,34,.96)", "rgba(246,230,90,.25)");
    text(ctx, `Advanced ${advanced ? "▾" : "▸"}`, x + 11, y + 15, { color: CMYKG.yellow, font: "700 10px Segoe UI, Arial" });
    text(ctx, "CLIP type + device", x + w - 11, y + 15, { align: "right", color: "#77777e", font: "10px Segoe UI, Arial" });
    hit(node, "advanced", x, y, w, 30, () => {
        node.properties = node.properties || {};
        node.properties.so_generation_dashboard_advanced = !advanced;
        layout(node, true);
    });
    y += 38;
    if (advanced) {
        valueRow(ctx, x, y, half, ROW_H, "CLIP type", widget(node, "clip_type")?.value ?? "krea2");
        valueRow(ctx, x + half + GAP, y, half, ROW_H, "CLIP device", widget(node, "clip_device")?.value ?? "default");
        hit(node, "cliptype", x, y, half, ROW_H, () => openChoice(node, "CLIP type", "clip_type", readValues(widget(node, "clip_type"))));
        hit(node, "clipdevice", x + half + GAP, y, half, ROW_H, () => openChoice(node, "CLIP device", "clip_device", readValues(widget(node, "clip_device"))));
    }

    ctx.restore();
}

function installDashboard(node) {
    node.properties = node.properties || {};
    node.properties.so_generation_core_schema_version = SCHEMA_VERSION;
    node.__soGenDashboardReady = true;
    applyStudioNodeColors(node);
    layoutGenerationInputSockets(node);
    for (const name of CANONICAL_NAMES) hideNativeWidget(widget(node, name));
    const saved = node.properties.so_last_used_seed;
    if (saved != null) node.__soLastUsedSeed = saved;
    layout(node, true);
}

app.registerExtension({
    name: "SickOllie.Studio.GenerationCore",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== TARGET) return;

        // Own the input connection geometry so hidden legacy widget-input
        // sockets do not create mystery dots or large blank space.
        const originalGetConnectionPos = nodeType.prototype.getConnectionPos;
        nodeType.prototype.getConnectionPos = function (isInput, slot, out) {
            if (isInput && this.__soGenDashboardReady) {
                let slotIndex = typeof slot === "number" ? slot : this.findInputSlot?.(slot);
                if (!Number.isInteger(slotIndex) || slotIndex < 0) slotIndex = Number(slot);
                const anchor = generationInputAnchor(this, slotIndex);
                if (anchor) {
                    const result = out || [0, 0];
                    result[0] = Number(this.pos?.[0] || 0) + anchor.x;
                    result[1] = Number(this.pos?.[1] || 0) + anchor.y;
                    return result;
                }
            }
            if (!isInput && this.__soGenDashboardReady) {
                let slotIndex = typeof slot === "number" ? slot : this.findOutputSlot?.(slot);
                if (!Number.isInteger(slotIndex) || slotIndex < 0) slotIndex = Number(slot);
                const anchor = generationOutputAnchor(this, slotIndex);
                if (anchor) {
                    const result = out || [0, 0];
                    result[0] = Number(this.pos?.[0] || 0) + anchor.x;
                    result[1] = Number(this.pos?.[1] || 0) + anchor.y;
                    return result;
                }
            }
            return originalGetConnectionPos?.apply(this, arguments);
        };

        const originalGetInputPos = nodeType.prototype.getInputPos;
        if (typeof originalGetInputPos === "function") {
            nodeType.prototype.getInputPos = function (slotIndex, out) {
                if (this.__soGenDashboardReady) {
                    const anchor = generationInputAnchor(this, slotIndex);
                    if (anchor) {
                        const result = out || [0, 0];
                        result[0] = Number(this.pos?.[0] || 0) + anchor.x;
                        result[1] = Number(this.pos?.[1] || 0) + anchor.y;
                        return result;
                    }
                }
                return originalGetInputPos.apply(this, arguments);
            };
        }

        const originalGetOutputPos = nodeType.prototype.getOutputPos;
        if (typeof originalGetOutputPos === "function") {
            nodeType.prototype.getOutputPos = function (slotIndex, out) {
                if (this.__soGenDashboardReady) {
                    const anchor = generationOutputAnchor(this, slotIndex);
                    if (anchor) {
                        const result = out || [0, 0];
                        result[0] = Number(this.pos?.[0] || 0) + anchor.x;
                        result[1] = Number(this.pos?.[1] || 0) + anchor.y;
                        return result;
                    }
                }
                return originalGetOutputPos.apply(this, arguments);
            };
        }

        const originalConfigureMethod = nodeType.prototype.configure;
        nodeType.prototype.configure = function (info) {
            migrateValuesOnce(info);
            return originalConfigureMethod.call(this, info);
        };

        const originalCreated = nodeType.prototype.onNodeCreated;
        const originalConfigured = nodeType.prototype.onConfigure;
        const originalExecuted = nodeType.prototype.onExecuted;
        const originalSerialize = nodeType.prototype.serialize;
        const originalForeground = nodeType.prototype.onDrawForeground;
        const originalMouseDown = nodeType.prototype.onMouseDown;
        const originalResize = nodeType.prototype.onResize;

        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            applyStudioNodeColors(this);
            setTimeout(() => installDashboard(this), 0);
            return result;
        };

        nodeType.prototype.onConfigure = function (info) {
            const result = originalConfigured?.apply(this, arguments);
            applyStudioNodeColors(this);
            const saved = info?.properties?.so_last_used_seed ?? this.properties?.so_last_used_seed;
            if (saved != null) this.__soLastUsedSeed = saved;
            const savedWidth = info?.properties?.so_last_width ?? this.properties?.so_last_width;
            const savedHeight = info?.properties?.so_last_height ?? this.properties?.so_last_height;
            if (savedWidth != null) this.__soLastWidth = Number(savedWidth);
            if (savedHeight != null) this.__soLastHeight = Number(savedHeight);
            setTimeout(() => installDashboard(this), 0);
            return result;
        };

        nodeType.prototype.onExecuted = function (message) {
            originalExecuted?.apply(this, arguments);
            let value = message?.seed_used;
            if (Array.isArray(value)) value = value[0];
            if (value != null) {
                this.__soLastUsedSeed = value;
                this.properties = this.properties || {};
                this.properties.so_last_used_seed = value;
                this.setDirtyCanvas?.(true, true);
            }
            let width = message?.width; if (Array.isArray(width)) width = width[0];
            let height = message?.height; if (Array.isArray(height)) height = height[0];
            if (Number(width) > 0 && Number(height) > 0) {
                this.__soLastWidth = Number(width); this.__soLastHeight = Number(height);
                this.properties = this.properties || {};
                this.properties.so_last_width = Number(width); this.properties.so_last_height = Number(height);
            }
        };

        nodeType.prototype.serialize = function () {
            const data = originalSerialize?.apply(this, arguments) || {};
            data.properties = {
                ...(data.properties || {}),
                so_generation_core_schema_version: SCHEMA_VERSION,
                so_last_used_seed: this.__soLastUsedSeed ?? null,
                so_last_width: this.__soLastWidth ?? null,
                so_last_height: this.__soLastHeight ?? null,
                so_generation_dashboard_advanced: Boolean(this.properties?.so_generation_dashboard_advanced),
            };
            data.widgets_values = CANONICAL_NAMES.map((name) => widget(this, name)?.value);
            return data;
        };

        nodeType.prototype.onDrawForeground = function (ctx) {
            drawStudioChrome(this, ctx, "generation");
            try { originalForeground?.apply(this, arguments); } catch (error) {}
            drawDashboard(this, ctx);
        };

        nodeType.prototype.onMouseDown = function (event, pos, canvas) {
            if (this.__soGenDashboardReady) {
                for (const area of Object.values(this.__soGenHits || {})) {
                    if (inHit(pos, area)) {
                        area.callback(event, pos, this);
                        return true;
                    }
                }
            }
            return originalMouseDown?.apply(this, arguments);
        };

        nodeType.prototype.onResize = function (size) {
            const result = originalResize?.apply(this, arguments);
            if (this.__soGenDashboardReady) {
                this.size[0] = Math.max(Number(this.size?.[0] || 0), MIN_WIDTH);
                const desired = dashboardTop(this) + dashboardHeight(this) + 18;
                this.size[1] = Math.max(Number(this.size?.[1] || 0), desired);
            }
            return result;
        };
    },
});
