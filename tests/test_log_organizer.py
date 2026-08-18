from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from solo_log_organizer.engine import analyze_file, analyze_tokens, destination_group
from solo_log_organizer.models import RuleSet


class LogOrganizerClassificationTests(unittest.TestCase):
    def test_girl_words_do_not_create_a_special_prompt_group(self) -> None:
        tokens = analyze_tokens(["a girl in a portrait", "two girls in a studio"])
        self.assertEqual(destination_group("Full Prompts", tokens), "Standard")

    def test_girl_prompt_uses_normal_template_grouping(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "girl prompts.txt"
            source.write_text("a girl wearing OUTFIT in a portrait studio\n", encoding="utf-8")
            row = analyze_file(str(root), str(source), RuleSet(), [])

        self.assertEqual(row.parent_category, "prompts")
        self.assertEqual(row.destination_group, "Templates")
        self.assertNotIn("girl/girls", "; ".join(row.issues))


if __name__ == "__main__":
    unittest.main()
