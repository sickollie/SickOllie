import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const API_ROOT = "/sickollie/solo-organizer/api/v1";
const STYLE_URL = new URL("./solo_lora_organizer.css", import.meta.url).href;
const BRANDING_URL = new URL("./solo_lora_organizer_assets/HeaderBrandingYellow.png", import.meta.url).href;
const MARK_URL = new URL("./solo_lora_organizer_assets/BrandMark.png", import.meta.url).href;
const TEXTURE_URL = new URL("./solo_lora_organizer_assets/HeaderTexture.png", import.meta.url).href;
const PAGE_SIZE = 250;

const state = {
  overlay: null,
  refs: {},
  settings: null,
  trash: null,
  rows: [],
  mode: "organizer",
  root: "",
  rules: {},
  jobId: "",
  selectedRowId: "",
  query: "",
  page: 0,
  polling: false,
};

function ensureStyle() {
  if (document.querySelector(`link[data-solo-style="${STYLE_URL}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_URL;
  link.dataset.soloStyle = STYLE_URL;
  document.head.appendChild(link);
}

async function request(path, options = {}) {
  const init = { method: options.method || "GET", headers: { ...(options.headers || {}) } };
  if (options.body !== undefined) {
    init.headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  const response = await api.fetchApi(`${API_ROOT}${path}`, init);
  let payload;
  try { payload = await response.json(); }
  catch { payload = { ok: false, error: `${response.status} ${response.statusText}` }; }
  if (!response.ok || !payload.ok) throw new Error(payload.error || `${response.status} ${response.statusText}`);
  return payload.data;
}

function q(selector) { return state.overlay?.querySelector(selector); }

function makeButton(label, color = "var(--solo-cyan)", filled = false) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `solo-button${filled ? " solo-filled" : ""}`;
  button.textContent = label;
  button.style.setProperty("--solo-button-color", color);
  return button;
}

function buildPanel() {
  if (state.overlay) return;
  ensureStyle();
  const overlay = document.createElement("div");
  overlay.className = "solo-overlay solo-lora-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="solo-shell" role="dialog" aria-modal="true" aria-label="SOS LoRA Organizer">
      <header class="solo-header">
        <img class="solo-branding" alt="SOS Sick Ollie LoRA Organizer">
        <div class="solo-header-meta">
          <span class="solo-pill" style="--solo-pill-color:var(--solo-violet)">ComfyUI native</span>
          <span class="solo-pill" style="--solo-pill-color:var(--solo-cyan)">v0.1.3</span>
          <button class="solo-icon-button solo-close" type="button" aria-label="Close">×</button>
        </div>
      </header>
      <main class="solo-body">
        <div class="solo-command-deck">
          <section class="solo-card" style="--solo-accent:var(--solo-pink)">
            <h2 class="solo-card-title">Organization rules</h2>
            <div class="solo-rules">
              <label class="solo-check"><input data-rule="rename_files" type="checkbox">Rename files (smart-clean)</label>
              <label class="solo-check"><input data-rule="organize_creators" type="checkbox">Organize into creator folders</label>
              <label class="solo-check"><input data-rule="organize_categories" type="checkbox">Organize into Civitai category folders</label>
              <label class="solo-check"><input data-rule="organize_base_models" type="checkbox">Organize into base model folders</label>
              <label class="solo-check"><input data-rule="group_one_off_creators" type="checkbox">Group one-off creators into Other</label>
              <label class="solo-check"><input data-rule="group_unidentified" type="checkbox">Group unidentified LoRAs into Uncharted</label>
              <label class="solo-check"><input data-rule="reprocess_existing_subfolders" type="checkbox">Reprocess existing subfolders</label>
            </div>
          </section>
          <section class="solo-card solo-library-card" style="--solo-accent:var(--solo-cyan)">
            <h2 class="solo-card-title">LoRA library</h2>
            <div class="solo-folder-row">
              <span class="solo-label">Source folder</span>
              <input class="solo-input solo-folder" type="text" spellcheck="false" aria-label="LoRA source folder">
              <button class="solo-button solo-browse" style="--solo-button-color:var(--solo-cyan)" type="button">Browse…</button>
            </div>
            <div class="solo-root-note">Organizer treats this folder as the library root. Run sorting from that root, not from inside an existing Base / Category folder.</div>
            <div class="solo-actions">
              <button class="solo-button solo-filled solo-scan" style="--solo-button-color:var(--solo-pink)" type="button">Scan Folder</button>
              <button class="solo-button solo-stop" style="--solo-button-color:var(--solo-red)" type="button" disabled>Stop Scan</button>
              <button class="solo-button solo-duplicates" style="--solo-button-color:var(--solo-violet)" type="button">Find Exact Duplicates</button>
              <button class="solo-button solo-cleanup" style="--solo-button-color:var(--solo-yellow)" type="button">Find Orphans / Empty Folders</button>
            </div>
            <div class="solo-progress-track"><div class="solo-progress-fill"></div></div>
            <div class="solo-status">Choose a LoRA library, then scan to build a dry-run preview.</div>
          </section>
        </div>
        <section class="solo-preview-head">
          <h2 class="solo-mode-title">Organizer Preview</h2>
          <span class="solo-mode-subtitle">Nothing moves until you review checked rows and confirm.</span>
          <input class="solo-search" type="search" placeholder="Filter preview…" aria-label="Filter preview">
          <button class="solo-button solo-copy" style="--solo-button-color:var(--solo-cyan)" type="button" disabled>Copy Info</button>
          <button class="solo-button solo-open-civitai" style="--solo-button-color:var(--solo-violet)" type="button" disabled>Open Civitai</button>
          <span class="solo-page-text"></span>
          <button class="solo-button solo-prev" style="--solo-button-color:var(--solo-muted)" type="button" disabled>‹</button>
          <button class="solo-button solo-next" style="--solo-button-color:var(--solo-muted)" type="button" disabled>›</button>
        </section>
        <section class="solo-grid-card"><div class="solo-table-wrap"><table class="solo-table"><colgroup></colgroup><thead></thead><tbody></tbody></table></div></section>
      </main>
      <footer class="solo-footer">
        <button class="solo-button solo-settings" style="--solo-button-color:var(--solo-violet)" type="button">Settings</button>
        <span class="solo-footer-message">Preview-first: review checked rows before any filesystem action.</span>
        <button class="solo-button solo-undo" style="--solo-button-color:var(--solo-cyan)" type="button" disabled>Undo Last</button>
        <button class="solo-button solo-filled solo-primary" style="--solo-button-color:var(--solo-pink)" type="button" disabled>Apply Selected</button>
      </footer>
    </section>
    <div class="solo-submodal" hidden>
      <section class="solo-modal-card" role="dialog" aria-modal="true">
        <h3 class="solo-modal-title"></h3>
        <p class="solo-modal-copy"></p>
        <div class="solo-modal-content"></div>
        <div class="solo-modal-actions"></div>
      </section>
    </div>`;
  overlay.querySelector(".solo-header").style.setProperty("--solo-header-texture", `url("${TEXTURE_URL}")`);
  overlay.querySelector(".solo-branding").src = BRANDING_URL;
  document.body.appendChild(overlay);
  state.overlay = overlay;
  state.refs = {
    folder: q(".solo-folder"), status: q(".solo-status"), progress: q(".solo-progress-fill"),
    scan: q(".solo-scan"), stop: q(".solo-stop"), duplicates: q(".solo-duplicates"), cleanup: q(".solo-cleanup"),
    browse: q(".solo-browse"), primary: q(".solo-primary"), undo: q(".solo-undo"), settings: q(".solo-settings"),
    copy: q(".solo-copy"), civitai: q(".solo-open-civitai"), search: q(".solo-search"),
    title: q(".solo-mode-title"), subtitle: q(".solo-mode-subtitle"), pageText: q(".solo-page-text"),
    prev: q(".solo-prev"), next: q(".solo-next"), footer: q(".solo-footer-message"),
    table: q(".solo-table"), columns: q(".solo-table colgroup"),
    thead: q(".solo-table thead"), tbody: q(".solo-table tbody"), modal: q(".solo-submodal"),
  };
  q(".solo-close").addEventListener("click", () => { overlay.hidden = true; });
  state.refs.scan.addEventListener("click", () => startScan("organizer"));
  state.refs.duplicates.addEventListener("click", () => startScan("duplicates"));
  state.refs.cleanup.addEventListener("click", () => startScan("cleanup"));
  state.refs.stop.addEventListener("click", stopScan);
  state.refs.browse.addEventListener("click", showBrowser);
  state.refs.primary.addEventListener("click", primaryAction);
  state.refs.undo.addEventListener("click", undoLast);
  state.refs.settings.addEventListener("click", showSettings);
  state.refs.copy.addEventListener("click", copySelected);
  state.refs.civitai.addEventListener("click", openCivitai);
  state.refs.search.addEventListener("input", () => { state.query = state.refs.search.value; state.page = 0; renderTable(); });
  state.refs.prev.addEventListener("click", () => { state.page = Math.max(0, state.page - 1); renderTable(); });
  state.refs.next.addEventListener("click", () => { state.page += 1; renderTable(); });
  q(".solo-rules").addEventListener("change", () => { state.rules = readRules(); });
  overlay.addEventListener("keydown", event => {
    if (event.key === "Escape" && state.refs.modal.hidden) overlay.hidden = true;
  });
}

function readRules() {
  const value = {};
  state.overlay.querySelectorAll("[data-rule]").forEach(input => { value[input.dataset.rule] = input.checked; });
  return value;
}

function writeRules(rules) {
  state.rules = { ...(rules || {}) };
  state.overlay.querySelectorAll("[data-rule]").forEach(input => { input.checked = Boolean(state.rules[input.dataset.rule]); });
}

function setStatus(message, footer = false) {
  state.refs.status.textContent = message;
  state.refs.status.title = message;
  if (footer) state.refs.footer.textContent = message;
}

function toast(message, severity = "info") {
  try {
    app.extensionManager?.toast?.add({ severity, summary: "SOS LoRA Organizer", detail: message, life: 4500 });
  } catch { /* Older frontend: footer/status already carry the message. */ }
}

function setBusy(busy, cancellable = false) {
  for (const element of [state.refs.scan, state.refs.duplicates, state.refs.cleanup, state.refs.browse]) element.disabled = busy;
  state.refs.stop.disabled = !busy || !cancellable;
  state.overlay.querySelectorAll("[data-rule]").forEach(input => { input.disabled = busy; });
  state.refs.folder.disabled = busy;
  state.refs.settings.disabled = busy;
  if (busy) {
    state.refs.primary.disabled = true;
    state.refs.undo.disabled = true;
  } else {
    state.refs.undo.disabled = state.mode !== "organizer" || !(state.settings?.undo_available);
    updateActionState();
  }
}

async function loadSettings() {
  const settings = await request("/settings");
  state.settings = settings;
  state.root = settings.last_folder || settings.lora_roots?.[0] || "";
  state.refs.folder.value = state.root;
  writeRules(settings.rules || {});
  state.refs.undo.disabled = !settings.undo_available;
  return settings;
}

async function saveBasicSettings() {
  state.root = state.refs.folder.value.trim();
  state.rules = readRules();
  state.settings = await request("/settings", {
    method: "POST",
    body: { last_folder: state.root, rules: state.rules },
  });
}

async function openOrganizer() {
  buildPanel();
  state.overlay.hidden = false;
  try {
    const status = await request("/status");
    state.settings = status.settings;
    state.trash = status.trash || null;
    state.root = status.settings.last_folder || status.settings.lora_roots?.[0] || "";
    state.refs.folder.value = state.root;
    writeRules(status.settings.rules || {});
    state.refs.undo.disabled = !status.settings.undo_available;
    updateActionState();
    if (!state.jobId && status.active_jobs?.length) {
      state.jobId = status.active_jobs[0].job_id;
      setBusy(true, true);
      pollJob();
    }
  } catch (error) {
    setStatus(`SOS backend unavailable: ${error.message}`, true);
    toast(error.message, "error");
  }
}

async function startScan(mode) {
  try {
    await saveBasicSettings();
    if (!state.root) throw new Error("Choose a valid LoRA folder first.");
    state.mode = mode;
    state.rows = [];
    state.rootContext = {};
    state.selectedRowId = "";
    state.page = 0;
    state.refs.progress.style.width = "0%";
    renderTable();
    setBusy(true, true);
    setStatus(mode === "organizer" ? "Preparing identification + planning scan…" : mode === "duplicates" ? "Preparing recursive exact-duplicate scan…" : "Preparing recursive orphan / empty-folder scan…");
    const job = await request(`/scan/${mode}`, {
      method: "POST",
      body: { root: state.root, rules: state.rules },
    });
    state.jobId = job.job_id;
    pollJob();
  } catch (error) {
    setBusy(false);
    setStatus(error.message, true);
    toast(error.message, "error");
  }
}

async function stopScan() {
  if (!state.jobId) return;
  state.refs.stop.disabled = true;
  state.refs.stop.textContent = "Stopping…";
  setStatus("Stopping scan… the current read/request is being released.");
  try { await request(`/jobs/${state.jobId}/cancel`, { method: "POST", body: {} }); }
  catch (error) { toast(error.message, "error"); }
}

async function pollJob() {
  if (state.polling || !state.jobId) return;
  state.polling = true;
  try {
    const job = await request(`/jobs/${state.jobId}`);
    state.refs.progress.style.width = `${job.percent || 0}%`;
    const prefix = job.total ? `[${job.current}/${job.total}] ` : "";
    setStatus(`${prefix}${job.stage || "Working"}${job.filename ? ` · ${job.filename}` : ""}`);
    if (job.status === "completed") {
      state.mode = job.result.mode;
      state.root = job.result.root;
      state.rows = job.result.rows || [];
      state.rootContext = job.result.root_context || {};
      state.rules = job.result.rules || state.rules;
      state.refs.folder.value = state.root;
      state.refs.progress.style.width = "100%";
      setBusy(false);
      state.refs.stop.textContent = "Stop Scan";
      summarize();
      renderTable();
      return;
    }
    if (job.status === "cancelled") {
      setBusy(false);
      state.refs.stop.textContent = "Stop Scan";
      state.refs.progress.style.width = "0%";
      setStatus(job.error || "Scan stopped. No files were changed.", true);
      return;
    }
    if (job.status === "failed") throw new Error(job.error || "The scan failed.");
    window.setTimeout(() => { state.polling = false; pollJob(); }, 450);
    return;
  } catch (error) {
    setBusy(false);
    state.refs.stop.textContent = "Stop Scan";
    setStatus(error.message, true);
    toast(error.message, "error");
  } finally {
    if (!state.jobId || !state.refs.stop.disabled || state.refs.stop.textContent === "Stop Scan") state.polling = false;
  }
}

function rowText(row) {
  if (state.mode === "organizer") return [row.display_path, row.civitai?.model_name, row.civitai?.version_name, row.base_folder, row.category, row.effective_creator, row.proposed_name, row.name_source, row.destination_directory, row.planning_status].join(" ").toLowerCase();
  if (state.mode === "duplicates") return [row.display_path, row.sha256, row.group, row.keeper_relative, row.status].join(" ").toLowerCase();
  return [row.display_path, row.cleanup_type, row.related_model, row.reason, row.status].join(" ").toLowerCase();
}

function filteredRows() {
  const needle = state.query.trim().toLowerCase();
  return needle ? state.rows.filter(row => rowText(row).includes(needle)) : state.rows;
}

function relativeDestination(path) {
  if (!path) return "";
  const root = (state.root || "").replace(/[\\/]+$/, "");
  const left = path.toLowerCase();
  const prefix = root.toLowerCase();
  return prefix && left.startsWith(prefix) ? path.slice(root.length).replace(/^[\\/]+/, "") || "." : path;
}

function formatBytes(size) {
  const units = [[2 ** 40, "TB", 2], [2 ** 30, "GB", 2], [2 ** 20, "MB", 1], [2 ** 10, "KB", 1]];
  for (const [boundary, unit, digits] of units) if (size >= boundary) return `${(size / boundary).toFixed(digits)} ${unit}`;
  return `${size || 0} B`;
}

function cell(text, className = "") {
  const td = document.createElement("td");
  td.className = className;
  td.textContent = text ?? "";
  td.title = text ?? "";
  return td;
}

function editableCell(row, property) {
  const td = document.createElement("td");
  const input = document.createElement("input");
  input.className = "solo-table-input";
  input.value = row[property] || "";
  input.addEventListener("click", event => event.stopPropagation());
  input.addEventListener("change", () => { row[property] = input.value; });
  td.appendChild(input);
  return td;
}

function includeCell(row) {
  const td = document.createElement("td");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(row.include);
  input.addEventListener("click", event => event.stopPropagation());
  input.addEventListener("change", () => { row.include = input.checked; updateActionState(); });
  td.appendChild(input);
  return td;
}

function rowState(row) {
  const status = (row.planning_status || row.status || "").toLowerCase();
  if (row.suggested_keeper) return "keeper";
  if (status.startsWith("failed")) return "failed";
  if (status.startsWith("conflict")) return "conflict";
  if (status.startsWith("ready") || status === "applied") return "ready";
  if (state.mode !== "organizer" && row.include) return "warning";
  return "neutral";
}

function renderTable() {
  if (!state.overlay) return;
  const all = filteredRows();
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  state.page = Math.max(0, Math.min(state.page, pages - 1));
  const visible = all.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
  const headers = state.mode === "organizer"
    ? ["✓", "Current", "Civitai model", "Version", "Base", "Category", "Creator", "Proposed filename", "Name source", "Destination", "Status"]
    : state.mode === "duplicates"
      ? ["✓", "File", "SHA-256", "Size", "Group", "Role", "Suggested keeper", "Copies", "Status"]
      : ["✓", "Path", "Type", "Size", "Related LoRA", "Reason", "Status"];
  const columnWidths = state.mode === "organizer"
    ? [36, 205, 242, 105, 112, 116, 120, 225, 102, 270, 240]
    : state.mode === "duplicates"
      ? [38, 300, 200, 100, 80, 140, 240, 80, 240]
      : [38, 330, 120, 100, 220, 360, 240];
  state.refs.table.dataset.mode = state.mode;
  state.refs.table.style.setProperty("--solo-table-min-width", `${columnWidths.reduce((sum, width) => sum + width, 0)}px`);
  state.refs.columns.replaceChildren();
  columnWidths.forEach(width => {
    const column = document.createElement("col");
    column.style.width = `${width}px`;
    state.refs.columns.appendChild(column);
  });
  state.refs.thead.replaceChildren();
  const headRow = document.createElement("tr");
  headers.forEach((label, index) => {
    const th = document.createElement("th");
    if (index === 0) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.title = "Toggle this page";
      checkbox.checked = visible.length > 0 && visible.every(row => row.include);
      checkbox.addEventListener("change", () => { visible.forEach(row => { row.include = checkbox.checked; }); renderTable(); });
      th.appendChild(checkbox);
    } else th.textContent = label;
    headRow.appendChild(th);
  });
  state.refs.thead.appendChild(headRow);
  state.refs.tbody.replaceChildren();
  for (const row of visible) {
    const tr = document.createElement("tr");
    tr.dataset.state = rowState(row);
    if (row.row_id === state.selectedRowId) tr.classList.add("solo-selected");
    tr.addEventListener("click", () => { state.selectedRowId = row.row_id; renderTable(); });
    tr.appendChild(includeCell(row));
    if (state.mode === "organizer") {
      tr.appendChild(cell(row.display_path, "solo-path-cell"));
      tr.appendChild(cell(row.civitai?.model_name || ""));
      tr.appendChild(cell(row.civitai?.version_name || ""));
      tr.appendChild(editableCell(row, "base_folder"));
      tr.appendChild(editableCell(row, "category"));
      tr.appendChild(cell(row.effective_creator || ""));
      tr.appendChild(editableCell(row, "proposed_name"));
      tr.appendChild(cell(row.name_source || ""));
      tr.appendChild(cell(relativeDestination(row.destination_directory)));
      tr.appendChild(cell(row.planning_status || "", "solo-status-cell"));
    } else if (state.mode === "duplicates") {
      tr.appendChild(cell(row.display_path, "solo-path-cell"));
      tr.appendChild(cell(`${(row.sha256 || "").slice(0, 16)}…`));
      tr.appendChild(cell(formatBytes(row.size)));
      tr.appendChild(cell(row.group));
      tr.appendChild(cell(row.suggested_keeper ? "Suggested KEEP" : "Duplicate"));
      tr.appendChild(cell(row.keeper_relative));
      tr.appendChild(cell(String(row.group_count || "")));
      tr.appendChild(cell(row.status || "", "solo-status-cell"));
    } else {
      tr.appendChild(cell(row.display_path, "solo-path-cell"));
      tr.appendChild(cell(row.cleanup_type));
      tr.appendChild(cell(row.is_directory ? "" : formatBytes(row.size)));
      tr.appendChild(cell(row.related_model));
      tr.appendChild(cell(row.reason, "solo-status-cell"));
      tr.appendChild(cell(row.status || ""));
    }
    state.refs.tbody.appendChild(tr);
  }
  state.refs.pageText.textContent = all.length ? `${state.page + 1}/${pages} · ${all.length}` : "0 rows";
  state.refs.prev.disabled = state.page <= 0;
  state.refs.next.disabled = state.page >= pages - 1;
  updateActionState();
}

function selectedRow() { return state.rows.find(row => row.row_id === state.selectedRowId) || null; }

function updateActionState() {
  const checked = state.rows.filter(row => row.include).length;
  const destructive = state.mode !== "organizer";
  const trashAvailable = state.trash?.available !== false;
  const trashVerb = state.trash?.verb || "Trash";
  state.refs.primary.disabled = checked === 0 || (destructive && !trashAvailable);
  state.refs.primary.title = destructive && !trashAvailable
    ? state.trash?.reason || "No safe Trash backend is available on this operating system."
    : "";
  state.refs.copy.disabled = !selectedRow();
  state.refs.civitai.disabled = state.mode !== "organizer" || !selectedRow()?.civitai?.page_url;
  state.refs.primary.textContent = state.mode === "organizer" ? "Apply Selected" : state.mode === "duplicates" ? `${trashVerb} Duplicates` : `${trashVerb} Cleanup`;
  state.refs.primary.style.setProperty("--solo-button-color", state.mode === "organizer" ? "var(--solo-pink)" : state.mode === "duplicates" ? "var(--solo-violet)" : "var(--solo-yellow)");
}

function summarize() {
  if (state.mode === "organizer") {
    state.refs.title.textContent = "Organizer Preview";
    state.refs.subtitle.textContent = "Editable Base, Category, and Proposed Filename fields · selected folder is always the organization root";
    const ready = state.rows.filter(row => row.include).length;
    const organized = state.rows.filter(row => row.planning_status === "Already organized").length;
    const civitai = state.rows.filter(row => row.civitai?.found).length;
    const misses = state.rows.filter(row => row.civitai?.status === "Hash not found on Civitai").length;
    const conflicts = state.rows.filter(row => (row.planning_status || "").startsWith("Conflict -")).length;
    setStatus(`Planning complete · ${state.rows.length} row(s) · ${ready} ready · ${organized} already organized · ${civitai} Civitai match(es) · ${misses} hash miss(es)${conflicts ? ` · ${conflicts} conflict(s)` : ""}.`, true);
  } else if (state.mode === "duplicates") {
    state.refs.title.textContent = "Exact Duplicate Preview";
    state.refs.subtitle.textContent = "Fresh SHA-256 groups · a surviving keeper is mandatory · sidecars stay untouched";
    const groups = new Set(state.rows.map(row => row.group)).size;
    const redundant = state.rows.filter(row => row.include);
    const bytes = redundant.reduce((sum, row) => sum + (row.size || 0), 0);
    setStatus(`Exact duplicate scan complete · ${groups} group(s) · ${redundant.length} redundant file(s) · ${formatBytes(bytes)} reclaimable.`, true);
  } else {
    state.refs.title.textContent = "Orphans / Empty Folders Preview";
    state.refs.subtitle.textContent = "Known sidecars are checked · possible sidecars require review · LoRA files are never cleanup targets";
    const strong = state.rows.filter(row => row.cleanup_type === "Orphan sidecar").length;
    const possible = state.rows.filter(row => row.cleanup_type === "Possible orphan sidecar").length;
    const empty = state.rows.filter(row => row.is_directory).length;
    setStatus(`Cleanup scan complete · ${strong} orphan sidecar(s) · ${possible} possible sidecar(s) · ${empty} empty folder tree(s).`, true);
  }
}

function modalBase(title, copy = "") {
  const modal = state.refs.modal;
  modal.querySelector(".solo-modal-title").textContent = title;
  modal.querySelector(".solo-modal-copy").textContent = copy;
  modal.querySelector(".solo-modal-content").replaceChildren();
  modal.querySelector(".solo-modal-actions").replaceChildren();
  modal.hidden = false;
  return {
    modal,
    content: modal.querySelector(".solo-modal-content"),
    actions: modal.querySelector(".solo-modal-actions"),
  };
}

function confirmAction(title, copy, confirmLabel, color) {
  return new Promise(resolve => {
    const { modal, actions } = modalBase(title, copy);
    const cancel = makeButton("Cancel", "var(--solo-muted)");
    const confirm = makeButton(confirmLabel, color, true);
    const finish = value => { modal.hidden = true; resolve(value); };
    cancel.addEventListener("click", () => finish(false));
    confirm.addEventListener("click", () => finish(true));
    actions.append(cancel, confirm);
  });
}

async function refreshRowsFromJob() {
  const job = await request(`/jobs/${state.jobId}`);
  if (job.result?.rows) state.rows = job.result.rows;
  renderTable();
}

async function primaryAction() {
  const selected = state.rows.filter(row => row.include);
  if (!selected.length) return;
  if (state.mode !== "organizer" && state.trash?.available === false) {
    toast(state.trash.reason || "No safe Trash backend is available on this operating system.", "error");
    return;
  }
  const trashVerb = state.trash?.verb || "Trash";
  const trashDestination = state.trash?.label || "Trash";
  const label = state.mode === "organizer" ? "Apply" : trashVerb;
  const copy = state.mode === "organizer"
    ? `Apply ${selected.length} checked ${state.rules.rename_files ? "rename/move" : "move-only"} operation(s)?\n\nAn undo manifest is written before files move. Companion sidecars move with their LoRA.`
    : state.mode === "duplicates"
      ? `Send ${selected.length} exact duplicate file(s) to ${trashDestination}?\n\nRemaining LoRAs are not renamed or moved. Sidecar files are left untouched.`
      : `Send ${selected.length} checked cleanup item(s) to ${trashDestination}?\n\nLoRA .safetensors files are never cleanup targets.`;
  const color = state.mode === "organizer" ? "var(--solo-pink)" : state.mode === "duplicates" ? "var(--solo-violet)" : "var(--solo-yellow)";
  if (!await confirmAction(`${label} selected items?`, copy, label, color)) return;
  try {
    setBusy(true, false);
    let result;
    if (state.mode === "organizer") {
      const edits = Object.fromEntries(selected.map(row => [row.row_id, {
        proposed_name: row.proposed_name,
        base_folder: row.base_folder,
        category: row.category,
      }]));
      result = await request("/apply", { method: "POST", body: { job_id: state.jobId, selected_ids: selected.map(row => row.row_id), edits } });
    } else {
      result = await request(`/recycle/${state.mode}`, { method: "POST", body: { job_id: state.jobId, selected_ids: selected.map(row => row.row_id) } });
    }
    await refreshRowsFromJob();
    if (state.mode === "organizer") {
      state.settings = { ...(state.settings || {}), undo_available: Boolean(result.undo_available) };
    }
    setStatus(result.message, true);
    toast(result.message, result.failed ? "warn" : "success");
  } catch (error) {
    setStatus(error.message, true);
    toast(error.message, "error");
  } finally { setBusy(false); }
}

async function undoLast() {
  if (!await confirmAction("Undo last organization?", "SOLO will restore the most recent organization manifest in reverse order. Existing conflicting files are skipped.", "Undo Last", "var(--solo-cyan)")) return;
  try {
    setBusy(true, false);
    const result = await request("/undo", { method: "POST", body: {} });
    state.settings = { ...(state.settings || {}), undo_available: false };
    setStatus(`${result.message} Run Scan Folder again to refresh the preview.`, true);
    toast(result.message, "success");
  } catch (error) { setStatus(error.message, true); toast(error.message, "error"); }
  finally { setBusy(false); }
}

function openCivitai() {
  const url = selectedRow()?.civitai?.page_url;
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}

async function copySelected() {
  const row = selectedRow();
  if (!row) return;
  let text;
  if (state.mode === "organizer") {
    text = [
      `Current file: ${row.display_path}`, `SHA-256: ${row.sha256}`, `Civitai model: ${row.civitai?.model_name || ""}`,
      `Version: ${row.civitai?.version_name || ""}`, `Creator: ${row.effective_creator || ""}`,
      `Creator source: ${row.creator_source || "Unknown"}`, `Base model: ${row.base_folder}`, `Category: ${row.category}`,
      `Creator bucket: ${row.creator_bucket_mode} (${row.creator_bucket_count})`, `Proposed filename: ${row.proposed_name}`,
      `Name source: ${row.name_source}`, `Destination: ${relativeDestination(row.destination_directory)}`,
      `Status: ${row.planning_status}`, row.civitai?.page_url ? `Civitai page: ${row.civitai.page_url}` : "",
    ].filter(Boolean).join("\n");
  } else if (state.mode === "duplicates") {
    text = [`Duplicate group: ${row.group}`, `File: ${row.display_path}`, `SHA-256: ${row.sha256}`, `Size: ${formatBytes(row.size)}`, `Suggested keeper: ${row.keeper_relative}`, `Exact copies in group: ${row.group_count}`, `Suggested keeper row: ${row.suggested_keeper}`].join("\n");
  } else {
    text = [`Cleanup type: ${row.cleanup_type}`, `Path: ${row.display_path}`, `Reason: ${row.reason}`, `Related LoRA: ${row.related_model}`].join("\n");
  }
  try { await navigator.clipboard.writeText(text); setStatus("Copied selected row information."); }
  catch (error) { toast(`Could not copy: ${error.message}`, "error"); }
}

async function showSettings() {
  try {
    const settings = await request("/settings");
    const { modal, content, actions } = modalBase("SOS Settings", "Normal LoRA identification uses Civitai's public lookup and does not need a token. Add one only if Civitai access specifically requires authentication for you.");
    const grid = document.createElement("div");
    grid.className = "solo-settings-grid";
    const tokenLabel = document.createElement("span"); tokenLabel.className = "solo-label"; tokenLabel.textContent = "Civitai API token";
    const token = document.createElement("input"); token.className = "solo-input"; token.type = "password"; token.placeholder = settings.token_configured ? "Token configured · enter to replace" : "Optional";
    const saveLabel = document.createElement("span"); saveLabel.className = "solo-label"; saveLabel.textContent = "Persistence";
    const saveWrap = document.createElement("label"); saveWrap.className = "solo-check";
    const save = document.createElement("input"); save.type = "checkbox"; save.checked = Boolean(settings.save_token);
    saveWrap.append(save, document.createTextNode("Save token locally in SOS settings (plain text)"));
    const clearLabel = document.createElement("span"); clearLabel.className = "solo-label"; clearLabel.textContent = "Clear token";
    const clearWrap = document.createElement("label"); clearWrap.className = "solo-check";
    const clear = document.createElement("input"); clear.type = "checkbox";
    clearWrap.append(clear, document.createTextNode("Forget the configured token"));
    grid.append(tokenLabel, token, saveLabel, saveWrap, clearLabel, clearWrap);
    content.appendChild(grid);
    const cancel = makeButton("Cancel", "var(--solo-muted)");
    const confirm = makeButton("Save Settings", "var(--solo-violet)", true);
    cancel.addEventListener("click", () => { modal.hidden = true; });
    confirm.addEventListener("click", async () => {
      try {
        const body = { save_token: save.checked, clear_token: clear.checked };
        if (token.value.trim()) body.api_token = token.value.trim();
        state.settings = await request("/settings", { method: "POST", body });
        modal.hidden = true;
        setStatus(state.settings.token_configured ? "Settings saved. Optional Civitai token is configured." : "Settings saved. Civitai lookup will use public access.");
      } catch (error) { toast(error.message, "error"); }
    });
    actions.append(cancel, confirm);
  } catch (error) { toast(error.message, "error"); }
}

async function showBrowser() {
  const { modal, content, actions } = modalBase("Choose LoRA Library", "Browse folders on the machine running ComfyUI.");
  const pathInput = document.createElement("input"); pathInput.className = "solo-input"; pathInput.value = state.refs.folder.value;
  const roots = document.createElement("div"); roots.className = "solo-browser-roots";
  const list = document.createElement("div"); list.className = "solo-browser-list";
  content.append(pathInput, roots, list);
  let current = pathInput.value;
  async function load(path) {
    try {
      const data = await request(`/browse?path=${encodeURIComponent(path || "")}`);
      current = data.current; pathInput.value = current;
      roots.replaceChildren();
      for (const root of data.roots || []) {
        const button = makeButton(root, "var(--solo-violet)");
        button.addEventListener("click", () => load(root));
        roots.appendChild(button);
      }
      list.replaceChildren();
      if (data.parent && data.parent !== data.current) {
        const parent = document.createElement("button"); parent.className = "solo-browser-item"; parent.textContent = "↰  .."; parent.addEventListener("click", () => load(data.parent)); list.appendChild(parent);
      }
      for (const child of data.children || []) {
        const button = document.createElement("button"); button.className = "solo-browser-item"; button.textContent = `📁  ${child.name}`; button.title = child.path; button.addEventListener("dblclick", () => load(child.path)); button.addEventListener("click", () => { current = child.path; pathInput.value = child.path; }); list.appendChild(button);
      }
    } catch (error) { toast(error.message, "error"); }
  }
  pathInput.addEventListener("keydown", event => { if (event.key === "Enter") load(pathInput.value); });
  const cancel = makeButton("Cancel", "var(--solo-muted)");
  const open = makeButton("Open Folder", "var(--solo-cyan)");
  const choose = makeButton("Use This Folder", "var(--solo-pink)", true);
  cancel.addEventListener("click", () => { modal.hidden = true; });
  open.addEventListener("click", () => load(pathInput.value));
  choose.addEventListener("click", () => { state.refs.folder.value = pathInput.value || current; state.root = state.refs.folder.value; modal.hidden = true; });
  actions.append(cancel, open, choose);
  await load(current);
}

function registerSidebar() {
  if (!app.extensionManager?.registerSidebarTab) return;
  try {
    app.extensionManager.registerSidebarTab({
      id: "solo-lora-organizer",
      icon: "pi pi-folder-open",
      title: "SOS",
      tooltip: "SOS LoRA Organizer",
      type: "custom",
      render: element => {
        element.className = "solo-sidebar-card";
        const heading = document.createElement("div"); heading.className = "solo-sidebar-heading";
        const image = document.createElement("img"); image.className = "solo-sidebar-mark"; image.src = MARK_URL; image.alt = "SOS";
        const title = document.createElement("div"); title.className = "solo-sidebar-title"; title.textContent = "Sick Ollie\nLoRA Organizer"; title.style.whiteSpace = "pre-line";
        heading.append(image, title);
        const copy = document.createElement("div"); copy.className = "solo-sidebar-copy"; copy.textContent = "Identify, clean, organize, and verify your LoRA library without leaving ComfyUI.";
        const button = makeButton("Open Organizer", "var(--solo-pink)", true); button.addEventListener("click", openOrganizer);
        element.replaceChildren(heading, copy, button);
      },
    });
  } catch { /* Some frontend builds reject duplicate sidebar registration on hot reload. */ }
}

app.registerExtension({
  name: "SickOllie.SOS.LoRAOrganizer",
  commands: [{
    id: "solo.openOrganizer",
    label: "Open SOS LoRA Organizer",
    icon: "pi pi-folder-open",
    function: openOrganizer,
  }],
  menuCommands: [{ path: ["Sick Ollie"], commands: ["solo.openOrganizer"] }],
  async setup() {
    ensureStyle();
    // The Studio pack owns the single SOLO sidebar hub. Delay one tick so its
    // frontend modules have a chance to register even when extension load order
    // differs between ComfyUI builds; retain this standalone tab as a fallback.
    setTimeout(() => {
      if (typeof window.SickOllieRegisterSoloHubItem === "function") {
        window.SickOllieRegisterSoloHubItem({ id: "lora-organizer", label: "LoRA Organizer", description: "Identify, clean, organize, and verify your LoRA library.", color: "#fff04d", open: openOrganizer });
      } else registerSidebar();
    }, 250);
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "SOLO_LoRA_Organizer") return;
    const original = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = original?.apply(this, arguments);
      this.color = "#2a1830";
      this.bgcolor = "#130f19";
      const button = this.addWidget("button", "Open Organizer", null, () => openOrganizer());
      button.serialize = false;
      this.setSize([320, 88]);
      return result;
    };
  },
});

export { openOrganizer };
