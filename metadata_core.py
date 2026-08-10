from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
from pathlib import Path
from typing import Any

import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence

import folder_paths

try:
    from aiohttp import web
    from server import PromptServer
except Exception:  # pragma: no cover - unavailable outside ComfyUI runtime
    web = None
    PromptServer = None

NO_FILE = "[None]"
TEMP_TOKEN_PREFIX = "so-temp::"
TEMP_SUBFOLDER = "SickOllieMetadata"


def _metadata_temp_root() -> Path:
    root = Path(folder_paths.get_temp_directory()) / TEMP_SUBFOLDER
    root.mkdir(parents=True, exist_ok=True)
    return root


def _temp_token_for_path(path: Path) -> str:
    return f"{TEMP_TOKEN_PREFIX}{path.name}"


def _temp_path_from_token(value: str) -> str:
    token = str(value or "").strip()
    if not token.startswith(TEMP_TOKEN_PREFIX):
        return ""
    filename = Path(token[len(TEMP_TOKEN_PREFIX):]).name
    if not filename:
        return ""
    root = _metadata_temp_root().resolve()
    candidate = (root / filename).resolve()
    try:
        candidate.relative_to(root)
    except Exception:
        return ""
    return str(candidate)


def _delete_temp_token(value: str) -> bool:
    path_text = _temp_path_from_token(value)
    if not path_text:
        return False
    path = Path(path_text)
    try:
        if path.is_file():
            path.unlink()
            return True
    except Exception:
        pass
    return False


def _input_image_choices() -> list[str]:
    # Kept only for backwards compatibility with older saved workflows.
    # New uploads use a private temp token instead of populating ComfyUI/input.
    return [NO_FILE]


def _decode_json(value: Any) -> Any:
    if isinstance(value, (dict, list, int, float, bool)) or value is None:
        return value
    if isinstance(value, bytes):
        try:
            value = value.decode("utf-8", errors="replace")
        except Exception:
            return repr(value)
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return ""
        try:
            # Output Core JSON-encodes every PNG text value, including plain
            # strings. Decoding any valid JSON value removes those harmless
            # wrapper quotes while ordinary parameter text simply falls back.
            return json.loads(text)
        except Exception:
            return value
    return value


def _dict_value(value: Any) -> dict[str, Any]:
    parsed = _decode_json(value)
    return parsed if isinstance(parsed, dict) else {}


def _string(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        try:
            return json.dumps(value, ensure_ascii=False)
        except Exception:
            return str(value)
    return str(value)


def _first(*values: Any) -> Any:
    for value in values:
        if value is None:
            continue
        if isinstance(value, str) and not value.strip():
            continue
        if isinstance(value, (dict, list)) and not value:
            continue
        return value
    return ""


def _path_from_selected(image_file: str) -> str:
    value = str(image_file or "").strip()
    if not value or value == NO_FILE:
        return ""

    temp_path = _temp_path_from_token(value)
    if temp_path:
        return temp_path if os.path.isfile(temp_path) else ""

    # Backwards compatibility for workflows saved before the private-temp
    # uploader existed. Those values may still point into ComfyUI/input.
    try:
        return folder_paths.get_annotated_filepath(value)
    except Exception:
        candidate = Path(folder_paths.get_input_directory()) / value
        return str(candidate) if candidate.is_file() else ""


def _trace_upstream_file(prompt: Any, unique_id: Any) -> str:
    if not isinstance(prompt, dict):
        return ""
    start = prompt.get(str(unique_id)) or prompt.get(unique_id)
    if not isinstance(start, dict):
        return ""
    queue: list[str] = []
    for value in _dict_value(start.get("inputs", {})).values():
        if isinstance(value, list) and value and str(value[0]) in prompt:
            queue.append(str(value[0]))
    seen: set[str] = set()
    while queue:
        node_id = queue.pop(0)
        if node_id in seen:
            continue
        seen.add(node_id)
        node = prompt.get(node_id)
        if not isinstance(node, dict):
            continue
        inputs = _dict_value(node.get("inputs", {}))
        class_type = str(node.get("class_type", "") or "")
        for key in ("image", "image_file", "filename", "saved_path"):
            value = inputs.get(key)
            if not isinstance(value, str) or not value.strip():
                continue
            if key == "saved_path" and os.path.isfile(value):
                return value
            if class_type in {"LoadImage", "LoadImageOutput", "SOImageMetadataCore", "SOImageMetadataCoreStudio"} or key in {"image", "image_file"}:
                path = _path_from_selected(value)
                if path and os.path.isfile(path):
                    return path
        for value in inputs.values():
            if isinstance(value, list) and value and str(value[0]) in prompt:
                queue.append(str(value[0]))
    return ""


def _pil_to_tensor(path: str) -> torch.Tensor:
    image = Image.open(path)
    frames = []
    base_size = None
    for frame in ImageSequence.Iterator(image):
        frame = ImageOps.exif_transpose(frame).convert("RGB")
        if base_size is None:
            base_size = frame.size
        if frame.size != base_size:
            continue
        arr = np.asarray(frame).astype(np.float32) / 255.0
        frames.append(torch.from_numpy(arr)[None, ...])
    if not frames:
        raise ValueError(f"No readable image frames in {path}")
    return torch.cat(frames, dim=0)


def _first_tensor_image(images: Any) -> torch.Tensor:
    if torch.is_tensor(images):
        tensor = images
        while tensor.ndim > 4 and tensor.shape[0] == 1:
            tensor = tensor[0]
        if tensor.ndim == 3:
            tensor = tensor.unsqueeze(0)
        return tensor
    if isinstance(images, (list, tuple)) and images:
        return _first_tensor_image(images[0])
    return torch.zeros((1, 64, 64, 3), dtype=torch.float32)


def _metadata_from_file(path: str) -> tuple[dict[str, Any], tuple[int, int], str]:
    with Image.open(path) as image:
        info: dict[str, Any] = {str(k): _decode_json(v) for k, v in image.info.items()}
        size = tuple(image.size)
        fmt = str(image.format or Path(path).suffix.lstrip(".")).upper()
        try:
            exif = image.getexif()
            user_comment = exif.get(0x9286) if exif else None
            decoded_comment = _decode_json(user_comment)
            if isinstance(decoded_comment, dict):
                for key, value in decoded_comment.items():
                    info.setdefault(str(key), _decode_json(value))
        except Exception:
            pass
    return info, size, fmt


def _parameters_fields(parameters: str) -> dict[str, Any]:
    text = str(parameters or "").strip()
    if not text:
        return {}
    fields: dict[str, Any] = {}
    detail_keys = [
        "Steps", "Sampler", "Schedule type", "Scheduler", "CFG scale", "Seed",
        "Size", "Model", "Model hash", "VAE", "VAE hash", "Denoising strength",
        "Model shift", "Clip skip",
    ]
    detail_start = None
    for marker in ("\nSteps:", "Steps:"):
        pos = text.find(marker)
        if pos >= 0:
            detail_start = pos + (1 if marker.startswith("\n") else 0)
            break
    prompt_part = text if detail_start is None else text[:detail_start].rstrip()
    negative_marker = "\nNegative prompt:"
    if negative_marker in prompt_part:
        positive, negative = prompt_part.split(negative_marker, 1)
        fields["positive_prompt"] = positive.strip()
        fields["negative_prompt"] = negative.strip()
    else:
        fields["positive_prompt"] = prompt_part.strip()
    for key in detail_keys:
        pattern = rf"(?:^|,\s*|\n){re.escape(key)}:\s*(.*?)(?=(?:,\s*|\n)(?:{'|'.join(re.escape(k) for k in detail_keys)}):|$)"
        match = re.search(pattern, text, flags=re.IGNORECASE | re.DOTALL)
        if match:
            fields[key] = match.group(1).strip().strip('"')
    return fields


def _follow_prompt_text(graph: dict[str, Any], link: Any) -> str:
    if not (isinstance(link, list) and link):
        return ""
    node = graph.get(str(link[0])) or graph.get(link[0])
    if not isinstance(node, dict):
        return ""
    inputs = _dict_value(node.get("inputs", {}))
    for key in ("text", "positive_text", "prompt", "string"):
        value = inputs.get(key)
        if isinstance(value, str) and value.strip():
            return value
        if isinstance(value, list):
            nested = _follow_prompt_text(graph, value)
            if nested:
                return nested
    return ""


def _extract_comfy_graph(info: dict[str, Any]) -> dict[str, Any]:
    graph = _dict_value(info.get("prompt"))
    result: dict[str, Any] = {"generation": {}, "models": {}, "positive_prompt": "", "negative_prompt": ""}
    if not graph:
        return result
    models: dict[str, Any] = {"all_loras": []}
    for node in graph.values():
        if not isinstance(node, dict):
            continue
        class_type = str(node.get("class_type", "") or "")
        inputs = _dict_value(node.get("inputs", {}))
        if "KSampler" in class_type or class_type in {"SamplerCustom", "SamplerCustomAdvanced", "SOGenerationPipeline", "SOGenerationPipelineStudio"}:
            for source, target in (
                ("seed", "seed_used"), ("noise_seed", "seed_used"), ("steps", "steps"),
                ("cfg", "cfg"), ("sampler_name", "sampler_name"),
                ("scheduler", "scheduler"), ("denoise", "denoise"),
            ):
                if source in inputs and not isinstance(inputs[source], list):
                    result["generation"].setdefault(target, inputs[source])
            result["positive_prompt"] = _first(result["positive_prompt"], _follow_prompt_text(graph, inputs.get("positive")), _follow_prompt_text(graph, inputs.get("positive_text")))
            result["negative_prompt"] = _first(result["negative_prompt"], _follow_prompt_text(graph, inputs.get("negative")))
        for key in ("width", "height", "batch_size"):
            if key in inputs and not isinstance(inputs[key], list):
                result["generation"].setdefault(key, inputs[key])
        for key, target in (
            ("unet_name", "diffusion_model"), ("ckpt_name", "diffusion_model"),
            ("diffusion_model", "diffusion_model"), ("vae_name", "vae"),
            ("clip_name", "text_encoder"),
        ):
            value = inputs.get(key)
            if isinstance(value, str) and value.strip():
                models.setdefault(target, value)
        lora_name = inputs.get("lora_name")
        if isinstance(lora_name, str) and lora_name.strip():
            strength = _first(inputs.get("strength_model"), inputs.get("strength"), inputs.get("strength_clip"), 1.0)
            models["all_loras"].append({"file": lora_name, "name": Path(lora_name).stem, "strength": strength})
    result["models"] = models
    return result


def _resolved_block(info: dict[str, Any], structured: dict[str, Any]) -> dict[str, Any]:
    resolved = _dict_value(structured.get("resolved"))
    if not resolved:
        resolved = _dict_value(info.get("so_prompt_core_resolved"))
    if resolved:
        return resolved
    return {
        "final_prompt": str(info.get("resolved_prompt", "") or ""),
        "source_prompt": str(info.get("source_prompt", "") or ""),
        "prompt": {
            "file": str(info.get("so_prompt_file", "") or ""),
            "index": info.get("so_prompt_index_resolved", None),
            "count": info.get("so_prompt_count", None),
            "line": str(info.get("prompt_log_line", "") or ""),
        },
        "outfit_a": {
            "token": ("OUTFIT_A" if "OUTFIT_A" in str(info.get("source_prompt", "") or "") else ("OUTFIT" if "OUTFIT" in str(info.get("source_prompt", "") or "") else "")),
            "file": str(info.get("so_outfit_a_file", "") or ""),
            "index": info.get("so_outfit_a_index_resolved", None),
            "count": info.get("so_outfit_a_count", None),
            "line": str(info.get("outfit_log_line", "") or ""),
        },
        "outfit_b": {
            "token": ("OUTFIT_B" if "OUTFIT_B" in str(info.get("source_prompt", "") or "") else ""),
            "file": str(info.get("so_outfit_b_file", "") or ""),
            "index": info.get("so_outfit_b_index_resolved", None),
            "count": info.get("so_outfit_b_count", None),
            "line": str(info.get("outfit_log_line_B", "") or ""),
        },
        "outfit_c": {
            "token": ("OUTFIT_C" if "OUTFIT_C" in str(info.get("source_prompt", "") or "") else ""),
            "file": str(info.get("so_outfit_c_file", "") or ""),
            "index": info.get("so_outfit_c_index_resolved", None),
            "count": info.get("so_outfit_c_count", None),
            "line": str(info.get("outfit_log_line_C", "") or ""),
        },
        "scene": {
            "token": ("SCENE" if "SCENE" in str(info.get("source_prompt", "") or "") else ""),
            "file": str(info.get("so_scene_file", "") or ""),
            "index": info.get("so_scene_index_resolved", None),
            "count": info.get("so_scene_count", None),
            "line": str(info.get("scene_log_line", "") or ""),
        },
    }


def _token_was_used(source_prompt: str, section: Any) -> bool:
    if not isinstance(section, dict) or not section:
        return False
    token = str(section.get("token", "") or "")
    line = str(section.get("line", "") or "")
    return bool(token and line and token in str(source_prompt or ""))


def _sanitize_resolved(resolved: dict[str, Any]) -> dict[str, Any]:
    """Hide loaded-but-unused Prompt Core values, including on older PNGs."""
    if not isinstance(resolved, dict):
        return {}
    cleaned = dict(resolved)
    source_prompt = str(cleaned.get("source_prompt", "") or "")

    prompt = cleaned.get("prompt") if isinstance(cleaned.get("prompt"), dict) else {}
    if str(prompt.get("source", "") or "").lower() != "log":
        cleaned["prompt"] = {
            "source": "manual",
            "manual_prompt": str(prompt.get("manual_prompt", source_prompt) or source_prompt),
        }

    for key in ("outfit_a", "outfit_b", "outfit_c", "scene"):
        section = cleaned.get(key) if isinstance(cleaned.get(key), dict) else {}
        if not _token_was_used(source_prompt, section):
            cleaned[key] = {}

    for key in ("name", "item"):
        section = cleaned.get(key) if isinstance(cleaned.get(key), dict) else {}
        token = str(section.get("token", "") or "")
        value = str(section.get("value", "") or "")
        if not (token and value and token in source_prompt):
            cleaned[key] = {}

    return cleaned


def _format_section(section: Any, title: str = "") -> str:
    data = section if isinstance(section, dict) else {}
    lines: list[str] = []
    labels = (("token", "Token"), ("file", "File"), ("index", "Resolved index"), ("count", "Line count"), ("line", "Resolved line"))
    for key, label in labels:
        value = data.get(key)
        if value is None or value == "" or value == NO_FILE:
            continue
        lines.append(f"{label}: {value}")
    return "\n".join(lines)


def _format_prompt_section(section: Any) -> str:
    data = section if isinstance(section, dict) else {}
    if str(data.get("source", "") or "").lower() != "log":
        return ""
    lines: list[str] = []
    for key, label in (("file", "File"), ("index", "Resolved index"), ("count", "Line count")):
        value = data.get(key)
        if value is None or value == "" or value == NO_FILE:
            continue
        lines.append(f"{label}: {value}")
    return "\n".join(lines)


def _parse_metadata(info: dict[str, Any], filename: str, size: tuple[int, int], fmt: str) -> dict[str, Any]:
    structured = _dict_value(info.get("so_image_metadata"))
    resolved = _sanitize_resolved(_resolved_block(info, structured))
    graph = _extract_comfy_graph(info)
    params = _parameters_fields(_string(info.get("parameters", "")))

    generation = _dict_value(structured.get("generation"))
    if not generation:
        generation = _dict_value(info.get("so_generation_info"))
    generation = {**graph.get("generation", {}), **generation}
    field_map = {
        "Steps": "steps", "CFG scale": "cfg", "Seed": "seed_used", "Sampler": "sampler_name",
        "Schedule type": "scheduler", "Scheduler": "scheduler", "Denoising strength": "denoise",
        "Model shift": "shift",
    }
    for source, target in field_map.items():
        value = _first(info.get(source), params.get(source))
        if value != "" and target not in generation:
            generation[target] = value
    size_text = _first(info.get("Size"), params.get("Size"))
    if size_text and ("width" not in generation or "height" not in generation):
        match = re.search(r"(\d+)\s*[xX]\s*(\d+)", str(size_text))
        if match:
            generation.setdefault("width", int(match.group(1)))
            generation.setdefault("height", int(match.group(2)))
    generation.setdefault("width", size[0])
    generation.setdefault("height", size[1])

    models = _dict_value(structured.get("models"))
    graph_models = graph.get("models", {}) if isinstance(graph.get("models"), dict) else {}
    for key, value in graph_models.items():
        if key == "all_loras":
            continue
        models.setdefault(key, value)
    models.setdefault("diffusion_model", _first(info.get("so_loader_core_diffusion_model"), info.get("Model"), params.get("Model")))
    models.setdefault("diffusion_model_hash", _first(info.get("Model hash"), params.get("Model hash")))
    models.setdefault("text_encoder", _first(info.get("so_generation_clip_name"), generation.get("clip_name")))
    models.setdefault("vae", _first(info.get("so_generation_vae_name"), generation.get("vae_name"), info.get("VAE"), params.get("VAE")))
    models.setdefault("vae_hash", _first(info.get("VAE hash"), params.get("VAE hash")))
    models.setdefault("main_trigger", info.get("so_loader_core_main_trigger", ""))
    if not models.get("all_loras"):
        raw_loras = info.get("so_loader_core_applied_loras", [])
        if isinstance(raw_loras, list):
            models["all_loras"] = []
            for index, value in enumerate(raw_loras):
                text = str(value)
                file_name, strength = (text.rsplit("@", 1) + ["1"])[:2] if "@" in text else (text, "1")
                models["all_loras"].append({"role": "main" if index == 0 else "secondary", "file": file_name, "name": Path(file_name).stem, "strength": strength})
        elif graph_models.get("all_loras"):
            models["all_loras"] = graph_models.get("all_loras")

    final_prompt = _first(
        resolved.get("final_prompt"), info.get("resolved_prompt"), generation.get("positive_prompt"),
        info.get("Positive prompt"), params.get("positive_prompt"), graph.get("positive_prompt"),
    )
    source_prompt = _first(resolved.get("source_prompt"), info.get("source_prompt"))
    negative_prompt = _first(generation.get("negative_prompt"), info.get("Negative prompt"), params.get("negative_prompt"), graph.get("negative_prompt"))

    formats = []
    if structured:
        formats.append("Sick Ollie structured")
    elif info.get("resolved_prompt") or info.get("so_generation_info"):
        formats.append("Sick Ollie legacy")
    if _dict_value(info.get("prompt")):
        formats.append("Comfy prompt")
    if _dict_value(info.get("workflow")):
        formats.append("Comfy workflow")
    if info.get("parameters"):
        formats.append("parameters")

    status_lines = [
        f"File: {filename or 'wired image'}",
        f"Image: {size[0]} × {size[1]} {fmt}" if size else f"Image format: {fmt}",
        f"Metadata detected: {', '.join(formats)}" if formats else "Metadata detected: none",
    ]

    generation_labels = (
        ("steps", "Steps"), ("cfg", "CFG"),
        ("sampler_name", "Sampler"), ("scheduler", "Scheduler"),
        ("denoise", "Denoise"), ("shift", "Model shift"),
        ("width", "Width"), ("height", "Height"), ("batch_size", "Batch size"),
    )
    generation_lines = []
    for key, label in generation_labels:
        value = generation.get(key)
        if value is not None and value != "":
            generation_lines.append(f"{label}: {value}")
    if negative_prompt:
        generation_lines.append(f"Negative prompt: {negative_prompt}")
    generation_text = "\n".join(generation_lines) if generation_lines else "not saved"

    model_lines = []
    for key, label in (
        ("diffusion_model", "Diffusion model"), ("diffusion_model_hash", "Model hash"),
        ("weight_dtype", "Weight dtype"), ("text_encoder", "Text encoder"),
        ("vae", "VAE"), ("vae_hash", "VAE hash"), ("main_trigger", "Main trigger"),
    ):
        value = models.get(key)
        if value:
            model_lines.append(f"{label}: {value}")
    main_lora = models.get("main_lora") if isinstance(models.get("main_lora"), dict) else {}
    if main_lora:
        model_lines.append(f"Main LoRA: {_first(main_lora.get('file'), main_lora.get('name'))} @ {main_lora.get('strength', '1')}")
    all_loras = models.get("all_loras") if isinstance(models.get("all_loras"), list) else []
    if all_loras:
        has_main_role = any(isinstance(item, dict) and item.get("role") == "main" for item in all_loras)
        if not main_lora and has_main_role:
            for item in all_loras:
                if isinstance(item, dict) and item.get("role") == "main":
                    model_lines.append(f"Main LoRA: {_first(item.get('file'), item.get('name'))} @ {item.get('strength', '1')}")
                    break
        secondary = [item for item in all_loras if isinstance(item, dict) and item.get("role") == "secondary"]
        if secondary:
            model_lines.append("Secondary LoRAs:")
            for item in secondary:
                model_lines.append(f"  {_first(item.get('file'), item.get('name'))} @ {item.get('strength', '1')}")
        elif not main_lora and not has_main_role:
            model_lines.append("LoRAs:")
            for item in all_loras:
                if isinstance(item, dict):
                    model_lines.append(f"  {_first(item.get('file'), item.get('name'))} @ {item.get('strength', '1')}")
    models_text = "\n".join(model_lines) if model_lines else "not saved"

    prompt_text = _format_prompt_section(resolved.get("prompt"))
    outfit_a_text = _format_section(resolved.get("outfit_a"))
    outfit_b_text = _format_section(resolved.get("outfit_b"))
    outfit_c_text = _format_section(resolved.get("outfit_c"))
    scene_text = _format_section(resolved.get("scene"))

    substitutions = []
    for key, label in (("name", "NAME"), ("item", "ITEM")):
        data = resolved.get(key) if isinstance(resolved.get(key), dict) else {}
        token, value = data.get("token", ""), data.get("value", "")
        if token and value:
            substitutions.append(f"{label}: {value}")
    for key, label in (("prefix", "Prefix"), ("suffix", "Suffix")):
        data = resolved.get(key) if isinstance(resolved.get(key), dict) else {}
        text_value = str(data.get("text", "") or "")
        if data.get("enabled") and text_value:
            substitutions.append(f"{label}: {text_value}")
    substitutions_text = "\n".join(substitutions)

    master_sections = []
    if generation_text and generation_text != "not saved":
        master_sections.append(f"GENERATION\n{generation_text}")
    if models_text and models_text != "not saved":
        master_sections.append(f"MODELS + LORAS\n{models_text}")
    if prompt_text:
        master_sections.append(f"PROMPT LOG\n{prompt_text}")
    if outfit_a_text:
        master_sections.append(f"OUTFIT A\n{outfit_a_text}")
    if outfit_b_text:
        master_sections.append(f"OUTFIT B\n{outfit_b_text}")
    if outfit_c_text:
        master_sections.append(f"OUTFIT C\n{outfit_c_text}")
    if scene_text:
        master_sections.append(f"SCENE\n{scene_text}")
    if substitutions_text:
        master_sections.append(f"SUBSTITUTIONS\n{substitutions_text}")
    master_metadata = "\n\n".join(master_sections)

    report_sections = [
        ("FINAL PROMPT", str(final_prompt or "not saved")),
        ("SOURCE PROMPT", str(source_prompt or "not saved")),
        ("METADATA", master_metadata or "not saved"),
    ]
    full_report = "\n\n".join(f"{title}\n{text}" for title, text in report_sections)
    normalized = {
        "source_file": filename,
        "image": {"width": size[0], "height": size[1], "format": fmt},
        "resolved": resolved,
        "generation": generation,
        "models": models,
        "final_prompt": str(final_prompt or ""),
        "source_prompt": str(source_prompt or ""),
    }
    has_metadata = bool(formats or final_prompt or generation_lines or model_lines)
    try:
        seed_value = int(float(generation.get("seed_used", 0) or 0))
    except Exception:
        seed_value = 0

    return {
        "status": "\n".join(status_lines),
        "final_prompt": str(final_prompt or ""),
        "source_prompt": str(source_prompt or ""),
        "generation": generation_text,
        "models": models_text,
        "prompt_log": prompt_text,
        "outfit_a": outfit_a_text,
        "outfit_b": outfit_b_text,
        "outfit_c": outfit_c_text,
        "scene": scene_text,
        "substitutions": substitutions_text,
        "resolved_inputs": master_metadata,
        "full_report": full_report,
        "metadata_json": json.dumps(normalized, ensure_ascii=False, indent=2),
        "seed": seed_value,
        "seed_text": str(seed_value) if seed_value else "",
        "has_metadata": has_metadata,
    }



def _preview_reference(path: str) -> list[dict[str, str]]:
    if not path:
        return []
    resolved = Path(path).resolve()

    for root_path, image_type in (
        (Path(folder_paths.get_temp_directory()).resolve(), "temp"),
        (Path(folder_paths.get_input_directory()).resolve(), "input"),
        (Path(folder_paths.get_output_directory()).resolve(), "output"),
    ):
        try:
            relative = resolved.relative_to(root_path)
            return [{
                "filename": relative.name,
                "subfolder": relative.parent.as_posix() if str(relative.parent) != "." else "",
                "type": image_type,
            }]
        except Exception:
            continue
    return []


def _save_wire_preview(images: torch.Tensor, unique_id: Any) -> list[dict[str, str]]:
    try:
        tensor = _first_tensor_image(images)[0].detach().cpu().numpy()
        arr = np.clip(tensor * 255.0, 0, 255).astype(np.uint8)
        temp_dir = Path(folder_paths.get_temp_directory())
        temp_dir.mkdir(parents=True, exist_ok=True)
        filename = f"SickOllieMetadataPreview_{unique_id or 'node'}.png"
        Image.fromarray(arr).save(temp_dir / filename)
        return [{"filename": filename, "subfolder": "", "type": "temp"}]
    except Exception:
        return []


def _metadata_payload_for_path(source_path: str) -> tuple[dict[str, Any], torch.Tensor, list[dict[str, str]]]:
    metadata: dict[str, Any] = {}
    source_size = (0, 0)
    source_format = "IMAGE"
    preview: list[dict[str, str]] = []
    output_images = torch.zeros((1, 64, 64, 3), dtype=torch.float32)
    filename = ""

    if source_path and os.path.isfile(source_path):
        output_images = _pil_to_tensor(source_path)
        metadata, source_size, source_format = _metadata_from_file(source_path)
        preview = _preview_reference(source_path)
        filename = Path(source_path).name

    parsed = _parse_metadata(metadata, filename, source_size, source_format)
    payload = dict(parsed)
    return payload, output_images, preview


if PromptServer is not None and web is not None:

    @PromptServer.instance.routes.get("/sickollie/metadata-core/read")
    async def so_metadata_core_read(request):
        image_file = request.rel_url.query.get("image_file", NO_FILE)
        source_path = _path_from_selected(image_file)
        if not source_path or not os.path.isfile(source_path):
            return web.json_response({"ok": False, "error": "Invalid image file", "payload": {}}, status=400)

        payload, _images, preview = _metadata_payload_for_path(source_path)
        return web.json_response({"ok": True, "payload": payload, "images": preview, "image_file": image_file})

    @PromptServer.instance.routes.post("/sickollie/metadata-core/upload-temp")
    async def so_metadata_core_upload_temp(request):
        reader = await request.multipart()
        upload_field = None
        previous_token = ""

        while True:
            field = await reader.next()
            if field is None:
                break
            if field.name == "file":
                upload_field = field
                break
            if field.name == "previous_token":
                previous_token = (await field.text()).strip()

        if upload_field is None or not upload_field.filename:
            return web.json_response({"ok": False, "error": "No image uploaded"}, status=400)

        original_name = Path(upload_field.filename).name
        suffix = Path(original_name).suffix.lower()
        if suffix not in {".png", ".jpg", ".jpeg", ".webp"}:
            return web.json_response({"ok": False, "error": "Unsupported image type"}, status=400)

        root = _metadata_temp_root()
        safe_stem = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(original_name).stem).strip("._") or "image"
        filename = f"{uuid.uuid4().hex[:12]}_{safe_stem}{suffix}"
        destination = root / filename

        try:
            with destination.open("wb") as handle:
                while True:
                    chunk = await upload_field.read_chunk(size=1024 * 1024)
                    if not chunk:
                        break
                    handle.write(chunk)

            # Validate that Pillow can actually open the uploaded file before
            # keeping it around as an inspector source.
            with Image.open(destination) as image:
                image.verify()

            if previous_token and previous_token != _temp_token_for_path(destination):
                _delete_temp_token(previous_token)

            token = _temp_token_for_path(destination)
            payload, _images, preview = _metadata_payload_for_path(str(destination))
            # Keep the original human filename in the UI instead of the UUID
            # used to avoid temp-file collisions.
            if isinstance(payload.get("status"), str):
                status_lines = payload["status"].splitlines()
                if status_lines and status_lines[0].startswith("File:"):
                    status_lines[0] = f"File: {original_name}"
                    payload["status"] = "\n".join(status_lines)
            return web.json_response({
                "ok": True,
                "image_file": token,
                "display_name": original_name,
                "payload": payload,
                "images": preview,
            })
        except Exception as error:
            try:
                if destination.is_file():
                    destination.unlink()
            except Exception:
                pass
            return web.json_response({"ok": False, "error": str(error)}, status=400)

    @PromptServer.instance.routes.post("/sickollie/metadata-core/clear-temp")
    async def so_metadata_core_clear_temp(request):
        token = ""
        try:
            data = await request.json()
            if isinstance(data, dict):
                token = str(data.get("image_file", "") or "")
        except Exception:
            pass
        deleted = _delete_temp_token(token)
        return web.json_response({"ok": True, "deleted": deleted})


class SOImageMetadataCore:
    @classmethod
    def INPUT_TYPES(cls):
        readonly = {"default": "", "multiline": True, "dynamicPrompts": False}
        return {
            "required": {
                "image_file": ("STRING", {"default": NO_FILE, "multiline": False, "dynamicPrompts": False}),
                "status": ("STRING", dict(readonly)),
                "final_prompt_display": ("STRING", dict(readonly)),
                "source_prompt_display": ("STRING", dict(readonly)),
                "generation_display": ("STRING", dict(readonly)),
                "models_display": ("STRING", dict(readonly)),
                "prompt_log_display": ("STRING", dict(readonly)),
                "outfit_a_display": ("STRING", dict(readonly)),
                "outfit_b_display": ("STRING", dict(readonly)),
                "outfit_c_display": ("STRING", dict(readonly)),
                "scene_display": ("STRING", dict(readonly)),
                "substitutions_display": ("STRING", dict(readonly)),
            },
            "optional": {"images": ("IMAGE",)},
            "hidden": {"prompt": "PROMPT", "extra_pnginfo": "EXTRA_PNGINFO", "unique_id": "UNIQUE_ID"},
        }

    RETURN_TYPES = ("IMAGE", "STRING", "STRING", "INT", "STRING", "STRING", "STRING", "STRING", "STRING", "BOOLEAN")
    RETURN_NAMES = ("images", "final_prompt", "source_prompt", "seed", "generation_settings", "models", "resolved_inputs", "full_report", "metadata_json", "has_metadata")
    FUNCTION = "read_metadata"
    OUTPUT_NODE = True
    CATEGORY = "Sick Ollie/Classic"
    DESCRIPTION = "Loads or accepts an image, extracts resolved generation metadata, and provides readable sections with copy controls."
    SEARCH_ALIASES = ["image metadata", "png metadata", "prompt reader", "generation info", "metadata viewer"]

    @classmethod
    def IS_CHANGED(cls, image_file=NO_FILE, images=None, **kwargs):
        path = _path_from_selected(image_file)
        if path and os.path.isfile(path):
            h = hashlib.sha256()
            with open(path, "rb") as handle:
                for block in iter(lambda: handle.read(1024 * 1024), b""):
                    h.update(block)
            return h.hexdigest()
        return float("nan")

    @classmethod
    def VALIDATE_INPUTS(cls, image_file=NO_FILE, **kwargs):
        # Temp inspector files are intentionally disposable. If one vanished
        # between sessions, allow the workflow to load/run and simply treat it
        # as no manual image rather than blocking execution.
        return True

    def read_metadata(
        self,
        image_file,
        status="",
        final_prompt_display="",
        source_prompt_display="",
        generation_display="",
        models_display="",
        prompt_log_display="",
        outfit_a_display="",
        outfit_b_display="",
        outfit_c_display="",
        scene_display="",
        substitutions_display="",
        images=None,
        prompt=None,
        extra_pnginfo=None,
        unique_id=None,
    ):
        selected_path = _path_from_selected(image_file)
        has_wired_image = images is not None
        traced_path = _trace_upstream_file(prompt, unique_id) if has_wired_image else ""

        # A connected IMAGE is the live workflow source and must win over a
        # previously uploaded/selected file. This lets the node be used as both
        # a passive file inspector and a live metadata monitor without an old
        # dropdown selection pinning it to stale metadata.
        source_path = traced_path if traced_path and os.path.isfile(traced_path) else ("" if has_wired_image else selected_path)

        if source_path and os.path.isfile(source_path):
            payload, output_images, preview = _metadata_payload_for_path(source_path)
            parsed = payload
        else:
            output_images = _first_tensor_image(images)
            source_size = (int(output_images.shape[2]), int(output_images.shape[1])) if output_images.ndim == 4 else (0, 0)
            filename = "wired image"
            preview = _save_wire_preview(output_images, unique_id)
            metadata: dict[str, Any] = {}
            if isinstance(extra_pnginfo, dict):
                metadata = {str(k): _decode_json(v) for k, v in extra_pnginfo.items()}
            parsed = _parse_metadata(metadata, filename, source_size, "IMAGE")
            payload = dict(parsed)
        return {
            "ui": {"images": preview, "metadata_payload": [json.dumps(payload, ensure_ascii=False)]},
            "result": (
                output_images,
                parsed["final_prompt"],
                parsed["source_prompt"],
                int(parsed["seed"]),
                parsed["generation"],
                parsed["models"],
                parsed["resolved_inputs"],
                parsed["full_report"],
                parsed["metadata_json"],
                bool(parsed["has_metadata"]),
            ),
        }


NODE_CLASS_MAPPINGS = {"SOImageMetadataCore": SOImageMetadataCore}
NODE_DISPLAY_NAME_MAPPINGS = {"SOImageMetadataCore": "Image Metadata Core"}
