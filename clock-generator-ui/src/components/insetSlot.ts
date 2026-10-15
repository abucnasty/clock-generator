import type { SxProps, Theme } from '@mui/material';
import { CONTROL, ROLE, SURFACE } from '../theme/tokens';

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
        boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.6)',
        transition: 'border-color 0.2s',
        '&:hover, &:focus-visible': { borderColor: ROLE.orange.main },
    };
}
