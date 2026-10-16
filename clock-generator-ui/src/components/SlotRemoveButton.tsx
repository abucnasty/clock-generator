import { Close } from '@mui/icons-material';
import { IconButton } from '@mui/material';
import { themeTokens } from '../theme/runtimeTokens';
import type { Theme } from '@mui/material/styles';
import { removeFilterName } from '../utils/a11yLabels';

interface SlotRemoveButtonProps {
    /** The slot's number, from 1 */
    slotNumber: number;
    /** The game's name of the item in the slot */
    itemName: string;
    onClick: () => void;
    tabIndex?: number;
}

/**
 * The × at a filled slot's corner: 24px to hit, grey like the row's other furniture, red only under the pointer or the
 * keyboard, when it is about to remove something. Delete or Backspace on the slot does the same.
 */
export function SlotRemoveButton({ slotNumber, itemName, onClick, tabIndex }: SlotRemoveButtonProps) {
    return (
        <IconButton
            size="small"
            tabIndex={tabIndex}
            aria-label={removeFilterName(slotNumber, itemName)}
            onClick={onClick}
            sx={{
                position: 'absolute',
                // over the next slot's box, which comes later in the page, so all 24px stay its own to click
                zIndex: 1,
                // over the slot's corner by 8px at most, so 24x24 of the 32px slot stays its own to click
                top: -8,
                right: -16,
                width: 24,
                height: 24,
                bgcolor: (theme: Theme) => themeTokens(theme).surface.panel,
                border: (theme: Theme) => `1px solid ${themeTokens(theme).control.border}`,
                color: 'text.secondary',
                '&:hover, &.Mui-focusVisible': { bgcolor: (theme: Theme) => themeTokens(theme).surface.panel, color: (theme: Theme) => themeTokens(theme).role.red.main, borderColor: (theme: Theme) => themeTokens(theme).role.red.main },
            }}
        >
            <Close sx={{ fontSize: 14 }} />
        </IconButton>
    );
}
