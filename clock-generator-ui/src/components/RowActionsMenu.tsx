import { MoreVert } from '@mui/icons-material';
import { IconButton, Menu, MenuItem } from '@mui/material';
import { useMenuAnchor } from '../hooks/useMenuAnchor';
import { rowActionsName } from '../utils/a11yLabels';

interface RowActionsMenuProps {
    label: string;
    onDuplicate: () => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    showReorder?: boolean;
}

/** The keyboard and single-pointer alternative to dragging a row. */
export function RowActionsMenu({ label, onDuplicate, onMoveUp, onMoveDown, showReorder = true }: RowActionsMenuProps) {
    const menu = useMenuAnchor();
    return <>
        <IconButton size="small" {...menu.button} aria-label={rowActionsName(label)}
            sx={{ width: 30, height: 30, color: 'text.secondary', alignSelf: 'start', mt: '4px' }}>
            <MoreVert fontSize="small" />
        </IconButton>
        <Menu {...menu.menu} slotProps={{ paper: { role: 'region', 'aria-label': rowActionsName(label) }, list: { 'aria-label': rowActionsName(label) } }}>
            <MenuItem onClick={menu.choose(onDuplicate)}>Duplicate</MenuItem>
            {showReorder && <MenuItem disabled={!onMoveUp} onClick={onMoveUp && menu.choose(onMoveUp)}>Move up</MenuItem>}
            {showReorder && <MenuItem disabled={!onMoveDown} onClick={onMoveDown && menu.choose(onMoveDown)}>Move down</MenuItem>}
        </Menu>
    </>;
}
