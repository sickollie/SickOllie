# Changelog

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
