import type { Config } from 'clock-generator/browser';
import { cleanName, recipeTitle } from './buildLibrary';
import { formatNumberText } from './numberText';
import { countOf } from './undoSnapshot';

/**
 * Share links: `{origin}{pathname}#build=1.{data}`, where `{data}` is base64url (no padding) of the deflate-raw bytes
 * of the UTF-8 of `JSON.stringify({ name, config })`. The part after `#` never reaches the server. The browser's own
 * CompressionStream does the compression (Chrome and Edge 103+, Firefox 113+, Safari 16.4+), so there is no library.
 * The `1` versions only this wrapper; the build inside is read and checked as a build file is, which migrates old ones.
 */

const SHARE_PARAM = 'build';
const SHARE_VERSION = 1;
/** No link is made, or opened, past this many characters (about 20 times the biggest real build) */
export const MAX_LINK_CHARS = 64_000;
/** Decompression stops past this many bytes, so a crafted link cannot inflate to gigabytes */
export const MAX_JSON_BYTES = 1_000_000;
/** Some chats cut a message past this (Discord allows 2,000 characters) */
const LONG_LINK_CHARS = 2_000;

export interface SharedBuild {
    /** The sender's name for it; null when it is named after its target recipe */
    name: string | null;
    config: Config;
}

type ShareProblem = 'broken' | 'newer-version' | 'too-big' | 'unsupported';

/** Whether this browser can make and open share links */
export function canShare(): boolean {
    return typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
}

function toBase64Url(bytes: Uint8Array): string {
    let binary = '';
    // in chunks, as an argument list has a limit
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Null when the text is not base64url */
function fromBase64Url(text: string): Uint8Array | null {
    if (!/^[A-Za-z0-9_-]*$/.test(text) || text.length % 4 === 1) return null;
    try {
        const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes;
    } catch {
        return null;
    }
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The inflated bytes, read chunk by chunk; 'too-big' as soon as they pass `limit` */
async function inflate(bytes: Uint8Array, limit: number): Promise<Uint8Array | 'too-big'> {
    const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) {
            await reader.cancel().catch(() => {});
            return 'too-big';
        }
        chunks.push(value);
    }
    const out = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
        out.set(chunk, at);
        at += chunk.byteLength;
    }
    return out;
}

/** The link that carries the build; `base` is the page's address without its hash */
export async function encodeShareLink(payload: { name: string | null; config: Config }, base: string): Promise<string> {
    const json = JSON.stringify({ name: payload.name, config: payload.config });
    const data = toBase64Url(await deflate(new TextEncoder().encode(json)));
    return `${base}#${SHARE_PARAM}=${SHARE_VERSION}.${data}`;
}

/** The share link in a page's hash, if it has one: only `#build=<version>.<data>` */
export function readShareHash(hash: string): { kind: 'none' } | { kind: 'link'; version: string; data: string } {
    const prefix = `#${SHARE_PARAM}=`;
    if (!hash.startsWith(prefix)) return { kind: 'none' };
    const rest = hash.slice(prefix.length);
    const dot = rest.indexOf('.');
    return dot === -1 ? { kind: 'link', version: rest, data: '' } : { kind: 'link', version: rest.slice(0, dot), data: rest.slice(dot + 1) };
}

/**
 * The build a link carries, not yet checked as a build file; or why it cannot be opened: broken (cut short, not
 * base64url, not deflate, not JSON, or the wrong shape), made by a newer version of the site, too big, or a browser
 * without the streams
 */
export async function decodeShareLink(link: { version: string; data: string }):
    Promise<{ kind: 'build'; name: string | null; config: unknown } | { kind: 'problem'; problem: ShareProblem }> {
    const problem = (kind: ShareProblem) => ({ kind: 'problem' as const, problem: kind });
    if (!/^[1-9][0-9]*$/.test(link.version)) return problem('broken');
    if (Number(link.version) > SHARE_VERSION) return problem('newer-version');
    if (!canShare()) return problem('unsupported');
    if (link.data.length > MAX_LINK_CHARS) return problem('too-big');
    const bytes = link.data === '' ? null : fromBase64Url(link.data);
    if (bytes === null) return problem('broken');
    let parsed: unknown;
    try {
        const inflated = await inflate(bytes, MAX_JSON_BYTES);
        if (inflated === 'too-big') return problem('too-big');
        parsed = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(inflated));
    } catch {
        return problem('broken');
    }
    if (typeof parsed !== 'object' || parsed === null) return problem('broken');
    const { name, config } = parsed as Record<string, unknown>;
    if (typeof config !== 'object' || config === null || Array.isArray(config)) return problem('broken');
    return { kind: 'build', name: typeof name === 'string' ? cleanName(name) : null, config };
}

/** Whether a link of this length can be shared: fine, long for some chats, or too long to make */
export function shareLinkNotice(length: number): 'ok' | 'long' | 'too-long' {
    if (length > MAX_LINK_CHARS) return 'too-long';
    return length > LONG_LINK_CHARS ? 'long' : 'ok';
}

/**
 * "Logistic science pack at 240/s · 11 copies · 1 machine, 3 inserters, 2 belts", leaving out what there is none of.
 * Without `withRecipe` it starts at the rate, for a build already named after its recipe in the line above.
 */
export function sharedBuildSummary(config: Config, recipeLabel: (id: string) => string, { withRecipe = true } = {}): string {
    const { recipe, items_per_second, copies, counts: targetCounts } = config.target_output;
    const counts = [
        [config.machines.length, 'machine', 'machines'],
        [config.drills?.configs.length ?? 0, 'drill', 'drills'],
        [config.inserters.length, 'inserter', 'inserters'],
        [config.belts.length, 'belt', 'belts'],
        [config.chests?.length ?? 0, 'chest', 'chests'],
    ] as const;
    const rate = `${formatNumberText(items_per_second)}/s${targetCounts === 'destroyed' ? ' destroyed' : ''}`;
    const parts = [
        withRecipe ? `${recipe === '' ? 'No target recipe' : recipeTitle(recipe, recipeLabel)} at ${rate}` : rate,
        countOf(copies, 'copy', 'copies'),
    ];
    const entities = counts.filter(([n]) => n > 0).map(([n, one, many]) => countOf(n, one, many));
    if (entities.length > 0) parts.push(entities.join(', '));
    return parts.join(' · ');
}

// ---- the words, in one place

export const SHARE_COPIED_MESSAGE = 'Share link copied. Anyone who opens it gets a copy of this build.';
export const SHARE_TOO_BIG_MESSAGE = 'This build is too big for a share link. Use Save build file to share it.';
export const SHARE_UNSUPPORTED_MESSAGE = 'This browser cannot make or open share links. Update it, or use Save build file.';
export const SHARE_FALLBACK_TEXT = 'Your browser did not let this page copy. Copy the link below:';
export const SHARE_PROBLEM_MESSAGES: Record<ShareProblem, string> = {
    broken: 'This share link is broken or was cut short, so nothing was opened. Ask for the link again.',
    'newer-version': 'This share link was made by a newer version of the site. Reload the page, then open the link again.',
    'too-big': 'This share link is too big to open. Ask for the build file instead.',
    unsupported: SHARE_UNSUPPORTED_MESSAGE,
};

export function shareLongMessage(length: number): string {
    return `Share link copied. It is ${length.toLocaleString('en-US')} characters long, too long for some chats (Discord allows 2,000). `
        + 'Save build file is the safer way to share this build.';
}

export function shareInvalidMessage(engineMessage: string): string {
    return `The build in this share link has a problem, so nothing was opened: ${engineMessage}`;
}

export function sharedOpenedMessage(name: string): string {
    return `Shared build opened: ${name}.`;
}

/** Where the shared build goes, said in the dialog that asks first */
export function sharedPlaceNote(replacesBlank: boolean, currentTitle: string): string {
    return replacesBlank
        ? 'It takes the place of your empty build.'
        : `It is added to Your builds as a new build. The build open now, ${currentTitle}, stays as it is.`;
}
