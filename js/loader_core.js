/*
 * Loader Core dynamic secondary LoRA UI.
 *
 * Portions of the custom row interaction and drawing approach are adapted from
 * rgthree-comfy's Power Lora Loader, Copyright (c) 2023 Regis Gaughan, III.
 * Used under the MIT License. See THIRD_PARTY_NOTICES.md.
 */

import { app } from "../../../scripts/app.js";

import {
    drawInfoIcon,
    drawNumberWidgetPart,
    drawRoundedRectangle,
    drawTogglePart,
    fitString,
    isLowQuality,
} from "/extensions/rgthree-comfy/utils_canvas.js";

import {
    RgthreeBaseWidget,
    RgthreeBetterButtonWidget,
    RgthreeDividerWidget,
} from "/extensions/rgthree-comfy/utils_widgets.js";

import { showLoraChooser } from "/extensions/rgthree-comfy/utils_menu.js";
import { RgthreeLoraInfoDialog } from "/extensions/rgthree-comfy/dialog_info.js";
import { rgthree } from "/extensions/rgthree-comfy/rgthree.js";
import { rgthreeApi } from "/rgthree/common/rgthree_api.js";
import { LORA_INFO_SERVICE } from "/rgthree/common/model_info_service.js";
import {
    moveArrayItem,
    removeArrayItem,
} from "/rgthree/common/shared_utils.js";

const TARGET = "SOLoaderCoreEngine";
const NONE = "None";
const ALL_FOLDERS = "[All LoRA folders]";
const ROOT_FOLDER = "[LoRA root only]";
const SECONDARY_PREFIX = "secondary_lora_";

function widget(node, name) {
    return node.widgets?.find((item) => item.name === name);
}

function normalizePath(value) {
    return String(value ?? "")
        .replaceAll("\\", "/")
        .replace(/^\/+|\/+$/g, "");
}

function parentFolder(loraName) {
    const normalized = normalizePath(loraName);
    const index = normalized.lastIndexOf("/");
    return index < 0 ? "" : normalized.slice(0, index);
}

function readValues(comboWidget) {
    const source = comboWidget?.options?.values;

    if (Array.isArray(source)) {
        return [...source];
    }

    if (typeof source === "function") {
        try {
            const result = source();
            return Array.isArray(result) ? [...result] : [];
        } catch (error) {
            console.warn(
                "[Sick Ollie Loader Core] Could not read combo values",
                error,
            );
        }
    }

    return [];
}

function writeValues(comboWidget, values) {
    if (!comboWidget) return;
    comboWidget.options = comboWidget.options || {};
    comboWidget.options.values = [...values];
}

function folderMatches(loraName, folderName, includeSubfolders) {
    const parent = parentFolder(loraName);

    if (folderName === ALL_FOLDERS) return true;
    if (folderName === ROOT_FOLDER) return parent === "";

    const selected = normalizePath(folderName);

    return includeSubfolders
        ? parent === selected || parent.startsWith(selected + "/")
        : parent === selected;
}

function allowedMainLoras(node) {
    const folderName =
        widget(node, "folder_name")?.value ?? ALL_FOLDERS;
    const includeSubfolders = Boolean(
        widget(node, "include_subfolders")?.value,
    );

    return (node.__soAllMainLoras || []).filter(
        (name) =>
            name !== NONE &&
            folderMatches(name, folderName, includeSubfolders),
    );
}

function refreshMainChoices(node, chooseFirst = false) {
    const mainWidget = widget(node, "main_lora");
    if (!mainWidget) return;

    const allowed = allowedMainLoras(node);
    const displayed = [NONE, ...allowed];

    writeValues(mainWidget, displayed);

    const current = String(mainWidget.value ?? NONE);

    if (chooseFirst || !displayed.includes(current)) {
        mainWidget.value = allowed[0] ?? NONE;
        try {
            mainWidget.callback?.(mainWidget.value);
        } catch (error) {}
    }

    node.setDirtyCanvas?.(true, true);
}

function nextMainValue(node) {
    const mainWidget = widget(node, "main_lora");
    const mode = String(
        widget(node, "control_after_generate")?.value ?? "fixed",
    );
    const loop = Boolean(widget(node, "loop_folder")?.value);
    const skipNone = Boolean(
        widget(node, "skip_none_during_cycle")?.value,
    );

    if (!mainWidget || mode === "fixed") return mainWidget?.value;

    const allowed = allowedMainLoras(node);
    const cycle = skipNone ? allowed : [NONE, ...allowed];

    if (!cycle.length) return NONE;

    const current = String(mainWidget.value ?? NONE);
    let index = cycle.indexOf(current);

    if (mode === "randomize") {
        const pool = cycle.filter((value) => value !== current);
        return pool.length
            ? pool[Math.floor(Math.random() * pool.length)]
            : cycle[0];
    }

    if (index < 0) {
        return mode === "decrement"
            ? cycle[cycle.length - 1]
            : cycle[0];
    }

    if (mode === "increment") {
        if (index < cycle.length - 1) return cycle[index + 1];
        return loop ? cycle[0] : cycle[cycle.length - 1];
    }

    if (mode === "decrement") {
        if (index > 0) return cycle[index - 1];
        return loop ? cycle[cycle.length - 1] : cycle[0];
    }

    return current;
}

function advanceMainAfterQueued(node) {
    const mainWidget = widget(node, "main_lora");
    if (!mainWidget) return;

    const next = nextMainValue(node);

    if (next == null || String(next) === String(mainWidget.value)) {
        return;
    }

    mainWidget.value = next;

    try {
        mainWidget.callback?.(next);
    } catch (error) {}

    node.setDirtyCanvas?.(true, true);
}

class SecondaryHeaderWidget extends RgthreeBaseWidget {
    constructor() {
        super("secondary_lora_header");
        this.type = "custom";
        this.options = { serialize: false };
        this.value = {};
        this.hitAreas = {
            toggle: {
                bounds: [0, 0],
                onDown: this.onToggleDown,
            },
        };
    }

    draw(ctx, node, width, posY, height) {
        if (!node.__soSecondaryWidgets?.length) return;

        const margin = 10;
        const innerMargin = margin * 0.33;
        const lowQuality = isLowQuality();
        const midY = posY + height * 0.5;
        let posX = margin;

        ctx.save();

        this.hitAreas.toggle.bounds = drawTogglePart(ctx, {
            posX,
            posY,
            height,
            value: node.__soAllSecondaryState(),
        });

        if (!lowQuality) {
            posX += this.hitAreas.toggle.bounds[1] + innerMargin;
            ctx.globalAlpha = app.canvas.editor_alpha * 0.55;
            ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;
            ctx.textAlign = "left";
            ctx.textBaseline = "middle";
            ctx.fillText("Toggle All Secondary LoRAs", posX, midY);

            const rightX =
                node.size[0] -
                margin -
                innerMargin -
                innerMargin -
                drawNumberWidgetPart.WIDTH_TOTAL / 2;

            ctx.textAlign = "center";
            ctx.fillText("Strength", rightX, midY);
        }

        ctx.restore();
    }

    onToggleDown(event, pos, node) {
        node.__soToggleAllSecondaries();
        this.cancelMouseDown();
        return true;
    }
}

class SecondaryLoraWidget extends RgthreeBaseWidget {
    constructor(name) {
        super(name);
        this.type = "custom";
        this._value = {
            on: true,
            lora: null,
            strength: 1,
        };
        this.loraInfoPromise = null;
        this.loraInfo = null;
        this.haveMouseMovedStrength = false;

        this.hitAreas = {
            toggle: {
                bounds: [0, 0],
                onDown: this.onToggleDown,
            },
            lora: {
                bounds: [0, 0],
                onClick: this.onLoraClick,
            },
            info: {
                bounds: [0, 0],
                onDown: this.onInfoDown,
            },
            strengthDec: {
                bounds: [0, 0],
                onClick: this.onStrengthDecDown,
            },
            strengthVal: {
                bounds: [0, 0],
                onClick: this.onStrengthValUp,
            },
            strengthInc: {
                bounds: [0, 0],
                onClick: this.onStrengthIncDown,
            },
            strengthAny: {
                bounds: [0, 0],
                onMove: this.onStrengthMove,
            },
        };
    }

    set value(value) {
        if (!value || typeof value !== "object") {
            this._value = {
                on: true,
                lora: null,
                strength: 1,
            };
        } else {
            this._value = {
                on: value.on !== false,
                lora: value.lora ?? null,
                strength: Number(value.strength ?? 1),
            };
        }

        this.getLoraInfo();
    }

    get value() {
        return this._value;
    }

    setLora(lora) {
        this._value.lora = lora;
        this.loraInfo = null;
        this.getLoraInfo(true);
    }

    serializeValue() {
        return { ...this.value };
    }

    draw(ctx, node, width, posY, height) {
        const margin = 10;
        const innerMargin = margin * 0.33;
        const lowQuality = isLowQuality();
        const midY = posY + height * 0.5;
        let posX = margin;

        ctx.save();

        drawRoundedRectangle(ctx, {
            pos: [posX, posY],
            size: [node.size[0] - margin * 2, height],
        });

        this.hitAreas.toggle.bounds = drawTogglePart(ctx, {
            posX,
            posY,
            height,
            value: this.value.on,
        });
        posX += this.hitAreas.toggle.bounds[1] + innerMargin;

        if (lowQuality) {
            ctx.restore();
            return;
        }

        if (!this.value.on) {
            ctx.globalAlpha = app.canvas.editor_alpha * 0.4;
        }

        ctx.fillStyle = LiteGraph.WIDGET_TEXT_COLOR;

        let textColor;
        if (
            this.loraInfo?.strengthMax != null &&
            this.value.strength > this.loraInfo.strengthMax
        ) {
            textColor = "#c66";
        } else if (
            this.loraInfo?.strengthMin != null &&
            this.value.strength < this.loraInfo.strengthMin
        ) {
            textColor = "#c66";
        }

        const [leftArrow, text, rightArrow] =
            drawNumberWidgetPart(ctx, {
                posX:
                    node.size[0] -
                    margin -
                    innerMargin -
                    innerMargin,
                posY,
                height,
                value: this.value.strength,
                direction: -1,
                textColor,
            });

        this.hitAreas.strengthDec.bounds = leftArrow;
        this.hitAreas.strengthVal.bounds = text;
        this.hitAreas.strengthInc.bounds = rightArrow;
        this.hitAreas.strengthAny.bounds = [
            leftArrow[0],
            rightArrow[0] + rightArrow[1] - leftArrow[0],
        ];

        let rightPosition = leftArrow[0] - innerMargin;
        const infoIconSize = height * 0.66;
        const infoWidth = infoIconSize + innerMargin * 2;

        rightPosition -= innerMargin;

        drawInfoIcon(
            ctx,
            rightPosition - infoIconSize,
            posY + (height - infoIconSize) / 2,
            infoIconSize,
            this.loraInfo?.raw?.civitai
                ? "FILLED"
                : this.loraInfo?.hasInfoFile
                  ? "OUTLINED"
                  : "GRAYED",
        );

        this.hitAreas.info.bounds = [
            rightPosition - infoIconSize,
            infoWidth,
        ];

        rightPosition =
            rightPosition - infoIconSize - innerMargin;

        const loraWidth = rightPosition - posX;

        ctx.textAlign = "left";
        ctx.textBaseline = "middle";

        const label = String(this.value.lora || "None");
        ctx.fillText(
            fitString(ctx, label, loraWidth),
            posX,
            midY,
        );

        this.hitAreas.lora.bounds = [posX, loraWidth];

        ctx.globalAlpha = app.canvas.editor_alpha;
        ctx.restore();
    }

    onToggleDown() {
        this.value.on = !this.value.on;
        this.cancelMouseDown();
        return true;
    }

    onInfoDown() {
        this.showLoraInfoDialog();
        this.cancelMouseDown();
        return true;
    }

    onLoraClick(event, pos, node) {
        node.__soShowLoraChooser(event, (value) => {
            this.setLora(value);
            node.setDirtyCanvas?.(true, true);
        });
        this.cancelMouseDown();
        return true;
    }

    onStrengthDecDown() {
        this.stepStrength(-1);
        return true;
    }

    onStrengthIncDown() {
        this.stepStrength(1);
        return true;
    }

    onStrengthMove(event) {
        if (event.deltaX) {
            this.haveMouseMovedStrength = true;
            this.value.strength += event.deltaX * 0.05;
        }
    }

    onStrengthValUp(event) {
        if (this.haveMouseMovedStrength) return;

        app.canvas.prompt(
            "Strength",
            this.value.strength,
            (value) => {
                const number = Number(value);
                if (Number.isFinite(number)) {
                    this.value.strength = number;
                }
            },
            event,
        );
    }

    onMouseUp(event, pos, node) {
        super.onMouseUp(event, pos, node);
        this.haveMouseMovedStrength = false;
    }

    stepStrength(direction) {
        const value = this.value.strength + 0.05 * direction;
        this.value.strength = Math.round(value * 100) / 100;
    }

    showLoraInfoDialog() {
        if (!this.value.lora || this.value.lora === NONE) {
            return;
        }

        const dialog = new RgthreeLoraInfoDialog(
            this.value.lora,
        ).show();

        dialog.addEventListener("close", (event) => {
            if (event.detail?.dirty) {
                this.getLoraInfo(true);
            }
        });
    }

    getLoraInfo(force = false) {
        if (!this.loraInfoPromise || force) {
            const promise =
                this.value.lora &&
                this.value.lora !== NONE
                    ? LORA_INFO_SERVICE.getInfo(
                          this.value.lora,
                          force,
                          true,
                      )
                    : Promise.resolve(null);

            this.loraInfoPromise = promise.then(
                (value) => (this.loraInfo = value),
            );
        }

        return this.loraInfoPromise;
    }
}

function installDynamicSecondaryMethods(node) {
    node.serialize_widgets = true;
    node.__soSecondaryCounter = node.__soSecondaryCounter || 0;
    node.__soSecondaryWidgets = node.__soSecondaryWidgets || [];

    node.__soShowLoraChooser = async (event, onChoose) => {
        const details = await rgthreeApi.getLoras();
        const loras = details.map((item) => item.file);

        showLoraChooser(
            event,
            (value) => {
                if (typeof value === "string") {
                    onChoose(value);
                }
                node.setDirtyCanvas?.(true, true);
            },
            null,
            [...loras],
        );
    };

    node.__soAddSecondary = (lora, value) => {
        node.__soSecondaryCounter += 1;

        const secondary = node.addCustomWidget(
            new SecondaryLoraWidget(
                SECONDARY_PREFIX +
                    node.__soSecondaryCounter,
            ),
        );

        if (value) {
            secondary.value = { ...value };
        } else if (lora) {
            secondary.setLora(lora);
        }

        node.__soSecondaryWidgets.push(secondary);

        if (node.__soSecondaryButtonSpacer) {
            moveArrayItem(
                node.widgets,
                secondary,
                node.widgets.indexOf(
                    node.__soSecondaryButtonSpacer,
                ),
            );
        }

        node.size[1] = Math.max(
            node.size[1],
            node.computeSize()[1],
        );
        node.setDirtyCanvas?.(true, true);

        return secondary;
    };

    node.__soAllSecondaryState = () => {
        if (!node.__soSecondaryWidgets.length) {
            return false;
        }

        const allOn = node.__soSecondaryWidgets.every(
            (item) => item.value.on,
        );
        const allOff = node.__soSecondaryWidgets.every(
            (item) => !item.value.on,
        );

        if (allOn) return true;
        if (allOff) return false;
        return null;
    };

    node.__soToggleAllSecondaries = () => {
        const turnOn =
            node.__soAllSecondaryState() !== true;

        for (const secondary of node.__soSecondaryWidgets) {
            secondary.value.on = turnOn;
        }

        node.setDirtyCanvas?.(true, true);
    };
}

function removeDynamicSecondaryUI(node) {
    const dynamic = new Set([
        ...(node.__soSecondaryWidgets || []),
        node.__soSecondaryHeader,
        node.__soSecondaryDivider,
        node.__soSecondaryButtonSpacer,
        node.__soAddButton,
    ]);

    for (let index = (node.widgets?.length || 0) - 1; index >= 0; index--) {
        if (dynamic.has(node.widgets[index])) {
            node.removeWidget(index);
        }
    }

    node.__soSecondaryWidgets = [];
    node.__soSecondaryHeader = null;
    node.__soSecondaryDivider = null;
    node.__soSecondaryButtonSpacer = null;
    node.__soAddButton = null;
}

function addDynamicSecondaryUI(node, values = []) {
    removeDynamicSecondaryUI(node);
    installDynamicSecondaryMethods(node);

    node.__soSecondaryDivider = node.addCustomWidget(
        new RgthreeDividerWidget({
            marginTop: 8,
            marginBottom: 2,
            thickness: 1,
        }),
    );

    node.__soSecondaryHeader = node.addCustomWidget(
        new SecondaryHeaderWidget(),
    );

    for (const value of values) {
        node.__soAddSecondary(null, value);
    }

    node.__soSecondaryButtonSpacer = node.addCustomWidget(
        new RgthreeDividerWidget({
            marginTop: 3,
            marginBottom: 0,
            thickness: 0,
        }),
    );

    node.__soAddButton = node.addCustomWidget(
        new RgthreeBetterButtonWidget(
            "➕ Add Secondary LoRA",
            (event) => {
                node.__soShowLoraChooser(
                    event,
                    (value) => {
                        if (value !== NONE) {
                            node.__soAddSecondary(value);
                        }
                    },
                );
                return true;
            },
        ),
    );

    node.size[0] = Math.max(node.size[0], 560);
    node.size[1] = Math.max(
        node.size[1],
        node.computeSize()[1],
    );
    node.setDirtyCanvas?.(true, true);
}

function dynamicValuesFromWorkflow(info) {
    const values = [];

    for (const value of info?.widgets_values || []) {
        if (
            value &&
            typeof value === "object" &&
            typeof value.lora !== "undefined"
        ) {
            values.push({ ...value });
        }
    }

    // Migrate Loader Core v4's old fixed four-slot format.
    if (!values.length) {
        const old = info?.widgets_values || [];
        const oldMasterEnabled = old[13];

        if (typeof oldMasterEnabled === "boolean") {
            for (let slot = 0; slot < 4; slot++) {
                const lora = old[14 + slot * 2];
                const strength = old[15 + slot * 2];

                if (
                    typeof lora === "string" &&
                    lora !== NONE
                ) {
                    values.push({
                        on: oldMasterEnabled,
                        lora,
                        strength:
                            Number.isFinite(Number(strength))
                                ? Number(strength)
                                : 1,
                    });
                }
            }
        }
    }

    return values;
}

function installContextMenuHooks(nodeType) {
    const originalGetSlotInPosition =
        nodeType.prototype.getSlotInPosition;

    nodeType.prototype.getSlotInPosition = function (
        canvasX,
        canvasY,
    ) {
        const slot =
            originalGetSlotInPosition?.apply(
                this,
                arguments,
            );

        if (slot) return slot;

        let lastWidget = null;

        for (const item of this.widgets || []) {
            if (item.last_y == null) continue;

            if (canvasY > this.pos[1] + item.last_y) {
                lastWidget = item;
                continue;
            }

            break;
        }

        if (
            lastWidget?.name?.startsWith(
                SECONDARY_PREFIX,
            )
        ) {
            return {
                widget: lastWidget,
                output: {
                    type: "SECONDARY LORA",
                },
            };
        }

        return slot;
    };

    const originalGetSlotMenuOptions =
        nodeType.prototype.getSlotMenuOptions;

    nodeType.prototype.getSlotMenuOptions = function (
        slot,
    ) {
        if (
            slot?.widget?.name?.startsWith(
                SECONDARY_PREFIX,
            )
        ) {
            const secondary = slot.widget;
            const index = this.widgets.indexOf(secondary);

            const previous = this.widgets[index - 1];
            const next = this.widgets[index + 1];

            const canMoveUp =
                previous?.name?.startsWith(
                    SECONDARY_PREFIX,
                );
            const canMoveDown =
                next?.name?.startsWith(
                    SECONDARY_PREFIX,
                );

            const items = [
                {
                    content: "ℹ️ Show Info",
                    callback: () =>
                        secondary.showLoraInfoDialog(),
                },
                null,
                {
                    content: secondary.value.on
                        ? "⚫ Toggle Off"
                        : "🟢 Toggle On",
                    callback: () => {
                        secondary.value.on =
                            !secondary.value.on;
                    },
                },
                {
                    content: "⬆️ Move Up",
                    disabled: !canMoveUp,
                    callback: () => {
                        moveArrayItem(
                            this.widgets,
                            secondary,
                            index - 1,
                        );
                        moveArrayItem(
                            this.__soSecondaryWidgets,
                            secondary,
                            Math.max(
                                0,
                                this.__soSecondaryWidgets.indexOf(
                                    secondary,
                                ) - 1,
                            ),
                        );
                    },
                },
                {
                    content: "⬇️ Move Down",
                    disabled: !canMoveDown,
                    callback: () => {
                        moveArrayItem(
                            this.widgets,
                            secondary,
                            index + 1,
                        );
                        moveArrayItem(
                            this.__soSecondaryWidgets,
                            secondary,
                            Math.min(
                                this.__soSecondaryWidgets.length -
                                    1,
                                this.__soSecondaryWidgets.indexOf(
                                    secondary,
                                ) + 1,
                            ),
                        );
                    },
                },
                {
                    content: "🗑️ Remove",
                    callback: () => {
                        removeArrayItem(
                            this.widgets,
                            secondary,
                        );
                        removeArrayItem(
                            this.__soSecondaryWidgets,
                            secondary,
                        );
                        this.setDirtyCanvas?.(
                            true,
                            true,
                        );
                    },
                },
            ];

            new LiteGraph.ContextMenu(items, {
                title: "SECONDARY LORA",
                event: rgthree.lastCanvasMouseEvent,
            });

            return undefined;
        }

        return originalGetSlotMenuOptions?.apply(
            this,
            arguments,
        );
    };
}

app.registerExtension({
    name: "SickOllie.LoaderCorePowerSecondaries",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== TARGET) return;

        installContextMenuHooks(nodeType);

        const originalCreated =
            nodeType.prototype.onNodeCreated;

        nodeType.prototype.onNodeCreated = function () {
            const result =
                originalCreated?.apply(
                    this,
                    arguments,
                );

            const mainWidget = widget(
                this,
                "main_lora",
            );

            if (mainWidget) {
                this.__soAllMainLoras =
                    readValues(mainWidget);

                const originalAfterQueued =
                    mainWidget.afterQueued;

                mainWidget.afterQueued = () => {
                    try {
                        originalAfterQueued?.call(
                            mainWidget,
                        );
                    } finally {
                        advanceMainAfterQueued(this);
                    }
                };
            }

            for (const name of [
                "folder_name",
                "include_subfolders",
            ]) {
                const filterWidget = widget(
                    this,
                    name,
                );

                if (!filterWidget) continue;

                const originalCallback =
                    filterWidget.callback;

                filterWidget.callback = (value) => {
                    try {
                        originalCallback?.call(
                            filterWidget,
                            value,
                        );
                    } finally {
                        refreshMainChoices(
                            this,
                            true,
                        );
                    }
                };
            }

            rgthreeApi.getLoras();
            addDynamicSecondaryUI(this, [
                {
                    on: false,
                    lora: null,
                    strength: 1,
                },
            ]);
            refreshMainChoices(this, false);

            return result;
        };

        const originalConfigure =
            nodeType.prototype.onConfigure;

        nodeType.prototype.onConfigure = function (info) {
            const result =
                originalConfigure?.apply(
                    this,
                    arguments,
                );

            const values =
                dynamicValuesFromWorkflow(info);

            setTimeout(() => {
                addDynamicSecondaryUI(
                    this,
                    values.length
                        ? values
                        : [
                              {
                                  on: false,
                                  lora: null,
                                  strength: 1,
                              },
                          ],
                );
                refreshMainChoices(this, false);
            }, 0);

            return result;
        };
    },
});
