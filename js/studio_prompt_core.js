import { app } from "../../../scripts/app.js";

const TARGET = "SOPromptLogEngineStudio";
const SCHEMA_VERSION = 10;
const NO_FILE = "[None]";
const LARGE_RANDOM_MAX = 1000000000;
const MODES = ["fixed", "increment", "decrement", "randomize", "shuffle"];

const DEFAULT_CLEANUP = String.raw`\?\[|\]
\\?[()]
:\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)`;

const DEFAULTS = {
    prompt_source: "manual",
    manual_prompt: "",
    prompt_log_file: NO_FILE,
    prompt_mode: "increment",
    prompt_index: 0,
    outfit_token_A: "OUTFIT_A",
    outfit_log_file_A: NO_FILE,
    outfit_mode_A: "randomize",
    outfit_index_A: 0,
    outfit_token_B: "OUTFIT_B",
    outfit_log_file_B: NO_FILE,
    outfit_mode_B: "randomize",
    outfit_index_B: 0,
    outfit_token_C: "OUTFIT_C",
    outfit_log_file_C: NO_FILE,
    outfit_mode_C: "randomize",
    outfit_index_C: 0,
    scene_token: "SCENE",
    scene_log_file: NO_FILE,
    scene_mode: "randomize",
    scene_index: 0,
    name_token: "NAME",
    name_value: "",
    item_token: "ITEM",
    item_value: "",
    prefix_enabled: false,
    prefix_text: "",
    suffix_enabled: false,
    suffix_text: "",
    prefix_suffix_separator: ", ",
    cleanup_enabled: true,
    cleanup_rules: DEFAULT_CLEANUP,
    saved_prompt: "",
};

const CANONICAL_NAMES = Object.keys(DEFAULTS);

const COPY_BUTTONS = [
    ["outfit_A", "outfit_token_A", "OUTFIT_A"],
    ["outfit_B", "outfit_token_B", "OUTFIT_B"],
    ["outfit_C", "outfit_token_C", "OUTFIT_C"],
    ["scene", "scene_token", "SCENE"],
    ["name", "name_token", "NAME"],
    ["item", "item_token", "ITEM"],
];

const TEXT_HEIGHTS = {
    manual_prompt: 520,
    prefix_text: 60,
    suffix_text: 60,
    cleanup_rules: 64,
    saved_prompt: 140,
};

function widget(node, name) {
    return node.widgets?.find((item) => item.name === name);
}

function readValues(comboWidget) {
    const source = comboWidget?.options?.values;
    if (Array.isArray(source)) return [...source];
    if (typeof source === "function") {
        try {
            const result = source();
            return Array.isArray(result) ? [...result] : [];
        } catch (error) {}
    }
    return [];
}

function writeValues(comboWidget, values) {
    if (!comboWidget) return;
    comboWidget.options = comboWidget.options || {};
    comboWidget.options.values = [...values];
}

function isMode(value) {
    return MODES.includes(String(value));
}

function canonicalValues(overrides = {}) {
    return CANONICAL_NAMES.map((name) =>
        Object.prototype.hasOwnProperty.call(overrides, name)
            ? overrides[name]
            : DEFAULTS[name],
    );
}

function withSchema(info, widgetsValues) {
    return {
        ...info,
        properties: {
            ...(info?.properties || {}),
            so_prompt_core_schema_version: SCHEMA_VERSION,
        },
        widgets_values: widgetsValues,
    };
}

function migrateLegacy30(info, values) {
    const sharedAffixEnabled = Boolean(values[22]);
    return withSchema(info, canonicalValues({
        prompt_source: values[0],
        manual_prompt: values[1],
        prompt_log_file: values[2],
        prompt_mode: values[3],
        prompt_index: values[4],
        outfit_token_A: values[8] || "OUTFIT_A",
        outfit_log_file_A: values[7] || NO_FILE,
        outfit_mode_A: values[9] || "randomize",
        outfit_index_A: values[10] ?? 0,
        scene_token: values[14] || "SCENE",
        scene_log_file: values[13] || NO_FILE,
        scene_mode: values[15] || "randomize",
        scene_index: values[16] ?? 0,
        name_token: values[18] || "NAME",
        name_value: values[19] ?? "",
        item_token: values[20] || "ITEM",
        item_value: values[21] ?? "",
        prefix_enabled: sharedAffixEnabled,
        prefix_text: values[23] ?? "",
        suffix_enabled: sharedAffixEnabled,
        suffix_text: values[24] ?? "",
        prefix_suffix_separator: values[25] ?? ", ",
        cleanup_enabled: values[27] ?? true,
        cleanup_rules: values[28] ?? DEFAULT_CLEANUP,
        saved_prompt: values[29] ?? info?.properties?.so_saved_final_prompt ?? "",
    }));
}

function migrateDev9DisplayOrder(info, values) {
    const sharedAffixEnabled = Boolean(values[25]);
    return withSchema(info, canonicalValues({
        prompt_source: values[0],
        manual_prompt: values[1],
        prompt_log_file: values[2],
        prompt_mode: values[3],
        prompt_index: values[4],
        outfit_token_A: values[5] || "OUTFIT_A",
        outfit_log_file_A: values[6] || NO_FILE,
        outfit_mode_A: values[7] || "randomize",
        outfit_index_A: values[8] ?? 0,
        outfit_token_B: values[9] || "OUTFIT_B",
        outfit_log_file_B: values[10] || NO_FILE,
        outfit_mode_B: values[11] || "randomize",
        outfit_index_B: values[12] ?? 0,
        outfit_token_C: values[13] || "OUTFIT_C",
        outfit_log_file_C: values[14] || NO_FILE,
        outfit_mode_C: values[15] || "randomize",
        outfit_index_C: values[16] ?? 0,
        scene_token: values[17] || "SCENE",
        scene_log_file: values[18] || NO_FILE,
        scene_mode: values[19] || "randomize",
        scene_index: values[20] ?? 0,
        name_token: values[21] || "NAME",
        name_value: values[22] ?? "",
        item_token: values[23] || "ITEM",
        item_value: values[24] ?? "",
        prefix_enabled: sharedAffixEnabled,
        prefix_text: values[26] ?? "",
        suffix_enabled: sharedAffixEnabled,
        suffix_text: values[27] ?? "",
        prefix_suffix_separator: values[28] ?? ", ",
        cleanup_enabled: values[29] ?? true,
        cleanup_rules: values[30] ?? DEFAULT_CLEANUP,
        saved_prompt: values[31] ?? info?.properties?.so_saved_final_prompt ?? "",
    }));
}

function migrateDev9BackendOrder(info, values) {
    const sharedAffixEnabled = Boolean(values[22]);
    return withSchema(info, canonicalValues({
        prompt_source: values[0],
        manual_prompt: values[1],
        prompt_log_file: values[2],
        prompt_mode: values[3],
        prompt_index: values[4],
        outfit_token_A: values[8] || "OUTFIT_A",
        outfit_log_file_A: values[7] || NO_FILE,
        outfit_mode_A: values[9] || "randomize",
        outfit_index_A: values[10] ?? 0,
        outfit_token_B: values[30] || "OUTFIT_B",
        outfit_log_file_B: values[31] || NO_FILE,
        outfit_mode_B: values[32] || "randomize",
        outfit_index_B: values[33] ?? 0,
        outfit_token_C: values[34] || "OUTFIT_C",
        outfit_log_file_C: values[35] || NO_FILE,
        outfit_mode_C: values[36] || "randomize",
        outfit_index_C: values[37] ?? 0,
        scene_token: values[14] || "SCENE",
        scene_log_file: values[13] || NO_FILE,
        scene_mode: values[15] || "randomize",
        scene_index: values[16] ?? 0,
        name_token: values[18] || "NAME",
        name_value: values[19] ?? "",
        item_token: values[20] || "ITEM",
        item_value: values[21] ?? "",
        prefix_enabled: sharedAffixEnabled,
        prefix_text: values[23] ?? "",
        suffix_enabled: sharedAffixEnabled,
        suffix_text: values[24] ?? "",
        prefix_suffix_separator: values[25] ?? ", ",
        cleanup_enabled: values[27] ?? true,
        cleanup_rules: values[28] ?? DEFAULT_CLEANUP,
        saved_prompt: values[29] ?? info?.properties?.so_saved_final_prompt ?? "",
    }));
}

function migrateDev9ButtonOrder(info, values) {
    const sharedAffixEnabled = Boolean(values[31]);
    return withSchema(info, canonicalValues({
        prompt_source: values[0],
        manual_prompt: values[1],
        prompt_log_file: values[2],
        prompt_mode: values[3],
        prompt_index: values[4],
        outfit_token_A: values[6] || "OUTFIT_A",
        outfit_log_file_A: values[7] || NO_FILE,
        outfit_mode_A: values[8] || "randomize",
        outfit_index_A: values[9] ?? 0,
        outfit_token_B: values[11] || "OUTFIT_B",
        outfit_log_file_B: values[12] || NO_FILE,
        outfit_mode_B: values[13] || "randomize",
        outfit_index_B: values[14] ?? 0,
        outfit_token_C: values[16] || "OUTFIT_C",
        outfit_log_file_C: values[17] || NO_FILE,
        outfit_mode_C: values[18] || "randomize",
        outfit_index_C: values[19] ?? 0,
        scene_token: values[21] || "SCENE",
        scene_log_file: values[22] || NO_FILE,
        scene_mode: values[23] || "randomize",
        scene_index: values[24] ?? 0,
        name_token: values[26] || "NAME",
        name_value: values[27] ?? "",
        item_token: values[29] || "ITEM",
        item_value: values[30] ?? "",
        prefix_enabled: sharedAffixEnabled,
        prefix_text: values[32] ?? "",
        suffix_enabled: sharedAffixEnabled,
        suffix_text: values[33] ?? "",
        prefix_suffix_separator: values[34] ?? ", ",
        cleanup_enabled: values[35] ?? true,
        cleanup_rules: values[36] ?? DEFAULT_CLEANUP,
        saved_prompt: values[37] ?? info?.properties?.so_saved_final_prompt ?? "",
    }));
}

function migratePromptWorkflow(info) {
    const values = info?.widgets_values;
    if (!Array.isArray(values)) return info;

    if (
        Number(info?.properties?.so_prompt_core_schema_version) >= SCHEMA_VERSION &&
        values.length === CANONICAL_NAMES.length
    ) {
        return info;
    }

    if (values.length === 30) {
        return migrateLegacy30(info, values);
    }

    if (values.length === 44) {
        return migrateDev9ButtonOrder(info, values);
    }

    if (values.length === 38) {
        const looksDisplayOrder =
            typeof values[5] === "string" &&
            isMode(values[7]) &&
            isMode(values[11]) &&
            isMode(values[15]) &&
            isMode(values[19]);

        const looksBackendOrder =
            typeof values[5] === "boolean" &&
            isMode(values[9]) &&
            isMode(values[15]) &&
            isMode(values[32]) &&
            isMode(values[36]);

        if (looksDisplayOrder) return migrateDev9DisplayOrder(info, values);
        if (looksBackendOrder) return migrateDev9BackendOrder(info, values);

        console.warn(
            "[Sick Ollie Prompt Core] A dev9 workflow appears to have been saved " +
            "after its widgets shifted. Restoring safe defaults for the new channels.",
        );
        return withSchema(info, canonicalValues({
            prompt_source: values[0] ?? "manual",
            manual_prompt: values[1] ?? "",
            prompt_log_file: values[2] ?? NO_FILE,
            prompt_mode: isMode(values[3]) ? values[3] : "increment",
            prompt_index: Number.isFinite(Number(values[4])) ? Number(values[4]) : 0,
            saved_prompt: info?.properties?.so_saved_final_prompt ?? "",
        }));
    }

    if (values.length === CANONICAL_NAMES.length) {
        return withSchema(info, values);
    }

    return info;
}

function setWidgetHeight(widgetRef, contentHeight) {
    if (!widgetRef) return;
    const height = Number(contentHeight);
    widgetRef.computeSize = (width) => [width || 0, height + 18];
    widgetRef.options = { ...(widgetRef.options || {}), min_height: height };
    if (widgetRef.inputEl) {
        widgetRef.inputEl.style.minHeight = `${height}px`;
        widgetRef.inputEl.style.height = `${height}px`;
        widgetRef.inputEl.style.maxHeight = `${height}px`;
        widgetRef.inputEl.style.resize = "none";
    }
}

function setTextWidget(node, name, value) {
    const target = widget(node, name);
    if (!target || value == null) return;
    target.value = String(value);
    if (target.inputEl) target.inputEl.value = String(value);
    node.setDirtyCanvas?.(true, true);
}

function moveButtonBefore(node, button, targetName) {
    const buttonIndex = node.widgets?.indexOf(button) ?? -1;
    if (buttonIndex >= 0) node.widgets.splice(buttonIndex, 1);
    const targetIndex = node.widgets?.findIndex((item) => item.name === targetName) ?? -1;
    if (targetIndex >= 0) node.widgets.splice(targetIndex, 0, button);
    else node.widgets.push(button);
}

function createCopyButtons(node) {
    if (node.__soPromptCopyButtons) return;
    node.__soPromptCopyButtons = {};

    for (const [key, tokenName, fallback] of COPY_BUTTONS) {
        const button = node.addWidget(
            "button",
            `📋 Copy ${fallback}`,
            null,
            async () => {
                const value = String(widget(node, tokenName)?.value || fallback).trim() || fallback;
                try {
                    await navigator.clipboard.writeText(value);
                } catch (error) {}
            },
            { serialize: false },
        );
        button.serialize = false;
        button.options = { ...(button.options || {}), serialize: false };
        node.__soPromptCopyButtons[key] = button;
        moveButtonBefore(node, button, tokenName);
    }
}

function updateCopyButtons(node) {
    if (!node.__soPromptCopyButtons) return;
    for (const [key, tokenName, fallback] of COPY_BUTTONS) {
        const button = node.__soPromptCopyButtons[key];
        if (!button) continue;
        const value = String(widget(node, tokenName)?.value || fallback).trim() || fallback;
        button.name = `📋 Copy ${value}`;
    }
    node.setDirtyCanvas?.(true, true);
}

function bindTokenCallbacks(node) {
    for (const [, tokenName] of COPY_BUTTONS) {
        const target = widget(node, tokenName);
        if (!target || target.__soCopyBound) continue;
        target.__soCopyBound = true;
        const originalCallback = target.callback;
        target.callback = function (...args) {
            const result = originalCallback?.apply(this, args);
            updateCopyButtons(node);
            return result;
        };
        target.inputEl?.addEventListener("input", () => updateCopyButtons(node));
    }
}

const STREAM_BASES = ["prompt", "outfit_A", "outfit_B", "outfit_C", "scene"];

function streamCategory(base) {
    if (base === "prompt") return "prompt";
    if (base.startsWith("outfit_")) return "outfit";
    return "scene";
}

function streamTokenWidget(base) {
    if (base === "outfit_A") return "outfit_token_A";
    if (base === "outfit_B") return "outfit_token_B";
    if (base === "outfit_C") return "outfit_token_C";
    if (base === "scene") return "scene_token";
    return "";
}

function normalizedIndex(value, count) {
    if (!count) return 0;
    let number = Number(value ?? 0);
    if (!Number.isFinite(number)) number = 0;
    return ((Math.trunc(number) % count) + count) % count;
}

function shuffledIndices(count, exclude = null) {
    const values = Array.from({ length: count }, (_, index) => index)
        .filter((index) => index !== exclude);
    for (let index = values.length - 1; index > 0; index--) {
        const swap = Math.floor(Math.random() * (index + 1));
        [values[index], values[swap]] = [values[swap], values[index]];
    }
    return values;
}

function promptShuffleState(node) {
    node.properties = node.properties || {};
    if (!node.properties.so_prompt_shuffle_state || typeof node.properties.so_prompt_shuffle_state !== "object") {
        node.properties.so_prompt_shuffle_state = {};
    }
    return node.properties.so_prompt_shuffle_state;
}

function resetShuffleBag(node, base) {
    const all = promptShuffleState(node);
    delete all[base];
}

function nextShuffledIndex(node, base, current, count, fileValue) {
    if (!count) return current;
    if (count === 1) return 0;

    const currentResolved = normalizedIndex(current, count);
    const key = `${String(fileValue ?? NO_FILE)}\u001f${count}`;
    const all = promptShuffleState(node);
    let state = all[base];

    if (!state || state.key !== key || !Array.isArray(state.remaining)) {
        state = {
            key,
            remaining: shuffledIndices(count, currentResolved),
            last: currentResolved,
        };
        all[base] = state;
    }

    // A value manually selected during the cycle counts as consumed.
    state.remaining = state.remaining.filter((index) => index !== currentResolved);

    if (!state.remaining.length) {
        // Every usable line has now appeared once. Begin a fresh shuffled cycle,
        // but do not immediately repeat the line that just ran.
        state.remaining = shuffledIndices(count, currentResolved);
    }

    const next = state.remaining.shift();
    state.last = next;
    return Number.isInteger(next) ? next : currentResolved;
}

async function fetchLogLines(category, fileValue) {
    const file = String(fileValue ?? NO_FILE);
    if (!file || file === NO_FILE) return [];
    const response = await fetch(
        `/sickollie/studio/prompt-core/log-lines?category=${encodeURIComponent(category)}&file=${encodeURIComponent(file)}`,
        { method: "GET" },
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    return Array.isArray(payload?.lines) ? payload.lines.map((line) => String(line)) : [];
}

async function refreshStreamLines(node, base, force = false) {
    const [fileName] = streamConfig(base);
    const fileValue = String(widget(node, fileName)?.value ?? NO_FILE);
    node.__soLogLines = node.__soLogLines || {};
    node.__soLogLineFiles = node.__soLogLineFiles || {};

    if (!force && node.__soLogLineFiles[base] === fileValue && Array.isArray(node.__soLogLines[base])) {
        refreshStreamIndexPreview(node, base);
        return node.__soLogLines[base];
    }

    const requestToken = Symbol(base);
    node.__soLogRequests = node.__soLogRequests || {};
    node.__soLogRequests[base] = requestToken;

    try {
        const lines = await fetchLogLines(streamCategory(base), fileValue);
        if (node.__soLogRequests[base] !== requestToken) return [];
        node.__soLogLineFiles[base] = fileValue;
        node.__soLogLines[base] = lines;
        resetShuffleBag(node, base);
        refreshStreamIndexPreview(node, base);
        node.setDirtyCanvas?.(true, true);
        return lines;
    } catch (error) {
        console.warn(`[Sick Ollie Prompt Core] Could not read ${base} log`, error);
        if (node.__soLogRequests[base] === requestToken) {
            node.__soLogLineFiles[base] = fileValue;
            node.__soLogLines[base] = [];
            refreshStreamIndexPreview(node, base);
        }
        return [];
    }
}

function activeSourceTemplate(node) {
    if (String(widget(node, "prompt_source")?.value ?? "manual") !== "log") {
        return String(widget(node, "manual_prompt")?.value ?? "");
    }
    const lines = node.__soLogLines?.prompt || [];
    if (!lines.length) return "";
    const index = normalizedIndex(widget(node, "prompt_index")?.value, lines.length);
    return String(lines[index] ?? "");
}

function shuffleStreamIsUsed(node, base) {
    if (base === "prompt") return String(widget(node, "prompt_source")?.value ?? "manual") === "log";
    const tokenWidget = streamTokenWidget(base);
    const token = String(widget(node, tokenWidget)?.value ?? "");
    return Boolean(token) && activeSourceTemplate(node).includes(token);
}

function previewChoice(index, line) {
    const compact = String(line ?? "").replace(/\s+/g, " ").trim();
    const shown = compact.length > 150 ? `${compact.slice(0, 149).trimEnd()}…` : compact;
    return `${index} · ${shown}`;
}

function previewWidgetName(base) {
    if (base === "prompt") return "prompt_index_preview";
    if (base === "outfit_A") return "outfit_index_preview_A";
    if (base === "outfit_B") return "outfit_index_preview_B";
    if (base === "outfit_C") return "outfit_index_preview_C";
    return "scene_index_preview";
}

function previewNoLinesValue() {
    return "0 · [no usable lines]";
}

function previewLabel(base, count) {
    const [, , indexName] = streamConfig(base);
    return `${indexName} · ${count} ${count === 1 ? "line" : "lines"}`;
}

function ensureStreamIndexPreview(node, base) {
    const key = `__so${previewWidgetName(base)}`;
    if (node[key]) return node[key];
    const [, , indexName] = streamConfig(base);
    const original = widget(node, indexName);
    if (!original) return null;

    const originalIndex = node.widgets?.indexOf(original) ?? -1;
    original.__soHiddenPreviewIndex = true;
    original.computeSize = () => [0, 0];
    if (original.inputEl) original.inputEl.style.display = "none";

    const combo = node.addWidget(
        "combo",
        previewWidgetName(base),
        previewNoLinesValue(),
        (value) => {
            const match = String(value ?? "").match(/^(-?\d+)\s*·/);
            if (!match) return;
            const index = Number.parseInt(match[1], 10);
            if (!Number.isFinite(index)) return;
            resetShuffleBag(node, base);
            original.value = index;
            try { original.callback?.(index); } catch (error) {}
            refreshStreamIndexPreview(node, base);
        },
        { values: [previewNoLinesValue()], serialize: false },
    );
    combo.serialize = false;
    combo.options = { ...(combo.options || {}), serialize: false };
    combo.label = previewLabel(base, 0);

    const appendedIndex = node.widgets?.indexOf(combo) ?? -1;
    if (originalIndex >= 0 && appendedIndex >= 0) {
        node.widgets.splice(appendedIndex, 1);
        node.widgets.splice(originalIndex + 1, 0, combo);
    }

    node[key] = combo;
    return combo;
}

function refreshStreamIndexPreview(node, base) {
    const combo = ensureStreamIndexPreview(node, base);
    const [, , indexName] = streamConfig(base);
    const indexWidget = widget(node, indexName);
    if (!combo || !indexWidget) return;
    const lines = node.__soLogLines?.[base] || [];
    if (!lines.length) {
        writeValues(combo, [previewNoLinesValue()]);
        combo.value = previewNoLinesValue();
        combo.label = previewLabel(base, 0);
        return;
    }
    const choices = lines.map((line, index) => previewChoice(index, line));
    writeValues(combo, choices);
    const current = normalizedIndex(indexWidget.value, lines.length);
    combo.value = choices[current] ?? choices[0];
    combo.label = previewLabel(base, lines.length);
}

function ensurePromptIndexPreview(node) {
    return ensureStreamIndexPreview(node, "prompt");
}

function refreshPromptIndexPreview(node) {
    return refreshStreamIndexPreview(node, "prompt");
}


function logCategoryFolder(base) {
    if (base === "prompt") return "prompts";
    if (base.startsWith("outfit_")) return "outfits";
    return "scenes";
}

function logBrowserLabel(base) {
    if (base === "prompt") return "Prompt Log";
    if (base === "outfit_A") return "Outfit A Log";
    if (base === "outfit_B") return "Outfit B Log";
    if (base === "outfit_C") return "Outfit C Log";
    return "Scene Log";
}

function logRelativeFile(base, fileValue) {
    const value = String(fileValue ?? NO_FILE).replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    if (!value || value === NO_FILE) return "";
    const category = logCategoryFolder(base);
    const prefix = `${category}/`;
    return value.startsWith(prefix) ? value.slice(prefix.length) : "";
}

function logFolderForFile(base, fileValue) {
    const relative = logRelativeFile(base, fileValue);
    if (!relative) return "";
    const slash = relative.lastIndexOf("/");
    return slash < 0 ? "" : relative.slice(0, slash);
}

function logBrowserButtonText(node, base) {
    const [fileName] = streamConfig(base);
    const selected = String(widget(node, fileName)?.value ?? NO_FILE);
    const relative = logRelativeFile(base, selected);
    return relative
        ? `📄 ${logBrowserLabel(base)}   ${relative}`
        : `📄 ${logBrowserLabel(base)}   [None]`;
}

function allLogFiles(node, base) {
    node.__soAllLogFiles = node.__soAllLogFiles || {};
    if (!Array.isArray(node.__soAllLogFiles[base])) {
        const [fileName] = streamConfig(base);
        node.__soAllLogFiles[base] = readValues(widget(node, fileName));
    }
    return node.__soAllLogFiles[base] || [];
}

function directLogFiles(node, base, folder) {
    const wanted = String(folder ?? "").replace(/^\/+|\/+$/g, "");
    const values = [];
    for (const fullValue of allLogFiles(node, base)) {
        const full = String(fullValue ?? "");
        if (!full || full === NO_FILE) continue;
        const relative = logRelativeFile(base, full);
        if (!relative) continue;
        const slash = relative.lastIndexOf("/");
        const parent = slash < 0 ? "" : relative.slice(0, slash);
        if (parent === wanted) values.push(full);
    }
    return values.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function immediateLogFolders(node, base, folder) {
    const wanted = String(folder ?? "").replace(/^\/+|\/+$/g, "");
    const children = new Set();
    for (const fullValue of allLogFiles(node, base)) {
        const relative = logRelativeFile(base, fullValue);
        if (!relative) continue;
        let remainder = relative;
        if (wanted) {
            if (!relative.startsWith(wanted + "/")) continue;
            remainder = relative.slice(wanted.length + 1);
        }
        const slash = remainder.indexOf("/");
        if (slash < 0) continue;
        const child = remainder.slice(0, slash);
        if (child) children.add(child);
    }
    return [...children].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function moveFrontendWidgetBefore(node, added, anchorWidget) {
    if (!added || !anchorWidget || !Array.isArray(node.widgets)) return;
    const addedIndex = node.widgets.indexOf(added);
    const anchorIndex = node.widgets.indexOf(anchorWidget);
    if (addedIndex < 0 || anchorIndex < 0) return;
    node.widgets.splice(addedIndex, 1);
    node.widgets.splice(anchorIndex, 0, added);
}

function hideLogFileWidget(target) {
    if (!target || target.__soHiddenByFolderNavigator) return;
    target.__soHiddenByFolderNavigator = true;
    target.computeSize = () => [0, 0];
    if (target.inputEl) target.inputEl.style.display = "none";
}

function ensurePromptBrowserPointerTracker() {
    if (window.__soBrowserPointerTrackerInstalled) return;
    window.__soBrowserPointerTrackerInstalled = true;
    window.__soBrowserLastPointer = { x: Math.round(window.innerWidth / 2), y: 180 };
    document.addEventListener("pointerdown", (event) => {
        window.__soBrowserLastPointer = { x: event.clientX, y: event.clientY };
    }, true);
}

function closePromptLogBrowser() {
    const existing = document.getElementById("so-prompt-log-browser-popup");
    if (existing) existing.remove();
    if (window.__soPromptBrowserEscape) {
        document.removeEventListener("keydown", window.__soPromptBrowserEscape, true);
        window.__soPromptBrowserEscape = null;
    }
    if (window.__soPromptBrowserOutside) {
        document.removeEventListener("pointerdown", window.__soPromptBrowserOutside, true);
        window.__soPromptBrowserOutside = null;
    }
}

function promptBrowserShell(base, folder, onSearch) {
    closePromptLogBrowser();
    const root = document.createElement("div");
    root.id = "so-prompt-log-browser-popup";
    Object.assign(root.style, {
        position: "fixed", zIndex: "100000", width: "510px",
        maxWidth: "calc(100vw - 24px)", background: "#151519",
        border: "1px solid rgba(53,215,255,.62)", borderRadius: "9px",
        boxShadow: "0 12px 36px rgba(0,0,0,.58), 0 0 0 1px rgba(255,74,184,.10) inset", color: "#eee",
        font: "13px Arial, sans-serif", overflow: "hidden",
    });

    const header = document.createElement("div");
    Object.assign(header.style, { padding: "10px 12px 6px", borderBottom: "1px solid rgba(255,74,184,.34)" });
    const title = document.createElement("div");
    title.textContent = logBrowserLabel(base);
    Object.assign(title.style, { fontWeight: "700", fontSize: "14px" });
    const subtitle = document.createElement("div");
    subtitle.textContent = folder ? `${logCategoryFolder(base)} / ${folder}` : `${logCategoryFolder(base)} root`;
    Object.assign(subtitle.style, { marginTop: "3px", color: "#aaa", fontSize: "12px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
    header.append(title, subtitle);

    const search = document.createElement("input");
    search.type = "text";
    search.placeholder = `Filter ${logBrowserLabel(base).toLowerCase()} files or folders`;
    Object.assign(search.style, {
        boxSizing: "border-box", width: "calc(100% - 20px)", margin: "9px 10px 7px",
        padding: "7px 9px", background: "#0d0d10", border: "1px solid rgba(246,230,90,.48)",
        borderRadius: "4px", color: "#fff", outline: "none",
    });

    const list = document.createElement("div");
    Object.assign(list.style, { maxHeight: "540px", overflowY: "auto", padding: "3px 0 7px" });
    root.append(header, search, list);
    document.body.append(root);

    const pointer = window.__soBrowserLastPointer || { x: window.innerWidth / 2, y: 180 };
    let left = Math.min(pointer.x - 18, window.innerWidth - 530);
    let top = Math.min(pointer.y + 12, window.innerHeight - 620);
    left = Math.max(10, left);
    top = Math.max(10, top);
    root.style.left = `${left}px`;
    root.style.top = `${top}px`;

    search.addEventListener("input", () => onSearch(search.value));
    root.addEventListener("pointerdown", (event) => event.stopPropagation());
    window.__soPromptBrowserEscape = (event) => {
        if (event.key === "Escape") closePromptLogBrowser();
    };
    document.addEventListener("keydown", window.__soPromptBrowserEscape, true);
    window.__soPromptBrowserOutside = (event) => {
        if (!root.contains(event.target)) closePromptLogBrowser();
    };
    setTimeout(() => {
        document.addEventListener("pointerdown", window.__soPromptBrowserOutside, true);
        search.focus();
    }, 0);
    return { root, subtitle, search, list };
}

function promptBrowserRow(list, label, kind, callback, hint = "") {
    const row = document.createElement("div");
    const icon = kind === "folder" ? "📁  " : "";
    row.textContent = `${icon}${label}`;
    Object.assign(row.style, {
        padding: "7px 12px", cursor: "pointer", borderBottom: "1px solid #242424",
        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
        color: kind === "action" ? "#ccc" : "#f4f4f4",
    });
    if (hint) row.title = hint;
    row.addEventListener("mouseenter", () => row.style.background = "rgba(53,215,255,.10)");
    row.addEventListener("mouseleave", () => row.style.background = "transparent");
    row.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        callback();
    });
    list.append(row);
    return row;
}

function promptBrowserDivider(list) {
    const divider = document.createElement("div");
    Object.assign(divider.style, { height: "1px", background: "rgba(110,231,162,.34)", margin: "5px 0" });
    list.append(divider);
}

function refreshLogBrowserButton(node, base) {
    const button = node.__soLogBrowserButtons?.[base];
    if (button) button.name = logBrowserButtonText(node, base);
    node.setDirtyCanvas?.(true, true);
}

function selectLogFile(node, base, full) {
    const [fileName] = streamConfig(base);
    const fileWidget = widget(node, fileName);
    if (!fileWidget) return;
    fileWidget.value = String(full ?? NO_FILE);
    try { fileWidget.callback?.(fileWidget.value); } catch (error) {}
    node.__soLogBrowseFolders = node.__soLogBrowseFolders || {};
    if (fileWidget.value !== NO_FILE) node.__soLogBrowseFolders[base] = logFolderForFile(base, fileWidget.value);
    refreshLogBrowserButton(node, base);
}

function renderPromptLogBrowser(node, base, shell, query = "") {
    node.__soLogBrowseFolders = node.__soLogBrowseFolders || {};
    let folder = String(node.__soLogBrowseFolders[base] ?? "").replace(/^\/+|\/+$/g, "");
    shell.subtitle.textContent = folder ? `${logCategoryFolder(base)} / ${folder}` : `${logCategoryFolder(base)} root`;
    shell.list.replaceChildren();
    const q = String(query ?? "").trim().toLowerCase();

    if (q) {
        const folderSet = new Set();
        const fileHits = [];
        for (const fullValue of allLogFiles(node, base)) {
            const full = String(fullValue ?? "");
            if (!full || full === NO_FILE) continue;
            const relative = logRelativeFile(base, full);
            if (!relative) continue;
            const parts = relative.split("/");
            for (let i = 1; i < parts.length; i++) {
                const folderPath = parts.slice(0, i).join("/");
                if (folderPath.toLowerCase().includes(q)) folderSet.add(folderPath);
            }
            if (relative.toLowerCase().includes(q)) fileHits.push(full);
        }
        const folderHits = [...folderSet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })).slice(0, 120);
        for (const path of folderHits) {
            promptBrowserRow(shell.list, path, "folder", () => {
                node.__soLogBrowseFolders[base] = path;
                shell.search.value = "";
                renderPromptLogBrowser(node, base, shell, "");
            }, path);
        }
        if (folderHits.length && fileHits.length) promptBrowserDivider(shell.list);
        for (const full of fileHits.slice(0, 180)) {
            const relative = logRelativeFile(base, full);
            promptBrowserRow(shell.list, relative, "file", () => {
                selectLogFile(node, base, full);
                closePromptLogBrowser();
            }, full);
        }
        if (!folderHits.length && !fileHits.length) promptBrowserRow(shell.list, "No matches", "action", () => {});
        return;
    }

    promptBrowserRow(shell.list, "[None] · clear selected log", "action", () => {
        selectLogFile(node, base, NO_FILE);
        closePromptLogBrowser();
    });
    if (folder) {
        promptBrowserRow(shell.list, "↑ Parent Folder", "action", () => {
            const slash = folder.lastIndexOf("/");
            node.__soLogBrowseFolders[base] = slash < 0 ? "" : folder.slice(0, slash);
            renderPromptLogBrowser(node, base, shell, "");
        });
    }
    promptBrowserRow(shell.list, `⌂ ${logCategoryFolder(base)} Root`, "action", () => {
        node.__soLogBrowseFolders[base] = "";
        renderPromptLogBrowser(node, base, shell, "");
    });
    promptBrowserDivider(shell.list);

    const children = immediateLogFolders(node, base, folder);
    for (const child of children) {
        promptBrowserRow(shell.list, child, "folder", () => {
            node.__soLogBrowseFolders[base] = folder ? `${folder}/${child}` : child;
            renderPromptLogBrowser(node, base, shell, "");
        });
    }

    const files = directLogFiles(node, base, folder);
    if (children.length && files.length) promptBrowserDivider(shell.list);
    for (const full of files) {
        const relative = logRelativeFile(base, full);
        const slash = relative.lastIndexOf("/");
        const basename = slash < 0 ? relative : relative.slice(slash + 1);
        promptBrowserRow(shell.list, basename, "file", () => {
            selectLogFile(node, base, full);
            closePromptLogBrowser();
        }, full);
    }

    if (!children.length && !files.length) promptBrowserRow(shell.list, "No folders or .txt files here", "action", () => {});
}

function openPromptLogBrowser(node, base) {
    ensurePromptBrowserPointerTracker();
    node.__soLogBrowseFolders = node.__soLogBrowseFolders || {};
    const [fileName] = streamConfig(base);
    const selected = String(widget(node, fileName)?.value ?? NO_FILE);
    if (selected !== NO_FILE) node.__soLogBrowseFolders[base] = logFolderForFile(base, selected);
    if (!Object.prototype.hasOwnProperty.call(node.__soLogBrowseFolders, base)) node.__soLogBrowseFolders[base] = "";

    const shell = promptBrowserShell(
        base,
        node.__soLogBrowseFolders[base],
        (query) => renderPromptLogBrowser(node, base, shell, query),
    );
    renderPromptLogBrowser(node, base, shell, "");
}

function ensureLogNavigator(node, base) {
    node.__soLogBrowserButtons = node.__soLogBrowserButtons || {};
    const [fileName] = streamConfig(base);
    const fileWidget = widget(node, fileName);
    if (!fileWidget) return null;

    allLogFiles(node, base);
    hideLogFileWidget(fileWidget);

    let button = node.__soLogBrowserButtons[base];
    if (!button) {
        button = node.addWidget(
            "button",
            logBrowserButtonText(node, base),
            null,
            () => openPromptLogBrowser(node, base),
            { serialize: false },
        );
        button.serialize = false;
        button.options = { ...(button.options || {}), serialize: false };
        node.__soLogBrowserButtons[base] = button;
        moveFrontendWidgetBefore(node, button, fileWidget);
    }

    if (!fileWidget.__soFolderNavigatorBound) {
        fileWidget.__soFolderNavigatorBound = true;
        const previousCallback = fileWidget.callback;
        fileWidget.callback = function (...args) {
            const result = previousCallback?.apply(this, args);
            refreshLogBrowserButton(node, base);
            return result;
        };
    }

    refreshLogBrowserButton(node, base);
    return button;
}

function ensureAllLogNavigators(node) {
    for (const base of STREAM_BASES) ensureLogNavigator(node, base);
}

function bindLogControls(node) {
    for (const base of STREAM_BASES) {
        const [fileName, modeName] = streamConfig(base);
        const fileWidget = widget(node, fileName);
        if (fileWidget && !fileWidget.__soLogRefreshBound) {
            fileWidget.__soLogRefreshBound = true;
            const originalCallback = fileWidget.callback;
            fileWidget.callback = function (...args) {
                const result = originalCallback?.apply(this, args);
                refreshStreamLines(node, base, true);
                return result;
            };
        }
        const modeWidget = widget(node, modeName);
        if (modeWidget && !modeWidget.__soShuffleModeBound) {
            modeWidget.__soShuffleModeBound = true;
            const originalCallback = modeWidget.callback;
            modeWidget.callback = function (...args) {
                const result = originalCallback?.apply(this, args);
                resetShuffleBag(node, base);
                return result;
            };
        }
        refreshStreamLines(node, base, false);
    }
}

function streamConfig(base) {
    if (base === "prompt") return ["prompt_log_file", "prompt_mode", "prompt_index"];
    if (base === "outfit_A") return ["outfit_log_file_A", "outfit_mode_A", "outfit_index_A"];
    if (base === "outfit_B") return ["outfit_log_file_B", "outfit_mode_B", "outfit_index_B"];
    if (base === "outfit_C") return ["outfit_log_file_C", "outfit_mode_C", "outfit_index_C"];
    return ["scene_log_file", "scene_mode", "scene_index"];
}

function advanceStream(node, base) {
    const [fileName, modeName, indexName] = streamConfig(base);
    if (base === "prompt" && String(widget(node, "prompt_source")?.value) !== "log") return;
    if (String(widget(node, fileName)?.value ?? NO_FILE) === NO_FILE) return;

    const mode = String(widget(node, modeName)?.value ?? "fixed");
    const indexWidget = widget(node, indexName);
    if (!indexWidget || mode === "fixed") return;

    let current = Number(indexWidget.value ?? 0);
    if (!Number.isFinite(current)) current = 0;
    let next = current;

    if (mode === "shuffle") {
        // Do not consume outfit/scene entries on generations where their token
        // never participated in the source prompt.
        if (!shuffleStreamIsUsed(node, base)) return;
        const lines = node.__soLogLines?.[base] || [];
        if (!lines.length) return;
        next = nextShuffledIndex(
            node,
            base,
            current,
            lines.length,
            widget(node, fileName)?.value,
        );
    } else if (mode === "increment") {
        next = current + 1;
    } else if (mode === "decrement") {
        next = current - 1;
    } else if (mode === "randomize") {
        next = Math.floor(Math.random() * LARGE_RANDOM_MAX);
    }

    indexWidget.value = next;
    try { indexWidget.callback?.(next); } catch (error) {}
    refreshStreamIndexPreview(node, base);
    node.setDirtyCanvas?.(true, true);
}

function bindQueueProgression(node) {
    for (const base of ["prompt", "outfit_A", "outfit_B", "outfit_C", "scene"]) {
        const [, , indexName] = streamConfig(base);
        const indexWidget = widget(node, indexName);
        if (!indexWidget || indexWidget.__soQueueBound) continue;
        indexWidget.__soQueueBound = true;
        const originalAfterQueued = indexWidget.afterQueued;
        indexWidget.afterQueued = () => {
            try { originalAfterQueued?.call(indexWidget); }
            finally { advanceStream(node, base); }
        };
    }
}


const PROMPT_DASH_VERSION = 3;
const PROMPT_DASH_MIN_WIDTH = 800;
const PROMPT_DASH_PAD = 12;
const PROMPT_DASH_GAP = 8;
const PROMPT_DASH_ROW_H = 32;
const PROMPT_DASH_COLLAPSED_H = 1025;
const PROMPT_DASH_EXPANDED_H = 1105;
const SO_CMYKG = {
    cyan: "#35d7ff",
    magenta: "#ff4ab8",
    yellow: "#f6e65a",
    green: "#6ee7a2",
    ink: "#0d0d11",
    panel: "rgba(22,22,26,.98)",
    row: "rgba(38,38,43,.98)",
    outline: "rgba(138,138,151,.40)",
    label: "#9b9ba6",
    text: "#f0f0f3",
};

function promptDashTop(node) {
    return 44;
}

function promptOutputBottom(node) {
    const outputCount = node.outputs?.length || 0;
    // Keep the classic output sockets readable, but tighten their reserved area
    // slightly so the dashboard can begin sooner.
    return Math.max(44, 32 + outputCount * 18 + 8);
}

const PROMPT_VISIBLE_INPUT_NAMES = [
    "name_value",
    "item_value",
    "prefix_text",
    "suffix_text",
];

function promptInputIsConnected(input) {
    return input?.link != null || (Array.isArray(input?.links) && input.links.length > 0);
}

function promptShouldExposeInput(input) {
    const name = promptInputName(input);
    // Four intentionally useful jack points are always visible. Any legacy/
    // unusual socket that is already connected remains visible so old workflows
    // do not silently lose a connection endpoint.
    return PROMPT_VISIBLE_INPUT_NAMES.includes(name) || promptInputIsConnected(input);
}

function promptExternalInputs(node) {
    return (node.inputs || []).filter((input) => {
        const name = promptInputName(input);
        return Boolean(name) && CANONICAL_NAMES.includes(name) && promptShouldExposeInput(input);
    });
}

function promptExternalInputLabel(name) {
    const labels = {
        name_value: "NAME value",
        item_value: "ITEM value",
        prefix_text: "Prefix text",
        suffix_text: "Suffix text",
    };
    return labels[name] || String(name || "Input").replaceAll("_", " ");
}

function layoutPromptInputSockets(node) {
    node.__soPromptInputAnchors = {};
    node.__soPromptExternalInputAnchors = {};
    let y = 48;
    for (const input of node.inputs || []) {
        const name = promptInputName(input);
        if (!name || !CANONICAL_NAMES.includes(name)) continue;
        if (promptShouldExposeInput(input)) {
            node.__soPromptInputAnchors[name] = y;
            node.__soPromptExternalInputAnchors[name] = y;
            input.pos = [0, y];
            input.label = promptExternalInputLabel(name);
            input.color_on = SO_CMYKG.green;
            input.color_off = "#7f8792";
            y += 21;
        } else {
            // Keep the backend/input object intact but move unused converted
            // widget sockets completely outside the visible node surface.
            node.__soPromptInputAnchors[name] = -10000;
            input.pos = [-10000, -10000];
            input.label = "";
        }
    }
    return y;
}

function promptInputSocketsBottom(node) {
    const count = promptExternalInputs(node).length;
    return count ? 48 + count * 21 + 5 : 44;
}

function promptSourceTop(node) {
    return Math.max(promptOutputBottom(node), promptInputSocketsBottom(node)) + 8;
}

function promptSourceHeight(node) {
    const sourceMode = String(widget(node, "prompt_source")?.value ?? "manual");
    return sourceMode === "log" ? 239 : 201;
}

function promptLowerStart(node) {
    return Math.max(
        promptSourceTop(node) + promptSourceHeight(node) + 8,
        promptOutputBottom(node) + 8,
    );
}

function promptLowerHeight(node) {
    // Everything from OUTFITS + SCENE through the copy-resolved button.
    return 774 + (node.properties?.so_prompt_dashboard_advanced ? 82 : 0);
}

function promptDashHeight(node) {
    return promptLowerStart(node) - promptDashTop(node) + promptLowerHeight(node);
}

function promptDashBottom(node) {
    return promptLowerStart(node) + promptLowerHeight(node);
}

function promptRoundRect(ctx, x, y, w, h, radius = 8, fill = null, stroke = null, lineWidth = 1) {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, radius);
    else {
        const r = Math.min(radius, w / 2, h / 2);
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
    }
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}

function promptGradientFrame(ctx, x, y, w, h, radius = 11, alpha = .42) {
    ctx.save();
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, SO_CMYKG.cyan); g.addColorStop(.34, SO_CMYKG.magenta);
    g.addColorStop(.67, SO_CMYKG.yellow); g.addColorStop(1, SO_CMYKG.green);
    ctx.globalAlpha = alpha; promptRoundRect(ctx, x, y, w, h, radius, null, g, 1.15); ctx.restore();
}

function promptDashText(ctx, text, x, y, options = {}) {
    ctx.save();
    ctx.fillStyle = options.color || SO_CMYKG.text;
    ctx.font = options.font || "12px Segoe UI, Arial";
    ctx.textAlign = options.align || "left";
    ctx.textBaseline = options.baseline || "middle";
    ctx.fillText(String(text ?? ""), x, y);
    ctx.restore();
}

function promptSection(ctx, label, x, y, color = SO_CMYKG.cyan) {
    promptDashText(ctx, String(label).toUpperCase(), x, y, { color, font: "700 10px Segoe UI, Arial" });
}

function promptFit(ctx, text, width) {
    const raw = String(text ?? "");
    if (ctx.measureText(raw).width <= width) return raw;
    let out = raw;
    while (out.length > 1 && ctx.measureText(`${out}…`).width > width) out = out.slice(0, -1);
    return `${out.trimEnd()}…`;
}

function promptWrap(ctx, text, width) {
    const output = [];
    for (const para of String(text ?? "").split(/\r?\n/)) {
        if (!para.trim()) { output.push(""); continue; }
        let line = "";
        for (const word of para.split(/\s+/)) {
            const test = line ? `${line} ${word}` : word;
            if (!line || ctx.measureText(test).width <= width) line = test;
            else { output.push(line); line = word; }
        }
        if (line) output.push(line);
    }
    return output;
}

function promptValueRow(ctx, x, y, w, h, label, value, options = {}) {
    promptRoundRect(ctx, x, y, w, h, 8, SO_CMYKG.row, options.stroke || SO_CMYKG.outline);
    promptDashText(ctx, label, x + 12, y + h / 2, { color: SO_CMYKG.label, font: "11px Segoe UI, Arial" });
    ctx.save();
    ctx.font = options.valueFont || "12px Segoe UI, Arial";
    const labelAllowance = Math.min(150, w * .42);
    const shown = promptFit(ctx, String(value ?? ""), Math.max(42, w - labelAllowance - 32));
    ctx.restore();
    promptDashText(ctx, shown, x + w - (options.chevron === false ? 12 : 23), y + h / 2, {
        align: "right", color: options.valueColor || SO_CMYKG.text, font: options.valueFont || "12px Segoe UI, Arial",
    });
    if (options.chevron !== false) promptDashText(ctx, "▾", x + w - 9, y + h / 2, { align: "right", color: SO_CMYKG.label, font: "10px Arial" });
}

function promptToggleRow(ctx, x, y, w, h, label, enabled, color = SO_CMYKG.green) {
    promptRoundRect(ctx, x, y, w, h, 8, SO_CMYKG.row, SO_CMYKG.outline);
    promptDashText(ctx, label, x + 12, y + h / 2, { font: "11px Segoe UI, Arial" });
    const tw = 36, th = 18, tx = x + w - tw - 10, ty = y + (h - th) / 2;
    promptRoundRect(ctx, tx, ty, tw, th, th / 2, enabled ? color : "rgba(82,82,90,.95)", null);
    ctx.beginPath();
    ctx.arc(tx + (enabled ? tw - th / 2 : th / 2), ty + th / 2, 6.6, 0, Math.PI * 2);
    ctx.fillStyle = "#f5f5f5";
    ctx.fill();
}

function promptTextCard(ctx, x, y, w, h, title, text, color, emptyText = "Nothing to display") {
    promptRoundRect(ctx, x, y, w, h, 9, "rgba(29,29,33,.98)", color ? `${color}80` : SO_CMYKG.outline);
    promptDashText(ctx, title, x + 12, y + 14, { color: color || SO_CMYKG.label, font: "700 10px Segoe UI, Arial" });
    ctx.save();
    ctx.beginPath(); ctx.rect(x + 8, y + 25, w - 16, h - 31); ctx.clip();
    ctx.font = "12px Consolas, monospace";
    const content = String(text ?? "").trim() || emptyText;
    const lines = promptWrap(ctx, content, w - 24);
    const lineH = 15;
    const maxLines = Math.max(1, Math.floor((h - 36) / lineH));
    ctx.fillStyle = String(text ?? "").trim() ? SO_CMYKG.text : "rgba(255,255,255,.35)";
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    for (let i = 0; i < Math.min(lines.length, maxLines); i++) {
        let line = lines[i];
        if (i === maxLines - 1 && lines.length > maxLines && line) line = `${line} …`;
        ctx.fillText(line, x + 12, y + 30 + i * lineH);
    }
    ctx.restore();
}

function promptHit(node, name, x, y, w, h, callback) {
    node.__soPromptDashboardHits = node.__soPromptDashboardHits || {};
    node.__soPromptDashboardHits[name] = { x, y, w, h, callback };
}

function promptPointIn(pos, hit) {
    return Boolean(hit && pos && pos[0] >= hit.x && pos[0] <= hit.x + hit.w && pos[1] >= hit.y && pos[1] <= hit.y + hit.h);
}

function promptInputName(input) {
    return String(input?.widget?.name ?? input?.name ?? "");
}

function promptAnchorInput(node, name, y) {
    const input = node.inputs?.find((slot) => promptInputName(slot) === String(name));
    if (!input) return;
    // Dashboard rows no longer drag every possible converted widget socket into
    // view. Only our four intentional jack points (plus already-connected legacy
    // sockets) live at the top of the node.
    if (!promptShouldExposeInput(input)) return;
    const anchorY = Number(node.__soPromptInputAnchors?.[String(name)]);
    if (!Number.isFinite(anchorY)) return;
    input.pos = [0, anchorY];
    input.label = promptExternalInputLabel(name);
    input.color_on = SO_CMYKG.green;
    input.color_off = "#7f8792";
}

function promptClearStaleInputAnchors(node) {
    layoutPromptInputSockets(node);
}

function promptDashboardInputAnchor(node, slotIndex) {
    const input = node.inputs?.[Number(slotIndex)];
    if (!input) return null;
    const name = promptInputName(input);
    const y = Number(node.__soPromptInputAnchors?.[name]);
    if (!CANONICAL_NAMES.includes(name) || !Number.isFinite(y) || y < 0) return null;
    return { name, y };
}

function promptDashboardSet(node, name, value) {
    const target = widget(node, name);
    if (!target) return;
    target.value = value;
    try { target.callback?.(value); } catch (error) {}
    if (name.includes("index")) {
        const base = STREAM_BASES.find((candidate) => streamConfig(candidate)[2] === name);
        if (base) { resetShuffleBag(node, base); refreshStreamIndexPreview(node, base); }
    }
    if (name === "prompt_source") {
        layoutPromptDashboard(node, true);
    }
    node.setDirtyCanvas?.(true, true);
}

function promptDashboardToggle(node, name) {
    const target = widget(node, name);
    if (target) promptDashboardSet(node, name, !Boolean(target.value));
}

function closePromptChoicePopup() {
    const root = document.getElementById("so-prompt-dashboard-choice");
    if (root) root.remove();
    if (window.__soPromptChoiceOutside) {
        document.removeEventListener("pointerdown", window.__soPromptChoiceOutside, true);
        window.__soPromptChoiceOutside = null;
    }
    if (window.__soPromptChoiceEscape) {
        document.removeEventListener("keydown", window.__soPromptChoiceEscape, true);
        window.__soPromptChoiceEscape = null;
    }
}

function promptChoicePopup(node, title, values, selected, onChoose, formatter = null) {
    closePromptChoicePopup();
    closePromptLogBrowser();
    ensurePromptBrowserPointerTracker();
    const root = document.createElement("div");
    root.id = "so-prompt-dashboard-choice";
    Object.assign(root.style, {
        position: "fixed", zIndex: "100001", width: "520px", maxWidth: "calc(100vw - 24px)",
        background: "#151519", border: `1px solid ${SO_CMYKG.cyan}99`, borderRadius: "10px",
        boxShadow: `0 14px 42px rgba(0,0,0,.62), 0 0 0 1px ${SO_CMYKG.magenta}22 inset`,
        color: "#f3f3f5", font: "13px Segoe UI, Arial", overflow: "hidden",
    });
    const head = document.createElement("div");
    head.textContent = title;
    Object.assign(head.style, { padding: "10px 12px", fontWeight: "700", borderBottom: `1px solid ${SO_CMYKG.magenta}55` });
    const search = document.createElement("input");
    search.placeholder = `Filter ${String(title).toLowerCase()}`;
    Object.assign(search.style, { boxSizing: "border-box", width: "calc(100% - 20px)", margin: "9px 10px 7px", padding: "7px 9px", background: "#0d0d10", border: `1px solid ${SO_CMYKG.yellow}77`, borderRadius: "5px", color: "#fff", outline: "none" });
    const list = document.createElement("div");
    Object.assign(list.style, { maxHeight: "520px", overflowY: "auto", paddingBottom: "6px" });
    root.append(head, search, list); document.body.append(root);
    const pointer = window.__soBrowserLastPointer || { x: innerWidth / 2, y: 180 };
    root.style.left = `${Math.max(10, Math.min(pointer.x - 20, innerWidth - 540))}px`;
    root.style.top = `${Math.max(10, Math.min(pointer.y + 10, innerHeight - 610))}px`;
    root.addEventListener("pointerdown", (event) => event.stopPropagation());

    const render = () => {
        list.replaceChildren();
        const q = search.value.trim().toLowerCase();
        const filtered = (values || []).filter((value) => {
            const shown = formatter ? formatter(value) : String(value);
            return !q || shown.toLowerCase().includes(q) || String(value).toLowerCase().includes(q);
        });
        for (const value of filtered.slice(0, 400)) {
            const row = document.createElement("div");
            const shown = formatter ? formatter(value) : String(value);
            row.textContent = `${String(value) === String(selected) ? "✓  " : ""}${shown}`;
            Object.assign(row.style, { padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid #29292f", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
            row.addEventListener("mouseenter", () => row.style.background = "rgba(53,215,255,.10)");
            row.addEventListener("mouseleave", () => row.style.background = "transparent");
            row.addEventListener("click", (event) => { event.stopPropagation(); onChoose(value); closePromptChoicePopup(); });
            list.append(row);
        }
        if (!filtered.length) {
            const row = document.createElement("div"); row.textContent = "No matches";
            Object.assign(row.style, { padding: "9px 12px", color: "#888" }); list.append(row);
        }
    };
    search.addEventListener("input", render); render();
    window.__soPromptChoiceEscape = (event) => { if (event.key === "Escape") closePromptChoicePopup(); };
    document.addEventListener("keydown", window.__soPromptChoiceEscape, true);
    window.__soPromptChoiceOutside = (event) => { if (!root.contains(event.target)) closePromptChoicePopup(); };
    setTimeout(() => { document.addEventListener("pointerdown", window.__soPromptChoiceOutside, true); search.focus(); }, 0);
}

function closePromptTextEditor() {
    const root = document.getElementById("so-prompt-dashboard-editor");
    if (root) root.remove();
}

function promptTextEditor(node, title, widgetName, multiline = true) {
    closePromptTextEditor(); closePromptChoicePopup(); closePromptLogBrowser();
    const target = widget(node, widgetName); if (!target) return;
    const root = document.createElement("div"); root.id = "so-prompt-dashboard-editor";
    Object.assign(root.style, { position: "fixed", zIndex: "100002", inset: "0", background: "rgba(0,0,0,.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" });
    const card = document.createElement("div");
    Object.assign(card.style, { width: multiline ? "760px" : "560px", maxWidth: "95vw", background: "#151519", border: `1px solid ${SO_CMYKG.magenta}aa`, borderRadius: "12px", boxShadow: `0 18px 60px rgba(0,0,0,.7), 0 0 0 1px ${SO_CMYKG.cyan}22 inset`, overflow: "hidden" });
    const header = document.createElement("div"); header.textContent = title;
    Object.assign(header.style, { padding: "12px 14px", font: "700 14px Segoe UI, Arial", color: "#f4f4f5", borderBottom: `1px solid ${SO_CMYKG.yellow}55` });
    const input = multiline ? document.createElement("textarea") : document.createElement("input");
    input.value = String(target.value ?? "");
    Object.assign(input.style, { boxSizing: "border-box", width: "calc(100% - 24px)", margin: "12px", minHeight: multiline ? "360px" : "38px", resize: multiline ? "vertical" : "none", padding: "10px 11px", background: "#0d0d10", color: "#f4f4f5", border: `1px solid ${SO_CMYKG.cyan}77`, borderRadius: "7px", outline: "none", font: multiline ? "13px Consolas, monospace" : "13px Segoe UI, Arial" });
    const footer = document.createElement("div"); Object.assign(footer.style, { display: "flex", justifyContent: "flex-end", gap: "8px", padding: "0 12px 12px" });
    const cancel = document.createElement("button"); cancel.textContent = "Cancel";
    const save = document.createElement("button"); save.textContent = "Save";
    for (const btn of [cancel, save]) Object.assign(btn.style, { padding: "8px 16px", borderRadius: "6px", border: "1px solid #555", background: "#25252a", color: "#fff", cursor: "pointer" });
    save.style.borderColor = `${SO_CMYKG.green}aa`; save.style.background = "rgba(52,105,73,.7)";
    cancel.onclick = () => closePromptTextEditor();
    save.onclick = () => { promptDashboardSet(node, widgetName, input.value); closePromptTextEditor(); };
    root.addEventListener("pointerdown", (event) => { if (event.target === root) closePromptTextEditor(); });
    input.addEventListener("keydown", (event) => { if ((event.ctrlKey || event.metaKey) && event.key === "Enter") save.click(); if (event.key === "Escape") closePromptTextEditor(); });
    footer.append(cancel, save); card.append(header, input, footer); root.append(card); document.body.append(root); setTimeout(() => input.focus(), 0);
}

async function promptCopyValue(node, key, value) {
    const text = String(value ?? "").trim(); if (!text) return;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch (error) {}
    if (!ok) return;
    try { if (navigator?.vibrate) navigator.vibrate(12); } catch (error) {}
    node.__soPromptCopyFlash = key;
    node.setDirtyCanvas?.(true, true);
    clearTimeout(node.__soPromptCopyTimer);
    node.__soPromptCopyTimer = setTimeout(() => { node.__soPromptCopyFlash = ""; node.setDirtyCanvas?.(true, true); }, 850);
}

function promptLogDisplay(node, base) {
    const [fileName] = streamConfig(base);
    const value = String(widget(node, fileName)?.value ?? NO_FILE);
    if (!value || value === NO_FILE) return "[None]";
    const relative = logRelativeFile(base, value);
    return relative || value;
}

function promptStreamLine(node, base) {
    const lines = node.__soLogLines?.[base] || [];
    const [, , indexName] = streamConfig(base);
    if (!lines.length) return "[no usable lines]";
    return String(lines[normalizedIndex(widget(node, indexName)?.value, lines.length)] ?? "");
}

function promptStreamIndexLabel(node, base) {
    const lines = node.__soLogLines?.[base] || [];
    const [, , indexName] = streamConfig(base);
    const index = lines.length ? normalizedIndex(widget(node, indexName)?.value, lines.length) : 0;
    return `${index} · ${lines.length} ${lines.length === 1 ? "line" : "lines"}`;
}

function promptOpenIndexChoice(node, base) {
    const lines = node.__soLogLines?.[base] || [];
    if (!lines.length) return;
    const [, , indexName] = streamConfig(base);
    const values = lines.map((_, index) => index);
    const current = normalizedIndex(widget(node, indexName)?.value, lines.length);
    promptChoicePopup(node, `${logBrowserLabel(base)} index · ${lines.length} lines`, values, current, (value) => promptDashboardSet(node, indexName, Number(value)), (value) => previewChoice(Number(value), lines[Number(value)]));
}

function promptDrawStreamCard(node, ctx, base, x, y, w, accent, hitPrefix) {
    const h = 83;
    const [fileName, modeName, indexName] = streamConfig(base);
    const tokenName = streamTokenWidget(base);
    promptAnchorInput(node, tokenName, y + 14);
    promptAnchorInput(node, fileName, y + 38);
    promptAnchorInput(node, modeName, y + 67);
    promptAnchorInput(node, indexName, y + 67);
    promptRoundRect(ctx, x, y, w, h, 9, "rgba(25,25,29,.98)", `${accent}88`);
    const token = String(widget(node, tokenName)?.value ?? (base === "scene" ? "SCENE" : base.replace("outfit_", "OUTFIT_")));
    const title = base === "scene" ? "SCENE" : base.replace("outfit_", "OUTFIT ").toUpperCase();
    promptDashText(ctx, `${title}  ✎`, x + 12, y + 14, { color: accent, font: "700 10px Segoe UI, Arial" });
    promptDashText(ctx, `${token}  ${node.__soPromptCopyFlash === `${hitPrefix}_token` ? "✓" : "📋"}`, x + w - 12, y + 14, { align: "right", color: node.__soPromptCopyFlash === `${hitPrefix}_token` ? SO_CMYKG.green : SO_CMYKG.label, font: "10px Segoe UI, Arial" });
    promptHit(node, `${hitPrefix}_token_edit`, x, y, Math.max(80, w - 155), 26, () => promptTextEditor(node, `${title} token`, tokenName, false));
    promptHit(node, `${hitPrefix}_token`, x + w - 150, y, 150, 28, () => promptCopyValue(node, `${hitPrefix}_token`, token));

    const fileY = y + 26;
    promptValueRow(ctx, x + 8, fileY, w - 16, 25, "Log", promptLogDisplay(node, base), { stroke: `${accent}44` });
    promptHit(node, `${hitPrefix}_file`, x + 8, fileY, w - 16, 25, () => { closePromptChoicePopup(); openPromptLogBrowser(node, base); });

    const bottomY = fileY + 29;
    const gap = 6; const half = (w - 16 - gap) / 2;
    promptValueRow(ctx, x + 8, bottomY, half, 25, "Mode", widget(node, modeName)?.value ?? "fixed");
    promptValueRow(ctx, x + 8 + half + gap, bottomY, half, 25, "Index", promptStreamIndexLabel(node, base));
    promptHit(node, `${hitPrefix}_mode`, x + 8, bottomY, half, 25, () => promptChoicePopup(node, `${title} mode`, MODES, widget(node, modeName)?.value, (value) => promptDashboardSet(node, modeName, value)));
    promptHit(node, `${hitPrefix}_index`, x + 8 + half + gap, bottomY, half, 25, () => promptOpenIndexChoice(node, base));
    return h;
}

function drawPromptExternalInputs(node, ctx, x, y, w) {
    // Keep these intentionally simple, matching Comfy's classic socket labels:
    // the actual graph socket remains native, while we draw the readable label.
    const inputs = promptExternalInputs(node);
    if (!inputs.length) return 0;

    for (const input of inputs) {
        const name = promptInputName(input);
        const anchorY = Number(node.__soPromptInputAnchors?.[name]);
        if (!Number.isFinite(anchorY) || anchorY < 0) continue;

        const connected = promptInputIsConnected(input);
        promptDashText(ctx, promptExternalInputLabel(name), x + 2, anchorY, {
            color: connected ? SO_CMYKG.green : "#a8a8b2",
            font: connected ? "700 11px Segoe UI, Arial" : "11px Segoe UI, Arial",
            baseline: "middle",
        });
    }
    return inputs.length * 21;
}

function drawPromptDashboard(node, ctx) {
    if (!node.__soPromptDashboardReady || node.flags?.collapsed) return;
    node.__soPromptDashboardHits = {};
    const top = promptDashTop(node);
    let x = PROMPT_DASH_PAD;
    const fullW = node.size[0] - PROMPT_DASH_PAD * 2;
    let w = fullW;
    const gap = PROMPT_DASH_GAP;
    const rowH = PROMPT_DASH_ROW_H;
    layoutPromptInputSockets(node);
    let y = promptSourceTop(node);
    ctx.save();

    // Labels for the small native input sockets at the upper-left.
    drawPromptExternalInputs(node, ctx, 12, 0, node.size[0] - 24);

    const sourceTop = y;

    // The socket bay lives above this point. From Prompt Source downward the
    // dashboard is one cohesive full-width surface again.
    const lowerTop = promptLowerStart(node);
    const sourceShellH = Math.max(promptSourceHeight(node), lowerTop - sourceTop - 8);
    promptRoundRect(ctx, x - 3, sourceTop - 5, w + 6, sourceShellH + 10, 11, "rgba(9,9,12,.52)", null);
    promptGradientFrame(ctx, x - 3, sourceTop - 5, w + 6, sourceShellH + 10, 11, .38);
    promptRoundRect(ctx, PROMPT_DASH_PAD - 3, lowerTop - 5, fullW + 6, promptLowerHeight(node) + 10, 11, "rgba(9,9,12,.52)", null);
    promptGradientFrame(ctx, PROMPT_DASH_PAD - 3, lowerTop - 5, fullW + 6, promptLowerHeight(node) + 10, 11, .38);

    promptSection(ctx, "Prompt Source", x + 2, y + 8, SO_CMYKG.cyan); y += 19;
    const sourceMode = String(widget(node, "prompt_source")?.value ?? "manual");
    promptAnchorInput(node, "prompt_source", y + 16);
    const modeW = Math.min(170, w * .28); const sourceRowW = w - modeW - gap;
    if (sourceMode === "log") {
        promptValueRow(ctx, x, y, modeW, rowH, "Source", "Prompt Log");
        promptHit(node, "source_mode", x, y, modeW, rowH, () => promptChoicePopup(node, "Prompt source", ["manual", "log"], sourceMode, (value) => promptDashboardSet(node, "prompt_source", value), (value) => value === "log" ? "Prompt Log" : "Manual"));
        promptValueRow(ctx, x + modeW + gap, y, sourceRowW, rowH, "Prompt log", promptLogDisplay(node, "prompt"), { stroke: `${SO_CMYKG.cyan}66` });
        promptAnchorInput(node, "prompt_log_file", y + rowH / 2);
        promptHit(node, "prompt_file", x + modeW + gap, y, sourceRowW, rowH, () => { closePromptChoicePopup(); openPromptLogBrowser(node, "prompt"); });
    } else {
        promptValueRow(ctx, x, y, w, rowH, "Source", "Manual");
        promptHit(node, "source_mode", x, y, w, rowH, () => promptChoicePopup(node, "Prompt source", ["manual", "log"], sourceMode, (value) => promptDashboardSet(node, "prompt_source", value), (value) => value === "log" ? "Prompt Log" : "Manual"));
    }
    y += rowH + gap;

    const sourceText = sourceMode === "log" ? promptStreamLine(node, "prompt") : String(widget(node, "manual_prompt")?.value ?? "");
    const trailingSourceH = sourceMode === "log" ? (gap + rowH + 12) : (gap + 6);
    const sourceCardH = Math.max(128, lowerTop - y - trailingSourceH);
    promptAnchorInput(node, sourceMode === "log" ? "prompt_index" : "manual_prompt", y + sourceCardH / 2);
    promptTextCard(ctx, x, y, w, sourceCardH, sourceMode === "log" ? "SELECTED PROMPT LINE" : "MANUAL PROMPT", sourceText, SO_CMYKG.cyan, sourceMode === "log" ? "Choose a prompt log" : "Click to write a prompt");
    promptHit(node, "source_text", x, y, w, sourceCardH, () => {
        if (sourceMode === "manual") promptTextEditor(node, "Manual prompt", "manual_prompt", true);
        else promptOpenIndexChoice(node, "prompt");
    });
    y += sourceCardH + gap;
    if (sourceMode === "log") {
        const half = (w - gap) / 2;
        promptValueRow(ctx, x, y, half, rowH, "Mode", widget(node, "prompt_mode")?.value ?? "fixed");
        promptValueRow(ctx, x + half + gap, y, half, rowH, "Index", promptStreamIndexLabel(node, "prompt"));
        promptAnchorInput(node, "prompt_mode", y + rowH / 2);
        promptAnchorInput(node, "prompt_index", y + rowH / 2);
        promptHit(node, "prompt_mode", x, y, half, rowH, () => promptChoicePopup(node, "Prompt mode", MODES, widget(node, "prompt_mode")?.value, (value) => promptDashboardSet(node, "prompt_mode", value)));
        promptHit(node, "prompt_index", x + half + gap, y, half, rowH, () => promptOpenIndexChoice(node, "prompt"));
        y += rowH + 12;
    } else y += 6;

    y = Math.max(y, lowerTop);

    promptSection(ctx, "Outfits + Scene", x + 2, y + 7, SO_CMYKG.magenta); y += 18;
    y += promptDrawStreamCard(node, ctx, "outfit_A", x, y, w, SO_CMYKG.magenta, "outfit_a") + gap;
    y += promptDrawStreamCard(node, ctx, "outfit_B", x, y, w, SO_CMYKG.yellow, "outfit_b") + gap;
    y += promptDrawStreamCard(node, ctx, "outfit_C", x, y, w, SO_CMYKG.cyan, "outfit_c") + gap;
    y += promptDrawStreamCard(node, ctx, "scene", x, y, w, SO_CMYKG.green, "scene") + 12;

    promptSection(ctx, "Substitutions", x + 2, y + 7, SO_CMYKG.yellow); y += 18;
    const half = (w - gap) / 2;
    const nameToken = String(widget(node, "name_token")?.value ?? "NAME");
    const itemToken = String(widget(node, "item_token")?.value ?? "ITEM");
    promptValueRow(ctx, x, y, half, rowH, `${nameToken} ✎`, widget(node, "name_value")?.value ?? "", { stroke: `${SO_CMYKG.yellow}55`, chevron: false });
    promptValueRow(ctx, x + half + gap, y, half, rowH, `${itemToken} ✎`, widget(node, "item_value")?.value ?? "", { stroke: `${SO_CMYKG.yellow}55`, chevron: false });
    promptAnchorInput(node, "name_token", y + rowH / 2);
    promptAnchorInput(node, "name_value", y + rowH / 2);
    promptAnchorInput(node, "item_token", y + rowH / 2);
    promptAnchorInput(node, "item_value", y + rowH / 2);
    const subTokenW = Math.min(120, half * .38);
    promptHit(node, "name_token", x, y, subTokenW, rowH, () => promptTextEditor(node, "NAME token", "name_token", false));
    promptHit(node, "name_value", x + subTokenW, y, half - subTokenW, rowH, () => promptTextEditor(node, `${nameToken} value`, "name_value", false));
    promptHit(node, "item_token", x + half + gap, y, subTokenW, rowH, () => promptTextEditor(node, "ITEM token", "item_token", false));
    promptHit(node, "item_value", x + half + gap + subTokenW, y, half - subTokenW, rowH, () => promptTextEditor(node, `${itemToken} value`, "item_value", false));
    y += rowH + 12;

    promptSection(ctx, "Prompt Additions", x + 2, y + 7, SO_CMYKG.green); y += 18;
    const toggleW = Math.min(155, w * .22); const textW = w - toggleW - gap;
    promptToggleRow(ctx, x, y, toggleW, rowH, "Prefix", Boolean(widget(node, "prefix_enabled")?.value), SO_CMYKG.green);
    promptValueRow(ctx, x + toggleW + gap, y, textW, rowH, "Text", widget(node, "prefix_text")?.value ?? "", { stroke: `${SO_CMYKG.green}55`, chevron: false });
    promptAnchorInput(node, "prefix_enabled", y + rowH / 2);
    promptAnchorInput(node, "prefix_text", y + rowH / 2);
    promptHit(node, "prefix_toggle", x, y, toggleW, rowH, () => promptDashboardToggle(node, "prefix_enabled"));
    promptHit(node, "prefix_text", x + toggleW + gap, y, textW, rowH, () => promptTextEditor(node, "Prompt prefix", "prefix_text", true));
    y += rowH + gap;
    promptToggleRow(ctx, x, y, toggleW, rowH, "Suffix", Boolean(widget(node, "suffix_enabled")?.value), SO_CMYKG.green);
    promptValueRow(ctx, x + toggleW + gap, y, textW, rowH, "Text", widget(node, "suffix_text")?.value ?? "", { stroke: `${SO_CMYKG.green}55`, chevron: false });
    promptAnchorInput(node, "suffix_enabled", y + rowH / 2);
    promptAnchorInput(node, "suffix_text", y + rowH / 2);
    promptHit(node, "suffix_toggle", x, y, toggleW, rowH, () => promptDashboardToggle(node, "suffix_enabled"));
    promptHit(node, "suffix_text", x + toggleW + gap, y, textW, rowH, () => promptTextEditor(node, "Prompt suffix", "suffix_text", true));
    y += rowH + 9;

    const expanded = Boolean(node.properties?.so_prompt_dashboard_advanced);
    promptRoundRect(ctx, x, y, w, 28, 8, "rgba(31,31,36,.98)", "rgba(246,230,90,.28)");
    promptDashText(ctx, `Advanced ${expanded ? "▾" : "▸"}`, x + 12, y + 14, { color: SO_CMYKG.label, font: "700 10px Segoe UI, Arial" });
    promptDashText(ctx, "separator + cleanup", x + w - 12, y + 14, { align: "right", color: "#777782", font: "10px Segoe UI, Arial" });
    promptHit(node, "advanced", x, y, w, 28, () => { node.properties.so_prompt_dashboard_advanced = !expanded; layoutPromptDashboard(node, true); });
    y += 36;
    if (expanded) {
        const advHalf = (w - gap) / 2;
        promptValueRow(ctx, x, y, advHalf, rowH, "Prefix/suffix separator", widget(node, "prefix_suffix_separator")?.value ?? ", ", { chevron: false });
        promptToggleRow(ctx, x + advHalf + gap, y, advHalf, rowH, "Cleanup", Boolean(widget(node, "cleanup_enabled")?.value), SO_CMYKG.yellow);
        promptAnchorInput(node, "prefix_suffix_separator", y + rowH / 2);
        promptAnchorInput(node, "cleanup_enabled", y + rowH / 2);
        promptHit(node, "separator", x, y, advHalf, rowH, () => promptTextEditor(node, "Prefix/suffix separator", "prefix_suffix_separator", false));
        promptHit(node, "cleanup_toggle", x + advHalf + gap, y, advHalf, rowH, () => promptDashboardToggle(node, "cleanup_enabled"));
        y += rowH + gap;
        promptValueRow(ctx, x, y, w, rowH, "Cleanup rules", "Click to edit regex rules", { stroke: `${SO_CMYKG.yellow}44`, chevron: false });
        promptAnchorInput(node, "cleanup_rules", y + rowH / 2);
        promptHit(node, "cleanup_rules", x, y, w, rowH, () => promptTextEditor(node, "Cleanup rules", "cleanup_rules", true));
        y += rowH + 10;
    }

    promptSection(ctx, "Resolved Prompt", x + 2, y + 7, SO_CMYKG.cyan); y += 18;
    const resolvedH = 130;
    const resolved = String(widget(node, "saved_prompt")?.value ?? node.properties?.so_saved_final_prompt ?? "");
    promptAnchorInput(node, "saved_prompt", y + resolvedH / 2);
    promptTextCard(ctx, x, y, w, resolvedH, "RESULTING PERSISTENT PROMPT", resolved, SO_CMYKG.cyan, "Run once to populate the resolved prompt");
    y += resolvedH + 6;
    const copied = node.__soPromptCopyFlash === "resolved";
    promptRoundRect(ctx, x, y, w, 29, 7, copied ? "rgba(54,119,81,.45)" : SO_CMYKG.row, copied ? `${SO_CMYKG.green}cc` : `${SO_CMYKG.cyan}55`);
    promptDashText(ctx, copied ? "✓ Copied resolved prompt" : "📋 Copy resolved prompt", x + w / 2, y + 14.5, { align: "center", color: copied ? SO_CMYKG.green : SO_CMYKG.text, font: "11px Segoe UI, Arial" });
    promptHit(node, "copy_resolved", x, y, w, 29, () => promptCopyValue(node, "resolved", resolved));

    ctx.restore();
}

function hidePromptDashboardWidget(target) {
    if (!target) return;
    target.__soPromptDashboardHidden = true;
    target.computeSize = () => [0, 0];
    target.draw = () => {};
    target.mouse = () => false;
    if (target.inputEl) {
        target.inputEl.style.display = "none";
        target.inputEl.style.pointerEvents = "none";
    }
}

function hidePromptDashboardBackingWidgets(node) {
    for (const name of CANONICAL_NAMES) hidePromptDashboardWidget(widget(node, name));
    for (const button of Object.values(node.__soPromptCopyButtons || {})) hidePromptDashboardWidget(button);
    for (const button of Object.values(node.__soLogBrowserButtons || {})) hidePromptDashboardWidget(button);
    for (const base of STREAM_BASES) {
        const preview = widget(node, previewWidgetName(base));
        if (preview) hidePromptDashboardWidget(preview);
    }
}

function layoutPromptDashboard(node, refit = false) {
    if (!node.__soPromptDashboardReady) return;
    hidePromptDashboardBackingWidgets(node);
    layoutPromptInputSockets(node);
    node.widgets_start_y = promptDashBottom(node) + 10;
    node.size[0] = Math.max(Number(node.size?.[0] || 0), PROMPT_DASH_MIN_WIDTH);
    node.bgcolor = "#000000";
    if (refit) {
        // Fit exactly around the custom dashboard. Converted widget inputs no
        // longer reserve a hidden native-widget basement below this height.
        node.size[1] = promptDashBottom(node) + 14;
        setTimeout(() => {
            if (!node.__soPromptDashboardReady || !node.size) return;
            node.size[0] = Math.max(Number(node.size[0] || 0), PROMPT_DASH_MIN_WIDTH);
            node.size[1] = promptDashBottom(node) + 14;
            node.setDirtyCanvas?.(true, true);
        }, 0);
    }
    node.setDirtyCanvas?.(true, true);
}

function ensurePromptDashboard(node) {
    node.properties = node.properties || {};
    node.properties.so_prompt_dashboard_version = PROMPT_DASH_VERSION;
    node.__soPromptDashboardReady = true;
    node.bgcolor = "#000000";
    hidePromptDashboardBackingWidgets(node);
    layoutPromptDashboard(node, true);
}

function installPromptDashboardHooks(nodeType) {
    if (nodeType.prototype.__soPromptDashboardHooks) return;
    nodeType.prototype.__soPromptDashboardHooks = true;

    // Converted widgets remain real graph inputs so existing wires keep working,
    // but their connection geometry is owned by the dashboard. This prevents
    // LiteGraph from stacking invisible widget-input ports below the custom UI.
    const originalGetConnectionPos = nodeType.prototype.getConnectionPos;
    nodeType.prototype.getConnectionPos = function (isInput, slot, out) {
        if (isInput && this.__soPromptDashboardReady) {
            let slotIndex = typeof slot === "number" ? slot : this.findInputSlot?.(slot);
            if (!Number.isInteger(slotIndex) || slotIndex < 0) slotIndex = Number(slot);
            const input = this.inputs?.[slotIndex];
            const inputName = promptInputName(input);
            const anchor = promptDashboardInputAnchor(this, slotIndex);
            if (anchor) {
                const result = out || [0, 0];
                result[0] = Number(this.pos?.[0] || 0);
                result[1] = Number(this.pos?.[1] || 0) + anchor.y;
                return result;
            }
            // Canonical widgets that are intentionally hidden must not fall
            // back to LiteGraph's native slot stack. That fallback was drawing
            // mystery sockets in the empty basement below the custom dashboard.
            // Connected legacy inputs are still exposed by promptShouldExposeInput().
            if (CANONICAL_NAMES.includes(inputName) && !promptShouldExposeInput(input)) {
                const result = out || [0, 0];
                result[0] = Number(this.pos?.[0] || 0) - 10000;
                result[1] = Number(this.pos?.[1] || 0) - 10000;
                return result;
            }
        }
        return originalGetConnectionPos?.apply(this, arguments);
    };

    const originalGetInputPos = nodeType.prototype.getInputPos;
    if (typeof originalGetInputPos === "function") {
        nodeType.prototype.getInputPos = function (slotIndex, out) {
            if (this.__soPromptDashboardReady) {
                const input = this.inputs?.[Number(slotIndex)];
                const inputName = promptInputName(input);
                const anchor = promptDashboardInputAnchor(this, slotIndex);
                if (anchor) {
                    const result = out || [0, 0];
                    result[0] = Number(this.pos?.[0] || 0);
                    result[1] = Number(this.pos?.[1] || 0) + anchor.y;
                    return result;
                }
                if (CANONICAL_NAMES.includes(inputName) && !promptShouldExposeInput(input)) {
                    const result = out || [0, 0];
                    result[0] = Number(this.pos?.[0] || 0) - 10000;
                    result[1] = Number(this.pos?.[1] || 0) - 10000;
                    return result;
                }
            }
            return originalGetInputPos.apply(this, arguments);
        };
    }

    const originalForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
        try { originalForeground?.apply(this, arguments); } catch (error) {}
        drawPromptDashboard(this, ctx);
    };
    const originalMouseDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (event, pos, canvas) {
        if (this.__soPromptDashboardReady) {
            for (const hit of Object.values(this.__soPromptDashboardHits || {})) {
                if (promptPointIn(pos, hit)) { hit.callback(event, pos, this); return true; }
            }
        }
        return originalMouseDown?.apply(this, arguments);
    };

    const originalResize = nodeType.prototype.onResize;
    nodeType.prototype.onResize = function (size) {
        if (Array.isArray(size) || (size && typeof size === "object")) {
            size[0] = Math.max(Number(size[0] || 0), PROMPT_DASH_MIN_WIDTH);
            if (this.__soPromptDashboardReady) {
                // The custom dashboard owns Prompt Core's vertical layout. Use
                // its real bottom instead of preserving a stale serialized or
                // native-widget height, which created the large empty basement.
                size[1] = promptDashBottom(this) + 14;
            }
        }
        const result = originalResize?.apply(this, arguments);
        if (this.size) {
            this.size[0] = Math.max(Number(this.size[0] || 0), PROMPT_DASH_MIN_WIDTH);
            if (this.__soPromptDashboardReady) this.size[1] = promptDashBottom(this) + 14;
        }
        this.setDirtyCanvas?.(true, true);
        return result;
    };
}

function applyLayout(node) {
    node.properties = node.properties || {};
    node.properties.so_prompt_core_schema_version = SCHEMA_VERSION;

    // Keep all existing backend/frontend mechanics alive; the dashboard merely
    // becomes the visible interface over those stable values.
    createCopyButtons(node);
    bindTokenCallbacks(node);
    for (const base of STREAM_BASES) ensureStreamIndexPreview(node, base);
    bindLogControls(node);
    ensureAllLogNavigators(node);
    bindQueueProgression(node);
    for (const base of STREAM_BASES) refreshStreamIndexPreview(node, base);
    updateCopyButtons(node);
    ensurePromptDashboard(node);
}


app.registerExtension({
    name: "SickOllie.Studio.PromptCore",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== TARGET) return;
        installPromptDashboardHooks(nodeType);

        const originalConfigureMethod = nodeType.prototype.configure;
        nodeType.prototype.configure = function (info) {
            return originalConfigureMethod.call(this, migratePromptWorkflow(info));
        };

        const originalSerialize = nodeType.prototype.serialize;
        nodeType.prototype.serialize = function () {
            const data = originalSerialize?.apply(this, arguments) || {};
            data.properties = {
                ...(data.properties || {}),
                so_prompt_core_schema_version: SCHEMA_VERSION,
            };
            // Copy buttons are frontend decoration. Always serialize only the
            // 33 canonical backend widgets, in backend order, with no null
            // button placeholders.
            data.widgets_values = CANONICAL_NAMES.map((name) => {
                const target = widget(this, name);
                return target ? target.value : DEFAULTS[name];
            });
            return data;
        };

        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            // Defer frontend-only buttons until after LiteGraph has configured
            // all native widgets from the saved canonical array.
            setTimeout(() => applyLayout(this), 0);
            return result;
        };

        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            const result = originalConfigure?.apply(this, arguments);
            const stored = this.properties?.so_saved_final_prompt;
            if (stored != null && stored !== "") setTextWidget(this, "saved_prompt", stored);
            applyLayout(this);
            setTimeout(() => applyLayout(this), 0);
            return result;
        };

        const originalExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            originalExecuted?.apply(this, arguments);
            let resolved = message?.resolved_prompt;
            if (Array.isArray(resolved)) resolved = resolved[0];
            if (resolved != null) {
                this.properties = this.properties || {};
                this.properties.so_saved_final_prompt = String(resolved);
                setTextWidget(this, "saved_prompt", resolved);
            }
            updateCopyButtons(this);
            applyLayout(this);
        };
    },
});
