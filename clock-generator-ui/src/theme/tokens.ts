/**
 * The colours of the site, in one place: the surfaces from the page down to an inset slot, the five colour roles, the
 * text and the controls' lines. The MUI theme (`theme.ts`) is built from these alone, and `TOKEN_PAIRS` lists every pair
 * of them the site may draw, which `tokens.test.ts` holds to WCAG 2.2 AA. No MUI here, so the tests read it as it is.
 *
 * The roles: green filled is a confirm or commit, orange is selection and accent, yellow with an icon and words is a
 * warning, red is danger, blue is for info alerts only, grey text is cancel.
 */

/** From the lightest to the darkest; the dark theme's elevation overlay is off, so each is drawn exactly */
export const SURFACE = {
    /** The body behind the cards */
    page: '#404040',
    /** A card's or dialog's title bar, an accordion's summary */
    titleBar: '#3a3a3a',
    /** The app bar and the workflow bar */
    bar: '#363636',
    /** An entity row inside a card */
    row: '#2e2e2e',
    /** A card's body, dialogs, menus, popovers, messages, the footer */
    panel: '#232323',
    /** Item and filter slots, the blueprint text box */
    inset: '#1a1a1a',
} as const;

/** What the surfaces become under the pointer: MUI's 8% white hover over a row, and over a card, menu or dialog */
export const SURFACE_HOVER = {
    row: '#3f3f3f',
    panel: '#353535',
} as const;

/** Each role's fill, its hover (`dark`), a lighter shade, and the text on any of the three */
export const ROLE = {
    orange: { main: '#fca300', light: '#ffba37', dark: '#b07200', on: '#000000' },
    green: { main: '#5eb664', light: '#81d99a', dark: '#4f9e55', on: '#000000' },
    yellow: { main: '#ffe14d', light: '#ffe770', dark: '#b29d35', on: '#000000' },
    red: { main: '#ff7a79', light: '#ff9493', dark: '#e2605f', on: '#000000' },
    blue: { main: '#29b6f6', light: '#53c4f7', dark: '#1c7fac', on: '#000000' },
} as const;

export const TEXT = {
    primary: '#ffffff',
    secondary: 'rgba(255, 255, 255, 0.7)',
    disabled: 'rgba(255, 255, 255, 0.5)',
    /**
     * Words in the danger colour (a field's problem, Discard, the red chips): the lighter red, 4.5:1 or more on every
     * surface and on a hovered grey. `ROLE.red.main` stays for fills, borders and icons
     */
    error: ROLE.red.light,
} as const;

export const CONTROL = {
    /** Inputs, outlined buttons and chips, slots */
    border: '#9e9e9e',
    /** A switch's track while it is off */
    trackOff: '#8c8c8c',
    /** The frame of cards, menus and dialogs: decoration (their text says what they are), so not held to 3:1 */
    edge: '#5c5c5c',
    /** The keyboard focus ring, drawn outside the control on the surface around it */
    focus: '#fca300',
    /** The focus ring inside a filled alert, on the role's dark fill, where the orange is too close (1.3 to 2.2:1) */
    focusOnFill: '#000000',
} as const;

interface TokenPair {
    name: string;
    fg: string;
    bg: string;
    /** Text needs 4.5:1; a control's boundary, a fill against its surface and a focus ring need 3:1 */
    kind: 'text' | 'nonText';
    note?: string;
}

type SurfaceName = keyof typeof SURFACE;
const SURFACES = Object.keys(SURFACE) as SurfaceName[];
/**
 * Where green and red text may sit: not straight on the page (4.1:1), nor on a hovered or selected grey. The Valid and
 * Invalid chips' words are such text
 */
const STATUS_TEXT_SURFACES: SurfaceName[] = ['titleBar', 'bar', 'row', 'panel', 'inset'];
/** Blue text is an info alert's icon, on the alert's own tint, which is darker than any of these */
const INFO_TEXT_SURFACES: SurfaceName[] = ['titleBar', 'bar', 'row', 'panel', 'inset'];

const on = (name: string, fg: string, surfaces: SurfaceName[], kind: TokenPair['kind'], note?: string): TokenPair[] =>
    surfaces.map(surface => ({ name: `${name} on ${surface}`, fg, bg: SURFACE[surface], kind, ...(note && { note }) }));

/** MUI's filled Alert writes in 87% black (`getContrastText`) on the role's `dark` in a dark theme */
const ALERT_FILLED_TEXT = 'rgba(0, 0, 0, 0.87)';

/** Every pair of the tokens the site may draw, and what WCAG asks of it */
export const TOKEN_PAIRS: readonly TokenPair[] = [
    // text (1.4.3)
    ...on('text.primary', TEXT.primary, SURFACES, 'text'),
    ...on('text.secondary', TEXT.secondary, SURFACES, 'text', 'also placeholders, the help icon and the "+" of an empty slot'),
    ...on('orange text', ROLE.orange.main, SURFACES, 'text', 'not on a selected grey (4.0:1)'),
    ...on('yellow text', ROLE.yellow.main, SURFACES, 'text'),
    ...on('green text', ROLE.green.main, STATUS_TEXT_SURFACES, 'text', 'the placement rule: not on the page'),
    ...on('red text', ROLE.red.main, STATUS_TEXT_SURFACES, 'text', 'the placement rule: not on the page'),
    ...on('error text', TEXT.error, SURFACES, 'text', 'field problems, Discard, Clear rule, the red chips'),
    { name: 'error text on a hovered row', fg: TEXT.error, bg: SURFACE_HOVER.row, kind: 'text' },
    { name: 'error text on a hovered card or menu item', fg: TEXT.error, bg: SURFACE_HOVER.panel, kind: 'text' },
    ...on('blue text', ROLE.blue.main, INFO_TEXT_SURFACES, 'text', 'info alerts only'),
    // the clock table's Status chips carry their own panel fill, so a selected or hovered row's tint is not under them
    ...(['green', 'yellow', 'red'] as const).map(role => ({
        name: `Status chip, ${role} words on its panel fill`, fg: ROLE[role].main, bg: SURFACE.panel, kind: 'text' as const,
    })),
    // text on a role's fill: a filled button or chip, its hover and its lighter shade
    ...Object.entries(ROLE).flatMap(([role, { main, dark, light, on: text }]) => [
        { name: `${role} on-text on main`, fg: text, bg: main, kind: 'text' as const },
        { name: `${role} on-text on dark (hover)`, fg: text, bg: dark, kind: 'text' as const },
        { name: `${role} on-text on light`, fg: text, bg: light, kind: 'text' as const },
    ]),
    // a filled Alert; the info one is never filled (87% black on its dark blue is 4.28:1)
    { name: 'filled warning Alert text', fg: ALERT_FILLED_TEXT, bg: ROLE.yellow.dark, kind: 'text' },
    { name: 'filled error Alert text', fg: ALERT_FILLED_TEXT, bg: ROLE.red.dark, kind: 'text' },
    { name: 'filled success Alert text', fg: ALERT_FILLED_TEXT, bg: ROLE.green.dark, kind: 'text' },
    // non-text (1.4.11)
    ...on('control border', CONTROL.border, SURFACES, 'nonText', 'inputs, outlined buttons and chips, slots'),
    ...on('switch track, off', CONTROL.trackOff, SURFACES, 'nonText', 'not on a selected grey (2.4:1)'),
    ...on('focus ring', CONTROL.focus, SURFACES, 'nonText'),
    ...Object.entries(ROLE).map(([role, { main }]) => ({ name: `${role} fill on panel`, fg: main, bg: SURFACE.panel, kind: 'nonText' as const })),
    ...on('green fill', ROLE.green.main, STATUS_TEXT_SURFACES, 'nonText'),
    ...on('red fill', ROLE.red.main, STATUS_TEXT_SURFACES, 'nonText'),
    ...on('yellow fill', ROLE.yellow.main, SURFACES, 'nonText'),
    ...(['yellow', 'red', 'green'] as const).map(role => ({
        name: `focus ring in a filled ${role} alert`, fg: CONTROL.focusOnFill, bg: ROLE[role].dark, kind: 'nonText' as const,
    })),
    { name: 'selected toggle fill on bar', fg: ROLE.orange.main, bg: SURFACE.bar, kind: 'nonText' },
    { name: 'switch thumb, off', fg: TEXT.primary, bg: CONTROL.trackOff, kind: 'nonText' },
    { name: 'switch thumb, on', fg: ROLE.orange.on, bg: ROLE.orange.main, kind: 'nonText' },
];
