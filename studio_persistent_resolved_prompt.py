from .persistent_resolved_prompt import PersistentResolvedPrompt

class PersistentResolvedPromptStudio(PersistentResolvedPrompt):
    CATEGORY = "Sick Ollie/Studio"

NODE_CLASS_MAPPINGS = {"PersistentResolvedPromptSOStudio": PersistentResolvedPromptStudio}
NODE_DISPLAY_NAME_MAPPINGS = {"PersistentResolvedPromptSOStudio": "Persist + Display Resolved Prompt"}
