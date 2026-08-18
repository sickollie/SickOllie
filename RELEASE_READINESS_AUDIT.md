# SICK OLLIE Creator Studio + Toolkit — Release Readiness Audit

Audit date: 2026-08-18  
Comparison baseline: previous public GitHub release v2.0.0, commit `b3c8404561549ee03d3f329aac8a40461fbbfc0c`  
Release version: 3.0.0

## Outcome

**Code/static readiness: good, with a final manual ComfyUI smoke test still recommended.**

The current implementation is substantially larger than the first Studio release but is internally coherent: Studio nodes share context with Preview, Output, LoRA Library, Recipe Catalog, and Yearbook; both organizers use preview/revalidation/recovery-first designs; and the current registered-node set is reflected in the rewritten README and starter workflows.

No broad refactor was performed. The release changes are limited to the requested Log Organizer rule removal, regression coverage, documentation/starter corrections, and packaging polish.

## Current public surface

| Area | Registered/current surface |
| --- | --- |
| Classic nodes | Loader, Prompt, Generation, Output, Persist |
| Studio nodes | Loader, Prompt, Generation, Output, Preview, Image Metadata |
| Utility nodes | LoRA Organizer launcher, Log Organizer launcher |
| SOS interfaces | LoRA Library, Recipe Catalog, LoRA Organizer, Log Organizer |

Total registered nodes: **13**.

## Important changes since v2.0.0

1. A unified SOS sidebar hub and two integrated organizer launchers.
2. A visual LoRA catalog with review ratings, tested/use history, source-aware thumbnails, quarantine, catalog maintenance, and Yearbook automation.
3. A prompt-first Recipe Catalog with metadata imports and protected selective apply.
4. Loader filtering/sorting, status colors, safer triggers, information controls, and expanded secondary-LoRA management.
5. Prompt Assembly for NAME, Outfit A/B/C, Scene, ITEM/BRAND, and Trigger, with explicit placement and persistence behavior.
6. Output Auto Context and structured metadata; Preview pin/compare/catalog actions; richer image metadata inspection.
7. Preview-first LoRA and Log organization with revalidation, collision safety, and recovery paths.
8. Numerous smaller UX improvements: dimension swap, copy feedback, log self-healing, clearer warnings, and safer cancellation/restoration.

See `RELEASE_NOTES.md` for the curated feature-by-feature list.

## Release issues found and resolved

| Severity | Finding | Resolution |
| --- | --- | --- |
| High | `SickOllie_NodePack.json` referenced the unregistered Classic `SOFitPreview` node. | Replaced it with the current Studio starter and added regression assertions. |
| High | Older user workflows containing the removed Classic `SOFitPreview` could open with a missing node. | Added a pre-configuration migration to `SOFitPreviewStudio` that preserves IDs, links, layout, widgets, properties, and stored previews, including nested workflows. |
| High | The uploaded project root contained a 32 MB `--help` archive, private notes/files, caches, compiled Python, a JS backup, and a duplicate root PDF. | Confirmed the maintained packaging script excludes them; the clean release was built from that script. |
| Medium | The source README was very long and contained stale or contradictory behavior, including outdated starter guidance and trigger wording. | Rewritten around the current connected system and verified implementation. |
| Medium | `Starter Content/INSTALL STARTER CONTENT.txt` claimed the scenes folder was empty and pointed users only to the stale generic workflow and older guides. | Updated to the two current workflows, actual starter logs, and current README. |
| Medium | Organizer guides still described separate custom-node packages, old menu/sidebar labels, missing validation files, and obsolete JS paths. | Corrected for the bundled toolkit and current SOS launchers/files. |
| Medium | `THIRD_PARTY_NOTICES.md` named a source file that does not exist. | Corrected to the actual Loader frontend files. |
| Requested | Log Organizer created a special `girl` / `girls` filter/destination. | Removed from backend models/routing/audit and frontend summaries; added routing tests. |
| Low | The release packager default used the placeholder name `vNEXT`. | Changed the default to `ComfyUI-SickOllie-release.zip`. |

## Conservative findings left unchanged

### Backing modules for removed registrations

Classic `preview_core.py` and `metadata_core.py` remain necessary because the registered Studio implementations subclass them. They are not dead code and should not be removed.

`studio_persistent_resolved_prompt.py` and `js/studio_persistent_resolved_prompt.js` appear unregistered and superseded by Studio Prompt Core’s persistent resolved-prompt display. They do not block the release and were left untouched to avoid unexpected compatibility breakage. Consider removing them only in a separately tested cleanup release.

### Legacy visual guides

The PDFs and workflow-map artwork under `docs/` predate several current Library, Recipe, Organizer, Prompt Assembly, and Preview systems. They remain useful as historical visual references but should not be presented as complete current manuals. The starter guide now labels them as legacy.

Decision needed: keep them in the public archive as legacy references, move them to a clearly named `docs/legacy/` directory, or omit them from the release.

### Organizer internal version numbers

The bundled LoRA Organizer and Log Organizer report their own engine versions (`0.1.3` and `0.3.0`) while the node pack reports `3.0.0`. This is not a runtime problem, but users may read the numbers as prototype quality or mistake them for the pack release. Consider either documenting them explicitly or aligning component-version policy in a future release.

## Packaging findings

The supplied development zip should **not** be published directly. It contains local/private/cache artifacts and redundant large files.

The clean packaging script excludes:

- `.cache`, `.pytest_cache`, `.git`, and `__pycache__`
- compiled `.pyc` and backup `.bak` files
- `--help`, `PRIVATE`, private/development note files
- the duplicate root reference-guide PDF
- runtime extension-root `data/`

The release archive preserves the required `ComfyUI-SickOllie/` top-level folder.

## Validation performed

| Check | Result |
| --- | --- |
| `python -m unittest discover -s tests -v` | Passed — 39 tests |
| `node --test tests/test_studio_frontend.mjs` | Passed |
| `python -m compileall -q .` | Passed |
| `node --check js/*.js` | Passed |
| Starter workflow registration assertions | Passed |
| Legacy Preview migration, including nested nodes | Passed |
| Release archive exclusion/required-file audit | Passed after packaging |

`pytest` is not installed in the inspection environment; the project’s Python tests use `unittest` and ran successfully through that runner.

## Recommended manual pre-release smoke test

1. Install the clean archive into a fresh/current ComfyUI with current rgthree-comfy.
2. Open both Studio and Classic starter workflows; confirm no missing nodes.
3. Queue one Studio generation and verify resolved prompt, actual seed, Output path, Preview, embedded metadata, and Library usage event.
4. Exercise a main LoRA rating/filter/color change and one secondary LoRA information button.
5. Save a Preview Recipe, change one safe value, and Review & Apply it.
6. Run a two-item Yearbook batch, stop during/after a queue, and confirm Loader/Prompt settings restore.
7. Run both organizers against disposable folders through Scan → Apply → Undo.
8. Verify native Trash behavior on each operating system you intend to claim as tested.
9. Restart ComfyUI and confirm Library/Recipe persistence from `ComfyUI/user/SickOllie/`.

## Items requiring Ollie’s input

- Decide whether legacy PDFs/workflow-map artwork remain in the release archive.
- Confirm the current ComfyUI and rgthree-comfy versions used for your final smoke test, if you want exact tested-version claims in the README.
- Provide current UI screenshots if the README should include more than the supplied poster.
- Confirm whether to remove the unregistered Studio Persist source files in a later cleanup; this audit recommends leaving them for this release.
