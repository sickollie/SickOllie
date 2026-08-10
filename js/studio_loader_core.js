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

const TARGET = "SOLoaderCoreEngineStudio";
const NONE = "None";
const ALL_FOLDERS = "[All LoRA folders]";
const ROOT_FOLDER = "[LoRA root only]";
const ALL_EPOCHS = "[All epochs]";
const NO_EPOCH_TAG = "[No epoch tag]";
const CONTROL_MODES = ["fixed", "increment", "decrement", "randomize", "shuffle"];
const DEFAULT_CLEAN_NAME_MODE = "auto:1";
const SECONDARY_PREFIX = "secondary_lora_";
const MAX_SECONDARY_LORAS = 10;
const LOADER_DASHBOARD_VERSION = 2;
const LOADER_CANONICAL_NAMES = [
    "diffusion_model",
    "weight_dtype",
    "folder_name",
    "epoch_filter",
    "main_enabled",
    "main_lora",
    "main_strength",
    "include_subfolders",
    "loop_folder",
    "control_after_generate",
    "skip_none_during_cycle",
    "off_name",
    "auto_clean_name",
    "cleanup_rules",
];

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


function hideNativeWidget(target) {
    if (!target) return;
    if (!target.__soHiddenByNavigator) {
        target.__soHiddenByNavigator = true;
        target.__soOriginalType = target.type;
        target.__soOriginalComputeSize = target.computeSize;
    }
    // Dashboard-owned backing widgets must remain serializable/callable, but
    // they should never participate in the stock LiteGraph widget layout or
    // paint pass. `hidden` handles newer frontends while the custom type and
    // negative height keep legacy canvas builds from stacking ghost rows.
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

function moveFrontendWidgetAfter(node, added, anchor, offset = 1) {
    if (!added || !anchor || !Array.isArray(node.widgets)) return;
    const addedIndex = node.widgets.indexOf(added);
    const anchorIndex = node.widgets.indexOf(anchor);
    if (addedIndex < 0 || anchorIndex < 0) return;
    node.widgets.splice(addedIndex, 1);
    node.widgets.splice(anchorIndex + offset, 0, added);
}

function allFolderPaths(node) {
    if (!Array.isArray(node.__soAllFolderChoices)) {
        const target = widget(node, "folder_name");
        node.__soAllFolderChoices = readValues(target);
    }
    return (node.__soAllFolderChoices || [])
        .map((value) => String(value ?? ""))
        .filter((value) => value && value !== ALL_FOLDERS && value !== ROOT_FOLDER);
}

function folderNavigatorChildren(node, selectedValue) {
    const selected = String(selectedValue ?? ALL_FOLDERS);
    const base = selected === ALL_FOLDERS || selected === ROOT_FOLDER
        ? ""
        : normalizePath(selected);
    const children = new Map();

    for (const fullPath of allFolderPaths(node)) {
        const normalized = normalizePath(fullPath);
        let remainder = normalized;
        if (base) {
            if (!normalized.startsWith(base + "/")) continue;
            remainder = normalized.slice(base.length + 1);
        }
        if (!remainder) continue;
        const leaf = remainder.split("/")[0];
        if (!leaf) continue;
        const childPath = base ? `${base}/${leaf}` : leaf;
        children.set(leaf, childPath);
    }

    return [...children.entries()].sort((a, b) =>
        a[0].localeCompare(b[0], undefined, { sensitivity: "base" }),
    );
}

function loraBrowserBasename(value) {
    const normalized = normalizePath(value);
    if (!normalized || normalized === NONE) return "None";
    const slash = normalized.lastIndexOf("/");
    return slash < 0 ? normalized : normalized.slice(slash + 1);
}

function loaderBrowserFolderText(value) {
    const selected = String(value ?? ALL_FOLDERS);
    if (selected === ALL_FOLDERS) return "LoRA Root · all folders";
    if (selected === ROOT_FOLDER) return "LoRA Root · files only";
    return normalizePath(selected);
}

function loaderBrowserButtonText(node) {
    const folder = loaderBrowserFolderText(widget(node, "folder_name")?.value);
    const main = loraBrowserBasename(widget(node, "main_lora")?.value);
    return `📁 LoRA Browser   ${folder}  ·  ${main}`;
}

function ensurePointerTracker() {
    if (window.__soBrowserPointerTrackerInstalled) return;
    window.__soBrowserPointerTrackerInstalled = true;
    window.__soBrowserLastPointer = { x: Math.round(window.innerWidth / 2), y: 180 };
    document.addEventListener("pointerdown", (event) => {
        window.__soBrowserLastPointer = { x: event.clientX, y: event.clientY };
    }, true);
}

function closeSOFolderBrowser() {
    const existing = document.getElementById("so-loader-folder-browser-popup");
    if (existing) existing.remove();
    if (window.__soLoaderBrowserEscape) {
        document.removeEventListener("keydown", window.__soLoaderBrowserEscape, true);
        window.__soLoaderBrowserEscape = null;
    }
    if (window.__soLoaderBrowserOutside) {
        document.removeEventListener("pointerdown", window.__soLoaderBrowserOutside, true);
        window.__soLoaderBrowserOutside = null;
    }
}

function createBrowserShell(id, title, subtitle, onSearch) {
    closeSOFolderBrowser();
    const root = document.createElement("div");
    root.id = id;
    Object.assign(root.style, {
        position: "fixed",
        zIndex: "100000",
        width: "510px",
        maxWidth: "calc(100vw - 24px)",
        background: "#151519",
        border: "1px solid rgba(53,215,255,.62)",
        borderRadius: "9px",
        boxShadow: "0 12px 36px rgba(0,0,0,.58), 0 0 0 1px rgba(255,74,184,.10) inset",
        color: "#eee",
        font: "13px Arial, sans-serif",
        overflow: "hidden",
    });

    const header = document.createElement("div");
    Object.assign(header.style, { padding: "10px 12px 6px", borderBottom: "1px solid rgba(255,74,184,.34)" });
    const titleEl = document.createElement("div");
    titleEl.textContent = title;
    Object.assign(titleEl.style, { fontWeight: "700", fontSize: "14px" });
    const subtitleEl = document.createElement("div");
    subtitleEl.textContent = subtitle;
    Object.assign(subtitleEl.style, { marginTop: "3px", color: "#aaa", fontSize: "12px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
    header.append(titleEl, subtitleEl);

    const search = document.createElement("input");
    search.type = "text";
    search.placeholder = "Filter folders or LoRAs";
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
    window.__soLoaderBrowserEscape = (event) => {
        if (event.key === "Escape") closeSOFolderBrowser();
    };
    document.addEventListener("keydown", window.__soLoaderBrowserEscape, true);
    window.__soLoaderBrowserOutside = (event) => {
        if (!root.contains(event.target)) closeSOFolderBrowser();
    };
    setTimeout(() => {
        document.addEventListener("pointerdown", window.__soLoaderBrowserOutside, true);
        search.focus();
    }, 0);
    return { root, header, subtitleEl, search, list };
}

function browserRow(list, label, kind, callback, hint = "") {
    const row = document.createElement("div");
    const icon = kind === "folder" ? "📁" : kind === "action" ? "" : "";
    row.textContent = `${icon}${icon ? "  " : ""}${label}`;
    Object.assign(row.style, {
        padding: "7px 12px",
        cursor: "pointer",
        borderBottom: "1px solid #242424",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
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

function browserDivider(list) {
    const divider = document.createElement("div");
    Object.assign(divider.style, { height: "1px", background: "rgba(110,231,162,.34)", margin: "5px 0" });
    list.append(divider);
}

function setLoaderFolder(node, value) {
    const folderWidget = widget(node, "folder_name");
    if (!folderWidget) return;
    const next = String(value ?? ALL_FOLDERS);
    folderWidget.value = next;
    try { folderWidget.callback?.(next); } catch (error) {}
    refreshLoaderFolderNavigator(node);
    node.setDirtyCanvas?.(true, true);
}

function setLoaderMainLora(node, value) {
    const mainWidget = widget(node, "main_lora");
    if (!mainWidget) return;
    mainWidget.value = String(value ?? NONE);
    try { mainWidget.callback?.(mainWidget.value); } catch (error) {}
    refreshLoaderFolderNavigator(node);
    node.setDirtyCanvas?.(true, true);
}

function directLorasForBrowser(node, folderValue) {
    const selected = String(folderValue ?? ALL_FOLDERS);
    const parent = selected === ALL_FOLDERS || selected === ROOT_FOLDER ? "" : normalizePath(selected);
    return (node.__soAllMainLoras || [])
        .map((value) => String(value ?? ""))
        .filter((value) => value && value !== NONE && parentFolder(value) === parent)
        .sort((a, b) => loraBrowserBasename(a).localeCompare(loraBrowserBasename(b), undefined, { sensitivity: "base" }));
}

function renderLoaderBrowser(node, shell, query = "") {
    const folderValue = String(widget(node, "folder_name")?.value ?? ALL_FOLDERS);
    const folderText = loaderBrowserFolderText(folderValue);
    shell.subtitleEl.textContent = folderText;
    shell.list.replaceChildren();
    const q = String(query ?? "").trim().toLowerCase();

    if (q) {
        const folderHits = allFolderPaths(node)
            .filter((path) => normalizePath(path).toLowerCase().includes(q))
            .slice(0, 220);
        for (const path of folderHits) {
            browserRow(shell.list, normalizePath(path), "folder", () => {
                setLoaderFolder(node, path);
                shell.search.value = "";
                renderLoaderBrowser(node, shell, "");
            }, path);
        }
        if (!folderHits.length) browserRow(shell.list, "No matching folders", "action", () => {});
        return;
    }

    if (folderValue !== ALL_FOLDERS) {
        browserRow(shell.list, "↑ Parent Folder", "action", () => {
            if (folderValue === ROOT_FOLDER) {
                setLoaderFolder(node, ALL_FOLDERS);
            } else {
                const normalized = normalizePath(folderValue);
                const slash = normalized.lastIndexOf("/");
                setLoaderFolder(node, slash < 0 ? ALL_FOLDERS : normalized.slice(0, slash));
            }
            renderLoaderBrowser(node, shell, "");
        });
    }
    browserRow(shell.list, "⌂ LoRA Root · all folders", "action", () => {
        setLoaderFolder(node, ALL_FOLDERS);
        renderLoaderBrowser(node, shell, "");
    });
    if (folderValue !== ROOT_FOLDER) {
        browserRow(shell.list, "• LoRA Root · files only", "action", () => {
            setLoaderFolder(node, ROOT_FOLDER);
            renderLoaderBrowser(node, shell, "");
        });
    }
    browserDivider(shell.list);

    const children = folderNavigatorChildren(node, folderValue);
    for (const [leaf, path] of children) {
        browserRow(shell.list, leaf, "folder", () => {
            setLoaderFolder(node, path);
            renderLoaderBrowser(node, shell, "");
        }, path);
    }

    if (!children.length) {
        browserRow(shell.list, "No deeper folders · current folder is selected", "action", () => {});
    }
}

function openLoaderFolderBrowser(node) {
    ensurePointerTracker();
    const shell = createBrowserShell(
        "so-loader-folder-browser-popup",
        "Folder Browser",
        loaderBrowserFolderText(widget(node, "folder_name")?.value),
        (query) => renderLoaderBrowser(node, shell, query),
    );
    shell.search.placeholder = "Filter folders";
    renderLoaderBrowser(node, shell, "");
}

function refreshLoaderFolderNavigator(node) {
    node.setDirtyCanvas?.(true, true);
}

function ensureLoaderFolderNavigator(node) {
    const folderWidget = widget(node, "folder_name");
    const mainWidget = widget(node, "main_lora");
    if (!folderWidget || !mainWidget) return;

    if (!Array.isArray(node.__soAllFolderChoices)) node.__soAllFolderChoices = readValues(folderWidget);
    hideNativeWidget(folderWidget);
    hideNativeWidget(mainWidget);

    // dev26/27 used a standalone frontend browser button. The dashboard owns
    // browsing now, so collapse any stale copy without touching saved values.
    if (node.__soFolderBrowserButton) hideNativeWidget(node.__soFolderBrowserButton);

    if (!folderWidget.__soNavigatorBound) {
        folderWidget.__soNavigatorBound = true;
        const previousCallback = folderWidget.callback;
        folderWidget.callback = function (...args) {
            const result = previousCallback?.apply(this, args);
            refreshLoaderFolderNavigator(node);
            return result;
        };
    }

    if (!mainWidget.__soBrowserLabelBound) {
        mainWidget.__soBrowserLabelBound = true;
        const previousCallback = mainWidget.callback;
        mainWidget.callback = function (...args) {
            const result = previousCallback?.apply(this, args);
            refreshLoaderFolderNavigator(node);
            return result;
        };
    }

    refreshLoaderFolderNavigator(node);
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

function triggerCopyFeedback(node) {
    // Browsers cannot provide true desktop haptics, but supported devices can
    // vibrate briefly. The dashboard always provides a visual confirmation so
    // desktop users get the same immediate "click" feedback.
    try {
        if (typeof navigator?.vibrate === "function") navigator.vibrate(18);
    } catch (error) {}

    node.__soTriggerCopied = true;
    node.setDirtyCanvas?.(true, true);
    clearTimeout(node.__soTriggerCopiedTimer);
    node.__soTriggerCopiedTimer = setTimeout(() => {
        node.__soTriggerCopied = false;
        node.setDirtyCanvas?.(true, true);
    }, 850);
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

function delimiterPrefixes(stem) {
    const value = String(stem ?? "")
        .trim()
        .replace(/^[ _\-.]+|[ _\-.]+$/g, "");
    if (!value) return [];

    const prefixes = [];
    const delimiterPattern = /[_.\-\s]+/g;
    let match;
    while ((match = delimiterPattern.exec(value)) !== null) {
        const candidate = value
            .slice(0, match.index)
            .replace(/[ _\-.]+$/g, "");
        if (candidate && !prefixes.includes(candidate)) prefixes.push(candidate);
    }
    if (!prefixes.includes(value)) prefixes.push(value);
    return prefixes;
}

function cleanModeCandidate(value) {
    const text = String(value ?? "");
    const marker = text.indexOf("·");
    return marker >= 0 ? text.slice(marker + 1).trim() : "";
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
    const prefixes = delimiterPrefixes(stem);
    const choices = prefixes.map(
        (candidate, index) => `${index + 1} · ${candidate}`,
    );
    return choices.length ? choices : [`1 · ${stem}`];
}

function legacyRecommendedCleanName(node, modeIndex = 1) {
    const stem = currentMainStem(node);
    const shared = Math.max(
        commonSuffixCount(allowedMainLoras(node)),
        recognizedSuffixCount(stem),
    );
    const remove = Math.max(0, shared - (Math.max(1, modeIndex) - 1));
    return trimSuffixGroups(stem, remove);
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

    const previousValue = String(cleanWidget.value ?? "");
    const previousCandidate = cleanModeCandidate(previousValue);
    const currentIndex = parseCleanModeIndex(previousValue);
    const choices = cleanNameModeChoices(node);

    writeValues(cleanWidget, choices);

    // If an existing saved candidate is still valid for this filename, keep it
    // selected. This avoids changing old workflows merely because the dropdown
    // now exposes more delimiter-based choices.
    const exact = previousCandidate
        ? choices.find((choice) => cleanModeCandidate(choice) === previousCandidate)
        : null;

    const legacyCandidate = !previousCandidate
        ? legacyRecommendedCleanName(node, currentIndex)
        : "";
    const legacyMatch = legacyCandidate
        ? choices.find((choice) => cleanModeCandidate(choice) === legacyCandidate)
        : null;

    cleanWidget.value = exact ?? legacyMatch ??
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

function shuffledCopy(values) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index--) {
        const swap = Math.floor(Math.random() * (index + 1));
        [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
}

function loaderShuffleState(node) {
    node.properties = node.properties || {};
    const existing = node.properties.so_loader_shuffle_state;
    if (!existing || typeof existing !== "object") {
        node.properties.so_loader_shuffle_state = {};
    }
    return node.properties.so_loader_shuffle_state;
}

function nextShuffledMainValue(node, cycle, current, loop) {
    if (!cycle.length) return NONE;
    if (cycle.length === 1) return cycle[0];

    const key = cycle.join("\u001f");
    const state = loaderShuffleState(node);

    if (state.key !== key || !Array.isArray(state.remaining)) {
        state.key = key;
        // The current value is the value that was just queued, so consider it
        // consumed when beginning a fresh bag.
        state.remaining = shuffledCopy(cycle.filter((value) => value !== current));
        state.last = current;
    }

    // Remove the just-used value if it is still waiting in the bag. This also
    // makes a manually selected LoRA count as consumed for the current cycle.
    state.remaining = state.remaining.filter((value) => value !== current);

    if (!state.remaining.length) {
        if (!loop) {
            state.last = current;
            return current;
        }
        state.remaining = shuffledCopy(cycle.filter((value) => value !== current));
    }

    const next = state.remaining.shift() ?? current;
    state.last = next;
    return next;
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

    if (mode === "shuffle") {
        return nextShuffledMainValue(node, cycle, current, loop);
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

    const url = `/sickollie/studio/loader-core/main-trigger?lora=${encodeURIComponent(value)}`;
    const response = await fetch(url, { method: "GET" });
    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const payload = await response.json();
    return String(payload?.trigger ?? "").trim();
}

function updateTriggerButton(node) {
    const text = String(node.__soMainTrigger ?? "").trim();
    if (node.__soTriggerButton) {
        node.__soTriggerButton.name = `📋 Copy trigger: ${displayTriggerValue(text)}`;
    }
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
                triggerCopyFeedback(node);
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


const DASH_MIN_WIDTH = 720;
const DASH_PAD = 10;
const DASH_GAP = 7;
const DASH_ROW_H = 30;
const DASH_COLLAPSED_H = 392;
const DASH_EXPANDED_H = 434;

// Loader Core has four visible outputs but no visible inputs. Stock LiteGraph
// stacks those outputs at the full node-slot spacing, which leaves a noticeably
// larger empty shelf above the dashboard than the other Studio Core nodes.
// Keep the sockets and labels intact, but compact just this output stack so the
// MODEL card can sit at the same visual height as its siblings.
const LOADER_OUTPUT_START_Y = 37;
const LOADER_OUTPUT_STEP_Y = 16;
const LOADER_DASH_MIN_TOP = 94;

const DASH_COLORS = {
    card: "rgba(24,24,27,.98)",
    row: "rgba(39,39,43,.97)",
    outline: "rgba(125,125,135,.42)",
    label: "#9a9aa3",
    text: "#ececef",
    cyan: "#35d7ff",
    magenta: "#ff4ab8",
    yellow: "#f6e65a",
    green: "#6ee7a2",
    accent: "#ff4ab8",
};

function layoutLoaderOutputSockets(node) {
    const outputs = node.outputs || [];
    const right = Number(node.size?.[0] || DASH_MIN_WIDTH);

    for (let index = 0; index < outputs.length; index++) {
        const y = LOADER_OUTPUT_START_Y + index * LOADER_OUTPUT_STEP_Y;
        outputs[index].pos = [right, y];
    }
}

function loaderOutputBottom(node) {
    const count = node.outputs?.length || 0;
    if (!count) return 44;
    return LOADER_OUTPUT_START_Y + (count - 1) * LOADER_OUTPUT_STEP_Y + 7;
}

function loaderOutputAnchor(node, slotIndex) {
    const output = node.outputs?.[slotIndex];
    if (!output) return null;
    layoutLoaderOutputSockets(node);
    const y = Number(output.pos?.[1]);
    if (!Number.isFinite(y)) return null;
    return { x: Number(node.size?.[0] || DASH_MIN_WIDTH), y };
}

function loaderDashboardTop(node) {
    layoutLoaderOutputSockets(node);
    return Math.max(LOADER_DASH_MIN_TOP, loaderOutputBottom(node) + 7);
}

function loaderDashboardHeight(node) {
    return node.properties?.so_loader_dashboard_advanced ? DASH_EXPANDED_H : DASH_COLLAPSED_H;
}

function drawRoundRect(ctx, x, y, w, h, radius = 7, fill = null, stroke = null) {
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
    if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

function drawCMYKGFrame(ctx, x, y, w, h, radius = 9, alpha = .48) {
    ctx.save();
    drawRoundRect(ctx, x, y, w, h, radius, "rgba(10,10,12,.24)", null);
    const g = ctx.createLinearGradient(x, y, x + w, y + h);
    g.addColorStop(0, DASH_COLORS.cyan); g.addColorStop(.34, DASH_COLORS.magenta);
    g.addColorStop(.67, DASH_COLORS.yellow); g.addColorStop(1, DASH_COLORS.green);
    ctx.globalAlpha = alpha;
    drawRoundRect(ctx, x, y, w, h, radius, null, g);
    ctx.restore();
}

function dashText(ctx, text, x, y, options = {}) {
    ctx.save();
    ctx.fillStyle = options.color || DASH_COLORS.text;
    ctx.font = options.font || "12px Arial";
    ctx.textAlign = options.align || "left";
    ctx.textBaseline = "middle";
    ctx.fillText(String(text ?? ""), x, y);
    ctx.restore();
}

function dashSection(ctx, label, x, y, color = DASH_COLORS.label) {
    dashText(ctx, String(label).toUpperCase(), x, y, { color, font: "700 10px Arial" });
}

function dashValueRow(ctx, x, y, w, h, label, value, options = {}) {
    drawRoundRect(ctx, x, y, w, h, 7, DASH_COLORS.row, DASH_COLORS.outline);
    dashText(ctx, label, x + 11, y + h / 2, { color: DASH_COLORS.label, font: "11px Arial" });
    ctx.save();
    ctx.font = options.valueFont || "12px Arial";
    const max = Math.max(38, w - Math.min(130, w * .43) - 27);
    const shown = fitString(ctx, String(value ?? ""), max);
    ctx.restore();
    dashText(ctx, shown, x + w - (options.chevron === false ? 11 : 21), y + h / 2, { align: "right", color: options.valueColor || DASH_COLORS.text, font: options.valueFont || "12px Arial" });
    if (options.chevron !== false) dashText(ctx, "▾", x + w - 8, y + h / 2, { align: "right", color: DASH_COLORS.label, font: "10px Arial" });
}

function dashToggleRow(ctx, x, y, w, h, label, enabled) {
    drawRoundRect(ctx, x, y, w, h, 7, DASH_COLORS.row, DASH_COLORS.outline);
    dashText(ctx, label, x + 11, y + h / 2, { font: "11px Arial" });
    const pw = 34, ph = 18, px = x + w - pw - 10, py = y + (h - ph) / 2;
    drawRoundRect(ctx, px, py, pw, ph, ph / 2, enabled ? "rgba(126,193,146,.78)" : "rgba(82,82,88,.95)", null);
    ctx.beginPath();
    ctx.arc(px + (enabled ? pw - ph / 2 : ph / 2), py + ph / 2, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = "#f2f2f2";
    ctx.fill();
}

function dashHit(node, name, x, y, w, h, callback) {
    node.__soLoaderDashboardHits = node.__soLoaderDashboardHits || {};
    node.__soLoaderDashboardHits[name] = { x, y, w, h, callback };
}

function pointInHit(pos, hit) {
    return Boolean(hit && pos && pos[0] >= hit.x && pos[0] <= hit.x + hit.w && pos[1] >= hit.y && pos[1] <= hit.y + hit.h);
}

function dashboardSet(node, name, value) {
    const target = widget(node, name);
    if (!target) return;
    target.value = value;
    try { target.callback?.(value); } catch (error) {}
    node.setDirtyCanvas?.(true, true);
}

function dashboardToggle(node, name) {
    const target = widget(node, name);
    if (target) dashboardSet(node, name, !Boolean(target.value));
}

function dashboardMainFolderLeaf(node) {
    const parent = parentFolder(widget(node, "main_lora")?.value ?? "");
    return parent ? parent.slice(parent.lastIndexOf("/") + 1) : "LoRA root";
}

function dashboardCleanName(node) {
    const raw = String(widget(node, "cleanup_rules")?.value ?? "");
    return cleanModeCandidate(raw) || legacyRecommendedCleanName(node, parseCleanModeIndex(raw));
}

function openDashboardChoice(node, title, widgetName, values, formatter = null) {
    const target = widget(node, widgetName);
    if (!target) return;
    const choices = (values || []).map((value) => String(value));
    if (!choices.length) return;
    ensurePointerTracker();
    let render;
    const shell = createBrowserShell(
        "so-loader-folder-browser-popup",
        title,
        String(target.value ?? ""),
        (query) => render(query),
    );
    shell.search.placeholder = `Filter ${title.toLowerCase()}`;
    render = (query = "") => {
        const q = String(query).trim().toLowerCase();
        shell.list.replaceChildren();
        const filtered = choices.filter((value) => {
            const shown = formatter ? formatter(value) : value;
            return !q || String(shown).toLowerCase().includes(q) || value.toLowerCase().includes(q);
        });
        for (const value of filtered.slice(0, 280)) {
            const shown = formatter ? formatter(value) : value;
            const active = String(target.value ?? "") === value;
            browserRow(shell.list, `${active ? "✓  " : ""}${shown}`, "file", () => {
                dashboardSet(node, widgetName, value);
                closeSOFolderBrowser();
            }, value);
        }
        if (!filtered.length) browserRow(shell.list, "No matches", "action", () => {});
    };
    render("");
}

function drawLoaderDashboard(node, ctx) {
    if (!node.__soLoaderDashboardReady) return;
    node.__soLoaderDashboardHits = {};
    const top = loaderDashboardTop(node);
    const x = DASH_PAD;
    const w = node.size[0] - DASH_PAD * 2;
    const rowH = DASH_ROW_H;
    const gap = DASH_GAP;
    let y = top;

    ctx.save();
    drawRoundRect(ctx, x - 2, y - 4, w + 4, loaderDashboardHeight(node), 10, "rgba(10,10,12,.34)", null);
    drawCMYKGFrame(ctx, x - 2, y - 4, w + 4, loaderDashboardHeight(node), 10, .34);

    drawCMYKGFrame(ctx, x - 4, y - 5, w + 8, 64, 9, .42);
    dashSection(ctx, "Model", x + 2, y + 7, DASH_COLORS.cyan);
    y += 17;
    const modelW = w * .72 - gap / 2;
    const weightW = w - modelW - gap;
    dashValueRow(ctx, x, y, modelW, rowH, "Diffusion model", loraBrowserBasename(widget(node, "diffusion_model")?.value ?? ""), { valueFont: "11px Arial" });
    dashValueRow(ctx, x + modelW + gap, y, weightW, rowH, "Weight", widget(node, "weight_dtype")?.value ?? "default");
    dashHit(node, "model", x, y, modelW, rowH, () => openDashboardChoice(node, "Diffusion model", "diffusion_model", readValues(widget(node, "diffusion_model")), loraBrowserBasename));
    dashHit(node, "weight", x + modelW + gap, y, weightW, rowH, () => openDashboardChoice(node, "Weight dtype", "weight_dtype", readValues(widget(node, "weight_dtype"))));
    y += rowH + 13;

    drawCMYKGFrame(ctx, x - 4, y - 5, w + 8, 177, 9, .46);
    dashSection(ctx, "Main LoRA", x + 2, y + 7, DASH_COLORS.magenta);
    y += 17;
    // Folder navigation and LoRA selection are intentionally separate. The
    // folder defines the testing pool; the LoRA selector is a searchable view
    // of that pool after include-subfolders + epoch filtering are applied.
    const folderW = w;
    dashValueRow(ctx, x, y, folderW, rowH, "Folder scope", `📁 ${loaderBrowserFolderText(widget(node, "folder_name")?.value)}`);
    dashHit(node, "browser", x, y, folderW, rowH, () => openLoaderFolderBrowser(node));
    y += rowH + gap;

    const allowedMain = allowedMainLoras(node);
    const mainValue = String(widget(node, "main_lora")?.value ?? NONE);
    const mainShownValue = mainValue === NONE ? "None" : loraBrowserBasename(mainValue);
    dashValueRow(ctx, x, y, w, rowH, `Main LoRA · ${allowedMain.length} available`, mainShownValue);
    dashHit(node, "mainlora", x, y, w, rowH, () => {
        openDashboardChoice(
            node,
            `Main LoRA · ${allowedMain.length} available`,
            "main_lora",
            [NONE, ...allowedMain],
            loraBrowserBasename,
        );
    });
    y += rowH + gap;

    const third = (w - gap * 2) / 3;
    dashToggleRow(ctx, x, y, third, rowH, "Enabled", Boolean(widget(node, "main_enabled")?.value));
    dashValueRow(ctx, x + third + gap, y, third, rowH, "Strength", Number(widget(node, "main_strength")?.value ?? 1).toFixed(2), { chevron: false });
    dashValueRow(ctx, x + (third + gap) * 2, y, third, rowH, "Epoch", widget(node, "epoch_filter")?.value ?? ALL_EPOCHS);
    dashHit(node, "enabled", x, y, third, rowH, () => dashboardToggle(node, "main_enabled"));
    dashHit(node, "strength", x + third + gap, y, third, rowH, (event) => {
        app.canvas.prompt("Main LoRA Strength", widget(node, "main_strength")?.value ?? 1, (value) => {
            const n = Number(value); if (Number.isFinite(n)) dashboardSet(node, "main_strength", n);
        }, event);
    });
    dashHit(node, "epoch", x + (third + gap) * 2, y, third, rowH, () => openDashboardChoice(node, "Epoch filter", "epoch_filter", readValues(widget(node, "epoch_filter"))));
    y += rowH + gap;

    const half = (w - gap) / 2;
    dashValueRow(ctx, x, y, half, rowH, "Clean name", dashboardCleanName(node));
    const triggerCopied = Boolean(node.__soTriggerCopied);
    drawRoundRect(
        ctx,
        x + half + gap,
        y,
        half,
        rowH,
        7,
        triggerCopied ? "rgba(74, 132, 101, .34)" : DASH_COLORS.row,
        triggerCopied ? "rgba(137, 213, 166, .82)" : DASH_COLORS.outline,
    );
    dashText(
        ctx,
        triggerCopied ? "Trigger · copied" : "Trigger",
        x + half + gap + 11,
        y + rowH / 2,
        { color: triggerCopied ? "#9cddb4" : DASH_COLORS.label, font: "11px Arial" },
    );
    const trigger = displayTriggerValue(node.__soMainTrigger ?? "");
    ctx.save(); ctx.font = "12px Arial";
    const trigShown = fitString(ctx, trigger, half - 105); ctx.restore();
    dashText(
        ctx,
        trigShown,
        x + w - 35,
        y + rowH / 2,
        { align: "right", color: triggerCopied ? "#b9efca" : (trigger === "none" ? DASH_COLORS.label : DASH_COLORS.text) },
    );
    dashText(ctx, triggerCopied ? "✓" : "📋", x + w - 11, y + rowH / 2, { align: "right", color: triggerCopied ? "#9cddb4" : DASH_COLORS.accent });
    dashHit(node, "clean", x, y, half, rowH, () => openDashboardChoice(node, "Clean name", "cleanup_rules", readValues(widget(node, "cleanup_rules")), cleanModeCandidate));
    dashHit(node, "trigger", x + half + gap, y, half, rowH, async () => {
        const value = String(node.__soMainTrigger ?? "").trim();
        if (!value) return;
        if (await copyText(value)) triggerCopyFeedback(node);
    });
    y += rowH + 17;

    dashText(ctx, `Folder output: ${dashboardMainFolderLeaf(node)}`, x + 2, y - 6, { color: DASH_COLORS.label, font: "10px Arial" });
    const expanded = Boolean(node.properties?.so_loader_dashboard_advanced);
    drawCMYKGFrame(ctx, x - 4, y - 5, w + 8, expanded ? 124 : 94, 9, .42);
    dashSection(ctx, "Testing", x + 2, y + 7, DASH_COLORS.yellow);
    y += 17;
    dashValueRow(ctx, x, y, third, rowH, "After generate", widget(node, "control_after_generate")?.value ?? "fixed");
    dashToggleRow(ctx, x + third + gap, y, third, rowH, "Include subfolders", Boolean(widget(node, "include_subfolders")?.value));
    dashToggleRow(ctx, x + (third + gap) * 2, y, third, rowH, "Skip None", Boolean(widget(node, "skip_none_during_cycle")?.value));
    dashHit(node, "mode", x, y, third, rowH, () => openDashboardChoice(node, "After generate", "control_after_generate", CONTROL_MODES));
    dashHit(node, "include", x + third + gap, y, third, rowH, () => dashboardToggle(node, "include_subfolders"));
    dashHit(node, "skip", x + (third + gap) * 2, y, third, rowH, () => dashboardToggle(node, "skip_none_during_cycle"));
    y += rowH + 9;

    drawRoundRect(ctx, x, y, w, 28, 7, "rgba(31,31,34,.96)", "rgba(110,231,162,.28)");
    dashText(ctx, `Advanced ${expanded ? "▾" : "▸"}`, x + 11, y + 14, { color: DASH_COLORS.green, font: "700 10px Arial" });
    dashText(ctx, "loop + off-state name", x + w - 11, y + 14, { align: "right", color: "#77777e", font: "10px Arial" });
    dashHit(node, "advanced", x, y, w, 28, () => {
        node.properties = node.properties || {};
        node.properties.so_loader_dashboard_advanced = !expanded;
        layoutLoaderDashboard(node, true);
    });
    y += 35;

    if (expanded) {
        const advHalf = (w - gap) / 2;
        dashToggleRow(ctx, x, y, advHalf, rowH, "Loop cycle", Boolean(widget(node, "loop_folder")?.value));
        dashValueRow(ctx, x + advHalf + gap, y, advHalf, rowH, "Off name", widget(node, "off_name")?.value ?? "no_lora", { chevron: false });
        dashHit(node, "loop", x, y, advHalf, rowH, () => dashboardToggle(node, "loop_folder"));
        dashHit(node, "offname", x + advHalf + gap, y, advHalf, rowH, (event) => {
            app.canvas.prompt("Off-state name", widget(node, "off_name")?.value ?? "no_lora", (value) => dashboardSet(node, "off_name", String(value ?? "")), event);
        });
    }

    ctx.restore();
}

function repairLoaderDashboardValues(node) {
    const mode = widget(node, "control_after_generate");
    if (mode && !CONTROL_MODES.includes(String(mode.value))) {
        mode.value = "fixed";
    }
    const loop = widget(node, "loop_folder");
    if (loop && typeof loop.value !== "boolean") loop.value = true;
    const skip = widget(node, "skip_none_during_cycle");
    if (skip && typeof skip.value !== "boolean") skip.value = true;
    const include = widget(node, "include_subfolders");
    if (include && typeof include.value !== "boolean") include.value = true;
    const enabled = widget(node, "main_enabled");
    if (enabled && typeof enabled.value !== "boolean") enabled.value = true;
    const offName = widget(node, "off_name");
    if (offName && typeof offName.value !== "string") offName.value = "no_lora";
    const auto = widget(node, "auto_clean_name");
    if (auto) auto.value = true;
}

function hideLoaderDashboardBackingWidgets(node) {
    for (const name of LOADER_CANONICAL_NAMES) hideNativeWidget(widget(node, name));
    const auto = widget(node, "auto_clean_name");
    if (auto && auto.value !== true) {
        auto.value = true;
        try { auto.callback?.(true); } catch (error) {}
    }
    if (node.__soFolderBrowserButton) hideNativeWidget(node.__soFolderBrowserButton);
    if (node.__soTriggerButton) hideNativeWidget(node.__soTriggerButton);
}

function layoutLoaderDashboard(node, refit = false) {
    if (!node.__soLoaderDashboardReady) return;
    repairLoaderDashboardValues(node);
    hideLoaderDashboardBackingWidgets(node);
    const top = loaderDashboardTop(node);
    node.widgets_start_y = top + loaderDashboardHeight(node) + 10;
    node.size[0] = Math.max(Number(node.size?.[0] || 0), DASH_MIN_WIDTH);
    if (refit) {
        const computed = node.computeSize?.() || [node.size[0], node.widgets_start_y + 180];
        node.size[1] = Math.max(Number(computed[1] || 0) + 8, node.widgets_start_y + 110);
    }
    node.setDirtyCanvas?.(true, true);
}

function ensureLoaderDashboard(node) {
    node.properties = node.properties || {};
    node.properties.so_loader_dashboard_version = LOADER_DASHBOARD_VERSION;
    node.__soLoaderDashboardReady = true;
    repairLoaderDashboardValues(node);
    hideLoaderDashboardBackingWidgets(node);
    layoutLoaderDashboard(node, true);
}

function installLoaderDashboardHooks(nodeType) {
    // Match the compact visual stack with the actual cable anchor positions.
    // This is output-only and Studio-Loader-only, so graph semantics and the
    // other Core nodes remain completely untouched.
    const originalGetConnectionPos = nodeType.prototype.getConnectionPos;
    nodeType.prototype.getConnectionPos = function (isInput, slot, out) {
        if (!isInput && this.__soLoaderDashboardReady) {
            let slotIndex = typeof slot === "number" ? slot : this.findOutputSlot?.(slot);
            if (!Number.isInteger(slotIndex) || slotIndex < 0) slotIndex = Number(slot);
            const anchor = loaderOutputAnchor(this, slotIndex);
            if (anchor) {
                const result = out || [0, 0];
                result[0] = Number(this.pos?.[0] || 0) + anchor.x;
                result[1] = Number(this.pos?.[1] || 0) + anchor.y;
                return result;
            }
        }
        return originalGetConnectionPos?.apply(this, arguments);
    };

    const originalForeground = nodeType.prototype.onDrawForeground;
    nodeType.prototype.onDrawForeground = function (ctx) {
        try { originalForeground?.apply(this, arguments); } catch (error) {}
        drawLoaderDashboard(this, ctx);
    };

    const originalMouseDown = nodeType.prototype.onMouseDown;
    nodeType.prototype.onMouseDown = function (event, pos, canvas) {
        if (this.__soLoaderDashboardReady) {
            for (const hit of Object.values(this.__soLoaderDashboardHits || {})) {
                if (pointInHit(pos, hit)) {
                    hit.callback(event, pos, this);
                    return true;
                }
            }
        }
        return originalMouseDown?.apply(this, arguments);
    };
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
            const populated = (node.__soSecondaryWidgets || []).filter((item) => item.isPopulated()).length;
            ctx.fillText(`SECONDARY LoRAs  ${populated} / ${MAX_SECONDARY_LORAS}`, posX, midY);

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
            on: false,
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
                on: false,
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
        target.value.on = false;
        target._soVisible = true;
        node.size[1] = Math.max(node.size[1], node.computeSize()[1]);
        layoutLoaderDashboard(node, true);
        node.setDirtyCanvas?.(true, true);
        return target;
    };

    node.__soClearSecondary = (secondary) => {
        secondary?.clear?.();
        layoutLoaderDashboard(node, true);
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


function normalizeLoaderWorkflow(info) {
    let migrated = migrateEpochFilterWorkflow(info);
    const values = migrated?.widgets_values;
    if (!Array.isArray(values)) return migrated;

    // dev27 inserted a non-serialized browser widget between folder_name and
    // epoch_filter. Current LiteGraph serialization can leave a null hole at
    // that position. Repair that exact shape before any native widget receives
    // values, then gather secondary rows by object shape instead of position.
    if (
        values.length >= 15 &&
        values[3] == null &&
        typeof values[4] === "string" &&
        (values[4] === ALL_EPOCHS || values[4] === NO_EPOCH_TAG || /^Epoch\s+\d+$/i.test(values[4]))
    ) {
        const secondaries = values
            .filter((value) => value && typeof value === "object" && typeof value.lora !== "undefined")
            .slice(0, MAX_SECONDARY_LORAS);
        migrated = {
            ...migrated,
            widgets_values: [
                values[0], values[1], values[2], values[4], values[5], values[6],
                values[7], values[8], values[9], values[10], values[11], values[12],
                values[13], values[14], ...secondaries,
            ],
        };
    }

    return migrated;
}

function loaderCanonicalValues(node) {
    return LOADER_CANONICAL_NAMES.map((name) => widget(node, name)?.value);
}

function loaderSecondaryValues(node) {
    return (node.__soSecondaryWidgets || []).slice(0, MAX_SECONDARY_LORAS).map((secondary) => ({
        on: secondary?.value?.on !== false,
        lora: secondary?.value?.lora ?? null,
        strength: Number(secondary?.value?.strength ?? 1),
    }));
}

app.registerExtension({
    name: "SickOllie.Studio.LoaderCore",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== TARGET) return;

        installContextMenuHooks(nodeType);
        installLoaderDashboardHooks(nodeType);

        // LiteGraph applies widgets_values inside configure() and only calls
        // onConfigure() afterward. Intercept configure itself so migrations
        // happen before any widget receives a shifted value.
        const originalNodeConfigure = nodeType.prototype.configure;
        nodeType.prototype.configure = function (info) {
            return originalNodeConfigure.call(
                this,
                normalizeLoaderWorkflow(info),
            );
        };

        const originalSerialize = nodeType.prototype.serialize;
        nodeType.prototype.serialize = function () {
            const data = originalSerialize?.apply(this, arguments) || {};
            data.properties = {
                ...(data.properties || {}),
                so_loader_dashboard_version: LOADER_DASHBOARD_VERSION,
            };
            // Always write a compact, canonical array. This deliberately
            // excludes frontend-only UI elements so they cannot create sparse
            // holes and positional shifts on reload.
            data.widgets_values = [
                ...loaderCanonicalValues(this),
                ...loaderSecondaryValues(this),
            ];
            return data;
        };

        const originalCreated =
            nodeType.prototype.onNodeCreated;

        nodeType.prototype.onNodeCreated = function () {
            const result =
                originalCreated?.apply(
                    this,
                    arguments,
                );

            this.bgcolor = "#000000";
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

            ensureLoaderFolderNavigator(this);
            rgthreeApi.getLoras();
            addFixedSecondaryUI(this);
            ensureLoaderDashboard(this);
            refreshEpochChoices(this);
            refreshMainChoices(this, false);
            refreshCleanNameChoices(this);
            refreshMainTrigger(this, false);
            layoutLoaderDashboard(this, true);

            return result;
        };

        const originalConfigure =
            nodeType.prototype.onConfigure;

        nodeType.prototype.onConfigure = function (info) {
            this.bgcolor = "#000000";
            const configuredInfo =
                normalizeLoaderWorkflow(info);

            const result =
                originalConfigure?.call(
                    this,
                    configuredInfo,
                );

            const values =
                dynamicValuesFromWorkflow(configuredInfo);

            setTimeout(() => {
                ensureLoaderFolderNavigator(this);
                addFixedSecondaryUI(
                    this,
                    values,
                );
                ensureLoaderDashboard(this);
                refreshEpochChoices(this);
                refreshMainChoices(this, false);
                refreshCleanNameChoices(this);
                refreshMainTrigger(this, false);
                layoutLoaderDashboard(this, true);
            }, 0);

            return result;
        };
    },
});
