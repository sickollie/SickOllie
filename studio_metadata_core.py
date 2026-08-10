from .metadata_core import SOImageMetadataCore

class SOImageMetadataCoreStudio(SOImageMetadataCore):
    CATEGORY = "Sick Ollie/Studio"

NODE_CLASS_MAPPINGS = {"SOImageMetadataCoreStudio": SOImageMetadataCoreStudio}
NODE_DISPLAY_NAME_MAPPINGS = {"SOImageMetadataCoreStudio": "Image Metadata Core"}
