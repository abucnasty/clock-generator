import { axisTicks } from '../utils/wakeWindows';
import { COLOR_BLIND_PALETTE as colors } from '../components/colors';

/** Browser rendering of belt-charts/src/charts/constants.ts and styles.ts (belt-charts 1.24). */
export const BELT_CHART = {
    background: '#000000', row: '#0b0b0b', grid: '#303030', edge: '#585858', text: '#ffffff', muted: '#bcbcbc',
    entity: { machine: colors.blue, inserter: colors.yellow, drill: colors.reddishPurple },
} as const;

export type ChartPattern = 'solid' | 'diagonal' | 'dots' | 'horizontal';
export interface ItemChartStyle { color: string; pattern: ChartPattern }
const ITEM_COLORS = [colors.blue, colors.orange, colors.green, colors.skyBlue, colors.vermillion, colors.reddishPurple, colors.yellow];
const PATTERNS: ChartPattern[] = ['solid', 'diagonal', 'dots', 'horizontal'];

/** Matching belt-charts: reuse hues with a new pattern before repeating a colour/pattern pair. */
export function itemChartStyles(items: Iterable<string>): Map<string, ItemChartStyle> {
    return new Map([...new Set(items)].sort().map((item, index) => [item, {
        color: ITEM_COLORS[index % ITEM_COLORS.length],
        pattern: PATTERNS[Math.floor(index / ITEM_COLORS.length) % PATTERNS.length],
    }]));
}

export function patternBackground({ color, pattern }: ItemChartStyle): string {
    if (pattern === 'diagonal') return `repeating-linear-gradient(135deg, transparent 0 5px, #000000 5px 7px), linear-gradient(${color}, ${color})`;
    if (pattern === 'dots') return `radial-gradient(#000000 1.2px, transparent 1.2px) 0 0 / 7px 7px, linear-gradient(${color}, ${color})`;
    if (pattern === 'horizontal') return `repeating-linear-gradient(0deg, transparent 0 4px, #000000 4px 5px), linear-gradient(${color}, ${color})`;
    return color;
}

export function statusPattern(category: string): ChartPattern {
    return category === 'WAITING' ? 'diagonal' : category === 'BLOCKED' ? 'dots' : category === 'DISABLED' ? 'horizontal' : 'solid';
}

/** Same motifs as the CSS swatches, cached by the renderer rather than per transition. */
export function canvasChartFill(context: CanvasRenderingContext2D, style: ItemChartStyle): string | CanvasPattern {
    if (style.pattern === 'solid') return style.color;
    const tile = document.createElement('canvas');
    tile.width = tile.height = style.pattern === 'dots' ? 7 : 8;
    const paint = tile.getContext('2d');
    if (!paint) return style.color;
    paint.fillStyle = style.color;
    paint.fillRect(0, 0, tile.width, tile.height);
    paint.strokeStyle = paint.fillStyle = '#000000';
    paint.lineWidth = 2;
    if (style.pattern === 'dots') {
        paint.beginPath(); paint.arc(0, 0, 1.2, 0, Math.PI * 2); paint.fill();
        paint.beginPath(); paint.arc(7, 7, 1.2, 0, Math.PI * 2); paint.fill();
    } else if (style.pattern === 'horizontal') paint.fillRect(0, 4, 8, 1);
    else {
        paint.beginPath(); paint.moveTo(-4, 8); paint.lineTo(4, 0); paint.moveTo(4, 8); paint.lineTo(12, 0); paint.stroke();
    }
    return context.createPattern(tile, 'repeat') ?? style.color;
}

/** All timeline rows share the same plotting grid, including the canvas based state chart. */
const chartTrackSx = {
    bgcolor: BELT_CHART.background, borderRadius: 0,
    backgroundImage: `linear-gradient(to right, ${BELT_CHART.grid} 1px, transparent 1px)`,
    backgroundSize: `${100 / 6}% 100%`,
    borderBottom: `1px solid ${BELT_CHART.grid}`,
} as const;

export function chartGridSx(duration: number) {
    const marks = axisTicks(duration, 7);
    return { ...chartTrackSx, backgroundSize: `${duration > 0 ? ((marks[1] ?? duration) / duration) * 100 : 100}% 100%` };
}
