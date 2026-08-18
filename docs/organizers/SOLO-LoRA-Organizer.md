# SOLO LoRA Organizer for ComfyUI

SOLO — **Sick Ollie LoRA Organizer** — is a preview-first LoRA library manager integrated directly into ComfyUI.

It ships inside **SICK OLLIE CREATOR STUDIO + TOOLKIT** with:

- a compact `SOLO · LoRA Organizer` launcher node;
- a modern ComfyUI frontend extension with a full branded organizer overlay;
- a Python backend for metadata, hashing, Civitai lookup, planning, filesystem operations, and undo;
- the shared **SOS** sidebar hub and **Sick Ollie → Open SOS LoRA Organizer** command when supported by the installed frontend.

The organizer is an independent utility. It does not need to sit between model-loading or sampling nodes, and no workflow queue is required to scan or organize a library.

The bundled organizer engine reports version **0.1.3**. Its scan, planning, apply, duplicate, cleanup, native Trash, and undo paths are covered by the pack's automated tests. Always try filesystem tools on a copied or backed-up library first.

## Install

1. Install the complete toolkit as:

   ```text
   ComfyUI/
   └─ custom_nodes/
      └─ ComfyUI-SickOllie/
   ```

2. Restart ComfyUI and refresh the browser. No `pip` command, Manager dependency step, or third-party Python package is required.

3. Open SOLO in any of these ways:

   - add **Sick Ollie → Utilities → SOLO · LoRA Organizer** and press **Open Organizer**;
   - choose **Sick Ollie → Open SOS LoRA Organizer** from the top menu;
   - open the **SOS** sidebar tab and choose **LoRA Organizer**.

## Organizer workflow

```text
choose folder → scan → review/edit checked rows → confirm → apply
```

No organization scan changes files. A cancelled scan publishes no partial preview and performs no filesystem actions.

**Root rule:** the selected Source folder is always treated as the library root. Run organization from that root, not from inside an already-organized Base/Category folder. This keeps Base → Category → Creator routing deterministic.

### Organization rules

- Smart-clean filenames
- Creator folders
- Civitai category folders
- Base-model folders
- One-off creators in `Other` with creator-prefixed filenames
- Promotion to a dedicated creator folder at 2+ LoRAs
- Unidentified Civitai hash misses in `Uncharted`
- Optional recursive reprocessing of existing subfolders

### Identification and planning

- Reads SafeTensor metadata without loading model tensors
- Fresh SHA-256 hashing
- Public Civitai hash/version/model lookup
- Optional Civitai token
- JSON hash/model cache
- Civitai creator wins when supplied
- Existing creator-folder fallback when Civitai creator metadata is unavailable
- Series-aware version naming
- Preserves an existing clean identity filename inside a wrapped Civitai title, including cases such as `My Stars! - Maria | Krea2/ZIT Character`
- Editable proposed filename, base, and category
- `_vN` collision planning when renaming is enabled
- Move-only collision stop when renaming is disabled

### Apply and undo

- Revalidates sources and all destinations immediately before moving
- Moves known sidecars with their LoRA
- Writes a progressive undo manifest before the first move in every operation
- Restores the latest organization pass in reverse order
- Refuses to overwrite existing files
- Limits mutation paths to the selected LoRA library root

Recognized sidecars:

```text
Foo.json
Foo.metadata.json
Foo.civitai.info
Foo.preview.png
Foo.png
Foo.jpg
Foo.jpeg
Foo.webp
Foo.txt
Foo.safetensors.rgthree-info
```

### Exact duplicates

- Always scans the selected library recursively
- Groups byte-for-byte copies by fresh SHA-256
- Scores an already-organized-looking copy as the suggested keeper
- Checks redundant copies and leaves the suggested keeper unchecked
- Refuses removal if every surviving copy in a group is selected
- Re-hashes selected copies and the surviving keeper before removing anything
- Sends confirmed duplicate model files to the operating system's recoverable Trash / Recycle Bin
- Deliberately leaves sidecars untouched

### Orphans and empty folders

- Known strong sidecars are checked by default
- Generic same-stem candidates are shown unchecked for review
- Top-level empty folder trees are checked by default
- Every cleanup target is revalidated immediately before removal
- `.safetensors` files are never cleanup targets
- Confirmed items go to the operating system's recoverable Trash / Recycle Bin

### Native Trash backends

SOLO has no Python package dependencies and never substitutes permanent deletion when a Trash operation fails.

| Platform | Zero-dependency backend | Current validation |
| --- | --- | --- |
| Windows | Shell32 `SHFileOperationW` with undo/recycle flags | Automated contract test and confirmed on Windows |
| macOS | Foundation `NSFileManager trashItemAtURL` | Automated wrapper/dispatch tests; complete the included disposable-library smoke test on a Mac before trusting real data |
| Linux | FreeDesktop.org Trash specification, including `.trashinfo` metadata and volume Trash fallback | Automated file, folder, Unicode-path, collision, and failure-preservation tests |

On an unsupported operating system—or a Linux filesystem where no safe Trash directory can be established—SOLO leaves the item untouched and reports the failure. Scanning, planning, Apply, and Undo remain available.

## Settings and local data

SOLO stores settings, Civitai cache, and manifests under the ComfyUI user directory when available:

```text
ComfyUI/user/solo_lora_organizer/
```

It uses atomic JSON writes and does not add a SQLite database.

The optional Civitai token is only written to settings when **Save token locally** is enabled. A saved token is plain text, so do not enable that option on a shared or untrusted computer.

## Stop Scan

All three scan modes are cancellable. The scanner checks cancellation during folder discovery, SafeTensor reads, chunked SHA-256 hashing, planning, retry waits, and between Civitai requests. SOLO also closes the active Civitai connection when cancellation is requested.

## First-run smoke test

Use a disposable folder containing:

- one small `.safetensors` file with one or two matching sidecars;
- an exact byte-for-byte copy in another folder;
- one orphan `.preview.png` sidecar;
- one generic `.png` possible sidecar;
- one empty nested folder tree.

Verify Scan → Apply → Undo, exact-duplicate keeper safety, and cleanup revalidation before selecting a real library.

## Architecture

```text
ComfyUI frontend
├─ launcher node / sidebar / menu command
└─ branded HTML/CSS organizer overlay
        │ local API routes + cancellable job IDs
ComfyUI Python server
├─ SafeTensor metadata + SHA-256
├─ Civitai client + JSON cache
├─ naming / creator / category / base planner
├─ duplicates + orphan cleanup
└─ no-clobber move / native Trash / progressive undo manifests
```

The engine is deliberately split into ordinary Python modules so its planning and filesystem safety can be tested without launching ComfyUI.

## Development validation

From this folder:

```text
python -m unittest discover -s tests -v
python -m compileall -q .
node --check js/solo_lora_organizer.js
```
