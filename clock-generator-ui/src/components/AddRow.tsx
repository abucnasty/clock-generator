import { Add } from '@mui/icons-material';
import { Button, Menu, MenuItem } from '@mui/material';
import { useId, useState } from 'react';
import { themeTokens } from '../theme/runtimeTokens';
import type { Theme } from '@mui/material/styles';

interface AddRowProps {
    /** What the row says, and what it is called: "Add chest" */
    label: string;
    onClick?: () => void;
    /** When there is more than one kind to add: the row opens a menu of them */
    menu?: { label: string; onSelect: () => void }[];
    /** For whoever needs to find the row: `data-row-add`, which a deleted row's focus falls back to */
    [dataAttribute: `data-${string}`]: string | undefined;
}

/**
 * An empty part of the build, folded to one row: a dashed line with "+ Add …" in it, in the place where its rows will be.
 * Neutral words and a dashed outline keep it discoverable; keyboard focus uses the theme ring.
 */
export function AddRow({ label, onClick, menu, ...data }: AddRowProps) {
    const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
    const menuId = useId();
    const open = anchor !== null;

    return (
        <>
            <Button
                disableFocusRipple
                variant="text"
                color="inherit"
                fullWidth
                startIcon={<Add />}
                onClick={(event) => (menu ? setAnchor(event.currentTarget) : onClick?.())}
                aria-haspopup={menu ? 'menu' : undefined}
                aria-expanded={menu ? open : undefined}
                aria-controls={menu && open ? menuId : undefined}
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
            {menu && (
                <Menu
                    id={menuId}
                    anchorEl={anchor}
                    open={open}
                    onClose={() => setAnchor(null)}
                    slotProps={{ list: { 'aria-label': label } }}
                >
                    {menu.map((item) => (
                        <MenuItem
                            key={item.label}
                            onClick={() => {
                                setAnchor(null);
                                item.onSelect();
                            }}
                        >
                            {item.label}
                        </MenuItem>
                    ))}
                </Menu>
            )}
        </>
    );
}
