import pako from 'pako';
import { FactorioBlueprintFile } from './blueprint';

/**
 * Encode a blueprint file to a Factorio-compatible string (Browser version).
 * Uses pako for compression, compatible with browser environments.
 */
export function encodeBlueprintFileBrowser(blueprint: FactorioBlueprintFile): string {
    const jsonString = JSON.stringify(blueprint);

    const deflated = pako.deflate(new TextEncoder().encode(jsonString));

    // Convert Uint8Array to base64
    const base64 = btoa(String.fromCharCode(...deflated));

    return "0" + base64;
}

/**
 * Decode a Factorio blueprint string to a blueprint file (Browser version).
 * Uses pako for decompression, compatible with browser environments.
 */
export function decodeBlueprintFileBrowser(blueprintString: string): FactorioBlueprintFile {
    // Remove the version prefix ("0")
    const base64 = blueprintString.slice(1);

    // Decode base64 to Uint8Array
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }

    // Inflate and decode
    const inflated = pako.inflate(bytes);
    const jsonString = new TextDecoder().decode(inflated);

    return JSON.parse(jsonString) as FactorioBlueprintFile;
}