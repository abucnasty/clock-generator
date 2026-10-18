// @ts-check
const fs = require("node:fs/promises");
const path = require("node:path");

const JPEG_QUALITY = 82;

/** Frame the actual built entity bounds, including two tiles of margin, within a documentation-sized image.
 * @param {{left_top: {x: number, y: number}, right_bottom: {x: number, y: number}}} area
 */
function screenshotFrame(area) {
    const width = area.right_bottom.x - area.left_top.x + 4;
    const height = area.right_bottom.y - area.left_top.y + 4;
    if (![width, height, area.left_top.x, area.left_top.y].every(Number.isFinite) || width <= 4 || height <= 4) {
        throw new Error("Screenshot needs nonempty finite entity bounds");
    }
    const zoom = Math.min(1.5, 1920 / (width * 32), 1440 / (height * 32));
    return {
        position: { x: (area.left_top.x + area.right_bottom.x) / 2, y: (area.left_top.y + area.right_bottom.y) / 2 },
        resolution: { x: Math.ceil(width * 32 * zoom), y: Math.ceil(height * 32 * zoom) }, zoom,
    };
}

/** Keep native PNGs in the capture directory; only the compressed JPEG belongs in documentation.
 * @param {string} png
 * @param {string} jpeg
 */
async function compressScreenshot(png, jpeg) {
    const { default: sharp } = await import("sharp");
    if (!/\.jpe?g$/i.test(jpeg)) throw new Error("Documentation screenshot output must end in .jpg or .jpeg");
    await fs.mkdir(path.dirname(jpeg), { recursive: true });
    const temporary = `${jpeg}.tmp`;
    try {
        const result = await sharp(png).jpeg({ quality: JPEG_QUALITY, mozjpeg: true, chromaSubsampling: "4:4:4" }).toFile(temporary);
        await fs.rename(temporary, jpeg);
        return { width: result.width, height: result.height, png_bytes: (await fs.stat(png)).size,
            jpeg_bytes: result.size, jpeg_quality: JPEG_QUALITY };
    } finally {
        await fs.rm(temporary, { force: true });
    }
}

module.exports = { screenshotFrame, compressScreenshot, JPEG_QUALITY };
