import { MoreVert } from '@mui/icons-material';
import { IconButton, Menu, MenuItem } from '@mui/material';
import { useId, useState } from 'react';
import { rowActionsName } from '../utils/a11yLabels';

interface RowActionsMenuProps {
    label: string;
    onDuplicate: () => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
}

/** The keyboard and single-pointer alternative to dragging a row. */
export function RowActionsMenu({ label, onDuplicate, onMoveUp, onMoveDown }: RowActionsMenuProps) {
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
    const menuId = useId();
    const open = anchor !== null;
    const close = () => {
        setAnchor(null);
    };
    const choose = (action: () => void) => { close(); action(); };
    return <>
        <IconButton size="small" onClick={event => setAnchor(event.currentTarget)} aria-label={rowActionsName(label)}
            aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
            sx={{ width: 30, height: 30, color: 'text.secondary', alignSelf: 'start', mt: '4px' }}>
            <MoreVert fontSize="small" />
        </IconButton>
        <Menu id={menuId} anchorEl={anchor} open={open} onClose={close}
            slotProps={{ paper: { role: 'region', 'aria-label': rowActionsName(label) }, list: { 'aria-label': rowActionsName(label) } }}>
            <MenuItem onClick={() => choose(onDuplicate)}>Duplicate</MenuItem>
            <MenuItem disabled={!onMoveUp} onClick={() => { if (onMoveUp) choose(onMoveUp); }}>Move up</MenuItem>
            <MenuItem disabled={!onMoveDown} onClick={() => { if (onMoveDown) choose(onMoveDown); }}>Move down</MenuItem>
        </Menu>
    </>;
}
