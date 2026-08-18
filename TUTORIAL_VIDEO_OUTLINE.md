# SICK OLLIE Tutorial Video Outline

Target: a practical first walkthrough, not an exhaustive button reference.

## 1. The promise — 30–60 seconds

- Show the finished Studio graph and SOS sidebar.
- Explain the loop: choose → assemble → generate → save → review → reuse.
- Briefly name the four larger tools without opening them yet.

## 2. Install and open the starter — 2 minutes

- Correct `ComfyUI/custom_nodes/ComfyUI-SickOllie/` layout.
- `rgthree-comfy` requirement.
- Drag in `Sick Nodes v2_Studio.json`.
- Select local model, encoder, VAE, and LoRA files.
- Copy the optional `SickOllieLogs` starter folder and restart/hard-refresh.

## 3. Read the Studio graph left to right — 3 minutes

- Loader → Prompt → Generation → Output → Preview.
- Explain Loader’s `clean_name` and `main_trigger` connections.
- Explain Output’s Auto Context and why the graph stays compact.
- Queue one basic manual prompt and point out the resolved prompt, seed, path, Preview, and metadata.

## 4. Loader Core and LoRA testing — 5 minutes

- Folder Scope, nested folders, Epoch, and Library filters.
- Fixed/increment/decrement/random/no-repeat shuffle.
- Main strength and a secondary LoRA row.
- Information buttons and trigger copy.
- Favorite, Keep, Retest, Reject; show dropdown color coding.
- Explain tested history versus intentional rating.

## 5. Prompt Core assembly — 6 minutes

- Manual versus Prompt Log.
- Add an Outfit and Scene log.
- Insert `NAME`, `OUTFIT`, `SCENE`, and `TRIGGER` into a reusable prompt.
- Demonstrate Smart versus Placeholder Only.
- Show configurable `ITEM` → `BRAND` and one additional outfit stream.
- Open Trigger Setup and explain connected, detected, manual, and Off behavior.
- Queue twice to show resolved values and component progression.

## 6. Generation, Output, and Preview — 5 minutes

- Canvas preset/custom and the dimension-swap button.
- Sampler/settings and the three seed actions.
- Output filename/folder variables and format/metadata choices.
- Pin and side-by-side Compare.
- Show background/fit controls briefly.
- Save the displayed image as a Library Thumb and then as a Recipe.

## 7. LoRA Library — 7 minutes

- Scan and browse the thumbnail gallery.
- Filter by folder, tested/rating state, and thumbnail source.
- Open a detail view: triggers, creator/base info, usage, recent outputs.
- Assign or upload a thumbnail and show Civitai fill.
- Load a LoRA back into Loader Core without losing strength.
- Explain quarantine versus deletion.
- Run a tiny Yearbook example; demonstrate target mode, Stop, and state restoration.
- Mention Catalog Tools and what they explicitly do not delete.

## 8. Recipe Catalog — 6 minutes

- Open the Recipe just saved from Preview.
- Explain prompt-first defaults and optional machine-specific resources.
- Use Review & Apply on the current Studio graph.
- Import one metadata-bearing output image.
- Emphasize that Preview-backed recipes represent the displayed result, not the next auto-advanced selection.

## 9. LoRA Organizer — 5 minutes

- Use a disposable demo library.
- Select the real library root and run a dry scan.
- Review/edit Base → Category → Creator proposals.
- Show sidecar handling, collision protection, and Apply/Undo.
- Briefly show duplicate keeper protection and recoverable Trash cleanup.

## 10. Log Organizer — 5 minutes

- Scan a copied `SickOllieLogs` example.
- Show cleanup, classification, token contract, and polished filenames.
- Review Standard/Templates/Scene Templates/Values/Masters/Needs Review.
- Edit a destination, Apply, export the audit, and Undo Last.
- Mention that `girl` / `girls` no longer creates a special bucket.

## 11. Metadata round-trip — 3 minutes

- Drop a saved image into Image Metadata Core.
- Identify final/source prompt, actual seed, resources, and resolved inputs.
- Reopen/import the same result through Recipe Catalog.
- Recommend PNG with prompt + workflow metadata for the strongest ComfyUI round trip.

## 12. Updating, safety, and close — 2 minutes

- Replace the extension folder instead of merging stale files.
- Preserve `ComfyUI/user/SickOllie/` and `ComfyUI/input/SickOllieLogs/`.
- Note removed registrations: Classic Preview/Metadata and Studio Persist.
- Reiterate copied-folder testing for both organizers.
- Point viewers to README troubleshooting and release notes.

## Useful capture assets still needed

- One clean screenshot of the full current Studio starter graph.
- One SOS hub screenshot with all four cards visible.
- One Loader shot showing status-colored LoRAs and review buttons.
- One Prompt Assembly example with all major placeholders active.
- One LoRA Library gallery and one Recipe Catalog Review & Apply view.
- A tiny disposable LoRA/log folder prepared specifically for organizer demos.
