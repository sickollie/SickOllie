class SoloLoraOrganizerLauncher:
    """Compact launcher; the full organizer runs independently of workflow execution."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("status",)
    FUNCTION = "status"
    CATEGORY = "Sick Ollie/Utilities"
    DESCRIPTION = "Opens the integrated SOLO LoRA Organizer with preview-first file operations."

    def status(self):
        return ("SOLO LoRA Organizer is available from this node's Open Organizer button.",)


class SoloLogOrganizerLauncher:
    """Compact launcher for Prompt Core-compatible log cleanup and organization."""

    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {}}

    RETURN_TYPES = ("STRING",)
    RETURN_NAMES = ("status",)
    FUNCTION = "status"
    CATEGORY = "Sick Ollie/Utilities"
    DESCRIPTION = "Opens the preview-first SOLO Log Organizer without queueing a workflow."

    def status(self):
        return ("SOLO Log Organizer is available from this node's Open Organizer button.",)


NODE_CLASS_MAPPINGS = {
    "SOLO_LoRA_Organizer": SoloLoraOrganizerLauncher,
    "SOLO_Log_Organizer": SoloLogOrganizerLauncher,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "SOLO_LoRA_Organizer": "SOLO · LoRA Organizer",
    "SOLO_Log_Organizer": "SOLO · Log Organizer",
}
