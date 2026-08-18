import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { registerSoloHubItem } from "./solo_hub.js";
const RECIPE_LIBRARY_HEADER_URL = new URL("./solo_hub_assets/RecipeLibraryHeader.png", import.meta.url).href;
const RECIPE_LIBRARY_BACKGROUND_URL = new URL("./solo_hub_assets/RecipeLibraryBackground.webp", import.meta.url).href;

const API = "/sickollie/recipe-catalog";
const STUDIO_TYPES = new Set(["SOLoaderCoreEngineStudio", "SOPromptLogEngineStudio", "SOGenerationPipelineStudio"]);
const TYPE_ALIASES = { SOGenerationCoreStudio: "SOGenerationPipelineStudio", SOOutputBuilderStudio: "SOOutputBuilderSaveStudio" };
const SECTION_LABELS = {
    SOLoaderCoreEngineStudio: "Optional model & LoRA resources",
    SOPromptLogEngineStudio: "Prompt recipe",
    SOGenerationPipelineStudio: "Dimensions & resolved seed",
};
const FIELD_LABELS = {
    diffusion_model: "Diffusion model", weight_dtype: "Model precision", folder_name: "LoRA folder",
    main_enabled: "Main LoRA enabled", main_lora: "Main LoRA", main_strength: "LoRA strength",
    prompt_source: "Prompt source", manual_prompt: "Source prompt used", prompt_log_file: "Prompt log used",
    prompt_mode: "Prompt selection mode", prompt_index: "Prompt line", name_token: "Name placeholder",
    name_value: "NAME value used", item_token: "Item / brand placeholder", item_value: "ITEM / BRAND value used",
    outfit_token_A: "Outfit A placeholder", outfit_log_file_A: "Outfit A source log", outfit_index_A: "Outfit A line",
    outfit_token_B: "Outfit B placeholder", outfit_log_file_B: "Outfit B source log", outfit_index_B: "Outfit B line",
    outfit_token_C: "Outfit C placeholder", outfit_log_file_C: "Outfit C source log", outfit_index_C: "Outfit C line",
    scene_token: "Scene placeholder", scene_log_file: "Scene source log", scene_index: "Scene line",
    trigger_token: "Trigger placeholder", trigger_placement: "Trigger placement", trigger_override: "Trigger override",
    seed_value: "Resolved seed", steps: "Steps", cfg: "CFG", sampler_name: "Sampler", scheduler: "Scheduler",
    denoise: "Denoise", shift: "Model shift", custom_width: "Width", custom_height: "Height",
    batch_size: "Batch size", clip_name: "Text encoder", clip_type: "Encoder type", clip_device: "Encoder device",
    vae_name: "VAE", resolution_mode: "Resolution mode", output_root: "Output folder", extension: "Image format",
    quality: "Image quality", counter_digits: "Counter digits", save_prompt_json: "Embed prompt metadata",
    save_workflow_json: "Embed workflow", save_civitai_parameters: "Embed Civitai metadata",
};
const SAFETY_DEFAULT_OFF = new Set(["diffusion_model", "main_lora", "clip_name", "vae_name"]);
let root = null;
let recipes = [];
let activeToken = "";
const FILTER_TOKENS = ["", "NAME", "OUTFIT", "BRAND", "SCENE", "TRIGGER"];
const PREVIEW_TYPE = "SOFitPreviewStudio";
const PREVIEW_IMAGES_PROPERTY = "so_fit_preview_images";
const PREVIEW_INDEX_PROPERTY = "so_fit_preview_index";
const PREVIEW_UPDATED_PROPERTY = "so_fit_preview_updated_at";

async function request(path, options = {}) {
    const response = await fetch(`${API}${path}`, { headers: { "Content-Type": "application/json", ...(options.headers || {}) }, ...options });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).error || `HTTP ${response.status}`);
    return response.json();
}

function action(label, color = "#35d7ff") { const b = document.createElement("button"); b.textContent = label; Object.assign(b.style, { padding: "8px 10px", borderRadius: "7px", cursor: "pointer", border: `1px solid ${color}aa`, color: "#fff", background: "#25232d", font: "700 11px Segoe UI, Arial" }); return b; }
function close() { root?.remove(); root = null; }

function askRecipeName(defaultName = "New prompt recipe") {
    return new Promise(resolve => {
        const overlay = document.createElement("div");
        Object.assign(overlay.style, { position: "fixed", inset: "0", zIndex: "100050", background: "rgba(0,0,0,.66)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" });
        const card = document.createElement("section");
        Object.assign(card.style, { width: "430px", maxWidth: "92vw", padding: "15px", borderRadius: "12px", border: "1px solid #f6e65a99", background: "linear-gradient(145deg,#17131f,#0d0b12)", boxShadow: "0 24px 70px #000", color: "#f5f1f7" });
        const title = document.createElement("strong"); title.textContent = "SAVE PROMPT RECIPE"; Object.assign(title.style, { display: "block", color: "#f6e65a", letterSpacing: ".07em", font: "700 12px Segoe UI,Arial", marginBottom: "10px" });
        const input = document.createElement("input"); input.type = "text"; input.value = String(defaultName || "New prompt recipe"); input.autocomplete = "off"; input.spellcheck = false;
        Object.assign(input.style, { boxSizing: "border-box", width: "100%", padding: "10px 11px", borderRadius: "8px", border: "1px solid #4a4452", outline: "none", color: "#fff", background: "#09080d", font: "12px Segoe UI,Arial" });
        const buttons = document.createElement("div"); Object.assign(buttons.style, { display: "flex", justifyContent: "flex-end", gap: "8px", marginTop: "12px" });
        const cancel = action("Cancel", "#8f8997"); const save = action("Save recipe", "#f6e65a");
        let settled = false;
        const finish = value => { if (settled) return; settled = true; overlay.remove(); resolve(value); };
        const update = () => { save.disabled = !input.value.trim(); save.style.opacity = save.disabled ? ".45" : "1"; };
        cancel.onclick = () => finish(null);
        save.onclick = () => { const value = input.value.trim(); if (value) finish(value); };
        input.addEventListener("input", update);
        input.addEventListener("keydown", event => { if (event.key === "Escape") { event.preventDefault(); finish(null); } else if (event.key === "Enter" && !save.disabled) { event.preventDefault(); save.click(); } });
        overlay.addEventListener("pointerdown", event => { if (event.target === overlay) finish(null); });
        buttons.append(cancel, save); card.append(title, input, buttons); overlay.append(card); document.body.append(overlay); update();
        requestAnimationFrame(() => { input.focus(); input.select(); });
    });
}

function recipeTokens(payload) {
    const declared = Array.isArray(payload?.tokens) ? payload.tokens.map(String) : [];
    const promptText = (payload?.nodes || []).filter(node => node?.type === "SOPromptLogEngineStudio").flatMap(node => (node.widgets || []).filter(widget => ["manual_prompt", "saved_prompt", "prefix_text", "suffix_text"].includes(widget?.name)).map(widget => String(widget?.value || ""))).join("\n");
    const matches = promptText.match(/(?<![A-Za-z0-9_])(NAME|BRAND|ITEM|OUTFIT(?:_[ABC])?|SCENE|TRIGGER)(?![A-Za-z0-9_])/g) || [];
    const values = new Set([...declared, ...matches]);
    if (values.has("ITEM")) values.add("BRAND");
    if ([...values].some(value => value === "OUTFIT" || value.startsWith("OUTFIT_"))) values.add("OUTFIT");
    return [...values].sort();
}

function catalogStatus(message, tone = "#6ee7a2") {
    const field = root?.querySelector("[data-catalog-status]");
    if (!field) return;
    field.textContent = message;
    field.style.color = tone;
}

function cleanPreviewData(data) {
    if (!data || typeof data !== "object" || !String(data.filename || "")) return null;
    return { filename: String(data.filename), type: String(data.type || "temp"), subfolder: String(data.subfolder || "") };
}

function currentStudioPreviewData(preferred = null) {
    const explicit = cleanPreviewData(preferred);
    if (explicit) return explicit;
    const candidates = (app.graph?._nodes || [])
        .filter(node => node.type === PREVIEW_TYPE)
        .map(node => {
            const index = Math.max(0, Number(node.__soFitImageIndex ?? node.properties?.[PREVIEW_INDEX_PROPERTY] ?? 0));
            const live = cleanPreviewData(node.__soFitImageData?.[index]);
            const stored = cleanPreviewData(node.properties?.[PREVIEW_IMAGES_PROPERTY]?.[index]);
            return { data: live || stored, updated: Number(node.properties?.[PREVIEW_UPDATED_PROPERTY] || 0) };
        })
        .filter(item => item.data)
        .sort((a, b) => b.updated - a.updated);
    return candidates[0]?.data || null;
}

function previewOriginalUrl(data) {
    const filename = encodeURIComponent(data?.filename || "");
    const type = encodeURIComponent(data?.type || "temp");
    const subfolder = encodeURIComponent(data?.subfolder || "");
    return api.apiURL(`/view?filename=${filename}&type=${type}&subfolder=${subfolder}`);
}

async function saveRecipeRequest(name, payload, preferredPreview = null) {
    const previewData = currentStudioPreviewData(preferredPreview);
    if (!previewData) return request("/recipes", { method: "POST", body: JSON.stringify({ name, payload }) });
    try {
        const imageResponse = await fetch(previewOriginalUrl(previewData));
        if (!imageResponse.ok) throw new Error(`Preview image HTTP ${imageResponse.status}`);
        const blob = await imageResponse.blob();
        const form = new FormData();
        form.append("name", name);
        form.append("payload", JSON.stringify(payload));
        form.append("file", blob, previewData.filename || "preview.png");
        const response = await fetch(`${API}/save-with-preview`, { method: "POST", body: form });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.ok) throw new Error(data.error || `HTTP ${response.status}`);
        return data;
    } catch (error) {
        console.warn("[Sick Ollie Recipe Catalog] Preview thumbnail verification failed; saving recipe without a thumbnail.", error);
        const result = await request("/recipes", { method: "POST", body: JSON.stringify({ name, payload }) });
        return { ...result, preview_matched: false, preview_reason: error?.message || "Preview verification failed" };
    }
}

function isConnected(node, widget) {
    const input = node.inputs?.find((item) => item.widget?.name === widget.name || item.name === widget.name);
    return input?.link != null || (Array.isArray(input?.links) && input.links.length > 0);
}

function normalizedIndex(value, count) {
    if (!count) return 0;
    const number = Number.isFinite(Number(value)) ? Math.trunc(Number(value)) : 0;
    return ((number % count) + count) % count;
}

function nodeValues(node) {
    return Object.fromEntries((node?.widgets || []).filter(widget => widget.name && widget.serialize !== false).map(widget => [widget.name, widget.value]));
}

function streamLine(node, base, values) {
    const lines = node.__soLogLines?.[base] || [];
    const indexName = base === "prompt" ? "prompt_index" : base === "scene" ? "scene_index" : `outfit_index_${base.slice(-1).toUpperCase()}`;
    const index = normalizedIndex(values[indexName], lines.length);
    return { lines, index, line: String(lines[index] || "") };
}

function tokenPresent(prompt, token, aliases = []) {
    const candidates = [token, ...aliases].filter(Boolean).map(value => String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return candidates.some(value => new RegExp(`(?<![A-Za-z0-9_])(?:\\{${value}\\}|${value})(?![A-Za-z0-9_])`, "i").test(prompt));
}

function lastExecutedPromptValues(node, source, placeholders) {
    const assembly = node?.__soLastAssembly;
    if (!assembly || typeof assembly !== "object") return null;
    const promptMeta = assembly.prompt && typeof assembly.prompt === "object" ? assembly.prompt : {};
    const sourcePrompt = String(assembly.source_prompt ?? promptMeta.line ?? source.manual_prompt ?? "");
    const values = { prompt_source: "manual", manual_prompt: sourcePrompt };

    if (String(promptMeta.source || "") === "log" && promptMeta.file && promptMeta.file !== "[None]") {
        values.prompt_log_file = String(promptMeta.file);
        values.prompt_mode = "fixed";
        if (promptMeta.index != null && Number.isFinite(Number(promptMeta.index))) values.prompt_index = Number(promptMeta.index);
    }

    for (const [key, letter] of [["outfit_a", "A"], ["outfit_b", "B"], ["outfit_c", "C"]]) {
        const item = assembly[key] && typeof assembly[key] === "object" ? assembly[key] : {};
        if (!item.used) continue;
        const file = String(item.file || source[`outfit_log_file_${letter}`] || "");
        if (!file || file === "[None]") continue;
        values[`outfit_token_${letter}`] = String(item.token || source[`outfit_token_${letter}`] || (letter === "A" ? "OUTFIT" : `OUTFIT_${letter}`));
        values[`outfit_placement_${letter}`] = String(item.placement || source[`outfit_placement_${letter}`] || "token");
        values[`outfit_log_file_${letter}`] = file;
        values[`outfit_mode_${letter}`] = "fixed";
        if (item.index != null && Number.isFinite(Number(item.index))) values[`outfit_index_${letter}`] = Number(item.index);
        if (item.line) placeholders.push({ token: values[`outfit_token_${letter}`], value: String(item.line), widget: `outfit_log_file_${letter}`, source: file });
    }

    const scene = assembly.scene && typeof assembly.scene === "object" ? assembly.scene : {};
    if (scene.used) {
        const file = String(scene.file || source.scene_log_file || "");
        if (file && file !== "[None]") {
            values.scene_token = String(scene.token || source.scene_token || "SCENE");
            values.scene_placement = String(scene.placement || source.scene_placement || "token");
            values.scene_log_file = file;
            values.scene_mode = "fixed";
            if (scene.index != null && Number.isFinite(Number(scene.index))) values.scene_index = Number(scene.index);
            if (scene.line) placeholders.push({ token: values.scene_token, value: String(scene.line), widget: "scene_log_file", source: file });
        }
    }

    for (const [key, tokenField, valueField] of [["name", "name_token", "name_value"], ["item", "item_token", "item_value"]]) {
        const item = assembly[key] && typeof assembly[key] === "object" ? assembly[key] : {};
        if (!item.used || item.value == null || String(item.value).trim() === "") continue;
        values[tokenField] = String(item.token || source[tokenField] || key.toUpperCase());
        values[valueField] = item.value;
        placeholders.push({ token: values[tokenField], value: item.value, widget: valueField });
    }

    for (const key of ["prefix", "suffix"]) {
        const item = assembly[key] && typeof assembly[key] === "object" ? assembly[key] : {};
        if (item.enabled && String(item.text || "").trim()) Object.assign(values, { [`${key}_enabled`]: true, [`${key}_text`]: String(item.text) });
    }
    return values;
}

function captureRecipe() {
    const graphNodes = app.graph?._nodes || [];
    const promptNode = graphNodes.find(node => node.type === "SOPromptLogEngineStudio");
    const generationNode = graphNodes.find(node => node.type === "SOGenerationPipelineStudio");
    const loaderNode = graphNodes.find(node => node.type === "SOLoaderCoreEngineStudio");
    const nodes = [];
    const optionalNodes = [];
    const placeholders = [];

    if (promptNode) {
        const source = nodeValues(promptNode);
        let values = lastExecutedPromptValues(promptNode, source, placeholders);
        if (!values) {
            const promptSelection = streamLine(promptNode, "prompt", source);
            const fromLog = String(source.prompt_source) === "log";
            const usedPrompt = fromLog ? promptSelection.line : String(source.manual_prompt || "");
            values = { prompt_source: "manual", manual_prompt: usedPrompt };
            if (fromLog && source.prompt_log_file && source.prompt_log_file !== "[None]") Object.assign(values, { prompt_log_file: source.prompt_log_file, prompt_mode: "fixed", prompt_index: promptSelection.index });

            for (const letter of ["A", "B", "C"]) {
                const base = `outfit_${letter}`;
                const selection = streamLine(promptNode, base, source);
                const file = source[`outfit_log_file_${letter}`];
                const token = String(source[`outfit_token_${letter}`] || `OUTFIT_${letter}`);
                const placement = String(source[`outfit_placement_${letter}`] || "token");
                const aliases = letter === "A" ? ["OUTFIT", "OUTFIT_A"] : [`OUTFIT_${letter}`];
                const used = file && file !== "[None]" && selection.line && placement !== "off" && (placement !== "token" && placement !== "placeholder" || tokenPresent(usedPrompt, token, aliases));
                if (used) Object.assign(values, { [`outfit_token_${letter}`]: token, [`outfit_placement_${letter}`]: placement, [`outfit_log_file_${letter}`]: file, [`outfit_mode_${letter}`]: "fixed", [`outfit_index_${letter}`]: selection.index });
            }

            const sceneSelection = streamLine(promptNode, "scene", source);
            const sceneToken = String(source.scene_token || "SCENE");
            const scenePlacement = String(source.scene_placement || "token");
            const sceneUsed = source.scene_log_file && source.scene_log_file !== "[None]" && sceneSelection.line && scenePlacement !== "off" && (scenePlacement !== "token" && scenePlacement !== "placeholder" || tokenPresent(usedPrompt, sceneToken));
            if (sceneUsed) Object.assign(values, { scene_token: sceneToken, scene_placement: scenePlacement, scene_log_file: source.scene_log_file, scene_mode: "fixed", scene_index: sceneSelection.index });

            for (const [tokenField, valueField] of [["name_token", "name_value"], ["item_token", "item_value"]]) {
                if (String(source[valueField] ?? "").trim()) {
                    values[tokenField] = source[tokenField]; values[valueField] = source[valueField];
                    placeholders.push({ token: source[tokenField] || tokenField, value: source[valueField], widget: valueField });
                }
            }
            for (const key of ["prefix", "suffix"]) if (source[`${key}_enabled`] && String(source[`${key}_text`] || "").trim()) Object.assign(values, { [`${key}_enabled`]: true, [`${key}_text`]: source[`${key}_text`] });
        }
        nodes.push({ type: promptNode.type, title: "Prompt used", widgets: Object.entries(values).filter(([, value]) => value != null && value !== "").map(([name, value]) => ({ name, value })) });
    }

    if (generationNode) {
        const source = nodeValues(generationNode);
        const seed = Number(source.seed_value) === -1 ? Number(generationNode.__soLastUsedSeed) : Number(source.seed_value);
        const values = { resolution_mode: "custom", custom_width: Number(generationNode.__soLastWidth ?? source.custom_width), custom_height: Number(generationNode.__soLastHeight ?? source.custom_height) };
        if (Number.isInteger(seed) && seed >= 0) values.seed_value = seed;
        nodes.push({ type: generationNode.type, title: "Dimensions & resolved seed", widgets: Object.entries(values).filter(([, value]) => Number.isFinite(value) || typeof value === "string").map(([name, value]) => ({ name, value })) });
        const resources = Object.fromEntries(["clip_name", "clip_type", "clip_device", "vae_name"].filter(name => source[name] != null && source[name] !== "").map(name => [name, source[name]]));
        if (Object.keys(resources).length) optionalNodes.push({ type: generationNode.type, title: "Optional encoder & VAE resources", widgets: Object.entries(resources).map(([name, value]) => ({ name, value })) });
    }

    if (loaderNode) {
        const source = nodeValues(loaderNode);
        const resources = Object.fromEntries(["diffusion_model", "weight_dtype"].filter(name => source[name] != null && source[name] !== "").map(name => [name, source[name]]));
        if (source.main_enabled && source.main_lora && !["None", "[None]", "no_lora"].includes(String(source.main_lora))) Object.assign(resources, { folder_name: source.folder_name, main_enabled: true, main_lora: source.main_lora, main_strength: source.main_strength });
        for (let index = 1; index <= 10; index++) { const value = source[`secondary_lora_${index}`]; if (value?.lora && !["None", "[None]", "no_lora"].includes(String(value.lora))) resources[`secondary_lora_${index}`] = value; }
        if (Object.keys(resources).length) optionalNodes.push({ type: loaderNode.type, title: "Optional model & LoRA resources", widgets: Object.entries(resources).map(([name, value]) => ({ name, value })) });
    }

    const payload = { schema: 4, catalog_focus: "prompt", captured_at: new Date().toISOString(), nodes, optional_nodes: optionalNodes, summary: { placeholders } };
    payload.tokens = recipeTokens(payload); return payload;
}

function displayValue(value) {
    if (value == null || value === "") return "Not set";
    if (typeof value === "boolean") return value ? "On" : "Off";
    if (typeof value === "object") {
        if (Object.prototype.hasOwnProperty.call(value, "lora")) return value.lora ? `${value.on === false ? "Disabled" : "Enabled"} · ${value.lora} · strength ${value.strength ?? 1}` : "Empty LoRA slot";
        return JSON.stringify(value);
    }
    return String(value);
}

function humanField(name) {
    if (FIELD_LABELS[name]) return FIELD_LABELS[name];
    return String(name || "Value").replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase());
}

function recipeDiff(recipe, includeResources = false) {
    const output = [];
    const savedNodes = [
        ...(recipe.payload?.nodes || []).map(node => ({ ...node, __optional: false })),
        ...(includeResources ? (recipe.payload?.optional_nodes || []).map(node => ({ ...node, __optional: true })) : []),
    ];
    for (const saved of savedNodes) {
        const savedType = TYPE_ALIASES[saved.type] || saved.type;
        const current = (app.graph?._nodes || []).find(node => node.type === savedType);
        if (!current) { output.push({ type: savedType, label: saved.title || "No matching current Studio node", changes: [], missing: true, optional: saved.__optional }); continue; }
        const changes = [];
        const imported = !Array.isArray(saved.widgets) && Array.isArray(saved.widget_values);
        const savedWidgets = imported
            ? saved.widget_values.map((value, index) => ({ name: current.widgets?.filter(widget => widget.name && widget.serialize !== false)[index]?.name, value })).filter(entry => entry.name)
            : (saved.widgets || []);
        for (const entry of savedWidgets) {
            const target = current.widgets?.find(widget => widget.name === entry.name);
            if (!target || JSON.stringify(target.value) === JSON.stringify(entry.value)) continue;
            changes.push({ id: `${savedType}:${saved.__optional ? "optional:" : ""}${entry.name}`, name: entry.name, from: target.value, to: entry.value, connected: isConnected(current, target), checked: !saved.__optional && !SAFETY_DEFAULT_OFF.has(entry.name) });
        }
        output.push({ type: savedType, label: saved.title, node: current, changes, missing: false, imported, optional: saved.__optional });
    }
    return output;
}

function applyRecipe(recipe, selected = null) {
    const diff = recipeDiff(recipe, true); let changed = 0, skipped = 0;
    for (const entry of diff) for (const change of entry.changes) {
        if (change.connected || (selected && !selected.has(change.id))) { skipped++; continue; }
        const target = entry.node.widgets?.find(widget => widget.name === change.name);
        target.value = change.to; try { target.callback?.(change.to); } catch (error) {}
        entry.node.setDirtyCanvas?.(true, true); changed++;
    }
    return { changed, skipped };
}

function showDiff(recipe) {
    const diff = recipeDiff(recipe, true);
    const modal = document.createElement("div"); Object.assign(modal.style, { position: "fixed", inset: "0", zIndex: "100031", background: "rgba(0,0,0,.62)", display: "flex", alignItems: "center", justifyContent: "center", padding: "24px" });
    const card = document.createElement("div"); Object.assign(card.style, { width: "920px", maxWidth: "96vw", maxHeight: "88vh", display: "flex", flexDirection: "column", background: "#15131b", color: "#f4f1f6", border: "1px solid #35d7ff99", borderRadius: "12px", boxShadow: "0 22px 70px #000", overflow: "hidden" });
    const head = document.createElement("div"); head.textContent = `APPLY RECIPE · ${recipe.name}`; Object.assign(head.style, { padding: "13px 15px", color: "#35d7ff", fontWeight: "700", borderBottom: "1px solid #ff4ab855" }); card.append(head);
    const body = document.createElement("div"); Object.assign(body.style, { padding: "12px 15px", overflow: "auto" });
    let total = 0, protectedCount = 0;
    for (const group of diff) {
        const section = document.createElement("section"); section.dataset.optionalResources = group.optional ? "true" : "false"; Object.assign(section.style, { display: group.optional ? "none" : "block", marginBottom: "12px", border: "1px solid #3a3542", borderRadius: "9px", overflow: "hidden", background: "rgba(255,255,255,.018)" });
        const sectionHead = document.createElement("div"); sectionHead.textContent = group.label || SECTION_LABELS[group.type] || group.type; Object.assign(sectionHead.style, { padding: "9px 11px", color: group.optional ? "#f6e65a" : "#35d7ff", font: "700 12px Segoe UI,Arial", letterSpacing: ".04em", background: "linear-gradient(90deg,rgba(53,215,255,.10),rgba(255,74,184,.05))" }); section.append(sectionHead);
        if (group.missing) {
            const missing = document.createElement("div"); missing.textContent = "This section is saved in the recipe, but that Studio node is not currently on this canvas. Add the matching node to apply it."; Object.assign(missing.style, { padding: "11px", color: "#f6e65a", lineHeight: "1.45" }); section.append(missing);
        } else if (!group.changes.length) {
            const same = document.createElement("div"); same.textContent = "Already matches the current node."; Object.assign(same.style, { padding: "10px 11px", color: "#8f8997" }); section.append(same);
        } else {
            total += group.changes.length; protectedCount += group.changes.filter(c => c.connected).length;
            for (const change of group.changes) {
                const row = document.createElement("label"); Object.assign(row.style, { display: "grid", gridTemplateColumns: "22px minmax(145px,210px) 1fr", gap: "8px", alignItems: "start", padding: "9px 11px", borderTop: "1px solid #2b2731", cursor: change.connected ? "not-allowed" : "pointer" });
                const check = document.createElement("input"); check.type = "checkbox"; check.dataset.changeId = change.id; check.checked = change.checked && !change.connected; check.disabled = change.connected;
                const label = document.createElement("strong"); label.textContent = `${humanField(change.name)}${change.connected ? "  🔒" : ""}`; Object.assign(label.style, { color: change.connected ? "#8b8491" : "#f2edf4", fontSize: "11px" });
                const values = document.createElement("div");
                const next = document.createElement("div"); next.textContent = displayValue(change.to); Object.assign(next.style, { color: "#fff", whiteSpace: "pre-wrap", wordBreak: "break-word", maxHeight: change.name === "manual_prompt" ? "150px" : "72px", overflow: "auto", font: change.name === "manual_prompt" ? "11px/1.45 Consolas,monospace" : "11px/1.4 Segoe UI,Arial" });
                const current = document.createElement("div"); current.textContent = `Current: ${displayValue(change.from)}`; Object.assign(current.style, { color: "#817b88", marginTop: "4px", fontSize: "10px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
                values.append(next, current); row.append(check, label, values); section.append(row);
            }
        }
        body.append(section);
    }
    const placeholders = recipe.payload?.summary?.placeholders || [];
    if (placeholders.length) {
        const used = document.createElement("section"); Object.assign(used.style, { margin: "4px 0 12px", padding: "10px 11px", border: "1px solid #f6e65a55", borderRadius: "9px", background: "rgba(246,230,90,.035)" });
        const title = document.createElement("strong"); title.textContent = "VALUES USED IN THE ORIGINAL IMAGE"; Object.assign(title.style, { color: "#f6e65a", fontSize: "11px" }); used.append(title);
        for (const item of placeholders) { const line = document.createElement("div"); line.textContent = `${item.token}: ${item.value}${item.source ? `  ·  ${item.source}` : ""}`; Object.assign(line.style, { marginTop: "7px", color: "#d7d0db", whiteSpace: "pre-wrap", fontSize: "11px" }); used.append(line); }
        body.append(used);
    }
    const note = document.createElement("div"); note.textContent = `${total} value change(s). ${protectedCount} connected field(s) are protected and will be skipped.`; Object.assign(note.style, { color: "#f6e65a", marginTop: "10px" }); body.append(note);
    if ((recipe.payload?.optional_nodes || []).length) {
        const resources = document.createElement("label"); Object.assign(resources.style, { display: "flex", gap: "8px", alignItems: "center", margin: "4px 0 12px", padding: "10px 11px", border: "1px solid #f6e65a66", borderRadius: "9px", color: "#f6e65a", cursor: "pointer" });
        const toggle = document.createElement("input"); toggle.type = "checkbox"; toggle.onchange = () => { for (const section of body.querySelectorAll('[data-optional-resources="true"]')) section.style.display = toggle.checked ? "block" : "none"; };
        const label = document.createElement("span"); label.textContent = "Show optional model / LoRA / text encoder / VAE changes (off by default)"; resources.append(toggle, label); body.prepend(resources);
    }
    card.append(body);
    const foot = document.createElement("div"); Object.assign(foot.style, { display: "flex", justifyContent: "flex-end", gap: "8px", padding: "12px", borderTop: "1px solid #2c2932" });
    const cancel = action("Cancel", "#888"); const apply = action("Apply checked changes", "#6ee7a2"); cancel.onclick = () => modal.remove(); apply.onclick = () => { const selected = new Set([...body.querySelectorAll("input[data-change-id]:checked")].map(item => item.dataset.changeId)); const result = applyRecipe(recipe, selected); catalogStatus(`Applied ${result.changed} recipe value(s).`); modal.remove(); };
    foot.append(cancel, apply); card.append(foot); modal.append(card); document.body.append(modal);
}

function render() {
    const list = root?.querySelector("[data-recipes]"); if (!list) return; list.replaceChildren();
    const visible = activeToken ? recipes.filter(recipe => recipeTokens(recipe.payload).includes(activeToken)) : recipes;
    if (!visible.length) {
        const e = document.createElement("div"); e.textContent = recipes.length ? `No saved recipes use ${activeToken}.` : "No prompt recipes saved yet. Import an output image or save the current Studio prompt setup.";
        Object.assign(e.style, { gridColumn: "1 / -1", padding: "42px", color: "#afa9b6", textAlign: "center" }); list.append(e); return;
    }
    for (const recipe of visible) {
        const card = document.createElement("article"); Object.assign(card.style, { minWidth: "0", overflow: "hidden", border: "1px solid #403249", borderRadius: "11px", background: "linear-gradient(150deg,rgba(255,74,184,.10),rgba(53,215,255,.04) 55%,rgba(10,9,14,.95))", boxShadow: "0 10px 28px rgba(0,0,0,.25)" });
        const preview = document.createElement("div"); Object.assign(preview.style, { height: "220px", position: "relative", overflow: "hidden", background: "radial-gradient(circle at 18% 15%,#ff4ab855,transparent 34%),radial-gradient(circle at 82% 20%,#35d7ff44,transparent 38%),#0b0910" });
        if (recipe.preview_ref) {
            const image = document.createElement("img"); image.src = `${API}/preview/${encodeURIComponent(recipe.preview_ref)}`; image.alt = recipe.name; Object.assign(image.style, { width: "100%", height: "100%", objectFit: "cover", display: "block" }); preview.append(image);
        }
        if (recipe.payload?.imported_from_image) { const badge = document.createElement("span"); badge.textContent = "IMPORTED"; Object.assign(badge.style, { position: "absolute", left: "9px", top: "9px", padding: "4px 7px", borderRadius: "999px", color: "#fff", background: "rgba(169,140,255,.82)", font: "700 9px Segoe UI,Arial", letterSpacing: ".08em" }); preview.append(badge); }
        const body = document.createElement("div"); body.style.padding = "12px";
        const h = document.createElement("strong"); h.textContent = recipe.name; Object.assign(h.style, { color: "#f5f1f7", display: "block", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" });
        const optional = recipe.payload?.optional_nodes?.length || 0; const meta = document.createElement("div"); meta.textContent = `Prompt recipe${optional ? ` · ${optional} optional resource section${optional === 1 ? "" : "s"}` : ""} · ${new Date(recipe.updated_at).toLocaleDateString()}`; Object.assign(meta.style, { color: "#a9a1b2", fontSize: "10px", margin: "5px 0 8px" });
        const tags = document.createElement("div"); Object.assign(tags.style, { minHeight: "20px", display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "10px" });
        for (const token of recipeTokens(recipe.payload).filter(token => ["NAME", "OUTFIT", "BRAND", "SCENE", "TRIGGER"].includes(token))) { const chip = document.createElement("span"); chip.textContent = token; Object.assign(chip.style, { padding: "3px 6px", borderRadius: "999px", border: "1px solid #35d7ff55", color: "#c9f5ff", font: "700 9px Segoe UI,Arial" }); tags.append(chip); }
        const buttons = document.createElement("div"); Object.assign(buttons.style, { display: "grid", gridTemplateColumns: "1fr auto", gap: "7px" }); const apply = action("Review & apply", "#6ee7a2"); apply.onclick = () => showDiff(recipe); const remove = action("×", "#ff4ab8"); remove.title = "Delete recipe"; remove.onclick = async () => { if (confirm(`Delete recipe “${recipe.name}”?`)) { await request(`/recipes/${encodeURIComponent(recipe.recipe_id)}`, { method: "DELETE" }); await load(); catalogStatus(`Deleted ${recipe.name}.`, "#ff8fce"); } }; buttons.append(apply, remove); body.append(h, meta, tags, buttons); card.append(preview, body); list.append(card);
    }
}

async function load() { recipes = await request("/recipes"); render(); }

async function saveCurrentStudioRecipe(defaultName = "New prompt recipe", options = {}) {
    const payload = captureRecipe();
    if (!payload.nodes?.length) throw new Error("Add a Studio Prompt Core or Generation Core before saving a recipe.");
    const name = await askRecipeName(defaultName);
    if (!name) return null;
    const result = await saveRecipeRequest(name, payload, options.previewData);
    if (root) await load();
    if (result.preview_matched === true) catalogStatus(`Saved ${name} · recipe and thumbnail captured from the current Preview image.`);
    else if (result.preview_matched === false) catalogStatus(`Saved ${name} · thumbnail skipped because the Preview did not verify against the saved recipe.`, "#f6e65a");
    else catalogStatus(`Saved ${name}.`);
    window.dispatchEvent(new CustomEvent("sickollie:recipe-saved", { detail: { name, recipe_id: result.recipe_id, preview_ref: result.preview_ref || "" } }));
    return result;
}

async function openRecipes() {
    if (root) return; root = document.createElement("div"); Object.assign(root.style, { position: "fixed", inset: "0", zIndex: "100030", background: "rgba(5,3,8,.92)", display: "flex", alignItems: "center", justifyContent: "center", padding: "16px" });
    const panel = document.createElement("section"); Object.assign(panel.style, { boxSizing: "border-box", width: "min(2560px,calc(100vw - 32px))", height: "min(1800px,calc(100vh - 32px))", minWidth: "min(780px,calc(100vw - 32px))", minHeight: "min(620px,calc(100vh - 32px))", display: "flex", flexDirection: "column", background: "#0d0a12", border: "1px solid #ff4ab899", borderRadius: "22px", overflow: "hidden", color: "#f4f1f6", boxShadow: "0 30px 100px rgba(0,0,0,.62),0 0 42px rgba(255,74,184,.14)" });
    const head = document.createElement("header"); Object.assign(head.style, { padding: "12px 16px", minHeight: "76px", display: "flex", alignItems: "center", gap: "10px", background: `linear-gradient(90deg,rgba(7,5,10,.16),rgba(7,5,10,.42) 58%,rgba(7,5,10,.60)), url(${RECIPE_LIBRARY_BACKGROUND_URL}) center / cover no-repeat`, borderBottom: "1px solid #35d7ff55" });
    const title = document.createElement("img"); title.src = RECIPE_LIBRARY_HEADER_URL; title.alt = "Sick Ollie Recipe Library"; title.draggable = false; Object.assign(title.style, { height: "54px", width: "auto", maxWidth: "min(44vw,560px)", objectFit: "contain" }); const copy = document.createElement("span"); copy.textContent = "Prompts, used log selections, substitutions, dimensions, and resolved seeds. Resources stay optional."; Object.assign(copy.style, { flex: "1", color: "#c3bbc9", fontSize: "12px" });
    const save = action("Save recipe", "#f6e65a"); save.onclick = async () => { save.disabled = true; try { await saveCurrentStudioRecipe(); } catch (error) { catalogStatus(error.message, "#ff78bd"); alert(error.message); } finally { save.disabled = false; } };
    const importImage = action("Import output image", "#6ee7a2"); importImage.onclick = () => { const picker = document.createElement("input"); picker.type = "file"; picker.accept = "image/png,image/jpeg,image/webp"; picker.onchange = async () => { const file = picker.files?.[0]; if (!file) return; importImage.disabled = true; importImage.textContent = "Importing…"; catalogStatus(`Reading ${file.name}…`, "#35d7ff"); try { const form = new FormData(); form.append("file", file); const response = await fetch(`${API}/import-image`, { method: "POST", body: form }); const data = await response.json(); if (!response.ok || !data.ok || !data.saved) throw new Error(data.error || "The converted recipe was not saved."); await load(); catalogStatus(`Saved ${data.name} · ${data.tokens?.length || 0} token type(s) detected.`); } catch (error) { catalogStatus(error.message || "Import failed.", "#ff78bd"); alert(error.message || "Could not import recipe from this image."); } finally { importImage.disabled = false; importImage.textContent = "Import output image"; } }; picker.click(); };
    const x = action("×"); x.onclick = close; head.append(title, copy, save, importImage, x);
    const tools = document.createElement("div"); Object.assign(tools.style, { display: "flex", alignItems: "center", gap: "6px", padding: "9px 14px", borderBottom: "1px solid #2c2932", background: "rgba(9,8,13,.68)" });
    for (const token of FILTER_TOKENS) { const filter = action(token || "ALL", token === activeToken ? "#ff4ab8" : "#35d7ff"); filter.dataset.recipeFilter = token; filter.onclick = () => { activeToken = token; for (const item of tools.querySelectorAll("[data-recipe-filter]")) item.style.borderColor = item.dataset.recipeFilter === activeToken ? "#ff4ab8" : "#35d7ffaa"; render(); }; tools.append(filter); }
    const status = document.createElement("span"); status.dataset.catalogStatus = ""; status.textContent = "Ready"; Object.assign(status.style, { marginLeft: "auto", color: "#85808d", font: "11px Segoe UI,Arial", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }); tools.append(status);
    const list = document.createElement("div"); list.dataset.recipes = ""; Object.assign(list.style, { flex: "1", overflow: "auto", padding: "14px", display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(230px,1fr))", gap: "12px", alignContent: "start" }); panel.append(head, tools, list); root.append(panel); document.body.append(root); root.addEventListener("pointerdown", e => { if (e.target === root) close(); }); await load();
}

app.registerExtension({
    name: "SickOllie.SOS.RecipeLibrary",
    menuCommands: [{ path: ["Sick Ollie"], commands: ["solo.openRecipeCatalog"] }],
    commands: [{ id: "solo.openRecipeCatalog", label: "Open SOS Recipe Library", icon: "pi pi-book", function: openRecipes }],
    async setup() {
        registerSoloHubItem({ id: "recipes", label: "Recipe Library", description: "Save, compare, import, and safely apply Studio prompt recipes.", color: "#ff42bd", open: openRecipes });
        if (!window.__soPromptRecipeSaveListener) {
            window.__soPromptRecipeSaveListener = async event => {
                try { await saveCurrentStudioRecipe(event?.detail?.defaultName || "New prompt recipe", { previewData: event?.detail?.previewData || null }); }
                catch (error) { alert(error.message || "Could not save the Studio prompt recipe."); }
            };
            window.addEventListener("sickollie:save-studio-recipe", window.__soPromptRecipeSaveListener);
        }
    },
    beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "SOOutputBuilderSaveStudio") return;
        const originalMenu = nodeType.prototype.getExtraMenuOptions;
        nodeType.prototype.getExtraMenuOptions = function (_, options) {
            const result = originalMenu?.apply(this, arguments);
            options.unshift({ content: "📚 Open SOS Recipe Library", callback: () => openRecipes() });
            return result;
        };
    },
});
export { openRecipes, saveCurrentStudioRecipe };
