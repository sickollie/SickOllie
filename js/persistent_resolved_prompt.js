import { app } from "../../../scripts/app.js";

const NODE_NAME = "PersistentResolvedPromptSO";
const WIDGET_NAME = "saved_prompt";

function getPromptWidget(node) {
    return node.widgets?.find((widget) => widget.name === WIDGET_NAME);
}

function setPrompt(node, value) {
    const widget = getPromptWidget(node);
    if (!widget || value == null) return;

    const text = String(value);
    widget.value = text;

    if (widget.inputEl) {
        widget.inputEl.value = text;
        widget.inputEl.readOnly = true;
        widget.inputEl.spellcheck = false;
    }

    node.setDirtyCanvas?.(true, true);
}

app.registerExtension({
    name: "SickOllie.PersistentResolvedPrompt",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== NODE_NAME) return;

        const originalCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const result = originalCreated?.apply(this, arguments);
            const widget = getPromptWidget(this);

            if (widget) {
                widget.label = "resolved prompt saved in PNG";
                if (widget.inputEl) {
                    widget.inputEl.readOnly = true;
                    widget.inputEl.spellcheck = false;
                }
            }

            this.size = [
                Math.max(this.size?.[0] ?? 420, 420),
                Math.max(this.size?.[1] ?? 220, 220),
            ];
            return result;
        };

        const originalExecuted = nodeType.prototype.onExecuted;
        nodeType.prototype.onExecuted = function (message) {
            originalExecuted?.apply(this, arguments);

            let value = message?.resolved_prompt;
            if (Array.isArray(value)) value = value[0];
            setPrompt(this, value);
        };

        const originalConfigure = nodeType.prototype.onConfigure;
        nodeType.prototype.onConfigure = function (info) {
            const result = originalConfigure?.apply(this, arguments);

            const stored =
                info?.properties?.persistent_resolved_prompt ??
                (Array.isArray(info?.widgets_values) ? info.widgets_values[0] : null);

            setPrompt(this, stored);
            return result;
        };
    },
});
