from __future__ import annotations

import importlib.util
import json
from io import BytesIO
import sys
import types
import unittest
from pathlib import Path

from PIL import Image, PngImagePlugin


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = types.ModuleType("sickollie_recipe_test")
PACKAGE.__path__ = [str(ROOT)]
sys.modules.setdefault("sickollie_recipe_test", PACKAGE)
SPEC = importlib.util.spec_from_file_location("sickollie_recipe_test.solo_recipe_catalog", ROOT / "solo_recipe_catalog.py")
assert SPEC and SPEC.loader
recipe_module = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = recipe_module
SPEC.loader.exec_module(recipe_module)


class RecipeImportTests(unittest.TestCase):
    def test_classic_sick_ollie_workflow_maps_to_all_studio_sections(self) -> None:
        workflow = {
            "nodes": [
                {"type": "SOLoaderCoreEngine", "widgets_values": ["model.safetensors", "default", "Characters/Rory", "[All epochs]", True, "Characters/Rory/rory.safetensors", 0.85]},
                {"type": "SOPromptLogEngine", "widgets_values": ["manual", "Portrait of NAME wearing OUTFIT", "[None]", "increment", 0]},
                {"type": "SOGenerationPipeline", "widgets_values": ["clip.safetensors", "krea2", "default", "vae.safetensors", "custom", 1440, 1920, "3:4", 1, 1, 9, 1, "euler", "beta", 1, 1.25, 12345]},
                {"type": "SOOutputBuilderSave", "widgets_values": ["_SickOllie", "", "clean_name", "[None]", "[None]", "[None]", "_", "", "raw_stem"]},
            ]
        }
        recipe = recipe_module._legacy_to_studio_recipe(workflow)
        node_types = {node["type"] for node in recipe["nodes"]}
        self.assertEqual(node_types, {recipe_module.STUDIO_LOADER, recipe_module.STUDIO_PROMPT, recipe_module.STUDIO_GENERATION, recipe_module.STUDIO_OUTPUT})
        self.assertEqual(recipe["migration"]["loras"][0]["name"], "Characters/Rory/rory.safetensors")
        self.assertIn("NAME", recipe_module._recipe_tokens(recipe))
        self.assertIn("OUTFIT", recipe_module._recipe_tokens(recipe))

    def test_runtime_metadata_overrides_random_seed_and_keeps_source_template(self) -> None:
        api = {
            "1": {"class_type": "KSampler", "inputs": {"seed": -1, "steps": 8, "cfg": 1.0, "sampler_name": "euler", "scheduler": "simple", "denoise": 1.0}},
            "2": {"class_type": "UNETLoader", "inputs": {"unet_name": "model.safetensors", "weight_dtype": "default"}},
            "3": {"class_type": "LoraLoaderModelOnly", "inputs": {"lora_name": "Characters/Rory/rory.safetensors", "strength_model": 0.8}},
            "4": {"class_type": recipe_module.STUDIO_PROMPT, "inputs": {"prompt_source": "log", "manual_prompt": "UNUSED FANTASY MANUAL PROMPT", "prompt_log_file": "prompts/portraits.txt", "prompt_mode": "increment", "prompt_index": 91, "scene_token": "SCENE", "scene_placement": "token", "scene_log_file": "scenes/unused.txt", "scene_mode": "randomize", "scene_index": 9}},
            "5": {"class_type": recipe_module.STUDIO_LOADER, "inputs": {"diffusion_model": "model.safetensors", "weight_dtype": "default", "secondary_lora_1": {"on": False, "lora": "unused.safetensors", "strength": 1.0}}},
        }
        structured = {
            "resolved": {
                "source_prompt": "Portrait of NAME wearing OUTFIT",
                "final_prompt": "Portrait of Rory wearing a jacket",
                "name": {"token": "NAME", "value": "Rory"},
                "prompt": {"source": "log", "file": "prompts/portraits.txt", "index": 7, "line": "Portrait of NAME wearing OUTFIT"},
                "outfit_a": {"used": True, "token": "OUTFIT", "line": "a jacket", "file": "outfits/jackets.txt", "index": 3, "placement": "token"},
                "scene": {"used": False, "token": "SCENE", "file": "scenes/unused.txt", "index": 9},
                "item": {"token": "BRAND", "value": "sick dolls"},
                "prefix": {"enabled": True, "text": "editorial"},
            },
            "generation": {"seed_used": 987654321, "steps": 9, "width": 1440, "height": 1920},
            "models": {"main_lora": {"file": "Characters/Rory/rory.safetensors", "strength": 0.8, "hash": "abc123"}},
        }
        recipe = recipe_module._curate_prompt_catalog_recipe(
            recipe_module._structured_metadata_overlay(recipe_module._api_to_studio_recipe(api), structured)
        )
        nodes = {node["type"]: {item["name"]: item["value"] for item in node["widgets"]} for node in recipe["nodes"]}
        self.assertEqual(nodes[recipe_module.STUDIO_GENERATION]["seed_value"], 987654321)
        self.assertEqual(set(nodes[recipe_module.STUDIO_GENERATION]), {"resolution_mode", "custom_width", "custom_height", "seed_value"})
        self.assertEqual(nodes[recipe_module.STUDIO_PROMPT]["prompt_source"], "manual")
        self.assertEqual(nodes[recipe_module.STUDIO_PROMPT]["manual_prompt"], "Portrait of NAME wearing OUTFIT")
        self.assertEqual(nodes[recipe_module.STUDIO_PROMPT]["prompt_log_file"], "prompts/portraits.txt")
        self.assertEqual(nodes[recipe_module.STUDIO_PROMPT]["prompt_mode"], "fixed")
        self.assertEqual(nodes[recipe_module.STUDIO_PROMPT]["outfit_mode_A"], "fixed")
        self.assertEqual(nodes[recipe_module.STUDIO_PROMPT]["item_value"], "sick dolls")
        self.assertEqual(nodes[recipe_module.STUDIO_PROMPT]["prefix_text"], "editorial")
        self.assertNotIn("scene_log_file", nodes[recipe_module.STUDIO_PROMPT])
        optional = {node["type"]: {item["name"]: item["value"] for item in node["widgets"]} for node in recipe["optional_nodes"]}
        self.assertEqual(optional[recipe_module.STUDIO_LOADER]["main_lora"], "Characters/Rory/rory.safetensors")
        self.assertNotIn("secondary_lora_1", optional[recipe_module.STUDIO_LOADER])
        self.assertEqual(recipe["summary"]["placeholders"][0]["value"], "Rory")

    def test_output_pixels_override_dormant_generic_latent_dimensions(self) -> None:
        payload = recipe_module._api_to_studio_recipe({
            "1": {"class_type": "EmptySD3LatentImage", "inputs": {"width": 1600, "height": 400, "batch_size": 1}},
            "2": {"class_type": "KSampler", "inputs": {"seed": 501909296804014, "steps": 9, "cfg": 1.0, "sampler_name": "euler", "scheduler": "beta", "denoise": 1.0}},
            "3": {"class_type": "CLIPTextEncode", "inputs": {"text": "portrait prompt"}},
        })
        payload = recipe_module._apply_resolved_dimensions(payload, None, (1048, 1400))
        payload = recipe_module._curate_prompt_catalog_recipe(payload)
        generation = next(node for node in payload["nodes"] if node["type"] == recipe_module.STUDIO_GENERATION)
        values = {item["name"]: item["value"] for item in generation["widgets"]}
        self.assertEqual((values["custom_width"], values["custom_height"]), (1048, 1400))
        self.assertEqual(values["seed_value"], 501909296804014)

    def test_preview_temp_png_runtime_fields_recover_resolved_indices_and_seed(self) -> None:
        resolved = {
            "schema_version": 4,
            "source_prompt": "Portrait of NAME wearing OUTFIT",
            "final_prompt": "Portrait of Rory wearing a jacket",
            "prompt": {"source": "log", "file": "prompts/portraits.txt", "index": 7, "count": 20, "line": "Portrait of NAME wearing OUTFIT"},
            "outfit_a": {"used": True, "token": "OUTFIT", "placement": "token", "file": "outfits/jackets.txt", "index": 3, "count": 10, "line": "a jacket"},
            "outfit_b": {"used": False},
            "outfit_c": {"used": False},
            "scene": {"used": False},
            "name": {"used": True, "token": "NAME", "value": "Rory"},
            "item": {"used": False},
            "prefix": {},
            "suffix": {},
        }
        generation = {
            "seed_used": 111, "width": 1440, "height": 1920, "steps": 9, "cfg": 1.0,
            "sampler_name": "euler", "scheduler": "beta", "denoise": 1.0,
            "clip_name": "clip.safetensors", "vae_name": "vae.safetensors",
        }
        info = PngImagePlugin.PngInfo()
        info.add_text("so_prompt_core_resolved", json.dumps(resolved))
        info.add_text("so_generation_info", json.dumps(generation))
        info.add_text("so_generation_seed_used", json.dumps(111))
        info.add_text("so_loader_core_diffusion_model", "model.safetensors")
        info.add_text("so_loader_core_weight_dtype", "default")
        info.add_text("so_loader_core_main_active", json.dumps(True))
        info.add_text("so_loader_core_main_file", "Characters/Rory/rory.safetensors")
        info.add_text("so_loader_core_main_strength", json.dumps(0.8))
        buffer = BytesIO()
        Image.new("RGB", (1440, 1920)).save(buffer, "PNG", pnginfo=info)

        recipe, preview = recipe_module._recipe_from_image_bytes(buffer.getvalue())
        self.assertEqual(preview.size, (1440, 1920))
        nodes = {node["type"]: {item["name"]: item["value"] for item in node["widgets"]} for node in recipe["nodes"]}
        self.assertEqual(nodes[recipe_module.STUDIO_PROMPT]["prompt_index"], 7)
        self.assertEqual(nodes[recipe_module.STUDIO_PROMPT]["outfit_index_A"], 3)
        self.assertEqual(nodes[recipe_module.STUDIO_GENERATION]["seed_value"], 111)
        optional = {node["type"]: {item["name"]: item["value"] for item in node["widgets"]} for node in recipe["optional_nodes"]}
        self.assertEqual(optional[recipe_module.STUDIO_LOADER]["main_lora"], "Characters/Rory/rory.safetensors")

    def test_preview_quick_save_uses_displayed_image_as_authority(self) -> None:
        current = {
            "schema": 4,
            "captured_at": "2026-08-16T20:00:00.000Z",
            "nodes": [
                {"type": recipe_module.STUDIO_PROMPT, "title": "Prompt used", "widgets": [
                    {"name": "prompt_source", "value": "manual"},
                    {"name": "manual_prompt", "value": "Portrait of NAME in OUTFIT"},
                    {"name": "prompt_log_file", "value": "prompts/portraits.txt"},
                    {"name": "prompt_mode", "value": "fixed"},
                    {"name": "prompt_index", "value": 8},
                    {"name": "outfit_log_file_A", "value": "outfits/test.txt"},
                    {"name": "outfit_mode_A", "value": "fixed"},
                    {"name": "outfit_index_A", "value": 4},
                ]},
                {"type": recipe_module.STUDIO_GENERATION, "title": "Dimensions & resolved seed", "widgets": [
                    {"name": "resolution_mode", "value": "custom"},
                    {"name": "custom_width", "value": 1440},
                    {"name": "custom_height", "value": 1920},
                    {"name": "seed_value", "value": 222},
                ]},
            ],
        }
        image = {
            "schema": 4,
            "imported_from_image": True,
            "migration": {"mode": "metadata_merge"},
            "nodes": [
                {"type": recipe_module.STUDIO_PROMPT, "title": "Prompt used", "widgets": [
                    {"name": "prompt_source", "value": "manual"},
                    {"name": "manual_prompt", "value": "Portrait of NAME in OUTFIT"},
                    {"name": "prompt_log_file", "value": "prompts/portraits.txt"},
                    {"name": "prompt_mode", "value": "fixed"},
                    {"name": "prompt_index", "value": 7},
                    {"name": "outfit_log_file_A", "value": "outfits/test.txt"},
                    {"name": "outfit_mode_A", "value": "fixed"},
                    {"name": "outfit_index_A", "value": 3},
                ]},
                {"type": recipe_module.STUDIO_GENERATION, "title": "Dimensions & resolved seed", "widgets": [
                    {"name": "resolution_mode", "value": "custom"},
                    {"name": "custom_width", "value": 1440},
                    {"name": "custom_height", "value": 1920},
                    {"name": "seed_value", "value": 111},
                ]},
            ],
        }
        recipe = recipe_module._preview_authoritative_recipe(current, image)
        nodes = {node["type"]: {item["name"]: item["value"] for item in node["widgets"]} for node in recipe["nodes"]}
        self.assertEqual(nodes[recipe_module.STUDIO_PROMPT]["prompt_index"], 7)
        self.assertEqual(nodes[recipe_module.STUDIO_PROMPT]["outfit_index_A"], 3)
        self.assertEqual(nodes[recipe_module.STUDIO_GENERATION]["seed_value"], 111)
        self.assertTrue(recipe["captured_from_preview"])
        self.assertEqual(recipe["captured_at"], current["captured_at"])
        self.assertNotIn("imported_from_image", recipe)
        self.assertNotIn("migration", recipe)

    def test_preview_thumbnail_verification_requires_recipe_match(self) -> None:
        saved = {
            "schema": 4,
            "nodes": [
                {"type": recipe_module.STUDIO_PROMPT, "title": "Prompt used", "widgets": [
                    {"name": "prompt_source", "value": "manual"},
                    {"name": "manual_prompt", "value": "Portrait of NAME"},
                    {"name": "prompt_log_file", "value": "prompts/portraits.txt"},
                    {"name": "prompt_mode", "value": "fixed"},
                    {"name": "prompt_index", "value": 7},
                ]},
                {"type": recipe_module.STUDIO_GENERATION, "title": "Dimensions & resolved seed", "widgets": [
                    {"name": "resolution_mode", "value": "custom"},
                    {"name": "custom_width", "value": 1440},
                    {"name": "custom_height", "value": 1920},
                    {"name": "seed_value", "value": 987654321},
                ]},
            ],
        }
        same = {**saved, "nodes": [dict(node, widgets=[dict(item) for item in node["widgets"]]) for node in saved["nodes"]]}
        matched, reason = recipe_module._preview_recipe_matches(saved, same)
        self.assertTrue(matched, reason)

        changed = {**same, "nodes": [dict(node, widgets=[dict(item) for item in node["widgets"]]) for node in same["nodes"]]}
        generation = next(node for node in changed["nodes"] if node["type"] == recipe_module.STUDIO_GENERATION)
        next(item for item in generation["widgets"] if item["name"] == "seed_value")["value"] = 123
        matched, reason = recipe_module._preview_recipe_matches(saved, changed)
        self.assertFalse(matched)
        self.assertIn("generation.seed_value", reason)


if __name__ == "__main__":
    unittest.main()
