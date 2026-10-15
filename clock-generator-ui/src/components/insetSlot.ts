import type { SxProps, Theme } from '@mui/material';
import { CONTROL, ROLE, SHADOW, SURFACE } from '../theme/tokens';

/** A slot's side; its item icon is 24px */
const INSET_SLOT_SIZE = 32;

interface InsetSlotState {
    /** Filled in by the tool and not by the player: a dashed border, with the word AUTO under it */
    auto?: boolean;
    /** Its picker is open */
    open?: boolean;
}

/**
 * An item or filter slot in the game's look: a dark square sunk into the row, with a grey border that is 6.5:1 on its
 * fill and 5:1 on the row (3:1 is asked of a control's edge). Orange, the selection colour, on hover, on keyboard focus
 * and while its picker is open. It does not grow under the pointer, so it never covers its neighbour or its × button.
 */
export function insetSlotSx({ auto = false, open = false }: InsetSlotState = {}): SxProps<Theme> {
    return {
        width: INSET_SLOT_SIZE,
        height: INSET_SLOT_SIZE,
        boxSizing: 'border-box',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        cursor: 'pointer',
        bgcolor: SURFACE.inset,
        border: '1px solid',
        borderStyle: auto ? 'dashed' : 'solid',
        borderColor: open ? ROLE.orange.main : CONTROL.border,
        borderRadius: '2px',
        boxShadow: SHADOW.inset,
        transition: 'border-color 0.2s',
        '&:hover, &:focus-visible': { borderColor: ROLE.orange.main },
    };
}

/** The word AUTO under an auto-filled slot: 11px grey on the slot's own dark, with its dashed edge (9:1) */
export const AUTO_BADGE_SX: SxProps<Theme> = {
    position: 'absolute',
    bottom: -9,
    left: '50%',
    transform: 'translateX(-50%)',
    bgcolor: SURFACE.inset,
    color: 'text.secondary',
    border: `1px dashed ${CONTROL.border}`,
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1,
    px: 0.5,
    py: '1px',
    pointerEvents: 'none',
};

/** A slot's count (an infinity chest's request): 11px white on the slot's dark, at its bottom right as in the game */
export const SLOT_COUNT_SX: SxProps<Theme> = {
    position: 'absolute',
    bottom: -7,
    right: -6,
    bgcolor: SURFACE.inset,
    color: 'text.primary',
    border: `1px solid ${CONTROL.border}`,
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1,
    px: 0.5,
    py: '1px',
    minWidth: 16,
    textAlign: 'center',
    pointerEvents: 'none',
};
