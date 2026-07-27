import { app } from "../../../scripts/app.js";

const TARGET = "SOPromptLogEngine";
const LARGE_RANDOM_MAX = 1000000000;

function widget(node, name) {
    return node.widgets?.find((item) => item.name === name);
}

function setTextWidget(node, name, value) {
    const w = widget(node, name);
    if (!w || value == null) return;
    const text = String(value);
    w.value = text;
    if (w.inputEl) {
        w.inputEl.value = text;
        w.inputEl.readOnly = true;
        w.inputEl.spellcheck = false;
    }
    node.setDirtyCanvas?.(true, true);
}

function getMode(node, base) {
    return String(widget(node, `${base}_mode`)?.value ?? "fixed");
}

function getIndexWidget(node, base) {
    return widget(node, `${base}_index`);
}

function isEnabled(node, base) {
    if (base === "prompt") {
        return String(widget(node, "prompt_source")?.value ?? "manual") === "log";
    }
    return Boolean(widget(node, `${base}_enabled`)?.value);
}

function advanceIndex(node, base) {
    if (!isEnabled(node, base)) return;
    const indexWidget = getIndexWidget(node, base);
    if (!indexWidget) return;
    const mode = getMode(node, base);
    if (mode === "fixed") return;
    let current = Number(indexWidget.value ?? 0);
    if (!Number.isFinite(current)) current = 0;
    let next = current;
    if (mode === "increment") next = current + 1;
    else if (mode === "decrement") next = current - 1;
    else if (mode === "randomize") next = Math.floor(Math.random() * LARGE_RANDOM_MAX);
    indexWidget.value = next;
    if (indexWidget.callback) {
        try { indexWidget.callback(next); } catch (error) {}
    }
    node.setDirtyCanvas?.(true, true);
}

app.registerExtension({
    name: "SickOllie.PromptLogEngine",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== TARGET) return;
        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            const savedPromptWidget = widget(this, "saved_prompt");
            if (savedPromptWidget) {
                savedPromptWidget.label = "saved final prompt";
                if (savedPromptWidget.inputEl) {
                    savedPromptWidget.inputEl.readOnly = true;
                    savedPromptWidget.inputEl.spellcheck = false;
                }
            }
            for (const base of ["prompt", "outfit", "scene"]) {
                const indexWidget = getIndexWidget(this, base);
                if (!indexWidget) continue;
                const originalAfterQueued = indexWidget.afterQueued;
                indexWidget.afterQueued = () => {
                    try { originalAfterQueued?.call(indexWidget); }
                    finally { advanceIndex(this, base); }
                };
            }
            this.size = [Math.max(this.size?.[0] ?? 540, 540), Math.max(this.size?.[1] ?? 1080, 1080)];
            return result;
        };
        const originalExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            originalExecuted?.apply(this, arguments);
            let resolved = message?.resolved_prompt;
            if (Array.isArray(resolved)) resolved = resolved[0];
            setTextWidget(this, "saved_prompt", resolved);
        };
        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            const result = originalConfigure?.apply(this, arguments);
            const stored = info?.properties?.so_saved_final_prompt ?? null;
            if (stored != null) setTextWidget(this, "saved_prompt", stored);
            return result;
        };
    },
});
