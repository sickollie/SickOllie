import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";


const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function executableSource(filename, appendedTests) {
    let source = fs.readFileSync(path.join(root, "js", filename), "utf8");
    source = source.replace(
        /import \{ app \} from "\.\.\/\.\.\/\.\.\/scripts\/app\.js";\s*/,
        "const app = { graph: { links: {} }, registerExtension() {} };\n",
    );
    source = source.replace(
        /import \{ api \} from "\.\.\/\.\.\/\.\.\/scripts\/api\.js";\s*/,
        "const api = { apiURL(value) { return value; } };\n",
    );
    source = source.replace(
        /import \{[\s\S]*?\} from "\.\/studio_theme\.js";\s*/,
        `const STUDIO_LAYOUT = { minWidth: 820, pad: 12, gap: 8, rowHeight: 36, headerHeight: 96, socketStart: 120, socketStep: 21, socketGap: 12, sectionGap: 10, bottomPad: 18 };
         const STUDIO_THEME = { cyan: "#35d7ff", magenta: "#ff4ab8", yellow: "#f6e65a", green: "#6ee7a2", ink: "#08070c", panel: "#111", row: "#222", rowHover: "#333", outline: "#444", label: "#aaa", text: "#fff", body: "#000" };
         const applyStudioNodeColors = () => {};
         const drawStudioChrome = () => {};
         const drawStudioSectionFrame = () => {};
        `,
    );
    return `${source}\n${appendedTests}`;
}

eval(executableSource("studio_prompt_core.js", `
    assert.deepEqual(aliasesInText("OUTFIT_A then OUTFIT", ["OUTFIT"]), ["OUTFIT"]);
    assert.deepEqual(aliasesInText("{OUTFIT_A} and OUTFIT", tokenCandidates("OUTFIT_A", "OUTFIT")), ["{OUTFIT_A}", "OUTFIT"]);

    const legacyValues = LEGACY_V10_NAMES.map((name) => {
        if (name === "manual_prompt") return "legacy prompt";
        if (name === "outfit_token_A") return "OUTFIT";
        return DEFAULTS[name];
    });
    const migrated = migratePromptWorkflow({ properties: { so_prompt_core_schema_version: 10 }, widgets_values: legacyValues });
    assert.equal(migrated.widgets_values.length, CANONICAL_NAMES.length);
    assert.equal(migrated.widgets_values[CANONICAL_NAMES.indexOf("manual_prompt")], "legacy prompt");
    assert.equal(migrated.widgets_values[CANONICAL_NAMES.indexOf("outfit_token_A")], "OUTFIT");
    for (const name of Object.keys(LEGACY_PLACEMENTS)) {
        assert.equal(migrated.widgets_values[CANONICAL_NAMES.indexOf(name)], "token");
        assert.equal(DEFAULTS[name], "smart");
    }


    const v12TriggerValues = canonicalValues({ trigger_placement: "off", trigger_override: "sicktype" });
    const migratedTrigger = migratePromptWorkflow({ properties: { so_prompt_core_schema_version: 12 }, widgets_values: v12TriggerValues });
    assert.equal(migratedTrigger.widgets_values[CANONICAL_NAMES.indexOf("trigger_placement")], "smart");
    assert.equal(migratedTrigger.widgets_values[CANONICAL_NAMES.indexOf("trigger_override")], "sicktype");

    const stateNode = {
        widgets: CANONICAL_NAMES.map((name) => ({ name, value: DEFAULTS[name], options: {}, callback() {} })),
        __soLogLines: { outfit_A: ["yellow jacket"] },
        __soLogLineFiles: { outfit_A: "outfits/a.txt" },
        __sooutfit_index_preview_A: { options: {} },
        properties: {},
        setDirtyCanvas() {},
    };
    widget(stateNode, "manual_prompt").value = "NAME wears OUTFIT";
    widget(stateNode, "outfit_log_file_A").value = "outfits/a.txt";
    assert.equal(streamAssemblyState(stateNode, "outfit_A").action, "replace");

    widget(stateNode, "manual_prompt").value = "NAME portrait";
    widget(stateNode, "outfit_placement_A").value = "token";
    widget(stateNode, "outfit_mode_A").value = "increment";
    advanceStream(stateNode, "outfit_A");
    assert.equal(widget(stateNode, "outfit_index_A").value, 0);
    widget(stateNode, "outfit_placement_A").value = "smart";
    advanceStream(stateNode, "outfit_A");
    assert.equal(widget(stateNode, "outfit_index_A").value, 1);

    widget(stateNode, "item_token").value = "{BRAND}";
    assert.equal(configuredPlaceholderLabel(stateNode, "item_token", "ITEM"), "BRAND");
    assert.equal(promptExternalInputLabel(stateNode, "item_value"), "BRAND value");

    widget(stateNode, "prompt_source").value = "log";
    assert.equal(promptSourceHeight(stateNode), 255);
    const sourceFrame = promptSourceFrameGeometry(100, 373);
    const modeIndexBottom = 373 - PROMPT_LOG_BOTTOM_PAD;
    assert.equal(sourceFrame.bottom - modeIndexBottom, 18);

    stateNode.inputs = [{ name: "prefix_text", link: 11 }];
    stateNode.__soLastAssembly = { prefix: { text: "linked prefix" } };
    app.graph.links[11] = { origin_id: 7, origin_slot: 0 };
    app.graph.getNodeById = () => ({
        title: "Text Source",
        outputs: [{ name: "text" }],
        __soLiveOutputs: { text: "live prefix" },
    });
    const prefixState = promptConnectedTextState(stateNode, "prefix_text", "prefix");
    assert.equal(prefixState.connected, true);
    assert.equal(prefixState.display, "Text Source → text · live prefix");

    stateNode.inputs = [{ name: "name_value", link: 12 }];
    stateNode.__soLastAssembly = { name: { value: "previous run" } };
    widget(stateNode, "prompt_source").value = "manual";
    widget(stateNode, "manual_prompt").value = "NAME portrait";
    app.graph.links[12] = { origin_id: 8, origin_slot: 1 };
    const loaderOrigin = {
        title: "Loader Core",
        outputs: [{ name: "model" }, { name: "clean_name" }],
        __soLiveOutputs: { clean_name: "current LoRA" },
    };
    app.graph.getNodeById = () => loaderOrigin;
    assert.equal(substitutionState(stateNode, "name").value, "current LoRA");
    loaderOrigin.__soLiveOutputs.clean_name = "next LoRA";
    assert.equal(substitutionState(stateNode, "name").value, "next LoRA");


    const missingLogNode = {
        widgets: CANONICAL_NAMES.map((name) => ({ name, value: DEFAULTS[name], options: {}, callback() {} })),
        properties: {},
        setDirtyCanvas() {},
    };
    const missingPrompt = widget(missingLogNode, "prompt_log_file");
    missingPrompt.value = "prompts/renamed-away.txt";
    missingPrompt.options.values = [NO_FILE, "prompts/current.txt"];
    widget(missingLogNode, "prompt_source").value = "manual";
    assert.equal(healMissingLogSelection(missingLogNode, "prompt"), true);
    assert.equal(missingPrompt.value, NO_FILE);
    assert.equal(widget(missingLogNode, "prompt_source").value, "manual");

    missingPrompt.value = "prompts/moved.txt";
    widget(missingLogNode, "prompt_source").value = "log";
    assert.equal(healMissingLogSelection(missingLogNode, "prompt"), true);
    assert.equal(missingPrompt.value, NO_FILE);
    assert.equal(widget(missingLogNode, "prompt_source").value, "manual");

    const triggerNode = {
        widgets: CANONICAL_NAMES.map((name) => ({ name, value: DEFAULTS[name], options: {}, callback() {} })),
        inputs: [{ name: "main_trigger", link: 993 }],
        properties: {},
        setDirtyCanvas() {},
    };
    widget(triggerNode, "manual_prompt").value = "{TRIGGER} portrait";
    chooseTriggerOverride(triggerNode, "sicktype");
    assert.equal(widget(triggerNode, "trigger_override").value, "sicktype");
    // Choosing a source no longer changes placement behind the user's back.
    assert.equal(widget(triggerNode, "trigger_placement").value, "off");
    widget(triggerNode, "trigger_placement").value = "smart";
    assert.equal(triggerAssemblyState(triggerNode).used, true);

    // Candidate overrides are scoped to the LoRA that was active when chosen.
    const triggerLoader = {
        title: "Loader Core",
        widgets: [{ name: "main_lora", value: "styles/a.safetensors" }],
        outputs: [{ name: "main_trigger" }],
        __soLiveOutputs: { main_trigger: "style_a" },
    };
    app.graph.links[993] = { origin_id: 99, origin_slot: 0 };
    app.graph.getNodeById = id => id === 99 ? triggerLoader : loaderOrigin;
    chooseTriggerOverride(triggerNode, "style_a");
    assert.equal(triggerNode.properties.so_trigger_override_lora, "styles/a.safetensors");
    triggerLoader.widgets[0].value = "styles/b.safetensors";
    assert.equal(syncTriggerOverrideScope(triggerNode), true);
    assert.equal(widget(triggerNode, "trigger_override").value, "");

    layoutPromptInputSockets(triggerNode);
    assert.equal(triggerNode.inputs[0].label, " ");
    assert.equal(promptExternalInputLabel(triggerNode, "main_trigger"), "TRIGGER value");
`));

eval(executableSource("studio_preview_core.js", `
    const legacyPreview = {
        version: 0.4,
        nodes: [{
            id: 7,
            type: "SOFitPreview",
            pos: [100, 200],
            size: [480, 620],
            widgets_values: ["Cover", "Checkerboard", "#123456"],
            properties: { so_fit_preview_images: [{ filename: "preview.png", type: "temp", subfolder: "" }] },
        }],
        links: [[9, 2, 0, 7, 0, "IMAGE"]],
        definitions: {
            subgraphs: [{
                nodes: [{ id: 11, type: "SOFitPreview", widgets_values: ["Actual Size", "Solid", "#000000"] }],
            }],
        },
    };
    const before = JSON.parse(JSON.stringify(legacyPreview));
    assert.equal(migrateLegacyPreviewNodes(legacyPreview), 2);
    assert.equal(legacyPreview.nodes[0].type, "SOFitPreviewStudio");
    assert.equal(legacyPreview.definitions.subgraphs[0].nodes[0].type, "SOFitPreviewStudio");
    assert.deepEqual(legacyPreview.nodes[0].pos, before.nodes[0].pos);
    assert.deepEqual(legacyPreview.nodes[0].size, before.nodes[0].size);
    assert.deepEqual(legacyPreview.nodes[0].widgets_values, before.nodes[0].widgets_values);
    assert.deepEqual(legacyPreview.nodes[0].properties, before.nodes[0].properties);
    assert.deepEqual(legacyPreview.links, before.links);
    assert.equal(migrateLegacyPreviewNodes(legacyPreview), 0);
`));

eval(executableSource("studio_generation_core.js", `
    const dimensionNode = {
        widgets: [
            { name: "custom_width", value: 1440, callback() {} },
            { name: "custom_height", value: 1920, callback() {} },
        ],
        setDirtyCanvas() {},
    };
    swapCustomDimensions(dimensionNode);
    assert.equal(widget(dimensionNode, "custom_width").value, 1920);
    assert.equal(widget(dimensionNode, "custom_height").value, 1440);
`));

eval(executableSource("studio_preview_core.js", `
    const compareNode = { properties: {}, size: [700, 620], setDirtyCanvas() {} };
    rememberPreviewPaneWidth(compareNode, 700);
    assert.equal(syncCompareLayout(compareNode), false);
    assert.equal(compareNode.size[0], 700);
    compareNode.properties.so_fit_preview_compare = true;
    compareNode.properties[PINNED_IMAGES_PROPERTY] = [{ filename: "pin.png", type: "temp", subfolder: "" }];
    assert.equal(syncCompareLayout(compareNode), true);
    assert.equal(compareNode.size[0], 1410);
    assert.equal(previewPaneWidth(compareNode), 700);
    compareNode.properties[PINNED_IMAGES_PROPERTY] = [];
    assert.equal(syncCompareLayout(compareNode), false);
    assert.equal(compareNode.size[0], 700);
`));

const generationSource = fs.readFileSync(path.join(root, "js", "studio_generation_core.js"), "utf8");
assert.match(generationSource, /so_last_width/);
assert.match(generationSource, /so_last_height/);

const themeSource = fs.readFileSync(path.join(root, "js", "studio_theme.js"), "utf8");
for (const core of ["Loader", "Prompt", "Generation", "Output"]) {
    assert.match(themeSource, new RegExp(`HeaderBranding${core}Core_v2_1_1\\.png`));
}

const loaderSource = fs.readFileSync(path.join(root, "js", "studio_loader_core.js"), "utf8");
assert.match(loaderSource, /function publishLoaderLiveOutputs\(node\)/);
assert.match(loaderSource, /clean_name:\s*dashboardCleanName\(node\)/);
assert.match(loaderSource, /refreshCleanNameChoices\(node\)[\s\S]*?publishLoaderLiveOutputs\(node\)/);
assert.match(loaderSource, /\[★ Favorites\]/);
assert.match(loaderSource, /\[✓ Tested\]/);
assert.match(loaderSource, /\[◌ Untested \/ Retest\]/);
assert.match(loaderSource, /library_filter/);
assert.match(loaderSource, /lora_sort/);
assert.match(loaderSource, /Most used/);
assert.match(loaderSource, /review-lora/);
assert.match(loaderSource, /loraUseCount\(node, value\) > 0 \? reviewTone\("tested"\)/);

const recipeSource = fs.readFileSync(path.join(root, "js", "solo_recipe_catalog.js"), "utf8");
assert.match(recipeSource, /SOGenerationPipelineStudio/);
assert.match(recipeSource, /SOOutputBuilderSaveStudio/);
assert.match(recipeSource, /Apply checked changes/);
assert.match(recipeSource, /Resolved seed/);
assert.match(recipeSource, /optional_nodes/);
assert.match(recipeSource, /off by default/);
assert.match(recipeSource, /prompt_mode:\s*"fixed"/);
assert.doesNotMatch(recipeSource, /Empty LoRA slot"\s*\}\);/);
assert.match(recipeSource, /function askRecipeName\(/);
assert.match(recipeSource, /save-with-preview/);
assert.match(recipeSource, /currentStudioPreviewData/);
assert.match(recipeSource, /function lastExecutedPromptValues\(/);
assert.match(recipeSource, /__soLastAssembly/);
assert.doesNotMatch(recipeSource, /window\.prompt\(/);

const previewSource = fs.readFileSync(path.join(root, "js", "studio_preview_core.js"), "utf8");
assert.match(previewSource, /PREVIEW_CONTROLS_HEIGHT/);
assert.match(previewSource, /const PREVIEW_CONTROLS_HEIGHT = 40/);
assert.match(previewSource, /sickollie:save-studio-recipe/);
assert.match(previewSource, /📚 RECIPE/);
assert.match(previewSource, /★ LIBRARY THUMB/);
assert.match(previewSource, /BACKGROUND COLOR/);
assert.match(previewSource, /function previewActionFeedback\(/);
assert.match(previewSource, /navigator\?\.vibrate\?\.\(16\)/);
assert.match(previewSource, /sickollie:preview-executed/);
assert.match(previewSource, /sickollie:set-lora-thumbnail/);
assert.match(previewSource, /function syncCompareLayout\(/);
assert.match(previewSource, /PINNED REFERENCE/);
assert.match(previewSource, /BASE_WIDTH_PROPERTY/);
assert.match(previewSource, /PREVIEW_UPDATED_PROPERTY/);
assert.match(previewSource, /previewData/);
assert.doesNotMatch(previewSource, /thumbW/);

const librarySource = fs.readFileSync(path.join(root, "js", "solo_library_review.js"), "utf8");
assert.match(librarySource, /Auto first image/);
assert.match(librarySource, /YEARBOOK THUMBNAIL RUN/);
assert.match(librarySource, /action\("Load LoRA"/);
assert.doesNotMatch(librarySource, /Load LoRA · keep strength/);
assert.match(librarySource, /Fill from Civitai/);
assert.match(librarySource, /Quarantine rejected/);
assert.match(librarySource, /request\("\/quarantine-rejected"/);
assert.match(librarySource, /function updateCachedThumbnail\(/);
assert.match(librarySource, /function refreshCatalogAfterYearbook\(/);
assert.match(librarySource, /if \(completed\) refreshCatalogAfterYearbook\(\)/);
assert.match(librarySource, /folderScope/);
assert.match(librarySource, /request\("\/lora-files"\)/);
assert.match(librarySource, /loaderFolderForLora/);
assert.match(librarySource, /setWidget\(loader, "folder_name", loaderFolderForLora\(canonical\)\)/);
assert.match(librarySource, /thumbnail_updated_at \|\| asset.updated_at/);
assert.match(librarySource, /Open Civitai/);
assert.match(librarySource, /await ensureStyle\(\)/);
assert.match(librarySource, /let styleReady = null/);
assert.match(librarySource, /normalizedLoraPath/);
assert.match(librarySource, /YEARBOOK_PROMPT_KEY/);
assert.match(librarySource, /Use \$\{browserFolder\} \+ nested folders/);
assert.match(librarySource, /3:4 \(Portrait Standard\)/);
assert.match(librarySource, /GENERATION_TYPE/);
assert.match(librarySource, /Loading through Loader Core/);
assert.match(librarySource, /so-lib-usage-pill/);
assert.match(librarySource, /so-lib-card-load/);
assert.match(librarySource, /captured: 0, skipped: 0/);
assert.match(librarySource, /function hasRenderableThumbnail\(/);
assert.match(librarySource, /CIVITAI READY/);
assert.match(librarySource, /function scheduleYearbook\(/);
assert.match(librarySource, /api\?\.interrupt/);
assert.match(librarySource, /keeps your current Loader strength/);
assert.match(librarySource, /Replace Civitai thumbnails/);
assert.match(librarySource, /Replace generated non-Yearbook thumbnails/);
assert.match(librarySource, /Standardize non-Yearbook thumbnails/);
assert.match(librarySource, /Rebuild existing Yearbook thumbnails/);
assert.match(librarySource, /Catalog tools/);
assert.match(librarySource, /request\("\/maintenance"/);
assert.match(librarySource, /Purge \+ rebuild/);
assert.match(librarySource, /captureNodeValues\(loader, \["main_enabled", "main_lora", "control_after_generate"\]\)/);
assert.doesNotMatch(librarySource, /setWidget\([^\n]*"include_subfolders"/);
assert.doesNotMatch(librarySource, /setWidget\([^\n]*"main_strength"/);
assert.doesNotMatch(librarySource, /mainWidget\?\.options\?\.values/);
assert.doesNotMatch(librarySource, /Filter name or path/);

const libraryCss = fs.readFileSync(path.join(root, "js", "solo_library_review.css"), "utf8");
assert.match(libraryCss, /grid-template-rows:\s*auto auto auto minmax\(0,1fr\)/);
assert.match(libraryCss, /flex:\s*0 0 auto !important; aspect-ratio:\s*3 \/ 4/);
assert.match(libraryCss, /grid-auto-rows:\s*max-content !important/);
assert.match(libraryCss, /flex:\s*0 0 118px !important/);
assert.match(libraryCss, /so-lib-yearbook-progress\[hidden\][^}]*display:\s*none\s*!important/);
assert.doesNotMatch(libraryCss, /backdrop-filter:/);

const organizerSource = fs.readFileSync(path.join(root, "js", "solo_lora_organizer.js"), "utf8");
assert.match(organizerSource, /solo-overlay solo-lora-overlay/);
const organizerCss = fs.readFileSync(path.join(root, "js", "solo_lora_organizer.css"), "utf8");
assert.match(organizerCss, /\.solo-lora-overlay \.solo-progress-track/);
assert.match(organizerCss, /max-height:\s*12px/);

console.log("Studio frontend behavior tests passed");
