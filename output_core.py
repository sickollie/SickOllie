from __future__ import annotations

import json
import os
import re
import hashlib
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
import torch
from PIL import Image, PngImagePlugin

import folder_paths

NONE = "[None]"
VARIABLE_CHOICES = [
    NONE,
    "clean_name",
    "raw_stem",
    "model_name",
    "seed",
    "prompt_index",
    "outfit_index",
    "scene_index",
    "prompt_file_stem",
    "outfit_file_stem",
    "scene_file_stem",
    "date_yyyymmdd",
    "date_mmdd",
    "time_hhmm",
    "time_hhmmss",
    "datetime_yyyymmdd_hhmmss",
]
IMAGE_FORMATS = ["png", "jpg", "webp"]


def _sanitize_component(value: str) -> str:
    value = str(value).strip()
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', '_', value)
    value = value.strip(' .')
    return value


def _file_stem(path_text: str) -> str:
    try:
        return Path(str(path_text)).stem
    except Exception:
        return ''


def _context_values(**kwargs) -> dict[str, str]:
    now = datetime.now()
    return {
        'clean_name': str(kwargs.get('clean_name', '') or ''),
        'raw_stem': str(kwargs.get('raw_stem', '') or ''),
        'model_name': str(kwargs.get('model_name', '') or ''),
        'seed': str(kwargs.get('seed', '') if kwargs.get('seed', '') is not None else ''),
        'prompt_index': str(kwargs.get('prompt_index', '') if kwargs.get('prompt_index', '') is not None else ''),
        'outfit_index': str(kwargs.get('outfit_index', '') if kwargs.get('outfit_index', '') is not None else ''),
        'scene_index': str(kwargs.get('scene_index', '') if kwargs.get('scene_index', '') is not None else ''),
        'prompt_file_stem': _file_stem(kwargs.get('prompt_file', '')),
        'outfit_file_stem': _file_stem(kwargs.get('outfit_file', '')),
        'scene_file_stem': _file_stem(kwargs.get('scene_file', '')),
        'date_yyyymmdd': now.strftime('%Y%m%d'),
        'date_mmdd': now.strftime('%m%d'),
        'time_hhmm': now.strftime('%H%M'),
        'time_hhmmss': now.strftime('%H%M%S'),
        'datetime_yyyymmdd_hhmmss': now.strftime('%Y%m%d_%H%M%S'),
    }


def _build_segment(literal: str, delimiter: str, variables: list[str], context: dict[str, str]) -> str:
    parts: list[str] = []
    if str(literal).strip():
        parts.append(_sanitize_component(str(literal).strip()))
    for var in variables:
        if var == NONE:
            continue
        value = context.get(var, '')
        value = _sanitize_component(value)
        if value:
            parts.append(value)
    if not parts:
        return ''
    delim = str(delimiter)
    return delim.join(parts)


def _to_pnginfo(prompt, extra_pnginfo, save_prompt_json: bool, save_workflow_json: bool, parameters_text: str = '', civitai_fields: dict[str, str] | None = None) -> PngImagePlugin.PngInfo:
    metadata = PngImagePlugin.PngInfo()
    if save_prompt_json and prompt is not None:
        metadata.add_text('prompt', json.dumps(prompt))
    if isinstance(extra_pnginfo, dict):
        for k, v in extra_pnginfo.items():
            if k == 'workflow' and not save_workflow_json:
                continue
            try:
                metadata.add_text(k, json.dumps(v))
            except Exception:
                metadata.add_text(k, str(v))
    elif isinstance(extra_pnginfo, list):
        for item in extra_pnginfo:
            if isinstance(item, dict):
                for k, v in item.items():
                    if k == 'workflow' and not save_workflow_json:
                        continue
                    try:
                        metadata.add_text(k, json.dumps(v))
                    except Exception:
                        metadata.add_text(k, str(v))
    if civitai_fields:
        for k, v in civitai_fields.items():
            if v is None or str(v).strip() == '':
                continue
            metadata.add_text(str(k), str(v))
    if parameters_text:
        metadata.add_text('parameters', str(parameters_text))
    return metadata


def _to_exif_comment(prompt, extra_pnginfo, save_prompt_json: bool, save_workflow_json: bool, parameters_text: str = '', civitai_fields: dict[str, str] | None = None) -> bytes:
    payload = {}
    if save_prompt_json and prompt is not None:
        payload['prompt'] = prompt
    if isinstance(extra_pnginfo, dict):
        for k, v in extra_pnginfo.items():
            if k == 'workflow' and not save_workflow_json:
                continue
            payload[k] = v
    if civitai_fields:
        payload.update(civitai_fields)
    if parameters_text:
        payload['parameters'] = str(parameters_text)
    comment = json.dumps(payload)
    exif = Image.Exif()
    exif[0x9286] = comment  # UserComment
    return exif


def _normalize_image_batches(images):
    """Return a flat list of individual image tensors/arrays from Comfy IMAGE input."""
    if torch.is_tensor(images):
        tensor = images
        while tensor.ndim > 4 and tensor.shape[0] == 1:
            tensor = tensor[0]
        if tensor.ndim == 3:
            return [tensor]
        if tensor.ndim == 4:
            return [tensor[i] for i in range(tensor.shape[0])]
        return [tensor]

    if isinstance(images, (list, tuple)):
        out = []
        for item in images:
            out.extend(_normalize_image_batches(item))
        return out

    return [images]


def _tensor_to_pil(image_like):
    if torch.is_tensor(image_like):
        arr = image_like.detach().cpu().numpy()
    else:
        arr = np.asarray(image_like)

    while arr.ndim > 3 and arr.shape[0] == 1:
        arr = arr[0]

    if arr.ndim == 3 and arr.shape[0] in (1, 3, 4) and arr.shape[-1] not in (1, 3, 4):
        arr = np.transpose(arr, (1, 2, 0))

    if arr.dtype != np.uint8:
        arr = np.clip(255.0 * arr, 0, 255).astype(np.uint8)

    if arr.ndim == 3 and arr.shape[-1] == 1:
        arr = arr[:, :, 0]

    if arr.ndim not in (2, 3):
        raise TypeError(f'Unsupported image array shape for saving: {arr.shape}')

    return Image.fromarray(arr)


def _parse_generation_info(generation_info, extra_pnginfo=None) -> dict[str, Any]:
    if isinstance(generation_info, str) and generation_info.strip():
        try:
            parsed = json.loads(generation_info)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
    if isinstance(extra_pnginfo, dict):
        fallback = extra_pnginfo.get('so_generation_info')
        if isinstance(fallback, dict):
            return fallback
        if isinstance(fallback, str):
            try:
                parsed = json.loads(fallback)
                if isinstance(parsed, dict):
                    return parsed
            except Exception:
                pass
    return {}


def _parse_applied_loras(applied_loras: str) -> list[tuple[str, str]]:
    text = str(applied_loras or '').strip()
    if not text:
        return []
    results: list[tuple[str, str]] = []
    for chunk in re.split(r'[\n;,]+', text):
        item = chunk.strip()
        if not item:
            continue
        if item.startswith('<lora:') and item.endswith('>'):
            body = item[6:-1]
            parts = body.rsplit(':', 1)
            if len(parts) == 2:
                results.append((parts[0].strip(), parts[1].strip()))
            else:
                results.append((body.strip(), '1'))
            continue

        weight = '1'
        name_part = item
        if '@' in item:
            name_part, weight = item.rsplit('@', 1)
        elif '|' in item:
            name_part, weight = item.rsplit('|', 1)
        elif re.search(r':\s*-?\d+(?:\.\d+)?\s*$', item):
            split_parts = re.split(r':\s*(-?\d+(?:\.\d+)?)\s*$', item)
            if len(split_parts) >= 3:
                name_part = split_parts[0]
                weight = split_parts[1]
        name = Path(name_part.strip()).stem or name_part.strip()
        name = name.replace('.safetensors', '').strip()
        weight = str(weight).strip() or '1'
        if name:
            results.append((name, weight))
    return results


def _build_lora_tag_string(applied_loras: str) -> str:
    tags = []
    for name, weight in _parse_applied_loras(applied_loras):
        tags.append(f'<lora:{name}:{weight}>')
    return ' '.join(tags)


def _build_parameters_text(generation_meta: dict[str, Any], model_name: str, width: int, height: int, seed: int, applied_loras: str) -> str:
    positive = str(generation_meta.get('positive_prompt', '') or '').strip()
    negative = str(generation_meta.get('negative_prompt', '') or '').strip()
    lora_tags = _build_lora_tag_string(applied_loras)
    if lora_tags and lora_tags not in positive:
        positive = (positive + '\n' + lora_tags).strip() if positive else lora_tags

    steps = generation_meta.get('steps', '')
    cfg = generation_meta.get('cfg', '')
    sampler = generation_meta.get('sampler_name', '')
    scheduler = generation_meta.get('scheduler', '')
    denoise = generation_meta.get('denoise', '')
    vae_name = generation_meta.get('vae_name', '')
    seed_value = generation_meta.get('seed_used', seed)
    width_value = generation_meta.get('width', width)
    height_value = generation_meta.get('height', height)
    shift = generation_meta.get('shift', '')

    detail_parts = []
    if steps != '': detail_parts.append(f'Steps: {steps}')
    if sampler != '': detail_parts.append(f'Sampler: {sampler}')
    if scheduler != '': detail_parts.append(f'Schedule type: {scheduler}')
    if cfg != '': detail_parts.append(f'CFG scale: {cfg}')
    if seed_value != '': detail_parts.append(f'Seed: {seed_value}')
    if width_value and height_value: detail_parts.append(f'Size: {width_value}x{height_value}')
    if model_name: detail_parts.append(f'Model: {model_name}')
    if vae_name: detail_parts.append(f'VAE: {vae_name}')
    if denoise != '': detail_parts.append(f'Denoising strength: {denoise}')
    if shift != '': detail_parts.append(f'Clip skip: {shift}')

    if negative:
        return f"{positive}\nNegative prompt: {negative}\n" + ', '.join(detail_parts)
    return positive + ('\n' if positive else '') + ', '.join(detail_parts)


_HASH_CACHE: dict[str, dict[str, str | float]] | None = None
_HASH_CACHE_PATH = Path(__file__).resolve().parent / '.cache' / 'hash_cache.json'


def _load_hash_cache() -> dict[str, dict[str, str | float]]:
    global _HASH_CACHE
    if _HASH_CACHE is not None:
        return _HASH_CACHE
    try:
        if _HASH_CACHE_PATH.exists():
            _HASH_CACHE = json.loads(_HASH_CACHE_PATH.read_text(encoding='utf-8'))
        else:
            _HASH_CACHE = {}
    except Exception:
        _HASH_CACHE = {}
    return _HASH_CACHE


def _save_hash_cache(cache: dict[str, dict[str, str | float]]):
    global _HASH_CACHE
    _HASH_CACHE = cache
    try:
        _HASH_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        _HASH_CACHE_PATH.write_text(json.dumps(cache, indent=2), encoding='utf-8')
    except Exception:
        pass


def _calc_file_hash(path_text: str) -> str:
    path = str(path_text or '')
    if not path or not os.path.isfile(path):
        return ''
    try:
        mtime = os.path.getmtime(path)
    except Exception:
        mtime = 0
    key = os.path.basename(path)
    cache = _load_hash_cache()
    record = cache.get(key)
    if record and record.get('mtime') == mtime and record.get('hash'):
        return str(record['hash'])

    sha256_hash = hashlib.sha256()
    with open(path, 'rb') as f:
        for byte_block in iter(lambda: f.read(1024 * 1024), b''):
            sha256_hash.update(byte_block)
    value = sha256_hash.hexdigest()[:10]
    cache[key] = {'hash': value, 'mtime': mtime}
    _save_hash_cache(cache)
    return value


def _find_full_path_any(model_name: str, categories: list[str]) -> str:
    name = str(model_name or '').strip()
    if not name:
        return ''
    for category in categories:
        try:
            full = folder_paths.get_full_path(category, name)
            if full:
                return full
        except Exception:
            pass
    # Fallback manual join against known folders for the category.
    for category in categories:
        try:
            for folder in folder_paths.get_folder_paths(category):
                candidate = os.path.join(folder, name)
                if os.path.isfile(candidate):
                    return candidate
        except Exception:
            pass
    return ''


def _workflow_nodes_and_links(extra_pnginfo) -> tuple[dict[str, dict], list[list[Any]], dict[str, list[tuple[str, int, int]]]]:
    workflow = extra_pnginfo.get('workflow') if isinstance(extra_pnginfo, dict) else None
    if not isinstance(workflow, dict):
        return {}, [], {}
    nodes = {str(node.get('id')): node for node in workflow.get('nodes', []) if isinstance(node, dict) and node.get('id') is not None}
    links = workflow.get('links', []) if isinstance(workflow.get('links', []), list) else []
    incoming: dict[str, list[tuple[str, int, int]]] = {}
    for link in links:
        try:
            _lid, src_node, src_slot, dst_node, dst_slot, _dtype = link
            incoming.setdefault(str(dst_node), []).append((str(src_node), int(src_slot), int(dst_slot)))
        except Exception:
            continue
    return nodes, links, incoming


def _upstream_distances(start_id: str, incoming: dict[str, list[tuple[str, int, int]]]) -> dict[str, int]:
    distances: dict[str, int] = {str(start_id): 0}
    queue = [str(start_id)]
    while queue:
        nid = queue.pop(0)
        dist = distances[nid]
        for src_node, _src_slot, _dst_slot in incoming.get(nid, []):
            if src_node not in distances or dist + 1 < distances[src_node]:
                distances[src_node] = dist + 1
                queue.append(src_node)
    return distances


def _first_string_widget(node: dict) -> str:
    values = node.get('widgets_values', [])
    if isinstance(values, list):
        for value in values:
            if isinstance(value, str) and value.strip():
                return value.strip()
    return ''


def _extract_model_name_from_node(node: dict) -> str:
    node_type = str(node.get('type') or '')
    values = node.get('widgets_values', []) if isinstance(node.get('widgets_values'), list) else []
    if node_type in (
        "UNETLoader",
        "CheckpointLoaderSimple",
        "CheckpointLoader",
        "UNETLoaderGGUF",
        "SOLoaderCoreEngine",
    ):
        return str(values[0]).strip() if values else ""
    return _first_string_widget(node)


def _auto_detect_base_model(extra_pnginfo, unique_id=None) -> tuple[str, str]:
    nodes, _links, incoming = _workflow_nodes_and_links(extra_pnginfo)
    if not nodes:
        return '', ''
    start_id = str(unique_id) if unique_id is not None else ''
    if start_id and start_id in nodes:
        distances = _upstream_distances(start_id, incoming)
    else:
        distances = {nid: 999999 for nid in nodes.keys()}

    candidates = []
    for nid, node in nodes.items():
        if str(node.get('type') or '') in (
            'UNETLoader',
            'CheckpointLoaderSimple',
            'CheckpointLoader',
            'UNETLoaderGGUF',
            'SOLoaderCoreEngine',
        ):
            candidates.append((distances.get(nid, 999999), nid, node))
    if not candidates:
        return '', ''
    candidates.sort(key=lambda item: item[0])
    selected = candidates[0][2]
    model_name = _extract_model_name_from_node(selected)
    model_path = _find_full_path_any(model_name, ['diffusion_models', 'unet', 'checkpoints'])
    return model_name, model_path


def _parse_applied_lora_entries(applied_loras: str) -> list[dict[str, str]]:
    text = str(applied_loras or '').strip()
    if not text:
        return []
    entries: list[dict[str, str]] = []
    for chunk in re.split(r'[\n;,]+', text):
        item = chunk.strip()
        if not item:
            continue

        if item.startswith('<lora:') and item.endswith('>'):
            body = item[6:-1]
            parts = body.rsplit(':', 1)
            name = parts[0].strip()
            weight = parts[1].strip() if len(parts) == 2 else '1'
            raw = name
        else:
            raw = item
            weight = '1'
            name_part = item
            if '@' in item:
                name_part, weight = item.rsplit('@', 1)
            elif '|' in item:
                name_part, weight = item.rsplit('|', 1)
            elif re.search(r':\s*-?\d+(?:\.\d+)?\s*$', item):
                split_parts = re.split(r':\s*(-?\d+(?:\.\d+)?)\s*$', item)
                if len(split_parts) >= 3:
                    name_part = split_parts[0]
                    weight = split_parts[1]
            name = Path(name_part.strip()).stem or name_part.strip()
            name = name.replace('.safetensors', '').strip()

        raw_path_like = raw.strip()
        file_name = raw_path_like
        if '@' in file_name:
            file_name = file_name.rsplit('@', 1)[0]
        file_name = file_name.strip()
        if not file_name.lower().endswith('.safetensors'):
            file_name_with_ext = file_name + '.safetensors'
        else:
            file_name_with_ext = file_name
        full_path = _find_full_path_any(file_name_with_ext, ['loras']) or _find_full_path_any(file_name, ['loras'])
        entries.append({
            'name': name,
            'weight': str(weight).strip() or '1',
            'raw': raw_path_like,
            'filename': file_name_with_ext,
            'path': full_path,
        })
    return entries


def _pretty_sampler_name(sampler: str, scheduler: str) -> str:
    sampler_value = str(sampler or '').strip()
    scheduler_value = str(scheduler or '').strip()
    if not sampler_value:
        return ''
    # Conservative choice: keep close to what Civitai expects without inventing names.
    if scheduler_value and scheduler_value not in ('', 'normal'):
        return sampler_value
    return sampler_value


def _build_civitai_fields(generation_meta: dict[str, Any], base_model_name: str, base_model_hash: str, width: int, height: int, seed: int, applied_loras: str) -> dict[str, str]:
    positive = str(generation_meta.get('positive_prompt', '') or '').strip()
    negative = str(generation_meta.get('negative_prompt', '') or '').strip()

    lora_entries = _parse_applied_lora_entries(applied_loras)
    lora_tags = ' '.join([f"<lora:{entry['name']}:{entry['weight']}>" for entry in lora_entries if entry.get('name')])
    if lora_tags and lora_tags not in positive:
        positive = (positive + '\n' + lora_tags).strip() if positive else lora_tags

    seed_value = generation_meta.get('seed_used', seed)
    width_value = generation_meta.get('width', width)
    height_value = generation_meta.get('height', height)
    sampler = _pretty_sampler_name(generation_meta.get('sampler_name', ''), generation_meta.get('scheduler', ''))
    steps = generation_meta.get('steps', '')
    cfg = generation_meta.get('cfg', '')
    denoise = generation_meta.get('denoise', '')
    vae_name_raw = str(generation_meta.get('vae_name', '') or '').strip()
    vae_name = Path(vae_name_raw).stem if vae_name_raw else ''
    vae_path = _find_full_path_any(vae_name_raw, ['vae']) if vae_name_raw else ''
    vae_hash = _calc_file_hash(vae_path) if vae_path else ''
    shift = generation_meta.get('shift', '')

    fields: dict[str, str] = {}
    if positive:
        fields['Positive prompt'] = positive
    if negative:
        fields['Negative prompt'] = negative
    if steps != '':
        fields['Steps'] = str(steps)
    if sampler:
        fields['Sampler'] = sampler
    if cfg != '':
        fields['CFG scale'] = str(cfg)
    if seed_value != '':
        fields['Seed'] = str(seed_value)
    if width_value and height_value:
        fields['Size'] = f'{width_value}x{height_value}'
    if base_model_name:
        fields['Model'] = Path(str(base_model_name)).stem
    if base_model_hash:
        fields['Model hash'] = base_model_hash
    if vae_name:
        fields['VAE'] = vae_name
    if vae_hash:
        fields['VAE hash'] = vae_hash
    try:
        if denoise != '' and float(denoise) != 1.0:
            fields['Denoising strength'] = str(denoise)
    except Exception:
        pass
    if shift != '':
        fields['Model shift'] = str(shift)

    lora_hash_pairs = []
    hashes: dict[str, str] = {}
    if base_model_hash:
        hashes['model'] = base_model_hash
    if vae_hash:
        hashes['vae'] = vae_hash

    for entry in lora_entries:
        h = _calc_file_hash(entry.get('path', '')) if entry.get('path') else ''
        name = entry.get('name', '')
        if h and name:
            lora_hash_pairs.append(f'{name}: {h}')
            hashes[f'lora:{name}'] = h
    if lora_hash_pairs:
        fields['Lora hashes'] = '"' + ', '.join(lora_hash_pairs) + '"'
    if hashes:
        fields['Hashes'] = json.dumps(hashes)

    return fields


def _parameters_from_civitai_fields(fields: dict[str, str]) -> str:
    if not fields:
        return ''
    pos = str(fields.get('Positive prompt', '') or '').strip().replace('\n', ' ')
    neg = str(fields.get('Negative prompt', '') or '').strip().replace('\n', ' ')
    lines = [pos] if pos else []
    if neg:
        lines.append(f'Negative prompt: {neg}')
    detail = []
    for key, value in fields.items():
        if key in ('Positive prompt', 'Negative prompt'):
            continue
        val = '' if value is None else str(value).strip().replace('\n', ' ')
        if val:
            detail.append(f'{key}: {val}')
    if detail:
        lines.append(', '.join(detail))
    return '\n'.join(lines)


class SOOutputBuilderSave:
    @classmethod
    def INPUT_TYPES(cls):
        return {
            'required': {
                'images': ('IMAGE',),
                'output_root': ('STRING', {'default': '_SickOllie_Art', 'multiline': False, 'tooltip': 'Root output folder relative to ComfyUI output.'}),
                'subfolder_literal': ('STRING', {'default': '', 'multiline': False}),
                'subfolder_var_1': (VARIABLE_CHOICES, {'default': 'clean_name'}),
                'subfolder_var_2': (VARIABLE_CHOICES, {'default': NONE}),
                'subfolder_var_3': (VARIABLE_CHOICES, {'default': NONE}),
                'subfolder_var_4': (VARIABLE_CHOICES, {'default': NONE}),
                'subfolder_delimiter': ('STRING', {'default': '_', 'multiline': False}),
                'filename_literal': ('STRING', {'default': '', 'multiline': False}),
                'filename_var_1': (VARIABLE_CHOICES, {'default': 'raw_stem'}),
                'filename_var_2': (VARIABLE_CHOICES, {'default': 'model_name'}),
                'filename_var_3': (VARIABLE_CHOICES, {'default': 'time_hhmmss'}),
                'filename_var_4': (VARIABLE_CHOICES, {'default': NONE}),
                'filename_var_5': (VARIABLE_CHOICES, {'default': NONE}),
                'filename_var_6': (VARIABLE_CHOICES, {'default': NONE}),
                'filename_delimiter': ('STRING', {'default': '_', 'multiline': False}),
                'extension': (IMAGE_FORMATS, {'default': 'png'}),
                'quality': ('INT', {'default': 95, 'min': 1, 'max': 100, 'step': 1, 'tooltip': 'Used for jpg/webp quality. PNG ignores this.'}),
                'counter_digits': ('INT', {'default': 5, 'min': 1, 'max': 10, 'step': 1}),
                'save_prompt_json': ('BOOLEAN', {'default': True, 'tooltip': 'Embed Comfy prompt JSON metadata.'}),
                'save_workflow_json': ('BOOLEAN', {'default': True, 'tooltip': 'Embed workflow JSON metadata for reload and Civitai parsing.'}),
                'save_civitai_parameters': ('BOOLEAN', {'default': True, 'tooltip': 'Embed a Civitai-readable parameters text block.'}),
                'clean_name': ('STRING', {'default': '', 'multiline': False}),
                'raw_stem': ('STRING', {'default': '', 'multiline': False}),
                'model_name': ('STRING', {'default': '', 'multiline': False, 'tooltip': 'Connect a model name string here if desired.'}),
                'seed': ('INT', {'default': 0, 'min': -1125899906842624, 'max': 1125899906842624, 'step': 1}),
                'prompt_index': ('INT', {'default': 0, 'min': -2147483648, 'max': 2147483647, 'step': 1}),
                'outfit_index': ('INT', {'default': 0, 'min': -2147483648, 'max': 2147483647, 'step': 1}),
                'scene_index': ('INT', {'default': 0, 'min': -2147483648, 'max': 2147483647, 'step': 1}),
                'prompt_file': ('STRING', {'default': '', 'multiline': False}),
                'outfit_file': ('STRING', {'default': '', 'multiline': False}),
                'scene_file': ('STRING', {'default': '', 'multiline': False}),
                'saved_path': ('STRING', {'default': '', 'multiline': True, 'dynamicPrompts': False, 'tooltip': 'Read-only display of the most recent save path.'}),
            },
            'optional': {
                'generation_info': ('STRING', {'forceInput': True}),
                'applied_loras': ('STRING', {'forceInput': True}),
            },
            'hidden': {
                'prompt': 'PROMPT',
                'extra_pnginfo': 'EXTRA_PNGINFO',
                'unique_id': 'UNIQUE_ID',
            }
        }

    RETURN_TYPES = ('IMAGE', 'STRING', 'STRING', 'STRING')
    RETURN_NAMES = ('images', 'save_path', 'subfolder', 'filename_prefix')
    FUNCTION = 'save_images'
    OUTPUT_NODE = True
    CATEGORY = 'Sick Ollie/Output'
    DESCRIPTION = 'Builds output folders and filenames from dropdown-selected variables, auto-detects upstream model resources, hashes them, and saves images with Comfy metadata plus Civitai-style parameters.'
    SEARCH_ALIASES = ['output builder', 'save with metadata', 'filename builder', 'civitai metadata save']

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float('nan')

    def save_images(self, images, output_root, subfolder_literal, subfolder_var_1, subfolder_var_2, subfolder_var_3, subfolder_var_4,
                    subfolder_delimiter, filename_literal, filename_var_1, filename_var_2, filename_var_3, filename_var_4, filename_var_5, filename_var_6,
                    filename_delimiter, extension, quality, counter_digits, save_prompt_json, save_workflow_json, save_civitai_parameters,
                    clean_name, raw_stem, model_name, seed, prompt_index, outfit_index, scene_index,
                    prompt_file, outfit_file, scene_file, saved_path, generation_info='', applied_loras='',
                    prompt=None, extra_pnginfo=None, unique_id=None):
        auto_model_name_raw, auto_model_path = _auto_detect_base_model(extra_pnginfo, unique_id=unique_id)
        resolved_model_name = str(model_name or '').strip() or (Path(auto_model_name_raw).stem if auto_model_name_raw else '')
        context = _context_values(clean_name=clean_name, raw_stem=raw_stem, model_name=resolved_model_name, seed=seed,
                                  prompt_index=prompt_index, outfit_index=outfit_index, scene_index=scene_index,
                                  prompt_file=prompt_file, outfit_file=outfit_file, scene_file=scene_file)
        subfolder_name = _build_segment(subfolder_literal, subfolder_delimiter,
                                        [subfolder_var_1, subfolder_var_2, subfolder_var_3, subfolder_var_4], context)
        filename_prefix = _build_segment(filename_literal, filename_delimiter,
                                         [filename_var_1, filename_var_2, filename_var_3, filename_var_4, filename_var_5, filename_var_6], context)
        if not filename_prefix:
            filename_prefix = 'image'
        root_clean = str(output_root).replace('\\', '/').strip().strip('/')
        relative_prefix = '/'.join([part for part in [root_clean, subfolder_name, filename_prefix] if part])

        # Determine save path via Comfy's helper so numbering behavior matches the ecosystem.
        image_batches = _normalize_image_batches(images)
        if not image_batches:
            raise ValueError('No image data was provided to Output Builder + Save.')

        first_pil = _tensor_to_pil(image_batches[0])
        width, height = first_pil.size
        full_output_folder, used_filename, counter, subfolder, _ = folder_paths.get_save_image_path(relative_prefix, folder_paths.get_output_directory(), width, height)

        results = []
        last_path = ''
        generation_meta = _parse_generation_info(generation_info, extra_pnginfo=extra_pnginfo)
        base_model_hash = _calc_file_hash(auto_model_path) if auto_model_path else ''
        civitai_fields: dict[str, str] = {}
        parameters_text = ''
        if bool(save_civitai_parameters):
            civitai_fields = _build_civitai_fields(generation_meta, auto_model_name_raw or resolved_model_name, base_model_hash, width, height, seed, applied_loras)
            parameters_text = _parameters_from_civitai_fields(civitai_fields)
        metadata_png = _to_pnginfo(prompt, extra_pnginfo, bool(save_prompt_json), bool(save_workflow_json), parameters_text, civitai_fields)
        metadata_exif = _to_exif_comment(prompt, extra_pnginfo, bool(save_prompt_json), bool(save_workflow_json), parameters_text, civitai_fields)

        ext = str(extension).lower().strip('.')
        for batch_number, image in enumerate(image_batches):
            pil = first_pil if batch_number == 0 else _tensor_to_pil(image)
            file_name = f"{used_filename}_{counter:0{int(counter_digits)}d}.{ext}"
            out_path = os.path.join(full_output_folder, file_name)

            if ext == 'png':
                pil.save(out_path, pnginfo=metadata_png, compress_level=4)
            elif ext == 'jpg':
                pil = pil.convert('RGB')
                pil.save(out_path, quality=int(quality), exif=metadata_exif)
            elif ext == 'webp':
                pil.save(out_path, quality=int(quality), exif=metadata_exif)
            else:
                pil.save(out_path)

            results.append({'filename': file_name, 'subfolder': subfolder, 'type': 'output'})
            last_path = out_path
            counter += 1

        # Persist the resolved path string into workflow metadata so the read-only field survives reload.
        if isinstance(extra_pnginfo, dict):
            workflow = extra_pnginfo.get('workflow')
            if isinstance(workflow, dict):
                for node in workflow.get('nodes', []):
                    if str(node.get('id')) == str(unique_id):
                        props = node.setdefault('properties', {})
                        props['so_saved_output_path'] = last_path
                        if resolved_model_name:
                            props['so_detected_model_name'] = resolved_model_name
                        if auto_model_path:
                            props['so_detected_model_path'] = auto_model_path
                        if base_model_hash:
                            props['so_detected_model_hash'] = base_model_hash
                        if parameters_text:
                            props['so_last_parameters_text'] = parameters_text
                        break

        return {'ui': {'images': results, 'saved_path': [last_path]}, 'result': (images, last_path, subfolder_name, filename_prefix)}


NODE_CLASS_MAPPINGS = {'SOOutputBuilderSave': SOOutputBuilderSave}
NODE_DISPLAY_NAME_MAPPINGS = {'SOOutputBuilderSave': 'Output Core'}
