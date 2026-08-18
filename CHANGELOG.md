# Changelog

## 3.0.0 — 2026-08-18

- Added an in-place workflow migration from the removed Classic `SOFitPreview` type to `SOFitPreviewStudio`. Old workflow IDs, links, positions, widget values, properties, and stored previews are preserved, including Preview nodes nested in subgraphs.
- Rewrote the public README around the connected Studio workflow, SOS interfaces, current node registration, installation, storage locations, and curated changes since the first Studio release.
- Replaced the stale generic starter workflow with the current Studio starter and corrected the starter-content guide.
- Removed the special `girl` / `girls` filter and destination rule from Log Organizer. Those words now follow normal prompt classification instead of creating a dedicated bucket.
- Corrected stale organizer installation text, launcher names, validation commands, and third-party source-file references.

## 2.4.1 — 2026-08-17

### Studio Hub visual refresh
- Rebuilt the SOLO Studio Hub side panel around the new Sick Ollie header, neon tool glyphs, and dark sicktype background artwork.
- Hub tools now use a deliberate cyan / magenta / yellow / green accent sequence for LoRA Library, Recipe Catalog, LoRA Organizer, and Log Organizer.
- Replaced the plain rows with richer tool cards featuring icon wells, compact descriptions, accent rails, focus states, and lightweight hover/press feedback without GPU-heavy backdrop blur.

### Catalog maintenance + Yearbook targeting
- Added **Catalog tools** with scoped thumbnail-cache clearing and **Purge + rebuild** for current filtered results, the selected folder tree, or the entire LoRA Library catalog. Purges reset only LoRA Library asset data and cached thumbnails; LoRA files, adjacent sidecars, Recipe Catalog entries, saved filters, and shared token settings are preserved.
- Yearbook now offers source-aware target modes: fill missing, replace Civitai, replace generated non-Yearbook, standardize non-Yearbook, rebuild existing Yearbook, or replace every thumbnail.
- **Standardize non-Yearbook** preserves custom images and existing Yearbook portraits while bringing missing/Civitai/generated/local automatic thumbnails into the Yearbook look.

### LoRA Library / Yearbook stability
- Yearbook no longer changes Loader Core Folder Scope or Include Subfolders, eliminating repeated Loader collection/filter refreshes and preventing Library runs from leaving Include Subfolders disabled afterward.
- Yearbook and Library **Load LoRA** actions preserve the current primary LoRA strength instead of forcing `1.0`; Yearbook still pins queue progression to `fixed` only for the duration of the run.
- Stopping Yearbook now cancels all delayed Yearbook timers, interrupts an active Yearbook execution, prevents a delayed next queue from sneaking through, and waits for an in-flight queue serialization call before restoring temporary values.
- Closing the LoRA Library stops an active Yearbook run instead of allowing the window-level Preview listener to continue auto-queueing invisibly.
- Library text fields now isolate keyboard events from ComfyUI/LiteGraph canvas shortcuts and explicitly release focus when dialogs close.
- Removed full-screen `backdrop-filter` blur from the Library and its dialogs to reduce browser GPU-compositor work during heavy inference.

### Civitai showcase media
- Civitai showcase videos are now excluded from thumbnail candidates. Models whose first showcase item is an MP4 automatically fall through to the first JPEG/PNG/WebP/GIF instead of feeding video bytes into Pillow.
- Existing catalog records are sanitized at read time, so older databases with an MP4 in `images[0]` recover without a database reset or rescanning.
- Remote thumbnail downloads reject non-image HTTP responses before Pillow decoding, preventing unrelated image-plugin/dependency fallbacks from being triggered by video content.

### Thumbnail truth and recovery
- Gallery filters, source badges, Civitai fill, and Yearbook now share one definition of a usable thumbnail: a renderable local cached thumbnail. Remote Civitai metadata alone is labeled **CIVITAI READY** and correctly remains eligible for missing-only Yearbook runs.
- Stale thumbnail database records whose cached WebP has disappeared are detected and repaired during scans and Preview capture instead of leaving permanently blank cards.
- Civitai fill now reports failed cache attempts in the Library status/console instead of silently swallowing every error.

## 2.4.0 — 2026-08-16

### Visual LoRA Library
- Replaced the crowded review list with a responsive thumbnail gallery and full LoRA entry view.
- Added compact local WebP thumbnails capped at 384×512 and 160 KB, with recorded provenance for generated, custom, local-sidecar, and cached Civitai images.
- Scans common adjacent preview images and Civitai sidecars without copying full-size sources. Civitai showcase URLs remain remote until explicitly cached.
- Added custom-thumbnail upload, Civitai showcase selection, clear-local-default, detected triggers, model/creator/base metadata, recent output history, aggregate use statistics, and recoverable quarantine actions.
- Added a one-click **Load LoRA · 1.0 · fixed** action targeting the active Loader Core.
- Kept Favorite, Keep, Retest, and Reject controls visible on every gallery card.

### Generated thumbnail workflow
- Studio Preview Core adds **★ LORA** to set the displayed image as the active main LoRA's default thumbnail.
- **Auto first image** captures the first Preview result only when the active LoRA has no local default thumbnail; it is enabled by default and can be toggled in the library.
- Added a filtered-scope Yearbook runner with a user-editable prompt, missing-only or replace-all modes, shuffled LoRA order, optional automatic queueing, fixed 1.0 strength, and restoration of the prior Loader/Prompt settings on finish or stop.

### Filters, sizing, and packaging
- Replaced free-text library filtering with a hierarchical Folder Scope picker plus Epoch, rating/test-state, thumbnail-source, and sort controls.
- LoRA Library and Recipe Library now use the same full organizer-sized surface as the LoRA and Log Organizers.
- Bundled both SOLO organizers and their launcher nodes directly into the master Sick Ollie pack.
- Removed Classic Preview Core, Classic Image Metadata Core, and Studio Persist + Display Resolved Prompt from registration.
- Added per-generation usage events while preserving all existing aggregate tested/use counts and deliberate rating state.

## 2.3.4 — 2026-08-16

- Studio Prompt Core now self-heals stale Prompt/Outfit/Scene log selections restored from old workflows, output-image metadata, or recipes. Missing files are replaced with `[None]` before queue validation; a missing active Prompt Log also falls back to Manual instead of blocking the workflow.
- Fixed the doubled `TRIGGER value` text at Prompt Core's force-input socket while preserving the native socket and connected green dashboard label.
- Trigger Builder now exposes placement controls directly. Choosing a detected trigger or `Use connected Loader value` automatically changes an `Off` trigger to `Smart`, so `{TRIGGER}` is actually replaced instead of silently removed. v12 workflows that already contain a pinned trigger override from the broken builder are migrated from `Off` to `Smart`.
- Trigger Assembly now shows the selected trigger even when placement is Off, making disabled state easier to diagnose.
- Added frontend regression coverage for missing-log recovery, trigger activation, and the single-label trigger socket.

## 2.3.3 — 2026-08-16

- Recipe quick-save now treats the image currently displayed in Preview Core as the authoritative source for the recipe, so auto-advanced Prompt/Outfit/Scene indexes cannot accidentally save the values prepared for the next queue.
- Preview Core temporary PNG metadata now recovers the resolved prompt assembly, resolved seed, dimensions, encoder/VAE values, and Loader/LoRA runtime fields even before Output Core has created the consolidated `so_image_metadata` block.
- A successful Preview-backed save always derives both the recipe values and thumbnail from the same displayed image, eliminating the previous thumbnail-verification mismatch caused by post-queue widget advancement.
- Current-node fallback capture now prefers Prompt Core's last executed assembly state instead of post-queue widget indexes when no usable Preview image is available.
- Added regression coverage for Preview runtime metadata recovery, previous-vs-next prompt/outfit indexes, and resolved seed capture.

## 2.3.2 — 2026-08-16

- Current Studio recipe saves now try to attach the image currently shown in Preview Core as the recipe thumbnail.
- Preview thumbnails are only attached after embedded image metadata verifies against the recipe being saved, including prompt/log selections, resolved dimensions/seed, and available model/LoRA resource fields; stale or mismatched previews are skipped rather than mislabeled.
- Preview Core quick-save passes its exact current image to the Recipe Catalog; Catalog saves use the most recently updated Preview Core when one is available.
- Added a Loader Core `[✓ Tested]` Library filter. It includes LoRAs with durable test/use history while excluding items explicitly marked Retest.
- In the Main LoRA chooser, tested-but-unrated LoRAs now render in white, untested LoRAs remain muted, and deliberate Favorite/Keep/Retest/Reject colors still take precedence.
- Added regression coverage for verified recipe thumbnails and the new Tested filter styling.

## 2.3.1 — 2026-08-16

- Replaced the browser-native `prompt()` used by Recipe Catalog and Preview Core quick-save with a ComfyUI-safe custom recipe-name dialog, fixing `prompt () is not supported.` on save.
- Preview Core compare now opens a full-size pinned reference pane to the right of the live preview instead of overlaying tiny thumbnails on the image.
- Compare expands the node only while a pinned reference is being shown and collapses back to the saved preview width when Compare is off or pins are cleared.
- The live and pinned panes share the same fit/background behavior and resize together.
- Added frontend regression checks for the custom recipe dialog and side-by-side compare layout.

## 2.3.0 — 2026-08-16

### Prompt-first Recipe Catalog
- Recipe defaults now contain only the source prompt that actually ran, the used log files and resolved indexes locked to `fixed`, active substitutions/prefix/suffix, output dimensions, and the resolved seed.
- Unused Manual/Log fields, missing or inactive outfit/scene streams, cleanup rules, Output settings, and empty or disabled LoRA slots are omitted.
- Diffusion model, active LoRAs, text encoder, and VAE remain available behind an explicit optional-resources switch and start hidden and unchecked.
- Fixed current-Studio saving, added Preview Core quick-save, and added clear status/error feedback.
- Generic workflow imports now prefer output pixel dimensions when multiple latent branches are ambiguous; this fixes the dormant `1600x400` branch repro while preserving structured Studio runtime dimensions.

### Library states and Loader filters
- Tested/use history is now independent from deliberate ratings: tested is neutral, Keep is a 3-star green rating, and Favorite is a 4-star rating.
- Keep, Favorite, Retest, and Reject toggle off; Clear Rating preserves tested history; Reset All explicitly clears both rating and tested/use history.
- Favorites and Untested / Retest are now a separate Loader filter that applies inside any selected real folder, alongside the Epoch filter.
- Added Name, Most Used, Least Used, and Recently Used sorting to Loader Core, plus matching Library Review sorting.

### Preview Core
- Replaced the long native control/button stack with a compact two-row Studio dashboard for fit, background, color, pin, compare, clear, and prompt-recipe save actions.
- Kept Preview Core pixel-pass-through behavior and stored/pinned preview compatibility unchanged.

## 2.2.0 — 2026-08-16

### Recipe Catalog
- Imports current Studio metadata, expanded Comfy API subgraphs, common legacy nodes, and A1111/Civitai `parameters` metadata into reusable Studio recipes.
- Runtime Sick Ollie metadata takes precedence over queued widget values, so random generations restore their resolved seed rather than `-1`.
- Prompt Log outputs become Manual templates using the exact selected source line, retaining placeholders such as `NAME`, `BRAND`, and `OUTFIT` instead of baking in their resolved values.
- Recovers common prompt, model, LoRA, LoRA strength/hash, text encoder, VAE, sampler, scheduler, CFG, steps, denoise, shift, dimensions, batch, and output settings where present.
- Review & Apply now uses named human sections, readable before/after values, per-value checkboxes, connected-field protection, and safe defaults that leave diffusion model, output root, and carried placeholder values unchecked.
- Corrected Studio Generation and Output node identities and retained aliases for recipes made by earlier preview builds.

### Library Review and Loader integration
- Successful Output Core saves automatically record applied LoRAs as tested, including use count, last-use time, and last output path.
- Deliberate Favorite, Keep, and Reject choices survive later generations; Retest returns to tested after the next completed run.
- Loader Core adds virtual `Favorites` and `Untested / Retest` pools, status-colored LoRA choices, and compact Favorite/Keep/Retest/Reject controls beside the main LoRA selector.
- Library Review actions now provide immediate selected-state feedback, optional device vibration, clearer usage information, a Tested filter, and the exact quarantine destination.
- Closing Library Review clears its temporary search and state filters.

### Safety and compatibility
- Quarantine remains recoverable and moves a LoRA plus adjacent recognized metadata sidecars into `ComfyUI/user/SickOllie/quarantine/<timestamp>`.
- Classic node layouts remain unchanged; automatic completed-run tracking is driven by Studio Output Core.
- Added recipe runtime-overlay, catalog usage-state, and frontend identity/control regression coverage.

## 2.1.2 — 2026-08-15

### Studio live links and spacing
- Reworked the Prompt Source frame geometry so its cyan bottom edge and rounded corner clear the Prompt Log Mode/Index controls by 18 pixels.
- Loader Core now publishes its current frontend `clean_name`, raw stem, trigger, and folder previews whenever the selected LoRA or clean-name choice changes.
- A linked Studio Prompt Core NAME/ITEM/Prefix/Suffix field now prefers an available upstream live preview, updating immediately without queueing the workflow.
- The resolved-prompt panel intentionally remains execution-backed, distinguishing live input previews from the prompt that actually ran.

### Compatibility and validation
- Live previews are frontend-only; the underlying graph links, backend values, serialization, and generated prompts remain unchanged.
- Connections from nodes that do not publish a live preview continue to show their most recently executed value.
- Added regression coverage for frame clearance and live linked-value refreshes.

## 2.1.1 — 2026-08-15

### Studio refinements
- Moved the redesigned Loader, Prompt, Generation, and Output lockups to versioned asset paths so cached earlier PNGs cannot survive an update.
- Connected Prompt Prefix and Suffix fields now use the same locked, source-aware presentation as connected NAME/ITEM values.
- The visible ITEM socket and Prompt Assembly label now follow the configured placeholder—for example, changing `ITEM` to `BRAND` displays `BRAND value` and `BRAND` without changing workflow connection semantics.
- Added more cyan bottom padding beneath Prompt Source's Mode and Index controls.

### Compatibility and validation
- Kept the underlying `item_value` input name stable so existing links, workflows, and backend contracts remain compatible.
- Added frontend regression coverage for dynamic placeholder labels, connected Prefix state, Prompt Source padding, and versioned header assets.

## 2.1.0 — 2026-08-15

### Studio Prompt Assembly
- Reworked Studio Prompt Core around a visible assembly summary for NAME, Outfit A/B/C, Scene, and ITEM.
- Added per-component placement modes: Smart, Placeholder Only, Append, Prepend, and Off.
- New Studio nodes use Smart placement: replace a recognized placeholder when present, otherwise append the selected line.
- Existing saved Studio workflows migrate to Placeholder Only so updating cannot silently change their resolved prompts.
- Outfit A recognizes both `OUTFIT_A` and the legacy `OUTFIT` shorthand, including braced forms such as `{OUTFIT_A}`.
- Replaced substring replacement with boundary-safe alias matching so `OUTFIT` cannot corrupt `OUTFIT_A`.
- Added prompt-editor insertion buttons for NAME, Outfit A/B/C, Scene, and ITEM.
- Connected NAME/ITEM values now display their upstream node/output and become read-only while linked.
- Added visible warnings for missing logs, empty logs, unused placeholders, and components not placed in the active prompt.
- Component indexes now advance only on generations where that component actually participated.

### Studio polish
- Installed the revised 1600×320 Loader, Prompt, Generation, and Output header lockups.
- Headers now detect and fit their visible artwork instead of cropping a fixed source rectangle.
- Increased the shared Studio header safe area so lower lettering and glow cannot be clipped.
- Added a `⇄` button between Generation Core's custom Width and Height controls.

### Compatibility and validation
- Classic node layouts and Prompt Core behavior remain unchanged.
- Retained the shared Classic + Studio Civitai trigger fallback introduced in 2.0.1.
- Added backend assembly tests, frontend alias/migration tests, and Generation dimension-swap coverage.

## 2.0.1 — 2026-08-15

### Studio visuals
- Added supplied Sick Ollie branded headers to Loader, Prompt, Generation, and Output Core.
- Unified the four Studio Core nodes around one Organizer-inspired palette, width, header, socket bay, row rhythm, and section spacing system.
- Replaced overlapping CMYKG perimeter frames with restrained section accents and explicit gaps.
- Moved Studio input/output sockets and cable anchors below the branded header without changing graph semantics.
- Kept all Classic node drawing and layout behavior unchanged.

### Classic + Studio trigger resolution
- Added a shared Civitai fallback for LoRAs whose safetensors metadata does not declare a usable trigger.
- Checks common adjacent Civitai JSON sidecars first, then performs an exact SHA-256 model-version lookup and reads Civitai `trainedWords`.
- Preserves trigger punctuation, including ampersands, while normalizing HTML entities and whitespace.
- Caches positive and negative lookups by file identity and moves web-route resolution off ComfyUI's async event loop.
- Added automated coverage for source priority, sidecars, exact-hash API results, caching, and special-character triggers.

## 2.0.0 — 2026-08-10

### Classic + Studio
- Split the pack into **Sick Ollie / Classic** and **Sick Ollie / Studio** node families.
- Classic keeps the original registered node IDs and v1-style wiring for workflow and PNG compatibility.
- Studio uses independent node IDs and the redesigned dashboard workflow.

### Classic updates
- Added **shuffle** cycling: random order with no repeats until every eligible value has been used once.
- Added shuffle independently to main LoRAs, Prompt, Outfit A/B/C, and Scene.
- Added usable nonblank line counts for prompt/outfit/scene logs.
- Added searchable `index · line preview` selectors for Prompt, Outfit A/B/C, and Scene.
- Improved clean-name candidate generation for varied LoRA filename structures.
- Added `main_folder` for the active main LoRA's immediate parent folder.
- Added optional external positive and negative conditioning inputs to Generation Core.
- Added structured resolved metadata with usage-aware prompt/outfit/scene logging.

### Studio
- Added custom CMYKG dashboard interfaces for Loader, Prompt, Generation, Output, and Image Metadata Core.
- Added hierarchical folder/log browsing and filtered LoRA pool counts.
- Added streamlined Studio graph sockets and automatic upstream context collection.
- Added integrated VAE decoding in Output Core via `samples + vae`.
- Added recipe-based subfolder and filename building with resolved-value displays.
- Added standalone **Image Metadata Core** with instant file inspection, drag/drop loading, copy actions, live workflow inspection, and structured metadata outputs.
- Added Studio defaults for Krea2-oriented generation when the preferred encoder/VAE are installed.

## 1.1.1
- Previous public release line.
