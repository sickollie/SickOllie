import { app } from "../../../scripts/app.js";

const TARGET = "SOPromptLogEngine";
const SCHEMA_VERSION = 10;
const NO_FILE = "[None]";
const LARGE_RANDOM_MAX = 1000000000;
const MODES = ["fixed", "increment", "decrement", "randomize"];

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
    if (mode === "increment") next = current + 1;
    else if (mode === "decrement") next = current - 1;
    else if (mode === "randomize") next = Math.floor(Math.random() * LARGE_RANDOM_MAX);

    indexWidget.value = next;
    try { indexWidget.callback?.(next); } catch (error) {}
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

function applyLayout(node) {
    node.properties = node.properties || {};
    node.properties.so_prompt_core_schema_version = SCHEMA_VERSION;

    createCopyButtons(node);
    bindTokenCallbacks(node);
    bindQueueProgression(node);
    updateCopyButtons(node);

    for (const [name, height] of Object.entries(TEXT_HEIGHTS)) {
        setWidgetHeight(widget(node, name), height);
    }

    const saved = widget(node, "saved_prompt");
    if (saved?.inputEl) {
        saved.inputEl.readOnly = true;
        saved.inputEl.spellcheck = false;
    }
    if (saved) saved.label = "resulting persistent prompt preview";

    const width = Math.max(node.size?.[0] ?? 580, 580);
    const computed = node.computeSize?.() || [width, 1200];
    node.size = [width, Math.max(Number(computed[1] || 0) + 12, 1120)];
    node.setDirtyCanvas?.(true, true);
}

app.registerExtension({
    name: "SickOllie.PromptCore.StableSchema10",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== TARGET) return;

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
