from __future__ import annotations

import importlib.util
import tempfile
import unittest
from pathlib import Path


MODULE = Path(__file__).resolve().parents[1] / "solo_catalog.py"
SPEC = importlib.util.spec_from_file_location("sickollie_solo_catalog", MODULE)
assert SPEC and SPEC.loader
catalog_module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(catalog_module)


class SoloCatalogTests(unittest.TestCase):
    def test_asset_history_trigger_pin_and_review_are_durable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            catalog = catalog_module.SoloCatalog(Path(directory) / "catalog.sqlite3")
            catalog.upsert_asset(asset_id="sha256:abc", path="/models/Old.safetensors", sha256="abc", size=12)
            catalog.replace_trigger_candidates("sha256:abc", [{"raw": "shyla", "clean": "shyla", "source": "civitai.trainedWords", "confidence": .88, "flags": []}])
            catalog.pin_trigger("sha256:abc", "shyla")
            catalog.set_review("sha256:abc", "favorite", 5, "Reliable")
            catalog.record_relocation("sha256:abc", "/models/Old.safetensors", "/models/New.safetensors", "move.json")
            asset = catalog.asset("sha256:abc")
            repaired = catalog.exact_repair_target(sha256="abc")
            catalog.save_filter("Favorites", {"state": "favorite"})
            filtered = catalog.list_assets(state="favorite")
            saved_filters = catalog.filters()
            catalog.save_recipe("recipe:one", "Poster test", {"nodes": []})
            recipes = catalog.recipes()

        self.assertEqual(asset["current_path"], "/models/New.safetensors")
        self.assertEqual(asset["review"]["state"], "favorite")
        self.assertTrue(asset["triggers"][0]["pinned"])
        self.assertIn("/models/Old.safetensors", asset["paths"])
        self.assertIn("/models/New.safetensors", asset["paths"])
        self.assertEqual(repaired, "/models/New.safetensors")
        self.assertEqual(filtered[0]["asset_id"], "sha256:abc")
        self.assertEqual(saved_filters[0]["name"], "Favorites")
        self.assertEqual(recipes[0]["name"], "Poster test")

    def test_default_registry_covers_dynamic_studio_tokens(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            catalog = catalog_module.SoloCatalog(Path(directory) / "catalog.sqlite3")
            with catalog._connection() as db:
                tokens = {row[0] for row in db.execute("SELECT token FROM token_registry")}
        self.assertTrue({"NAME", "OUTFIT_A", "OUTFIT_B", "OUTFIT_C", "SCENE", "ITEM", "TRIGGER"}.issubset(tokens))

    def test_completed_generation_records_testing_without_changing_rating(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "rory.safetensors"
            model.write_bytes(b"lora")
            catalog = catalog_module.SoloCatalog(Path(directory) / "catalog.sqlite3")
            asset_id = catalog.ensure_path_asset(model)
            catalog.set_review(asset_id, "retest")
            catalog.record_usage(model, "/outputs/one.png")
            tested_retest = catalog.list_assets()[0]
            catalog.set_review(asset_id, "favorite")
            catalog.record_usage(model, "/outputs/two.png")
            favorite = catalog.list_assets()[0]

        self.assertEqual(tested_retest["review_state"], "retest")
        self.assertEqual(tested_retest["tested"], 1)
        self.assertEqual(tested_retest["use_count"], 1)
        self.assertEqual(favorite["review_state"], "favorite")
        self.assertEqual(favorite["rating"], 4)
        self.assertEqual(favorite["use_count"], 2)

    def test_clear_rating_preserves_testing_and_reset_all_removes_it(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "shyla.safetensors"
            model.write_bytes(b"lora")
            catalog = catalog_module.SoloCatalog(Path(directory) / "catalog.sqlite3")
            asset_id = catalog.ensure_path_asset(model)
            catalog.record_usage(model, "/outputs/one.png")
            catalog.set_review(asset_id, "keep")
            catalog.reset_status(asset_id, include_testing=False)
            cleared = catalog.list_assets()[0]
            catalog.reset_status(asset_id, include_testing=True)
            nuked = catalog.list_assets()[0]

        self.assertEqual(cleared["review_state"], "none")
        self.assertEqual(cleared["use_count"], 1)
        self.assertEqual(nuked["review_state"], "none")
        self.assertEqual(nuked["use_count"], 0)

    def test_most_used_sort_and_test_filters_are_independent(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            catalog = catalog_module.SoloCatalog(Path(directory) / "catalog.sqlite3")
            low = Path(directory) / "low.safetensors"; low.write_bytes(b"low")
            high = Path(directory) / "high.safetensors"; high.write_bytes(b"high")
            fresh = Path(directory) / "fresh.safetensors"; fresh.write_bytes(b"fresh")
            catalog.ensure_path_asset(fresh)
            catalog.record_usage(low)
            catalog.record_usage(high); catalog.record_usage(high)
            catalog.set_review(catalog.path_asset_id(fresh), "favorite")
            ordered = catalog.list_assets(sort="most_used")
            tested = catalog.list_assets(state="tested")
            untested = catalog.list_assets(state="untested")

        self.assertEqual([item["model_name"] for item in ordered], ["high", "low", "fresh"])
        self.assertEqual({item["model_name"] for item in tested}, {"high", "low"})
        self.assertEqual({item["model_name"] for item in untested}, {"fresh"})

    def test_civitai_preview_skips_showcase_video_and_uses_first_image(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "helena.safetensors"
            model.write_bytes(b"lora")
            catalog = catalog_module.SoloCatalog(Path(directory) / "catalog.sqlite3")
            asset_id = catalog.ensure_path_asset(model)
            catalog.set_remote_metadata(asset_id, {
                "images": [
                    "https://image.civitai.com/demo/original=true/first.mp4",
                    "https://image.civitai.com/demo/original=true/second.jpeg",
                    "https://image.civitai.com/demo/original=true/third.webp",
                ]
            }, "civitai:sha256")
            listed = catalog.list_assets()[0]

        self.assertEqual(listed["civitai_preview"], "https://image.civitai.com/demo/original=true/second.jpeg")
        self.assertEqual(listed["civitai_image_count"], 2)


    def test_list_assets_exposes_thumbnail_updated_at_for_cache_busting(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "cache_bust.safetensors"
            model.write_bytes(b"lora")
            catalog = catalog_module.SoloCatalog(Path(directory) / "catalog.sqlite3")
            asset_id = catalog.ensure_path_asset(model)
            catalog.set_thumbnail(asset_id, "stable.webp", "generated:yearbook")
            first = catalog.list_assets()[0]
            catalog.set_thumbnail(asset_id, "stable.webp", "civitai-showcase")
            second = catalog.list_assets()[0]

        self.assertTrue(first["thumbnail_updated_at"])
        self.assertTrue(second["thumbnail_updated_at"])
        self.assertEqual(second["thumbnail_source"], "civitai-showcase")

    def test_purge_assets_resets_lora_records_but_preserves_shared_catalog_data(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "reset_me.safetensors"
            model.write_bytes(b"lora")
            catalog = catalog_module.SoloCatalog(Path(directory) / "catalog.sqlite3")
            asset_id = catalog.ensure_path_asset(model)
            catalog.replace_trigger_candidates(asset_id, [{"raw": "reset", "clean": "reset", "source": "test", "confidence": .8, "flags": []}])
            catalog.set_review(asset_id, "favorite")
            catalog.record_usage(model, "/outputs/one.png")
            catalog.set_thumbnail(asset_id, "thumb.webp", "generated:yearbook")
            catalog.set_remote_metadata(asset_id, {"creator": "demo", "images": ["https://image.civitai.com/example.webp"]}, "test")
            catalog.save_filter("Keep me", {"state": "favorite"})
            catalog.save_recipe("recipe:keep", "Keep recipe", {"nodes": []})

            result = catalog.purge_assets([asset_id])

            self.assertEqual(result["purged"], 1)
            self.assertEqual(result["thumbnails"][0]["filename"], "thumb.webp")
            self.assertIsNone(catalog.asset(asset_id))
            self.assertEqual(catalog.filters()[0]["name"], "Keep me")
            self.assertEqual(catalog.recipes()[0]["name"], "Keep recipe")
            with catalog._connection() as db:
                token_count = db.execute("SELECT COUNT(*) FROM token_registry").fetchone()[0]
            self.assertGreater(token_count, 0)

    def test_clear_thumbnails_only_preserves_other_asset_history(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "thumb_only.safetensors"
            model.write_bytes(b"lora")
            catalog = catalog_module.SoloCatalog(Path(directory) / "catalog.sqlite3")
            asset_id = catalog.ensure_path_asset(model)
            catalog.set_review(asset_id, "keep")
            catalog.record_usage(model, "/outputs/one.png")
            catalog.set_thumbnail(asset_id, "thumb.webp", "civitai-showcase")

            removed = catalog.clear_thumbnails([asset_id])
            asset = catalog.asset(asset_id)

            self.assertEqual(removed[0]["filename"], "thumb.webp")
            self.assertIsNone(asset["thumbnail"])
            self.assertEqual(asset["review"]["state"], "keep")
            self.assertEqual(asset["usage"]["use_count"], 1)

    def test_thumbnail_remote_metadata_and_usage_events_are_cataloged(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "lumi_epoch_12.safetensors"
            model.write_bytes(b"lora")
            catalog = catalog_module.SoloCatalog(Path(directory) / "catalog.sqlite3")
            asset_id = catalog.ensure_path_asset(model)
            catalog.set_thumbnail(asset_id, "abc.webp", "generated:yearbook", width=384, height=512, byte_size=42000)
            catalog.set_remote_metadata(asset_id, {
                "model_id": "123", "version_id": "456", "creator": "ollie",
                "base_model": "Krea2", "images": ["https://image.civitai.com/example.webp"],
            }, "civitai:sha256")
            catalog.record_usage(model, "/outputs/one.png")
            detail = catalog.asset(asset_id)
            listed = catalog.list_assets()[0]

        self.assertEqual(detail["thumbnail"]["source"], "generated:yearbook")
        self.assertEqual(detail["remote_metadata"]["creator"], "ollie")
        self.assertEqual(detail["usage_events"][0]["output_path"], "/outputs/one.png")
        self.assertEqual(listed["thumbnail_ref"], "abc.webp")
        self.assertEqual(listed["civitai_preview"], "https://image.civitai.com/example.webp")
        self.assertEqual(listed["base_model"], "Krea2")


if __name__ == "__main__":
    unittest.main()
