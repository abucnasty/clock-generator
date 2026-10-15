import { Close } from '@mui/icons-material';
import { IconButton } from '@mui/material';
import { CONTROL, ROLE, SURFACE } from '../theme/tokens';
import { removeFilterName } from '../utils/a11yLabels';

interface SlotRemoveButtonProps {
    /** The slot's number, from 1 */
    slotNumber: number;
    /** The game's name of the item in the slot */
    itemName: string;
    onClick: () => void;
}

/**
 * The × at a filled slot's corner: 24px to hit, grey like the row's other furniture, red only under the pointer or the
 * keyboard, when it is about to remove something. Delete or Backspace on the slot does the same.
 */
export function SlotRemoveButton({ slotNumber, itemName, onClick }: SlotRemoveButtonProps) {
    return (
        <IconButton
            size="small"
            aria-label={removeFilterName(slotNumber, itemName)}
            onClick={onClick}
            sx={{
                position: 'absolute',
                // over the slot's corner by 8px at most, so 24x24 of the 32px slot stays its own to click
                top: -10,
                right: -16,
                width: 24,
                height: 24,
                bgcolor: SURFACE.panel,
                border: `1px solid ${CONTROL.border}`,
                color: 'text.secondary',
                '&:hover, &.Mui-focusVisible': { bgcolor: SURFACE.panel, color: ROLE.red.main, borderColor: ROLE.red.main },
            }}
        >
            <Close sx={{ fontSize: 14 }} />
        </IconButton>
    );
}
