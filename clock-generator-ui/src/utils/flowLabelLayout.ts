export interface FlowOutputItem { name: string; label: string }

/** Conservative line wrapping at 12px, shared by layout and the rendered cards. */
function flowTextLines(text: string, width: number): number {
    const columns = Math.max(1, Math.floor(width / 12));
    let lines = 1, used = 0;
    for (const word of text.split(/\s+/)) {
        let length = [...word].length;
        if (used && used + 1 + length <= columns) { used += 1 + length; continue; }
        if (used) { lines++; used = 0; }
        while (length > columns) { lines++; length -= columns; }
        used = length;
    }
    return lines;
}

/** One grouped physical route, with every accepted item name visible without scrolling. */
export function outputLabelLayout(items: readonly FlowOutputItem[]) {
    const columns = items.length > 3 ? 2 : 1;
    const width = columns === 2 ? 360 : 184;
    const padding = 8, gap = 8;
    const cellWidth = (width - 2 * padding - 2 - (columns - 1) * gap) / columns;
    const rowHeights = Array.from({ length: Math.ceil(items.length / columns) }, (_, row) =>
        Math.max(24, ...items.slice(row * columns, (row + 1) * columns).map(item => flowTextLines(item.label, cellWidth - 24) * 16)));
    return { width, height: padding * 2 + 2 + rowHeights.reduce((sum, height) => sum + height, 0) + Math.max(0, rowHeights.length - 1) * gap,
        columns, rowHeights, padding, gap };
}

/** Ordinary machines keep their compact width; only a detailed output vector needs more room. */
export function machineDetailLayout(outputLabels: readonly string[], inputCount: number) {
    if (outputLabels.length <= 1) return { width: 200, height: 196 };
    const width = 340;
    const outputHeight = outputLabels.reduce((sum, label) => sum + Math.max(32, flowTextLines(label, width - 124) * 16) + 4, 0);
    return { width, height: Math.max(196, 104 + outputHeight + inputCount * 20) };
}
