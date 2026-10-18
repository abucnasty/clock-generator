import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { expect, test } from "vitest";
import { compressScreenshot, screenshotFrame } from "./scaffold-screenshot";

test("fits wide and tall scaffolds without cropping the entity bounds or their margin", () => {
    for (const [width, height] of [[100, 10], [10, 100], [24, 17]]) {
        const frame = screenshotFrame({ left_top: { x: -7, y: 30 }, right_bottom: { x: -7 + width, y: 30 + height } });
        expect(frame.position).toEqual({ x: -7 + width / 2, y: 30 + height / 2 });
        expect(frame.resolution.x).toBeLessThanOrEqual(1920);
        expect(frame.resolution.y).toBeLessThanOrEqual(1440);
        expect(frame.resolution.x / (32 * frame.zoom)).toBeGreaterThanOrEqual(width + 4);
        expect(frame.resolution.y / (32 * frame.zoom)).toBeGreaterThanOrEqual(height + 4);
    }
});

test("writes a real JPEG with the native PNG's dimensions and retains the PNG", async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "scaffold-jpeg-"));
    try {
        const png = path.join(folder, "native.png"), jpeg = path.join(folder, "docs/image.jpg");
        await sharp({ create: { width: 96, height: 64, channels: 4, background: "#c07030" } }).png().toFile(png);
        const result = await compressScreenshot(png, jpeg);
        expect(await sharp(jpeg).metadata()).toMatchObject({ format: "jpeg", width: 96, height: 64 });
        expect(result.jpeg_bytes).toBe((await fs.stat(jpeg)).size);
        expect(result.png_bytes).toBe((await fs.stat(png)).size);
        expect((await fs.readdir(path.dirname(jpeg)))).toEqual(["image.jpg"]);
    } finally { await fs.rm(folder, { recursive: true, force: true }); }
});

test("every local mechanics blueprint has a distinct screenshot catalog entry", async () => {
    const mechanics = path.resolve(__dirname, "../mechanics");
    const catalog = JSON.parse(await fs.readFile(path.join(mechanics, "screenshots.json"), "utf8")) as { id: string; blueprint: string; image: string }[];
    const blueprints = (await fs.readdir(mechanics, { recursive: true })).filter(file => file.endsWith(".txt"));
    for (const file of blueprints) expect(catalog.some(item => item.blueprint === file)).toBe(true);
    expect(new Set(catalog.map(item => item.id)).size).toBe(catalog.length);
    expect(new Set(catalog.map(item => item.image)).size).toBe(catalog.length);
    for (const item of catalog) {
        expect(item.image).toMatch(/\.jpg$/);
        await fs.access(path.resolve(mechanics, item.blueprint));
    }
});
