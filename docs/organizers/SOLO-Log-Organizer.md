# SOLO Log Organizer for ComfyUI

SOLO Log Organizer is a preview-first prompt-log cleanup and organization tool built directly into ComfyUI. It keeps the wide, neon SOLO interface from the LoRA Organizer and writes a Prompt Core-compatible library beneath `SickOllieLogs`.

Version: **0.3.0 — compact-library migration release**

## Install

1. Extract the SICK OLLIE release archive.
2. Put the complete `ComfyUI-SickOllie` folder inside `ComfyUI/custom_nodes/`.
3. Restart ComfyUI and refresh the browser.

There is no `requirements.txt` and nothing else to install. The backend uses only Python's standard library.

Open it in any of these ways:

- Add **SOLO · Log Organizer** from `Sick Ollie/Utilities`, then click **Open Log Organizer**.
- Choose **Sick Ollie → Open SOS Log Organizer** from ComfyUI's menu.
- Open the **SOS** sidebar tab and choose **Log Organizer**.

## Default Prompt Core location

SOLO starts at the active ComfyUI input directory plus `SickOllieLogs`, normally:

`ComfyUI/input/SickOllieLogs`

The path remains fully editable and the folder browser can select another root. Any selected root receives the same three parent categories:

When upgrading from v0.1, the old saved scan root is migrated to this Prompt Core default once. Any folder chosen afterward is remembered normally.

```text
SickOllieLogs/
├── outfits/
├── prompts/
└── scenes/
```

## Content-first classification

The early desktop build was good at recognizing content, but it made themes such as cyberpunk, interiors, products, and portraits part of the directory structure. A single library could therefore spread across many overlapping folders.

SOLO first decides whether a file is an outfit-value library, scene-value library, or complete prompt library. It now uses a compact, purpose-first subgroup instead of turning every placeholder combination into another folder. The exact `NAME`/`OUTFIT`/`BRAND`/`SCENE` contract remains visible in the polished filename, preview, and audit.

| Log content | Destination |
| --- | --- |
| Standalone clothing/outfit values | `outfits/Values/` |
| Body-style values intended for `OUTFIT` | `outfits/Body Style/` |
| Recognized outfit masters | `outfits/Masters/` |
| Standalone locations or scene inserts | `scenes/Values/` |
| Recognized scene masters | `scenes/Masters/` |
| Complete prompts without supported placeholders | `prompts/Standard/` |
| Complete prompts using placeholders | `prompts/Templates/` |
| Complete prompts using `SCENE`, including masters | `prompts/Scene Templates/` |
| Recognized non-scene prompt masters | `prompts/Masters/` |
| Prefix or suffix fragments | `prompts/Fragments/` |
| Placeholder use differs between lines | `<category>/Needs Review/` |

Themes are still detected, but only as helpful title cues. They no longer create a sprawling hierarchy.

Complete prompts remain in `prompts` even when they contain an `OUTFIT` or `SCENE` placeholder. Only standalone replacement-value libraries go into `outfits` or `scenes`.

## Filename polish

SOLO rewrites old snake-case, count-stamped, and sorter-style filenames into readable names with three predictable parts:

`Human Title — Token Contract — Resolved Count.txt`

Examples:

- `Cosmic Vaporwave — NAME + OUTFIT + BRAND — 50.txt`
- `Streetwear Collection — OUTFIT Values — 24.txt`
- `Editorial Portrait — NAME + BRAND Mixed — 80.txt`
- `Prompt Prefixes — NAME + OUTFIT Prefix — 12.txt`

If two proposed names collide, SOLO uses a readable `Variant 2`, `Variant 3`, and so on. The parent category, destination group, and filename remain editable in the preview before Apply.

## Cleanup rules

Cleanup rules are enabled by default and may be changed before scanning. The explicit reprocess migration is the exception and starts disabled:

- Remove blank lines.
- Remove recognized structural headings.
- Strip sequential list-number prefixes.
- Convert standalone `SICK DOLLS` placeholders to `BRAND`.
- Remove duplicate resolved lines inside each file.
- Sort files into Prompt Core's `outfits`, `prompts`, and `scenes` parents, then by purpose.
- Rewrite filenames with readable titles.
- Archive exact cleaned duplicates while retaining one verified keeper.
- Optionally reprocess existing subfolders into the compact v0.3 taxonomy.

Token matching is deliberately conservative: placeholders must be standalone uppercase tokens. Ordinary prose containing words such as “brand” is not treated as a template placeholder.

Existing files whose names clearly identify them as a master or complete collection are preserved as master-classified logs. The node does **not** automatically generate additional merged masters; that behavior was removed to prevent redundant library growth.

### Reprocess Existing Subfolders

This migration rule is deliberately **off by default**. With it off, files already located at `<outfits|prompts|scenes>/<existing group>/<file>.txt` keep their current group, while loose files still receive the compact layout. Enable it to preview a one-time migration of an older SOLO hierarchy into the v0.3 purpose-first folders.

It is safe to leave the option enabled after migration: the final collision plan is recalculated before rows are marked `Ready`, so a second scan is idempotent. Existing `Variant N` files that are already at their final paths now correctly show `Already organized`.

## Preview, Apply, and Undo

Scanning is a dry run. The preview shows the original path, role, token coverage, cleanup counts, parent category, proposed group, proposed filename, issues, and before/after samples. Uncheck rows you do not want changed or edit their proposed destinations.

The preview opens on **Actionable + review**, hiding the already-organized majority while retaining mixed-coverage and failed rows that deserve attention. Switch to **Checked changes** or **All logs** at any time; filtering never changes what is selected.

On **Apply Selected**, SOLO first verifies that every selected source still matches the exact bytes scanned. It then:

1. Moves every selected original into `_SOLO_Log_Organizer/Archive/<timestamp>/`, preserving its relative path.
2. Writes cleaned outputs in UTF-8 with collision protection.
3. Records a progressive recovery manifest in ComfyUI's user-data directory.

**Undo Last** removes only outputs that are byte-for-byte unchanged since SOLO wrote them, then restores the archived originals to their exact previous paths. Modified outputs and occupied restore paths are skipped rather than overwritten.

An **Export Audit** button downloads the current scan as CSV.

## Remove Empty Folders

**Remove Empty Folders** first previews every removable directory and asks for confirmation. It then attempts only that exact confirmed list, bottom-up, and rechecks that each folder is still completely empty. It never removes files, follows symlinks, or removes the selected root or the required `outfits`, `prompts`, and `scenes` parents. A folder that gains content after preview is skipped.

## Platform support

The node uses standard filesystem operations and runs on Windows, Linux, and macOS. It does not need `Send2Trash`, Shell32, or a platform-specific recycle-bin package: reversible operations use SOLO's own timestamped archive. Path comparisons are conservative on macOS and Windows-friendly filenames are generated on every platform.

## Important release notes

- Only `.txt` prompt logs are scanned.
- Exact duplicate detection happens after the selected cleanup rules are applied. It does not delete merely similar or semantically related prompts.
- Symlinked files and folders, SOLO archives, old Prompt Sorter archives, and Python cache folders are skipped.
- Keep a normal backup of valuable libraries. Test the first release on a copied folder before using it on the only copy of a large collection.
- If a scan is open for a long time, rescan before Apply. SOLO will refuse files that changed after scanning.

## Development validation

From the nodepack directory:

```bash
python -m unittest discover -s tests -v
python -m compileall -q .
node --check js/solo_log_organizer.js
```

The included suite covers cleanup, token analysis, Prompt Core categories, compact grouping, existing-folder preservation and migration, collision idempotence, polished names, UTF-16 input, exact duplicates, stale-source refusal, apply/undo restoration, empty-folder cleanup, in-place mode, rollback, and ComfyUI registration. The v0.3.0 migration was also exercised against the supplied 321-file full archive: Apply produced 321 outputs, the immediate second scan proposed zero changes, 26 empty legacy folders were removed, and Undo restored all 321 originals byte-for-byte with zero skips.
