import pako from 'pako';
import { FactorioBlueprintFile } from './blueprint';

/** Bytes passed to one `String.fromCharCode` call; an argument list has a limit, and a worker's stack is small */
const BASE64_CHUNK_BYTES = 0x8000;

/**
 * Encode a blueprint file to a Factorio-compatible string (Browser version).
 * Uses pako for compression, compatible with browser environments.
 */
export function encodeBlueprintFileBrowser(blueprint: FactorioBlueprintFile): string {
    const jsonString = JSON.stringify(blueprint);

    const deflated = pako.deflate(new TextEncoder().encode(jsonString));

    // Convert Uint8Array to base64, in chunks: one argument per byte overflows the stack of a web worker
    let binary = '';
    for (let i = 0; i < deflated.length; i += BASE64_CHUNK_BYTES) {
        binary += String.fromCharCode(...deflated.subarray(i, i + BASE64_CHUNK_BYTES));
    }
    const base64 = btoa(binary);

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