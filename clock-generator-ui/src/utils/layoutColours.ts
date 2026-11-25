import { SURFACE } from '../theme/tokens';

/**
 * By the number of the belt, so that a belt keeps its colour as belts are added. Each reaches 3 to 1 on both squares of
 * the ground (layoutColours.test.ts), and the eight stay apart from each other
 */
const BELT_COLOURS = ['#2a9db3', '#96702a', '#8166b2', '#e8741a', '#316bef', '#4e9a6a', '#c2477a', '#8f8f2a'];
/** The tint of what stands between the regions (index 0), then of each region by its number */
const REGION_COLOURS = ['#e1e1e1', '#cde1fa', '#fde2be', '#d8f0d0', '#f0d4ec'];

export const beltColour = (id: number): string => BELT_COLOURS[((id % BELT_COLOURS.length) + BELT_COLOURS.length) % BELT_COLOURS.length];

/** The tint of region `region` from 1, repeating after four; region 0 is what stands between the regions */
export const regionColour = (region: number): string => REGION_COLOURS[region === 0 ? 0 : ((region - 1) % (REGION_COLOURS.length - 1)) + 1];

/**
 * The ground the picture is drawn on, the same in both themes: the dark grey of the diagram's canvas and of the icon slots
 * (`SURFACE.inset`, theme/tokens.ts), under the lighter squares of the shared checker (`TILE_GRID_SHADE`, theme/tileGrid.ts)
 */
export const LAYOUT_GROUND = SURFACE.inset;
