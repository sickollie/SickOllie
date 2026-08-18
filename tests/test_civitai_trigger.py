from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock


MODULE_PATH = Path(__file__).resolve().parents[1] / "civitai_trigger.py"
SPEC = importlib.util.spec_from_file_location("sickollie_civitai_trigger", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
civitai_trigger = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(civitai_trigger)


class CivitaiTriggerTests(unittest.TestCase):
    def setUp(self) -> None:
        civitai_trigger.clear_trigger_cache()

    def test_trained_words_preserve_ampersand(self) -> None:
        payload = {"trainedWords": ["Gadget &amp; the Gadgetinis Style"]}
        self.assertEqual(
            civitai_trigger.trigger_from_civitai_payload(payload),
            "Gadget & the Gadgetinis Style",
        )

    def test_trained_words_keep_all_declared_candidates(self) -> None:
        payload = {"trainedWords": ["first_token", "second token", "first_token"]}
        self.assertEqual(
            civitai_trigger.triggers_from_civitai_payload(payload),
            ["first_token", "second token"],
        )

    def test_nested_sidecar_wins_without_network(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            lora = Path(directory) / "Gadget & the Gadgetinis Style.safetensors"
            lora.write_bytes(b"test-lora")
            sidecar = lora.with_suffix(".civitai.info")
            sidecar.write_text(
                json.dumps({"modelVersion": {"trainedWords": ["gadget & gadgetinis"]}}),
                encoding="utf-8",
            )

            with mock.patch.object(
                civitai_trigger,
                "_api_payload",
                side_effect=AssertionError("network fallback should not run"),
            ):
                trigger, source = civitai_trigger.detect_civitai_trigger(str(lora))

        self.assertEqual(trigger, "gadget & gadgetinis")
        self.assertEqual(source, "civitai.sidecar")

    def test_exact_hash_api_result_is_cached(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            lora = Path(directory) / "style.safetensors"
            lora.write_bytes(b"stable bytes")

            with mock.patch.object(
                civitai_trigger,
                "_api_payload",
                return_value={"trainedWords": ["Style & Spark"]},
            ) as request:
                first = civitai_trigger.detect_civitai_trigger(str(lora))
                second = civitai_trigger.detect_civitai_trigger(str(lora))

        self.assertEqual(first, ("Style & Spark", "civitai.trainedWords"))
        self.assertEqual(second, first)
        request.assert_called_once()

    def test_unrelated_sidecar_strings_are_not_guessed_as_triggers(self) -> None:
        payload = {
            "model": {"name": "This is a model title"},
            "description": "Use any prompt you want",
        }
        self.assertEqual(civitai_trigger.trigger_from_civitai_payload(payload), "")

    def test_new_sidecar_invalidates_a_negative_cache_entry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            lora = Path(directory) / "style.safetensors"
            lora.write_bytes(b"stable bytes")
            with mock.patch.object(civitai_trigger, "_api_payload", return_value={}):
                self.assertEqual(civitai_trigger.detect_civitai_trigger(str(lora)), ("", ""))

            lora.with_suffix(".civitai.info").write_text(
                json.dumps({"trainedWords": ["new & local"]}),
                encoding="utf-8",
            )
            self.assertEqual(
                civitai_trigger.detect_civitai_trigger(str(lora)),
                ("new & local", "civitai.sidecar"),
            )


if __name__ == "__main__":
    unittest.main()
