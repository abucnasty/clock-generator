import zlib from 'zlib';
import { FactorioBlueprintFile } from './blueprint';

/**
 * Encode a blueprint file to a Factorio-compatible string (Node.js version).
 * Uses Node.js zlib for compression.
 */
export function encodeBlueprintFile(blueprint: FactorioBlueprintFile): string {
    const jsonString = JSON.stringify(blueprint);

    const deflated = zlib.deflateSync(Buffer.from(jsonString, "utf-8"));

    const base64 = deflated.toString("base64");

    return "0" + base64;
}
