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

const TARGET = "SOLoaderCoreEngine";
const NONE = "None";
const ALL_FOLDERS = "[All LoRA folders]";
const ROOT_FOLDER = "[LoRA root only]";
const ALL_EPOCHS = "[All epochs]";
const NO_EPOCH_TAG = "[No epoch tag]";
const CONTROL_MODES = ["fixed", "increment", "decrement", "randomize"];
const DEFAULT_CLEAN_NAME_MODE = "auto:1";
const SECONDARY_PREFIX = "secondary_lora_";
const MAX_SECONDARY_LORAS = 10;

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

function folderMatches(loraName, folderName, includeSubfolders) {
    const parent = parentFolder(loraName);

    if (folderName === ALL_FOLDERS) return true;
    if (folderName === ROOT_FOLDER) return parent === "";

    const selected = normalizePath(folderName);

    return includeSubfolders
        ? parent === selected || parent.startsWith(selected + "/")
        : parent === selected;
}

function epochNumber(loraName) {
    const normalized = normalizePath(loraName);
    const filename = normalized.slice(normalized.lastIndexOf("/") + 1);
    const stem = filename.replace(/\.[^.]+$/, "");
    const match = stem.match(/epoch[\s_-]*0*(\d+)/i);
    return match ? Number.parseInt(match[1], 10) : null;
}

function epochLabel(number) {
    return `Epoch ${Number(number)}`;
}

function parseCleanModeIndex(value) {
    const text = String(value ?? "").trim();
    const auto = text.match(/^auto:(\d+)$/i);
    if (auto) return Math.max(1, Number.parseInt(auto[1], 10));
    const direct = text.match(/^(\d+)\b/);
    if (direct) return Math.max(1, Number.parseInt(direct[1], 10));
    const keep = text.match(/keep[_:\s-]*(\d+)/i);
    if (keep) return Math.max(1, Number.parseInt(keep[1], 10));
    return 1;
}

function stemGroups(stem) {
    let value = String(stem ?? "")
        .trim()
        .replace(/^[ _\-.]+|[ _\-.]+$/g, "");
    if (!value) return [];

    const epochMatch = value.match(/(?:[_\-\s]|^)epoch[\s_-]*0*\d+$/i);
    let epochGroup = null;

    if (epochMatch) {
        epochGroup = epochMatch[0].replace(/^[ _\-.]+/g, "");
        value = value.slice(0, epochMatch.index).replace(/[ _\-.]+$/g, "");
    }

    const groups = value.split("_").filter(Boolean);
    if (epochGroup) groups.push(epochGroup);
    return groups;
}

function canonicalSuffixGroup(group) {
    const value = String(group ?? "").trim().toLowerCase();
    return /^epoch[\s_-]*0*\d+$/i.test(value) ? "<epoch>" : value;
}

function recognizedSuffixCount(stem) {
    const groups = stemGroups(stem);
    let count = 0;

    for (let index = groups.length - 1; index >= 0; index--) {
        const value = canonicalSuffixGroup(groups[index]);
        if (
            value === "<epoch>" ||
            /^(?:krea\d*|sickollie|sdxl|flux\d*|pony|illustrious|v\d+(?:\.\d+)*|ver\d+|version\d+|step\d+)$/i.test(value)
        ) {
            count++;
            continue;
        }
        break;
    }

    return Math.min(count, Math.max(0, groups.length - 1));
}

function commonSuffixCount(loraNames) {
    const grouped = (loraNames || [])
        .filter((name) => name && name !== NONE)
        .map((name) => {
            const normalized = normalizePath(name);
            const filename = normalized.slice(normalized.lastIndexOf("/") + 1);
            return stemGroups(filename.replace(/\.[^.]+$/, ""));
        })
        .filter((groups) => groups.length);

    if (!grouped.length) return 0;
    if (grouped.length === 1) {
        return recognizedSuffixCount(grouped[0].join("_"));
    }

    const maxDepth = Math.min(
        ...grouped.map((groups) => Math.max(0, groups.length - 1)),
    );
    let common = 0;

    for (let depth = 1; depth <= maxDepth; depth++) {
        const values = new Set(
            grouped.map((groups) => canonicalSuffixGroup(groups[groups.length - depth])),
        );
        if (values.size !== 1) break;
        common++;
    }

    return common;
}

function trimSuffixGroups(stem, count) {
    const groups = stemGroups(stem);
    const remove = Math.max(
        0,
        Math.min(Number(count) || 0, Math.max(0, groups.length - 1)),
    );
    const kept = remove ? groups.slice(0, -remove) : groups;
    return kept.join("_") || String(stem ?? "");
}

function currentMainStem(node) {
    const mainValue = String(widget(node, "main_lora")?.value ?? NONE);
    if (!mainValue || mainValue === NONE) return "clean_name";
    const normalized = normalizePath(mainValue);
    const filename = normalized.slice(normalized.lastIndexOf("/") + 1);
    return filename.replace(/\.[^.]+$/, "") || "clean_name";
}

function cleanNameModeChoices(node) {
    const stem = currentMainStem(node);
    const shared = Math.max(
        commonSuffixCount(allowedMainLoras(node)),
        recognizedSuffixCount(stem),
    );
    const choices = [];

    for (let index = 1; index <= shared + 1; index++) {
        const remove = Math.max(0, shared - (index - 1));
        choices.push(`${index} · ${trimSuffixGroups(stem, remove)}`);
    }

    return choices.length ? choices : [`1 · ${stem}`];
}

function ensureCleanNameCombo(node) {
    const existing = widget(node, "cleanup_rules");
    if (!existing || existing.__soCleanNameCombo) return existing;

    const index = node.widgets?.indexOf(existing) ?? -1;
    const savedValue = existing.value;

    // The Python input remains a STRING in the same serialized slot, but the
    // frontend widget itself must be a genuine LiteGraph combo. Merely changing
    // an existing STRING widget's `type` leaves its text-editor mouse behavior
    // attached, which is what caused the generic Value popup.
    try {
        existing.inputEl?.remove?.();
    } catch (error) {}
    try {
        existing.onRemove?.();
    } catch (error) {}

    const combo = node.addWidget(
        "combo",
        "cleanup_rules",
        savedValue,
        () => {
            node.setDirtyCanvas?.(true, true);
        },
        { values: [] },
    );

    combo.label = "clean_name";
    combo.__soCleanNameCombo = true;
    combo.options = combo.options || {};
    combo.options.serialize = true;

    const appendedIndex = node.widgets?.indexOf(combo) ?? -1;
    if (index >= 0 && appendedIndex >= 0 && appendedIndex !== index) {
        node.widgets.splice(appendedIndex, 1);
        node.widgets.splice(index, 1, combo);
    }

    return combo;
}

function refreshCleanNameChoices(node) {
    const cleanWidget = ensureCleanNameCombo(node);
    if (!cleanWidget) return;

    const choices = cleanNameModeChoices(node);
    const currentIndex = parseCleanModeIndex(cleanWidget.value);
    writeValues(cleanWidget, choices);
    cleanWidget.value =
        choices[Math.min(Math.max(currentIndex, 1), choices.length) - 1] ??
        choices[0];

    node.setDirtyCanvas?.(true, true);
}

function folderScopedLoras(node) {
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

function epochMatches(loraName, filterValue) {
    const selected = String(filterValue ?? ALL_EPOCHS);
    if (selected === ALL_EPOCHS) return true;

    const number = epochNumber(loraName);
    if (selected === NO_EPOCH_TAG) return number == null;

    const match = selected.match(/^Epoch\s+(\d+)$/i);
    if (!match) return true;
    return number === Number.parseInt(match[1], 10);
}

function detectedEpochChoices(node) {
    const names = folderScopedLoras(node);
    const numbers = [...new Set(
        names
            .map(epochNumber)
            .filter((number) => Number.isInteger(number)),
    )].sort((a, b) => a - b);

    const choices = [ALL_EPOCHS, ...numbers.map(epochLabel)];
    if (numbers.length && names.some((name) => epochNumber(name) == null)) {
        choices.push(NO_EPOCH_TAG);
    }
    return choices;
}

function refreshEpochChoices(node) {
    const epochWidget = widget(node, "epoch_filter");
    if (!epochWidget) return;

    const choices = detectedEpochChoices(node);
    writeValues(epochWidget, choices);

    const current = String(epochWidget.value ?? ALL_EPOCHS);
    if (!choices.includes(current)) {
        epochWidget.value = ALL_EPOCHS;
        try {
            epochWidget.callback?.(epochWidget.value);
        } catch (error) {}
    }

    node.setDirtyCanvas?.(true, true);
}

function allowedMainLoras(node) {
    const epochFilter =
        widget(node, "epoch_filter")?.value ?? ALL_EPOCHS;

    return folderScopedLoras(node).filter(
        (name) => epochMatches(name, epochFilter),
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


function displayTriggerValue(value) {
    const text = String(value ?? "").trim();
    return text.length ? text : "none";
}

async function fetchMainTriggerFromServer(mainValue) {
    const value = String(mainValue ?? "").trim();
    if (!value || value === NONE) {
        return "";
    }

    const url = `/sickollie/loader-core/main-trigger?lora=${encodeURIComponent(value)}`;
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    return String(payload?.trigger ?? "").trim();
}

function updateTriggerButton(node) {
    if (!node.__soTriggerButton) return;
    const text = String(node.__soMainTrigger ?? "").trim();
    node.__soTriggerButton.name = `📋 Copy trigger: ${displayTriggerValue(text)}`;
    node.setDirtyCanvas?.(true, true);
}

function flashTriggerButton(node, button, normalName) {
    if (!button) return;
    button.name = `✓ Copied ${normalName.replace(/^📋 Copy\s*/, "")}`;
    node.setDirtyCanvas?.(true, true);

    clearTimeout(button.__soResetTimer);
    button.__soResetTimer = setTimeout(() => {
        button.name = normalName;
        node.setDirtyCanvas?.(true, true);
    }, 850);
}

function ensureTriggerButton(node) {
    if (node.__soTriggerButton) return node.__soTriggerButton;

    node.__soMainTrigger = String(node.__soMainTrigger ?? "");

    const button = node.addWidget(
        "button",
        "📋 Copy trigger: none",
        null,
        async () => {
            const value = String(node.__soMainTrigger ?? "").trim();
            if (!value) return;
            const normalName = `📋 Copy trigger: ${displayTriggerValue(value)}`;
            if (await copyText(value)) {
                flashTriggerButton(node, button, normalName);
            }
        },
        { serialize: false },
    );

    button.serialize = false;
    node.__soTriggerButton = button;

    const cleanWidget = widget(node, "cleanup_rules");
    const secondaryDivider = node.__soSecondaryDivider;
    if (Array.isArray(node.widgets)) {
        const buttonIndex = node.widgets.indexOf(button);
        if (buttonIndex >= 0) node.widgets.splice(buttonIndex, 1);
        let insertAt = node.widgets.length;
        if (secondaryDivider && node.widgets.includes(secondaryDivider)) {
            insertAt = node.widgets.indexOf(secondaryDivider);
        } else if (cleanWidget && node.widgets.includes(cleanWidget)) {
            insertAt = node.widgets.indexOf(cleanWidget) + 1;
        }
        node.widgets.splice(insertAt, 0, button);
    }

    updateTriggerButton(node);
    return button;
}

async function refreshMainTrigger(node, force = false) {
    const mainValue = String(widget(node, "main_lora")?.value ?? NONE);
    node.__soMainTrigger = "";

    if (!mainValue || mainValue === NONE) {
        updateTriggerButton(node);
        return "";
    }

    try {
        node.__soMainTrigger = await fetchMainTriggerFromServer(mainValue);
    } catch (error) {
        console.warn(
            "[Sick Ollie Loader Core] Could not read main LoRA modelspec.title",
            error,
        );
        node.__soMainTrigger = "";
    }

    updateTriggerButton(node);
    return node.__soMainTrigger;
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
    constructor(name, slotIndex = 1) {
        super(name);
        this.type = "custom";
        this.slotIndex = Number(slotIndex) || 1;
        this._soVisible = this.slotIndex === 1;
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

        const hasLora = Boolean(
            this._value.lora && this._value.lora !== NONE,
        );
        this._soVisible = this.slotIndex === 1 || hasLora;
        this.getLoraInfo();
    }

    get value() {
        return this._value;
    }

    setLora(lora) {
        this._value.lora = lora;
        const hasLora = Boolean(lora && lora !== NONE);
        this._soVisible = this.slotIndex === 1 || hasLora;
        this.loraInfo = null;
        this.getLoraInfo(true);
    }

    clear() {
        this.value = {
            on: false,
            lora: null,
            strength: 1,
        };
        this._soVisible = this.slotIndex === 1;
    }

    isPopulated() {
        return Boolean(this.value.lora && this.value.lora !== NONE);
    }

    computeSize(width) {
        if (!this._soVisible) return [width || 0, -4];
        return [width || 0, LiteGraph.NODE_WIDGET_HEIGHT || 20];
    }

    serializeValue() {
        return { ...this.value };
    }

    draw(ctx, node, width, posY, height) {
        if (!this._soVisible) return;
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

function installFixedSecondaryMethods(node) {
    node.serialize_widgets = true;
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

    node.__soVisibleSecondaries = () =>
        (node.__soSecondaryWidgets || []).filter(
            (item) => item._soVisible && item.isPopulated(),
        );

    node.__soAllSecondaryState = () => {
        const activeRows = node.__soVisibleSecondaries();
        if (!activeRows.length) return false;

        const allOn = activeRows.every((item) => item.value.on);
        const allOff = activeRows.every((item) => !item.value.on);

        if (allOn) return true;
        if (allOff) return false;
        return null;
    };

    node.__soToggleAllSecondaries = () => {
        const rows = node.__soVisibleSecondaries();
        const turnOn = node.__soAllSecondaryState() !== true;

        for (const secondary of rows) {
            secondary.value.on = turnOn;
        }

        node.setDirtyCanvas?.(true, true);
    };

    node.__soRevealNextSecondary = (lora) => {
        const target = (node.__soSecondaryWidgets || []).find(
            (item) => !item.isPopulated(),
        );

        if (!target) {
            console.warn(
                `[Sick Ollie Loader Core] Maximum of ${MAX_SECONDARY_LORAS} secondary LoRAs reached.`,
            );
            return null;
        }

        target.setLora(lora);
        target.value.on = true;
        target._soVisible = true;
        node.size[1] = Math.max(node.size[1], node.computeSize()[1]);
        node.setDirtyCanvas?.(true, true);
        return target;
    };

    node.__soClearSecondary = (secondary) => {
        secondary?.clear?.();
        node.setDirtyCanvas?.(true, true);
    };
}

function refreshFixedSecondaryVisibility(node) {
    for (const secondary of node.__soSecondaryWidgets || []) {
        secondary._soVisible =
            secondary.slotIndex === 1 || secondary.isPopulated();
    }
    node.setDirtyCanvas?.(true, true);
}

function addFixedSecondaryUI(node, restoredValues = []) {
    if (node.__soFixedSecondaryReady) {
        if (restoredValues.length) {
            for (let i = 0; i < Math.min(restoredValues.length, MAX_SECONDARY_LORAS); i++) {
                node.__soSecondaryWidgets[i].value = { ...restoredValues[i] };
            }
        }
        refreshFixedSecondaryVisibility(node);
        return;
    }

    node.__soFixedSecondaryReady = true;
    installFixedSecondaryMethods(node);

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

    for (let slot = 1; slot <= MAX_SECONDARY_LORAS; slot++) {
        const secondary = node.addCustomWidget(
            new SecondaryLoraWidget(
                `${SECONDARY_PREFIX}${slot}`,
                slot,
            ),
        );

        if (restoredValues[slot - 1]) {
            secondary.value = { ...restoredValues[slot - 1] };
        }

        node.__soSecondaryWidgets.push(secondary);
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
                const hasFreeSlot = node.__soSecondaryWidgets.some(
                    (item) => !item.isPopulated(),
                );

                if (!hasFreeSlot) {
                    console.warn(
                        `[Sick Ollie Loader Core] Maximum of ${MAX_SECONDARY_LORAS} secondary LoRAs reached.`,
                    );
                    return true;
                }

                node.__soShowLoraChooser(
                    event,
                    (value) => {
                        if (value !== NONE) {
                            node.__soRevealNextSecondary(value);
                        }
                    },
                );
                return true;
            },
        ),
    );

    refreshFixedSecondaryVisibility(node);
    node.size[0] = Math.max(node.size[0], 560);
    node.size[1] = Math.max(node.size[1], node.computeSize()[1]);
    node.setDirtyCanvas?.(true, true);
}

function looksLikeLegacyPreEpochValues(values) {
    return (
        Array.isArray(values) &&
        typeof values[3] === "boolean" &&
        typeof values[4] === "string" &&
        typeof values[5] === "number" &&
        typeof values[6] === "boolean" &&
        typeof values[7] === "boolean" &&
        CONTROL_MODES.includes(String(values[8])) &&
        typeof values[9] === "boolean" &&
        typeof values[10] === "string" &&
        typeof values[11] === "boolean" &&
        typeof values[12] === "string"
    );
}

function looksLikeSavedShiftedEpochValues(values) {
    // A workflow saved after the bad one-slot load has already lost several
    // original values through widget coercion. Detect that shape so we can at
    // least restore a safe, valid Loader Core instead of shifting it again.
    return (
        Array.isArray(values) &&
        typeof values[3] === "boolean" &&
        typeof values[4] === "boolean" &&
        typeof values[5] === "number" &&
        typeof values[8] === "boolean" &&
        !CONTROL_MODES.includes(String(values[9]))
    );
}

function migrateEpochFilterWorkflow(info) {
    const values = info?.widgets_values;
    if (!Array.isArray(values)) return info;

    // Loader Core 1.0.0 had main_enabled at index 3. This migration must run
    // before LiteGraph applies widget values, otherwise every later widget is
    // configured one slot late.
    if (looksLikeLegacyPreEpochValues(values)) {
        return {
            ...info,
            widgets_values: [
                ...values.slice(0, 3),
                ALL_EPOCHS,
                ...values.slice(3),
            ],
        };
    }

    if (looksLikeSavedShiftedEpochValues(values)) {
        const dynamicSecondaries = values
            .slice(13)
            .filter(
                (value) =>
                    value &&
                    typeof value === "object" &&
                    typeof value.lora !== "undefined",
            );

        console.warn(
            "[Sick Ollie Loader Core] Repairing a workflow saved after the " +
                "epoch widget shift. Main LoRA and edited cleanup text could " +
                "not be recovered, so safe defaults were restored.",
        );

        return {
            ...info,
            widgets_values: [
                values[0],
                values[1],
                values[2],
                ALL_EPOCHS,
                true,
                NONE,
                1,
                Boolean(values[7]),
                true,
                "fixed",
                true,
                "no_lora",
                true,
                DEFAULT_CLEAN_NAME_MODE,
                ...dynamicSecondaries,
            ],
        };
    }

    return info;
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
            lastWidget?._soVisible &&
            lastWidget?.name?.startsWith(SECONDARY_PREFIX)
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
            const items = [
                {
                    content: "ℹ️ Show Info",
                    disabled: !secondary.isPopulated(),
                    callback: () =>
                        secondary.showLoraInfoDialog(),
                },
                null,
                {
                    content: secondary.value.on
                        ? "⚫ Toggle Off"
                        : "🟢 Toggle On",
                    disabled: !secondary.isPopulated(),
                    callback: () => {
                        secondary.value.on =
                            !secondary.value.on;
                        this.setDirtyCanvas?.(true, true);
                    },
                },
                {
                    content: "🗑️ Clear Row",
                    disabled: !secondary.isPopulated(),
                    callback: () => {
                        this.__soClearSecondary?.(secondary);
                    },
                },
            ];

            new LiteGraph.ContextMenu(items, {
                title: `SECONDARY LORA ${secondary.slotIndex}`,
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

        // LiteGraph applies widgets_values inside configure() and only calls
        // onConfigure() afterward. Intercept configure itself so migrations
        // happen before any widget receives a shifted value.
        const originalNodeConfigure = nodeType.prototype.configure;
        nodeType.prototype.configure = function (info) {
            return originalNodeConfigure.call(
                this,
                migrateEpochFilterWorkflow(info),
            );
        };

        const originalCreated =
            nodeType.prototype.onNodeCreated;

        nodeType.prototype.onNodeCreated = function () {
            const result =
                originalCreated?.apply(
                    this,
                    arguments,
                );

            ensureCleanNameCombo(this);

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
                        refreshCleanNameChoices(this);
                        refreshMainTrigger(this, false);
                    }
                };

                const originalMainCallback =
                    mainWidget.callback;

                mainWidget.callback = (value) => {
                    try {
                        originalMainCallback?.call(
                            mainWidget,
                            value,
                        );
                    } finally {
                        refreshCleanNameChoices(this);
                        refreshMainTrigger(this, false);
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
                        refreshEpochChoices(this);
                        refreshMainChoices(
                            this,
                            true,
                        );
                        refreshCleanNameChoices(this);
                    }
                };
            }

            const epochWidget = widget(
                this,
                "epoch_filter",
            );

            if (epochWidget) {
                const originalEpochCallback =
                    epochWidget.callback;

                epochWidget.callback = (value) => {
                    try {
                        originalEpochCallback?.call(
                            epochWidget,
                            value,
                        );
                    } finally {
                        refreshMainChoices(
                            this,
                            true,
                        );
                        refreshCleanNameChoices(this);
                    }
                };
            }

            rgthreeApi.getLoras();
            addFixedSecondaryUI(this);
            ensureTriggerButton(this);
            refreshEpochChoices(this);
            refreshMainChoices(this, false);
            refreshCleanNameChoices(this);
            refreshMainTrigger(this, false);

            return result;
        };

        const originalConfigure =
            nodeType.prototype.onConfigure;

        nodeType.prototype.onConfigure = function (info) {
            const configuredInfo =
                migrateEpochFilterWorkflow(info);

            const result =
                originalConfigure?.call(
                    this,
                    configuredInfo,
                );

            const values =
                dynamicValuesFromWorkflow(configuredInfo);

            setTimeout(() => {
                addFixedSecondaryUI(
                    this,
                    values,
                );
                ensureTriggerButton(this);
                refreshEpochChoices(this);
                refreshMainChoices(this, false);
                refreshCleanNameChoices(this);
                refreshMainTrigger(this, false);
            }, 0);

            return result;
        };
    },
});
