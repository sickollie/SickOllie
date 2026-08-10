from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import folder_paths

try:
    from aiohttp import web
    from server import PromptServer
except Exception:  # pragma: no cover - unavailable outside ComfyUI runtime
    web = None
    PromptServer = None

NO_FILE = "[None]"
PROMPT_SOURCES = ["manual", "log"]
INDEX_MODES = ["fixed", "increment", "decrement", "randomize", "shuffle"]
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


def _usable_log_lines(relative_path: str, category: str) -> list[str]:
    path = _resolve_log_path(relative_path, category)
    if path is None or not path.exists() or not path.is_file():
        return []
    return [line for line in _read_text_file(path).splitlines() if line.strip()]


if PromptServer is not None and web is not None:

    @PromptServer.instance.routes.get("/sickollie/studio/prompt-core/log-lines")
    async def so_prompt_core_log_lines(request):
        category = str(request.rel_url.query.get("category", "prompt") or "prompt")
        relative_path = str(request.rel_url.query.get("file", NO_FILE) or NO_FILE)
        if category not in LOG_CATEGORIES:
            return web.json_response({"ok": False, "error": "Invalid log category", "lines": [], "count": 0}, status=400)
        lines = _usable_log_lines(relative_path, category)
        return web.json_response({"ok": True, "lines": lines, "count": len(lines)})


def _load_line(relative_path: str, category: str, index_value: int):
    lines = _usable_log_lines(relative_path, category)
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

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("final_prompt",)
    FUNCTION = "build_prompt"
    CATEGORY = "Sick Ollie/Studio"

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

        # Track what actually participated in this prompt before replacing any
        # tokens. Loaded log rows are not considered "used" unless their token
        # was present in the selected source prompt.
        prompt_log_used = str(prompt_source) == "log" and bool(prompt_line)
        outfit_a_used = bool(outfit_A) and bool(str(outfit_token_A)) and str(outfit_token_A) in source_prompt
        outfit_b_used = bool(outfit_B) and bool(str(outfit_token_B)) and str(outfit_token_B) in source_prompt
        outfit_c_used = bool(outfit_C) and bool(str(outfit_token_C)) and str(outfit_token_C) in source_prompt
        scene_used = bool(scene_line) and bool(str(scene_token)) and str(scene_token) in source_prompt
        name_used = bool(str(name_value)) and bool(str(name_token)) and str(name_token) in source_prompt
        item_used = bool(str(item_value)) and bool(str(item_token)) and str(item_token) in source_prompt

        assembled = source_prompt
        for token, value, used in (
            (outfit_token_A, outfit_A, outfit_a_used),
            (outfit_token_B, outfit_B, outfit_b_used),
            (outfit_token_C, outfit_C, outfit_c_used),
            (scene_token, scene_line, scene_used),
        ):
            if used:
                assembled = _apply_token(assembled, token, value)
        if name_used:
            assembled = _apply_token(assembled, name_token, name_value)
        if item_used:
            assembled = _apply_token(assembled, item_token, item_value)

        assembled = _join_prompt_parts(
            prefix_suffix_separator,
            prefix_text if prefix_enabled else "",
            assembled,
            suffix_text if suffix_enabled else "",
        )
        final_prompt = _apply_cleanup_rules(assembled, cleanup_rules) if cleanup_enabled else assembled.strip()

        def _log_meta(used, token, file_name, index, count, line):
            if not used:
                return {}
            data = {
                "file": str(file_name),
                "index": int(index),
                "count": int(count),
                "line": str(line),
            }
            if token is not None:
                data["token"] = str(token)
            return data

        resolved_metadata = {
            "schema_version": 2,
            "final_prompt": final_prompt,
            "source_prompt": source_prompt,
            "prompt": ({
                "source": "log",
                "file": str(prompt_log_file),
                "index": int(prompt_index_resolved),
                "count": int(prompt_count),
                "line": prompt_line,
            } if prompt_log_used else {
                "source": "manual",
                "manual_prompt": str(manual_prompt),
            }),
            "outfit_a": _log_meta(outfit_a_used, outfit_token_A, outfit_log_file_A, outfit_index_A_resolved, outfit_count_A, outfit_A),
            "outfit_b": _log_meta(outfit_b_used, outfit_token_B, outfit_log_file_B, outfit_index_B_resolved, outfit_count_B, outfit_B),
            "outfit_c": _log_meta(outfit_c_used, outfit_token_C, outfit_log_file_C, outfit_index_C_resolved, outfit_count_C, outfit_C),
            "scene": _log_meta(scene_used, scene_token, scene_log_file, scene_index_resolved, scene_count, scene_line),
            "name": ({"token": str(name_token), "value": str(name_value)} if name_used else {}),
            "item": ({"token": str(item_token), "value": str(item_value)} if item_used else {}),
            "prefix": ({"enabled": True, "text": str(prefix_text)} if prefix_enabled and str(prefix_text).strip() else {}),
            "suffix": ({"enabled": True, "text": str(suffix_text)} if suffix_enabled and str(suffix_text).strip() else {}),
            "separator": str(prefix_suffix_separator),
            "cleanup": {"enabled": bool(cleanup_enabled)},
        }


        extra = _extra_dict(extra_pnginfo)
        if extra is not None:
            # Keep the original keys for backward compatibility while also
            # embedding a stable, structured block for Image Metadata Core.
            extra["resolved_prompt"] = final_prompt
            extra["source_prompt"] = source_prompt
            extra["prompt_log_line"] = prompt_line if prompt_log_used else ""
            extra["outfit_log_line"] = outfit_A if outfit_a_used else ""
            extra["outfit_log_line_B"] = outfit_B if outfit_b_used else ""
            extra["outfit_log_line_C"] = outfit_C if outfit_c_used else ""
            extra["scene_log_line"] = scene_line if scene_used else ""
            extra["so_prompt_core_resolved"] = resolved_metadata

            # Dedicated scalar fields describe only values that actually
            # participated in the generated prompt.
            extra["so_prompt_file"] = str(prompt_log_file) if prompt_log_used else ""
            extra["so_prompt_index_resolved"] = int(prompt_index_resolved) if prompt_log_used else None
            extra["so_prompt_count"] = int(prompt_count) if prompt_log_used else 0
            extra["so_outfit_a_file"] = str(outfit_log_file_A) if outfit_a_used else ""
            extra["so_outfit_a_index_resolved"] = int(outfit_index_A_resolved) if outfit_a_used else None
            extra["so_outfit_a_count"] = int(outfit_count_A) if outfit_a_used else 0
            extra["so_outfit_b_file"] = str(outfit_log_file_B) if outfit_b_used else ""
            extra["so_outfit_b_index_resolved"] = int(outfit_index_B_resolved) if outfit_b_used else None
            extra["so_outfit_b_count"] = int(outfit_count_B) if outfit_b_used else 0
            extra["so_outfit_c_file"] = str(outfit_log_file_C) if outfit_c_used else ""
            extra["so_outfit_c_index_resolved"] = int(outfit_index_C_resolved) if outfit_c_used else None
            extra["so_outfit_c_count"] = int(outfit_count_C) if outfit_c_used else 0
            extra["so_scene_file"] = str(scene_log_file) if scene_used else ""
            extra["so_scene_index_resolved"] = int(scene_index_resolved) if scene_used else None
            extra["so_scene_count"] = int(scene_count) if scene_used else 0
            workflow = extra.get("workflow")
            if isinstance(workflow, dict):
                node = _find_workflow_node(workflow, unique_id)
                if node:
                    props = node.setdefault("properties", {})
                    props.update({
                        "so_prompt_core_schema_version": 10,
                        "so_saved_final_prompt": final_prompt,
                        "so_saved_source_prompt": source_prompt,
                        "so_saved_prompt_line": prompt_line if prompt_log_used else "",
                        "so_saved_outfit_line": outfit_A if outfit_a_used else "",
                        "so_saved_outfit_line_B": outfit_B if outfit_b_used else "",
                        "so_saved_outfit_line_C": outfit_C if outfit_c_used else "",
                        "so_saved_scene_line": scene_line if scene_used else "",
                    })

        primary_line, primary_index, primary_count, primary_file = outfit_A, outfit_index_A_resolved, outfit_count_A, outfit_log_file_A
        if not primary_count and outfit_count_B:
            primary_line, primary_index, primary_count, primary_file = outfit_B, outfit_index_B_resolved, outfit_count_B, outfit_log_file_B
        elif not primary_count and outfit_count_C:
            primary_line, primary_index, primary_count, primary_file = outfit_C, outfit_index_C_resolved, outfit_count_C, outfit_log_file_C

        return {
            "ui": {"resolved_prompt": [final_prompt]},
            "result": (final_prompt,),
        }


NODE_CLASS_MAPPINGS = {"SOPromptLogEngineStudio": SOPromptLogEngine}
NODE_DISPLAY_NAME_MAPPINGS = {"SOPromptLogEngineStudio": "Prompt Core"}
