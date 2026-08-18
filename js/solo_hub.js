import { app } from "../../../scripts/app.js";

const HUB_KEY = "__sickOllieSoloHub";
const STYLE_ID = "sickollie-solo-hub-style";

const ASSETS = {
    header: new URL("./solo_hub_assets/SidepanelHeader.png", import.meta.url).href,
    background: new URL("./solo_hub_assets/StudioHubBackground.webp", import.meta.url).href,
    sidebarIcon: new URL("./solo_hub_assets/SidebarSkateboard.png", import.meta.url).href,
    icons: {
        "library-review": new URL("./solo_hub_assets/LoRALibrary.png", import.meta.url).href,
        recipes: new URL("./solo_hub_assets/RecipeLibrary.png", import.meta.url).href,
        "lora-organizer": new URL("./solo_hub_assets/LoRAOrganizer.png", import.meta.url).href,
        "log-organizer": new URL("./solo_hub_assets/LogOrganizer.png", import.meta.url).href,
    },
};

const TOOL_THEME = {
    "library-review": {
        order: 0,
        accent: "#2cecff",
        rgb: "44,236,255",
        eyebrow: "BROWSE + REVIEW",
    },
    recipes: {
        order: 1,
        accent: "#ff42bd",
        rgb: "255,66,189",
        eyebrow: "SAVE + RECALL",
    },
    "lora-organizer": {
        order: 2,
        accent: "#fff04d",
        rgb: "255,240,77",
        eyebrow: "CLEAN + ORGANIZE",
    },
    "log-organizer": {
        order: 3,
        accent: "#68ff92",
        rgb: "104,255,146",
        eyebrow: "SORT + POLISH",
    },
};

function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
        .so-hub {
            position: relative;
            height: 100%;
            min-height: 100%;
            box-sizing: border-box;
            overflow-x: hidden;
            overflow-y: auto;
            padding: 18px 16px 22px;
            color: #fff;
            font-family: "Segoe UI", Arial, sans-serif;
            background-color: #0a0710;
            background-image:
                linear-gradient(180deg, rgba(5,4,9,.22) 0%, rgba(8,5,12,.36) 45%, rgba(6,4,10,.52) 100%),
                var(--so-hub-bg);
            background-position: center top, 12% top;
            background-size: auto, auto 100%;
            background-repeat: no-repeat, no-repeat;
        }
        .so-hub::before {
            content: "";
            position: absolute;
            inset: 0;
            pointer-events: none;
            background:
                radial-gradient(circle at 8% 9%, rgba(44,236,255,.07), transparent 28%),
                radial-gradient(circle at 94% 18%, rgba(255,66,189,.07), transparent 31%),
                linear-gradient(90deg, rgba(255,255,255,.015), transparent 20%, transparent 80%, rgba(255,255,255,.012));
        }
        .so-hub__inner {
            position: relative;
            z-index: 1;
        }
        .so-hub__brand {
            display: block;
            width: min(92%, 330px);
            height: auto;
            margin: 0 0 8px;
            filter: drop-shadow(0 0 9px rgba(255,236,0,.17));
        }
        .so-hub__copy {
            margin: 0 1px 16px;
            max-width: 340px;
            color: rgba(235,230,239,.76);
            font-size: 11px;
            line-height: 1.42;
            letter-spacing: .015em;
        }
        .so-hub__rule {
            height: 1px;
            margin: 0 0 13px;
            background: linear-gradient(90deg, rgba(44,236,255,.82), rgba(255,66,189,.64) 40%, rgba(255,240,77,.58) 72%, transparent);
            box-shadow: 0 0 12px rgba(44,236,255,.10);
        }
        .so-hub__list {
            display: grid;
            gap: 10px;
        }
        .so-hub-card {
            --accent: #2cecff;
            --accent-rgb: 44,236,255;
            position: relative;
            width: 100%;
            min-height: 72px;
            display: grid;
            grid-template-columns: 54px minmax(0,1fr) 22px;
            gap: 11px;
            align-items: center;
            box-sizing: border-box;
            overflow: hidden;
            padding: 9px 11px 9px 8px;
            border: 1px solid rgba(var(--accent-rgb), .62);
            border-radius: 11px;
            color: #fff;
            text-align: left;
            cursor: pointer;
            background:
                linear-gradient(105deg, rgba(var(--accent-rgb), .105), rgba(20,16,27,.93) 38%, rgba(11,9,15,.96) 100%);
            box-shadow:
                inset 0 1px 0 rgba(255,255,255,.045),
                0 5px 14px rgba(0,0,0,.22);
            transition: transform .13s ease, border-color .13s ease, box-shadow .13s ease, background .13s ease;
        }
        .so-hub-card::before {
            content: "";
            position: absolute;
            left: 0;
            top: 12px;
            bottom: 12px;
            width: 3px;
            border-radius: 0 3px 3px 0;
            background: var(--accent);
            box-shadow: 0 0 12px rgba(var(--accent-rgb), .75);
        }
        .so-hub-card::after {
            content: "";
            position: absolute;
            inset: 0;
            pointer-events: none;
            background: linear-gradient(115deg, rgba(255,255,255,.04), transparent 28%);
            opacity: .55;
        }
        .so-hub-card:hover {
            transform: translateY(-1px);
            border-color: rgba(var(--accent-rgb), .95);
            background:
                linear-gradient(105deg, rgba(var(--accent-rgb), .17), rgba(24,18,31,.95) 42%, rgba(11,9,15,.98) 100%);
            box-shadow:
                inset 0 1px 0 rgba(255,255,255,.07),
                0 0 0 1px rgba(var(--accent-rgb), .10),
                0 8px 24px rgba(0,0,0,.31),
                0 0 18px rgba(var(--accent-rgb), .11);
        }
        .so-hub-card:active {
            transform: translateY(0) scale(.994);
        }
        .so-hub-card:focus-visible {
            outline: 2px solid var(--accent);
            outline-offset: 2px;
        }
        .so-hub-card__icon-wrap {
            width: 52px;
            height: 52px;
            display: grid;
            place-items: center;
            border: 1px solid rgba(var(--accent-rgb), .20);
            border-radius: 9px;
            background: rgba(4,4,8,.52);
            box-shadow: inset 0 0 15px rgba(var(--accent-rgb), .045);
        }
        .so-hub-card__icon {
            width: 46px;
            height: 46px;
            object-fit: contain;
            pointer-events: none;
            user-select: none;
        }
        .so-hub-card__text {
            min-width: 0;
            position: relative;
            z-index: 1;
        }
        .so-hub-card__eyebrow {
            margin-top: 3px;
            color: var(--accent);
            font-size: 8px;
            font-weight: 850;
            line-height: 1.1;
            letter-spacing: .11em;
            opacity: .92;
        }
        .so-hub-card__label {
            overflow: hidden;
            color: #fff;
            font-size: 13px;
            font-weight: 850;
            line-height: 1.16;
            text-overflow: ellipsis;
            white-space: nowrap;
            letter-spacing: .008em;
        }
        .so-hub-card__description {
            display: -webkit-box;
            overflow: hidden;
            margin-top: 2px;
            color: rgba(237,232,241,.61);
            font-size: 9px;
            font-weight: 500;
            line-height: 1.22;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 2;
        }
        .so-hub-card__arrow {
            position: relative;
            z-index: 1;
            color: var(--accent);
            font-size: 18px;
            font-weight: 300;
            line-height: 1;
            text-align: center;
            opacity: .66;
            transition: transform .13s ease, opacity .13s ease;
        }
        .so-hub-card:hover .so-hub-card__arrow {
            transform: translateX(2px);
            opacity: 1;
        }

        .so-sidebar-tab-skateboard {
            width: 24px !important;
            height: 24px !important;
            max-width: 24px !important;
            max-height: 24px !important;
            flex: 0 0 24px !important;
            display: block !important;
            margin: 0 auto !important;
            object-fit: contain;
            pointer-events: none;
            opacity: .82;
            filter: none;
        }
        [data-sickollie-sos-tab="1"] {
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: center !important;
            gap: 3px !important;
        }
        [data-sickollie-sos-tab="1"] .p-button-label {
            flex: 0 0 auto !important;
            width: auto !important;
            margin: 0 !important;
            font-size: 10px !important;
            line-height: 1 !important;
            text-align: center !important;
        }
        [data-sickollie-sos-tab="1"]:hover .so-sidebar-tab-skateboard,
        [data-sickollie-sos-tab="1"][aria-selected="true"] .so-sidebar-tab-skateboard,
        [data-sickollie-sos-tab="1"].active .so-sidebar-tab-skateboard {
            opacity: 1;
            filter: drop-shadow(0 0 2px rgba(255,255,255,.25));
        }

        @media (max-width: 330px) {
            .so-hub { padding-inline: 11px; }
            .so-hub-card { grid-template-columns: 48px minmax(0,1fr) 18px; gap: 8px; }
            .so-hub-card__icon-wrap { width: 46px; height: 46px; }
            .so-hub-card__icon { width: 40px; height: 40px; }
            .so-hub-card__description { display: none; }
        }
    `;
    document.head.appendChild(style);
}

function cleanLabel(label = "") {
    return String(label)
        .replace(/^[^A-Za-z0-9]+\s*/u, "")
        .replace(/\s{2,}/g, " ")
        .trim();
}

function orderedItems(items) {
    return [...items.values()].sort((a, b) => {
        const ao = TOOL_THEME[a.id]?.order ?? 999;
        const bo = TOOL_THEME[b.id]?.order ?? 999;
        return ao - bo || String(a.label).localeCompare(String(b.label));
    });
}

function makeToolCard(item) {
    const theme = TOOL_THEME[item.id] || {
        accent: item.color || "#2cecff",
        rgb: "44,236,255",
        eyebrow: "OPEN TOOL",
    };
    const button = document.createElement("button");
    button.type = "button";
    button.className = "so-hub-card";
    button.style.setProperty("--accent", theme.accent);
    button.style.setProperty("--accent-rgb", theme.rgb);
    button.title = item.description || cleanLabel(item.label);
    button.setAttribute("aria-label", cleanLabel(item.label));

    const iconWrap = document.createElement("span");
    iconWrap.className = "so-hub-card__icon-wrap";
    const icon = document.createElement("img");
    icon.className = "so-hub-card__icon";
    icon.src = ASSETS.icons[item.id] || ASSETS.icons["library-review"];
    icon.alt = "";
    icon.draggable = false;
    iconWrap.append(icon);

    const text = document.createElement("span");
    text.className = "so-hub-card__text";
    const eyebrow = document.createElement("span");
    eyebrow.className = "so-hub-card__eyebrow";
    eyebrow.textContent = theme.eyebrow;
    const label = document.createElement("span");
    label.className = "so-hub-card__label";
    label.textContent = cleanLabel(item.label);
    const description = document.createElement("span");
    description.className = "so-hub-card__description";
    description.textContent = item.description || "";
    text.append(label, eyebrow, description);

    const arrow = document.createElement("span");
    arrow.className = "so-hub-card__arrow";
    arrow.setAttribute("aria-hidden", "true");
    arrow.textContent = "›";

    button.append(iconWrap, text, arrow);
    button.addEventListener("click", () => item.open?.());
    return button;
}

function decorateSidebarTab() {
    installStyles();
    const targets = [...document.querySelectorAll('button, [role="tab"], .p-button')];
    for (const el of targets) {
        const haystack = [el.getAttribute("title"), el.getAttribute("aria-label"), el.dataset?.tabId, el.textContent].filter(Boolean).join(" ");
        if (!/Sick Ollie Studio|\bSOS\b/.test(haystack)) continue;

        el.dataset.sickollieSosTab = "1";
        el.style.setProperty("display", "flex", "important");
        el.style.setProperty("flex-direction", "column", "important");
        el.style.setProperty("align-items", "center", "important");
        el.style.setProperty("justify-content", "center", "important");
        el.style.setProperty("gap", "3px", "important");

        for (const oldIcon of el.querySelectorAll('i, .pi, .p-button-icon, svg')) {
            if (!oldIcon.classList?.contains("so-sidebar-tab-skateboard")) oldIcon.style.setProperty('display', 'none', 'important');
        }

        let img = el.querySelector('.so-sidebar-tab-skateboard');
        if (!img) {
            img = document.createElement('img');
            img.className = 'so-sidebar-tab-skateboard';
            img.src = ASSETS.sidebarIcon;
            img.alt = '';
            img.draggable = false;
            el.prepend(img);
        }
        Object.assign(img.style, { width: "19px", height: "19px", maxWidth: "19px", maxHeight: "19px", display: "block", margin: "0 auto", objectFit: "contain" });
        img.style.setProperty("flex", "0 0 19px", "important");

        const label = el.querySelector('.p-button-label');
        if (label) {
            label.style.setProperty("flex", "0 0 auto", "important");
            label.style.setProperty("width", "auto", "important");
            label.style.setProperty("margin", "0", "important");
            label.style.setProperty("font-size", "10px", "important");
            label.style.setProperty("line-height", "1", "important");
            label.style.setProperty("text-align", "center", "important");
        }
    }
}

function watchSidebarTab() {
    if (window.__sickOllieSosSidebarObserver) return;
    let queued = false;
    const observer = new MutationObserver(() => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; decorateSidebarTab(); });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    window.__sickOllieSosSidebarObserver = observer;
}

function hub() {
    if (window[HUB_KEY]) return window[HUB_KEY];
    const state = { items: new Map(), container: null, installed: false };

    state.render = () => {
        if (!state.container) return;
        installStyles();
        Object.assign(state.container.style, { position: "relative", height: "100%", minHeight: "0", overflow: "hidden" });

        const root = document.createElement("div");
        root.className = "so-hub";
        root.style.setProperty("--so-hub-bg", `url("${ASSETS.background}")`);

        const inner = document.createElement("div");
        inner.className = "so-hub__inner";

        const brand = document.createElement("img");
        brand.className = "so-hub__brand";
        brand.src = ASSETS.header;
        brand.alt = "Sick Ollie Studio";
        brand.draggable = false;

        const copy = document.createElement("p");
        copy.className = "so-hub__copy";
        copy.textContent = "Library, organization, review, and recipe tools in one neon little command center.";
        decorateSidebarTab();

        const rule = document.createElement("div");
        rule.className = "so-hub__rule";
        rule.setAttribute("aria-hidden", "true");

        const list = document.createElement("div");
        list.className = "so-hub__list";
        for (const item of orderedItems(state.items)) list.append(makeToolCard(item));

        inner.append(brand, copy, rule, list);
        root.append(inner);
        state.container.replaceChildren(root);
    };

    state.install = () => {
        if (state.installed || !app.extensionManager?.registerSidebarTab) return;
        try {
            app.extensionManager.registerSidebarTab({
                id: "sickollie-solo-hub",
                icon: "pi pi-sparkles",
                title: "SOS",
                tooltip: "Sick Ollie Studio",
                type: "custom",
                render: element => {
                    state.container = element;
                    state.render();
                },
            });
            state.installed = true;
            installStyles();
            watchSidebarTab();
            requestAnimationFrame(() => { decorateSidebarTab(); setTimeout(decorateSidebarTab, 50); });
        } catch {
            // A hot reload can try to add the same tab twice.
        }
    };

    window[HUB_KEY] = state;
    window.SickOllieRegisterSoloHubItem = item => {
        state.items.set(item.id, item);
        state.install();
        state.render();
    };
    return state;
}

export function registerSoloHubItem(item) {
    const state = hub();
    state.items.set(item.id, item);
    state.install();
    state.render();
}
