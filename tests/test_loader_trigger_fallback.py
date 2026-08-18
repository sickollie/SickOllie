from __future__ import annotations

import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
PACKAGE_NAME = "sickollie_loader_test_pack"


def _install_runtime_stubs() -> None:
    package = types.ModuleType(PACKAGE_NAME)
    package.__path__ = [str(ROOT)]
    sys.modules[PACKAGE_NAME] = package

    folder_paths = types.ModuleType("folder_paths")
    folder_paths.get_filename_list = lambda _kind: []
    folder_paths.get_full_path_or_raise = lambda _kind, _name: "/tmp/fake.safetensors"
    sys.modules["folder_paths"] = folder_paths

    comfy = types.ModuleType("comfy")
    comfy.__path__ = []
    comfy_sd = types.ModuleType("comfy.sd")
    comfy_utils = types.ModuleType("comfy.utils")
    comfy.sd = comfy_sd
    comfy.utils = comfy_utils
    sys.modules["comfy"] = comfy
    sys.modules["comfy.sd"] = comfy_sd
    sys.modules["comfy.utils"] = comfy_utils
    sys.modules.setdefault("torch", types.ModuleType("torch"))


def _load(name: str):
    qualified = f"{PACKAGE_NAME}.{name}"
    spec = importlib.util.spec_from_file_location(qualified, ROOT / f"{name}.py")
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[qualified] = module
    spec.loader.exec_module(module)
    return module


_install_runtime_stubs()
_load("civitai_trigger")
LOADERS = (_load("loader_core"), _load("studio_loader_core"))


class LoaderTriggerFallbackTests(unittest.TestCase):
    def test_civitai_fallback_is_shared_by_classic_and_studio(self) -> None:
        for loader in LOADERS:
            with self.subTest(module=loader.__name__), mock.patch.object(
                loader,
                "_load_safetensors_metadata",
                return_value={},
            ), mock.patch.object(
                loader,
                "detect_civitai_trigger",
                return_value=("Gadget & the Gadgetinis", "civitai.trainedWords"),
            ):
                self.assertEqual(
                    loader._detect_main_trigger("Gadget.safetensors"),
                    ("Gadget & the Gadgetinis", "civitai.trainedWords"),
                )

    def test_embedded_trigger_remains_first_priority(self) -> None:
        for loader in LOADERS:
            with self.subTest(module=loader.__name__), mock.patch.object(
                loader,
                "_load_safetensors_metadata",
                return_value={"trigger_words": "embedded_trigger"},
            ), mock.patch.object(loader, "detect_civitai_trigger") as fallback:
                self.assertEqual(
                    loader._detect_main_trigger("Gadget.safetensors"),
                    ("embedded_trigger", "trigger_words"),
                )
                fallback.assert_not_called()

    def test_modelspec_title_is_never_an_automatic_trigger(self) -> None:
        for loader in LOADERS:
            with self.subTest(module=loader.__name__), mock.patch.object(
                loader,
                "_load_safetensors_metadata",
                return_value={"modelspec.title": "Generic model title"},
            ), mock.patch.object(
                loader,
                "detect_civitai_trigger",
                return_value=("", ""),
            ):
                self.assertEqual(
                    loader._detect_main_trigger("Gadget.safetensors"),
                    ("", ""),
                )

    def test_weighted_civitai_recipe_is_not_auto_injected(self) -> None:
        recipe = "C- String_ByMrJohn, (cstring, minimal c-string underwear:1.6), no side straps"
        for loader in LOADERS:
            with self.subTest(module=loader.__name__), mock.patch.object(
                loader, "_load_safetensors_metadata", return_value={}
            ), mock.patch.object(
                loader, "detect_civitai_trigger", return_value=(recipe, "civitai.trainedWords")
            ):
                self.assertEqual(loader._detect_main_trigger("Gadget.safetensors"), ("", ""))


if __name__ == "__main__":
    unittest.main()
