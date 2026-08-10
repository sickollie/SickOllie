# Sick Ollie Node Pack v2.0.0

A ComfyUI node pack for LoRA testing, prompt-log automation, generation, metadata-aware output, image inspection, and repeatable batch workflows.

v2 ships two parallel node families:

- **Classic** — the familiar v1-style workflow with the original node IDs and explicit wiring, plus the final Classic feature upgrades.
- **Studio** — the redesigned CMYKG interface with streamlined sockets, Auto Context, integrated VAE decode, hierarchical browsers, and structured metadata.

## Requirements

- ComfyUI
- [rgthree-comfy](https://github.com/rgthree/rgthree-comfy) — required by Loader Core's secondary-LoRA interface
- Python 3.10+

## Install

1. Copy the `ComfyUI-SickOllie` folder into `ComfyUI/custom_nodes/`.
2. Make sure `rgthree-comfy` is installed.
3. Restart ComfyUI completely.
4. Hard-refresh the browser if the frontend was already open.

## Node Menu

```text
Sick Ollie
├── Classic
│   ├── Loader Core
│   ├── Prompt Core
│   ├── Generation Core
│   ├── Output Core
│   ├── Preview Core
│   ├── Persist + Display Resolved Prompt
│   └── Image Metadata Core
└── Studio
    ├── Loader Core
    ├── Prompt Core
    ├── Generation Core
    ├── Output Core
    ├── Preview Core
    ├── Persist + Display Resolved Prompt
    └── Image Metadata Core
```

## What's New in v2

### Classic

Classic keeps the original node IDs and v1-style wiring so older Sick Ollie workflows and workflow-bearing PNGs can continue to resolve to the node family they were built with.

- **Shuffle** — randomize without repeats. Every eligible value is used once before the pool refills in a new random order.
- Shuffle is available for the main LoRA, Prompt, Outfit A/B/C, and Scene streams.
- Prompt/outfit/scene logs detect the number of usable nonblank lines.
- Prompt/outfit/scene indexes use searchable `index · line preview` selectors instead of blind integer values.
- Outfit and Scene shuffle bags only advance when their tokens are actually used in the source prompt.
- Clean-name selection handles a wider range of delimiter-based LoRA filename structures.
- Loader Core exposes `main_folder`, the immediate parent folder of the active main LoRA.
- Generation Core accepts optional external positive/negative conditioning while retaining the normal prompt-text and empty-negative fallbacks.
- Resolved metadata records only prompt/outfit/scene/substitution values that actually participated in the final prompt.

### Studio

Studio keeps the same production ideas but removes most of the bookkeeping from the visible graph.

- Custom black CMYKG dashboard UI.
- Hierarchical folder and log browsers.
- Separate folder scope and filtered master LoRA selection.
- Live eligible LoRA counts.
- Searchable prompt/outfit/scene line previews and no-repeat shuffle.
- Streamlined graph sockets.
- **Auto Context** carries resolved Loader, Prompt, and Generation data into Output Core without requiring dedicated metadata wires.
- Output Core can decode `samples + vae` directly, so a separate VAE Decode node is optional.
- Structured Sick Ollie metadata is written into saved images.
- Image Metadata Core can inspect those images immediately and also works as a standalone metadata utility.

## Studio Quick Start

Minimum generation path:

```text
Loader Core model
    → Generation Core model

Prompt Core final_prompt
    → Generation Core positive_text

Generation Core samples
    → Output Core samples

Generation Core vae
    → Output Core vae

Output Core images
    → Preview Core images
```

Optional identity substitution:

```text
Loader Core clean_name
    → Prompt Core NAME value
```

Output Core's Auto Context automatically collects the resolved naming, LoRA, prompt-log, seed, model, and generation information needed for metadata and filename/subfolder recipes.

Output Core can also accept a decoded `IMAGE`. When both `IMAGE` and `samples + vae` are connected, `IMAGE` takes priority.

## Shuffle

`shuffle` is `randomize` with complete coverage:

```text
A, B, C, D, E
→ random order, each used once
→ refill
→ new random order
```

It is intended for LoRA and prompt-log testing where ordinary random selection can repeat the same value several times before the rest of the pool has been seen.

## Studio Loader Core

- Choose a **Folder scope** without flattening the entire LoRA directory into one giant path list.
- Choose the main LoRA separately from the filtered master list.
- `Main LoRA · N available` shows the size of the current testing pool.
- Epoch filtering remains independent of folder navigation.
- `Include subfolders` defaults ON.
- New secondary LoRAs default OFF.
- Clean Name and Trigger are shown directly in the dashboard.
- `main_folder` returns the active LoRA's immediate parent folder.

Visible Studio outputs:

```text
model
clean_name
main_trigger
main_folder
```

## Studio Prompt Core

- Switch Prompt Source between **Manual** and **Prompt Log**.
- Prompt Log mode shows file, selected line, mode, preview index, and usable line count together.
- Outfit A, Outfit B, Outfit C, and Scene each have independent logs, modes, indexes, counts, and shuffle state.
- NAME and ITEM live under Substitutions.
- Prefix and Suffix live under Prompt Additions.
- Only the useful external text sockets remain visible: NAME value, ITEM value, Prefix text, and Suffix text.
- `final_prompt` is the only Studio graph output; the rest of the resolved state travels through structured context.

## Studio Generation Core

Generation Core groups Encoding, Conditioning, Canvas, Sampling, and Seed controls into one dashboard.

Default Studio setup:

- preferred text encoder: `qwen3vl_4b_fp8_scaled.safetensors` when installed
- preferred VAE: `qwen_image_vae.safetensors` when installed
- resolution mode: preset
- aspect: 3:4 Portrait Standard
- megapixels: 1.0
- batch: 1
- sampler: Euler
- scheduler: beta
- steps: 9
- CFG: 1.0
- denoise: 1.0
- shift: 1.25
- seed: random every run

If the preferred encoder or VAE is not installed, the dropdown falls back to an available local file.

Optional positive and negative CONDITIONING sockets can override the internal conditioning path for image-edit/reference workflows.

Studio outputs:

```text
samples
vae
```

## Studio Output Core

Output Core handles naming, saving, metadata, and optional VAE decoding.

- Output root defaults to `Project Folder Name`.
- Build subfolders and filenames from literals plus resolved variables.
- Resolved Inputs shows the values Auto Context actually received; click values to copy them.
- Last Save shows the final relative `output\...` path.
- Prompt metadata, workflow metadata, and Civitai metadata can be embedded independently.
- Connect decoded `images`, or connect `samples + vae` directly.

Studio output:

```text
images
```

## Image Metadata Core

Image Metadata Core is part of the Studio-era metadata system but also works completely standalone.

Load an image by:

- clicking **choose file to upload**
- dragging a PNG/JPG/WebP onto the node
- wiring an IMAGE into the node for live workflow inspection

The node parses available metadata immediately. A workflow run is not required for a manually loaded image.

Focused copy actions:

- Seed
- Final Prompt
- Source Prompt
- Full Metadata Report

When Sick Ollie structured metadata is present, the inspector can recover generation settings, model/LoRA information, trigger data, prompt/outfit/scene files and indexes, substitutions, and other resolved inputs. It can also fall back to common Comfy workflow/prompt and `parameters` metadata when available.

Outputs include:

```text
images
final_prompt
source_prompt
seed
generation_settings
models
resolved_inputs
full_report
metadata_json
has_metadata
```

## Classic vs Studio

Use **Classic** when:

- opening an older Sick Ollie workflow or workflow-bearing PNG
- you prefer explicit graph wiring
- you want the original native-style node interaction model

Use **Studio** when:

- building a new workflow
- you want the dashboard interfaces and hierarchical browsers
- you want fewer bookkeeping wires
- you want Auto Context and integrated VAE decode
- you want the richest structured metadata workflow

Classic and Studio can coexist in the same ComfyUI installation.

## Starter Content

The GitHub release includes optional starter content:

```text
Starter Content/
├── input/SickOllieLogs/
│   ├── prompts/
│   ├── outfits/
│   └── scenes/
└── workflows/
    ├── Sick Nodes v2_Classic.json
    └── Sick Nodes v2_Studio.json
```

The example workflows reference model/LoRA selections from the test system. Replace any missing local files with your own installed equivalents.

See `Starter Content/INSTALL STARTER CONTENT.txt` for the copy locations.

## Documentation

[Classic | Studio v2 Reference Guide](docs/Sick_Ollie_Classic_Studio_v2_Reference_Guide.pdf)

## License

Sick Ollie Node Pack is released under the MIT License. See `LICENSE`.

Third-party attribution is in `THIRD_PARTY_NOTICES.md`.
