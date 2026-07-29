import { app } from "../../../scripts/app.js";

const TARGET = "SOOutputBuilderSave";
const RESOLVED_KEYS = [
    "clean_name",
    "raw_stem",
    "model_name",
    "prompt_index",
    "outfit_index",
    "scene_index",
];

const DISPLAY_LABELS = {
    save_prompt_json: "embed_prompt_metadata",
    save_workflow_json: "embed_workflow_metadata",
    save_civitai_parameters: "embed_civitai_metadata",
    saved_path: "final output path",
};

function widget(node, name) {
    return node.widgets?.find((item) => item.name === name);
}

function setTextWidget(node, name, value) {
    const item = widget(node, name);
    if (!item || value == null) return;

    const text = String(value);
    item.value = text;

    if (item.inputEl) {
        item.inputEl.value = text;
        item.inputEl.readOnly = true;
        item.inputEl.spellcheck = false;
    }

    node.setDirtyCanvas?.(true, true);
}

function setDisplayLabels(node) {
    for (const [name, label] of Object.entries(DISPLAY_LABELS)) {
        const item = widget(node, name);
        if (item) item.label = label;
    }
}

function removeControlAfterGenerate(node) {
    if (!Array.isArray(node.widgets)) return;

    node.widgets = node.widgets.filter(
        (item) => item?.name !== "control_after_generate",
    );
}

function clearInlineImagePreview(node) {
    node.imgs = null;
    node.imageIndex = null;
    node.animatedImages = false;
    node.preview = null;
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

function unwrap(value) {
    let current = value;
    while (Array.isArray(current) && current.length === 1) {
        current = current[0];
    }
    return current;
}

function normalizeResolvedValues(value) {
    let current = unwrap(value);

    if (typeof current === "string") {
        try {
            current = JSON.parse(current);
        } catch (error) {
            current = {};
        }
    }

    const source = current && typeof current === "object" ? current : {};
    const normalized = {};

    for (const key of RESOLVED_KEYS) {
        const item = unwrap(source[key]);
        normalized[key] = item == null ? "" : String(item);
    }

    return normalized;
}

function displayValue(value) {
    const text = String(value ?? "");
    return text.length ? text : "none";
}

function resolvedText(values) {
    return RESOLVED_KEYS
        .map((key) => `${key}: ${String(values?.[key] ?? "")}`)
        .join("\n");
}

function flashButton(node, button, normalName) {
    if (!button) return;
    button.name = `✓ Copied ${normalName.replace(/^📋 Copy\s*/, "")}`;
    node.setDirtyCanvas?.(true, true);

    clearTimeout(button.__soResetTimer);
    button.__soResetTimer = setTimeout(() => {
        button.name = normalName;
        node.setDirtyCanvas?.(true, true);
    }, 850);
}

function updateResolvedButtons(node) {
    const values = node.__soResolvedValues || normalizeResolvedValues({});

    for (const key of RESOLVED_KEYS) {
        const button = node.__soResolvedButtons?.[key];
        if (!button) continue;
        button.name = `📋 Copy ${key}: ${displayValue(values[key])}`;
    }

    if (node.__soCopyAllButton) {
        node.__soCopyAllButton.name = "📋 Copy all resolved values";
    }

    node.setDirtyCanvas?.(true, true);
}

function placeButtonsBeforeSavedPath(node, buttons) {
    if (!Array.isArray(node.widgets) || !buttons.length) return;

    for (const button of buttons) {
        const index = node.widgets.indexOf(button);
        if (index >= 0) node.widgets.splice(index, 1);
    }

    const savedPath = widget(node, "saved_path");
    const insertAt = savedPath
        ? node.widgets.indexOf(savedPath)
        : node.widgets.length;

    node.widgets.splice(insertAt, 0, ...buttons);
}

function installResolvedButtons(node) {
    if (node.__soOutputButtonsInstalled) return;
    node.__soOutputButtonsInstalled = true;
    node.__soResolvedButtons = {};
    node.__soResolvedValues = normalizeResolvedValues(
        node.properties?.so_output_resolved_values,
    );

    const buttons = [];

    for (const key of RESOLVED_KEYS) {
        const button = node.addWidget(
            "button",
            `📋 Copy ${key}: none`,
            null,
            async () => {
                const value = String(node.__soResolvedValues?.[key] ?? "");
                if (!value) return;

                const normalName = `📋 Copy ${key}: ${displayValue(value)}`;
                if (await copyText(value)) {
                    flashButton(node, button, normalName);
                }
            },
            { serialize: false },
        );
        button.serialize = false;
        node.__soResolvedButtons[key] = button;
        buttons.push(button);
    }

    const copyAllButton = node.addWidget(
        "button",
        "📋 Copy all resolved values",
        null,
        async () => {
            const text = resolvedText(node.__soResolvedValues || {});
            if (await copyText(text)) {
                flashButton(node, copyAllButton, "📋 Copy all resolved values");
            }
        },
        { serialize: false },
    );
    copyAllButton.serialize = false;
    node.__soCopyAllButton = copyAllButton;
    buttons.push(copyAllButton);

    placeButtonsBeforeSavedPath(node, buttons);
    updateResolvedButtons(node);
}

function applyStoredState(node, properties = {}) {
    const storedPath = properties?.so_saved_output_path;
    if (storedPath != null) {
        setTextWidget(node, "saved_path", storedPath);
    }

    node.__soResolvedValues = normalizeResolvedValues(
        properties?.so_output_resolved_values,
    );
    updateResolvedButtons(node);
}

function installOutputCore(node) {
    setDisplayLabels(node);
    removeControlAfterGenerate(node);
    clearInlineImagePreview(node);
    installResolvedButtons(node);

    const savedPathWidget = widget(node, "saved_path");
    if (savedPathWidget?.inputEl) {
        savedPathWidget.inputEl.readOnly = true;
        savedPathWidget.inputEl.spellcheck = false;
    }

    node.size = [
        Math.max(node.size?.[0] ?? 560, 560),
        Math.max(node.size?.[1] ?? 0, node.computeSize?.()?.[1] ?? 0),
    ];
    node.setDirtyCanvas?.(true, true);
}

app.registerExtension({
    name: "SickOllie.OutputCoreResolvedValues",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== TARGET) return;

        const originalCreated = nodeType.prototype.onNodeCreated;
        const originalConfigured = nodeType.prototype.onConfigure;
        const originalSerialized = nodeType.prototype.onSerialize;
        const originalExecuted = nodeType.prototype.onExecuted;

        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            this.properties = this.properties || {};
            installOutputCore(this);
            return result;
        };

        nodeType.prototype.onConfigure = function (info) {
            const result = originalConfigured?.apply(this, arguments);
            this.properties = this.properties || {};
            installOutputCore(this);
            applyStoredState(this, info?.properties || this.properties);
            clearInlineImagePreview(this);
            return result;
        };

        nodeType.prototype.onExecuted = function (message) {
            // Keep the saved image in Comfy's history response, but do not let the
            // default output-node renderer add another preview inside Output Core.
            const messageWithoutImages =
                message && typeof message === "object"
                    ? { ...message }
                    : message;

            if (messageWithoutImages && typeof messageWithoutImages === "object") {
                delete messageWithoutImages.images;
                if (messageWithoutImages.ui && typeof messageWithoutImages.ui === "object") {
                    messageWithoutImages.ui = { ...messageWithoutImages.ui };
                    delete messageWithoutImages.ui.images;
                }
            }

            originalExecuted?.call(this, messageWithoutImages);
            clearInlineImagePreview(this);

            let savedPath = unwrap(message?.saved_path);
            if (savedPath != null) {
                savedPath = String(savedPath);
                setTextWidget(this, "saved_path", savedPath);
                this.properties = this.properties || {};
                this.properties.so_saved_output_path = savedPath;
            }

            const resolved = normalizeResolvedValues(message?.resolved_values);
            this.__soResolvedValues = resolved;
            this.properties = this.properties || {};
            this.properties.so_output_resolved_values = { ...resolved };
            updateResolvedButtons(this);
        };

        nodeType.prototype.onSerialize = function (data) {
            const result = originalSerialized?.apply(this, arguments);
            data.properties = data.properties || {};

            const savedPath = widget(this, "saved_path")?.value;
            if (savedPath != null) {
                data.properties.so_saved_output_path = String(savedPath);
            }

            data.properties.so_output_resolved_values = {
                ...(this.__soResolvedValues || normalizeResolvedValues({})),
            };

            return result;
        };
    },
});
