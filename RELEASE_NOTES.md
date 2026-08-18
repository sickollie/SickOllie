# SICK OLLIE Creator Studio + Toolkit — Release Notes

These notes cover the meaningful user-facing changes in **v3.0.0** since the previous public release, **v2.0.0**, which introduced the first generation of Studio Nodes.

## Headline changes

### SICK OLLIE is now a connected studio system

The Studio graph, visual catalogs, review state, organizers, and metadata now share useful context. A LoRA can move from Loader Core to a resolved prompt, generation, output metadata, Preview, Library review, and a reusable Recipe without rebuilding the setup at each step.

### One SOS hub, four major interfaces

The ComfyUI sidebar now provides a single **SOS** command center for:

- **LoRA Library** — visual browsing, review, thumbnail, usage, quarantine, and Yearbook workflows
- **Recipe Catalog** — prompt-first setup saving, metadata import, comparison, and selective apply
- **LoRA Organizer** — preview-first naming, folder planning, duplicate review, cleanup, and undo
- **Log Organizer** — Prompt Core log cleanup, classification, deduplication, renaming, archive, and undo

The organizers also remain available as compact launcher nodes.

## Studio Node expansion

### Loader Core

- Added hierarchical folder scope, nested-folder inclusion, epoch and Library-state filters.
- Added name, usage-count, and recent-use sorting.
- Added Favorite, Keep, Retest, and Reject review states directly beside the main LoRA.
- Added status-colored LoRA choices: deliberate ratings take priority, tested/unrated entries appear neutral, and untested entries remain muted.
- Added a dynamic stack of up to ten secondary LoRAs with enable, strength, clear, and information controls.
- Added main/secondary model-information buttons and one-click trigger copy.
- Expanded trigger discovery across explicit safetensors metadata, usable tag frequency data, adjacent sidecars, and exact-hash Civitai results.
- Tightened automatic trigger selection: short safe candidates may be selected, while long, weighted, or recipe-like strings stay available for review instead of being silently injected. `modelspec.title` remains identity information, not a trigger.

### Prompt Core

- Added a visual Prompt Assembly system for `NAME`, Outfit A/B/C, `SCENE`, configurable `ITEM`/`BRAND`, and `TRIGGER` values.
- Added Smart, Placeholder Only, Append, Prepend, and Off placement behavior with visible status and warnings.
- Added placeholder insertion buttons and safe `OUTFIT`/`OUTFIT_A` alias handling.
- Connected NAME, ITEM, Prefix, and Suffix values now show their source and are protected from accidental editing.
- Added Trigger Setup for connected Loader triggers, detected evidence, manual overrides, placement, and trigger-off workflows.
- Missing saved prompt/outfit/scene logs now self-heal to `[None]`; a missing active Prompt Log falls back to Manual.
- Component indexes advance only when the component actually participates in the resolved prompt.
- The Resulting Persistent Prompt now lives directly in Studio Prompt Core.

### Generation Core

- Added the width/height **swap** control.
- Consolidated encoder, VAE, canvas, sampling, batch, and seed controls into the Studio dashboard.
- Added clear Random each run, New fixed random, Use last queued, and copy-last-seed actions.
- Retained optional external conditioning while supporting normal internal prompt encoding.

### Output Core

- Added Auto Context to discover recognized upstream Studio state without a large metadata wiring bundle.
- Expanded variable-driven output folders and filenames with visible resolved values and copy feedback.
- Added PNG/JPG/WebP saving with independent prompt, workflow, and Civitai metadata choices.
- Added structured SICK OLLIE runtime metadata, resource hashes, resolved indexes, trigger/context, and actual-generation settings.
- LoRA use/test history is recorded only after an output is saved successfully.

### Preview Core and Image Metadata Core

- Rebuilt Preview as a compact visual toolbar with contain/cover/width/height/stretch/actual-size modes, solid/checker/blurred backgrounds, and editable color.
- Added persistent previews, Pin, side-by-side Compare, Clear, Library Thumb, and Recipe quick-save.
- Recipe quick-save and Library thumbnail assignment use the image actually displayed in Preview.
- Expanded image inspection for structured SICK OLLIE metadata with fallbacks for ComfyUI and A1111/Civitai metadata.

## LoRA Library and Yearbook

- Added a responsive 3:4 thumbnail gallery and detailed LoRA view backed by a shared catalog.
- Added local compact WebP thumbnails sourced from generated results, custom uploads, adjacent previews, Civitai showcases, or Yearbook.
- Added folder, epoch, rating/test, source, name, and usage filters.
- Separated tested/use history from intentional rating state.
- Added recent output history, detected triggers, creator/base/model details, and one-click Loader integration that preserves strength.
- Added Auto first image for blank thumbnails.
- Added filtered-scope Yearbook generation with source-aware targets: missing, Civitai, generated non-Yearbook, non-Yearbook standardization, existing Yearbook rebuild, or all.
- Yearbook now restores temporary Loader/Prompt state and stops active or delayed queues when stopped or closed.
- Added recoverable quarantine for a LoRA and recognized adjacent sidecars.
- Added scoped thumbnail clearing and catalog purge/rebuild tools that do not delete LoRAs, sidecars, recipes, or saved settings.
- Excluded Civitai videos from image candidates and added recovery for stale/missing thumbnail caches.

## Recipe Catalog

- Added prompt-first recipe saving from current Studio state or directly from Preview.
- Added import of metadata-bearing PNG, JPG, and WebP files.
- Added recovery from structured Studio metadata, Preview runtime state, expanded ComfyUI API graphs, common Classic/legacy workflows, and A1111/Civitai parameters.
- Prompt Log recipes retain the exact source line that ran as a reusable Manual template, including placeholders.
- Default recipes focus on prompt assembly, active substitutions/additions, dimensions, and the actual seed.
- Model, LoRA, encoder, and VAE values are optional and begin unchecked for portability.
- Added Review & Apply with readable current/incoming values, per-value choices, and connected-field protection. Applying a recipe never replaces the canvas.
- Preview metadata is authoritative, preventing auto-advanced indexes from saving the values prepared for the next queue.

## Organizers

### LoRA Organizer

- Added preview-first scans using safetensors metadata, fresh SHA-256 hashes, and optional Civitai lookup.
- Added editable Base → Category → Creator planning, smart rename behavior, `Other` handling for one-offs, and `Uncharted` for unidentified files.
- Added no-overwrite apply, recognized-sidecar moves, progressive manifests, and undo.
- Added exact-duplicate review with keeper protection and fresh revalidation.
- Added orphan-sidecar and empty-folder cleanup previews.
- Confirmed cleanup uses the operating system’s recoverable Trash/Recycle Bin and never falls back to permanent deletion.

### Log Organizer

- Added cleanup for blanks, structural headings, numbering, and exact duplicate resolved lines.
- Added standalone `SICK DOLLS` → `BRAND` conversion.
- Added compact Prompt Core-compatible classification for outfits, prompts, scenes, values, templates, masters, fragments, and Needs Review.
- Added readable filename polish with token contracts and resolved counts.
- Added editable preview, timestamped original archive, safe apply, Undo Last, CSV audit export, and empty-folder cleanup.
- Removed the special `girl` / `girls` filter and destination. Those words now use normal prompt classification.

## Reliability and quality-of-life highlights

- Missing-log recovery instead of queue-blocking stale selections.
- Trigger placement activates correctly when a candidate is chosen.
- Preview compare uses a true side-by-side reference pane.
- Custom recipe naming no longer depends on unsupported browser `prompt()`.
- Recipe values and thumbnail now come from the same displayed result.
- Safer cancellation and state restoration during Yearbook runs.
- Clearer copy feedback, information buttons, state colors, and dashboard warnings.
- Lower-cost Library rendering by removing full-screen backdrop blur.
- Corrected starter workflows and current installation/documentation paths.

## Registration and compatibility changes

The current release registers:

- **Classic:** Loader, Prompt, Generation, Output, Persist
- **Studio:** Loader, Prompt, Generation, Output, Preview, Image Metadata
- **Utilities:** LoRA Organizer and Log Organizer launchers

Classic Preview, Classic Image Metadata, and Studio Persist are no longer registered. In v3, workflows containing the old Classic `SOFitPreview` type automatically upgrade it in place to `SOFitPreviewStudio` before missing-node detection. Node IDs, connections, positions, widget values, properties, and stored previews are preserved; save the opened workflow once to persist the new type.

Older Classic Image Metadata and Studio Persist nodes may still appear missing. Use Studio Image Metadata and Studio Prompt Core’s built-in persistent resolved-prompt display as appropriate.

## Update guidance

Replace the old extension directory with the clean release folder rather than merging over stale files. Keep `ComfyUI/user/SickOllie/` and `ComfyUI/input/SickOllieLogs/`; those locations contain catalog state, ratings, recipes, thumbnails, and prompt libraries outside the extension.

After updating, restart ComfyUI completely and hard-refresh the browser.

## Validation performed for v3

- Python unit suite: 39 tests passed
- Studio frontend behavior suite: passed
- Python byte-compilation: passed
- JavaScript syntax checks: passed
- Clean package contents: verified by the release-packaging audit
- Legacy Preview workflow migration: passed for root and nested Preview nodes

Manual ComfyUI smoke testing on the supported frontend and target operating systems is still recommended before publishing.
