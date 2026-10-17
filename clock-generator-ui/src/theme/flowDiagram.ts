import type { ThemeTokens } from './tokens';
import { AA, contrastRatio } from './contrast';

/** Node titles keep their entity hue while remaining readable on the app's page fill. */
export function flowNodeTitleColor(tokens: ThemeTokens, role: keyof ThemeTokens['role']) {
    const color = tokens.role[role];
    return [color.main, color.light, color.dark].find(value => contrastRatio(value, tokens.surface.page) >= AA.text) ?? tokens.text.primary;
}

export type FlowRouteKind = 'neutral' | 'selected' | 'transfer' | 'recent';

/** Focus changes line weight and pattern, never the contrast of a readable route. */
export function flowRouteStyle(tokens: ThemeTokens, kind: FlowRouteKind) {
    return {
        stroke: kind === 'transfer' || kind === 'recent' ? tokens.role.green.main
            : kind === 'selected' ? tokens.role.orange.main : tokens.control.border,
        strokeWidth: kind === 'transfer' ? 4 : kind === 'selected' ? 2.5 : kind === 'recent' ? 2 : 1.5,
        strokeDasharray: kind === 'recent' ? '2 5' : kind === 'selected' ? '7 4' : undefined,
        opacity: 1,
    };
}
