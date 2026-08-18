from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PackRegistrationTests(unittest.TestCase):
    def test_requested_node_families_and_organizers_are_registered(self) -> None:
        source = (ROOT / "__init__.py").read_text(encoding="utf-8")
        self.assertNotIn("CLASSIC_PREVIEW_CLASSES", source)
        self.assertNotIn("CLASSIC_METADATA_CLASSES", source)
        self.assertNotIn("STUDIO_PERSIST_CLASSES", source)
        self.assertIn("ORGANIZER_CLASSES", source)
        self.assertIn("solo_lora_organizer", source)
        self.assertIn("solo_log_organizer", source)

    def test_starter_workflows_use_only_the_remaining_preview_metadata_families(self) -> None:
        workflows = ROOT / "Starter Content" / "workflows"
        classic = json.loads((workflows / "Sick Nodes v2_Classic.json").read_text(encoding="utf-8"))
        studio = json.loads((workflows / "Sick Nodes v2_Studio.json").read_text(encoding="utf-8"))
        generic = json.loads((workflows / "SickOllie_NodePack.json").read_text(encoding="utf-8"))
        classic_types = {node.get("type") for node in classic.get("nodes", [])}
        studio_types = {node.get("type") for node in studio.get("nodes", [])}
        generic_types = {node.get("type") for node in generic.get("nodes", [])}

        self.assertNotIn("SOFitPreview", classic_types)
        self.assertIn("SOFitPreviewStudio", studio_types)
        self.assertIn("SOImageMetadataCoreStudio", studio_types)
        self.assertNotIn("PersistentResolvedPromptSOStudio", studio_types)
        self.assertEqual(studio_types, generic_types)
        self.assertIn("SOFitPreviewStudio", generic_types)
        self.assertNotIn("SOFitPreview", generic_types)


if __name__ == "__main__":
    unittest.main()
