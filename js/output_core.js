import { app } from "../../../scripts/app.js";

const TARGET = "SOOutputBuilderSave";

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

app.registerExtension({
    name: "SickOllie.OutputBuilderSave",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== TARGET) return;

        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            const savedPathWidget = widget(this, "saved_path");
            if (savedPathWidget?.inputEl) {
                savedPathWidget.inputEl.readOnly = true;
                savedPathWidget.inputEl.spellcheck = false;
            }
            this.size = [Math.max(this.size?.[0] ?? 560, 560), Math.max(this.size?.[1] ?? 980, 980)];
            return result;
        };

        const originalExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            originalExecuted?.apply(this, arguments);
            let value = message?.saved_path;
            if (Array.isArray(value)) value = value[0];
            setTextWidget(this, "saved_path", value);
        };

        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            const result = originalConfigure?.apply(this, arguments);
            const stored = info?.properties?.so_saved_output_path ?? null;
            if (stored != null) setTextWidget(this, "saved_path", stored);
            return result;
        };
    },
});
