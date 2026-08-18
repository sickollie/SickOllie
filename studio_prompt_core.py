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
PLACEMENT_MODES = ["smart", "token", "append", "prepend", "off"]
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


def _token_candidates(configured_token: str, *standard_aliases: str) -> tuple[str, ...]:
    """Return explicit and braced spellings, longest-first and without duplicates."""
    candidates: list[str] = []

    def add(raw_token: str) -> None:
        token = str(raw_token or "").strip()
        if not token:
            return
        if token.startswith("{") and token.endswith("}") and len(token) > 2:
            bare = token[1:-1].strip()
            for value in (token, bare):
                if value and value not in candidates:
                    candidates.append(value)
            return
        for value in (f"{{{token}}}", token):
            if value not in candidates:
                candidates.append(value)

    add(configured_token)
    for alias in standard_aliases:
        add(alias)
    return tuple(sorted(candidates, key=len, reverse=True))


def _alias_pattern(candidates: tuple[str, ...] | list[str]) -> re.Pattern | None:
    parts = []
    for candidate in candidates:
        token = str(candidate or "")
        if not token:
            continue
        escaped = re.escape(token)
        left = r"(?<![A-Za-z0-9_])" if re.match(r"[A-Za-z0-9_]", token[0]) else ""
        right = r"(?![A-Za-z0-9_])" if re.match(r"[A-Za-z0-9_]", token[-1]) else ""
        parts.append(f"{left}(?:{escaped}){right}")
    return re.compile("|".join(parts)) if parts else None


def _find_aliases(text: str, candidates: tuple[str, ...] | list[str]) -> list[str]:
    pattern = _alias_pattern(candidates)
    if pattern is None:
        return []
    found: list[str] = []
    for match in pattern.finditer(str(text)):
        token = match.group(0)
        if token not in found:
            found.append(token)
    return found


def _replace_aliases(
    text: str,
    candidates: tuple[str, ...] | list[str],
    value: str,
) -> tuple[str, list[str], int]:
    """Replace complete placeholder aliases without matching token prefixes."""
    pattern = _alias_pattern(candidates)
    if pattern is None:
        return str(text), [], 0
    matched: list[str] = []

    def replace(match: re.Match) -> str:
        token = match.group(0)
        if token not in matched:
            matched.append(token)
        return str(value)

    replaced, count = pattern.subn(replace, str(text))
    return replaced, matched, count


def _apply_token(text: str, token: str, value: str) -> str:
    # Kept as a compatibility helper for callers that import it directly.
    return _replace_aliases(text, _token_candidates(token), value)[0]


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


def _join_component_parts(separator: str, *parts: str) -> str:
    """Join assembly parts without producing a comma immediately after punctuation."""
    values = [str(part).strip() for part in parts if str(part).strip()]
    if not values:
        return ""
    result = values[0]
    for value in values[1:]:
        joiner = str(separator)
        if joiner == ", " and re.search(r"[.,;:!?]$", result):
            joiner = " "
        result = f"{result}{joiner}{value}"
    return result


def _compact_removed_placeholder(text: str) -> str:
    result = re.sub(r"[ \t]+([,.;:!?])", r"\1", str(text))
    return re.sub(r"[ \t]{2,}", " ", result)


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
                "outfit_placement_A": (PLACEMENT_MODES, {"default": "smart"}),
                "outfit_log_file_A": (outfit_files, {"default": NO_FILE}),
                "outfit_mode_A": (INDEX_MODES, {"default": "randomize"}),
                "outfit_index_A": ("INT", int_widget),
                "outfit_token_B": ("STRING", {"default": "OUTFIT_B", "multiline": False}),
                "outfit_placement_B": (PLACEMENT_MODES, {"default": "smart"}),
                "outfit_log_file_B": (outfit_files, {"default": NO_FILE}),
                "outfit_mode_B": (INDEX_MODES, {"default": "randomize"}),
                "outfit_index_B": ("INT", int_widget),
                "outfit_token_C": ("STRING", {"default": "OUTFIT_C", "multiline": False}),
                "outfit_placement_C": (PLACEMENT_MODES, {"default": "smart"}),
                "outfit_log_file_C": (outfit_files, {"default": NO_FILE}),
                "outfit_mode_C": (INDEX_MODES, {"default": "randomize"}),
                "outfit_index_C": ("INT", int_widget),
                "scene_token": ("STRING", {"default": "SCENE", "multiline": False}),
                "scene_placement": (PLACEMENT_MODES, {"default": "smart"}),
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
                "trigger_token": ("STRING", {"default": "TRIGGER", "multiline": False}),
                "trigger_placement": (PLACEMENT_MODES, {"default": "off"}),
                "trigger_override": ("STRING", {"default": "", "multiline": False}),
            },
            "optional": {"main_trigger": ("STRING", {"forceInput": True})},
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
        outfit_placement_A,
        outfit_log_file_A,
        outfit_mode_A,
        outfit_index_A,
        outfit_token_B,
        outfit_placement_B,
        outfit_log_file_B,
        outfit_mode_B,
        outfit_index_B,
        outfit_token_C,
        outfit_placement_C,
        outfit_log_file_C,
        outfit_mode_C,
        outfit_index_C,
        scene_token,
        scene_placement,
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
        trigger_token="TRIGGER",
        trigger_placement="off",
        trigger_override="",
        main_trigger="",
        extra_pnginfo=None,
        unique_id=None,
    ):
        prompt_line, prompt_index_resolved, prompt_count = _load_line(prompt_log_file, "prompt", prompt_index)
        outfit_A, outfit_index_A_resolved, outfit_count_A = _load_line(outfit_log_file_A, "outfit", outfit_index_A)
        outfit_B, outfit_index_B_resolved, outfit_count_B = _load_line(outfit_log_file_B, "outfit", outfit_index_B)
        outfit_C, outfit_index_C_resolved, outfit_count_C = _load_line(outfit_log_file_C, "outfit", outfit_index_C)
        scene_line, scene_index_resolved, scene_count = _load_line(scene_log_file, "scene", scene_index)

        source_prompt = prompt_line if str(prompt_source) == "log" else str(manual_prompt)

        prompt_log_used = str(prompt_source) == "log" and bool(prompt_line)
        assembled = source_prompt
        prepended_components: list[str] = []
        appended_components: list[str] = []
        component_results: dict[str, dict[str, Any]] = {}

        component_specs = (
            ("outfit_a", outfit_A, outfit_token_A, outfit_placement_A, ("OUTFIT_A", "OUTFIT")),
            ("outfit_b", outfit_B, outfit_token_B, outfit_placement_B, ("OUTFIT_B",)),
            ("outfit_c", outfit_C, outfit_token_C, outfit_placement_C, ("OUTFIT_C",)),
            ("scene", scene_line, scene_token, scene_placement, ("SCENE",)),
        )

        for key, line, configured_token, raw_placement, standard_aliases in component_specs:
            placement = str(raw_placement or "token").strip().lower()
            if placement not in PLACEMENT_MODES:
                placement = "token"
            candidates = _token_candidates(configured_token, *standard_aliases)
            matches = _find_aliases(assembled, candidates)
            result = {
                "used": False,
                "placement": placement,
                "action": "off" if placement == "off" else "waiting",
                "token": str(configured_token),
                "matched_tokens": matches,
            }

            if placement == "off":
                if matches:
                    assembled, removed, _ = _replace_aliases(assembled, candidates, "")
                    assembled = _compact_removed_placeholder(assembled)
                    result["matched_tokens"] = removed
                    result["action"] = "remove"
            elif not str(line).strip():
                result["action"] = "missing_source"
            elif placement == "token":
                if matches:
                    assembled, replaced, _ = _replace_aliases(assembled, candidates, line)
                    result.update({"used": True, "action": "replace", "matched_tokens": replaced})
                else:
                    result["action"] = "missing_placeholder"
            elif placement == "smart":
                if matches:
                    assembled, replaced, _ = _replace_aliases(assembled, candidates, line)
                    result.update({"used": True, "action": "replace", "matched_tokens": replaced})
                else:
                    appended_components.append(str(line))
                    result.update({"used": True, "action": "append"})
            elif placement in {"append", "prepend"}:
                if matches:
                    assembled, removed, _ = _replace_aliases(assembled, candidates, "")
                    assembled = _compact_removed_placeholder(assembled)
                    result["matched_tokens"] = removed
                if placement == "append":
                    appended_components.append(str(line))
                else:
                    prepended_components.append(str(line))
                result.update({"used": True, "action": placement})

            component_results[key] = result

        selected_trigger = str(trigger_override or main_trigger or "").strip()
        trigger_candidates = _token_candidates(trigger_token, "TRIGGER")
        trigger_matches = _find_aliases(assembled, trigger_candidates)
        trigger_mode = str(trigger_placement or "off").strip().lower()
        if trigger_mode not in PLACEMENT_MODES:
            trigger_mode = "off"
        trigger_result = {
            "used": False, "placement": trigger_mode,
            "action": "off" if trigger_mode == "off" else "waiting",
            "token": str(trigger_token), "matched_tokens": trigger_matches,
            "value": selected_trigger,
            "source": "override" if str(trigger_override or "").strip() else "loader",
        }
        if trigger_mode == "off":
            if trigger_matches:
                assembled, removed, _ = _replace_aliases(assembled, trigger_candidates, "")
                assembled = _compact_removed_placeholder(assembled)
                trigger_result.update({"action": "remove", "matched_tokens": removed})
        elif not selected_trigger:
            trigger_result["action"] = "missing_source"
        elif trigger_mode == "token":
            if trigger_matches:
                assembled, replaced, _ = _replace_aliases(assembled, trigger_candidates, selected_trigger)
                trigger_result.update({"used": True, "action": "replace", "matched_tokens": replaced})
            else:
                trigger_result["action"] = "missing_placeholder"
        elif trigger_mode == "smart":
            if trigger_matches:
                assembled, replaced, _ = _replace_aliases(assembled, trigger_candidates, selected_trigger)
                trigger_result.update({"used": True, "action": "replace", "matched_tokens": replaced})
            else:
                prepended_components.append(selected_trigger)
                trigger_result.update({"used": True, "action": "prepend"})
        elif trigger_mode in {"append", "prepend"}:
            if trigger_matches:
                assembled, removed, _ = _replace_aliases(assembled, trigger_candidates, "")
                assembled = _compact_removed_placeholder(assembled)
                trigger_result["matched_tokens"] = removed
            (appended_components if trigger_mode == "append" else prepended_components).append(selected_trigger)
            trigger_result.update({"used": True, "action": trigger_mode})
        component_results["trigger"] = trigger_result

        assembled = _join_component_parts(
            prefix_suffix_separator,
            *prepended_components,
            assembled,
            *appended_components,
        )

        name_candidates = _token_candidates(name_token, "NAME")
        item_candidates = _token_candidates(item_token, "ITEM")
        name_matches = _find_aliases(assembled, name_candidates)
        item_matches = _find_aliases(assembled, item_candidates)
        name_used = bool(str(name_value)) and bool(name_matches)
        item_used = bool(str(item_value)) and bool(item_matches)
        if name_used:
            assembled, name_matches, _ = _replace_aliases(assembled, name_candidates, name_value)
        if item_used:
            assembled, item_matches, _ = _replace_aliases(assembled, item_candidates, item_value)

        outfit_a_used = bool(component_results["outfit_a"]["used"])
        outfit_b_used = bool(component_results["outfit_b"]["used"])
        outfit_c_used = bool(component_results["outfit_c"]["used"])
        scene_used = bool(component_results["scene"]["used"])

        assembled = _join_prompt_parts(
            prefix_suffix_separator,
            prefix_text if prefix_enabled else "",
            assembled,
            suffix_text if suffix_enabled else "",
        )
        final_prompt = _apply_cleanup_rules(assembled, cleanup_rules) if cleanup_enabled else assembled.strip()

        def _log_meta(result, file_name, index, count, line):
            data = {
                "used": bool(result.get("used")),
                "placement": str(result.get("placement", "token")),
                "action": str(result.get("action", "waiting")),
                "token": str(result.get("token", "")),
                "matched_tokens": list(result.get("matched_tokens") or []),
            }
            if str(file_name) != NO_FILE:
                data["file"] = str(file_name)
                data["count"] = int(count)
            if result.get("used"):
                data["index"] = int(index)
                data["line"] = str(line)
            return data

        resolved_metadata = {
            "schema_version": 4,
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
            "outfit_a": _log_meta(component_results["outfit_a"], outfit_log_file_A, outfit_index_A_resolved, outfit_count_A, outfit_A),
            "outfit_b": _log_meta(component_results["outfit_b"], outfit_log_file_B, outfit_index_B_resolved, outfit_count_B, outfit_B),
            "outfit_c": _log_meta(component_results["outfit_c"], outfit_log_file_C, outfit_index_C_resolved, outfit_count_C, outfit_C),
            "scene": _log_meta(component_results["scene"], scene_log_file, scene_index_resolved, scene_count, scene_line),
            "trigger": component_results["trigger"],
            "name": {"used": name_used, "token": str(name_token), "value": str(name_value), "matched_tokens": name_matches},
            "item": {"used": item_used, "token": str(item_token), "value": str(item_value), "matched_tokens": item_matches},
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
                        "so_prompt_core_schema_version": 12,
                        "so_saved_final_prompt": final_prompt,
                        "so_saved_source_prompt": source_prompt,
                        "so_saved_prompt_line": prompt_line if prompt_log_used else "",
                        "so_saved_outfit_line": outfit_A if outfit_a_used else "",
                        "so_saved_outfit_line_B": outfit_B if outfit_b_used else "",
                        "so_saved_outfit_line_C": outfit_C if outfit_c_used else "",
                        "so_saved_scene_line": scene_line if scene_used else "",
                        "so_last_assembly_status": resolved_metadata,
                    })

        primary_line, primary_index, primary_count, primary_file = outfit_A, outfit_index_A_resolved, outfit_count_A, outfit_log_file_A
        if not primary_count and outfit_count_B:
            primary_line, primary_index, primary_count, primary_file = outfit_B, outfit_index_B_resolved, outfit_count_B, outfit_log_file_B
        elif not primary_count and outfit_count_C:
            primary_line, primary_index, primary_count, primary_file = outfit_C, outfit_index_C_resolved, outfit_count_C, outfit_log_file_C

        return {
            "ui": {
                "resolved_prompt": [final_prompt],
                "assembly_status": [resolved_metadata],
            },
            "result": (final_prompt,),
        }


NODE_CLASS_MAPPINGS = {"SOPromptLogEngineStudio": SOPromptLogEngine}
NODE_DISPLAY_NAME_MAPPINGS = {"SOPromptLogEngineStudio": "Prompt Core"}
