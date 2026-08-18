<p align="center">
  <img src="docs/SICK-OLLIE-CREATOR-STUDIO-TOOLKIT.png" alt="SICK OLLIE Creator Studio + Toolkit" width="720">
</p>

# SICK OLLIE CREATOR STUDIO + TOOLKIT

**A connected ComfyUI production system for LoRA testing, reusable prompt assembly, metadata-aware saving, visual cataloging, and safe library cleanup.**

SICK OLLIE turns a group of custom nodes into one repeatable workflow:

```text
choose a model + LoRA
→ assemble a reusable prompt
→ generate with a known seed and canvas
→ save traceable metadata
→ preview, compare, catalog, and review the result
```

The pack includes the streamlined **Studio** workflow, compatible **Classic** cores, a visual **LoRA Library**, a prompt-first **Recipe Catalog**, and integrated **LoRA** and **Log Organizers**.

## What’s new in this release

- **A complete SOS tool hub** in the ComfyUI sidebar for the LoRA Library, Recipe Catalog, LoRA Organizer, and Log Organizer.
- **Visual LoRA Library** with compact thumbnails, Civitai showcase caching, tested/use history, Favorite/Keep/Retest/Reject states, color-coded Loader choices, recoverable quarantine, and filtered Yearbook runs.
- **Prompt-first Recipe Catalog** that saves the setup used by the displayed image, imports metadata-bearing outputs, and applies selected values through a protected Review & Apply screen.
- **Expanded Loader Core** with folder/epoch/library filters, usage sorting, main-LoRA review controls, trigger resolution, trigger copy, LoRA information buttons, and a dynamic secondary-LoRA stack.
- **Visual Prompt Assembly** for `NAME`, three outfit streams, `SCENE`, a configurable `ITEM`/`BRAND` slot, and `TRIGGER`, with explicit placement behavior and visible warnings.
- **Upgraded Preview Core** with a compact toolbar, persistent previews, pin/compare, Library-thumbnail assignment, and Recipe quick-save.
- **Automatic legacy Preview upgrade** so workflows using the removed Classic `SOFitPreview` open as Studio Preview with their wiring, layout, settings, and stored previews preserved.
- **Integrated organizers** for safe LoRA naming/moves/duplicates and Prompt Core-compatible log cleanup, deduplication, classification, preview, apply, and undo.
- **Quality-of-life and reliability work** including branded dashboards, dimension swap, copy feedback, missing-log recovery, safer trigger selection, verified recipe thumbnails, cleaner Yearbook stopping/restoration, and Civitai video/stale-thumbnail recovery.

For the curated change list from the first public Studio release, see [RELEASE_NOTES.md](RELEASE_NOTES.md).

## Why install it?

SICK OLLIE reduces repeated setup and keeps useful information moving through the graph.

- Loader Core knows the exact LoRA file, its readable name, trigger, folder, and applied stack.
- Prompt Core can turn those values into reusable placeholder-driven prompts.
- Generation Core records the resolved seed and canvas that actually ran.
- Output Core carries that context into filenames, folders, workflow metadata, and Civitai-readable parameters.
- Preview, Library, and Recipe tools reuse the same result instead of asking you to rebuild it by hand.

The goal is not a single model-specific preset. It is a controlled system for testing, comparing, saving, and returning to generation setups without losing their context.

## Requirements

- A current ComfyUI installation using the LiteGraph workflow canvas
- Python 3.10 or newer
- [rgthree-comfy](https://github.com/rgthree/rgthree-comfy)

`rgthree-comfy` is required for Loader Core’s enhanced secondary-LoRA chooser and model-information interface. No additional `pip install` step is required for the pack itself; its remaining Python dependencies are already part of a normal ComfyUI environment.

Optional Civitai features require internet access. Public lookup works without a token in normal conditions; the LoRA Organizer also accepts an optional token in its settings.

## Installation

1. Close ComfyUI.
2. Extract the release archive.
3. Copy the folder named `ComfyUI-SickOllie` into:

   ```text
   ComfyUI/custom_nodes/
   ```

4. Confirm that `rgthree-comfy` is installed beside it.
5. Restart ComfyUI completely.
6. Hard-refresh the browser with `Ctrl+F5` if an older frontend is still cached.

The final layout should be:

```text
ComfyUI/
└── custom_nodes/
    ├── ComfyUI-SickOllie/
    └── rgthree-comfy/
```

Avoid an extra nested folder such as `ComfyUI-SickOllie/ComfyUI-SickOllie/`.

### Starter content

The release includes two starter workflows:

```text
Starter Content/workflows/Sick Nodes v2_Studio.json
Starter Content/workflows/Sick Nodes v2_Classic.json
```

`SickOllie_NodePack.json` is a convenience copy of the current Studio starter. Drag a workflow JSON onto the ComfyUI canvas, then select model, text-encoder, VAE, and LoRA files available on your machine.

Prompt and outfit examples are included under:

```text
Starter Content/input/SickOllieLogs/
```

Copy the whole `SickOllieLogs` folder into `ComfyUI/input/` to create:

```text
ComfyUI/input/SickOllieLogs/
├── prompts/
├── outfits/
└── scenes/
```

Restart ComfyUI and hard-refresh after adding or renaming log files.

## Five-minute Studio start

Add the five primary Studio nodes and connect them as follows:

```text
Loader Core model
    → Generation Core model

Loader Core clean_name
    → Prompt Core NAME value

Loader Core main_trigger
    → Prompt Core TRIGGER value

Prompt Core final_prompt
    → Generation Core positive_text

Generation Core samples + vae
    → Output Core samples + vae

Output Core images
    → Preview Core images
```

Then:

1. Select a diffusion model and LoRA in Loader Core.
2. Write a manual prompt or choose a Prompt Log.
3. Insert `NAME`, `OUTFIT`, `SCENE`, `ITEM`/`BRAND`, or `TRIGGER` where reusable values should go.
4. Choose the canvas, sampling settings, and seed behavior in Generation Core.
5. Set an output root and naming recipe in Output Core.
6. Queue once. The resolved prompt, actual seed, output path, Preview image, LoRA test history, and embedded metadata update from that completed run.

Output Core’s **Auto Context** reads recognized upstream Studio state from the workflow, so the Studio graph does not need the large metadata wiring bundle used by Classic.

## Nodes and interfaces

| Node or surface | Availability | Purpose |
| --- | --- | --- |
| Loader Core | Classic + Studio | Loads the diffusion model, applies primary/secondary LoRAs, cycles test pools, and exposes identity/trigger context. |
| Prompt Core | Classic + Studio | Builds final prompts from manual text or reusable prompt/outfit/scene logs. |
| Generation Core | Classic + Studio | Encodes, samples, resolves the canvas, and records the actual seed/settings used. |
| Output Core | Classic + Studio | Decodes or accepts images, builds paths, saves files, and embeds metadata. |
| Preview Core | Studio | Displays persistent previews, pins references, compares images, and launches catalog actions. |
| Image Metadata Core | Studio | Inspects image metadata and exposes normalized fields as outputs. |
| Persist + Display Resolved Prompt | Classic | Preserves and displays Classic’s resolved prompt string. |
| SOLO · LoRA Organizer | Utility launcher + SOS hub | Safely plans LoRA renames/moves and handles exact duplicates, orphans, and empty folders. |
| SOLO · Log Organizer | Utility launcher + SOS hub | Cleans, deduplicates, classifies, reorganizes, and audits Prompt Core text logs. |
| LoRA Library | SOS hub | Visual LoRA review, thumbnail, status, usage, filtering, quarantine, and Yearbook surface. |
| Recipe Catalog | SOS hub | Saves, imports, compares, filters, and selectively reapplies prompt-first Studio recipes. |

The current registered node families are:

```text
Sick Ollie
├── Classic
│   ├── Loader Core
│   ├── Prompt Core
│   ├── Generation Core
│   ├── Output Core
│   └── Persist + Display Resolved Prompt
├── Studio
│   ├── Loader Core
│   ├── Prompt Core
│   ├── Generation Core
│   ├── Output Core
│   ├── Preview Core
│   └── Image Metadata Core
└── Utilities
    ├── SOLO · LoRA Organizer
    └── SOLO · Log Organizer
```

## Studio Nodes

### Loader Core

Loader Core creates the model and LoRA context used by the rest of Studio.

Key capabilities:

- Hierarchical **Folder Scope** browser with optional nested-folder inclusion
- Independent **Epoch** and **Library** filters
- Sort by name, most/least used, or recently used
- Fixed, increment, decrement, random, and no-repeat shuffle testing modes
- Primary LoRA enable, strength, loop, skip-None, and off-state name controls
- Dynamic secondary-LoRA rows with enable, strength, model-info, and clear actions
- Main-LoRA **Favorite**, **Keep**, **Retest**, and **Reject** buttons
- Status-colored main-LoRA choices: deliberate ratings take priority, tested-but-unrated files appear white, and untested files remain muted
- Clean-name selection for prompt-friendly identity text while retaining the exact raw filename separately
- One-click trigger copy and main/secondary LoRA information buttons

Loader Core uses several names deliberately:

| Value | Meaning | Best use |
| --- | --- | --- |
| `main_file` | Exact selected LoRA path/filename | Resource tracing |
| `raw_stem` | Exact filename without extension | Reproducible output names |
| `clean_name` | Human-readable name after cleanup | `NAME` substitution and tidy folders |
| `main_folder` | Active LoRA’s immediate parent folder | Grouped output recipes |

#### Trigger resolution

Loader Core gathers trigger evidence from explicit safetensors trigger metadata, usable `ss_tag_frequency` candidates, adjacent Civitai sidecars, and an exact SHA-256 Civitai version lookup. Short, safe candidates may populate `main_trigger` automatically.

Long, weighted, or recipe-like trained words remain visible for review but are not injected automatically. `modelspec.title` is treated as an identity hint only—not an activation trigger. Prompt Core’s Trigger Setup lets you use the connected Loader value, choose detected evidence, type an override, select placement, or turn trigger injection off.

### Prompt Core

Prompt Core turns a source prompt plus reusable components into one resolved prompt.

Choose either:

- **Manual** — write directly in the prompt editor
- **Prompt Log** — select one usable line from a `.txt` library

Prompt, Outfit A/B/C, and Scene streams each support fixed, increment, decrement, random, and no-repeat shuffle behavior. Missing saved log paths self-heal to `[None]`; if the missing file was the active Prompt Log, Prompt Core falls back to Manual instead of blocking the queue.

#### Prompt Assembly

Each component has an explicit placement mode:

| Mode | Behavior |
| --- | --- |
| Smart / Auto | Replace a matching placeholder; otherwise append the component. `TRIGGER` Auto places the trigger at the beginning when no placeholder exists. |
| Placeholder Only | Replace only when the placeholder exists. |
| Append | Remove a matching placeholder and place the value after the prompt. |
| Prepend | Remove a matching placeholder and place the value before the prompt. |
| Off | Do not inject the component; remove its known placeholder if present. |

The assembly panel shows whether each component is active, missing, waiting for a placeholder, or not placed. Component indexes advance only when that component actually participates in the generated prompt.

#### Placeholder system

| Placeholder | Typical source |
| --- | --- |
| `NAME` or `{NAME}` | Loader Core `clean_name` or a manual value |
| `OUTFIT` / `OUTFIT_A` | Outfit A log |
| `OUTFIT_B` | Outfit B log |
| `OUTFIT_C` | Outfit C log |
| `SCENE` | Scene log |
| `ITEM` | Configurable extra substitution |
| `BRAND` | Common visible label for the configurable `ITEM` slot |
| `TRIGGER` | Loader trigger, detected candidate, or manual override |

The `ITEM` socket remains stable internally for workflow compatibility, but its visible label follows the configured placeholder—for example, changing it to `BRAND` updates the dashboard, socket label, and insertion button.

Connected NAME/ITEM/Prefix/Suffix fields are locked and identify their upstream source. Loader-linked NAME and trigger previews can update before a queue; the **Resulting Persistent Prompt** remains execution-backed and shows what actually ran.

### Generation Core

Generation Core combines text encoding, canvas setup, sampling, VAE loading, and seed control.

- Select text encoder, CLIP type/device, and VAE
- Use an aspect/megapixel preset or exact custom dimensions
- Swap custom width and height instantly with **⇄**
- Set batch, sampler, scheduler, steps, CFG, denoise, and shift
- Use internal prompt encoding or optional external positive/negative conditioning
- Choose **Random each run**, **New fixed random**, or **Use last queued**
- Copy the last resolved seed with visible feedback

Studio defaults are Krea2-oriented when the preferred local encoder and VAE are available, but the dropdowns fall back to files installed on the current machine.

### Output Core

Output Core accepts either:

- a decoded `IMAGE`, or
- `samples + vae` from Generation Core

When both are connected, `IMAGE` takes priority.

Key capabilities:

- Output root plus literal/variable subfolder and filename recipes
- Resolved previews for generated path segments
- PNG, JPG, and WebP output with quality and counter controls
- Independent prompt, workflow, and Civitai metadata toggles
- Upstream model/LoRA discovery and file hashing
- Structured SICK OLLIE runtime metadata
- Click-to-copy resolved names, model, folder, seed, trigger, indexes, and last save path
- Automatic LoRA tested/use-history recording only after a successful save

For the strongest ComfyUI round-trip support, use PNG with prompt and workflow metadata enabled.

### Preview Core

Preview Core passes the original `IMAGE` through while providing a persistent visual workspace.

- Fit modes: Contain + Upscale, Cover, Fit Width, Fit Height, Stretch, Actual Size
- Backgrounds: Solid, Checkerboard, Blurred Image
- Editable background color
- **Pin**, side-by-side **Compare**, and **Clear**
- **Library Thumb** to assign the displayed image to the active main LoRA
- **Recipe** to save the displayed image’s resolved Studio setup
- Stored preview restoration when reopening a saved workflow

Compare expands into a dedicated live/pinned two-pane layout and returns to the saved preview width when disabled or cleared.

### Image Metadata Core

Image Metadata Core can inspect a PNG, JPG, or WebP from an upload/drop action or a connected `IMAGE`.

It extracts available final/source prompts, seed, generation settings, models, LoRAs, resolved inputs, full report, and normalized JSON. It prefers structured SICK OLLIE metadata and falls back to common ComfyUI workflow/prompt data and A1111/Civitai `parameters` metadata when possible.

Useful outputs include `final_prompt`, `source_prompt`, `seed`, `generation_settings`, `models`, `resolved_inputs`, `metadata_json`, and `has_metadata`.

## SOS Hub and major tools

Open the **SOS** sidebar tab to reach all four tools from one command center. Where supported, the same tools also register commands under ComfyUI’s **Sick Ollie** menu. The two organizers additionally have compact launcher nodes under `Sick Ollie/Utilities`.

### LoRA Library

The LoRA Library is a visual catalog of the LoRAs ComfyUI can currently see. It indexes files; it does not duplicate the LoRA library itself.

#### Browse and review

- Responsive 3:4 thumbnail gallery and detail view
- Folder tree, epoch, tested/rating, thumbnail-source, and usage/name filters
- Favorite (4★), Keep (3★), Retest, and Reject controls on cards and in Loader Core
- Durable tested/use count, recent-use history, and last output information
- Detected triggers plus model, creator, base-model, and Civitai information
- One-click **Load LoRA** into the active Loader Core while preserving its current strength

Test history is separate from rating. A successful Output Core save marks a used LoRA tested; it does not silently mark it Keep or Favorite. Clear Rating preserves test history, while Reset All also clears use/test history.

#### Thumbnails

The Library can use:

- a generated Preview result
- a manual custom upload
- a recognized adjacent local preview
- a cached Civitai showcase image
- a Yearbook-generated portrait

Local catalog thumbnails are bounded 384×512 WebP files up to 160 KB. Original generated images and Civitai showcase files are not copied into the catalog. **Auto first image** fills only blank entries unless disabled.

#### Yearbook Run

Yearbook uses the currently filtered LoRA scope and a reusable prompt to generate consistent 3:4, 1 MP thumbnails. Target modes can fill missing entries, replace Civitai or generated sources, standardize non-Yearbook thumbnails, rebuild Yearbook entries, or replace everything.

The run shuffles targets, temporarily fixes the Loader/Prompt progression needed for the batch, captures Preview results, and restores the temporary values afterward. Closing the Library or pressing Stop interrupts the active run and prevents delayed queues from continuing invisibly.

#### Quarantine and maintenance

**Quarantine file** and **Quarantine rejected** move LoRAs plus recognized adjacent sidecars into a timestamped folder under `ComfyUI/user/SickOllie/quarantine/`. This is a move, not permanent deletion.

Catalog Tools can clear only compact thumbnail caches or purge/rebuild selected catalog records. Purging does not delete LoRA files, adjacent sidecars, Recipe Catalog entries, saved filters, or shared token settings.

### Recipe Catalog

Recipe Catalog is a prompt-first thumbnail gallery for setups worth reusing.

Save from the Studio canvas, use Preview Core’s **Recipe** action, or import an original metadata-bearing PNG/JPG/WebP. Imports understand:

- structured SICK OLLIE Studio metadata
- Preview runtime metadata created before Output Core saves
- expanded ComfyUI API graphs
- common Classic/legacy workflow nodes
- A1111/Civitai `parameters` text

For a Prompt Log result, the recipe preserves the exact source line that produced the image as the reusable Manual template while retaining the used file and resolved index in fixed mode. Placeholder tokens remain reusable instead of being flattened into one baked prompt.

Recipes default to the prompt assembly, active substitutions/additions, resolved dimensions, and actual seed. Model, LoRA, text-encoder, and VAE details remain available as optional resources but start hidden and unchecked.

**Review & Apply** compares the recipe with matching Studio nodes already on the canvas. It shows readable current/incoming values, applies only checked changes, and protects connected fields. It never replaces the whole canvas.

Preview-backed saves use the displayed image’s embedded runtime metadata as the source of truth, preventing auto-advanced indexes from saving the setup prepared for the next queue.

### SOLO LoRA Organizer

The LoRA Organizer is a preview-first filesystem tool. A scan is always a dry run; files change only after reviewed rows are checked and confirmed.

It can:

- read safetensors metadata without loading model tensors
- compute fresh SHA-256 hashes and query Civitai
- plan smart filenames and Base → Category → Creator folders
- edit proposed filename, base, and category before applying
- move recognized sidecars with their LoRA
- write progressive undo manifests and restore the latest organization pass
- find exact byte-for-byte duplicates with keeper protection
- find orphan sidecars and empty folder trees
- use the operating system’s recoverable Trash/Recycle Bin for confirmed cleanup

Select the intended LoRA library root before scanning. The organizer limits mutations to that root, refuses overwrites, revalidates paths immediately before changes, and never substitutes permanent deletion if a safe Trash backend is unavailable.

Use a disposable copy for the first scan of an irreplaceable library. See [the focused LoRA Organizer guide](docs/organizers/SOLO-LoRA-Organizer.md) for its safety model.

### SOLO Log Organizer

The Log Organizer targets `.txt` libraries used by Prompt Core.

It can:

- remove blank lines, structural headings, and list numbering
- convert standalone `SICK DOLLS` placeholders to `BRAND`
- remove exact duplicate resolved lines inside each file
- classify content into `outfits`, `prompts`, or `scenes`
- use compact groups such as Values, Templates, Scene Templates, Masters, Fragments, and Needs Review
- polish filenames with readable titles, token contracts, and resolved line counts
- preview before/after samples and editable destinations
- archive originals before writing cleaned UTF-8 outputs
- undo the last apply without overwriting user-modified files
- export the scan audit as CSV
- preview and safely remove only still-empty folders


Existing grouped folders remain untouched unless **Reprocess Existing Subfolders** is enabled. See [the focused Log Organizer guide](docs/organizers/SOLO-Log-Organizer.md) for the current classification and recovery behavior.

## Where SICK OLLIE stores data

| Data | Default location |
| --- | --- |
| Prompt/outfit/scene logs | `ComfyUI/input/SickOllieLogs/` |
| Shared LoRA/Recipe catalog | `ComfyUI/user/SickOllie/solo_catalog.sqlite3` |
| Recipe preview cache | `ComfyUI/user/SickOllie/recipe_previews/` |
| Recoverable LoRA quarantine | `ComfyUI/user/SickOllie/quarantine/<timestamp>/` |
| LoRA Organizer settings/cache/manifests | `ComfyUI/user/solo_lora_organizer/` |
| Log Organizer settings/manifests | `ComfyUI/user/solo_log_organizer/` |
| Log Organizer recovery archive | `<selected log root>/_SOLO_Log_Organizer/Archive/<timestamp>/` |

If ComfyUI does not expose a user directory, local-data fallbacks are used inside the extension. The release packager intentionally excludes those runtime caches.

## Updating from an older release

1. Close ComfyUI.
2. Back up important workflows and any custom files you placed inside the extension folder.
3. Replace the old `ComfyUI-SickOllie` extension folder with the clean release folder. Avoid merging over stale JavaScript or Python files.
4. Keep `ComfyUI/user/SickOllie/` and your `ComfyUI/input/SickOllieLogs/` library; they live outside the extension and hold the catalog, ratings, recipes, thumbnails, and logs.
5. Restart ComfyUI and hard-refresh the browser.
6. Open the current Studio starter or a copied production workflow and confirm local model/encoder/VAE selections.

### Compatibility note

Classic keeps the original Loader, Prompt, Generation, Output, and Persist node IDs. This preserves the primary v1/v2 Classic production cores.

The current release intentionally registers **Preview Core and Image Metadata Core only in Studio**, and the separate **Persist + Display Resolved Prompt only in Classic**. When an older workflow contains Classic `SOFitPreview`, v3 upgrades that node in place to Studio Preview before ComfyUI checks for missing nodes. Its ID, connections, position, widget values, properties, and stored preview state are preserved; save the workflow once to make the new type permanent.

Older workflows containing Classic Image Metadata or Studio Persist may still show those removed nodes as missing. Replace them with Studio Image Metadata or use Prompt Core’s built-in persistent resolved-prompt display as appropriate.

Saved workflows from earlier Studio development layouts are migrated conservatively. Existing pre-2.1 prompt-placement behavior is preserved instead of silently changing resolved prompts.

## Troubleshooting

### Nodes or the SOS sidebar do not appear

- Confirm the extension is exactly one folder below `custom_nodes`.
- Confirm `rgthree-comfy` is installed.
- Restart ComfyUI, then hard-refresh with `Ctrl+F5`.
- Check the ComfyUI console for an import error from `ComfyUI-SickOllie`.

### The secondary-LoRA interface or info dialog is missing

Install/update `rgthree-comfy`, restart ComfyUI, and hard-refresh. Loader Core imports rgthree’s LoRA information interface directly.

### A prompt/outfit/scene log is missing

Place `.txt` files under the matching `ComfyUI/input/SickOllieLogs/` parent, restart ComfyUI, and refresh. Studio clears stale saved selections to `[None]`; reselect the renamed file.

### `NAME`, `OUTFIT`, `SCENE`, `ITEM`, or `TRIGGER` was not inserted

Open Prompt Assembly and check the component’s placement status. Placeholder Only requires a matching token. Smart/Auto can insert a missing component, while Off deliberately removes its known placeholder.

### The LoRA Library is empty

Click **Scan LoRA folders**. The Library reads ComfyUI’s configured LoRA roots; files outside those roots are not cataloged.

### A Library card says `CIVITAI READY` but has no image

The Civitai URL is known, but the compact local thumbnail has not been cached. Use **Fill from Civitai**, choose a showcase in the detail view, assign a Preview image, or run Yearbook.

### Recipe import did not restore a model or LoRA automatically

That is the safe default. Resource values live behind **Show optional resources** and begin unchecked because machines use different folder layouts and filenames.

### The saved image does not reload the workflow

Use PNG and enable **Prompt metadata** plus **Workflow metadata** in Output Core. JPG/WebP metadata is useful for inspection but PNG is the most reliable ComfyUI workflow container.

### Civitai cannot match a local resource

Civitai lookup requires an exact file hash. Converted, merged, retrained, or differently quantized files may not match a published version even when their names are similar.

## Safety and known limitations

- Test both organizers on copied folders before using them on the only copy of valuable libraries.
- Quarantine is recoverable by moving files back manually; it is not an automatic undo system.
- Yearbook requires Studio Loader Core, Prompt Core, and Generation Core on the current canvas, plus a Preview result to capture.
- Online Civitai data is optional and can be unavailable, incomplete, or rate-limited.
- The custom dashboards target ComfyUI’s LiteGraph frontend and may need updates when ComfyUI changes frontend APIs.
- Recipe migration from generic third-party workflows is deliberately best-effort. Review every proposed value before applying it.

## Development validation

The release includes backend unit coverage for trigger resolution, catalog state, recipe import/runtime overlays, Prompt Assembly, registration, and Log Organizer routing, plus frontend behavior checks for the Studio dashboards.

```bash
python -m unittest discover -s tests -v
node --test tests/test_studio_frontend.mjs
python -m compileall -q .
```

Create a clean distributable with:

```bash
python scripts/package_release.py ../ComfyUI-SickOllie-release.zip
```

## Credits and license

Created by **SICK OLLIE** for the SICK OLLIE ComfyUI production workflow.

The enhanced Loader Core interaction is adapted from [rgthree-comfy](https://github.com/rgthree/rgthree-comfy). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Released under the [MIT License](LICENSE).
