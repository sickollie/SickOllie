/*
 * Shared visual language for the four Sick Ollie Studio Core dashboards.
 * Classic nodes intentionally do not import this module.
 */

export const STUDIO_LAYOUT = Object.freeze({
    minWidth: 820,
    pad: 12,
    gap: 8,
    rowHeight: 36,
    headerHeight: 96,
    socketStart: 120,
    socketStep: 21,
    socketGap: 12,
    sectionGap: 10,
    bottomPad: 18,
});

export const STUDIO_THEME = Object.freeze({
    cyan: "#35d7ff",
    magenta: "#ff4ab8",
    yellow: "#f6e65a",
    green: "#6ee7a2",
    ink: "#08070c",
    panel: "rgba(19,17,25,.985)",
    row: "rgba(38,36,45,.985)",
    rowHover: "rgba(48,45,57,.99)",
    outline: "rgba(151,141,165,.34)",
    label: "#a7a0b0",
    text: "#f4f1f6",
    title: "#1b1721",
    body: "#08070c",
});

const HEADER_ASSETS = Object.freeze({
    // Versioned filenames intentionally bust ComfyUI/browser image caches when
    // the authored lockups change without changing the extension module URL.
    loader: "HeaderBrandingLoaderCore_v2_1_1.png",
    prompt: "HeaderBrandingPromptCore_v2_1_1.png",
    generation: "HeaderBrandingGenerationCore_v2_1_1.png",
    output: "HeaderBrandingOutputCore_v2_1_1.png",
});

const IMAGE_CACHE = new Map();
const IMAGE_BOUNDS_CACHE = new WeakMap();

function roundedPath(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    if (ctx.roundRect) {
        ctx.roundRect(x, y, width, height, radius);
        return;
    }
    const r = Math.min(radius, width / 2, height / 2);
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
}

function imageAsset(filename, node) {
    const cached = IMAGE_CACHE.get(filename);
    if (cached) {
        if (node && !cached.image.complete) cached.nodes.add(node);
        return cached.image;
    }
    const image = new Image();
    const entry = { image, nodes: new Set(node ? [node] : []) };
    image.decoding = "async";
    const refreshNodes = () => {
        for (const target of entry.nodes) target?.setDirtyCanvas?.(true, true);
        entry.nodes.clear();
    };
    image.onload = refreshNodes;
    image.onerror = refreshNodes;
    image.src = new URL(`./assets/${filename}`, import.meta.url).href;
    IMAGE_CACHE.set(filename, entry);
    return image;
}

function drawImageCover(ctx, image, x, y, width, height) {
    if (!image?.complete || !image.naturalWidth || !image.naturalHeight) return;
    const sourceRatio = image.naturalWidth / image.naturalHeight;
    const targetRatio = width / height;
    let sx = 0, sy = 0, sw = image.naturalWidth, sh = image.naturalHeight;
    if (sourceRatio > targetRatio) {
        sw = sh * targetRatio;
        sx = (image.naturalWidth - sw) / 2;
    } else {
        sh = sw / targetRatio;
        sy = (image.naturalHeight - sh) / 2;
    }
    ctx.drawImage(image, sx, sy, sw, sh, x, y, width, height);
}

function visibleImageBounds(image) {
    const cached = IMAGE_BOUNDS_CACHE.get(image);
    if (cached) return cached;
    const fallback = { x: 0, y: 0, width: image?.naturalWidth || 1, height: image?.naturalHeight || 1 };
    if (!image?.complete || !image.naturalWidth || !image.naturalHeight) return fallback;

    try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        const scan = canvas.getContext("2d", { willReadFrequently: true });
        scan.drawImage(image, 0, 0);
        const pixels = scan.getImageData(0, 0, canvas.width, canvas.height).data;
        let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
        for (let py = 0; py < canvas.height; py++) {
            for (let px = 0; px < canvas.width; px++) {
                if (pixels[(py * canvas.width + px) * 4 + 3] <= 4) continue;
                if (px < left) left = px;
                if (px > right) right = px;
                if (py < top) top = py;
                if (py > bottom) bottom = py;
            }
        }
        if (right < left || bottom < top) throw new Error("empty transparent image");
        const padding = Math.max(8, Math.round(image.naturalHeight * .035));
        const bounds = {
            x: Math.max(0, left - padding),
            y: Math.max(0, top - padding),
            width: Math.min(canvas.width, right + padding + 1) - Math.max(0, left - padding),
            height: Math.min(canvas.height, bottom + padding + 1) - Math.max(0, top - padding),
        };
        IMAGE_BOUNDS_CACHE.set(image, bounds);
        return bounds;
    } catch (error) {
        IMAGE_BOUNDS_CACHE.set(image, fallback);
        return fallback;
    }
}

function drawHeaderBrand(ctx, image, x, y, maxWidth, maxHeight) {
    if (!image?.complete || !image.naturalWidth || !image.naturalHeight) return;
    // Fit the actual visible lockup rather than a hard-coded source rectangle.
    // This preserves authored safe margins, prevents lower text from clipping,
    // and keeps differently sized Core titles visually consistent.
    const bounds = visibleImageBounds(image);
    const scale = Math.min(maxWidth / bounds.width, maxHeight / bounds.height);
    const drawnWidth = bounds.width * scale;
    const drawnHeight = bounds.height * scale;
    ctx.drawImage(
        image,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        x,
        y + (maxHeight - drawnHeight) / 2,
        drawnWidth,
        drawnHeight,
    );
}

export function applyStudioNodeColors(node) {
    node.color = STUDIO_THEME.title;
    node.bgcolor = STUDIO_THEME.body;
    node.boxcolor = STUDIO_THEME.magenta;
}

export function drawStudioChrome(node, ctx, coreName) {
    if (!node?.size || node.flags?.collapsed) return;
    const width = Number(node.size[0] || STUDIO_LAYOUT.minWidth);
    const height = Number(node.size[1] || STUDIO_LAYOUT.headerHeight);
    const headerHeight = STUDIO_LAYOUT.headerHeight;
    const texture = imageAsset("StudioHeaderTexture.png", node);
    const branding = imageAsset(HEADER_ASSETS[coreName], node);

    ctx.save();

    roundedPath(ctx, 1, 1, width - 2, headerHeight - 1, 10);
    ctx.clip();
    ctx.fillStyle = "#100b17";
    ctx.fillRect(0, 0, width, headerHeight);
    drawImageCover(ctx, texture, 0, 0, width, headerHeight);

    const shade = ctx.createLinearGradient(0, 0, width, 0);
    shade.addColorStop(0, "rgba(8,5,12,.02)");
    shade.addColorStop(.58, "rgba(8,5,12,.48)");
    shade.addColorStop(1, "rgba(8,5,12,.88)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, width, headerHeight);
    ctx.restore();

    ctx.save();
    drawHeaderBrand(ctx, branding, 14, 8, Math.min(460, width * .58), 80);

    const pillWidth = 67;
    const pillX = width - pillWidth - 15;
    roundedPath(ctx, pillX, 13, pillWidth, 20, 10);
    ctx.fillStyle = "rgba(20,12,29,.76)";
    ctx.fill();
    ctx.strokeStyle = "rgba(53,215,255,.52)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#bdeeff";
    ctx.font = "700 9px Segoe UI, Arial";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("STUDIO", pillX + pillWidth / 2, 23);

    const accent = ctx.createLinearGradient(0, 0, width, 0);
    accent.addColorStop(0, STUDIO_THEME.magenta);
    accent.addColorStop(.55, STUDIO_THEME.cyan);
    accent.addColorStop(1, "rgba(53,215,255,0)");
    ctx.fillStyle = accent;
    ctx.fillRect(0, headerHeight - 2, width, 2);

    roundedPath(ctx, .75, .75, width - 1.5, Math.max(1, height - 1.5), 11);
    ctx.strokeStyle = "rgba(255,74,184,.42)";
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.restore();
}

export function drawStudioSectionFrame(
    ctx,
    x,
    y,
    width,
    height,
    accent = STUDIO_THEME.magenta,
    radius = 9,
    alpha = .52,
) {
    ctx.save();
    roundedPath(ctx, x, y, width, height, radius);
    ctx.fillStyle = STUDIO_THEME.panel;
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.15;
    ctx.stroke();
    ctx.globalAlpha = 1;

    const wash = ctx.createLinearGradient(x, y, x + Math.min(width, 260), y);
    wash.addColorStop(0, `${accent}16`);
    wash.addColorStop(1, `${accent}00`);
    ctx.fillStyle = wash;
    roundedPath(ctx, x + 1, y + 1, width - 2, Math.min(27, height - 2), Math.max(2, radius - 1));
    ctx.fill();
    ctx.restore();
}
