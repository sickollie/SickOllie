import { app } from "../../../scripts/app.js";
import { api } from "../../../scripts/api.js";

const API_ROOT = "/sickollie/solo-log-organizer/api/v1";
const STYLE_URL = new URL("./solo_log_organizer.css", import.meta.url).href;
const BRANDING_URL = new URL("./solo_log_organizer_assets/HeaderBrandingLog.png", import.meta.url).href;
const MARK_URL = new URL("./solo_log_organizer_assets/BrandMark.png", import.meta.url).href;
const TEXTURE_URL = new URL("./solo_log_organizer_assets/HeaderTexture.png", import.meta.url).href;
const PAGE_SIZE = 200;

const state = {
  overlay: null,
  refs: {},
  settings: null,
  rows: [],
  root: "",
  rules: {},
  jobId: "",
  selectedRowId: "",
  query: "",
  viewMode: "actionable",
  page: 0,
  polling: false,
  previewStale: false,
};

function ensureStyle() {
  if (document.querySelector(`link[data-solo-log-style="${STYLE_URL}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = STYLE_URL;
  link.dataset.soloLogStyle = STYLE_URL;
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
  overlay.className = "solo-overlay solo-log-overlay";
  overlay.hidden = true;
  overlay.innerHTML = `
    <section class="solo-shell solo-log-shell" role="dialog" aria-modal="true" aria-label="SOS Log Organizer">
      <header class="solo-header">
        <img class="solo-branding solo-log-branding" alt="SOS Sick Ollie Log Organizer">
        <div class="solo-header-meta">
          <span class="solo-pill" style="--solo-pill-color:var(--solo-violet)">ComfyUI native</span>
          <span class="solo-pill" style="--solo-pill-color:var(--solo-cyan)">v0.3.0</span>
          <button class="solo-icon-button solo-close" type="button" aria-label="Close">×</button>
        </div>
      </header>
      <main class="solo-body solo-log-body">
        <div class="solo-command-deck">
          <section class="solo-card" style="--solo-accent:var(--solo-pink)">
            <h2 class="solo-card-title">Cleanup + organization rules</h2>
            <div class="solo-rules">
              <label class="solo-check"><input data-rule="remove_blank_lines" type="checkbox">Remove blank lines</label>
              <label class="solo-check"><input data-rule="remove_structural_headers" type="checkbox">Remove recognized headers</label>
              <label class="solo-check"><input data-rule="strip_numbering" type="checkbox">Strip sequential number prefixes</label>
              <label class="solo-check"><input data-rule="convert_sick_dolls_to_brand" type="checkbox">Convert SICK DOLLS to BRAND</label>
              <label class="solo-check"><input data-rule="remove_exact_duplicate_lines" type="checkbox">Remove exact duplicate lines</label>
              <label class="solo-check"><input data-rule="organize_by_tokens" type="checkbox">Sort into Prompt Core folders</label>
              <label class="solo-check"><input data-rule="polish_filenames" type="checkbox">Rewrite filenames with readable titles</label>
              <label class="solo-check"><input data-rule="archive_exact_duplicates" type="checkbox">Archive exact duplicate files</label>
              <label class="solo-check" title="Reclassify logs already inside outfits, prompts, or scenes. Enable this once to migrate an older SOLO layout into the compact v0.3 folders."><input data-rule="reprocess_existing_subfolders" type="checkbox">Reprocess existing subfolders</label>
            </div>
          </section>
          <section class="solo-card solo-library-card" style="--solo-accent:var(--solo-cyan)">
            <h2 class="solo-card-title">Prompt-log library</h2>
            <div class="solo-folder-row">
              <span class="solo-label">Source folder</span>
              <input class="solo-input solo-folder" type="text" spellcheck="false" aria-label="Prompt-log source folder">
              <button class="solo-button solo-browse" style="--solo-button-color:var(--solo-cyan)" type="button">Browse…</button>
            </div>
            <div class="solo-actions">
              <button class="solo-button solo-filled solo-scan" style="--solo-button-color:var(--solo-pink)" type="button">Scan Logs</button>
              <button class="solo-button solo-stop" style="--solo-button-color:var(--solo-red)" type="button" disabled>Stop Scan</button>
              <button class="solo-button solo-select-all" style="--solo-button-color:var(--solo-violet)" type="button">Select All</button>
              <button class="solo-button solo-select-none" style="--solo-button-color:var(--solo-muted)" type="button">Select None</button>
              <button class="solo-button solo-audit" style="--solo-button-color:var(--solo-cyan)" type="button" disabled>Export Audit</button>
              <button class="solo-button solo-empty-folders" style="--solo-button-color:var(--solo-yellow)" type="button">Remove Empty Folders</button>
            </div>
            <div class="solo-log-note"><b>Compact Prompt Core layout:</b> exact token contracts stay in filenames; folders describe purpose. Scene values stay in scenes, while complete SCENE prompts stay in prompts/Scene Templates.</div>
            <div class="solo-progress-track"><div class="solo-progress-fill"></div></div>
            <div class="solo-status">Choose a prompt-log library, then scan to build a dry-run preview.</div>
          </section>
        </div>
        <section class="solo-preview-head">
          <h2 class="solo-mode-title">Log Organization Preview</h2>
          <span class="solo-mode-subtitle">Editable category, group, and filename fields · nothing changes until Apply Selected</span>
          <select class="solo-view-mode" aria-label="Preview rows">
            <option value="actionable">Actionable + review</option>
            <option value="checked">Checked changes</option>
            <option value="all">All logs</option>
          </select>
          <input class="solo-search" type="search" placeholder="Filter preview…" aria-label="Filter preview">
          <button class="solo-button solo-copy" style="--solo-button-color:var(--solo-cyan)" type="button" disabled>Copy Info</button>
          <span class="solo-page-text"></span>
          <button class="solo-button solo-prev" style="--solo-button-color:var(--solo-muted)" type="button" disabled>‹</button>
          <button class="solo-button solo-next" style="--solo-button-color:var(--solo-muted)" type="button" disabled>›</button>
        </section>
        <section class="solo-grid-card"><div class="solo-table-wrap"><table class="solo-table"><colgroup></colgroup><thead></thead><tbody></tbody></table></div></section>
        <section class="solo-log-inspector">
          <div class="solo-log-sample"><h3>Original sample</h3><pre class="solo-original-sample">Select a row to inspect its original content.</pre></div>
          <div class="solo-log-sample"><h3>Resolved sample</h3><pre class="solo-resolved-sample">The cleaned preview will appear here.</pre></div>
        </section>
      </main>
      <footer class="solo-footer">
        <span class="solo-footer-message">Preview-first: originals are archived before outputs are written.</span>
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
    scan: q(".solo-scan"), stop: q(".solo-stop"), browse: q(".solo-browse"),
    selectAll: q(".solo-select-all"), selectNone: q(".solo-select-none"), audit: q(".solo-audit"),
    emptyFolders: q(".solo-empty-folders"),
    primary: q(".solo-primary"), undo: q(".solo-undo"), copy: q(".solo-copy"), search: q(".solo-search"),
    viewMode: q(".solo-view-mode"),
    pageText: q(".solo-page-text"), prev: q(".solo-prev"), next: q(".solo-next"),
    footer: q(".solo-footer-message"), table: q(".solo-table"), columns: q(".solo-table colgroup"),
    thead: q(".solo-table thead"), tbody: q(".solo-table tbody"), modal: q(".solo-submodal"),
    original: q(".solo-original-sample"), resolved: q(".solo-resolved-sample"),
  };
  q(".solo-close").addEventListener("click", () => { overlay.hidden = true; });
  state.refs.scan.addEventListener("click", startScan);
  state.refs.stop.addEventListener("click", stopScan);
  state.refs.browse.addEventListener("click", showBrowser);
  state.refs.selectAll.addEventListener("click", () => {
    filteredRows().forEach(row => { if (row.resolved_count > 0 && row.role !== "Unreadable") row.include = true; });
    renderTable();
  });
  state.refs.selectNone.addEventListener("click", () => { state.rows.forEach(row => { row.include = false; }); renderTable(); });
  state.refs.audit.addEventListener("click", exportAudit);
  state.refs.emptyFolders.addEventListener("click", removeEmptyFolders);
  state.refs.primary.addEventListener("click", primaryAction);
  state.refs.undo.addEventListener("click", undoLast);
  state.refs.copy.addEventListener("click", copySelected);
  state.refs.search.addEventListener("input", () => { state.query = state.refs.search.value; state.page = 0; renderTable(); });
  state.refs.viewMode.addEventListener("change", () => { state.viewMode = state.refs.viewMode.value; state.page = 0; renderTable(); });
  state.refs.folder.addEventListener("input", () => {
    if (state.rows.length) state.previewStale = true;
    updateActionState();
  });
  state.refs.prev.addEventListener("click", () => { state.page = Math.max(0, state.page - 1); renderTable(); });
  state.refs.next.addEventListener("click", () => { state.page += 1; renderTable(); });
  q(".solo-rules").addEventListener("change", () => {
    state.rules = readRules();
    if (state.rows.length) state.previewStale = true;
    updateActionState();
    setStatus("Rules changed · run Scan Logs again to rebuild the preview.");
  });
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
    app.extensionManager?.toast?.add({ severity, summary: "SOS Log Organizer", detail: message, life: 4800 });
  } catch { /* Status/footer still carry the result on older frontends. */ }
}

function setBusy(busy, cancellable = false) {
  for (const element of [state.refs.scan, state.refs.browse, state.refs.selectAll, state.refs.selectNone, state.refs.audit, state.refs.emptyFolders]) element.disabled = busy;
  state.refs.stop.disabled = !busy || !cancellable;
  state.refs.folder.disabled = busy;
  state.overlay.querySelectorAll("[data-rule]").forEach(input => { input.disabled = busy; });
  if (busy) {
    state.refs.primary.disabled = true;
    state.refs.undo.disabled = true;
  } else {
    state.refs.undo.disabled = !(state.settings?.undo_available);
    state.refs.audit.disabled = !state.jobId || !state.rows.length;
    updateActionState();
  }
}

async function openOrganizer() {
  buildPanel();
  state.overlay.hidden = false;
  try {
    const status = await request("/status");
    state.settings = status.settings;
    state.root = status.settings.last_folder || status.settings.suggested_roots?.[0] || "";
    state.refs.folder.value = state.root;
    writeRules(status.settings.rules || {});
    state.refs.undo.disabled = !status.settings.undo_available;
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

async function saveSettings() {
  state.root = state.refs.folder.value.trim();
  state.rules = readRules();
  state.settings = await request("/settings", {
    method: "POST",
    body: { last_folder: state.root, rules: state.rules },
  });
}

async function startScan() {
  try {
    await saveSettings();
    if (!state.root) throw new Error("Choose a valid prompt-log folder first.");
    state.rows = [];
    state.previewStale = true;
    state.selectedRowId = "";
    state.page = 0;
    state.refs.progress.style.width = "0%";
    renderTable();
    setBusy(true, true);
    setStatus("Preparing token-aware prompt-log scan…");
    const job = await request("/scan", { method: "POST", body: { root: state.root, rules: state.rules } });
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
  setStatus("Stopping scan… no files have been changed.");
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
      state.root = job.result.root;
      state.rows = job.result.rows || [];
      state.rules = job.result.rules || state.rules;
      state.previewStale = false;
      state.refs.folder.value = state.root;
      state.refs.progress.style.width = "100%";
      state.selectedRowId = state.rows[0]?.row_id || "";
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
  return [row.display_path, row.role, row.token_display, row.parent_category, row.destination_group, row.proposed_name, row.issues_text, row.status].join(" ").toLowerCase();
}

function filteredRows() {
  const needle = state.query.trim().toLowerCase();
  let rows = state.rows;
  if (state.viewMode === "checked") rows = rows.filter(row => row.include);
  else if (state.viewMode === "actionable") {
    rows = rows.filter(row => (
      row.include || row.is_mixed || row.is_exact_duplicate || row.role === "Unreadable" ||
      row.status === "No usable lines" || (row.status || "").startsWith("FAILED")
    ));
  }
  return needle ? rows.filter(row => rowText(row).includes(needle)) : rows;
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
  input.disabled = Boolean(row.is_exact_duplicate && state.rules.archive_exact_duplicates);
  input.addEventListener("click", event => event.stopPropagation());
  input.addEventListener("change", () => { row[property] = input.value; });
  td.appendChild(input);
  return td;
}

function categoryCell(row) {
  const td = document.createElement("td");
  const select = document.createElement("select");
  select.className = "solo-table-input";
  select.disabled = Boolean(row.is_exact_duplicate && state.rules.archive_exact_duplicates);
  for (const value of ["outfits", "prompts", "scenes"]) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    option.selected = row.parent_category === value;
    select.appendChild(option);
  }
  select.addEventListener("click", event => event.stopPropagation());
  select.addEventListener("change", () => { row.parent_category = select.value; });
  td.appendChild(select);
  return td;
}

function includeCell(row) {
  const td = document.createElement("td");
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(row.include);
  input.disabled = row.resolved_count <= 0 || row.role === "Unreadable";
  input.addEventListener("click", event => event.stopPropagation());
  input.addEventListener("change", () => { row.include = input.checked; updateActionState(); });
  td.appendChild(input);
  return td;
}

function rowState(row) {
  if ((row.status || "").startsWith("FAILED")) return "failed";
  if (row.is_exact_duplicate) return "duplicate";
  if (row.is_master) return "master";
  if (row.is_mixed) return "warning";
  if (row.status === "Ready" || row.status === "Applied") return "ready";
  return "neutral";
}

function renderTable() {
  if (!state.overlay) return;
  const all = filteredRows();
  if (!all.some(row => row.row_id === state.selectedRowId)) state.selectedRowId = all[0]?.row_id || "";
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  state.page = Math.max(0, Math.min(state.page, pages - 1));
  const visible = all.slice(state.page * PAGE_SIZE, (state.page + 1) * PAGE_SIZE);
  const headers = ["✓", "Current file", "Role", "Tokens / coverage", "Raw", "Resolved", "Category", "Destination group", "Polished filename", "Issues / status"];
  const widths = [38, 245, 118, 170, 58, 68, 94, 190, 360, 285];
  state.refs.table.style.setProperty("--solo-table-min-width", `${widths.reduce((sum, width) => sum + width, 0)}px`);
  state.refs.columns.replaceChildren();
  widths.forEach(width => {
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
      checkbox.addEventListener("change", () => {
        visible.forEach(row => { if (row.resolved_count > 0 && row.role !== "Unreadable") row.include = checkbox.checked; });
        renderTable();
      });
      th.appendChild(checkbox);
    } else th.textContent = label;
    headRow.appendChild(th);
  });
  state.refs.thead.appendChild(headRow);
  state.refs.tbody.replaceChildren();
  if (!visible.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = headers.length;
    td.className = "solo-empty-state";
    td.textContent = state.query ? "No logs match this filter." : "Nothing needs attention in this view. Choose All logs to inspect the complete library.";
    tr.appendChild(td);
    state.refs.tbody.appendChild(tr);
  }
  for (const row of visible) {
    const tr = document.createElement("tr");
    tr.dataset.state = rowState(row);
    if (row.row_id === state.selectedRowId) tr.classList.add("solo-selected");
    tr.addEventListener("click", () => { state.selectedRowId = row.row_id; renderTable(); });
    tr.appendChild(includeCell(row));
    tr.appendChild(cell(row.display_path, "solo-path-cell"));
    tr.appendChild(cell(row.role));
    tr.appendChild(cell(row.token_display));
    tr.appendChild(cell(String(row.raw_nonblank_count || 0)));
    tr.appendChild(cell(String(row.resolved_count || 0)));
    tr.appendChild(categoryCell(row));
    tr.appendChild(editableCell(row, "destination_group"));
    tr.appendChild(editableCell(row, "proposed_name"));
    const detail = [row.status, row.issues_text].filter(Boolean).join(" · ");
    tr.appendChild(cell(detail, "solo-status-cell"));
    state.refs.tbody.appendChild(tr);
  }
  state.refs.pageText.textContent = all.length ? `${state.page + 1}/${pages} · ${all.length}` : "0 rows";
  state.refs.prev.disabled = state.page <= 0;
  state.refs.next.disabled = state.page >= pages - 1;
  renderInspector();
  updateActionState();
}

function selectedRow() { return state.rows.find(row => row.row_id === state.selectedRowId) || null; }

function renderInspector() {
  const row = selectedRow();
  state.refs.original.textContent = row?.original_sample || "Select a row to inspect its original content.";
  state.refs.resolved.textContent = row?.resolved_sample || "The cleaned preview will appear here.";
  state.refs.copy.disabled = !row;
}

function updateActionState() {
  state.refs.primary.disabled = state.previewStale || state.rows.every(row => !row.include);
  state.refs.audit.disabled = !state.jobId || !state.rows.length;
}

function summarize() {
  const selected = state.rows.filter(row => row.include).length;
  const groups = new Set(state.rows.map(row => `${row.parent_category}/${row.destination_group}`)).size;
  const categoryCounts = Object.fromEntries(["outfits", "prompts", "scenes"].map(category => [category, state.rows.filter(row => row.parent_category === category).length]));
  const duplicates = state.rows.filter(row => row.is_exact_duplicate).length;
  const mixed = state.rows.filter(row => row.is_mixed).length;
  const removed = state.rows.reduce((sum, row) => sum + (row.duplicate_lines_removed || 0), 0);
  setStatus(`Scan complete · ${state.rows.length} log(s) · ${categoryCounts.outfits} outfits / ${categoryCounts.prompts} prompts / ${categoryCounts.scenes} scenes · ${groups} physical subgroup(s) · ${selected} checked · ${duplicates} exact duplicate(s) · ${mixed} mixed-coverage log(s) · ${removed} duplicate line(s) removable.`, true);
}

function modalBase(title, copy = "") {
  const modal = state.refs.modal;
  modal.querySelector(".solo-modal-title").textContent = title;
  modal.querySelector(".solo-modal-copy").textContent = copy;
  modal.querySelector(".solo-modal-content").replaceChildren();
  modal.querySelector(".solo-modal-actions").replaceChildren();
  modal.hidden = false;
  return { modal, content: modal.querySelector(".solo-modal-content"), actions: modal.querySelector(".solo-modal-actions") };
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
  const duplicateCount = selected.filter(row => row.is_exact_duplicate && state.rules.archive_exact_duplicates).length;
  const copy = `Apply ${selected.length} checked log operation(s)?\n\n${selected.length - duplicateCount} cleaned/polished output(s) will be written and ${duplicateCount} exact duplicate(s) archived. Every selected original is moved into a timestamped recovery archive before outputs are created. Undo uses a progressive manifest.`;
  if (!await confirmAction("Apply selected log changes?", copy, "Apply", "var(--solo-pink)")) return;
  try {
    setBusy(true, false);
    const edits = Object.fromEntries(selected.map(row => [row.row_id, {
      proposed_name: row.proposed_name,
      parent_category: row.parent_category,
      destination_group: row.destination_group,
    }]));
    const result = await request("/apply", {
      method: "POST",
      body: { job_id: state.jobId, selected_ids: selected.map(row => row.row_id), edits },
    });
    await refreshRowsFromJob();
    state.settings = { ...(state.settings || {}), undo_available: Boolean(result.undo_available) };
    setStatus(result.message, true);
    toast(result.message, result.failed ? "warn" : "success");
  } catch (error) {
    setStatus(error.message, true);
    toast(error.message, "error");
  } finally { setBusy(false); }
}

async function undoLast() {
  const copy = "SOLO will remove only unchanged outputs created by the latest apply, then restore the archived originals to their exact prior paths. Modified outputs and path conflicts are skipped.";
  if (!await confirmAction("Undo last log organization?", copy, "Undo Last", "var(--solo-cyan)")) return;
  try {
    setBusy(true, false);
    const result = await request("/undo", { method: "POST", body: {} });
    state.settings = { ...(state.settings || {}), undo_available: Boolean(result.undo_available) };
    state.previewStale = true;
    updateActionState();
    setStatus(`${result.message} Run Scan Logs again to refresh the preview.`, true);
    toast(result.message, result.skipped ? "warn" : "success");
  } catch (error) { setStatus(error.message, true); toast(error.message, "error"); }
  finally { setBusy(false); }
}

async function removeEmptyFolders() {
  let busy = false;
  try {
    await saveSettings();
    if (!state.root) throw new Error("Choose a valid prompt-log folder first.");
    setBusy(true, false); busy = true;
    setStatus("Finding empty folders… no files will be touched.");
    const preview = await request("/empty-folders/preview", { method: "POST", body: { root: state.root } });
    setBusy(false); busy = false;
    if (!preview.count) {
      setStatus("No removable empty folders found. The outfits, prompts, and scenes parents are always preserved.", true);
      return;
    }
    const shown = preview.folders.slice(0, 12).map(path => `• ${path}`).join("\n");
    const remainder = preview.count > 12 ? `\n• …and ${preview.count - 12} more` : "";
    const copy = `${preview.count} empty folder(s) can be removed:\n\n${shown}${remainder}\n\nOnly folders that are still completely empty will be removed. The selected root plus outfits, prompts, and scenes are protected.`;
    if (!await confirmAction("Remove empty folders?", copy, "Remove Empty Folders", "var(--solo-yellow)")) return;
    setBusy(true, false); busy = true;
    const result = await request("/empty-folders/remove", {
      method: "POST",
      body: { root: preview.root, folders: preview.folders },
    });
    setStatus(result.message, true);
    toast(result.message, result.skipped ? "warn" : "success");
  } catch (error) {
    setStatus(error.message, true);
    toast(error.message, "error");
  } finally {
    if (busy) setBusy(false);
  }
}

async function copySelected() {
  const row = selectedRow();
  if (!row) return;
  const text = [
    `Current file: ${row.display_path}`, `Role: ${row.role}`, `Tokens: ${row.token_display}`,
    `Raw lines: ${row.raw_nonblank_count}`, `Resolved lines: ${row.resolved_count}`,
    `Parent category: ${row.parent_category}`, `Destination group: ${row.destination_group}`,
    `Polished filename: ${row.proposed_name}`,
    `Exact duplicate: ${row.is_exact_duplicate}`, row.duplicate_of ? `Keeper: ${row.duplicate_of}` : "",
    `Issues: ${row.issues_text || "None"}`,
  ].filter(Boolean).join("\n");
  try { await navigator.clipboard.writeText(text); setStatus("Copied selected log information."); }
  catch (error) { toast(`Could not copy: ${error.message}`, "error"); }
}

async function exportAudit() {
  if (!state.jobId) return;
  try {
    const response = await api.fetchApi(`${API_ROOT}/audit/${state.jobId}`);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "SOLO-Log-Audit.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    setStatus("Audit CSV exported.");
  } catch (error) { toast(`Could not export audit: ${error.message}`, "error"); }
}

async function showBrowser() {
  const { modal, content, actions } = modalBase("Choose Prompt-Log Library", "Browse folders on the machine running ComfyUI.");
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
        const button = document.createElement("button"); button.className = "solo-browser-item"; button.textContent = `📁  ${child.name}`; button.title = child.path;
        button.addEventListener("dblclick", () => load(child.path));
        button.addEventListener("click", () => { current = child.path; pathInput.value = child.path; });
        list.appendChild(button);
      }
    } catch (error) { toast(error.message, "error"); }
  }
  pathInput.addEventListener("keydown", event => { if (event.key === "Enter") load(pathInput.value); });
  const cancel = makeButton("Cancel", "var(--solo-muted)");
  const open = makeButton("Open Folder", "var(--solo-cyan)");
  const choose = makeButton("Use This Folder", "var(--solo-pink)", true);
  cancel.addEventListener("click", () => { modal.hidden = true; });
  open.addEventListener("click", () => load(pathInput.value));
  choose.addEventListener("click", () => {
    state.refs.folder.value = pathInput.value || current;
    state.root = state.refs.folder.value;
    if (state.rows.length) state.previewStale = true;
    updateActionState();
    modal.hidden = true;
  });
  actions.append(cancel, open, choose);
  await load(current);
}

function registerSidebar() {
  if (!app.extensionManager?.registerSidebarTab) return;
  try {
    app.extensionManager.registerSidebarTab({
      id: "solo-log-organizer",
      icon: "pi pi-align-left",
      title: "SOS",
      tooltip: "SOS Log Organizer",
      type: "custom",
      render: element => {
        element.className = "solo-sidebar-card";
        const heading = document.createElement("div"); heading.className = "solo-sidebar-heading";
        const image = document.createElement("img"); image.className = "solo-sidebar-mark"; image.src = MARK_URL; image.alt = "SOS";
        const title = document.createElement("div"); title.className = "solo-sidebar-title"; title.textContent = "Sick Ollie\nLog Organizer"; title.style.whiteSpace = "pre-line";
        heading.append(image, title);
        const copy = document.createElement("div"); copy.className = "solo-sidebar-copy"; copy.textContent = "Clean, classify, rename, and organize Prompt Core logs into outfits, prompts, and scenes.";
        const button = makeButton("Open Log Organizer", "var(--solo-pink)", true); button.addEventListener("click", openOrganizer);
        element.replaceChildren(heading, copy, button);
      },
    });
  } catch { /* Some frontend builds reject duplicate registration on hot reload. */ }
}

app.registerExtension({
  name: "SickOllie.SOS.LogOrganizer",
  commands: [{
    id: "soloLog.openOrganizer",
    label: "Open SOS Log Organizer",
    icon: "pi pi-align-left",
    function: openOrganizer,
  }],
  menuCommands: [{ path: ["Sick Ollie"], commands: ["soloLog.openOrganizer"] }],
  async setup() {
    ensureStyle();
    // Join the shared Studio hub when the Sick Ollie pack is installed, while
    // preserving the standalone sidebar for users running only this extension.
    setTimeout(() => {
      if (typeof window.SickOllieRegisterSoloHubItem === "function") {
        window.SickOllieRegisterSoloHubItem({ id: "log-organizer", label: "Log Organizer", description: "Clean, classify, rename, and organize Prompt Core logs.", color: "#68ff92", open: openOrganizer });
      } else registerSidebar();
    }, 250);
  },
  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== "SOLO_Log_Organizer") return;
    const original = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      const result = original?.apply(this, arguments);
      this.color = "#2a1830";
      this.bgcolor = "#130f19";
      const button = this.addWidget("button", "Open Log Organizer", null, () => openOrganizer());
      button.serialize = false;
      this.setSize([320, 88]);
      return result;
    };
  },
});

export { openOrganizer };
