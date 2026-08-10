from .preview_core import SOFitPreview

class SOFitPreviewStudio(SOFitPreview):
    CATEGORY = "Sick Ollie/Studio"

NODE_CLASS_MAPPINGS = {"SOFitPreviewStudio": SOFitPreviewStudio}
NODE_DISPLAY_NAME_MAPPINGS = {"SOFitPreviewStudio": "Preview Core"}
