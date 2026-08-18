import { app } from "../../../scripts/app.js";
// Explicit import: some ComfyUI builds only load frontend files reached from a
// registered Studio extension. This keeps the Recipe Catalog discoverable.
import "./solo_recipe_catalog.js";
import "./solo_library_review.js";
import {
    STUDIO_LAYOUT,
    STUDIO_THEME,
    applyStudioNodeColors,
    drawStudioChrome,
    drawStudioSectionFrame,
} from "./studio_theme.js";

const TARGET = "SOOutputBuilderSaveStudio";
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

const NONE = "[None]";
const RESOLVED_KEYS = [
    "clean_name",
    "raw_stem",
    "model_name",
    "main_folder",
    "main_trigger",
    "seed",
    "prompt_index",
    "outfit_index",
    "scene_index",
    "prompt_file",
    "outfit_file",
    "scene_file",
    "context_source",
];

const CANONICAL_NAMES = [
    "output_root",
    "subfolder_literal",
    "subfolder_var_1",
    "subfolder_var_2",
    "subfolder_var_3",
    "subfolder_var_4",
    "subfolder_delimiter",
    "filename_literal",
    "filename_var_1",
    "filename_var_2",
    "filename_var_3",
    "filename_var_4",
    "filename_var_5",
    "filename_var_6",
    "filename_delimiter",
    "extension",
    "quality",
    "counter_digits",
    "save_prompt_json",
    "save_workflow_json",
    "save_civitai_parameters",
    "clean_name",
    "raw_stem",
    "model_name",
    "seed",
    "prompt_index",
    "outfit_index",
    "scene_index",
    "prompt_file",
    "outfit_file",
    "scene_file",
    "saved_path",
];

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

function hideNativeWidget(target) {
    if (!target) return;
    target.hidden = true;
    target.type = "so-output-hidden-widget";
    target.computeSize = () => [0, -4];
    target.draw = () => {};
    target.mouse = () => false;
    if (target.inputEl) {
        target.inputEl.style.display = "none";
        target.inputEl.style.visibility = "hidden";
        target.inputEl.style.pointerEvents = "none";
    }
}

function clearInlineImagePreview(node) {
    node.imgs = null;
    node.images = [];
    node.imageRects = [];
    node.imageIndex = null;
    node.animatedImages = false;
    node.preview = null;
}

function unwrap(value) {
    let current = value;
    while (Array.isArray(current) && current.length === 1) current = current[0];
    return current;
}

function shortenSavedPath(value) {
    const raw = String(value ?? "");
    if (!raw) return "";
    const normalized = raw.replace(/\\/g, "/");
    const marker = "/output/";
    const index = normalized.toLowerCase().lastIndexOf(marker);
    if (index >= 0) return normalized.slice(index + 1).replace(/\//g, "\\");
    return raw;
}

function normalizeResolvedValues(value) {
    let current = unwrap(value);
    if (typeof current === "string") {
        try { current = JSON.parse(current); } catch (error) { current = {}; }
    }
    const source = current && typeof current === "object" ? current : {};
    const out = {};
    for (const key of RESOLVED_KEYS) {
        const item = unwrap(source[key]);
        out[key] = item == null ? "" : String(item);
    }
    return out;
}

async function copyText(value) {
    const textValue = String(value ?? "");
    if (!textValue) return false;
    try {
        await navigator.clipboard.writeText(textValue);
        return true;
    } catch (error) {}
    try {
        const input = document.createElement("textarea");
        input.value = textValue;
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
        if (ctx.measureText(`${raw.slice(0, mid)}…`).width <= maxWidth) lo = mid;
        else hi = mid - 1;
    }
    const shown = `${raw.slice(0, lo)}…`;
    ctx.restore();
    return shown;
}

function section(ctx, label, x, y, color, right = "") {
    text(ctx, String(label).toUpperCase(), x, y, { color, font: "700 10px Segoe UI, Arial" });
    if (right) text(ctx, right, x + 1, y, { align: "right", color: CMYKG.muted, font: "10px Segoe UI, Arial" });
}

function valueRow(ctx, x, y, w, h, label, value, options = {}) {
    roundRect(ctx, x, y, w, h, 7, options.fill || CMYKG.row, options.stroke || CMYKG.outline);
    text(ctx, label, x + 11, y + h / 2, { color: options.labelColor || CMYKG.muted, font: "11px Segoe UI, Arial" });
    ctx.save(); ctx.font = options.valueFont || "12px Segoe UI, Arial";
    const shown = fitText(ctx, value, Math.max(35, w - 130), options.valueFont || "12px Segoe UI, Arial");
    ctx.restore();
    text(ctx, shown, x + w - (options.chevron === false ? 11 : 24), y + h / 2, {
        align: "right", color: options.valueColor || CMYKG.text, font: options.valueFont || "12px Segoe UI, Arial",
    });
    if (options.chevron !== false) text(ctx, "▾", x + w - 10, y + h / 2, { align: "right", color: "#898994", font: "10px Arial" });
}

function toggleRow(ctx, x, y, w, h, label, active, color) {
    roundRect(ctx, x, y, w, h, 7, CMYKG.row, active ? `${color}75` : CMYKG.outline);
    text(ctx, label, x + 11, y + h / 2, { color: CMYKG.text, font: "11px Segoe UI, Arial" });
    const tw = 43, th = 22, tx = x + w - tw - 10, ty = y + (h - th) / 2;
    roundRect(ctx, tx, ty, tw, th, 12, active ? "rgba(110,231,162,.60)" : "rgba(110,110,120,.46)", null);
    ctx.beginPath();
    ctx.arc(active ? tx + tw - 11 : tx + 11, ty + 11, 8, 0, Math.PI * 2);
    ctx.fillStyle = "#ededf0";
    ctx.fill();
}

function hit(node, key, x, y, w, h, callback) {
    node.__soOutputHits = node.__soOutputHits || {};
    node.__soOutputHits[key] = { x, y, w, h, callback };
}

function inHit(pos, area) {
    return area && pos[0] >= area.x && pos[0] <= area.x + area.w && pos[1] >= area.y && pos[1] <= area.y + area.h;
}

function ensurePointerTracker() {
    if (window.__soOutputPointerTracker) return;
    window.__soOutputPointerTracker = true;
    window.__soOutputPointer = { x: innerWidth / 2, y: 180 };
    document.addEventListener("pointerdown", (event) => {
        window.__soOutputPointer = { x: event.clientX, y: event.clientY };
    }, true);
}

function closeChoicePopup() {
    document.getElementById("so-output-choice-popup")?.remove();
    if (window.__soOutputOutside) document.removeEventListener("pointerdown", window.__soOutputOutside, true);
    if (window.__soOutputEscape) document.removeEventListener("keydown", window.__soOutputEscape, true);
    window.__soOutputOutside = null;
    window.__soOutputEscape = null;
}

function openChoice(node, title, widgetName, values) {
    const target = widget(node, widgetName);
    if (!target) return;
    const choices = (values || []).map((value) => String(value));
    if (!choices.length) return;
    ensurePointerTracker();
    closeChoicePopup();

    const root = document.createElement("div");
    root.id = "so-output-choice-popup";
    Object.assign(root.style, {
        position: "fixed", zIndex: "100000", width: "460px", maxWidth: "calc(100vw - 24px)",
        background: "#151519", border: "1px solid rgba(53,215,255,.62)", borderRadius: "9px",
        boxShadow: "0 14px 38px rgba(0,0,0,.62), 0 0 0 1px rgba(255,74,184,.10) inset",
        color: "#eee", font: "13px Segoe UI, Arial", overflow: "hidden",
    });
    const head = document.createElement("div");
    Object.assign(head.style, { padding: "10px 12px 7px", borderBottom: "1px solid rgba(255,74,184,.30)" });
    const titleEl = document.createElement("div"); titleEl.textContent = title; titleEl.style.fontWeight = "700";
    const current = document.createElement("div"); current.textContent = String(target.value ?? "");
    Object.assign(current.style, { color: "#999", marginTop: "3px", fontSize: "11px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
    head.append(titleEl, current);
    const search = document.createElement("input"); search.placeholder = `Filter ${title.toLowerCase()}`;
    Object.assign(search.style, { boxSizing: "border-box", width: "calc(100% - 20px)", margin: "9px 10px 6px", padding: "7px 9px", background: "#0d0d10", border: "1px solid rgba(246,230,90,.48)", borderRadius: "4px", color: "#fff", outline: "none" });
    const list = document.createElement("div"); Object.assign(list.style, { maxHeight: "480px", overflowY: "auto", padding: "3px 0 7px" });
    root.append(head, search, list); document.body.append(root);

    function render(q = "") {
        const needle = q.trim().toLowerCase();
        list.replaceChildren();
        for (const value of choices.filter((item) => !needle || item.toLowerCase().includes(needle)).slice(0, 350)) {
            const row = document.createElement("div");
            row.textContent = `${String(target.value) === value ? "✓  " : ""}${value}`;
            Object.assign(row.style, { padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid rgba(255,255,255,.055)", background: String(target.value) === value ? "rgba(53,215,255,.08)" : "transparent" });
            row.onmouseenter = () => row.style.background = "rgba(255,74,184,.10)";
            row.onmouseleave = () => row.style.background = String(target.value) === value ? "rgba(53,215,255,.08)" : "transparent";
            row.onclick = () => { setWidgetValue(node, widgetName, value); closeChoicePopup(); layout(node, true); };
            list.append(row);
        }
    }
    search.oninput = () => render(search.value);
    render();

    const p = window.__soOutputPointer || { x: innerWidth / 2, y: 180 };
    root.style.left = `${Math.max(10, Math.min(p.x - 20, innerWidth - 480))}px`;
    root.style.top = `${Math.max(10, Math.min(p.y + 10, innerHeight - 560))}px`;
    window.__soOutputOutside = (event) => { if (!root.contains(event.target)) closeChoicePopup(); };
    window.__soOutputEscape = (event) => { if (event.key === "Escape") closeChoicePopup(); };
    setTimeout(() => document.addEventListener("pointerdown", window.__soOutputOutside, true), 0);
    document.addEventListener("keydown", window.__soOutputEscape, true);
    setTimeout(() => search.focus(), 0);
}

function editText(node, widgetName, label, event) {
    const target = widget(node, widgetName);
    if (!target) return;
    app.canvas.prompt(label, String(target.value ?? ""), (value) => {
        setWidgetValue(node, widgetName, String(value ?? ""));
        layout(node, true);
    }, event);
}

function editNumber(node, widgetName, label, event) {
    const target = widget(node, widgetName);
    if (!target) return;
    app.canvas.prompt(label, target.value, (value) => {
        let number = Number(value);
        if (!Number.isFinite(number)) return;
        const min = Number(target.options?.min), max = Number(target.options?.max);
        if (Number.isFinite(min)) number = Math.max(min, number);
        if (Number.isFinite(max)) number = Math.min(max, number);
        if (Number.isInteger(target.value)) number = Math.trunc(number);
        setWidgetValue(node, widgetName, number);
        layout(node, true);
    }, event);
}

function recipePreview(literalName, varNames, delimiterName, node) {
    const parts = [];
    const literal = String(widget(node, literalName)?.value ?? "").trim();
    if (literal) parts.push(literal);
    for (const name of varNames) {
        const value = String(widget(node, name)?.value ?? NONE);
        if (value && value !== NONE) parts.push(`{${value}}`);
    }
    return parts.join(String(widget(node, delimiterName)?.value ?? "_")) || "[empty]";
}

function outputInputName(input) {
    return String(input?.name ?? input?.label ?? "").trim();
}

function outputInputConnected(input) {
    return input?.link != null || (Array.isArray(input?.links) && input.links.length > 0);
}

const ALWAYS_VISIBLE_INPUTS = new Set(["images", "samples", "vae"]);

function shouldExposeInput(input) {
    const name = outputInputName(input);
    return ALWAYS_VISIBLE_INPUTS.has(name) || outputInputConnected(input);
}

const INPUT_LABELS = {
    images: "images",
    samples: "samples",
    vae: "vae",
    generation_info: "generation info · override",
    applied_loras: "applied LoRAs · override",
    clean_name: "clean name · override",
    raw_stem: "raw stem · override",
    model_name: "model name · override",
    seed: "seed · override",
    prompt_index: "prompt index · override",
    outfit_index: "outfit index · override",
    scene_index: "scene index · override",
    prompt_file: "prompt file · override",
    outfit_file: "outfit file · override",
    scene_file: "scene file · override",
};

function inputDisplayLabel(name) {
    return INPUT_LABELS[name] || String(name || "input").replaceAll("_", " ");
}

function layoutInputSockets(node) {
    node.__soOutputInputAnchors = {};
    let y = STUDIO_LAYOUT.socketStart;
    for (const input of node.inputs || []) {
        const name = outputInputName(input);
        if (!name) continue;
        if (shouldExposeInput(input)) {
            node.__soOutputInputAnchors[name] = y;
            input.pos = [0, y];
            input.label = inputDisplayLabel(name);
            y += 21;
        } else {
            node.__soOutputInputAnchors[name] = -10000;
            input.pos = [-10000, -10000];
            input.label = "";
        }
    }
    return y;
}

function layoutOutputSockets(node) {
    const right = Number(node.size?.[0] || MIN_WIDTH);
    for (let index = 0; index < (node.outputs?.length || 0); index++) {
        node.outputs[index].pos = [right, STUDIO_LAYOUT.socketStart + index * STUDIO_LAYOUT.socketStep];
    }
}

function visibleInputCount(node) {
    return (node.inputs || []).filter((input) => shouldExposeInput(input)).length;
}

function inputBottom(node) {
    const count = visibleInputCount(node);
    return count ? STUDIO_LAYOUT.socketStart + count * STUDIO_LAYOUT.socketStep + 5 : STUDIO_LAYOUT.headerHeight;
}

function outputBottom(node) {
    layoutOutputSockets(node);
    const count = node.outputs?.length || 0;
    return count ? STUDIO_LAYOUT.socketStart + count * STUDIO_LAYOUT.socketStep + 5 : STUDIO_LAYOUT.headerHeight;
}

function dashboardTop(node) {
    layoutInputSockets(node);
    return Math.max(
        STUDIO_LAYOUT.headerHeight + STUDIO_LAYOUT.socketGap,
        Math.max(inputBottom(node), outputBottom(node)) + STUDIO_LAYOUT.socketGap,
    );
}

function connectedInput(node, name) {
    return (node.inputs || []).find((input) => outputInputName(input) === name && outputInputConnected(input));
}

function saveInputMode(node) {
    if (connectedInput(node, "images")) return "Images";
    if (connectedInput(node, "samples") || connectedInput(node, "vae")) return "Samples + VAE";
    return "Awaiting input";
}

function inputAnchor(node, slotIndex) {
    const input = node.inputs?.[slotIndex];
    if (!input) return null;
    const name = outputInputName(input);
    const y = Number(node.__soOutputInputAnchors?.[name]);
    if (!Number.isFinite(y)) return null;
    return { x: y < 0 ? -10000 : 0, y };
}

function outputAnchor(node, slotIndex) {
    const output = node.outputs?.[Number(slotIndex)];
    if (!output) return null;
    layoutOutputSockets(node);
    const y = Number(output.pos?.[1]);
    if (!Number.isFinite(y)) return null;
    return { x: Number(node.size?.[0] || MIN_WIDTH), y };
}

function dashboardHeight() {
    // location + subfolder + filename + file/metadata + resolved + save path
    return 17 + ROW_H + GAP + 30 + 13 +
        17 + ROW_H * 3 + GAP * 2 + 13 +
        17 + ROW_H * 3 + GAP * 2 + 13 +
        17 + ROW_H * 2 + GAP + 13 +
        17 + ROW_H * 3 + GAP * 2 + 13 +
        17 + 64 + 12 + SECTION_GAP * 5;
}

function layout(node, refit = false) {
    applyStudioNodeColors(node);
    layoutOutputSockets(node);
    node.size[0] = Math.max(Number(node.size?.[0] || 0), MIN_WIDTH);
    const desired = dashboardTop(node) + dashboardHeight() + 18;
    if (refit) node.size[1] = desired;
    else node.size[1] = Math.max(Number(node.size?.[1] || 0), desired);
    node.widgets_start_y = desired;
    node.setDirtyCanvas?.(true, true);
}

function resolvedValue(node, key) {
    const executed = node.__soResolvedValues?.[key];
    if (executed != null && String(executed) !== "") return String(executed);
    const current = widget(node, key)?.value;
    return current == null ? "" : String(current);
}

function drawDashboard(node, ctx) {
    if (!node.__soOutputDashboardReady) return;
    node.__soOutputHits = {};
    const x = PAD, w = node.size[0] - PAD * 2;
    const half = (w - GAP) / 2;
    const quarter = (w - GAP * 3) / 4;
    const third = (w - GAP * 2) / 3;
    let y = dashboardTop(node);
    ctx.save();

    gradientFrame(ctx, x - 4, y - 5, w + 8, 104, 9, .42, CMYKG.cyan);
    section(ctx, "Destination", x + 2, y + 7, CMYKG.cyan);
    y += 17;
    valueRow(ctx, x, y, w, ROW_H, "Output root", widget(node, "output_root")?.value ?? "");
    hit(node, "outputroot", x, y, w, ROW_H, (event) => editText(node, "output_root", "Output root", event));
    y += ROW_H + GAP;
    roundRect(ctx, x, y, w, 30, 7, "rgba(53,215,255,.045)", "rgba(53,215,255,.24)");
    text(ctx, "AUTO CONTEXT", x + 11, y + 15, { color: CMYKG.cyan, font: "700 10px Segoe UI, Arial" });
    text(ctx, `Loader + Prompt + Generation · ${saveInputMode(node)}`, x + w - 11, y + 15, { align: "right", color: CMYKG.muted, font: "10px Segoe UI, Arial" });
    y += 30 + 13 + SECTION_GAP;

    gradientFrame(ctx, x - 4, y - 5, w + 8, 154, 9, .42, CMYKG.magenta);
    section(ctx, "Subfolder recipe", x + 2, y + 7, CMYKG.magenta);
    y += 17;
    valueRow(ctx, x, y, half, ROW_H, "Literal", widget(node, "subfolder_literal")?.value ?? "", { chevron: false });
    valueRow(ctx, x + half + GAP, y, half, ROW_H, "Delimiter", widget(node, "subfolder_delimiter")?.value ?? "_", { chevron: false });
    hit(node, "subLiteral", x, y, half, ROW_H, (event) => editText(node, "subfolder_literal", "Subfolder literal", event));
    hit(node, "subDelim", x + half + GAP, y, half, ROW_H, (event) => editText(node, "subfolder_delimiter", "Subfolder delimiter", event));
    y += ROW_H + GAP;
    ["subfolder_var_1", "subfolder_var_2", "subfolder_var_3", "subfolder_var_4"].forEach((name, index) => {
        const px = x + index * (quarter + GAP);
        valueRow(ctx, px, y, quarter, ROW_H, `Var ${index + 1}`, widget(node, name)?.value ?? NONE);
        hit(node, name, px, y, quarter, ROW_H, () => openChoice(node, `Subfolder variable ${index + 1}`, name, readValues(widget(node, name))));
    });
    y += ROW_H + GAP;
    roundRect(ctx, x, y, w, ROW_H, 7, "rgba(255,74,184,.055)", "rgba(255,74,184,.22)");
    text(ctx, "Resolved recipe", x + 11, y + ROW_H / 2, { color: CMYKG.muted, font: "11px Segoe UI, Arial" });
    text(ctx, fitText(ctx, recipePreview("subfolder_literal", ["subfolder_var_1", "subfolder_var_2", "subfolder_var_3", "subfolder_var_4"], "subfolder_delimiter", node), w - 150), x + w - 11, y + ROW_H / 2, { align: "right", color: CMYKG.magenta, font: "11px Segoe UI, Arial" });
    y += ROW_H + 13 + SECTION_GAP;

    gradientFrame(ctx, x - 4, y - 5, w + 8, 154, 9, .42, CMYKG.yellow);
    section(ctx, "Filename recipe", x + 2, y + 7, CMYKG.yellow);
    y += 17;
    valueRow(ctx, x, y, half, ROW_H, "Literal", widget(node, "filename_literal")?.value ?? "", { chevron: false });
    valueRow(ctx, x + half + GAP, y, half, ROW_H, "Delimiter", widget(node, "filename_delimiter")?.value ?? "_", { chevron: false });
    hit(node, "fileLiteral", x, y, half, ROW_H, (event) => editText(node, "filename_literal", "Filename literal", event));
    hit(node, "fileDelim", x + half + GAP, y, half, ROW_H, (event) => editText(node, "filename_delimiter", "Filename delimiter", event));
    y += ROW_H + GAP;
    ["filename_var_1", "filename_var_2", "filename_var_3"].forEach((name, index) => {
        const px = x + index * (third + GAP);
        valueRow(ctx, px, y, third, ROW_H, `Var ${index + 1}`, widget(node, name)?.value ?? NONE);
        hit(node, name, px, y, third, ROW_H, () => openChoice(node, `Filename variable ${index + 1}`, name, readValues(widget(node, name))));
    });
    y += ROW_H + GAP;
    ["filename_var_4", "filename_var_5", "filename_var_6"].forEach((name, index) => {
        const px = x + index * (third + GAP);
        valueRow(ctx, px, y, third, ROW_H, `Var ${index + 4}`, widget(node, name)?.value ?? NONE);
        hit(node, name, px, y, third, ROW_H, () => openChoice(node, `Filename variable ${index + 4}`, name, readValues(widget(node, name))));
    });
    y += ROW_H + 13 + SECTION_GAP;

    gradientFrame(ctx, x - 4, y - 5, w + 8, 110, 9, .42, CMYKG.green);
    section(ctx, "File + metadata", x + 2, y + 7, CMYKG.green);
    y += 17;
    valueRow(ctx, x, y, third, ROW_H, "Format", widget(node, "extension")?.value ?? "png");
    valueRow(ctx, x + third + GAP, y, third, ROW_H, "Quality", widget(node, "quality")?.value ?? 95, { chevron: false });
    valueRow(ctx, x + (third + GAP) * 2, y, third, ROW_H, "Counter digits", widget(node, "counter_digits")?.value ?? 5, { chevron: false });
    hit(node, "extension", x, y, third, ROW_H, () => openChoice(node, "Image format", "extension", readValues(widget(node, "extension"))));
    hit(node, "quality", x + third + GAP, y, third, ROW_H, (event) => editNumber(node, "quality", "Image quality", event));
    hit(node, "counter", x + (third + GAP) * 2, y, third, ROW_H, (event) => editNumber(node, "counter_digits", "Counter digits", event));
    y += ROW_H + GAP;
    const toggles = [
        ["Prompt metadata", "save_prompt_json"],
        ["Workflow metadata", "save_workflow_json"],
        ["Civitai metadata", "save_civitai_parameters"],
    ];
    toggles.forEach(([label, name], index) => {
        const px = x + index * (third + GAP);
        const active = Boolean(widget(node, name)?.value);
        toggleRow(ctx, px, y, third, ROW_H, label, active, CMYKG.green);
        hit(node, name, px, y, third, ROW_H, () => setWidgetValue(node, name, !active));
    });
    y += ROW_H + 13 + SECTION_GAP;

    gradientFrame(ctx, x - 4, y - 5, w + 8, 154, 9, .42, CMYKG.cyan);
    section(ctx, "Resolved inputs", x + 2, y + 7, CMYKG.cyan);
    text(ctx, "click to copy", x + w - 2, y + 7, { align: "right", color: CMYKG.muted, font: "10px Segoe UI, Arial" });
    y += 17;
    const resolved = [
        ["clean_name", "Clean name"], ["raw_stem", "Raw stem"], ["main_folder", "LoRA folder"],
        ["model_name", "Model"], ["seed", "Seed"], ["main_trigger", "Trigger"],
        ["prompt_index", "Prompt index"], ["outfit_index", "Outfit index"], ["scene_index", "Scene index"],
    ];
    resolved.forEach(([key, label], index) => {
        const row = Math.floor(index / 3), col = index % 3;
        const px = x + col * (third + GAP), py = y + row * (ROW_H + GAP);
        const copied = node.__soOutputCopiedKey === key;
        valueRow(ctx, px, py, third, ROW_H, label, resolvedValue(node, key) || "none", {
            chevron: false,
            fill: copied ? "rgba(74,132,101,.34)" : CMYKG.row,
            stroke: copied ? "rgba(137,213,166,.82)" : CMYKG.outline,
            valueColor: copied ? "#b9efca" : CMYKG.text,
        });
        hit(node, `resolved-${key}`, px, py, third, ROW_H, async () => {
            const value = resolvedValue(node, key);
            if (!value) return;
            if (await copyText(value)) {
                node.__soOutputCopiedKey = key;
                try { navigator.vibrate?.(18); } catch (error) {}
                node.setDirtyCanvas?.(true, true);
                clearTimeout(node.__soOutputCopyTimer);
                node.__soOutputCopyTimer = setTimeout(() => {
                    node.__soOutputCopiedKey = null;
                    node.setDirtyCanvas?.(true, true);
                }, 900);
            }
        });
    });
    y += ROW_H * 3 + GAP * 2 + 13 + SECTION_GAP;

    gradientFrame(ctx, x - 4, y - 5, w + 8, 86, 9, .42, CMYKG.magenta);
    section(ctx, "Last save", x + 2, y + 7, CMYKG.magenta);
    y += 17;
    const pathValue = shortenSavedPath(widget(node, "saved_path")?.value ?? node.properties?.so_saved_output_path ?? "");
    const copiedPath = Boolean(node.__soOutputPathCopied);
    roundRect(ctx, x, y, w, 64, 7, copiedPath ? "rgba(74,132,101,.27)" : "rgba(30,30,34,.98)", copiedPath ? "rgba(137,213,166,.82)" : "rgba(255,74,184,.30)");
    text(ctx, copiedPath ? "✓ Copied output path" : "Final output path", x + 11, y + 17, { color: copiedPath ? "#b9efca" : CMYKG.magenta, font: "700 10px Segoe UI, Arial" });
    text(ctx, fitText(ctx, pathValue || "Run once to populate the saved path", w - 22, "11px Consolas, monospace"), x + 11, y + 42, { color: pathValue ? CMYKG.text : "#77777e", font: "11px Consolas, monospace" });
    hit(node, "savedpath", x, y, w, 64, async () => {
        if (!pathValue) return;
        if (await copyText(pathValue)) {
            node.__soOutputPathCopied = true;
            try { navigator.vibrate?.(18); } catch (error) {}
            node.setDirtyCanvas?.(true, true);
            clearTimeout(node.__soOutputPathTimer);
            node.__soOutputPathTimer = setTimeout(() => {
                node.__soOutputPathCopied = false;
                node.setDirtyCanvas?.(true, true);
            }, 900);
        }
    });

    ctx.restore();
}

function applyStoredState(node, properties = {}) {
    node.__soResolvedValues = normalizeResolvedValues(properties?.so_output_resolved_values);
    const storedPath = properties?.so_saved_output_path;
    if (storedPath != null) setWidgetValue(node, "saved_path", shortenSavedPath(storedPath));
}

function installDashboard(node) {
    node.properties = node.properties || {};
    node.__soOutputDashboardReady = true;
    applyStudioNodeColors(node);
    layoutInputSockets(node);
    for (const target of node.widgets || []) hideNativeWidget(target);
    clearInlineImagePreview(node);
    layout(node, true);
}

app.registerExtension({
    name: "SickOllie.Studio.OutputCore",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== TARGET) return;

        const originalGetConnectionPos = nodeType.prototype.getConnectionPos;
        nodeType.prototype.getConnectionPos = function (isInput, slot, out) {
            if (isInput && this.__soOutputDashboardReady) {
                let slotIndex = typeof slot === "number" ? slot : this.findInputSlot?.(slot);
                if (!Number.isInteger(slotIndex) || slotIndex < 0) slotIndex = Number(slot);
                const anchor = inputAnchor(this, slotIndex);
                if (anchor) {
                    const result = out || [0, 0];
                    result[0] = Number(this.pos?.[0] || 0) + anchor.x;
                    result[1] = Number(this.pos?.[1] || 0) + anchor.y;
                    return result;
                }
            }
            if (!isInput && this.__soOutputDashboardReady) {
                let slotIndex = typeof slot === "number" ? slot : this.findOutputSlot?.(slot);
                if (!Number.isInteger(slotIndex) || slotIndex < 0) slotIndex = Number(slot);
                const anchor = outputAnchor(this, slotIndex);
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
                if (this.__soOutputDashboardReady) {
                    const anchor = inputAnchor(this, slotIndex);
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
                if (this.__soOutputDashboardReady) {
                    const anchor = outputAnchor(this, slotIndex);
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

        const originalCreated = nodeType.prototype.onNodeCreated;
        const originalConfigured = nodeType.prototype.onConfigure;
        const originalExecuted = nodeType.prototype.onExecuted;
        const originalSerialize = nodeType.prototype.serialize;
        const originalForeground = nodeType.prototype.onDrawForeground;
        const originalBackground = nodeType.prototype.onDrawBackground;
        const originalMouseDown = nodeType.prototype.onMouseDown;
        const originalResize = nodeType.prototype.onResize;

        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            this.properties = this.properties || {};
            applyStudioNodeColors(this);
            setTimeout(() => installDashboard(this), 0);
            return result;
        };

        nodeType.prototype.onConfigure = function (info) {
            const result = originalConfigured?.apply(this, arguments);
            this.properties = this.properties || {};
            applyStudioNodeColors(this);
            applyStoredState(this, info?.properties || this.properties);
            setTimeout(() => installDashboard(this), 0);
            return result;
        };

        nodeType.prototype.onExecuted = function (message) {
            // Output Core intentionally has no inline image preview. The saved
            // image remains available to Comfy history/output UI, but this node
            // only consumes the metadata payload it needs for its dashboard.
            clearInlineImagePreview(this);

            let savedPath = unwrap(message?.saved_path);
            if (savedPath != null) {
                savedPath = shortenSavedPath(String(savedPath));
                setWidgetValue(this, "saved_path", savedPath);
                this.properties = this.properties || {};
                this.properties.so_saved_output_path = savedPath;
                window.dispatchEvent(new CustomEvent("sickollie:library-usage-updated", { detail: { savedPath } }));
            }
            this.__soResolvedValues = normalizeResolvedValues(message?.resolved_values);
            this.properties = this.properties || {};
            this.properties.so_output_resolved_values = { ...this.__soResolvedValues };
            this.setDirtyCanvas?.(true, true);
        };

        nodeType.prototype.serialize = function () {
            const data = originalSerialize?.apply(this, arguments) || {};
            data.properties = {
                ...(data.properties || {}),
                so_saved_output_path: String(widget(this, "saved_path")?.value ?? this.properties?.so_saved_output_path ?? ""),
                so_output_resolved_values: { ...(this.__soResolvedValues || normalizeResolvedValues({})) },
            };
            // Keep the backend widget schema boring and deterministic. Decorative
            // dashboard controls are all canvas-only, never positional widgets.
            data.widgets_values = CANONICAL_NAMES.map((name) => widget(this, name)?.value);
            return data;
        };

        nodeType.prototype.onDrawBackground = function () {
            // Native Output-node image thumbnails are intentionally suppressed.
        };

        nodeType.prototype.onDrawForeground = function (ctx) {
            drawStudioChrome(this, ctx, "output");
            drawDashboard(this, ctx);
        };

        nodeType.prototype.onMouseDown = function (event, pos, canvas) {
            if (this.__soOutputDashboardReady) {
                for (const area of Object.values(this.__soOutputHits || {})) {
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
            if (this.__soOutputDashboardReady) {
                this.size[0] = Math.max(Number(this.size?.[0] || 0), MIN_WIDTH);
                layout(this, true);
            }
            return result;
        };
    },
});
