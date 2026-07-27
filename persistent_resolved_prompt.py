from __future__ import annotations

from typing import Any


class PersistentResolvedPrompt:
    """
    Inline STRING pass-through that:
      1. displays the exact resolved text after execution,
      2. stores it in the saved workflow's own node data, and
      3. adds a separate `resolved_prompt` PNG metadata field.

    Put this node inline after the final Log / Regex operation and before the
    text encoder. Because it is upstream of image generation, it executes
    before the Save Image node writes metadata.
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "text": (
                    "STRING",
                    {
                        "forceInput": True,
                        "tooltip": "Connect the final prompt after all Logs and Regex processing.",
                    },
                ),
            },
            "optional": {
                "saved_prompt": (
                    "STRING",
                    {
                        "default": "",
                        "multiline": True,
                        "dynamicPrompts": False,
                        "tooltip": "Read-only display. The executed prompt is persisted here in saved PNG workflows.",
                    },
                ),
            },
            "hidden": {
                "unique_id": "UNIQUE_ID",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("text",)
    FUNCTION = "persist"
    CATEGORY = "Sick Ollie/Prompt"
    DESCRIPTION = (
        "Inline prompt viewer that persists the exact resolved STRING inside "
        "the saved PNG workflow and in a separate resolved_prompt metadata field."
    )
    SEARCH_ALIASES = [
        "persistent prompt",
        "resolved prompt",
        "final prompt display",
        "save prompt in workflow",
    ]

    @staticmethod
    def _extra_dict(extra_pnginfo: Any) -> dict | None:
        if isinstance(extra_pnginfo, dict):
            return extra_pnginfo

        # Compatibility with extensions / older builds that wrap EXTRA_PNGINFO.
        if isinstance(extra_pnginfo, list):
            for item in extra_pnginfo:
                if isinstance(item, dict):
                    return item

        return None

    @classmethod
    def IS_CHANGED(cls, **kwargs):
        # This node's purpose includes side effects on per-run PNG metadata.
        # NaN forces execution and prevents an old cached display from surviving.
        return float("nan")

    def persist(
        self,
        text: Any,
        saved_prompt: str = "",
        unique_id: Any = None,
        extra_pnginfo: Any = None,
    ):
        resolved = "" if text is None else str(text)
        extra = self._extra_dict(extra_pnginfo)

        if extra is not None:
            # Independent PNG tEXt field. Stock Save Image writes EXTRA_PNGINFO
            # entries into PNG metadata unless metadata saving is disabled.
            extra["resolved_prompt"] = resolved

            workflow = extra.get("workflow")
            if isinstance(workflow, dict):
                nodes = workflow.get("nodes", [])
                node = next(
                    (
                        item
                        for item in nodes
                        if str(item.get("id")) == str(unique_id)
                    ),
                    None,
                )

                if isinstance(node, dict):
                    # Belt-and-suspenders storage:
                    # - widgets_values makes the textarea display on reload.
                    # - properties is a named backup read by the JS extension.
                    node["widgets_values"] = [resolved]
                    node.setdefault("properties", {})["persistent_resolved_prompt"] = resolved

        return {
            "ui": {"resolved_prompt": [resolved]},
            "result": (resolved,),
        }


NODE_CLASS_MAPPINGS = {
    "PersistentResolvedPromptSO": PersistentResolvedPrompt,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PersistentResolvedPromptSO": "Persist + Display Resolved Prompt",
}
