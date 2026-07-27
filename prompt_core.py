from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import folder_paths

NO_FILE = "[None]"
PROMPT_SOURCES = ["manual", "log"]
INDEX_MODES = ["fixed", "increment", "decrement", "randomize"]

DEFAULT_CLEANUP_RULES = r"""\?\[|\]
\\?[()]
:\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)"""



LOG_ROOT_NAME = "SickOllieLogs"
LOG_CATEGORIES = {
    "prompt": "prompts",
    "outfit": "outfits",
    "scene": "scenes",
}


def _log_root() -> Path:
    """
    Resolve user prompt logs through ComfyUI's configured input directory.
    This absolute path is used internally only.
    """
    return Path(folder_paths.get_input_directory()) / LOG_ROOT_NAME


def _ensure_log_directories() -> Path:
    root = _log_root()

    for directory_name in LOG_CATEGORIES.values():
        (root / directory_name).mkdir(parents=True, exist_ok=True)

    readme_path = root / "README.md"
    if not readme_path.exists():
        readme_path.write_text(
            """# Sick Ollie Prompt Logs

Place one prompt per line in `.txt` files under:

- `prompts/`
- `outfits/`
- `scenes/`

The Prompt Log Engine stores only paths relative to this folder in workflow
metadata, such as `prompts/cutiecore.txt`. Your operating-system username and
full ComfyUI installation path are not embedded by the node.
""",
            encoding="utf-8",
        )

    return root


def _category_choices(category: str) -> list[str]:
    root = _ensure_log_directories()
    category_dir_name = LOG_CATEGORIES[category]
    category_root = root / category_dir_name

    results: list[str] = []

    for file_path in category_root.rglob("*.txt"):
        if not file_path.is_file():
            continue

        try:
            relative = file_path.relative_to(root).as_posix()
        except ValueError:
            continue

        results.append(relative)

    return [NO_FILE] + sorted(
        set(results),
        key=lambda value: value.lower(),
    )


def _resolve_log_path(relative_path: str, category: str) -> Path | None:
    """
    Resolve a portable relative dropdown value to its local file. Absolute
    paths and path traversal are intentionally rejected.
    """
    value = str(relative_path or "").strip()

    if not value or value == NO_FILE:
        return None

    value = value.replace("\\", "/")
    relative = Path(value)

    if relative.is_absolute() or ".." in relative.parts:
        return None

    expected_root = _ensure_log_directories().resolve()
    expected_category = LOG_CATEGORIES[category]

    if not relative.parts or relative.parts[0] != expected_category:
        return None

    candidate = (expected_root / relative).resolve()

    try:
        candidate.relative_to(expected_root)
    except ValueError:
        return None

    return candidate

def _read_text_file(path_text: str) -> str:
    path = Path(str(path_text))
    for encoding in ("utf-8", "utf-8-sig", "cp1252", "latin-1"):
        try:
            return path.read_text(encoding=encoding)
        except Exception:
            continue
    return path.read_text(errors="ignore")


def _load_lines(
    relative_path: str,
    category: str,
    skip_blank_lines: bool,
) -> list[str]:
    path = _resolve_log_path(relative_path, category)

    if path is None or not path.exists() or not path.is_file():
        return []

    text = _read_text_file(str(path))
    lines = text.splitlines()

    if skip_blank_lines:
        lines = [line for line in lines if line.strip()]

    return lines


def _resolve_index(index_value: int, count: int, loop: bool) -> int:
    if count <= 0:
        return 0
    try:
        index_int = int(index_value)
    except Exception:
        index_int = 0
    if loop:
        return index_int % count
    return max(0, min(index_int, count - 1))


def _load_line(
    relative_path: str,
    category: str,
    index_value: int,
    loop: bool,
    skip_blank_lines: bool,
):
    lines = _load_lines(
        relative_path,
        category,
        skip_blank_lines,
    )
    count = len(lines)

    if count == 0:
        return "", 0, 0

    resolved_index = _resolve_index(
        index_value,
        count,
        loop,
    )
    return lines[resolved_index], resolved_index, count


def _apply_token(text: str, token: str, value: str) -> str:
    if not token:
        return text
    return str(text).replace(str(token), str(value))


def _apply_cleanup_rules(text: str, rules_text: str) -> str:
    parsed_rules: list[tuple[re.Pattern, str]] = []
    for line_number, raw_line in enumerate(str(rules_text).splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=>" in line:
            pattern_text, replacement = line.split("=>", 1)
            pattern_text = pattern_text.strip()
            replacement = replacement.strip()
        else:
            pattern_text = line
            replacement = ""
        if not pattern_text:
            continue
        try:
            parsed_rules.append((re.compile(pattern_text), replacement))
        except re.error as error:
            print("[Sick Ollie Prompt Tools] Ignoring invalid cleanup regex "
                  f"on line {line_number}: {pattern_text!r} ({error})")
    result = str(text)
    for _ in range(20):
        previous = result
        for pattern, replacement in parsed_rules:
            result = pattern.sub(replacement, result)
        if result == previous:
            break
    return result.strip()


def _extra_dict(extra_pnginfo: Any) -> dict | None:
    if isinstance(extra_pnginfo, dict):
        return extra_pnginfo
    if isinstance(extra_pnginfo, list):
        for item in extra_pnginfo:
            if isinstance(item, dict):
                return item
    return None


def _find_workflow_node(workflow: dict, node_id: Any) -> dict | None:
    for node in workflow.get("nodes", []):
        if str(node.get("id")) == str(node_id):
            return node
    return None


class SOPromptLogEngine:
    @classmethod
    def INPUT_TYPES(cls):
        prompt_file_choices = _category_choices("prompt")
        outfit_file_choices = _category_choices("outfit")
        scene_file_choices = _category_choices("scene")
        return {
            "required": {
                "prompt_source": (PROMPT_SOURCES, {"default": "manual", "tooltip": "Choose whether the main prompt comes from manual text or a prompt log file."}),
                "manual_prompt": ("STRING", {"default": "", "multiline": True, "dynamicPrompts": False, "tooltip": "Manual base prompt used when prompt_source is manual."}),
                "prompt_log_file": (
                    prompt_file_choices,
                    {
                        "default": NO_FILE,
                        "tooltip": (
                            "Files under the portable SickOllieLogs/prompts "
                            "directory. Only the relative path is saved."
                        ),
                    },
                ),
                "prompt_mode": (INDEX_MODES, {"default": "increment", "tooltip": "Queue-time progression mode for prompt_index when prompt_source is log."}),
                "prompt_index": ("INT", {"default": 0, "min": -2147483648, "max": 2147483647, "step": 1}),
                "prompt_loop": ("BOOLEAN", {"default": True, "tooltip": "Wrap prompt_index within the available prompt log lines."}),
                "outfit_enabled": ("BOOLEAN", {"default": False, "tooltip": "Enable OUTFIT token replacement from a separate outfit log."}),
                "outfit_log_file": (
                    outfit_file_choices,
                    {
                        "default": NO_FILE,
                        "tooltip": (
                            "Files under the portable SickOllieLogs/outfits "
                            "directory. Only the relative path is saved."
                        ),
                    },
                ),
                "outfit_token": ("STRING", {"default": "OUTFIT", "multiline": False}),
                "outfit_mode": (INDEX_MODES, {"default": "randomize"}),
                "outfit_index": ("INT", {"default": 0, "min": -2147483648, "max": 2147483647, "step": 1}),
                "outfit_loop": ("BOOLEAN", {"default": True}),
                "scene_enabled": ("BOOLEAN", {"default": False, "tooltip": "Enable SCENE token replacement from a separate scene log."}),
                "scene_log_file": (
                    scene_file_choices,
                    {
                        "default": NO_FILE,
                        "tooltip": (
                            "Files under the portable SickOllieLogs/scenes "
                            "directory. Only the relative path is saved."
                        ),
                    },
                ),
                "scene_token": ("STRING", {"default": "SCENE", "multiline": False}),
                "scene_mode": (INDEX_MODES, {"default": "randomize"}),
                "scene_index": ("INT", {"default": 0, "min": -2147483648, "max": 2147483647, "step": 1}),
                "scene_loop": ("BOOLEAN", {"default": True}),
                "name_token": ("STRING", {"default": "NAME", "multiline": False}),
                "name_value": ("STRING", {"default": "", "multiline": False, "tooltip": "Connect clean_name from the LoRA batch node here."}),
                "item_token": ("STRING", {"default": "ITEM", "multiline": False}),
                "item_value": ("STRING", {"default": "", "multiline": False}),
                "suffix_enabled": ("BOOLEAN", {"default": False}),
                "suffix_1": ("STRING", {"default": "", "multiline": True, "dynamicPrompts": False}),
                "suffix_2": ("STRING", {"default": "", "multiline": True, "dynamicPrompts": False}),
                "suffix_separator": ("STRING", {"default": ", ", "multiline": False}),
                "skip_blank_lines": ("BOOLEAN", {"default": True, "tooltip": "Remove blank lines when counting and reading all log files."}),
                "cleanup_enabled": ("BOOLEAN", {"default": True}),
                "cleanup_rules": ("STRING", {"default": DEFAULT_CLEANUP_RULES, "multiline": True, "dynamicPrompts": False, "tooltip": "One regex per line. Each line removes matches. Use PATTERN => REPLACEMENT for explicit replacements."}),
                "saved_prompt": ("STRING", {"default": "", "multiline": True, "dynamicPrompts": False, "tooltip": "Read-only display area for the final resolved prompt restored from saved PNG workflow data."}),
            },
            "hidden": {"extra_pnginfo": "EXTRA_PNGINFO", "unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "STRING", "INT", "INT", "INT", "INT", "INT", "INT", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("final_prompt", "source_prompt", "prompt_line", "outfit_line", "scene_line", "prompt_index_resolved", "outfit_index_resolved", "scene_index_resolved", "prompt_count", "outfit_count", "scene_count", "prompt_file", "outfit_file", "scene_file")
    FUNCTION = "build_prompt"
    CATEGORY = "Sick Ollie/Prompt"
    DESCRIPTION = "Portable prompt log engine using ComfyUI input storage with relative metadata-safe file paths, queue-time progression, token replacements, suffixes, cleanup, and saved prompt persistence."
    SEARCH_ALIASES = ["prompt log engine", "text log prompt", "outfit replacer", "scene replacer", "final prompt builder"]

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float('nan')

    def build_prompt(self, prompt_source: str, manual_prompt: str, prompt_log_file: str, prompt_mode: str, prompt_index: int, prompt_loop: bool,
                     outfit_enabled: bool, outfit_log_file: str, outfit_token: str, outfit_mode: str, outfit_index: int, outfit_loop: bool,
                     scene_enabled: bool, scene_log_file: str, scene_token: str, scene_mode: str, scene_index: int, scene_loop: bool,
                     name_token: str, name_value: str, item_token: str, item_value: str,
                     suffix_enabled: bool, suffix_1: str, suffix_2: str, suffix_separator: str,
                     skip_blank_lines: bool, cleanup_enabled: bool, cleanup_rules: str, saved_prompt: str,
                     extra_pnginfo=None, unique_id=None):
        prompt_line, prompt_index_resolved, prompt_count = _load_line(
            prompt_log_file,
            "prompt",
            prompt_index,
            bool(prompt_loop),
            bool(skip_blank_lines),
        )
        outfit_line, outfit_index_resolved, outfit_count = _load_line(
            outfit_log_file,
            "outfit",
            outfit_index,
            bool(outfit_loop),
            bool(skip_blank_lines),
        )
        scene_line, scene_index_resolved, scene_count = _load_line(
            scene_log_file,
            "scene",
            scene_index,
            bool(scene_loop),
            bool(skip_blank_lines),
        )
        source_prompt = prompt_line if str(prompt_source) == 'log' else str(manual_prompt)
        assembled = str(source_prompt)
        if bool(outfit_enabled) and outfit_line:
            assembled = _apply_token(assembled, outfit_token, outfit_line)
        if bool(scene_enabled) and scene_line:
            assembled = _apply_token(assembled, scene_token, scene_line)
        if str(name_value):
            assembled = _apply_token(assembled, name_token, str(name_value))
        if str(item_value):
            assembled = _apply_token(assembled, item_token, str(item_value))
        if bool(suffix_enabled):
            suffix_parts = [part.strip() for part in [suffix_1, suffix_2] if str(part).strip()]
            if suffix_parts:
                suffix_text = str(suffix_separator).join(suffix_parts)
                if assembled.strip():
                    assembled = f"{assembled}{suffix_separator}{suffix_text}"
                else:
                    assembled = suffix_text
        final_prompt = _apply_cleanup_rules(assembled, cleanup_rules) if bool(cleanup_enabled) else assembled.strip()
        extra = _extra_dict(extra_pnginfo)
        if extra is not None:
            extra['resolved_prompt'] = final_prompt
            extra['source_prompt'] = source_prompt
            extra['prompt_log_line'] = prompt_line
            extra['outfit_log_line'] = outfit_line
            extra['scene_log_line'] = scene_line
            workflow = extra.get('workflow')
            if isinstance(workflow, dict):
                node = _find_workflow_node(workflow, unique_id)
                if isinstance(node, dict):
                    props = node.setdefault('properties', {})
                    props['so_saved_final_prompt'] = final_prompt
                    props['so_saved_source_prompt'] = source_prompt
                    props['so_saved_prompt_line'] = prompt_line
                    props['so_saved_outfit_line'] = outfit_line
                    props['so_saved_scene_line'] = scene_line
        ui_payload = {'resolved_prompt': [final_prompt], 'source_prompt': [source_prompt], 'prompt_line': [prompt_line], 'outfit_line': [outfit_line], 'scene_line': [scene_line]}
        return {'ui': ui_payload, 'result': (final_prompt, source_prompt, prompt_line, outfit_line, scene_line,
                                             int(prompt_index_resolved), int(outfit_index_resolved), int(scene_index_resolved),
                                             int(prompt_count), int(outfit_count), int(scene_count),
                                             str(prompt_log_file), str(outfit_log_file), str(scene_log_file))}


NODE_CLASS_MAPPINGS = {'SOPromptLogEngine': SOPromptLogEngine}
NODE_DISPLAY_NAME_MAPPINGS = {'SOPromptLogEngine': 'Prompt Core'}
