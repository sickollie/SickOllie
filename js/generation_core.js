import { app } from "../../../scripts/app.js";

const TARGET = "SOGenerationPipeline";
const SCHEMA_VERSION = 26;
const SEED_MAX = 1125899906842624;

const CLIP_TYPES = new Set([
    "krea2",
    "sd3",
    "stable_diffusion",
    "stable_cascade",
    "pixart",
    "flux",
    "default",
]);

const RESOLUTION_MODES = new Set([
    "custom",
    "preset",
]);

function widget(node, name) {
    return node.widgets?.find(
        (item) => item.name === name,
    );
}

function setWidgetValue(item, value) {
    if (!item) return;

    item.value = value;

    try {
        item.callback?.(value);
    } catch (error) {}
}

function randomSeed() {
    return Math.floor(
        Math.random() * (SEED_MAX + 1),
    );
}

function updateLastSeedButton(node) {
    if (!node.__soLastSeedButton) return;

    const value =
        node.__soLastUsedSeed == null
            ? "none yet"
            : String(node.__soLastUsedSeed);

    node.__soLastSeedButton.name =
        `📋 Copy Last Used Seed: ${value}`;

    node.setDirtyCanvas?.(true, true);
}

async function copyText(value) {
    const text = String(value ?? "");

    if (!text) return;

    try {
        await navigator.clipboard.writeText(text);
        return;
    } catch (error) {}

    const input =
        document.createElement("textarea");
    input.value = text;
    input.style.position = "fixed";
    input.style.opacity = "0";
    document.body.append(input);
    input.select();
    document.execCommand("copy");
    input.remove();
}

function looksLikeLegacyFull(values) {
    return (
        Array.isArray(values) &&
        values.length >= 21 &&
        typeof values[1] === "string" &&
        CLIP_TYPES.has(String(values[2])) &&
        RESOLUTION_MODES.has(String(values[5])) &&
        typeof values[12] === "number" &&
        typeof values[15] === "number"
    );
}

function looksLikeV24(values) {
    return (
        Array.isArray(values) &&
        values.length >= 17 &&
        typeof values[0] === "string" &&
        CLIP_TYPES.has(String(values[1])) &&
        RESOLUTION_MODES.has(String(values[4])) &&
        typeof values[10] === "number" &&
        typeof values[11] === "number" &&
        typeof values[13] === "string"
    );
}

function migrateValuesOnce(info) {
    info.properties =
        info.properties || {};

    if (
        Number(
            info.properties
                .so_generation_core_schema_version,
        ) >= SCHEMA_VERSION
    ) {
        return;
    }

    const values = info.widgets_values;

    if (looksLikeLegacyFull(values)) {
        info.widgets_values = [
            values[1],
            values[2],
            values[3],
            values[4],
            values[5],
            values[6],
            values[7],
            values[8],
            values[9],
            values[11],
            values[15],
            values[16],
            values[17],
            values[18],
            values[19],
            values[20],
            values[12],
        ];
    } else if (looksLikeV24(values)) {
        info.widgets_values = [
            values[0],
            values[1],
            values[2],
            values[3],
            values[4],
            values[5],
            values[6],
            values[7],
            values[8],
            values[9],
            values[11],
            values[12],
            values[13],
            values[14],
            values[15],
            values[16],
            values[10],
        ];
    }

    info.properties
        .so_generation_core_schema_version =
        SCHEMA_VERSION;
}

app.registerExtension({
    name: "SickOllie.GenerationCoreStable",

    async beforeRegisterNodeDef(
        nodeType,
        nodeData,
    ) {
        if (nodeData.name !== TARGET) return;

        const originalCreated =
            nodeType.prototype.onNodeCreated;
        const originalConfigure =
            nodeType.prototype.onConfigure;
        const originalSerialize =
            nodeType.prototype.onSerialize;
        const originalExecuted =
            nodeType.prototype.onExecuted;

        nodeType.prototype.onNodeCreated =
            function () {
                const result =
                    originalCreated?.apply(
                        this,
                        arguments,
                    );

                const seedWidget =
                    widget(this, "seed_value");

                this.addWidget(
                    "button",
                    "🎲 Randomize Each Time",
                    null,
                    () => {
                        setWidgetValue(
                            seedWidget,
                            -1,
                        );
                    },
                );

                this.addWidget(
                    "button",
                    "🎯 New Fixed Random",
                    null,
                    () => {
                        setWidgetValue(
                            seedWidget,
                            randomSeed(),
                        );
                    },
                );

                this.addWidget(
                    "button",
                    "♻ Use Last Queued Seed",
                    null,
                    () => {
                        if (
                            this.__soLastUsedSeed ==
                            null
                        ) {
                            return;
                        }

                        setWidgetValue(
                            seedWidget,
                            Math.max(
                                0,
                                Math.min(
                                    Number(
                                        this
                                            .__soLastUsedSeed,
                                    ),
                                    SEED_MAX,
                                ),
                            ),
                        );
                    },
                );

                this.__soLastSeedButton =
                    this.addWidget(
                        "button",
                        "📋 Copy Last Used Seed: none yet",
                        null,
                        async () => {
                            if (
                                this.__soLastUsedSeed !=
                                null
                            ) {
                                await copyText(
                                    this
                                        .__soLastUsedSeed,
                                );
                            }
                        },
                    );

                this.properties =
                    this.properties || {};

                this.properties
                    .so_generation_core_schema_version =
                    SCHEMA_VERSION;

                const saved =
                    this.properties
                        .so_last_used_seed;

                if (saved != null) {
                    this.__soLastUsedSeed =
                        saved;
                }

                updateLastSeedButton(this);

                this.size = [
                    Math.max(
                        this.size?.[0] ?? 460,
                        460,
                    ),
                    Math.max(
                        this.size?.[1] ?? 780,
                        780,
                    ),
                ];

                return result;
            };

        nodeType.prototype.onConfigure =
            function (info) {
                migrateValuesOnce(info);

                const result =
                    originalConfigure?.apply(
                        this,
                        arguments,
                    );

                const saved =
                    info?.properties
                        ?.so_last_used_seed;

                if (saved != null) {
                    this.__soLastUsedSeed =
                        saved;
                }

                updateLastSeedButton(this);
                return result;
            };

        nodeType.prototype.onExecuted =
            function (message) {
                originalExecuted?.apply(
                    this,
                    arguments,
                );

                let value =
                    message?.seed_used;

                if (Array.isArray(value)) {
                    value = value[0];
                }

                if (value != null) {
                    this.__soLastUsedSeed =
                        value;

                    this.properties =
                        this.properties || {};

                    this.properties
                        .so_last_used_seed =
                        value;

                    updateLastSeedButton(this);
                }
            };

        nodeType.prototype.onSerialize =
            function (data) {
                const result =
                    originalSerialize?.apply(
                        this,
                        arguments,
                    );

                data.properties =
                    data.properties || {};

                data.properties
                    .so_generation_core_schema_version =
                    SCHEMA_VERSION;

                data.properties
                    .so_last_used_seed =
                    this.__soLastUsedSeed ??
                    null;

                return result;
            };
    },
});
