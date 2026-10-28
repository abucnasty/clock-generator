import { Add } from '@mui/icons-material';
import { Box, Button, Menu, MenuItem, type ButtonProps } from '@mui/material';
import { cloneElement, type ReactElement, type ReactNode } from 'react';
import { useMenuAnchor } from '../hooks/useMenuAnchor';
import { themeTokens } from '../theme/runtimeTokens';
import type { Theme } from '@mui/material/styles';

/** The kinds a section can add, when it has more than one */
type AddMenuItems = { label: string; icon?: ReactNode; onSelect: () => void }[];

interface AddRowProps {
    /** What the row says, and what it is called: "Add chest" */
    label: string;
    onClick?: () => void;
    /** When there is more than one kind to add: the row opens a menu of them */
    menu?: AddMenuItems;
    /** For whoever needs to find the row: `data-row-add`, which a deleted row's focus falls back to */
    [dataAttribute: `data-${string}`]: string | undefined;
}

/**
 * An empty part of the build, folded to one row: a dashed line with "+ Add …" in it, in the place where its rows will be.
 * Neutral words and a dashed outline keep it discoverable; keyboard focus uses the theme ring.
 */
export function AddRow({ label, onClick, menu, ...data }: AddRowProps) {
    const row = (
        <Button
            variant="text"
            color="inherit"
            fullWidth
            startIcon={<Add />}
            onClick={onClick}
            sx={{
                justifyContent: 'flex-start',
                minHeight: 40,
                px: 2,
                border: (theme: Theme) => `1px dashed ${themeTokens(theme).control.border}`,
                '&:hover': { borderColor: (theme: Theme) => themeTokens(theme).text.primary },
            }}
            {...data}
        >
            {label}
        </Button>
    );
    return menu ? <AddMenu label={label} items={menu} button={row} /> : row;
}

/**
 * A section's Add button, in its title bar. The first of a section's is marked `data-row-add`: the focus goes to it once
 * the section's last row is deleted.
 */
export function AddButton({ label, focusTarget = true, ...button }: { label: string; focusTarget?: boolean } & Omit<ButtonProps, 'children'>) {
    return <Button startIcon={<Add />} color="inherit" variant="text" size="small" data-row-add={focusTarget ? '' : undefined} {...button}>
        {label}
    </Button>;
}

/** An `AddButton` that opens a menu of the kinds it adds */
export function AddMenuButton({ label, items, focusTarget }: { label: string; items: AddMenuItems; focusTarget?: boolean }) {
    return <AddMenu label={label} items={items} button={<AddButton label={label} focusTarget={focusTarget} />} />;
}

/** `button`, opening a menu named `label` of `items` */
function AddMenu({ label, items, button }: { label: string; items: AddMenuItems; button: ReactElement<ButtonProps> }) {
    const menu = useMenuAnchor();
    return <>
        {cloneElement(button, menu.button)}
        <Menu {...menu.menu} slotProps={{ list: { 'aria-label': label } }}>
            {items.map(item => <MenuItem key={item.label} onClick={menu.choose(item.onSelect)}>
                {item.icon}<Box component="span" sx={{ ml: item.icon ? 1 : 0 }}>{item.label}</Box>
            </MenuItem>)}
        </Menu>
    </>;
}
