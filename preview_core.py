from __future__ import annotations

import nodes as comfy_nodes


class SOFitPreview(comfy_nodes.PreviewImage):
    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "images": ("IMAGE",),
                "fit_mode": ([
                    "Contain + Upscale",
                    "Cover",
                    "Fit Width",
                    "Fit Height",
                    "Stretch",
                    "Actual Size",
                ], {"default": "Contain + Upscale"}),
                "background_mode": ([
                    "Solid",
                    "Checkerboard",
                    "Blurred Image",
                ], {"default": "Solid"}),
                "background_color": ("STRING", {
                    "default": "#111111",
                    "multiline": False,
                    "tooltip": "Hex background color used by Solid mode.",
                }),
            },
            "hidden": {
                "prompt": "PROMPT",
                "extra_pnginfo": "EXTRA_PNGINFO",
            },
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("images",)
    FUNCTION = "preview_fit"
    OUTPUT_NODE = True
    CATEGORY = "Sick Ollie/Output"
    DESCRIPTION = "Preview-only image viewer with contain, cover, width, height, stretch, and actual-size display modes."
    SEARCH_ALIASES = ["fit preview", "image preview", "cover preview", "contain preview"]

    def preview_fit(
        self,
        images,
        fit_mode="Contain + Upscale",
        background_mode="Solid",
        background_color="#111111",
        prompt=None,
        extra_pnginfo=None,
    ):
        return super().save_images(
            images,
            filename_prefix="SickOllieFitPreview",
            prompt=prompt,
            extra_pnginfo=extra_pnginfo,
        )



NODE_CLASS_MAPPINGS = {
    "SOFitPreview": SOFitPreview,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SOFitPreview": "Preview Core",
}
