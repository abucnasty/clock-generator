import { describe, expect, it } from 'vitest';
import { BELT_CHART, itemChartStyles } from './beltCharts';
import { contrastRatio } from './contrast';

describe('belt-charts identity', () => {
    it('keeps every plotted brand hue visible on the actual black plotting surface', () => {
        const styles = itemChartStyles(Array.from({ length: 28 }, (_, index) => String(index).padStart(2, '0')));
        expect(BELT_CHART.background).toBe('#000000');
        expect(contrastRatio(BELT_CHART.muted, BELT_CHART.background)).toBeGreaterThanOrEqual(4.5);
        for (const { color } of styles.values()) expect(contrastRatio(color, BELT_CHART.background)).toBeGreaterThanOrEqual(3);
        expect(new Set([...styles.values()].map(style => `${style.color}:${style.pattern}`)).size).toBe(28);
    });
});
