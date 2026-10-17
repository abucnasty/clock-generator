import { describe, expect, it } from 'vitest';
import { AA, contrastRatio, parseColor } from './contrast';
import { flowRouteStyle, flowNodeTitleColor, type FlowRouteKind } from './flowDiagram';
import { tokensFor } from './tokens';
import { TILE_GRID_SHADE } from './tileGrid';

describe.each(['light', 'dark'] as const)('%s diagram contrast', mode => {
    const tokens = tokensFor(mode);
    const canvas = parseColor(tokens.surface.inset), shade = parseColor(TILE_GRID_SHADE);
    const channel = (base: number, over: number) => Math.round(base * (1 - shade.a) + over * shade.a);
    const shadedTile = `rgb(${channel(canvas.r, shade.r)}, ${channel(canvas.g, shade.g)}, ${channel(canvas.b, shade.b)})`;
    it('keeps all node titles, values and boundaries readable on the app background', () => {
        for (const role of ['orange', 'blue', 'green'] as const) {
            expect(contrastRatio(flowNodeTitleColor(tokens, role), tokens.surface.page)).toBeGreaterThanOrEqual(AA.text);
        }
        for (const text of [tokens.text.primary, tokens.text.secondary]) {
            expect(contrastRatio(text, tokens.surface.page)).toBeGreaterThanOrEqual(AA.text);
        }
        expect(contrastRatio(tokens.control.border, tokens.surface.page)).toBeGreaterThanOrEqual(AA.nonText);
    });
    it.each<FlowRouteKind>(['neutral', 'selected', 'transfer', 'recent'])('keeps %s routes visible on canvas and node surfaces', kind => {
        const style = flowRouteStyle(tokens, kind);
        const { r, g, b } = parseColor(style.stroke);
        // Measure the rendered stroke, including opacity: a passing palette can still fail after dimming.
        const rendered = `rgba(${r}, ${g}, ${b}, ${style.opacity})`;
        for (const surface of [tokens.surface.inset, shadedTile, tokens.surface.panel, tokens.hover.panel, tokens.surface.page]) {
            expect(contrastRatio(rendered, surface), `${kind} on ${surface}`).toBeGreaterThanOrEqual(AA.nonText);
        }
    });
    it('distinguishes current transfers, recent activity and selection without fading the line', () => {
        const current = flowRouteStyle(tokens, 'transfer');
        const recent = flowRouteStyle(tokens, 'recent');
        const selected = flowRouteStyle(tokens, 'selected');
        expect(current.strokeWidth).toBeGreaterThan(recent.strokeWidth);
        expect(current.strokeDasharray).toBeUndefined();
        expect(recent.strokeDasharray).not.toBe(selected.strokeDasharray);
        expect(recent.strokeDasharray).toBeTruthy();
        expect(selected.strokeDasharray).toBeTruthy();
    });
});
