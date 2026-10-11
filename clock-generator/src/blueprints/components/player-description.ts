/** Factorio does not keep more than this many bytes of the description of a combinator. */
export const MAX_PLAYER_DESCRIPTION_BYTES = 500;

const ELLIPSIS = "...";

function byteLength(text: string): number {
    return new TextEncoder().encode(text).length;
}

/** The longest start of the text that is at most `limit` bytes, without cutting a character in half */
function truncateToBytes(text: string, limit: number): string {
    let result = "";
    for (const character of text) {
        if (byteLength(result + character) > limit) {
            break;
        }
        result += character;
    }
    return result;
}

/**
 * The lines of a description as the text Factorio keeps: at most 500 bytes. The lines come in order of how much they
 * matter. When they do not all fit, the lines that do are kept and an ellipsis marks that there were more; a first
 * line that is too long on its own is cut.
 */
export function fitPlayerDescription(lines: readonly string[], limit: number = MAX_PLAYER_DESCRIPTION_BYTES): string {
    const text = lines.join("\n");
    if (byteLength(text) <= limit) {
        return text;
    }

    const room = limit - byteLength("\n" + ELLIPSIS);
    const kept: string[] = [];
    for (const line of lines) {
        const candidate = [...kept, line].join("\n");
        if (byteLength(candidate) > room) {
            break;
        }
        kept.push(line);
    }
    if (kept.length === 0) {
        return truncateToBytes(lines[0] ?? "", limit - byteLength(ELLIPSIS)) + ELLIPSIS;
    }
    return kept.join("\n") + "\n" + ELLIPSIS;
}
