/**
 * WCAG 2.2 contrast, with no MUI in it, so the tests and the token table can use it. A colour is `#rgb`, `#rrggbb`,
 * `rgb(r, g, b)` or `rgba(r, g, b, a)`; anything else (a named colour, a short hex) throws, so a typo cannot pass a test.
 */

/** The ratios WCAG 2.2 AA asks for: 1.4.3 for text, 1.4.11 for controls, their borders and focus rings */
export const AA = { text: 4.5, nonText: 3 } as const;

interface Rgba {
    r: number;
    g: number;
    b: number;
    a: number;
}

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const RGB = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/i;

/** The channels of a colour, 0 to 255, and its alpha, 0 to 1 */
export function parseColor(input: string): Rgba {
    const text = input.trim();
    const hex = HEX.exec(text);
    if (hex) {
        const digits = hex[1].length === 3 ? [...hex[1]].map(digit => digit + digit).join('') : hex[1];
        return {
            r: parseInt(digits.slice(0, 2), 16),
            g: parseInt(digits.slice(2, 4), 16),
            b: parseInt(digits.slice(4, 6), 16),
            a: 1,
        };
    }
    const rgb = RGB.exec(text);
    if (rgb) {
        const [r, g, b] = [rgb[1], rgb[2], rgb[3]].map(Number);
        const a = rgb[4] === undefined ? 1 : Number(rgb[4]);
        if ([r, g, b].every(channel => channel <= 255) && a <= 1) {
            return { r, g, b, a };
        }
    }
    throw new Error(`Not a colour this helper reads: "${input}"`);
}

/** `top` drawn over the opaque `bottom` */
function blend(top: Rgba, bottom: Rgba): Rgba {
    const mix = (over: number, under: number) => over * top.a + under * (1 - top.a);
    return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
}

/** The relative luminance of a colour, 0 for black to 1 for white; its alpha is ignored */
export function relativeLuminance(color: string): number {
    const { r, g, b } = parseColor(color);
    return luminanceOf({ r, g, b, a: 1 });
}

function luminanceOf({ r, g, b }: Rgba): number {
    const linear = (channel: number) => {
        const c = channel / 255;
        return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/**
 * The contrast of `fg` on `bg`, 1 to 21. A translucent `fg` is blended over `bg`, as the browser draws it. A translucent
 * `bg` is blended over black, the darkest thing that could be under it: the table in `tokens.ts` gives every surface
 * opaque, so this only matters to a caller that measures a tint on its own.
 */
export function contrastRatio(fg: string, bg: string): number {
    const black: Rgba = { r: 0, g: 0, b: 0, a: 1 };
    const under = blend(parseColor(bg), black);
    const over = blend(parseColor(fg), under);
    const [light, dark] = [luminanceOf(over), luminanceOf(under)].sort((a, b) => b - a);
    return (light + 0.05) / (dark + 0.05);
}
