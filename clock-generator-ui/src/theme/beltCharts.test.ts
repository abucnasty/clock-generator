import { describe, expect, it } from 'vitest';
import { BELT_CHART, itemChartStyles, patternBackground, statusPattern } from './beltCharts';
import { contrastRatio } from './contrast';

describe('belt-charts identity', () => {
    it('keeps every plotted brand hue visible on the actual black plotting surface', () => {
        const styles = itemChartStyles(Array.from({ length: 28 }, (_, index) => String(index).padStart(2, '0')));
        expect(BELT_CHART.background).toBe('#000000');
        expect(contrastRatio(BELT_CHART.muted, BELT_CHART.background)).toBeGreaterThanOrEqual(4.5);
        for (const { color } of styles.values()) expect(contrastRatio(color, BELT_CHART.background)).toBeGreaterThanOrEqual(3);
        expect(new Set([...styles.values()].map(style => `${style.color}:${style.pattern}`)).size).toBe(28);
    });

    it('assigns styles in stable item order and adds patterns when hues repeat', () => {
        expect([...itemChartStyles(['c', 'a', 'b', 'a'])]).toEqual([...itemChartStyles(['a', 'b', 'c'])]);
        const styles = [...itemChartStyles('abcdefgh').values()];
        expect(styles[0]).toEqual({ color: '#0072B2', pattern: 'solid' });
        expect(styles[7]).toEqual({ color: '#0072B2', pattern: 'diagonal' });
        expect(patternBackground(styles[7])).toContain('repeating-linear-gradient');
        expect(itemChartStyles([]).size).toBe(0);
    });

    it('distinguishes waiting, blocked, and disabled states with motifs as well as color', () => {
        expect(['ACTIVE', 'WAITING', 'BLOCKED', 'DISABLED'].map(statusPattern))
            .toEqual(['solid', 'diagonal', 'dots', 'horizontal']);
    });
});
