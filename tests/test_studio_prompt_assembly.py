from __future__ import annotations

import importlib.util
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
MODULE_NAME = "sickollie_studio_prompt_assembly_test"


def _load_module():
    folder_paths = types.ModuleType("folder_paths")
    folder_paths.get_input_directory = lambda: tempfile.gettempdir()
    sys.modules["folder_paths"] = folder_paths

    spec = importlib.util.spec_from_file_location(MODULE_NAME, ROOT / "studio_prompt_core.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[MODULE_NAME] = module
    spec.loader.exec_module(module)
    return module


prompt_core = _load_module()


def _build(**overrides):
    values = {
        "prompt_source": "manual",
        "manual_prompt": "NAME wears OUTFIT. SCENE",
        "prompt_log_file": prompt_core.NO_FILE,
        "prompt_mode": "fixed",
        "prompt_index": 0,
        "outfit_token_A": "OUTFIT_A",
        "outfit_placement_A": "smart",
        "outfit_log_file_A": "outfits/a.txt",
        "outfit_mode_A": "fixed",
        "outfit_index_A": 0,
        "outfit_token_B": "OUTFIT_B",
        "outfit_placement_B": "off",
        "outfit_log_file_B": prompt_core.NO_FILE,
        "outfit_mode_B": "fixed",
        "outfit_index_B": 0,
        "outfit_token_C": "OUTFIT_C",
        "outfit_placement_C": "off",
        "outfit_log_file_C": prompt_core.NO_FILE,
        "outfit_mode_C": "fixed",
        "outfit_index_C": 0,
        "scene_token": "SCENE",
        "scene_placement": "smart",
        "scene_log_file": "scenes/a.txt",
        "scene_mode": "fixed",
        "scene_index": 0,
        "name_token": "NAME",
        "name_value": "Star",
        "item_token": "ITEM",
        "item_value": "",
        "prefix_enabled": False,
        "prefix_text": "",
        "suffix_enabled": False,
        "suffix_text": "",
        "prefix_suffix_separator": ", ",
        "cleanup_enabled": False,
        "cleanup_rules": "",
        "saved_prompt": "",
        "extra_pnginfo": {},
        "unique_id": "1",
    }
    values.update(overrides)

    def load_line(path, category, index):
        data = {
            ("outfits/a.txt", "outfit"): ("a glossy yellow jacket", 0, 1),
            ("scenes/a.txt", "scene"): ("inside a neon workshop", 0, 1),
        }
        return data.get((path, category), ("", 0, 0))

    with mock.patch.object(prompt_core, "_load_line", side_effect=load_line):
        return prompt_core.SOPromptLogEngine().build_prompt(**values), values["extra_pnginfo"]


class StudioPromptAssemblyTests(unittest.TestCase):
    def test_outfit_alias_and_braced_name_are_resolved(self) -> None:
        result, metadata = _build(manual_prompt="{NAME} wears OUTFIT. {SCENE}")
        self.assertEqual(
            result["result"][0],
            "Star wears a glossy yellow jacket. inside a neon workshop",
        )
        assembly = metadata["so_prompt_core_resolved"]
        self.assertEqual(assembly["outfit_a"]["action"], "replace")
        self.assertEqual(assembly["outfit_a"]["matched_tokens"], ["OUTFIT"])
        self.assertEqual(assembly["name"]["matched_tokens"], ["{NAME}"])

    def test_smart_mode_appends_when_no_placeholder_exists(self) -> None:
        result, metadata = _build(
            manual_prompt="A portrait of NAME.",
            scene_placement="off",
            scene_log_file=prompt_core.NO_FILE,
        )
        self.assertEqual(result["result"][0], "A portrait of Star. a glossy yellow jacket")
        self.assertEqual(metadata["so_prompt_core_resolved"]["outfit_a"]["action"], "append")

    def test_legacy_token_mode_waits_instead_of_appending(self) -> None:
        result, metadata = _build(
            manual_prompt="A portrait of NAME.",
            outfit_placement_A="token",
            scene_placement="off",
            scene_log_file=prompt_core.NO_FILE,
        )
        self.assertEqual(result["result"][0], "A portrait of Star.")
        outfit = metadata["so_prompt_core_resolved"]["outfit_a"]
        self.assertFalse(outfit["used"])
        self.assertEqual(outfit["action"], "missing_placeholder")

    def test_append_mode_removes_placeholder_before_appending(self) -> None:
        result, metadata = _build(
            manual_prompt="NAME in OUTFIT.",
            outfit_placement_A="append",
            scene_placement="off",
            scene_log_file=prompt_core.NO_FILE,
        )
        self.assertEqual(result["result"][0], "Star in. a glossy yellow jacket")
        self.assertEqual(metadata["so_prompt_core_resolved"]["outfit_a"]["action"], "append")

    def test_off_mode_removes_known_placeholder(self) -> None:
        result, metadata = _build(
            manual_prompt="NAME wears OUTFIT_B.",
            outfit_placement_A="off",
            outfit_log_file_A=prompt_core.NO_FILE,
            outfit_placement_B="off",
            scene_placement="off",
            scene_log_file=prompt_core.NO_FILE,
        )
        self.assertEqual(result["result"][0], "Star wears.")
        self.assertEqual(metadata["so_prompt_core_resolved"]["outfit_b"]["action"], "remove")

    def test_plain_alias_does_not_match_a_longer_placeholder_prefix(self) -> None:
        replaced, matches, count = prompt_core._replace_aliases(
            "OUTFIT_A then OUTFIT",
            prompt_core._token_candidates("OUTFIT"),
            "dress",
        )
        self.assertEqual(replaced, "OUTFIT_A then dress")
        self.assertEqual(matches, ["OUTFIT"])
        self.assertEqual(count, 1)

    def test_trigger_smart_mode_prepends_loader_value(self) -> None:
        result, metadata = _build(
            manual_prompt="A portrait of NAME.",
            outfit_placement_A="off", scene_placement="off", scene_log_file=prompt_core.NO_FILE,
            trigger_placement="smart", main_trigger="Gadget & the Gadgetinis",
        )
        self.assertEqual(result["result"][0], "Gadget & the Gadgetinis, A portrait of Star.")
        self.assertEqual(metadata["so_prompt_core_resolved"]["trigger"]["action"], "prepend")

    def test_trigger_placeholder_only_does_not_append(self) -> None:
        result, metadata = _build(
            manual_prompt="A portrait of NAME.", outfit_placement_A="off", scene_placement="off",
            scene_log_file=prompt_core.NO_FILE, trigger_placement="token", main_trigger="shyla",
        )
        self.assertEqual(result["result"][0], "A portrait of Star.")
        self.assertEqual(metadata["so_prompt_core_resolved"]["trigger"]["action"], "missing_placeholder")

    def test_trigger_override_beats_loader_value(self) -> None:
        result, metadata = _build(
            manual_prompt="TRIGGER, NAME", outfit_placement_A="off", scene_placement="off",
            scene_log_file=prompt_core.NO_FILE, trigger_placement="token", main_trigger="wrong", trigger_override="chosen",
        )
        self.assertEqual(result["result"][0], "chosen, Star")
        self.assertEqual(metadata["so_prompt_core_resolved"]["trigger"]["source"], "override")


if __name__ == "__main__":
    unittest.main()
