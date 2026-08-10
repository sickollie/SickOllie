from __future__ import annotations

import math
import random
import json
from typing import Any

import torch
import folder_paths
import comfy.sd
import comfy.sample
import comfy.samplers
import comfy.utils
import comfy.model_management
import latent_preview


RESOLUTION_MODES = ["custom", "preset"]
SEED_MAX = 1125899906842624
ASPECT_PRESETS = [
    "1:1 (Square)",
    "2:3 (Portrait)",
    "3:4 (Portrait Standard)",
    "4:5 (Portrait Tall)",
    "9:16 (Portrait Phone)",
    "4:3 (Landscape Standard)",
    "3:2 (Landscape)",
    "16:9 (Widescreen)",
]
ASPECT_VALUES = {
    "1:1 (Square)": (1.0, 1.0),
    "2:3 (Portrait)": (2.0, 3.0),
    "3:4 (Portrait Standard)": (3.0, 4.0),
    "4:5 (Portrait Tall)": (4.0, 5.0),
    "9:16 (Portrait Phone)": (9.0, 16.0),
    "4:3 (Landscape Standard)": (4.0, 3.0),
    "3:2 (Landscape)": (3.0, 2.0),
    "16:9 (Widescreen)": (16.0, 9.0),
}
CLIP_TYPES = ["krea2", "sd3", "stable_diffusion", "stable_cascade", "pixart", "flux", "default"]
CLIP_DEVICES = ["default", "cpu", "gpu"]


def _round_to_multiple(value: int | float, multiple: int) -> int:
    m = max(1, int(multiple))
    rounded = int(round(float(value) / m) * m)
    return max(m, rounded)


def _resolve_dimensions(resolution_mode: str, custom_width: int, custom_height: int, aspect_preset: str, megapixels: float, multiple: int):
    if str(resolution_mode) == 'preset':
        w_ratio, h_ratio = ASPECT_VALUES.get(aspect_preset, ASPECT_VALUES[ASPECT_PRESETS[2]])
        total_pixels = max(0.05, float(megapixels)) * 1_000_000.0
        width = math.sqrt(total_pixels * (w_ratio / h_ratio))
        height = width * (h_ratio / w_ratio)
        return _round_to_multiple(width, multiple), _round_to_multiple(height, multiple)
    return max(16, int(custom_width)), max(16, int(custom_height))


def _prepare_empty_latent(batch_size: int, width: int, height: int):
    latent = torch.zeros(
        [max(1, int(batch_size)), 16, height // 8, width // 8],
        device=comfy.model_management.intermediate_device(),
    )
    return {"samples": latent}


def _apply_aura_shift(model, shift: float):
    try:
        from comfy_extras.nodes_model_advanced import ModelSamplingAuraFlow
        aura = ModelSamplingAuraFlow()
        method = getattr(aura, 'patch_aura', None)
        if callable(method):
            result = method(model, float(shift))
            if isinstance(result, tuple) and result:
                return result[0]
            if result is not None:
                return result
    except Exception as error:
        print(f'[Sick Ollie Generation Pipeline] AuraFlow shift patch failed, using model unchanged: {error}')
    return model


def _prepare_preview_callback(model, steps: int):
    try:
        return latent_preview.prepare_callback(model, int(steps))
    except TypeError:
        try:
            return latent_preview.prepare_callback(model, int(steps), None)
        except Exception:
            return None
    except Exception:
        return None


def _match_clip_type(name: str):
    requested = str(name or 'default').lower().strip()
    clip_type_enum = getattr(comfy.sd, 'CLIPType', None)
    if clip_type_enum is None:
        return None
    for attr in dir(clip_type_enum):
        if attr.lower() == requested:
            return getattr(clip_type_enum, attr)
    fallback_names = {
        'default': ['STABLE_DIFFUSION', 'SD1', 'SDXL', 'SD3'],
        'krea2': ['KREA2', 'SD3'],
        'sd3': ['SD3'],
        'stable_diffusion': ['STABLE_DIFFUSION', 'SD1', 'SDXL'],
        'stable_cascade': ['STABLE_CASCADE'],
        'pixart': ['PIXART'],
        'flux': ['FLUX'],
    }
    for candidate in fallback_names.get(requested, []):
        if hasattr(clip_type_enum, candidate):
            return getattr(clip_type_enum, candidate)
    for candidate in ['KREA2', 'SD3', 'STABLE_DIFFUSION']:
        if hasattr(clip_type_enum, candidate):
            return getattr(clip_type_enum, candidate)
    return None


def _build_clip_model_options(device_choice: str):
    choice = str(device_choice or 'default').lower().strip()
    if choice == 'default':
        return {}
    if choice == 'cpu':
        cpu = torch.device('cpu')
        return {'load_device': cpu, 'offload_device': cpu}
    if choice == 'gpu':
        dev = comfy.model_management.get_torch_device()
        return {'load_device': dev, 'offload_device': dev}
    return {}


class _ClipVaeCacheMixin:
    def __init__(self):
        self._clip_cache = None
        self._vae_cache = None

    def _load_clip(self, clip_name: str, clip_type_name: str, clip_device: str):
        clip_path = folder_paths.get_full_path_or_raise('text_encoders', clip_name)
        cache_key = (clip_path, str(clip_type_name), str(clip_device))
        if self._clip_cache is not None and self._clip_cache[0] == cache_key:
            return self._clip_cache[1]

        embeddings = folder_paths.get_folder_paths('embeddings')
        clip_type = _match_clip_type(clip_type_name)
        model_options = _build_clip_model_options(clip_device)

        clip = comfy.sd.load_clip(
            ckpt_paths=[clip_path],
            embedding_directory=embeddings,
            clip_type=clip_type,
            model_options=model_options,
        )
        self._clip_cache = (cache_key, clip)
        return clip

    def _load_vae(self, vae_name: str):
        vae_path = folder_paths.get_full_path_or_raise('vae', vae_name)
        if self._vae_cache is not None and self._vae_cache[0] == vae_path:
            return self._vae_cache[1]
        sd = comfy.utils.load_torch_file(vae_path)
        vae = comfy.sd.VAE(sd=sd)
        self._vae_cache = (vae_path, vae)
        return vae


class SOGenerationPipeline(_ClipVaeCacheMixin):
    @classmethod
    def INPUT_TYPES(cls):
        text_encoders = folder_paths.get_filename_list("text_encoders")
        vaes = folder_paths.get_filename_list("vae")

        preferred_clip = "qwen3vl_4b_fp8_scaled.safetensors"
        preferred_vae = "qwen_image_vae.safetensors"
        default_clip = preferred_clip if preferred_clip in text_encoders else (text_encoders[0] if text_encoders else "")
        default_vae = preferred_vae if preferred_vae in vaes else (vaes[0] if vaes else "")

        return {
            "required": {
                "model": ("MODEL",),
                "positive_text": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                        "forceInput": True,
                        "dynamicPrompts": False,
                    },
                ),
                "clip_name": (
                    text_encoders,
                    {
                        "default": default_clip,
                    },
                ),
                "clip_type": (
                    CLIP_TYPES,
                    {
                        "default": "krea2",
                    },
                ),
                "clip_device": (
                    CLIP_DEVICES,
                    {
                        "default": "default",
                    },
                ),
                "vae_name": (
                    vaes,
                    {
                        "default": default_vae,
                    },
                ),
                "resolution_mode": (
                    RESOLUTION_MODES,
                    {
                        "default": "preset",
                    },
                ),
                "custom_width": (
                    "INT",
                    {
                        "default": 1440,
                        "min": 16,
                        "max": 16384,
                        "step": 8,
                    },
                ),
                "custom_height": (
                    "INT",
                    {
                        "default": 1920,
                        "min": 16,
                        "max": 16384,
                        "step": 8,
                    },
                ),
                "aspect_preset": (
                    ASPECT_PRESETS,
                    {
                        "default": "3:4 (Portrait Standard)",
                    },
                ),
                "megapixels": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.05,
                        "max": 64.0,
                        "step": 0.05,
                    },
                ),
                "batch_size": (
                    "INT",
                    {
                        "default": 1,
                        "min": 1,
                        "max": 64,
                        "step": 1,
                    },
                ),
                "steps": (
                    "INT",
                    {
                        "default": 9,
                        "min": 1,
                        "max": 10000,
                        "step": 1,
                    },
                ),
                "cfg": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.0,
                        "max": 100.0,
                        "step": 0.1,
                    },
                ),
                "sampler_name": (
                    comfy.samplers.KSampler.SAMPLERS,
                    {
                        "default": "euler",
                    },
                ),
                "scheduler": (
                    comfy.samplers.KSampler.SCHEDULERS,
                    {
                        "default": "beta",
                    },
                ),
                "denoise": (
                    "FLOAT",
                    {
                        "default": 1.0,
                        "min": 0.0,
                        "max": 1.0,
                        "step": 0.01,
                    },
                ),
                "shift": (
                    "FLOAT",
                    {
                        "default": 1.25,
                        "min": -100.0,
                        "max": 100.0,
                        "step": 0.01,
                    },
                ),
                "seed_value": (
                    "INT",
                    {
                        "default": -1,
                        "min": -1,
                        "max": SEED_MAX,
                        "step": 1,
                        "label": "seed",
                        "tooltip": "-1 means randomize independently for each run.",
                    },
                ),
            },
            "optional": {
                "positive_conditioning": (
                    "CONDITIONING",
                    {
                        "tooltip": "Optional external positive conditioning. When connected, it overrides Generation Core's internal positive-text encoding. Useful for image-edit encoders that attach reference-image conditioning.",
                    },
                ),
                "negative_conditioning": (
                    "CONDITIONING",
                    {
                        "tooltip": "Optional external negative conditioning. When unconnected, Generation Core keeps its existing empty-negative behavior.",
                    },
                ),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
                "unique_id": "UNIQUE_ID",
            },
        }

    RETURN_TYPES = ('LATENT', 'VAE')
    RETURN_NAMES = ('samples', 'vae')
    FUNCTION = 'run_pipeline'
    CATEGORY = "Sick Ollie/Studio"
    DESCRIPTION = 'Stable Krea2 generation core with internal CLIP and VAE loading, optional external CONDITIONING overrides for image-edit/reference encoders, fixed empty negative conditioning fallback, live preview, and persistent seed controls.'
    SEARCH_ALIASES = ['generation pipeline', 'krea2 pipeline', 'clip vae sampler', 'one box render']

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        return float('nan')

    def run_pipeline(
        self,
        model,
        positive_text,
        clip_name,
        clip_type,
        clip_device,
        vae_name,
        resolution_mode,
        custom_width,
        custom_height,
        aspect_preset,
        megapixels,
        batch_size,
        steps,
        cfg,
        sampler_name,
        scheduler,
        denoise,
        shift,
        seed_value,
        positive_conditioning=None,
        negative_conditioning=None,
        prompt=None,
        extra_pnginfo=None,
        unique_id=None,
    ):
        seed_used = int(seed_value)
        if seed_used == -1:
            seed_used = random.randint(0, SEED_MAX)
        else:
            seed_used = max(0, min(int(seed_used), SEED_MAX))
        width, height = _resolve_dimensions(
            resolution_mode,
            custom_width,
            custom_height,
            aspect_preset,
            megapixels,
            8,
        )

        # Keep the existing text-to-conditioning path as the default, but allow
        # edit/reference encoders to supply CONDITIONING directly. This is
        # intentionally an override rather than a replacement so all existing
        # workflows behave exactly as before when the sockets are unconnected.
        clip = None
        if positive_conditioning is None or negative_conditioning is None:
            clip = self._load_clip(clip_name, clip_type, clip_device)

        if positive_conditioning is not None:
            positive = positive_conditioning
        else:
            positive = clip.encode_from_tokens_scheduled(
                clip.tokenize(str(positive_text))
            )

        if negative_conditioning is not None:
            negative = negative_conditioning
        else:
            negative = clip.encode_from_tokens_scheduled(
                clip.tokenize("")
            )

        latent = _prepare_empty_latent(batch_size, width, height)
        latent_image = latent['samples']
        latent_image = comfy.sample.fix_empty_latent_channels(model, latent_image)

        shifted_model = _apply_aura_shift(model, float(shift))

        batch_inds = latent['batch_index'] if 'batch_index' in latent else None
        noise = comfy.sample.prepare_noise(latent_image, seed_used, batch_inds)
        noise_mask = latent['noise_mask'] if 'noise_mask' in latent else None
        callback = _prepare_preview_callback(shifted_model, int(steps))
        disable_pbar = not getattr(comfy.utils, 'PROGRESS_BAR_ENABLED', True)

        samples_tensor = comfy.sample.sample(
            shifted_model,
            noise,
            int(steps),
            float(cfg),
            sampler_name,
            scheduler,
            positive,
            negative,
            latent_image,
            denoise=float(denoise),
            disable_noise=False,
            start_step=None,
            last_step=None,
            force_full_denoise=False,
            noise_mask=noise_mask,
            callback=callback,
            disable_pbar=disable_pbar,
            seed=seed_used,
        )

        latent_out = latent.copy()
        latent_out['samples'] = samples_tensor

        vae = self._load_vae(vae_name)

        generation_info_obj = {
            'positive_prompt': str(positive_text or ''),
            'negative_prompt': '',
            'clip_name': str(clip_name or ''),
            'clip_type': str(clip_type or ''),
            'clip_device': str(clip_device or ''),
            'vae_name': str(vae_name or ''),
            'resolution_mode': str(resolution_mode or ''),
            'width': int(width),
            'height': int(height),
            'batch_size': int(batch_size),
            'seed_used': int(seed_used),
            'steps': int(steps),
            'cfg': float(cfg),
            'sampler_name': str(sampler_name or ''),
            'scheduler': str(scheduler or ''),
            'denoise': float(denoise),
            'shift': float(shift),
            'positive_conditioning_source': 'external' if positive_conditioning is not None else 'internal_text',
            'negative_conditioning_source': 'external' if negative_conditioning is not None else 'internal_empty',
        }
        generation_info = json.dumps(generation_info_obj, ensure_ascii=False)

        if isinstance(extra_pnginfo, dict):
            extra_pnginfo['so_generation_seed_used'] = seed_used
            extra_pnginfo['so_generation_width'] = width
            extra_pnginfo['so_generation_height'] = height
            extra_pnginfo['so_generation_shift'] = float(shift)
            extra_pnginfo['so_generation_clip_name'] = str(clip_name)
            extra_pnginfo['so_generation_vae_name'] = str(vae_name)
            extra_pnginfo['so_generation_info'] = generation_info_obj
            workflow = extra_pnginfo.get('workflow')
            if isinstance(workflow, dict):
                for node in workflow.get('nodes', []):
                    if str(node.get('id')) == str(unique_id):
                        props = node.setdefault('properties', {})
                        props['so_last_used_seed'] = seed_used
                        props['so_last_width'] = width
                        props['so_last_height'] = height
                        break

        ui_payload = {
            'seed_used': [seed_used],
            'width': [width],
            'height': [height],
            'generation_info': [generation_info],
        }
        return {'ui': ui_payload, 'result': (latent_out, vae)}


NODE_CLASS_MAPPINGS = {'SOGenerationPipelineStudio': SOGenerationPipeline}
NODE_DISPLAY_NAME_MAPPINGS = {'SOGenerationPipelineStudio': 'Generation Core'}
