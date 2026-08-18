import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";
import { registerSoloHubItem } from "./solo_hub.js";
const LIBRARY_HEADER_URL = new URL("./solo_hub_assets/LoRALibraryHeader.png", import.meta.url).href;
const LIBRARY_BACKGROUND_URL = new URL("./solo_hub_assets/LoRALibraryBackground.webp", import.meta.url).href;

const API = "/sickollie/library-review";
const STYLE_URL = new URL("./solo_library_review.css", import.meta.url).href;
const ALL_FOLDERS = "[All folders]";
const LOADER_TYPES = ["SOLoaderCoreEngineStudio", "SOLoaderCoreEngine"];
const PROMPT_TYPE = "SOPromptLogEngineStudio";
const GENERATION_TYPE = "SOGenerationPipelineStudio";
const AUTO_FIRST_KEY = "sickollie.library.autoFirstImage";
const YEARBOOK_PROMPT_KEY = "sickollie.library.yearbookPrompt";
const DEFAULT_YEARBOOK_PROMPT = "A clean yearbook portrait of NAME, centered head and shoulders, looking directly at the camera, calm natural expression, simple neutral background, even soft studio light, consistent framing.";

let root = null;
let assets = [];
let folderScope = ALL_FOLDERS;
let epochFilter = "";
let statusFilter = "";
let thumbnailFilter = "";
let sortMode = "recent";
let civitaiFilling = false;
let yearbook = null;
let yearbookRunSerial = 0;
let lastPreviewKey = "";
let lastPreviewAt = 0;
let galleryPage = 0;
let liveFolders = [];
let styleReady = null;
let catalogRefreshTimer = null;

function ensureStyle() {
    if (styleReady) return styleReady;
    const link = document.querySelector(`link[data-so-lib-style="${STYLE_URL}"]`) || document.createElement("link");
    if (!link.parentNode) {
        link.rel = "stylesheet"; link.href = STYLE_URL; link.dataset.soLibStyle = STYLE_URL;
        document.head.append(link);
    }
    styleReady = new Promise(resolve => {
        if (link.sheet) { resolve(); return; }
        link.addEventListener("load", resolve, { once: true });
        // A failed stylesheet should not prevent the user from opening the hub.
        link.addEventListener("error", resolve, { once: true });
    });
    return styleReady;
}

async function request(path, options = {}) {
    const init = { ...options, headers: { ...(options.headers || {}) } };
    if (init.body !== undefined && !(init.body instanceof FormData) && typeof init.body !== "string") {
        init.headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(init.body);
    } else if (typeof init.body === "string") {
        init.headers["Content-Type"] = init.headers["Content-Type"] || "application/json";
    }
    const response = await fetch(`${API}${path}`, init);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || payload.ok === false) throw new Error(payload.error || `HTTP ${response.status}`);
    return payload;
}

function action(label, tone = "#48e8ee", extra = "") {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = label; button.className = `so-lib-button${extra ? ` ${extra}` : ""}`;
    button.style.setProperty("--tone", tone);
    return button;
}

function selectControl(values, current, change) {
    const select = document.createElement("select"); select.className = "so-lib-select";
    for (const [value, label] of values) {
        const option = document.createElement("option"); option.value = value; option.textContent = label; select.append(option);
    }
    select.value = current; select.onchange = () => change(select.value);
    return select;
}

function setFeedback(message, tone = "#69e49a") {
    const field = root?.querySelector("[data-review-status]");
    if (field) { field.textContent = message; field.style.color = tone; }
}
function updateYearbookProgress(message = "") { const field = root?.querySelector("[data-yearbook-progress]"); if (!field || !yearbook) return; const done = yearbook.index, total = yearbook.items.length; field.hidden = false; field.style.setProperty("--progress", `${Math.min(100, Math.round(done / total * 100))}%`); field.textContent = message || `YEARBOOK · ${done}/${total} processed · ${yearbook.captured} captured · ${yearbook.skipped} skipped · ${yearbook.items[done]?.model_name || "finishing…"}`; }

function formatBytes(value) {
    const size = Math.max(0, Number(value || 0));
    if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(2)} GB`;
    if (size >= 1024 ** 2) return `${Math.round(size / 1024 ** 2)} MB`;
    if (size >= 1024) return `${Math.round(size / 1024)} KB`;
    return `${size} B`;
}

function formatDate(value, fallback = "Never") {
    if (!value) return fallback;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
}

function statusTone(value) {
    return ({ favorite: "#f4ec51", keep: "#69e49a", reject: "#ff3eaf", retest: "#48e8ee" })[value] || "#8c8295";
}

function hasRenderableThumbnail(asset) {
    if (!asset?.thumbnail_ref) return false;
    return asset.thumbnail_available !== false;
}

function yearbookTargetMatches(asset, mode) {
    const source = String(asset?.thumbnail_source || "");
    const hasVisible = hasRenderableThumbnail(asset);
    if (mode === "missing") return !hasVisible;
    if (mode === "civitai") return hasVisible && source === "civitai-showcase";
    if (mode === "generated") return hasVisible && source.startsWith("generated") && !source.startsWith("generated:yearbook");
    if (mode === "yearbook") return hasVisible && source.startsWith("generated:yearbook");
    if (mode === "non_yearbook") return !hasVisible || (source !== "custom-upload" && !source.startsWith("generated:yearbook"));
    if (mode === "all") return true;
    return false;
}

function yearbookTargets(values, mode) {
    return values.filter(asset => yearbookTargetMatches(asset, mode));
}

function folderTreeAssets() {
    if (folderScope === ALL_FOLDERS) return [...assets];
    return assets.filter(asset => {
        const folder = String(asset.folder || "");
        return folder === folderScope || folder.startsWith(`${folderScope}/`);
    });
}

function isEditableTarget(target) {
    if (!(target instanceof Element)) return false;
    return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}

function isolateTextInput(container) {
    if (!container) return;
    for (const type of ["keydown", "keyup", "keypress"]) {
        container.addEventListener(type, event => {
            if (isEditableTarget(event.target)) event.stopPropagation();
        });
    }
    container.addEventListener("pointerdown", event => {
        if (isEditableTarget(event.target)) event.stopPropagation();
    });
}

function releaseFocusInside(container) {
    const active = document.activeElement;
    if (active && container?.contains(active) && typeof active.blur === "function") active.blur();
}

function thumbUrl(asset) {
    if (hasRenderableThumbnail(asset)) return `${API}/thumbnail/${encodeURIComponent(asset.thumbnail_ref)}?v=${encodeURIComponent(asset.thumbnail_updated_at || asset.updated_at || "")}`;
    // The grid never streams Civitai originals. Remote images are detail-only until
    // cached into the compact local thumbnail store.
    return "";
}

function sourceLabel(asset) {
    const source = String(asset.thumbnail_source || "");
    const hasVisible = hasRenderableThumbnail(asset);
    if (!hasVisible && asset.civitai_preview) return "CIVITAI READY";
    if (source.startsWith("generated:yearbook") && hasVisible) return "YEARBOOK";
    if (source.startsWith("generated") && hasVisible) return "GENERATED";
    if (source === "custom-upload" && hasVisible) return "CUSTOM";
    if (source === "civitai-showcase" && hasVisible) return "CIVITAI";
    if (source === "local-sidecar" && hasVisible) return "LOCAL PREVIEW";
    return hasVisible && source ? source.replaceAll("-", " ").toUpperCase() : "NO THUMBNAIL";
}

function autoFirstEnabled() {
    return localStorage.getItem(AUTO_FIRST_KEY) !== "false";
}

function folderChoices() {
    return [ALL_FOLDERS, ...liveFolders].sort((a, b) => {
        if (a === ALL_FOLDERS) return -1; if (b === ALL_FOLDERS) return 1; return a.localeCompare(b, undefined, { sensitivity: "base" });
    });
}

function epochChoices() {
    return [...new Set(assets.map(asset => asset.epoch).filter(value => Number.isInteger(value)))].sort((a, b) => a - b);
}

function visibleAssets() {
    const values = assets.filter(asset => {
        if (folderScope !== ALL_FOLDERS) {
            const folder = String(asset.folder || "");
            if (!(folder === folderScope || folder.startsWith(`${folderScope}/`))) return false;
        }
        if (epochFilter !== "" && Number(asset.epoch) !== Number(epochFilter)) return false;
        const uses = Number(asset.use_count || 0);
        if (statusFilter === "tested" && uses <= 0) return false;
        if (statusFilter === "untested" && uses > 0) return false;
        if (["keep", "favorite", "retest", "reject"].includes(statusFilter) && asset.review_state !== statusFilter) return false;
        const source = String(asset.thumbnail_source || "");
        const hasVisible = hasRenderableThumbnail(asset);
        if (thumbnailFilter === "missing" && hasVisible) return false;
        if (thumbnailFilter === "civitai" && !((hasVisible && source === "civitai-showcase") || (!hasVisible && asset.civitai_preview))) return false;
        if (thumbnailFilter === "generated" && !(hasVisible && source.startsWith("generated"))) return false;
        if (thumbnailFilter === "custom" && !(hasVisible && source === "custom-upload")) return false;
        if (thumbnailFilter === "local" && !(hasVisible && source === "local-sidecar")) return false;
        return true;
    });
    const byName = (a, b) => String(a.model_name || "").localeCompare(String(b.model_name || ""), undefined, { sensitivity: "base" });
    values.sort((a, b) => {
        if (sortMode === "name") return byName(a, b);
        if (sortMode === "most_used") return Number(b.use_count || 0) - Number(a.use_count || 0) || byName(a, b);
        if (sortMode === "least_used") return Number(a.use_count || 0) - Number(b.use_count || 0) || byName(a, b);
        if (sortMode === "last_used") return String(b.last_used_at || "").localeCompare(String(a.last_used_at || "")) || byName(a, b);
        return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    });
    return values;
}

function assetById(assetId) { return assets.find(asset => asset.asset_id === assetId); }

async function load() {
    [assets, liveFolders] = await Promise.all([request(`/assets?sort=recent`), request(`/folders`)]);
    if (folderScope !== ALL_FOLDERS && !folderChoices().includes(folderScope)) folderScope = ALL_FOLDERS;
    renderTools(); renderList();
}

function updateCachedThumbnail(assetId, thumbnail) {
    const asset = assets.find(item => item.asset_id === assetId);
    if (!asset || !thumbnail?.filename) return;
    asset.thumbnail_ref = thumbnail.filename;
    asset.thumbnail_available = true;
    asset.thumbnail_source = thumbnail.source || "generated:preview";
    asset.thumbnail_width = Number(thumbnail.width || 0);
    asset.thumbnail_height = Number(thumbnail.height || 0);
    asset.thumbnail_bytes = Number(thumbnail.byte_size || 0);
    asset.thumbnail_updated_at = thumbnail.updated_at || new Date().toISOString();
    renderList();
}

function refreshCatalogAfterYearbook() {
    clearTimeout(catalogRefreshTimer);
    catalogRefreshTimer = setTimeout(() => {
        catalogRefreshTimer = null;
        load().catch(error => setFeedback(error.message, "#ff78bd"));
    }, 450);
}

async function setReview(asset, next) {
    const previous = asset.review_state;
    const state = previous === next ? "none" : next;
    asset.review_state = state; renderList();
    try {
        await request("/review", { method: "POST", body: { asset_id: asset.asset_id, state } });
        setFeedback(`${asset.model_name}: ${state === "none" ? "rating cleared" : state}`);
        await load();
    } catch (error) {
        asset.review_state = previous; renderList(); setFeedback(error.message, "#ff78bd");
    }
}

async function quarantineRejected(button) {
    const rejected = assets.filter(asset => asset.review_state === "reject");
    if (!rejected.length) { alert("There are no rejected LoRAs in the live library."); return; }
    if (!confirm(`Move all ${rejected.length} rejected LoRA${rejected.length === 1 ? "" : "s"} and their recognized adjacent sidecars into the recoverable Sick Ollie quarantine folder?`)) return;
    button.disabled = true; button.textContent = "Quarantining…";
    try {
        const result = await request("/quarantine-rejected", { method: "POST", body: {} });
        await load();
        const suffix = result.skipped ? ` · ${result.skipped} skipped` : "";
        setFeedback(`Quarantined ${result.quarantined} rejected LoRA${result.quarantined === 1 ? "" : "s"}${suffix}.`);
        if (result.errors?.length) console.warn("[Sick Ollie LoRA Library] Rejected quarantine issues:", result.errors);
    } catch (error) {
        alert(error.message || "Could not quarantine rejected LoRAs.");
    } finally {
        button.disabled = false; button.textContent = "Quarantine rejected";
    }
}

function stateButtons(asset, compact = true) {
    const row = document.createElement("div"); row.className = compact ? "so-lib-state-row" : "so-lib-actions";
    for (const [label, value, tone] of [["✓ 3★", "keep", "#69e49a"], ["★ 4★", "favorite", "#f4ec51"], ["↻", "retest", "#48e8ee"], ["×", "reject", "#ff3eaf"]]) {
        const button = action(label, tone); button.title = ({ keep: "Keep · 3 stars", favorite: "Favorite · 4 stars", retest: "Retest", reject: "Reject" })[value];
        if (asset.review_state === value) button.classList.add("active");
        button.onclick = event => { event.stopPropagation(); setReview(asset, value); };
        row.append(button);
    }
    return row;
}

function renderList() {
    const list = root?.querySelector("[data-list]"); if (!list) return;
    list.replaceChildren();
    const visible = visibleAssets();
    const columns = Math.max(1, Math.floor((Math.max(210, list.clientWidth - 28) + 14) / 224));
    const galleryPageSize = columns * 4;
    const totalPages = Math.max(1, Math.ceil(visible.length / galleryPageSize));
    galleryPage = Math.min(galleryPage, totalPages - 1);
    const pageStart = galleryPage * galleryPageSize;
    const shown = visible.slice(pageStart, pageStart + galleryPageSize);
    const status = root.querySelector("[data-review-status]");
    if (status && !yearbook && !civitaiFilling) status.textContent = `${visible.length.toLocaleString()} shown · ${assets.length.toLocaleString()} cataloged`;
    if (!visible.length) {
        const empty = document.createElement("div"); empty.className = "so-lib-empty";
        empty.textContent = assets.length ? "No LoRAs match this folder, epoch, status, and thumbnail combination." : "Nothing cataloged yet. Scan your configured LoRA folders to build the visual library.";
        list.append(empty); return;
    }
    for (const asset of shown) {
        const card = document.createElement("article"); card.className = "so-lib-card"; card.onclick = () => openDetail(asset.asset_id);
        const preview = document.createElement("div"); preview.className = "so-lib-preview"; preview.style.cssText = "aspect-ratio:3 / 4;flex:0 0 auto!important;height:auto!important;min-height:0;";
        const url = thumbUrl(asset);
        if (url) {
            const image = document.createElement("img"); image.src = url; image.alt = asset.model_name || "LoRA thumbnail"; image.loading = "lazy"; image.referrerPolicy = "no-referrer";
            preview.append(image);
        } else {
            const placeholder = document.createElement("div"); placeholder.className = "so-lib-placeholder"; placeholder.textContent = asset.civitai_preview ? "Civitai image ready to cache" : "No local thumbnail yet"; preview.append(placeholder);
        }
        const badge = document.createElement("span"); badge.className = "so-lib-badge"; badge.textContent = sourceLabel(asset); badge.style.setProperty("--badge", hasRenderableThumbnail(asset) ? "#69e49a" : asset.civitai_preview ? "#9c62ff" : "#8c8295"); preview.append(badge);
        const uses = Number(asset.use_count || 0); const usage = document.createElement("span"); usage.className = "so-lib-usage-pill"; usage.textContent = uses ? `used ${uses}×` : "untested"; preview.append(usage);
        const body = document.createElement("div"); body.className = "so-lib-card-body"; body.style.cssText = "display:block!important;flex:0 0 auto!important;min-height:92px;";
        const name = document.createElement("strong"); name.className = "so-lib-card-name"; name.textContent = asset.model_name || asset.relative_lora;
        const loadButton = action("Load LoRA", "#69e49a", "so-lib-card-load"); loadButton.onclick = async event => { event.stopPropagation(); loadButton.disabled = true; loadButton.textContent = "Loading…"; try { await loadIntoLoader(asset.relative_lora); const strength = widget(findLoader(), "main_strength")?.value; setFeedback(`Loaded ${asset.model_name}${strength !== undefined ? ` · strength ${strength}` : ""} · fixed.`); loadButton.textContent = "Loaded ✓"; } catch (error) { alert(error.message); loadButton.disabled = false; loadButton.textContent = "Load LoRA"; } };
        body.append(name, loadButton, stateButtons(asset)); card.append(preview, body); list.append(card);
    }
    if (totalPages > 1) {
        const pager = document.createElement("div"); pager.className = "so-lib-pager";
        const prev = action("← Previous", "#48e8ee"); prev.disabled = galleryPage === 0; prev.onclick = () => { galleryPage--; renderList(); list.scrollTo({ top: 0 }); };
        const next = action("Next →", "#48e8ee"); next.disabled = galleryPage >= totalPages - 1; next.onclick = () => { galleryPage++; renderList(); list.scrollTo({ top: 0 }); };
        const label = document.createElement("span"); label.textContent = `Page ${galleryPage + 1} of ${totalPages} · ${visible.length.toLocaleString()} matching LoRAs`;
        pager.append(prev, label, next); list.append(pager);
    }
}

function openFolderPicker() {
    ensureStyle();
    const modal = document.createElement("div"); modal.className = "so-lib-modal";
    const card = document.createElement("section"); card.className = "so-lib-form-card";
    const title = document.createElement("h3"); title.textContent = "FOLDER SCOPE";
    const copy = document.createElement("p"); copy.textContent = "Choose a LoRA folder. A parent scope includes its nested folders, matching Loader Core's folder browser.";
    const search = document.createElement("input"); search.className = "so-lib-picker-search"; search.placeholder = "Find a folder…";
    const list = document.createElement("div"); list.className = "so-lib-picker-list";
    let browserFolder = folderScope === ALL_FOLDERS ? ALL_FOLDERS : folderScope;
    const draw = () => {
        list.replaceChildren(); const needle = search.value.trim().toLowerCase();
        const choices = needle ? folderChoices().filter(item => item !== ALL_FOLDERS && item.toLowerCase().includes(needle)) : folderChoices().filter(item => item === ALL_FOLDERS || (browserFolder === ALL_FOLDERS ? !item.includes("/") : item.startsWith(`${browserFolder}/`) && item.slice(browserFolder.length + 1).indexOf("/") < 0));
        if (!needle && browserFolder !== ALL_FOLDERS) { const select = document.createElement("button"); select.className = `so-lib-picker-item${browserFolder === folderScope ? " active" : ""}`; select.type = "button"; select.textContent = `✓ Use ${browserFolder} + nested folders`; select.onclick = () => { folderScope = browserFolder; modal.remove(); renderTools(); renderList(); }; list.append(select); }
        if (!needle && browserFolder !== ALL_FOLDERS) { const up = document.createElement("button"); up.className = "so-lib-picker-item"; up.type = "button"; up.textContent = "↑ Parent Folder"; up.onclick = () => { browserFolder = browserFolder.includes("/") ? browserFolder.slice(0, browserFolder.lastIndexOf("/")) : ALL_FOLDERS; draw(); }; list.append(up); }
        for (const value of choices) {
            const item = document.createElement("button"); item.className = `so-lib-picker-item${value === folderScope ? " active" : ""}`; item.type = "button";
            item.textContent = value === ALL_FOLDERS ? "⌂ LoRA Root · all folders" : `📁 ${value.split("/").pop()}`;
            item.onclick = () => { if (!needle && value !== ALL_FOLDERS && liveFolders.some(folder => folder.startsWith(`${value}/`))) { browserFolder = value; draw(); } else { folderScope = value; modal.remove(); renderTools(); renderList(); } };
            list.append(item);
        }
    };
    search.oninput = draw; modal.onclick = event => { if (event.target === modal) { releaseFocusInside(modal); modal.remove(); } };
    card.append(title, copy, search, list); modal.append(card); document.body.append(modal); isolateTextInput(modal); draw(); search.focus();
}

function renderTools() {
    const tools = root?.querySelector("[data-tools]"); if (!tools) return;
    tools.replaceChildren();
    const scope = document.createElement("button"); scope.className = "so-lib-scope"; scope.textContent = `📁 ${folderScope}`; scope.onclick = openFolderPicker;
    const epochs = selectControl([["", "All epochs"], ...epochChoices().map(value => [String(value), `Epoch ${value}`])], epochFilter, value => { epochFilter = value; renderList(); });
    const states = selectControl([["", "All ratings + test states"], ["tested", "Tested"], ["untested", "Never tested"], ["keep", "Keep · 3★"], ["favorite", "Favorite · 4★"], ["retest", "Retest"], ["reject", "Reject"]], statusFilter, value => { statusFilter = value; renderList(); });
    const thumbs = selectControl([["", "All thumbnails"], ["missing", "Missing thumbnail"], ["civitai", "Civitai"], ["generated", "Generated"], ["custom", "Custom"], ["local", "Local preview"]], thumbnailFilter, value => { thumbnailFilter = value; renderList(); });
    const sorts = selectControl([["recent", "Recently cataloged"], ["name", "Name"], ["most_used", "Most used"], ["least_used", "Least used"], ["last_used", "Recently used"]], sortMode, value => { sortMode = value; renderList(); });
    const auto = document.createElement("label"); auto.className = "so-lib-toggle";
    const check = document.createElement("input"); check.type = "checkbox"; check.checked = autoFirstEnabled(); check.onchange = () => { localStorage.setItem(AUTO_FIRST_KEY, check.checked ? "true" : "false"); setFeedback(check.checked ? "New LoRAs will use their first Preview image automatically." : "Automatic first-image thumbnails are off."); };
    const label = document.createElement("span"); label.textContent = "Auto first image"; auto.append(check, label);
    const refresh = action("Refresh", "#69e49a"); refresh.onclick = () => load().catch(error => setFeedback(error.message, "#ff78bd"));
    tools.append(scope, epochs, states, thumbs, sorts, auto, refresh);
}

function fact(label, value, title = "") {
    const item = document.createElement("div"); item.className = "so-lib-fact";
    const key = document.createElement("span"); key.textContent = label;
    const data = document.createElement("strong"); data.textContent = String(value ?? "—"); if (title) data.title = title;
    item.append(key, data); return item;
}

function section(title) {
    const item = document.createElement("section"); item.className = "so-lib-section";
    const heading = document.createElement("div"); heading.className = "so-lib-section-title"; heading.textContent = title;
    item.append(heading); return item;
}

async function reopenDetail(modal, assetId) {
    modal.remove(); await load(); await openDetail(assetId);
}

async function openDetail(assetId) {
    ensureStyle();
    const modal = document.createElement("div"); modal.className = "so-lib-modal";
    const card = document.createElement("section"); card.className = "so-lib-modal-card";
    const head = document.createElement("header"); head.className = "so-lib-modal-head";
    const heading = document.createElement("strong"); heading.textContent = "Loading LoRA entry…";
    const close = action("×", "#48e8ee", "so-lib-icon"); close.onclick = () => { releaseFocusInside(modal); modal.remove(); }; head.append(heading, close);
    const loading = document.createElement("div"); loading.className = "so-lib-empty"; loading.textContent = "Reading triggers, usage, thumbnail provenance, and Civitai sidecars…";
    card.append(head, loading); modal.append(card); document.body.append(modal); isolateTextInput(modal); modal.onclick = event => { if (event.target === modal) { releaseFocusInside(modal); modal.remove(); } };
    let detail;
    try { detail = await request(`/asset/${encodeURIComponent(assetId)}`); }
    catch (error) { loading.textContent = error.message; return; }
    heading.textContent = detail.model_name || detail.relative_lora;
    loading.remove();
    const body = document.createElement("div"); body.className = "so-lib-detail";
    const media = document.createElement("div");
    const main = document.createElement("img"); main.className = "so-lib-main-image"; main.alt = detail.model_name || "LoRA image"; main.referrerPolicy = "no-referrer";
    const localUrl = detail.thumbnail?.filename ? `${API}/thumbnail/${encodeURIComponent(detail.thumbnail.filename)}?v=${encodeURIComponent(detail.thumbnail.updated_at || "")}` : "";
    const remoteImages = Array.isArray(detail.remote_metadata?.images) ? detail.remote_metadata.images : [];
    let selectedRemote = "";
    const initialImage = localUrl || remoteImages[0] || "";
    if (initialImage) main.src = initialImage;
    const showcase = document.createElement("div"); showcase.className = "so-lib-showcase";
    if (localUrl) {
        const local = document.createElement("img"); local.src = localUrl; local.alt = "Current local thumbnail"; local.className = "active";
        local.onclick = () => { selectedRemote = ""; main.src = localUrl; for (const image of showcase.querySelectorAll("img")) image.classList.toggle("active", image === local); };
        showcase.append(local);
    }
    for (const url of remoteImages) {
        const image = document.createElement("img"); image.src = url; image.alt = "Civitai showcase"; image.loading = "lazy"; image.referrerPolicy = "no-referrer";
        image.onclick = () => { selectedRemote = url; main.src = url; for (const item of showcase.querySelectorAll("img")) item.classList.toggle("active", item === image); };
        showcase.append(image);
    }
    const mediaActions = document.createElement("div"); mediaActions.className = "so-lib-actions"; mediaActions.style.marginTop = "9px";
    const upload = action("Set custom image", "#69e49a"); upload.onclick = () => {
        const picker = document.createElement("input"); picker.type = "file"; picker.accept = "image/png,image/jpeg,image/webp";
        picker.onchange = async () => { const file = picker.files?.[0]; if (!file) return; upload.disabled = true; try { const form = new FormData(); form.append("file", file); await request(`/thumbnail/upload/${encodeURIComponent(assetId)}`, { method: "POST", body: form }); await reopenDetail(modal, assetId); } catch (error) { alert(error.message); upload.disabled = false; } };
        picker.click();
    };
    const useCiv = action("Use selected Civitai image", "#9c62ff"); useCiv.disabled = !remoteImages.length; useCiv.onclick = async () => { const url = selectedRemote || remoteImages[0]; if (!url) return; useCiv.disabled = true; try { await request(`/thumbnail/cache-civitai/${encodeURIComponent(assetId)}`, { method: "POST", body: { url } }); await reopenDetail(modal, assetId); } catch (error) { alert(error.message); useCiv.disabled = false; } };
    const clearThumb = action("Clear local default", "#ff3eaf"); clearThumb.disabled = !detail.thumbnail; clearThumb.onclick = async () => { if (!confirm("Clear this local default thumbnail? The LoRA and Civitai showcase are untouched.")) return; await request(`/thumbnail/${encodeURIComponent(assetId)}`, { method: "DELETE" }); await reopenDetail(modal, assetId); };
    mediaActions.append(upload, useCiv, clearThumb); media.append(main, showcase, mediaActions);

    const info = document.createElement("div");
    const actions = section("ENTRY ACTIONS");
    const actionRow = document.createElement("div"); actionRow.className = "so-lib-actions";
    const loadButton = action("Load LoRA", "#69e49a"); loadButton.onclick = async () => { loadButton.disabled = true; loadButton.textContent = "Loading through Loader Core…"; try { await loadIntoLoader(detail.relative_lora); const strength = widget(findLoader(), "main_strength")?.value; setFeedback(`Loaded ${detail.model_name}${strength !== undefined ? ` · strength ${strength}` : ""} · fixed.`); releaseFocusInside(modal); modal.remove(); } catch (error) { alert(error.message); loadButton.disabled = false; loadButton.textContent = "Load LoRA"; } };
    const refreshCiv = action("Refresh Civitai", "#9c62ff"); refreshCiv.onclick = async () => { refreshCiv.disabled = true; refreshCiv.textContent = "Reading exact hash…"; try { await request(`/civitai/${encodeURIComponent(assetId)}`, { method: "POST", body: {} }); await reopenDetail(modal, assetId); } catch (error) { alert(error.message); refreshCiv.disabled = false; refreshCiv.textContent = "Refresh Civitai"; } };
    const civPage = civitaiPage(detail);
    const openCiv = action("Open Civitai", "#48e8ee"); openCiv.disabled = !civPage; openCiv.onclick = () => { if (!civPage) return; const opened = window.open(civPage, "_blank", "noopener,noreferrer"); if (opened) opened.opener = null; };
    const quarantine = action("Quarantine file", "#ff3eaf"); quarantine.onclick = async () => { if (!confirm(`Move ${detail.model_name} and its adjacent sidecars into the recoverable Sick Ollie quarantine folder?`)) return; try { const result = await request("/quarantine", { method: "POST", body: { asset_id: assetId } }); setFeedback(`Moved to ${result.quarantine_path}`); modal.remove(); await load(); } catch (error) { alert(error.message); } };
    actionRow.append(loadButton, refreshCiv, openCiv, quarantine); actions.append(actionRow, stateButtons({ ...detail, review_state: detail.review?.state || "none" }, false));

    const stats = section("USAGE + IDENTITY");
    const facts = document.createElement("div"); facts.className = "so-lib-facts";
    facts.append(
        fact("Uses", detail.usage?.use_count || 0), fact("First used", formatDate(detail.first_used_at)), fact("Last used", formatDate(detail.usage?.last_used_at)),
        fact("Epoch", detail.epoch ?? "—"), fact("Size", formatBytes(detail.size)), fact("Thumbnail", detail.thumbnail ? `${formatBytes(detail.thumbnail.byte_size)} · ${detail.thumbnail.width}×${detail.thumbnail.height}` : remoteImages.length ? "Civitai live" : "Missing"),
        fact("Folder", detail.folder || "[Root]", detail.folder || ""), fact("Base model", detail.remote_metadata?.base_model || "—"), fact("Creator", detail.remote_metadata?.creator || "—"),
    );
    const path = document.createElement("div"); path.className = "so-lib-detail-path"; path.style.marginTop = "9px"; path.textContent = detail.current_path;
    stats.append(facts, path);

    const triggers = section("DETECTED TRIGGERS");
    const chips = document.createElement("div"); chips.className = "so-lib-chips";
    const triggerValues = (detail.triggers || []).length ? detail.triggers : (detail.remote_metadata?.trained_words || []).map(raw_text => ({ raw_text, source: "civitai" }));
    for (const trigger of triggerValues) { const chip = document.createElement("span"); chip.className = "so-lib-chip"; chip.textContent = `${trigger.raw_text || trigger.clean_text}${trigger.source ? ` · ${trigger.source}` : ""}`; chips.append(chip); }
    if (!triggerValues.length) { const none = document.createElement("span"); none.style.color = "#8f8498"; none.textContent = "No explicit activation phrase detected."; chips.append(none); }
    triggers.append(chips);

    const history = section("RECENT GENERATED OUTPUTS");
    const historyList = document.createElement("div"); historyList.className = "so-lib-history";
    for (const event of detail.usage_events || []) { const row = document.createElement("div"); row.className = "so-lib-history-row"; const date = document.createElement("b"); date.textContent = formatDate(event.used_at); const output = document.createElement("div"); output.textContent = event.output_path || "Generation completed before output tracking"; output.title = output.textContent; row.append(date, output); historyList.append(row); }
    if (!(detail.usage_events || []).length) historyList.textContent = "No new per-output history yet. Existing aggregate use counts are preserved.";
    history.append(historyList);
    info.append(actions, stats, triggers, history); body.append(media, info); card.append(body);
}

function widget(node, name) { return node?.widgets?.find(item => item.name === name); }
function setWidget(node, name, value) { const item = widget(node, name); if (!item) return false; item.value = value; try { item.callback?.(value); } catch (error) {} node.setDirtyCanvas?.(true, true); return true; }
function findLoader() { const nodes = app.graph?._nodes || []; return LOADER_TYPES.map(type => nodes.find(node => node.type === type)).find(Boolean); }
function activeLoaderLora() { return String(widget(findLoader(), "main_lora")?.value || "").trim(); }
function normalizedLoraPath(value) { return String(value || "").replace(/&(?:amp;)*#x2f;/gi, "/").replaceAll("\\", "/").replace(/^\/+/, "").toLocaleLowerCase(); }
function loaderFolderForLora(value) {
    const clean = String(value || "").replace(/&(?:amp;)*#x2f;/gi, "/").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
    const slash = clean.lastIndexOf("/");
    return slash >= 0 ? clean.slice(0, slash) : "[LoRA root only]";
}
function civitaiPage(detail) {
    const remote = detail?.remote_metadata || {};
    if (remote.model_page) return String(remote.model_page);
    const modelId = String(remote.model_id || detail?.civitai_model_id || "").trim();
    const versionId = String(remote.version_id || detail?.civitai_version_id || "").trim();
    if (!modelId) return "";
    return `https://civitai.com/models/${encodeURIComponent(modelId)}${versionId ? `?modelVersionId=${encodeURIComponent(versionId)}` : ""}`;
}

async function loadIntoLoader(lora) {
    const loader = findLoader();
    if (!loader) throw new Error("Add a Loader Core to the current canvas first.");
    if (!lora) throw new Error("This catalog entry is no longer inside a configured LoRA folder.");
    const liveLoras = await request("/lora-files");
    const canonical = liveLoras.find(value => normalizedLoraPath(value) === normalizedLoraPath(lora));
    if (!canonical) throw new Error("This LoRA is not present in ComfyUI's current live LoRA list. Rescan LoRA folders and try again.");
    setWidget(loader, "main_enabled", true);
    setWidget(loader, "control_after_generate", "fixed");
    setWidget(loader, "folder_name", loaderFolderForLora(canonical));
    setWidget(loader, "main_lora", canonical);
    app.canvas?.selectNode?.(loader); app.canvas?.centerOnNode?.(loader);
}

function captureNodeValues(node, names) { return names.map(name => ({ node, name, value: widget(node, name)?.value })).filter(item => widget(node, item.name)); }
function restoreNodeValues(values) { for (const item of values || []) setWidget(item.node, item.name, item.value); }

function clearYearbookTimers(run) {
    for (const timer of run?.timers || []) clearTimeout(timer);
    if (run?.timers) run.timers.clear();
}

function scheduleYearbook(run, callback, delay) {
    if (!run || run.stopped || yearbook !== run) return null;
    const timer = setTimeout(() => {
        run.timers?.delete(timer);
        if (!run.stopped && yearbook === run) callback();
    }, delay);
    run.timers?.add(timer);
    return timer;
}

async function interruptYearbookExecution(run, force = false) {
    if (!run || (run.interruptRequested && !force)) return;
    run.interruptRequested = true;
    try {
        if (typeof api?.interrupt === "function") await api.interrupt();
        else await fetch("/interrupt", { method: "POST" });
    } catch (error) {
        console.warn("[Sick Ollie Yearbook] Could not interrupt current execution", error);
    }
}

function restoreYearbookValues(run) {
    if (!run || run.restored) return;
    run.restored = true;
    restoreNodeValues(run.originals);
}

function stopYearbook(completed = false) {
    if (!yearbook) return;
    const previous = yearbook;
    previous.stopped = true;
    clearYearbookTimers(previous);
    yearbook = null;
    if (!completed && previous.queueStarted) void interruptYearbookExecution(previous);
    const restore = () => restoreYearbookValues(previous);
    if (previous.queuePromise) Promise.resolve(previous.queuePromise).then(restore, restore);
    else restore();
    const button = root?.querySelector("[data-yearbook]"); if (button) { button.textContent = "Yearbook run"; button.classList.remove("active"); }
    setFeedback(completed ? `Yearbook complete · ${previous.captured} captured${previous.skipped ? ` · ${previous.skipped} skipped` : ""}.` : `Yearbook stopped · ${previous.captured} captured · ${previous.skipped} skipped.`, completed && previous.skipped === 0 ? "#69e49a" : "#f4ec51");
    const field = root?.querySelector("[data-yearbook-progress]"); if (field) { field.hidden = false; field.style.setProperty("--progress", `${Math.min(100, Math.round(previous.index / previous.items.length * 100))}%`); field.textContent = completed ? `YEARBOOK COMPLETE · ${previous.captured} captured · ${previous.skipped} skipped` : `YEARBOOK STOPPED · ${previous.captured} captured · ${previous.skipped} skipped`; }
    if (completed) refreshCatalogAfterYearbook();
}

function setYearbookCurrent() {
    const run = yearbook;
    if (!run || run.stopped) return;
    const item = run.items[run.index];
    if (!item) { stopYearbook(true); return; }
    const available = Array.isArray(run.liveLoras) ? run.liveLoras.map(String) : [];
    const canonicalLora = available.find(value => normalizedLoraPath(value) === normalizedLoraPath(item.relative_lora));
    if (!canonicalLora) {
        console.warn("[Sick Ollie Yearbook] Catalog path was not present in ComfyUI's live LoRA list", item.relative_lora);
        run.skipped += 1;
        run.index += 1;
        updateYearbookProgress(`YEARBOOK · skipped path absent from Loader Core: ${item.relative_lora}`);
        scheduleYearbook(run, setYearbookCurrent, 0);
        return;
    }
    const loraPath = canonicalLora;
    updateYearbookProgress();
    scheduleYearbook(run, () => {
        setWidget(run.loader, "main_lora", loraPath);
        const strength = widget(run.loader, "main_strength")?.value;
        console.info(`[Sick Ollie Yearbook] Prepared ${run.index + 1}/${run.items.length}`, { lora: loraPath, strength });
        setFeedback(`Yearbook ${run.index + 1}/${run.items.length} · ${item.model_name}${strength !== undefined ? ` · strength ${strength}` : ""}`, "#48e8ee");
        if (!run.autoQueue) return;
        scheduleYearbook(run, () => {
            if (typeof app.queuePrompt !== "function") {
                updateYearbookProgress("YEARBOOK ERROR · This ComfyUI build does not expose automatic queueing.");
                stopYearbook(false);
                return;
            }
            console.info("[Sick Ollie Yearbook] Queueing prompt");
            run.queueStarted = true;
            let queued;
            try { queued = app.queuePrompt(0, 1); }
            catch (error) { updateYearbookProgress(`YEARBOOK ERROR · ${error.message}`); stopYearbook(false); return; }
            run.queuePromise = Promise.resolve(queued);
            run.queuePromise.then(
                () => { if (run.stopped) void interruptYearbookExecution(run, true); },
                error => { if (!run.stopped && yearbook === run) { updateYearbookProgress(`YEARBOOK ERROR · ${error.message}`); stopYearbook(false); } },
            );
        }, 140);
    }, 120);
}

function shuffled(values) {
    const result = [...values];
    for (let index = result.length - 1; index > 0; index--) { const other = Math.floor(Math.random() * (index + 1)); [result[index], result[other]] = [result[other], result[index]]; }
    return result;
}

function openYearbookDialog() {
    if (yearbook) { if (confirm("Stop the active yearbook run? The current Yearbook generation will be interrupted and no next item will be queued.")) stopYearbook(false); return; }
    const visible = visibleAssets().filter(asset => asset.relative_lora);
    if (!visible.length) { alert("The current filters contain no loadable LoRAs."); return; }
    const loader = findLoader(); const prompt = (app.graph?._nodes || []).find(node => node.type === PROMPT_TYPE); const generation = (app.graph?._nodes || []).find(node => node.type === GENERATION_TYPE);
    if (!loader || !prompt || !generation) { alert("Studio Loader Core, Prompt Core, and Generation Core must be on the current canvas for a yearbook run."); return; }
    const modal = document.createElement("div"); modal.className = "so-lib-modal";
    const card = document.createElement("section"); card.className = "so-lib-form-card";
    const title = document.createElement("h3"); title.textContent = "YEARBOOK THUMBNAIL RUN";
    const currentStrength = widget(loader, "main_strength")?.value;
    const copy = document.createElement("p"); copy.textContent = `${visible.length.toLocaleString()} LoRAs are in the filtered scope. Choose exactly which thumbnail source Yearbook should fill or replace. The runner shuffles them, keeps your current Loader strength${currentStrength !== undefined ? ` (${currentStrength})` : ""}, captures Preview Core's first displayed image, and restores only the temporary Yearbook prompt/resolution values afterward.`;
    const textarea = document.createElement("textarea"); textarea.className = "so-lib-textarea"; textarea.value = localStorage.getItem(YEARBOOK_PROMPT_KEY) || DEFAULT_YEARBOOK_PROMPT;
    const modeCounts = Object.fromEntries(["missing", "civitai", "generated", "non_yearbook", "yearbook", "all"].map(mode => [mode, yearbookTargets(visible, mode).length]));
    const modeSelect = selectControl([
        ["missing", `Fill missing thumbnails · ${modeCounts.missing}`],
        ["civitai", `Replace Civitai thumbnails · ${modeCounts.civitai}`],
        ["generated", `Replace generated non-Yearbook thumbnails · ${modeCounts.generated}`],
        ["non_yearbook", `Standardize non-Yearbook thumbnails · ${modeCounts.non_yearbook}`],
        ["yearbook", `Rebuild existing Yearbook thumbnails · ${modeCounts.yearbook}`],
        ["all", `Replace every thumbnail · ${modeCounts.all}`],
    ], "missing", () => {});
    const modeCopy = document.createElement("p"); modeCopy.textContent = "Standardize non-Yearbook fills missing entries and replaces Civitai, generated, local-preview, and other automatic thumbnails while preserving custom images and existing Yearbook thumbnails.";
    const auto = document.createElement("label"); auto.className = "so-lib-toggle"; const autoCheck = document.createElement("input"); autoCheck.type = "checkbox"; autoCheck.checked = true; auto.append(autoCheck, document.createTextNode("Queue each next generation automatically"));
    const buttons = document.createElement("div"); buttons.className = "so-lib-form-actions"; const cancel = action("Cancel", "#8c8295"); const start = action("Start shuffled run", "#f4ec51");
    const closeModal = () => { releaseFocusInside(modal); modal.remove(); };
    cancel.onclick = closeModal; start.onclick = async () => {
        const targetMode = modeSelect.value;
        const items = yearbookTargets(visible, targetMode);
        if (!items.length) { alert("No LoRAs in this filtered scope match the selected Yearbook target."); return; }
        const promptText = textarea.value.trim(); if (!promptText) { alert("Enter the prompt to use for the yearbook run."); return; }
        start.disabled = true; start.textContent = "Reading live LoRA list…";
        let liveLoras;
        try { liveLoras = await request("/lora-files"); }
        catch (error) { alert(`Could not read ComfyUI's live LoRA list: ${error.message}`); start.disabled = false; start.textContent = "Start shuffled run"; return; }
        localStorage.setItem(YEARBOOK_PROMPT_KEY, promptText);
        const originals = [
            ...captureNodeValues(loader, ["main_enabled", "main_lora", "control_after_generate"]),
            ...captureNodeValues(prompt, ["prompt_source", "manual_prompt"]),
            ...captureNodeValues(generation, ["resolution_mode", "aspect_preset", "megapixels"]),
        ];
        setWidget(loader, "main_enabled", true); setWidget(loader, "control_after_generate", "fixed");
        setWidget(prompt, "prompt_source", "manual"); setWidget(prompt, "manual_prompt", promptText);
        setWidget(generation, "resolution_mode", "preset"); setWidget(generation, "aspect_preset", "3:4 (Portrait Standard)"); setWidget(generation, "megapixels", 1.0);
        const run = { runId: ++yearbookRunSerial, items: shuffled(items), liveLoras, index: 0, captured: 0, skipped: 0, replace: targetMode !== "missing", targetMode, autoQueue: autoCheck.checked, loader, prompt, originals, timers: new Set(), stopped: false, restored: false, queuePromise: null, queueStarted: false, interruptRequested: false };
        yearbook = run;
        textarea.blur(); closeModal(); const button = root?.querySelector("[data-yearbook]"); if (button) { button.textContent = "Stop yearbook"; button.classList.add("active"); }
        updateYearbookProgress(); scheduleYearbook(run, setYearbookCurrent, 180);
    };
    buttons.append(cancel, start); card.append(title, copy, textarea, modeSelect, modeCopy, auto, buttons); modal.append(card); document.body.append(modal); isolateTextInput(modal); modal.onclick = event => { if (event.target === modal) closeModal(); }; textarea.focus();
}

function catalogMaintenanceScope(scope) {
    if (scope === "all") return [...assets];
    if (scope === "folder") return folderTreeAssets();
    return visibleAssets();
}

function openCatalogTools() {
    if (yearbook || civitaiFilling) { alert("Stop the active Yearbook/Civitai operation before changing catalog storage."); return; }
    const filtered = visibleAssets();
    const folderItems = folderTreeAssets();
    const scopes = [["filtered", `Current filtered results · ${filtered.length}`]];
    if (folderScope !== ALL_FOLDERS) scopes.push(["folder", `Selected folder tree: ${folderScope} · ${folderItems.length}`]);
    scopes.push(["all", "Entire LoRA Library catalog · all records"]);
    const modal = document.createElement("div"); modal.className = "so-lib-modal";
    const card = document.createElement("section"); card.className = "so-lib-form-card";
    const title = document.createElement("h3"); title.textContent = "CATALOG MAINTENANCE";
    const copy = document.createElement("p"); copy.textContent = "Emergency reset tools for the LoRA Library index. LoRA files, adjacent sidecars, Recipe Catalog entries, saved filters, and shared token settings are never deleted.";
    const scopeSelect = selectControl(scopes, filtered.length ? "filtered" : (folderScope !== ALL_FOLDERS && folderItems.length ? "folder" : "all"), () => {});
    const note = document.createElement("p"); note.textContent = "Clear thumbnails removes only compact cached WebPs. Purge + rebuild erases Library review state, usage history, trigger cache, Civitai metadata, thumbnail records, and relocation history for the chosen LoRAs, then rescans the real files from disk.";
    const buttons = document.createElement("div"); buttons.className = "so-lib-form-actions";
    const cancel = action("Cancel", "#8c8295");
    const clear = action("Clear thumbnails", "#9c62ff");
    const purge = action("Purge + rebuild", "#ff3eaf");
    const closeModal = () => { releaseFocusInside(modal); modal.remove(); };
    cancel.onclick = closeModal;
    clear.onclick = async () => {
        const scope = scopeSelect.value; const selected = catalogMaintenanceScope(scope).filter(asset => asset.asset_id);
        if (scope !== "all" && !selected.length) { alert("That scope contains no catalog entries."); return; }
        const clearLabel = scope === "all" ? "all cached LoRA thumbnails" : `${selected.length.toLocaleString()} cached LoRA thumbnail${selected.length === 1 ? "" : "s"}`;
        if (!confirm(`Clear ${clearLabel}? Ratings, usage history, Civitai metadata, and LoRA files remain untouched.`)) return;
        clear.disabled = true; purge.disabled = true;
        try {
            const result = await request("/maintenance", { method: "POST", body: { action: "clear_thumbnails", asset_ids: selected.map(asset => asset.asset_id), all_assets: scope === "all" } });
            closeModal(); await load(); setFeedback(`Thumbnail cache cleared · ${result.cleared.toLocaleString()} record${result.cleared === 1 ? "" : "s"} · ${result.files_deleted.toLocaleString()} file${result.files_deleted === 1 ? "" : "s"} removed.`, "#9c62ff");
        } catch (error) { alert(error.message); clear.disabled = false; purge.disabled = false; }
    };
    purge.onclick = async () => {
        const scope = scopeSelect.value; const selected = catalogMaintenanceScope(scope).filter(asset => asset.asset_id);
        if (scope !== "all" && !selected.length) { alert("That scope contains no catalog entries."); return; }
        const label = scope === "all" ? "the ENTIRE LoRA Library catalog, including stale records" : `${selected.length.toLocaleString()} LoRA catalog entr${selected.length === 1 ? "y" : "ies"}`;
        if (!confirm(`Purge + rebuild ${label}?\n\nThis resets Library ratings/status, tested/use history, trigger cache, Civitai metadata, cached thumbnails, and relocation history in this scope. The actual LoRA files, sidecars, Recipe Catalog, saved filters, and shared token settings are untouched.`)) return;
        clear.disabled = true; purge.disabled = true; purge.textContent = "Purging + rescanning…";
        try {
            const result = await request("/maintenance", { method: "POST", body: { action: "purge_rebuild", asset_ids: selected.map(asset => asset.asset_id), all_assets: scope === "all" } });
            closeModal(); await load(); setFeedback(`Catalog rebuilt · ${result.purged.toLocaleString()} purged · ${result.scanned.toLocaleString()} LoRAs rescanned · ${result.files_deleted.toLocaleString()} cached thumbnail${result.files_deleted === 1 ? "" : "s"} removed.`, "#69e49a");
        } catch (error) { alert(error.message); clear.disabled = false; purge.disabled = false; purge.textContent = "Purge + rebuild"; }
    };
    buttons.append(cancel, clear, purge); card.append(title, copy, scopeSelect, note, buttons); modal.append(card); document.body.append(modal); isolateTextInput(modal); modal.onclick = event => { if (event.target === modal) closeModal(); };
}

async function fillCivitai() {
    if (civitaiFilling) { civitaiFilling = false; setFeedback("Stopping Civitai fill after the current lookup…", "#f4ec51"); return; }
    const queue = visibleAssets().filter(asset => !hasRenderableThumbnail(asset));
    if (!queue.length) { setFeedback("Every visible entry already has a renderable local thumbnail."); return; }
    if (!confirm(`Create compact local Civitai thumbnails for ${queue.length.toLocaleString()} visible LoRA${queue.length === 1 ? "" : "s"}? Each image is downloaded once, converted to a 3:4 WebP, and overwrites any earlier cached Civitai thumbnail. Sidecars are used first; missing sidecars require reading each LoRA once for its SHA-256.`)) return;
    civitaiFilling = true; const button = root?.querySelector("[data-civitai-fill]"); if (button) button.textContent = "Stop Civitai fill";
    let found = 0; const failures = [];
    for (let index = 0; index < queue.length && civitaiFilling; index++) {
        const asset = queue[index]; setFeedback(`Civitai ${index + 1}/${queue.length} · ${asset.model_name}`, "#9c62ff");
        try {
            let images = asset.civitai_preview ? [asset.civitai_preview] : [];
            if (!images.length) { const result = await request(`/civitai/${encodeURIComponent(asset.asset_id)}`, { method: "POST", body: {} }); images = result.metadata?.images || []; }
            if (images.length) { await request(`/thumbnail/cache-civitai/${encodeURIComponent(asset.asset_id)}`, { method: "POST", body: { url: images[0] } }); found++; }
        }
        catch (error) { failures.push(`${asset.model_name}: ${error.message || error}`); }
    }
    civitaiFilling = false; if (button) button.textContent = "Fill from Civitai"; await load();
    if (failures.length) console.warn("[Sick Ollie LoRA Library] Civitai thumbnail failures", failures);
    setFeedback(`Civitai fill finished · ${found} compact local thumbnail${found === 1 ? "" : "s"} cached${failures.length ? ` · ${failures.length} failed (see console)` : ""}.`, failures.length ? "#f4ec51" : "#69e49a");
}

async function savePreviewThumbnail(image, { assetId = "", lora = "", replace = false, source = "generated:preview" } = {}) {
    return request("/thumbnail/from-preview", { method: "POST", body: { asset_id: assetId, lora, image, replace, source } });
}

function previewKey(image) { return `${image?.type || "temp"}/${image?.subfolder || ""}/${image?.filename || ""}`; }

async function handlePreviewExecuted(event) {
    const image = event?.detail?.previewData; const key = previewKey(image);
    const now = Date.now();
    if (!image?.filename || !key || (key === lastPreviewKey && now - lastPreviewAt < 800)) return;
    lastPreviewKey = key; lastPreviewAt = now;
    if (yearbook) {
        const item = yearbook.items[yearbook.index]; if (!item) return;
        try {
            const result = await savePreviewThumbnail(image, { assetId: item.asset_id, replace: yearbook.replace, source: "generated:yearbook" });
            if (!result.skipped) updateCachedThumbnail(item.asset_id, result.thumbnail);
            yearbook.captured += 1;
            yearbook.index += 1; setYearbookCurrent();
        } catch (error) { updateYearbookProgress(`YEARBOOK ERROR · ${item.model_name}: ${error.message}`); alert(`Yearbook thumbnail failed for ${item.model_name}: ${error.message}`); stopYearbook(false); }
        return;
    }
    if (!autoFirstEnabled()) return;
    const lora = activeLoaderLora(); if (!lora || lora === "[None]") return;
    try { const result = await savePreviewThumbnail(image, { lora, replace: false, source: "generated:auto-first" }); if (!result.skipped) { updateCachedThumbnail(result.asset_id, result.thumbnail); setFeedback(`Captured the first generated thumbnail for ${lora}.`); } }
    catch (error) { console.warn("[Sick Ollie LoRA Library] Auto thumbnail capture skipped", error); }
}

async function handleManualThumbnail(event) {
    const image = event?.detail?.previewData; const lora = activeLoaderLora();
    if (!image?.filename) { alert("Preview Core does not have a current image yet."); return; }
    if (!lora || lora === "[None]") { alert("Select an active main LoRA in Loader Core first."); return; }
    try { await savePreviewThumbnail(image, { lora, replace: true, source: "generated:manual-preview" }); await load(); setFeedback(`Set the current Preview image as ${lora}'s default thumbnail.`); }
    catch (error) { alert(error.message || "Could not set the LoRA thumbnail."); }
}

function closeReview() {
    civitaiFilling = false;
    if (yearbook) stopYearbook(false);
    for (const modal of document.querySelectorAll(".so-lib-modal")) {
        releaseFocusInside(modal);
        modal.remove();
    }
    releaseFocusInside(root);
    root?.remove();
    root = null;
}

async function openReview() {
    await ensureStyle();
    if (root) { root.querySelector(".so-lib-shell")?.focus(); return; }
    root = document.createElement("div"); root.className = "so-lib-overlay"; isolateTextInput(root);
    const panel = document.createElement("section"); panel.className = "so-lib-shell"; panel.tabIndex = -1; panel.style.setProperty("--so-lib-bg", `url(${LIBRARY_BACKGROUND_URL})`);
    const header = document.createElement("header"); header.className = "so-lib-header";
    const title = document.createElement("img"); title.className = "so-lib-title-image"; title.src = LIBRARY_HEADER_URL; title.alt = "Sick Ollie LoRA Library"; title.draggable = false;
    const status = document.createElement("span"); status.className = "so-lib-status"; status.dataset.reviewStatus = ""; status.textContent = "Visual catalog, test history, ratings, triggers, and compact thumbnails.";
    const scan = action("Scan LoRA folders", "#ff3eaf"); scan.onclick = async () => { scan.disabled = true; scan.textContent = "Scanning…"; try { const result = await request("/scan", { method: "POST", body: {} }); await load(); setFeedback(`Scanned ${result.scanned} LoRAs · ${result.thumbnails} local thumbnails · ${result.sidecars} Civitai sidecars.`); } catch (error) { setFeedback(error.message, "#ff78bd"); } finally { scan.disabled = false; scan.textContent = "Scan LoRA folders"; } };
    const civitai = action("Fill from Civitai", "#9c62ff"); civitai.dataset.civitaiFill = ""; civitai.onclick = fillCivitai;
    const quarantineRejectedButton = action("Quarantine rejected", "#ff3eaf"); quarantineRejectedButton.onclick = () => quarantineRejected(quarantineRejectedButton);
    const catalogToolsButton = action("Catalog tools", "#9c62ff"); catalogToolsButton.onclick = openCatalogTools;
    const yearbookButton = action(yearbook ? "Stop yearbook" : "Yearbook run", "#f4ec51"); yearbookButton.dataset.yearbook = ""; if (yearbook) yearbookButton.classList.add("active"); yearbookButton.onclick = openYearbookDialog;
    const x = action("×", "#48e8ee", "so-lib-icon"); x.onclick = closeReview;
    header.append(title, status, scan, civitai, quarantineRejectedButton, catalogToolsButton, yearbookButton, x);
    const progress = document.createElement("div"); progress.className = "so-lib-yearbook-progress"; progress.dataset.yearbookProgress = ""; progress.hidden = true;
    const tools = document.createElement("div"); tools.className = "so-lib-tools"; tools.dataset.tools = "";
    const list = document.createElement("div"); list.className = "so-lib-grid"; list.dataset.list = "";
    panel.append(header, progress, tools, list); root.append(panel); document.body.append(root); updateYearbookProgress();
    root.onclick = event => { if (event.target === root) closeReview(); };
    try { await load(); } catch (error) { setFeedback(error.message, "#ff78bd"); }
}

app.registerExtension({
    name: "SickOllie.SOS.LoRALibrary",
    setup() {
        registerSoloHubItem({ id: "library-review", label: "LoRA Library", description: "Browse thumbnails, triggers, usage, ratings, Civitai showcases, and yearbook runs.", color: "#2cecff", open: openReview });
        if (!window.__soLoRALibraryPreviewListener) {
            window.__soLoRALibraryPreviewListener = handlePreviewExecuted;
            window.addEventListener("sickollie:preview-executed", window.__soLoRALibraryPreviewListener);
        }
        if (!window.__soLoRAThumbnailManualListener) {
            window.__soLoRAThumbnailManualListener = handleManualThumbnail;
            window.addEventListener("sickollie:set-lora-thumbnail", window.__soLoRAThumbnailManualListener);
        }
    },
    menuCommands: [{ path: ["Sick Ollie"], commands: ["solo.openLoRALibrary"] }],
    commands: [{ id: "solo.openLoRALibrary", label: "Open SOS LoRA Library", function: openReview }],
});

export { openReview, loadIntoLoader };
