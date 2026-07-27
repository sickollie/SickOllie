from __future__ import annotations

import os
import re
import torch
from collections import OrderedDict
from typing import Any

import folder_paths
import comfy.sd
import comfy.utils


class _AnyType(str):
    """A Comfy wildcard type that accepts dynamic custom-widget values."""

    def __ne__(self, other):
        return False


class _FlexibleOptionalInputType(dict):
    """Allow a dynamic number of optional inputs from serialized widgets."""

    def __init__(self, flexible_type, data=None):
        self.flexible_type = flexible_type
        self.data = data or {}
        super().__init__(self.data)

    def __getitem__(self, key):
        if key in self.data:
            return self.data[key]
        return (self.flexible_type,)

    def __contains__(self, key):
        return True


_ANY_TYPE = _AnyType("*")


NO_LORA = "None"
ALL_FOLDERS = "[All LoRA folders]"
ROOT_FOLDER = "[LoRA root only]"
CONTROL_MODES = ["fixed", "increment", "decrement", "randomize"]

DEFAULT_CLEANUP_RULES = r"""(?i)_\d+$
(?i)_sickollie$
(?i)_krea2$
(?i)_epoch$"""


def _normalize_path(value: str) -> str:
    return str(value).replace("\\", "/").strip("/")


def _all_lora_names() -> list[str]:
    names = list(folder_paths.get_filename_list("loras"))
    return [name for name in names if name != NO_LORA]


def _parent_folder(lora_name: str) -> str:
    normalized = _normalize_path(lora_name)
    if "/" not in normalized:
        return ""
    return normalized.rsplit("/", 1)[0]


def _folder_choices() -> list[str]:
    folders: set[str] = set()

    for name in _all_lora_names():
        parent = _parent_folder(name)
        if not parent:
            continue

        parts = parent.split("/")
        for index in range(1, len(parts) + 1):
            folders.add("/".join(parts[:index]))

    return [ALL_FOLDERS, ROOT_FOLDER] + sorted(folders, key=lambda value: value.lower())


def _main_lora_choices() -> list[str]:
    return [NO_LORA] + _all_lora_names()


def _matches_folder(lora_name: str, folder_name: str, include_subfolders: bool) -> bool:
    parent = _parent_folder(lora_name)

    if folder_name == ALL_FOLDERS:
        return True

    if folder_name == ROOT_FOLDER:
        return parent == ""

    selected = _normalize_path(folder_name)
    if include_subfolders:
        return parent == selected or parent.startswith(selected + "/")

    return parent == selected


def _folder_loras(folder_name: str, include_subfolders: bool) -> list[str]:
    return [
        name
        for name in _all_lora_names()
        if _matches_folder(name, folder_name, include_subfolders)
    ]


def _apply_cleanup_rules(stem: str, rules_text: str) -> str:
    """
    Apply sequential regex replacement rules repeatedly until stable.

    Rule formats:
      PATTERN
      PATTERN => REPLACEMENT

    A pattern without `=>` is replaced with an empty string.
    Blank lines and lines starting with # are ignored.
    """
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
            print(
                "[Sick Ollie LoRA Tools] Ignoring invalid cleanup regex "
                f"on line {line_number}: {pattern_text!r} ({error})"
            )

    result = str(stem)

    # Repeating is what allows:
    # becky_krea2_epoch_12 -> becky_krea2_epoch -> becky_krea2 -> becky
    for _ in range(20):
        previous = result
        for pattern, replacement in parsed_rules:
            result = pattern.sub(replacement, result)

        if result == previous:
            break

    return result.strip(" _-.")


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


def _replace_exact(value: Any, selected: str, replacement: str) -> Any:
    if isinstance(value, str):
        return replacement if value == selected else value

    if isinstance(value, list):
        return [_replace_exact(item, selected, replacement) for item in value]

    if isinstance(value, tuple):
        return tuple(_replace_exact(item, selected, replacement) for item in value)

    if isinstance(value, dict):
        return {
            key: _replace_exact(item, selected, replacement)
            for key, item in value.items()
        }

    return value


def _scrub_inactive_selection(
    *,
    prompt: Any,
    extra_pnginfo: Any,
    unique_id: Any,
    input_name: str,
    selected: str,
) -> None:
    """
    Remove an inactive selected LoRA from the prompt/workflow metadata while
    leaving the live canvas widget untouched.
    """
    if not selected or selected == NO_LORA:
        return

    if isinstance(prompt, dict):
        entry = prompt.get(str(unique_id))
        if entry is None:
            entry = prompt.get(unique_id)

        if isinstance(entry, dict):
            inputs = entry.get("inputs")
            if isinstance(inputs, dict):
                inputs[input_name] = NO_LORA

    extra = _extra_dict(extra_pnginfo)
    if extra is None:
        return

    workflow = extra.get("workflow")
    if not isinstance(workflow, dict):
        return

    node = _find_workflow_node(workflow, unique_id)
    if not isinstance(node, dict):
        return

    if "widgets_values" in node:
        node["widgets_values"] = _replace_exact(
            node["widgets_values"],
            selected,
            NO_LORA,
        )

    node.setdefault("properties", {})[
        f"so_scrubbed_{input_name}"
    ] = selected


class FolderBatchLoraStackModelOnly:
    """
    Folder-scoped main LoRA batch tester plus four fixed secondary LoRA slots.

    Queue-time progression is handled by the companion JavaScript extension.
    Python loads exactly the values serialized into each queued prompt.
    """

    CACHE_LIMIT = 8

    def __init__(self):
        self._lora_cache: OrderedDict[str, tuple[Any, Any]] = OrderedDict()

    @classmethod
    def INPUT_TYPES(cls):
        lora_combo = _main_lora_choices()

        required = {
            "model": ("MODEL",),
            "folder_name": (
                _folder_choices(),
                {
                    "default": ALL_FOLDERS,
                    "tooltip": (
                        "Restrict the main cycling LoRA to this folder. "
                        "The dropdown is generated from your ComfyUI LoRA directory."
                    ),
                },
            ),
            "include_subfolders": (
                "BOOLEAN",
                {
                    "default": False,
                    "tooltip": "Include nested LoRA folders beneath the selected folder.",
                },
            ),
            "main_lora": (
                lora_combo,
                {
                    "default": NO_LORA,
                    "tooltip": (
                        "Main LoRA tested sequentially. The browser filters this dropdown "
                        "to the selected folder."
                    ),
                },
            ),
            "control_after_generate": (
                CONTROL_MODES,
                {
                    "default": "increment",
                    "tooltip": (
                        "Changes main_lora after each prompt is queued, so large Queue counts "
                        "receive different LoRAs before execution begins."
                    ),
                },
            ),
            "loop_folder": (
                "BOOLEAN",
                {
                    "default": True,
                    "tooltip": "Wrap from the final LoRA back to the first LoRA.",
                },
            ),
            "skip_none_during_cycle": (
                "BOOLEAN",
                {
                    "default": True,
                    "tooltip": (
                        "Keep None available for manual use but exclude it from automatic cycling."
                    ),
                },
            ),
            "main_enabled": (
                "BOOLEAN",
                {
                    "default": True,
                    "tooltip": "Disable the main LoRA without falsely recording it in PNG metadata.",
                },
            ),
            "main_strength": (
                "FLOAT",
                {
                    "default": 1.0,
                    "min": -100.0,
                    "max": 100.0,
                    "step": 0.01,
                },
            ),
            "off_name": (
                "STRING",
                {
                    "default": "no_lora",
                    "multiline": False,
                    "tooltip": "Name outputs used when the main LoRA is inactive.",
                },
            ),
            "auto_clean_name": (
                "BOOLEAN",
                {
                    "default": True,
                    "tooltip": "Create clean_name by applying cleanup_rules to raw_stem.",
                },
            ),
            "cleanup_rules": (
                "STRING",
                {
                    "default": DEFAULT_CLEANUP_RULES,
                    "multiline": True,
                    "dynamicPrompts": False,
                    "tooltip": (
                        "One regex per line. Each match is removed. "
                        "Use PATTERN => REPLACEMENT when a replacement is needed. "
                        "Rules repeat until the name stops changing."
                    ),
                },
            ),
        }

        # Four fixed secondary slots are intentionally used instead of fragile
        # frontend-only autogrow widgets.
        for index in range(1, 5):
            required[f"secondary_{index}_lora"] = (
                lora_combo,
                {
                    "default": NO_LORA,
                    "tooltip": (
                        f"Optional fixed secondary LoRA {index}. "
                        "This slot does not participate in folder cycling."
                    ),
                },
            )
            required[f"secondary_{index}_enabled"] = (
                "BOOLEAN",
                {"default": False},
            )
            required[f"secondary_{index}_strength"] = (
                "FLOAT",
                {
                    "default": 1.0,
                    "min": -100.0,
                    "max": 100.0,
                    "step": 0.01,
                },
            )

        return {
            "required": required,
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = (
        "MODEL",
        "STRING",
        "STRING",
        "STRING",
        "STRING",
        "BOOLEAN",
        "INT",
    )
    RETURN_NAMES = (
        "model",
        "main_file",
        "raw_stem",
        "clean_name",
        "applied_loras",
        "main_active",
        "folder_count",
    )
    FUNCTION = "load_loras"
    CATEGORY = "Sick Ollie/LoRA"
    DESCRIPTION = (
        "Folder-scoped, looping main LoRA tester with queue-time progression, "
        "editable regex name cleaning, four secondary LoRA slots, and inactive "
        "metadata scrubbing."
    )
    SEARCH_ALIASES = [
        "folder batch lora",
        "loop lora folder",
        "sequential lora tester",
        "lora stack",
        "lora name cleaner",
        "batch lora folder",
    ]

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # Ensures metadata cleanup and string outputs run for every queued image.
        return float("nan")

    def _load_lora_state(self, lora_name: str):
        lora_path = folder_paths.get_full_path_or_raise("loras", lora_name)

        if lora_path in self._lora_cache:
            value = self._lora_cache.pop(lora_path)
            self._lora_cache[lora_path] = value
            return value

        try:
            state, metadata = comfy.utils.load_torch_file(
                lora_path,
                safe_load=True,
                return_metadata=True,
            )
        except TypeError:
            state = comfy.utils.load_torch_file(
                lora_path,
                safe_load=True,
            )
            metadata = None

        self._lora_cache[lora_path] = (state, metadata)

        while len(self._lora_cache) > self.CACHE_LIMIT:
            self._lora_cache.popitem(last=False)

        return state, metadata

    @staticmethod
    def _apply_model_lora(model, state, strength: float, metadata):
        try:
            model_lora, _ = comfy.sd.load_lora_for_models(
                model,
                None,
                state,
                float(strength),
                0.0,
                lora_metadata=metadata,
            )
        except TypeError:
            model_lora, _ = comfy.sd.load_lora_for_models(
                model,
                None,
                state,
                float(strength),
                0.0,
            )

        return model_lora

    def load_loras(
        self,
        model,
        folder_name: str,
        include_subfolders: bool,
        main_lora: str,
        control_after_generate: str,
        loop_folder: bool,
        skip_none_during_cycle: bool,
        main_enabled: bool,
        main_strength: float,
        off_name: str,
        auto_clean_name: bool,
        cleanup_rules: str,
        secondary_1_lora: str,
        secondary_1_enabled: bool,
        secondary_1_strength: float,
        secondary_2_lora: str,
        secondary_2_enabled: bool,
        secondary_2_strength: float,
        secondary_3_lora: str,
        secondary_3_enabled: bool,
        secondary_3_strength: float,
        secondary_4_lora: str,
        secondary_4_enabled: bool,
        secondary_4_strength: float,
        prompt=None,
        extra_pnginfo=None,
        unique_id=None,
    ):
        selected_main = str(main_lora or NO_LORA)
        main_active = bool(
            main_enabled
            and selected_main != NO_LORA
            and float(main_strength) != 0.0
        )

        if main_active:
            main_file = selected_main
            raw_stem = os.path.splitext(
                os.path.basename(
                    _normalize_path(selected_main)
                )
            )[0]
        else:
            main_file = str(off_name).strip() or "no_lora"
            raw_stem = main_file
            _scrub_inactive_selection(
                prompt=prompt,
                extra_pnginfo=extra_pnginfo,
                unique_id=unique_id,
                input_name="main_lora",
                selected=selected_main,
            )

        clean_name = (
            _apply_cleanup_rules(raw_stem, cleanup_rules)
            if auto_clean_name
            else raw_stem
        )
        if not clean_name:
            clean_name = raw_stem

        current_model = model
        applied: list[str] = []

        if main_active:
            state, metadata = self._load_lora_state(selected_main)
            current_model = self._apply_model_lora(
                current_model,
                state,
                float(main_strength),
                metadata,
            )
            applied.append(f"{selected_main}@{float(main_strength):g}")

        secondary_values = [
            (
                "secondary_1_lora",
                str(secondary_1_lora or NO_LORA),
                bool(secondary_1_enabled),
                float(secondary_1_strength),
            ),
            (
                "secondary_2_lora",
                str(secondary_2_lora or NO_LORA),
                bool(secondary_2_enabled),
                float(secondary_2_strength),
            ),
            (
                "secondary_3_lora",
                str(secondary_3_lora or NO_LORA),
                bool(secondary_3_enabled),
                float(secondary_3_strength),
            ),
            (
                "secondary_4_lora",
                str(secondary_4_lora or NO_LORA),
                bool(secondary_4_enabled),
                float(secondary_4_strength),
            ),
        ]

        for input_name, lora_name, enabled, strength in secondary_values:
            active = bool(
                enabled
                and lora_name != NO_LORA
                and strength != 0.0
            )

            if not active:
                _scrub_inactive_selection(
                    prompt=prompt,
                    extra_pnginfo=extra_pnginfo,
                    unique_id=unique_id,
                    input_name=input_name,
                    selected=lora_name,
                )
                continue

            state, metadata = self._load_lora_state(lora_name)
            current_model = self._apply_model_lora(
                current_model,
                state,
                strength,
                metadata,
            )
            applied.append(f"{lora_name}@{strength:g}")

        folder_count = len(
            _folder_loras(folder_name, bool(include_subfolders))
        )

        return (
            current_model,
            main_file,
            raw_stem,
            clean_name,
            "\n".join(applied),
            main_active,
            folder_count,
        )


class LoaderCoreEngine(FolderBatchLoraStackModelOnly):
    """
    Diffusion-model loader, folder-cycling primary LoRA, and a dynamic
    rgthree-style secondary LoRA stack.
    """

    def __init__(self):
        super().__init__()
        self._base_model_cache = None

    @classmethod
    def INPUT_TYPES(cls):
        diffusion_models = list(
            folder_paths.get_filename_list("diffusion_models")
        )

        required = {
            "diffusion_model": (
                diffusion_models,
                {
                    "tooltip": (
                        "Diffusion model loaded internally before LoRAs."
                    ),
                },
            ),
            "weight_dtype": (
                [
                    "default",
                    "fp8_e4m3fn",
                    "fp8_e4m3fn_fast",
                    "fp8_e5m2",
                ],
                {
                    "default": "default",
                    "advanced": True,
                },
            ),
            "folder_name": (
                _folder_choices(),
                {
                    "default": ALL_FOLDERS,
                    "tooltip": (
                        "Restrict the primary cycling LoRA to this folder."
                    ),
                },
            ),
            "main_enabled": (
                "BOOLEAN",
                {
                    "default": True,
                    "tooltip": "Enable or disable the primary LoRA.",
                },
            ),
            "main_lora": (
                _main_lora_choices(),
                {
                    "default": NO_LORA,
                    "tooltip": "Primary LoRA used for folder batch testing.",
                },
            ),
            "main_strength": (
                "FLOAT",
                {
                    "default": 1.0,
                    "min": -100.0,
                    "max": 100.0,
                    "step": 0.01,
                },
            ),
            "include_subfolders": (
                "BOOLEAN",
                {
                    "default": False,
                },
            ),
            "loop_folder": (
                "BOOLEAN",
                {
                    "default": True,
                },
            ),
            "control_after_generate": (
                CONTROL_MODES,
                {
                    "default": "increment",
                },
            ),
            "skip_none_during_cycle": (
                "BOOLEAN",
                {
                    "default": True,
                },
            ),
            "off_name": (
                "STRING",
                {
                    "default": "no_lora",
                    "multiline": False,
                },
            ),
            "auto_clean_name": (
                "BOOLEAN",
                {
                    "default": True,
                },
            ),
            "cleanup_rules": (
                "STRING",
                {
                    "default": DEFAULT_CLEANUP_RULES,
                    "multiline": True,
                    "dynamicPrompts": False,
                },
            ),
        }

        return {
            "required": required,
            "optional": _FlexibleOptionalInputType(
                _ANY_TYPE,
                data={},
            ),
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = (
        "MODEL",
        "STRING",
        "STRING",
        "STRING",
        "STRING",
        "STRING",
        "STRING",
        "BOOLEAN",
        "INT",
    )
    RETURN_NAMES = (
        "model",
        "diffusion_model_file",
        "diffusion_model_stem",
        "main_file",
        "raw_stem",
        "clean_name",
        "applied_loras",
        "main_active",
        "folder_count",
    )
    FUNCTION = "load_core"
    CATEGORY = "Sick Ollie/LoRA"
    DESCRIPTION = (
        "Loads a diffusion model, applies a folder-cycling primary LoRA, "
        "then applies a dynamic rgthree-powered secondary LoRA stack."
    )
    SEARCH_ALIASES = [
        "loader core",
        "diffusion model lora loader",
        "folder batch lora",
        "power lora stack",
        "sequential lora tester",
    ]

    def _load_base_model(
        self,
        diffusion_model: str,
        weight_dtype: str,
    ):
        model_path = folder_paths.get_full_path_or_raise(
            "diffusion_models",
            diffusion_model,
        )
        cache_key = (model_path, str(weight_dtype))

        if (
            self._base_model_cache is not None
            and self._base_model_cache[0] == cache_key
        ):
            return self._base_model_cache[1]

        model_options = {}

        if weight_dtype == "fp8_e4m3fn":
            model_options["dtype"] = torch.float8_e4m3fn
        elif weight_dtype == "fp8_e4m3fn_fast":
            model_options["dtype"] = torch.float8_e4m3fn
            model_options["fp8_optimizations"] = True
        elif weight_dtype == "fp8_e5m2":
            model_options["dtype"] = torch.float8_e5m2

        model = comfy.sd.load_diffusion_model(
            model_path,
            model_options=model_options,
        )
        self._base_model_cache = (cache_key, model)
        return model

    @staticmethod
    def _dynamic_secondary_values(kwargs):
        values = []

        for key, value in kwargs.items():
            if not str(key).startswith("secondary_lora_"):
                continue

            if not isinstance(value, dict):
                continue

            values.append(
                (
                    str(key),
                    bool(value.get("on", True)),
                    str(value.get("lora") or NO_LORA),
                    float(value.get("strength", 1.0)),
                )
            )

        def numeric_suffix(item):
            match = re.search(r"(\d+)$", item[0])
            return int(match.group(1)) if match else 0

        values.sort(key=numeric_suffix)
        return values

    def load_core(
        self,
        diffusion_model: str,
        weight_dtype: str,
        folder_name: str,
        main_enabled: bool,
        main_lora: str,
        main_strength: float,
        include_subfolders: bool,
        loop_folder: bool,
        control_after_generate: str,
        skip_none_during_cycle: bool,
        off_name: str,
        auto_clean_name: bool,
        cleanup_rules: str,
        prompt=None,
        extra_pnginfo=None,
        unique_id=None,
        **kwargs,
    ):
        base_model = self._load_base_model(
            str(diffusion_model),
            str(weight_dtype),
        )

        diffusion_model_file = str(diffusion_model)
        diffusion_model_stem = os.path.splitext(
            os.path.basename(
                _normalize_path(diffusion_model_file)
            )
        )[0]

        selected_main = str(main_lora or NO_LORA)
        main_active = bool(
            main_enabled
            and selected_main != NO_LORA
            and float(main_strength) != 0.0
        )

        if main_active:
            main_file = selected_main
            raw_stem = os.path.splitext(
                os.path.basename(
                    _normalize_path(selected_main)
                )
            )[0]
        else:
            main_file = str(off_name).strip() or "no_lora"
            raw_stem = main_file
            _scrub_inactive_selection(
                prompt=prompt,
                extra_pnginfo=extra_pnginfo,
                unique_id=unique_id,
                input_name="main_lora",
                selected=selected_main,
            )

        clean_name = (
            _apply_cleanup_rules(raw_stem, cleanup_rules)
            if auto_clean_name
            else raw_stem
        )
        if not clean_name:
            clean_name = raw_stem

        current_model = base_model
        applied: list[str] = []

        if main_active:
            state, metadata = self._load_lora_state(selected_main)
            current_model = self._apply_model_lora(
                current_model,
                state,
                float(main_strength),
                metadata,
            )
            applied.append(
                f"{selected_main}@{float(main_strength):g}"
            )

        for input_name, enabled, lora_name, strength in (
            self._dynamic_secondary_values(kwargs)
        ):
            active = bool(
                enabled
                and lora_name != NO_LORA
                and strength != 0.0
            )

            if not active:
                continue

            state, metadata = self._load_lora_state(lora_name)
            current_model = self._apply_model_lora(
                current_model,
                state,
                strength,
                metadata,
            )
            applied.append(f"{lora_name}@{strength:g}")

        folder_count = len(
            _folder_loras(
                folder_name,
                bool(include_subfolders),
            )
        )

        extra = _extra_dict(extra_pnginfo)
        if extra is not None:
            extra["so_loader_core_diffusion_model"] = diffusion_model_file
            extra["so_loader_core_weight_dtype"] = str(weight_dtype)
            extra["so_loader_core_applied_loras"] = list(applied)

        return (
            current_model,
            diffusion_model_file,
            diffusion_model_stem,
            main_file,
            raw_stem,
            clean_name,
            "\n".join(applied),
            main_active,
            folder_count,
        )


NODE_CLASS_MAPPINGS = {
    "SOLoaderCoreEngine": LoaderCoreEngine,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SOLoaderCoreEngine": "Loader Core",
}
