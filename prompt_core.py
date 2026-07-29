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
LOG_CATEGORIES = {"prompt": "prompts", "outfit": "outfits", "scene": "scenes"}


def _log_root() -> Path:
    return Path(folder_paths.get_input_directory()) / LOG_ROOT_NAME


def _ensure_log_directories() -> Path:
    root = _log_root()
    for name in LOG_CATEGORIES.values():
        (root / name).mkdir(parents=True, exist_ok=True)
    return root


def _category_choices(category: str) -> list[str]:
    root = _ensure_log_directories()
    category_root = root / LOG_CATEGORIES[category]
    values = []
    for file_path in category_root.rglob("*.txt"):
        if file_path.is_file():
            try:
                values.append(file_path.relative_to(root).as_posix())
            except ValueError:
                pass
    return [NO_FILE] + sorted(set(values), key=str.lower)


def _resolve_log_path(relative_path: str, category: str) -> Path | None:
    value = str(relative_path or "").strip().replace("\\", "/")
    if not value or value == NO_FILE:
        return None
    relative = Path(value)
    if relative.is_absolute() or ".." in relative.parts:
        return None
    root = _ensure_log_directories().resolve()
    if not relative.parts or relative.parts[0] != LOG_CATEGORIES[category]:
        return None
    candidate = (root / relative).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    return candidate


def _read_text_file(path: Path) -> str:
    for encoding in ("utf-8", "utf-8-sig", "cp1252", "latin-1"):
        try:
            return path.read_text(encoding=encoding)
        except Exception:
            continue
    return path.read_text(errors="ignore")


def _load_line(relative_path: str, category: str, index_value: int):
    path = _resolve_log_path(relative_path, category)
    if path is None or not path.exists() or not path.is_file():
        return "", 0, 0
    lines = [line for line in _read_text_file(path).splitlines() if line.strip()]
    if not lines:
        return "", 0, 0
    try:
        index = int(index_value) % len(lines)
    except Exception:
        index = 0
    return lines[index], index, len(lines)


def _apply_token(text: str, token: str, value: str) -> str:
    return str(text).replace(str(token), str(value)) if token else str(text)


def _apply_cleanup_rules(text: str, rules_text: str) -> str:
    rules: list[tuple[re.Pattern, str]] = []
    for line_number, raw_line in enumerate(str(rules_text).splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=>" in line:
            pattern_text, replacement = line.split("=>", 1)
            pattern_text = pattern_text.strip()
            replacement = replacement.strip()
        else:
            pattern_text, replacement = line, ""
        try:
            rules.append((re.compile(pattern_text), replacement))
        except re.error as error:
            print(f"[Sick Ollie Prompt Core] Invalid cleanup regex on line {line_number}: {error}")
    result = str(text)
    for _ in range(20):
        previous = result
        for pattern, replacement in rules:
            result = pattern.sub(replacement, result)
        if result == previous:
            break
    return result.strip()


def _extra_dict(extra_pnginfo: Any) -> dict | None:
    if isinstance(extra_pnginfo, dict):
        return extra_pnginfo
    if isinstance(extra_pnginfo, list):
        return next((item for item in extra_pnginfo if isinstance(item, dict)), None)
    return None


def _find_workflow_node(workflow: dict, node_id: Any) -> dict | None:
    return next((node for node in workflow.get("nodes", []) if str(node.get("id")) == str(node_id)), None)


def _join_prompt_parts(separator: str, *parts: str) -> str:
    return str(separator).join(str(part).strip() for part in parts if str(part).strip())


class SOPromptLogEngine:
    @classmethod
    def INPUT_TYPES(cls):
        prompt_files = _category_choices("prompt")
        outfit_files = _category_choices("outfit")
        scene_files = _category_choices("scene")
        int_widget = {"default": 0, "min": -2147483648, "max": 2147483647, "step": 1}
        return {
            "required": {
                "prompt_source": (PROMPT_SOURCES, {"default": "manual"}),
                "manual_prompt": ("STRING", {"default": "", "multiline": True, "dynamicPrompts": False}),
                "prompt_log_file": (prompt_files, {"default": NO_FILE}),
                "prompt_mode": (INDEX_MODES, {"default": "increment"}),
                "prompt_index": ("INT", int_widget),
                "outfit_token_A": ("STRING", {"default": "OUTFIT_A", "multiline": False}),
                "outfit_log_file_A": (outfit_files, {"default": NO_FILE}),
                "outfit_mode_A": (INDEX_MODES, {"default": "randomize"}),
                "outfit_index_A": ("INT", int_widget),
                "outfit_token_B": ("STRING", {"default": "OUTFIT_B", "multiline": False}),
                "outfit_log_file_B": (outfit_files, {"default": NO_FILE}),
                "outfit_mode_B": (INDEX_MODES, {"default": "randomize"}),
                "outfit_index_B": ("INT", int_widget),
                "outfit_token_C": ("STRING", {"default": "OUTFIT_C", "multiline": False}),
                "outfit_log_file_C": (outfit_files, {"default": NO_FILE}),
                "outfit_mode_C": (INDEX_MODES, {"default": "randomize"}),
                "outfit_index_C": ("INT", int_widget),
                "scene_token": ("STRING", {"default": "SCENE", "multiline": False}),
                "scene_log_file": (scene_files, {"default": NO_FILE}),
                "scene_mode": (INDEX_MODES, {"default": "randomize"}),
                "scene_index": ("INT", int_widget),
                "name_token": ("STRING", {"default": "NAME", "multiline": False}),
                "name_value": ("STRING", {"default": "", "multiline": False}),
                "item_token": ("STRING", {"default": "ITEM", "multiline": False}),
                "item_value": ("STRING", {"default": "", "multiline": False}),
                "prefix_enabled": ("BOOLEAN", {"default": False}),
                "prefix_text": ("STRING", {"default": "", "multiline": True, "dynamicPrompts": False}),
                "suffix_enabled": ("BOOLEAN", {"default": False}),
                "suffix_text": ("STRING", {"default": "", "multiline": True, "dynamicPrompts": False}),
                "prefix_suffix_separator": ("STRING", {"default": ", ", "multiline": False}),
                "cleanup_enabled": ("BOOLEAN", {"default": True}),
                "cleanup_rules": ("STRING", {"default": DEFAULT_CLEANUP_RULES, "multiline": True, "dynamicPrompts": False}),
                "saved_prompt": ("STRING", {"default": "", "multiline": True, "dynamicPrompts": False}),
            },
            "hidden": {"extra_pnginfo": "EXTRA_PNGINFO", "unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("STRING", "STRING", "STRING", "STRING", "STRING", "INT", "INT", "INT", "INT", "INT", "INT", "STRING", "STRING", "STRING")
    RETURN_NAMES = ("final_prompt", "source_prompt", "prompt_line", "outfit_line", "scene_line", "prompt_index_resolved", "outfit_index_resolved", "scene_index_resolved", "prompt_count", "outfit_count", "scene_count", "prompt_file", "outfit_file", "scene_file")
    FUNCTION = "build_prompt"
    CATEGORY = "Sick Ollie/Prompt"

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float("nan")

    def build_prompt(
        self,
        prompt_source,
        manual_prompt,
        prompt_log_file,
        prompt_mode,
        prompt_index,
        outfit_token_A,
        outfit_log_file_A,
        outfit_mode_A,
        outfit_index_A,
        outfit_token_B,
        outfit_log_file_B,
        outfit_mode_B,
        outfit_index_B,
        outfit_token_C,
        outfit_log_file_C,
        outfit_mode_C,
        outfit_index_C,
        scene_token,
        scene_log_file,
        scene_mode,
        scene_index,
        name_token,
        name_value,
        item_token,
        item_value,
        prefix_enabled,
        prefix_text,
        suffix_enabled,
        suffix_text,
        prefix_suffix_separator,
        cleanup_enabled,
        cleanup_rules,
        saved_prompt,
        extra_pnginfo=None,
        unique_id=None,
    ):
        prompt_line, prompt_index_resolved, prompt_count = _load_line(prompt_log_file, "prompt", prompt_index)
        outfit_A, outfit_index_A_resolved, outfit_count_A = _load_line(outfit_log_file_A, "outfit", outfit_index_A)
        outfit_B, outfit_index_B_resolved, outfit_count_B = _load_line(outfit_log_file_B, "outfit", outfit_index_B)
        outfit_C, outfit_index_C_resolved, outfit_count_C = _load_line(outfit_log_file_C, "outfit", outfit_index_C)
        scene_line, scene_index_resolved, scene_count = _load_line(scene_log_file, "scene", scene_index)

        source_prompt = prompt_line if str(prompt_source) == "log" else str(manual_prompt)
        assembled = source_prompt
        for token, value in ((outfit_token_A, outfit_A), (outfit_token_B, outfit_B), (outfit_token_C, outfit_C), (scene_token, scene_line)):
            if value:
                assembled = _apply_token(assembled, token, value)
        if str(name_value):
            assembled = _apply_token(assembled, name_token, name_value)
        if str(item_value):
            assembled = _apply_token(assembled, item_token, item_value)

        assembled = _join_prompt_parts(
            prefix_suffix_separator,
            prefix_text if prefix_enabled else "",
            assembled,
            suffix_text if suffix_enabled else "",
        )
        final_prompt = _apply_cleanup_rules(assembled, cleanup_rules) if cleanup_enabled else assembled.strip()

        extra = _extra_dict(extra_pnginfo)
        if extra is not None:
            extra["resolved_prompt"] = final_prompt
            extra["source_prompt"] = source_prompt
            extra["prompt_log_line"] = prompt_line
            extra["outfit_log_line"] = outfit_A
            extra["outfit_log_line_B"] = outfit_B
            extra["outfit_log_line_C"] = outfit_C
            extra["scene_log_line"] = scene_line
            workflow = extra.get("workflow")
            if isinstance(workflow, dict):
                node = _find_workflow_node(workflow, unique_id)
                if node:
                    props = node.setdefault("properties", {})
                    props.update({
                        "so_prompt_core_schema_version": 10,
                        "so_saved_final_prompt": final_prompt,
                        "so_saved_source_prompt": source_prompt,
                        "so_saved_prompt_line": prompt_line,
                        "so_saved_outfit_line": outfit_A,
                        "so_saved_outfit_line_B": outfit_B,
                        "so_saved_outfit_line_C": outfit_C,
                        "so_saved_scene_line": scene_line,
                    })

        primary_line, primary_index, primary_count, primary_file = outfit_A, outfit_index_A_resolved, outfit_count_A, outfit_log_file_A
        if not primary_count and outfit_count_B:
            primary_line, primary_index, primary_count, primary_file = outfit_B, outfit_index_B_resolved, outfit_count_B, outfit_log_file_B
        elif not primary_count and outfit_count_C:
            primary_line, primary_index, primary_count, primary_file = outfit_C, outfit_index_C_resolved, outfit_count_C, outfit_log_file_C

        return {
            "ui": {"resolved_prompt": [final_prompt]},
            "result": (
                final_prompt,
                source_prompt,
                prompt_line,
                primary_line,
                scene_line,
                int(prompt_index_resolved),
                int(primary_index),
                int(scene_index_resolved),
                int(prompt_count),
                int(primary_count),
                int(scene_count),
                str(prompt_log_file),
                str(primary_file),
                str(scene_log_file),
            ),
        }


NODE_CLASS_MAPPINGS = {"SOPromptLogEngine": SOPromptLogEngine}
NODE_DISPLAY_NAME_MAPPINGS = {"SOPromptLogEngine": "Prompt Core"}
