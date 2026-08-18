from __future__ import annotations

"""Local persistence API for reusable Studio recipes."""

import uuid
import json
import re
from io import BytesIO
from pathlib import Path
from typing import Any

from PIL import Image

from .solo_catalog import get_catalog

try:
    from aiohttp import web
    from server import PromptServer
except Exception:  # pragma: no cover
    web = None
    PromptServer = None


STUDIO_LOADER = "SOLoaderCoreEngineStudio"
STUDIO_PROMPT = "SOPromptLogEngineStudio"
STUDIO_GENERATION = "SOGenerationPipelineStudio"
STUDIO_OUTPUT = "SOOutputBuilderSaveStudio"
TOKEN_PATTERN = re.compile(r"(?<![A-Za-z0-9_])(NAME|BRAND|ITEM|OUTFIT(?:_[ABC])?|SCENE|TRIGGER)(?![A-Za-z0-9_])")

PROMPT_RECIPE_FIELDS = {
    "prompt_source", "manual_prompt", "prompt_log_file", "prompt_mode", "prompt_index",
    *(name for letter in "ABC" for name in (
        f"outfit_token_{letter}", f"outfit_placement_{letter}", f"outfit_log_file_{letter}",
        f"outfit_mode_{letter}", f"outfit_index_{letter}",
    )),
    "scene_token", "scene_placement", "scene_log_file", "scene_mode", "scene_index",
    "name_token", "name_value", "item_token", "item_value",
    "prefix_enabled", "prefix_text", "suffix_enabled", "suffix_text",
}
GENERATION_RECIPE_FIELDS = {"resolution_mode", "custom_width", "custom_height", "seed_value"}
LOADER_RESOURCE_FIELDS = {
    "diffusion_model", "weight_dtype", "folder_name", "main_enabled", "main_lora", "main_strength",
    *(f"secondary_lora_{index}" for index in range(1, 11)),
}
GENERATION_RESOURCE_FIELDS = {"clip_name", "clip_type", "clip_device", "vae_name"}

STUDIO_WIDGETS = {
    STUDIO_LOADER: {
        "diffusion_model", "weight_dtype", "folder_name", "epoch_filter", "main_enabled", "main_lora",
        "main_strength", "include_subfolders", "loop_folder", "control_after_generate",
        "skip_none_during_cycle", "off_name", "auto_clean_name", "cleanup_rules",
        *(f"secondary_lora_{index}" for index in range(1, 11)),
    },
    STUDIO_PROMPT: {
        "prompt_source", "manual_prompt", "prompt_log_file", "prompt_mode", "prompt_index",
        *(name for letter in "ABC" for name in (
            f"outfit_token_{letter}", f"outfit_placement_{letter}", f"outfit_log_file_{letter}",
            f"outfit_mode_{letter}", f"outfit_index_{letter}",
        )),
        "scene_token", "scene_placement", "scene_log_file", "scene_mode", "scene_index",
        "name_token", "name_value", "item_token", "item_value", "prefix_enabled", "prefix_text",
        "suffix_enabled", "suffix_text", "prefix_suffix_separator", "cleanup_enabled", "cleanup_rules",
        "saved_prompt", "trigger_token", "trigger_placement", "trigger_override",
    },
    STUDIO_GENERATION: {
        "clip_name", "clip_type", "clip_device", "vae_name", "resolution_mode", "custom_width",
        "custom_height", "aspect_preset", "megapixels", "batch_size", "steps", "cfg",
        "sampler_name", "scheduler", "denoise", "shift", "seed_value",
    },
    STUDIO_OUTPUT: {
        "output_root", "subfolder_literal", "subfolder_var_1", "subfolder_var_2", "subfolder_var_3",
        "subfolder_var_4", "subfolder_delimiter", "filename_literal", "filename_var_1",
        "filename_var_2", "filename_var_3", "filename_var_4", "filename_var_5", "filename_var_6",
        "filename_delimiter", "extension", "quality", "counter_digits", "save_prompt_json",
        "save_workflow_json", "save_civitai_parameters",
    },
}


def _preview_directory() -> Path:
    directory = get_catalog().path.parent / "recipe_previews"
    directory.mkdir(parents=True, exist_ok=True)
    return directory


def _recipe_tokens(payload: dict[str, Any]) -> list[str]:
    prompt_texts: list[str] = []
    for node in payload.get("nodes", []):
        if not isinstance(node, dict) or str(node.get("type", "")) != STUDIO_PROMPT:
            continue
        widgets = node.get("widgets")
        if isinstance(widgets, list):
            for widget in widgets:
                if isinstance(widget, dict) and widget.get("name") in {"manual_prompt", "saved_prompt", "prefix_text", "suffix_text"}:
                    prompt_texts.append(str(widget.get("value") or ""))
    text = "\n".join(prompt_texts)
    tokens = set(TOKEN_PATTERN.findall(text))
    if "ITEM" in tokens:
        tokens.add("BRAND")
    if any(token == "OUTFIT" or token.startswith("OUTFIT_") for token in tokens):
        tokens.add("OUTFIT")
    return sorted(tokens)


def _save_preview(image: Image.Image, preview_name: str) -> str:
    preview = image.convert("RGB")
    preview.thumbnail((640, 640), Image.Resampling.LANCZOS)
    filename = f"{preview_name}.webp"
    preview.save(_preview_directory() / filename, "WEBP", quality=84, method=4)
    return filename

PREVIEW_VERIFY_PROMPT_FIELDS = {
    "manual_prompt", "prompt_log_file", "prompt_index",
    *(name for letter in "ABC" for name in (
        f"outfit_token_{letter}", f"outfit_placement_{letter}", f"outfit_log_file_{letter}", f"outfit_index_{letter}",
    )),
    "scene_token", "scene_placement", "scene_log_file", "scene_index",
    "name_token", "name_value", "item_token", "item_value",
    "prefix_enabled", "prefix_text", "suffix_enabled", "suffix_text",
}
PREVIEW_VERIFY_GENERATION_FIELDS = {
    "custom_width", "custom_height", "seed_value", "clip_name", "clip_type", "clip_device", "vae_name",
}
PREVIEW_VERIFY_LOADER_FIELDS = {
    "diffusion_model", "weight_dtype", "main_lora", "main_strength",
    *(f"secondary_lora_{index}" for index in range(1, 11)),
}


def _recipe_verification_values(payload: dict[str, Any]) -> dict[str, Any]:
    curated = _curate_prompt_catalog_recipe(dict(payload or {}))
    values: dict[str, Any] = {}
    prompt = _recipe_node_values(curated, STUDIO_PROMPT)
    generation = _recipe_node_values(curated, STUDIO_GENERATION, include_optional=True)
    loader = _recipe_node_values(curated, STUDIO_LOADER, include_optional=True)
    for name in PREVIEW_VERIFY_PROMPT_FIELDS:
        if name in prompt:
            values[f"prompt.{name}"] = prompt[name]
    for name in PREVIEW_VERIFY_GENERATION_FIELDS:
        if name in generation:
            values[f"generation.{name}"] = generation[name]
    for name in PREVIEW_VERIFY_LOADER_FIELDS:
        if name in loader:
            values[f"loader.{name}"] = loader[name]
    return values


def _preview_recipe_matches(saved_payload: dict[str, Any], image_payload: dict[str, Any]) -> tuple[bool, str]:
    saved = _recipe_verification_values(saved_payload)
    image = _recipe_verification_values(image_payload)
    if not saved:
        return False, "The saved recipe had no prompt, dimensions, or resolved seed fields that could be verified."
    missing = [key for key in saved if key not in image]
    if missing:
        return False, f"The Preview image metadata was missing {missing[0]}."
    for key, value in saved.items():
        if json.dumps(value, sort_keys=True, default=str) != json.dumps(image.get(key), sort_keys=True, default=str):
            return False, f"The Preview image did not match the saved recipe at {key}."
    return True, "Verified against embedded Preview metadata."


def _preview_authoritative_recipe(current_payload: dict[str, Any], image_payload: dict[str, Any]) -> dict[str, Any]:
    """Use the displayed Preview image as the source of truth for a quick-save.

    Prompt/log indices can advance immediately after queueing, so the live node
    widgets may already describe the *next* image. The Preview PNG contains the
    resolved metadata for the image actually on screen and is therefore the
    only safe source for both recipe values and its thumbnail.
    """
    recipe = _curate_prompt_catalog_recipe(dict(image_payload or {}))
    if not recipe.get("nodes"):
        raise ValueError("The Preview image metadata did not contain a usable prompt, dimensions, or resolved seed")
    recipe.pop("imported_from_image", None)
    recipe.pop("migration", None)
    recipe["captured_from_preview"] = True
    if isinstance(current_payload, dict) and current_payload.get("captured_at"):
        recipe["captured_at"] = current_payload["captured_at"]
    recipe["tokens"] = _recipe_tokens(recipe)
    return recipe


def _runtime_structured_metadata(metadata: dict[str, Any]) -> dict[str, Any] | None:
    """Recover resolved runtime metadata from PreviewImage PNGs.

    Output Core adds the consolidated ``so_image_metadata`` block, but Preview
    Core may execute before Output Core. Its temporary PNG still receives the
    resolved Prompt/Generation/Loader fields written into EXTRA_PNGINFO by the
    upstream Studio nodes, so rebuild the same useful structure from those
    fields when the consolidated block is not present yet.
    """
    def runtime_value(key: str, fallback: Any = None) -> Any:
        raw = metadata.get(key, fallback)
        if isinstance(raw, str):
            try:
                return json.loads(raw)
            except (TypeError, ValueError):
                return raw
        return raw

    structured = _json_value(metadata.get("so_image_metadata"), {})
    if isinstance(structured, dict) and structured:
        return structured

    resolved = _json_value(metadata.get("so_prompt_core_resolved"), {})
    if not isinstance(resolved, dict):
        resolved = {}

    generation = _json_value(metadata.get("so_generation_info"), {})
    if not isinstance(generation, dict):
        generation = {}
    for target, source in (
        ("seed_used", "so_generation_seed_used"),
        ("width", "so_generation_width"),
        ("height", "so_generation_height"),
        ("shift", "so_generation_shift"),
        ("clip_name", "so_generation_clip_name"),
        ("vae_name", "so_generation_vae_name"),
    ):
        value = runtime_value(source, None)
        if value not in (None, ""):
            generation.setdefault(target, value)

    models: dict[str, Any] = {}
    diffusion_model = str(runtime_value("so_loader_core_diffusion_model", "") or "")
    weight_dtype = str(runtime_value("so_loader_core_weight_dtype", "") or "")
    if diffusion_model:
        models["diffusion_model"] = diffusion_model
    if weight_dtype:
        models["weight_dtype"] = weight_dtype

    main_active = bool(runtime_value("so_loader_core_main_active", False))
    main_file = str(runtime_value("so_loader_core_main_file", "") or "")
    if main_active and main_file:
        models["main_lora"] = {
            "file": main_file,
            "strength": runtime_value("so_loader_core_main_strength", 1.0),
        }

    secondary = runtime_value("so_loader_core_secondary_loras", [])
    if isinstance(secondary, list):
        cleaned = [dict(item) for item in secondary if isinstance(item, dict) and item.get("file")]
        if cleaned:
            models["secondary_loras"] = cleaned

    if not resolved and not generation and not models:
        return None
    return {
        "schema_version": 1,
        "format": "Sick Ollie Preview Runtime Metadata",
        "resolved": resolved,
        "generation": generation,
        "models": models,
    }


def _recipe_from_image_bytes(raw: bytes) -> tuple[dict[str, Any], Image.Image]:
    with Image.open(BytesIO(raw)) as image:
        metadata = dict(image.info)
        image_size = image.size
        preview_image = image.copy()
    api_graph = _json_value(metadata.get("prompt"), {})
    workflow = _json_value(metadata.get("workflow"), {})
    parameters = str(metadata.get("parameters") or "")
    structured = _runtime_structured_metadata(metadata)

    payload: dict[str, Any]
    if isinstance(api_graph, dict) and api_graph:
        payload = _api_to_studio_recipe(api_graph, parameters)
    elif parameters:
        payload = _api_to_studio_recipe({}, parameters)
    elif isinstance(workflow, dict) and workflow:
        payload = _legacy_to_studio_recipe(workflow)
    elif structured:
        payload = {"schema": 3, "imported_from_image": True, "nodes": []}
    else:
        raise ValueError("This image contains no embedded ComfyUI, A1111/Civitai, or Sick Ollie generation metadata.")

    payload = _structured_metadata_overlay(payload, structured)
    if not payload.get("nodes"):
        raise ValueError("The embedded metadata did not contain prompt, generation, model, LoRA, VAE, or output settings that can be migrated")
    payload = _apply_resolved_dimensions(payload, structured, image_size)
    payload = _curate_prompt_catalog_recipe(payload)
    if not payload.get("nodes"):
        raise ValueError("The embedded metadata did not contain a usable prompt, resolved dimensions, or resolved seed")
    payload["metadata_sources"] = [key for key in (
        "so_image_metadata", "so_prompt_core_resolved", "so_generation_info",
        "so_generation_seed_used", "so_loader_core_main_file", "prompt", "workflow", "parameters",
    ) if metadata.get(key) not in (None, "", [], {})]
    payload["tokens"] = _recipe_tokens(payload)
    return payload, preview_image


def _workflow_node_values(node: dict[str, Any]) -> dict[str, Any]:
    """Normalize Comfy workflow and API-prompt nodes into named values."""
    values = node.get("inputs")
    if isinstance(values, dict):
        return values
    widgets = list(node.get("widgets_values") or [])
    node_type = str(node.get("type") or node.get("class_type") or "")
    positional = {
        "CLIPTextEncode": ("text",),
        "KSampler": ("seed", "steps", "cfg", "sampler_name", "scheduler", "denoise"),
        "KSamplerAdvanced": ("add_noise", "noise_seed", "control_after_generate", "steps", "cfg", "sampler_name", "scheduler", "start_at_step", "end_at_step", "return_with_leftover_noise"),
        "EmptyLatentImage": ("width", "height", "batch_size"),
        "UNETLoader": ("unet_name", "weight_dtype"),
        "CheckpointLoaderSimple": ("ckpt_name",),
        "LoraLoader": ("lora_name", "strength_model", "strength_clip"),
        "VAELoader": ("vae_name",),
        "SaveImage": ("filename_prefix",),
        # Sick Ollie Classic — these are deliberately named here rather than
        # inferred from generic widgets, so classic output becomes a first-class
        # Studio migration path.
        "SOPromptLogEngine": (
            "prompt_source", "manual_prompt", "prompt_log_file", "prompt_mode", "prompt_index",
            "outfit_token_A", "outfit_log_file_A", "outfit_mode_A", "outfit_index_A",
            "outfit_token_B", "outfit_log_file_B", "outfit_mode_B", "outfit_index_B",
            "outfit_token_C", "outfit_log_file_C", "outfit_mode_C", "outfit_index_C",
            "scene_token", "scene_log_file", "scene_mode", "scene_index", "name_token", "name_value",
            "item_token", "item_value", "prefix_enabled", "prefix_text", "suffix_enabled", "suffix_text",
        ),
        "SOGenerationPipeline": (
            "clip_name", "clip_type", "clip_device", "vae_name", "resolution_mode", "custom_width",
            "custom_height", "aspect_preset", "megapixels", "batch_size", "steps", "cfg", "sampler_name",
            "scheduler", "denoise", "shift", "seed_value",
        ),
        "SOLoaderCoreEngine": (
            "diffusion_model", "weight_dtype", "folder_name", "epoch_filter", "main_enabled", "main_lora",
            "main_strength", "include_subfolders", "loop_folder", "control_after_generate",
        ),
        "SOOutputBuilderSave": (
            "output_root", "subfolder_literal", "subfolder_var_1", "subfolder_var_2", "subfolder_var_3",
            "subfolder_var_4", "subfolder_delimiter", "filename_literal", "filename_var_1", "filename_var_2",
            "filename_var_3", "filename_var_4", "filename_var_5", "filename_var_6", "filename_delimiter",
            "extension", "quality", "counter_digits", "save_prompt_json", "save_workflow_json", "save_civitai_parameters",
        ),
    }.get(node_type, ())
    return {key: widgets[index] for index, key in enumerate(positional) if index < len(widgets)}


def _scalar(value: Any) -> Any:
    """Drop Comfy links; only literal values are safe to migrate into widgets."""
    return value if not isinstance(value, (list, dict)) else None


def _json_value(value: Any, fallback: Any = None) -> Any:
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (TypeError, ValueError):
            return fallback
    return value if value is not None else fallback


def _api_nodes(graph: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(key): value for key, value in graph.items() if isinstance(value, dict) and value.get("class_type")}


def _resolve_api_value(value: Any, nodes: dict[str, dict[str, Any]], seen: set[str] | None = None) -> Any:
    if not (isinstance(value, list) and len(value) >= 2):
        return value
    node_id = str(value[0])
    seen = set(seen or ())
    if node_id in seen or node_id not in nodes:
        return None
    seen.add(node_id)
    node = nodes[node_id]
    kind = str(node.get("class_type") or "")
    inputs = node.get("inputs") or {}
    resolve = lambda item: _resolve_api_value(item, nodes, seen)
    if kind in {"PrimitiveString", "PrimitiveStringMultiline", "Text Prompt (JPS)"}:
        return resolve(inputs.get("value", inputs.get("text", "")))
    if kind in {"PrimitiveBoolean"}:
        return bool(resolve(inputs.get("value")))
    if kind in {"Seed (rgthree)", "Seed"}:
        return resolve(inputs.get("seed", inputs.get("value")))
    if kind in {"StringConcatenate", "Text Concatenate"}:
        delimiter = str(resolve(inputs.get("delimiter")) or "")
        keys = ("string_a", "string_b") if kind == "StringConcatenate" else ("text_a", "text_b", "text_c")
        return delimiter.join(str(resolve(inputs.get(key)) or "") for key in keys)
    if kind == "ComfySwitchNode":
        switch = bool(resolve(inputs.get("switch")))
        return resolve(inputs.get("on_true" if switch else "on_false"))
    if kind in {"PreviewAny", "Display Any (rgthree)"}:
        return resolve(inputs.get("source", inputs.get("output")))
    if kind == "RegexReplace":
        source = str(resolve(inputs.get("string")) or "")
        pattern = str(resolve(inputs.get("regex_pattern")) or "")
        replacement = str(resolve(inputs.get("replace")) or "")
        try:
            flags = re.IGNORECASE if bool(resolve(inputs.get("case_insensitive"))) else 0
            return re.sub(pattern, replacement, source, count=int(resolve(inputs.get("count")) or 0), flags=flags)
        except (re.error, ValueError):
            return source
    for key in ("value", "text", "source", "output"):
        if key in inputs:
            return resolve(inputs[key])
    return None


def _named_node(node_type: str, title: str, values: dict[str, Any]) -> dict[str, Any]:
    return {"type": node_type, "title": title, "widgets": [{"name": key, "value": value} for key, value in values.items() if value is not None]}


def _merge_recipe_nodes(payload: dict[str, Any], node_type: str, title: str, values: dict[str, Any]) -> None:
    target = next((node for node in payload.setdefault("nodes", []) if node.get("type") == node_type), None)
    if target is None:
        payload["nodes"].append(_named_node(node_type, title, values))
        return
    widgets = target.setdefault("widgets", [])
    by_name = {str(widget.get("name")): widget for widget in widgets if isinstance(widget, dict)}
    for name, value in values.items():
        if value is None:
            continue
        if name in by_name:
            by_name[name]["value"] = value
        else:
            widgets.append({"name": name, "value": value})


def _remove_recipe_widget_names(payload: dict[str, Any], node_type: str, names: set[str]) -> None:
    for node in payload.get("nodes", []):
        if isinstance(node, dict) and str(node.get("type") or "") == node_type:
            node["widgets"] = [widget for widget in node.get("widgets", []) if not isinstance(widget, dict) or str(widget.get("name") or "") not in names]


def _recipe_node_values(payload: dict[str, Any], node_type: str, *, include_optional: bool = False) -> dict[str, Any]:
    values: dict[str, Any] = {}
    source_nodes = list(payload.get("nodes", []))
    if include_optional:
        source_nodes.extend(payload.get("optional_nodes", []))
    for node in source_nodes:
        if not isinstance(node, dict) or str(node.get("type") or "") != node_type:
            continue
        for widget in node.get("widgets", []):
            if isinstance(widget, dict) and widget.get("name"):
                values[str(widget["name"])] = widget.get("value")
    return values


def _present_lora_value(value: Any) -> bool:
    if isinstance(value, dict):
        return bool(value.get("on") is not False and value.get("lora") and str(value.get("lora")).lower() not in {"none", "[none]", "no_lora"})
    return bool(value and str(value).lower() not in {"none", "[none]", "no_lora"})


def _curate_prompt_catalog_recipe(payload: dict[str, Any]) -> dict[str, Any]:
    """Reduce a broad metadata conversion to the prompt-first Studio contract."""
    prompt_source = _recipe_node_values(payload, STUDIO_PROMPT)
    generation_source = _recipe_node_values(payload, STUDIO_GENERATION, include_optional=True)
    loader_source = _recipe_node_values(payload, STUDIO_LOADER, include_optional=True)

    prompt = {name: prompt_source[name] for name in PROMPT_RECIPE_FIELDS if name in prompt_source}
    used_prompt = str(prompt.get("manual_prompt") or "").strip()
    if used_prompt:
        prompt["prompt_source"] = "manual"
    else:
        prompt.pop("manual_prompt", None)
        prompt.pop("prompt_source", None)

    if prompt.get("prompt_log_file") not in (None, "", "[None]"):
        prompt["prompt_mode"] = "fixed"
    else:
        for name in ("prompt_log_file", "prompt_mode", "prompt_index"):
            prompt.pop(name, None)

    for letter in "ABC":
        file_key = f"outfit_log_file_{letter}"
        mode_key = f"outfit_mode_{letter}"
        index_key = f"outfit_index_{letter}"
        if prompt.get(file_key) not in (None, "", "[None]"):
            prompt[mode_key] = "fixed"
        else:
            for name in (file_key, mode_key, index_key, f"outfit_token_{letter}", f"outfit_placement_{letter}"):
                prompt.pop(name, None)
    if prompt.get("scene_log_file") not in (None, "", "[None]"):
        prompt["scene_mode"] = "fixed"
    else:
        for name in ("scene_log_file", "scene_mode", "scene_index", "scene_token", "scene_placement"):
            prompt.pop(name, None)

    for enabled, text in (("prefix_enabled", "prefix_text"), ("suffix_enabled", "suffix_text")):
        if not prompt.get(enabled) or not str(prompt.get(text) or "").strip():
            prompt.pop(enabled, None)
            prompt.pop(text, None)

    generation: dict[str, Any] = {}
    width = generation_source.get("custom_width")
    height = generation_source.get("custom_height")
    if isinstance(width, (int, float)) and isinstance(height, (int, float)) and width > 0 and height > 0:
        generation.update({"resolution_mode": "custom", "custom_width": int(width), "custom_height": int(height)})
    seed = generation_source.get("seed_value")
    try:
        seed_number = int(seed)
    except (TypeError, ValueError):
        seed_number = -1
    if seed_number >= 0:
        generation["seed_value"] = seed_number

    optional_nodes: list[dict[str, Any]] = []
    loader_resources = {
        name: value for name, value in loader_source.items()
        if name in LOADER_RESOURCE_FIELDS
        and (not name.startswith("secondary_lora_") or _present_lora_value(value))
        and value not in (None, "", "[None]", "None", "no_lora")
    }
    if not _present_lora_value(loader_resources.get("main_lora")):
        for name in ("main_lora", "main_enabled", "main_strength", "folder_name"):
            loader_resources.pop(name, None)
    if loader_resources:
        optional_nodes.append(_named_node(STUDIO_LOADER, "Optional model & LoRA resources", loader_resources))
    generation_resources = {name: generation_source[name] for name in GENERATION_RESOURCE_FIELDS if generation_source.get(name) not in (None, "", "[None]")}
    if generation_resources:
        optional_nodes.append(_named_node(STUDIO_GENERATION, "Optional encoder & VAE resources", generation_resources))

    nodes: list[dict[str, Any]] = []
    if prompt:
        nodes.append(_named_node(STUDIO_PROMPT, "Prompt used", prompt))
    if generation:
        nodes.append(_named_node(STUDIO_GENERATION, "Dimensions & resolved seed", generation))
    payload["nodes"] = nodes
    payload["optional_nodes"] = optional_nodes
    payload["schema"] = 4
    payload["catalog_focus"] = "prompt"
    return payload


def _apply_resolved_dimensions(payload: dict[str, Any], structured_raw: Any, image_size: tuple[int, int]) -> dict[str, Any]:
    structured_value = _json_value(structured_raw, {})
    structured_generation = structured_value.get("generation") if isinstance(structured_value, dict) and isinstance(structured_value.get("generation"), dict) else {}
    has_runtime_size = bool(structured_generation.get("width") and structured_generation.get("height"))
    generation_node = next((node for node in payload.get("nodes", []) if node.get("type") == STUDIO_GENERATION), None)
    generation_names = {str(item.get("name")) for item in (generation_node or {}).get("widgets", []) if isinstance(item, dict)}
    dimensions: dict[str, Any] = {}
    if not has_runtime_size or "custom_width" not in generation_names:
        dimensions["custom_width"] = int(image_size[0])
    if not has_runtime_size or "custom_height" not in generation_names:
        dimensions["custom_height"] = int(image_size[1])
    if dimensions:
        dimensions["resolution_mode"] = "custom"
        _merge_recipe_nodes(payload, STUDIO_GENERATION, "Imported image dimensions", dimensions)
    return payload


def _parse_parameters(text: str) -> dict[str, Any]:
    source = str(text or "")
    values: dict[str, Any] = {}
    for key, output in (("Steps", "steps"), ("Sampler", "sampler_name"), ("CFG scale", "cfg"), ("Seed", "seed_value"), ("Model", "diffusion_model"), ("VAE", "vae_name")):
        match = re.search(rf"(?:^|,\s|\n){re.escape(key)}:\s*([^,\n]+)", source)
        if match:
            raw = match.group(1).strip()
            if output in {"steps", "seed_value"}:
                try: raw = int(raw)
                except ValueError: pass
            elif output == "cfg":
                try: raw = float(raw)
                except ValueError: pass
            values[output] = raw
    size = re.search(r"(?:^|,\s|\n)Size:\s*(\d+)x(\d+)", source)
    if size:
        values.update({"custom_width": int(size.group(1)), "custom_height": int(size.group(2)), "resolution_mode": "custom"})
    prompt_end = re.search(r"\nNegative prompt:|\nSteps:\s*", source)
    if prompt_end:
        values["prompt"] = re.sub(r"\s*<lora:[^:>]+:[^>]+>\s*", " ", source[:prompt_end.start()], flags=re.IGNORECASE).strip()
    lora_hashes = {name.strip().lower(): hash_value.lower() for name, hash_value in re.findall(r'([\w .-]+):\s*([0-9a-fA-F]{10,64})', str(re.search(r'Lora hashes:\s*"?([^\n]+)', source).group(1) if re.search(r'Lora hashes:\s*"?([^\n]+)', source) else ""))}
    loras = []
    for name, strength in re.findall(r"<lora:([^:>]+):([^>]+)>", source, re.IGNORECASE):
        try: strength_value: Any = float(strength)
        except ValueError: strength_value = strength
        loras.append({"name": name, "strength": strength_value, "hash": lora_hashes.get(name.lower(), "")})
    values["loras"] = loras
    return values


def _literal_widget(value: Any) -> Any:
    """Keep JSON widget values while excluding Comfy graph links."""
    if isinstance(value, list) and len(value) >= 2 and isinstance(value[0], (str, int)) and isinstance(value[1], int):
        return None
    return value


def _extract_loras(api_nodes: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    for node in api_nodes.values():
        kind = str(node.get("class_type") or "")
        inputs = node.get("inputs") or {}
        if kind in {"LoraLoader", "LoraLoaderModelOnly"}:
            name = _literal_widget(inputs.get("lora_name"))
            if name:
                found.append({"name": str(name), "file": str(name), "strength": _literal_widget(inputs.get("strength_model", 1.0))})
        elif "Power Lora Loader" in kind:
            for value in inputs.values():
                if isinstance(value, dict) and value.get("on") and value.get("lora"):
                    found.append({"name": Path(str(value["lora"])).stem, "file": str(value["lora"]), "strength": value.get("strength", 1.0)})
    unique: dict[str, dict[str, Any]] = {}
    for item in found:
        unique[str(item.get("file") or item.get("name")).replace("/", "\\").lower()] = item
    return list(unique.values())


def _best_generic_prompt(api_nodes: dict[str, dict[str, Any]]) -> str:
    positive: list[str] = []
    primitives: list[str] = []
    for node in api_nodes.values():
        kind = str(node.get("class_type") or "")
        inputs = node.get("inputs") or {}
        if kind == "CLIPTextEncode":
            value = _resolve_api_value(inputs.get("text"), api_nodes)
            if isinstance(value, str) and value.strip():
                positive.append(value.strip())
        elif kind in {"PrimitiveString", "PrimitiveStringMultiline"}:
            value = _resolve_api_value(inputs.get("value"), api_nodes)
            if isinstance(value, str) and len(value.strip()) >= 12:
                primitives.append(value.strip())
    if positive:
        return max(positive, key=len)
    useful = [value for value in primitives if "expert prompt engineer" not in value.lower() and "follow these rules" not in value.lower()]
    return min(useful, key=len) if useful else ""


def _api_to_studio_recipe(api_graph: dict[str, Any], parameters: str = "") -> dict[str, Any]:
    """Convert named API-prompt inputs, including expanded subgraphs, into Studio sections."""
    api_nodes = _api_nodes(api_graph)
    payload: dict[str, Any] = {
        "schema": 3,
        "imported_from_image": True,
        "migration": {"mode": "metadata_merge", "notes": [], "loras": [], "source_node_count": len(api_nodes)},
        "nodes": [],
    }

    # Current Studio API prompts already contain named inputs. Curating these
    # avoids stale connected display widgets from Output Core entering recipes.
    for node in api_nodes.values():
        node_type = str(node.get("class_type") or "")
        if node_type not in STUDIO_WIDGETS:
            continue
        inputs = node.get("inputs") or {}
        values = {name: _literal_widget(inputs.get(name)) for name in STUDIO_WIDGETS[node_type] if name in inputs}
        _merge_recipe_nodes(payload, node_type, str((node.get("_meta") or {}).get("title") or node_type), values)

    parsed = _parse_parameters(parameters)
    prompt = str(parsed.get("prompt") or _best_generic_prompt(api_nodes) or "").strip()
    if prompt:
        _merge_recipe_nodes(payload, STUDIO_PROMPT, "Imported prompt", {"prompt_source": "manual", "manual_prompt": prompt})

    generation: dict[str, Any] = {key: parsed.get(key) for key in (
        "steps", "cfg", "sampler_name", "seed_value", "custom_width", "custom_height", "resolution_mode", "vae_name"
    ) if parsed.get(key) is not None}
    for node in api_nodes.values():
        kind = str(node.get("class_type") or "")
        inputs = node.get("inputs") or {}
        if kind in {"KSampler", "KSamplerAdvanced"}:
            for target, source in (("seed_value", "seed"), ("seed_value", "noise_seed"), ("steps", "steps"), ("cfg", "cfg"), ("sampler_name", "sampler_name"), ("scheduler", "scheduler"), ("denoise", "denoise")):
                value = _resolve_api_value(inputs.get(source), api_nodes)
                if value is not None:
                    generation[target] = value
        elif kind in {"EmptyLatentImage", "EmptySD3LatentImage"}:
            for target, source in (("custom_width", "width"), ("custom_height", "height"), ("batch_size", "batch_size")):
                value = _resolve_api_value(inputs.get(source), api_nodes)
                if value is not None:
                    generation[target] = value
            generation["resolution_mode"] = "custom"
        elif kind == "CLIPLoader" and _literal_widget(inputs.get("clip_name")):
            generation.update({"clip_name": inputs.get("clip_name"), "clip_type": inputs.get("type"), "clip_device": inputs.get("device")})
        elif kind == "VAELoader" and _literal_widget(inputs.get("vae_name")):
            generation["vae_name"] = inputs.get("vae_name")
    if generation:
        _merge_recipe_nodes(payload, STUDIO_GENERATION, "Imported generation", generation)

    loader: dict[str, Any] = {}
    for node in api_nodes.values():
        kind = str(node.get("class_type") or "")
        inputs = node.get("inputs") or {}
        if kind == "UNETLoader" and _literal_widget(inputs.get("unet_name")):
            loader.update({"diffusion_model": inputs.get("unet_name"), "weight_dtype": inputs.get("weight_dtype", "default")})
        elif kind == "CheckpointLoaderSimple" and _literal_widget(inputs.get("ckpt_name")):
            loader["diffusion_model"] = inputs.get("ckpt_name")
    if parsed.get("diffusion_model") and not loader.get("diffusion_model"):
        loader["diffusion_model"] = parsed["diffusion_model"]
    loras = _extract_loras(api_nodes) or list(parsed.get("loras") or [])
    parameter_loras = {str(item.get("name", "")).lower(): item for item in parsed.get("loras") or []}
    for item in loras:
        key = Path(str(item.get("file") or item.get("name") or "").replace("\\", "/")).stem.lower()
        if key in parameter_loras and parameter_loras[key].get("hash"):
            item["hash"] = parameter_loras[key]["hash"]
    if loras:
        first = loras[0]
        file_name = str(first.get("file") or first.get("name") or "")
        loader.update({
            "main_enabled": True,
            "main_lora": file_name,
            "folder_name": str(Path(file_name.replace("\\", "/")).parent).replace(".", "[LoRA Root]"),
            "main_strength": first.get("strength", 1.0),
        })
        payload["migration"]["loras"] = loras
    if loader:
        _merge_recipe_nodes(payload, STUDIO_LOADER, "Imported Loader", loader)

    if not payload["nodes"]:
        raise ValueError("The image has no embedded generation metadata that can be converted into a Studio recipe")
    return payload


def _structured_metadata_overlay(payload: dict[str, Any], structured_raw: Any) -> dict[str, Any]:
    structured = _json_value(structured_raw, {})
    if not isinstance(structured, dict):
        return payload
    resolved = structured.get("resolved") if isinstance(structured.get("resolved"), dict) else {}
    generation = structured.get("generation") if isinstance(structured.get("generation"), dict) else {}
    models = structured.get("models") if isinstance(structured.get("models"), dict) else {}

    prompt_values: dict[str, Any] = {}
    source_prompt = str(resolved.get("source_prompt") or (resolved.get("prompt") or {}).get("line") or "")
    if source_prompt:
        prompt_values.update({"prompt_source": "manual", "manual_prompt": source_prompt})
    prompt_meta = resolved.get("prompt") if isinstance(resolved.get("prompt"), dict) else {}
    if prompt_meta.get("file"):
        prompt_values.update({"prompt_log_file": prompt_meta["file"], "prompt_mode": "fixed"})
    if prompt_meta.get("index") is not None:
        prompt_values["prompt_index"] = prompt_meta["index"]
    placeholder_values: list[dict[str, Any]] = []
    for key, token_name, value_name in (("name", "name_token", "name_value"), ("item", "item_token", "item_value")):
        item = resolved.get(key) if isinstance(resolved.get(key), dict) else {}
        if item.get("token"):
            prompt_values[token_name] = item["token"]
        if item.get("value") not in (None, ""):
            prompt_values[value_name] = item["value"]
            placeholder_values.append({"token": item.get("token", key.upper()), "value": item["value"], "widget": value_name})
    for key, letter in (("outfit_a", "A"), ("outfit_b", "B"), ("outfit_c", "C")):
        item = resolved.get(key) if isinstance(resolved.get(key), dict) else {}
        if not item.get("used"):
            _remove_recipe_widget_names(payload, STUDIO_PROMPT, {
                f"outfit_token_{letter}", f"outfit_placement_{letter}", f"outfit_log_file_{letter}",
                f"outfit_mode_{letter}", f"outfit_index_{letter}",
            })
            continue
        if item.get("token"):
            prompt_values[f"outfit_token_{letter}"] = item["token"]
        if item.get("placement"):
            prompt_values[f"outfit_placement_{letter}"] = item["placement"]
        if item.get("file"):
            prompt_values[f"outfit_log_file_{letter}"] = item["file"]
            prompt_values[f"outfit_mode_{letter}"] = "fixed"
        if item.get("index") is not None:
            prompt_values[f"outfit_index_{letter}"] = item["index"]
        if item.get("line"):
            placeholder_values.append({"token": item.get("token", f"OUTFIT_{letter}"), "value": item["line"], "widget": f"outfit_log_file_{letter}", "source": item.get("file", "")})
    scene = resolved.get("scene") if isinstance(resolved.get("scene"), dict) else {}
    if scene.get("used"):
        if scene.get("token"):
            prompt_values["scene_token"] = scene["token"]
        if scene.get("placement"):
            prompt_values["scene_placement"] = scene["placement"]
        if scene.get("file"):
            prompt_values.update({"scene_log_file": scene["file"], "scene_mode": "fixed"})
        if scene.get("index") is not None:
            prompt_values["scene_index"] = scene["index"]
        if scene.get("line"):
            placeholder_values.append({"token": scene.get("token", "SCENE"), "value": scene["line"], "widget": "scene_log_file", "source": scene.get("file", "")})
    else:
        _remove_recipe_widget_names(payload, STUDIO_PROMPT, {"scene_token", "scene_placement", "scene_log_file", "scene_mode", "scene_index"})
    for key in ("prefix", "suffix"):
        item = resolved.get(key) if isinstance(resolved.get(key), dict) else {}
        text = str(item.get("text") or "").strip()
        if item.get("enabled") and text:
            prompt_values[f"{key}_enabled"] = True
            prompt_values[f"{key}_text"] = text
    if prompt_values:
        _merge_recipe_nodes(payload, STUDIO_PROMPT, "Reusable source prompt", prompt_values)

    generation_values = {
        target: generation.get(source)
        for target, source in (
            ("seed_value", "seed_used"), ("steps", "steps"), ("cfg", "cfg"),
            ("sampler_name", "sampler_name"), ("scheduler", "scheduler"), ("denoise", "denoise"),
            ("shift", "shift"), ("custom_width", "width"), ("custom_height", "height"),
            ("batch_size", "batch_size"), ("clip_name", "clip_name"), ("vae_name", "vae_name"),
        ) if generation.get(source) is not None
    }
    if generation_values.get("custom_width") and generation_values.get("custom_height"):
        generation_values["resolution_mode"] = "custom"
    if generation_values:
        _merge_recipe_nodes(payload, STUDIO_GENERATION, "Resolved generation", generation_values)

    loader_values: dict[str, Any] = {}
    if models.get("diffusion_model"):
        loader_values["diffusion_model"] = models["diffusion_model"]
    if models.get("weight_dtype"):
        loader_values["weight_dtype"] = models["weight_dtype"]
    main_lora = models.get("main_lora") if isinstance(models.get("main_lora"), dict) else {}
    if main_lora.get("file"):
        file_name = str(main_lora["file"])
        loader_values.update({
            "folder_name": str(Path(file_name.replace("\\", "/")).parent).replace(".", "[LoRA Root]"),
            "main_lora": file_name,
            "main_enabled": True,
            "main_strength": main_lora.get("strength", 1.0),
        })
    secondary_loras = models.get("secondary_loras") if isinstance(models.get("secondary_loras"), list) else []
    for index, item in enumerate((entry for entry in secondary_loras if isinstance(entry, dict) and entry.get("file")), start=1):
        if index > 10:
            break
        loader_values[f"secondary_lora_{index}"] = {
            "on": True,
            "lora": str(item.get("file") or ""),
            "strength": item.get("strength", 1.0),
        }
    if loader_values:
        _merge_recipe_nodes(payload, STUDIO_LOADER, "Resolved Loader", loader_values)

    payload["summary"] = {
        "prompt_template": source_prompt,
        "resolved_prompt": str(resolved.get("final_prompt") or ""),
        "placeholders": placeholder_values,
        "generation": generation,
        "models": models,
    }
    payload["structured_metadata"] = True
    return payload


def _legacy_to_studio_recipe(workflow: dict[str, Any]) -> dict[str, Any]:
    """Best-effort, deliberately conservative migration from common Comfy nodes.

    It preserves every detected legacy source in the recipe record while only
    applying literal settings that have an unambiguous Studio destination.
    """
    source_nodes = list(workflow.get("nodes") or [])
    if not source_nodes and isinstance(workflow, dict):
        source_nodes = [dict(value, class_type=value.get("class_type", key)) for key, value in workflow.items() if isinstance(value, dict) and value.get("class_type")]
    found: dict[str, Any] = {}
    loras: list[dict[str, Any]] = []
    notes: list[str] = []
    for raw in source_nodes:
        if not isinstance(raw, dict):
            continue
        kind = str(raw.get("type") or raw.get("class_type") or "")
        values = _workflow_node_values(raw)
        if kind in {"SOPromptLogEngine", "SOPromptLogEngineStudio"}:
            prompt = _scalar(values.get("manual_prompt"))
            if prompt:
                found["prompt"] = str(prompt)
            found["prompt_source"] = str(_scalar(values.get("prompt_source")) or "manual")
            for key in ("prompt_log_file", "prompt_mode", "prompt_index", "outfit_token_A", "outfit_log_file_A", "outfit_mode_A", "outfit_index_A", "outfit_token_B", "outfit_log_file_B", "outfit_mode_B", "outfit_index_B", "outfit_token_C", "outfit_log_file_C", "outfit_mode_C", "outfit_index_C", "scene_token", "scene_log_file", "scene_mode", "scene_index", "name_token", "name_value", "item_token", "item_value", "prefix_enabled", "prefix_text", "suffix_enabled", "suffix_text"):
                literal = _scalar(values.get(key))
                if literal is not None:
                    found[key] = literal
        elif kind == "CLIPTextEncode" and _scalar(values.get("text")):
            found.setdefault("prompt", str(values["text"]))
        elif kind == "SOGenerationPipeline":
            for key in ("clip_name", "clip_type", "clip_device", "vae_name", "resolution_mode", "custom_width", "custom_height", "aspect_preset", "megapixels", "batch_size", "steps", "cfg", "sampler_name", "scheduler", "denoise", "shift", "seed_value"):
                literal = _scalar(values.get(key))
                if literal is not None:
                    found[key] = literal
        elif kind in {"KSampler", "KSamplerAdvanced"}:
            seed = values.get("seed", values.get("noise_seed"))
            for key, source in (("seed_value", seed), ("steps", values.get("steps")), ("cfg", values.get("cfg")), ("sampler_name", values.get("sampler_name")), ("scheduler", values.get("scheduler")), ("denoise", values.get("denoise"))):
                literal = _scalar(source)
                if literal is not None:
                    found[key] = literal
        elif kind == "EmptyLatentImage":
            for key in ("width", "height", "batch_size"):
                literal = _scalar(values.get(key))
                if literal is not None:
                    found[{"width": "custom_width", "height": "custom_height", "batch_size": "batch_size"}[key]] = literal
        elif kind == "VAELoader" and _scalar(values.get("vae_name")):
            found["vae_name"] = values["vae_name"]
        elif kind == "SOLoaderCoreEngine":
            model = _scalar(values.get("diffusion_model"))
            if model:
                found["model_candidate"] = str(model)
            main_lora = _scalar(values.get("main_lora"))
            if main_lora and str(main_lora).lower() not in {"no_lora", "[none]"}:
                loras.append({"name": str(main_lora), "strength": _scalar(values.get("main_strength")), "folder": _scalar(values.get("folder_name"))})
        elif kind in {"UNETLoader", "CheckpointLoaderSimple"}:
            model = _scalar(values.get("unet_name", values.get("ckpt_name")))
            if model:
                found["model_candidate"] = str(model)
                notes.append("Model kept as a candidate for review; checkpoint and diffusion-model folders are not interchangeable.")
        elif kind == "LoraLoader":
            name = _scalar(values.get("lora_name"))
            if name:
                loras.append({"name": str(name), "strength": _scalar(values.get("strength_model"))})
        elif kind == "SOOutputBuilderSave":
            for key in ("output_root", "subfolder_literal", "subfolder_var_1", "subfolder_var_2", "subfolder_var_3", "subfolder_var_4", "subfolder_delimiter", "filename_literal", "filename_var_1", "filename_var_2", "filename_var_3", "filename_var_4", "filename_var_5", "filename_var_6", "filename_delimiter", "extension", "quality", "counter_digits", "save_prompt_json", "save_workflow_json", "save_civitai_parameters"):
                literal = _scalar(values.get(key))
                if literal is not None:
                    found[key] = literal
        elif kind == "SaveImage" and _scalar(values.get("filename_prefix")):
            found["filename_prefix"] = str(values["filename_prefix"])

    nodes: list[dict[str, Any]] = []
    if found.get("model_candidate"):
        nodes.append({"type": STUDIO_LOADER, "title": "Migrated Loader candidate", "widgets": [{"name": "diffusion_model", "value": found["model_candidate"]}]})
    if found.get("prompt"):
        prompt_keys = ("prompt_source", "manual_prompt", "prompt_log_file", "prompt_mode", "prompt_index", "outfit_token_A", "outfit_log_file_A", "outfit_mode_A", "outfit_index_A", "outfit_token_B", "outfit_log_file_B", "outfit_mode_B", "outfit_index_B", "outfit_token_C", "outfit_log_file_C", "outfit_mode_C", "outfit_index_C", "scene_token", "scene_log_file", "scene_mode", "scene_index", "name_token", "name_value", "item_token", "item_value", "prefix_enabled", "prefix_text", "suffix_enabled", "suffix_text")
        prompt = [{"name": key, "value": found["prompt"] if key == "manual_prompt" else found[key]} for key in prompt_keys if key == "manual_prompt" or key in found]
        if not any(item["name"] == "prompt_source" for item in prompt): prompt.insert(0, {"name": "prompt_source", "value": "manual"})
        nodes.append({"type": STUDIO_PROMPT, "title": "Migrated prompt", "widgets": prompt})
    generation_keys = ("clip_name", "clip_type", "clip_device", "vae_name", "resolution_mode", "custom_width", "custom_height", "aspect_preset", "megapixels", "batch_size", "steps", "cfg", "sampler_name", "scheduler", "denoise", "shift", "seed_value")
    generation = [{"name": key, "value": found[key]} for key in generation_keys if key in found]
    if generation:
        if not any(item["name"] == "resolution_mode" for item in generation): generation.insert(0, {"name": "resolution_mode", "value": "custom"})
        nodes.append({"type": STUDIO_GENERATION, "title": "Migrated generation", "widgets": generation})
    output_keys = ("output_root", "subfolder_literal", "subfolder_var_1", "subfolder_var_2", "subfolder_var_3", "subfolder_var_4", "subfolder_delimiter", "filename_literal", "filename_var_1", "filename_var_2", "filename_var_3", "filename_var_4", "filename_var_5", "filename_var_6", "filename_delimiter", "extension", "quality", "counter_digits", "save_prompt_json", "save_workflow_json", "save_civitai_parameters")
    output = [{"name": key, "value": found[key]} for key in output_keys if key in found]
    if found.get("filename_prefix") and not output: output = [{"name": "filename_literal", "value": found["filename_prefix"]}]
    if output: nodes.append({"type": STUDIO_OUTPUT, "title": "Migrated output", "widgets": output})
    if loras:
        notes.append(f"{len(loras)} legacy LoRA(s) recorded for review. Choose their Studio folder scope before applying them.")
    if not nodes:
        raise ValueError("The embedded workflow did not contain common prompt, sampler, latent, model, LoRA, VAE, or output settings to migrate")
    return {"schema": 2, "imported_from_image": True, "migration": {"mode": "best_effort_legacy", "loras": loras, "notes": notes, "source_node_count": len(source_nodes)}, "nodes": nodes}


if PromptServer is not None and web is not None:

    @PromptServer.instance.routes.get("/sickollie/recipe-catalog/recipes")
    async def solo_recipe_list(request):
        recipes = get_catalog().recipes()
        for recipe in recipes:
            payload = recipe.get("payload")
            if isinstance(payload, dict):
                recipe["payload"] = _curate_prompt_catalog_recipe(payload)
                recipe["payload"]["tokens"] = _recipe_tokens(recipe["payload"])
        return web.json_response(recipes)

    @PromptServer.instance.routes.post("/sickollie/recipe-catalog/recipes")
    async def solo_recipe_save(request):
        payload = await request.json()
        recipe_id = str(payload.get("recipe_id") or f"recipe:{uuid.uuid4().hex}")
        recipe = payload.get("payload")
        if not isinstance(recipe, dict):
            return web.json_response({"ok": False, "error": "Recipe payload must be an object"}, status=400)
        recipe = _curate_prompt_catalog_recipe(recipe)
        recipe["tokens"] = _recipe_tokens(recipe)
        try:
            get_catalog().save_recipe(recipe_id, str(payload.get("name", "")), recipe, str(payload.get("preview_ref", "")))
        except ValueError as error:
            return web.json_response({"ok": False, "error": str(error)}, status=400)
        return web.json_response({"ok": True, "recipe_id": recipe_id})

    @PromptServer.instance.routes.delete("/sickollie/recipe-catalog/recipes/{recipe_id}")
    async def solo_recipe_delete(request):
        recipe_id = str(request.match_info.get("recipe_id", ""))
        recipe = next((item for item in get_catalog().recipes() if item.get("recipe_id") == recipe_id), None)
        get_catalog().delete_recipe(recipe_id)
        preview_ref = str((recipe or {}).get("preview_ref") or "")
        preview_path = _preview_directory() / Path(preview_ref).name
        if preview_ref and preview_path.is_file():
            preview_path.unlink(missing_ok=True)
        return web.json_response({"ok": True})

    @PromptServer.instance.routes.get("/sickollie/recipe-catalog/preview/{filename}")
    async def solo_recipe_preview(request):
        filename = str(request.match_info.get("filename", ""))
        if not filename or Path(filename).name != filename:
            raise web.HTTPNotFound()
        path = _preview_directory() / filename
        if not path.is_file():
            raise web.HTTPNotFound()
        return web.FileResponse(path)

    @PromptServer.instance.routes.post("/sickollie/recipe-catalog/save-with-preview")
    async def solo_recipe_save_with_preview(request):
        reader = await request.multipart()
        name = ""
        payload_text = ""
        raw = bytearray()
        filename = "preview.png"
        while True:
            field = await reader.next()
            if field is None:
                break
            if field.name == "name":
                name = await field.text()
            elif field.name == "payload":
                payload_text = await field.text()
            elif field.name == "file":
                filename = str(field.filename or filename)
                while True:
                    chunk = await field.read_chunk(1024 * 1024)
                    if not chunk:
                        break
                    raw.extend(chunk)
                    if len(raw) > 40 * 1024 * 1024:
                        return web.json_response({"ok": False, "error": "Preview thumbnail verification is limited to 40 MB"}, status=413)
        try:
            recipe = json.loads(payload_text or "{}")
        except json.JSONDecodeError:
            return web.json_response({"ok": False, "error": "Recipe payload was not valid JSON"}, status=400)
        if not isinstance(recipe, dict):
            return web.json_response({"ok": False, "error": "Recipe payload must be an object"}, status=400)
        recipe = _curate_prompt_catalog_recipe(recipe)
        recipe["tokens"] = _recipe_tokens(recipe)
        if not recipe.get("nodes"):
            return web.json_response({"ok": False, "error": "The current Studio recipe had no reusable prompt or generation values"}, status=400)

        preview_ref = ""
        preview_matched = False
        preview_reason = "No Preview image was available; saved from the current Studio node state."
        if raw:
            try:
                image_recipe, preview_image = _recipe_from_image_bytes(bytes(raw))
                recipe = _preview_authoritative_recipe(recipe, image_recipe)
                preview_ref = _save_preview(preview_image, uuid.uuid4().hex)
                preview_matched = True
                preview_reason = "Recipe values and thumbnail were captured from the displayed Preview image metadata."
            except Exception as error:
                preview_reason = f"Could not read resolved metadata from {filename}: {error}"

        recipe_id = f"recipe:{uuid.uuid4().hex}"
        try:
            get_catalog().save_recipe(recipe_id, name, recipe, preview_ref)
        except Exception:
            if preview_ref:
                (_preview_directory() / preview_ref).unlink(missing_ok=True)
            raise
        return web.json_response({
            "ok": True,
            "recipe_id": recipe_id,
            "preview_ref": preview_ref,
            "preview_matched": preview_matched,
            "preview_reason": preview_reason,
        })

    @PromptServer.instance.routes.post("/sickollie/recipe-catalog/import-image")
    async def solo_recipe_import_image(request):
        reader = await request.multipart()
        field = await reader.next()
        if field is None or field.name != "file" or not field.filename:
            return web.json_response({"ok": False, "error": "Choose a PNG, JPG, or WEBP output image"}, status=400)
        raw = bytearray()
        while True:
            chunk = await field.read_chunk(1024 * 1024)
            if not chunk:
                break
            raw.extend(chunk)
            if len(raw) > 40 * 1024 * 1024:
                return web.json_response({"ok": False, "error": "Image metadata import is limited to 40 MB"}, status=413)
        try:
            payload, preview_image = _recipe_from_image_bytes(bytes(raw))
            recipe_id = f"recipe:{uuid.uuid4().hex}"
            name = Path(field.filename).stem
            preview_ref = _save_preview(preview_image, uuid.uuid4().hex)
            try:
                get_catalog().save_recipe(recipe_id, name, payload, preview_ref)
            except Exception:
                (_preview_directory() / preview_ref).unlink(missing_ok=True)
                raise
            return web.json_response({"ok": True, "saved": True, "recipe_id": recipe_id, "name": name, "preview_ref": preview_ref, "tokens": payload["tokens"]})
        except Exception as error:
            return web.json_response({"ok": False, "error": str(error)}, status=400)
