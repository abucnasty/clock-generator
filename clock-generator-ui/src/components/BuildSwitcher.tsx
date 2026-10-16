import { Add, ArrowDropDown, Check, ContentCopy, DeleteOutline, Edit, FolderOpen } from '@mui/icons-material';
import {
    Box,
    Button,
    Divider,
    IconButton,
    ListItemIcon,
    ListItemText,
    ListSubheader,
    Menu,
    MenuItem,
    Tooltip,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState, type Ref } from 'react';
import { BUILDS_HEADING } from '../utils/buildLibrary';

interface BuildRow {
    id: string;
    title: string;
    /** The recipe's name under a name of the player's own; null otherwise */
    secondary: string | null;
}

interface BuildSwitcherProps {
    /** The switcher's button, for focus to go to when a dialog without an opener closes */
    ref?: Ref<HTMLButtonElement>;
    /** Most recently opened first */
    builds: BuildRow[];
    currentId: string;
    currentTitle: string;
    onOpen: (id: string) => void;
    onNew: () => void;
    onDuplicate: () => void;
    onRename: () => void;
    onDelete: () => void;
    /** A newer version of the site wrote the list of builds: what would change it is off */
    readOnly?: boolean;
}

/**
 * Your builds, in the app bar after the title: the open build's name, which opens a menu of the builds and of New,
 * Duplicate, Rename and Delete build. Below 600px it is an icon button, with the name in its accessible name.
 */
export function BuildSwitcher({ ref, builds, currentId, currentTitle, onOpen, onNew, onDuplicate, onRename, onDelete, readOnly = false }: BuildSwitcherProps) {
    const wide = useMediaQuery(useTheme().breakpoints.up('sm'));
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const open = anchor !== null;
    const [tooltipOpen, setTooltipOpen] = useState(false);
    const effectiveTooltipOpen = tooltipOpen && !open;
    // ArrowUp opens the menu on its last item, as a menu button does
    const [fromEnd, setFromEnd] = useState(false);
    const close = useCallback(() => setAnchor(null), []);
    // the menu is mounted in the header, as the ⋮ menu is, so it stays inside the banner landmark
    const buttonRef = useRef<HTMLButtonElement | null>(null);
    const container = useCallback(() => buttonRef.current?.closest('header') ?? document.body, []);
    const setButton = useCallback((element: HTMLButtonElement | null) => {
        buttonRef.current = element;
        if (typeof ref === 'function') ref(element);
        else if (ref) ref.current = element;
    }, [ref]);

    // Keep hover help readable while the pointer crosses the header to its tooltip below. Resolve the header on
    // every render so a replaced header/trigger loses its listener too; no listener remains while the menu is open.
    useEffect(() => {
        if (!effectiveTooltipOpen) return;
        const header = buttonRef.current?.closest('header');
        if (!header) return;
        const leaveHeader = () => {
            if (!buttonRef.current?.matches(':focus-visible')) setTooltipOpen(false);
        };
        header.addEventListener('mouseleave', leaveHeader);
        return () => header.removeEventListener('mouseleave', leaveHeader);
    });

    // after MUI has focused the first item
    useEffect(() => {
        if (!open || !fromEnd) return;
        const timer = window.setTimeout(() => {
            const items = document.querySelectorAll<HTMLElement>(`[role="menu"][aria-label="${BUILDS_HEADING}"] [role^="menuitem"]:not(.Mui-disabled)`);
            items[items.length - 1]?.focus();
        }, 0);
        return () => window.clearTimeout(timer);
    }, [open, fromEnd]);

    const run = (action: () => void) => () => {
        close();
        action();
    };
    const pick = (id: string) => () => {
        close();
        if (id !== currentId) onOpen(id);
    };

    const name = `Build: ${currentTitle}`;
    const buttonProps = {
        ref: setButton,
        color: 'inherit' as const,
        onClick: (event: React.MouseEvent<HTMLElement>) => {
            setFromEnd(false);
            setAnchor(event.currentTarget);
        },
        // a menu button opens on the arrow keys too
        onKeyDown: (event: React.KeyboardEvent<HTMLElement>) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setFromEnd(event.key === 'ArrowUp');
                setAnchor(event.currentTarget);
            }
        },
        'aria-label': name,
        'aria-haspopup': 'menu' as const,
        'aria-expanded': open,
    };

    return (
        <>
            {/* Keep the full name inside the banner, below all its controls, even when this button is icon-only. */}
            <Tooltip
                title={`${BUILDS_HEADING}: ${currentTitle}`}
                describeChild
                open={effectiveTooltipOpen}
                onOpen={() => setTooltipOpen(true)}
                onClose={(event) => {
                    // Escape, blur and touch end still close normally. Only mouseleave waits for the pointer to
                    // leave the owning header (including its interactive tooltip), or the trigger to lose focus.
                    if (event.type === 'mouseleave' && (container().matches(':hover') || buttonRef.current?.matches(':focus-visible'))) return;
                    setTooltipOpen(false);
                }}
                placement="bottom"
                slotProps={{ popper: {
                    disablePortal: true,
                    anchorEl: container,
                    modifiers: [
                        { name: 'flip', enabled: false },
                        { name: 'preventOverflow', options: { mainAxis: true, altAxis: false } },
                    ],
                } }}
            >
                {wide ? (
                    <Button
                        {...buttonProps}
                        variant="text"
                        size="small"
                        startIcon={<FolderOpen />}
                        endIcon={<ArrowDropDown />}
                        sx={{ ml: 1, minWidth: 0, flexShrink: 1, textTransform: 'none', fontSize: '1rem', fontWeight: 400 }}
                    >
                        <Box
                            component="span"
                            sx={{
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap',
                                maxWidth: { sm: '12ch', md: '20ch', lg: '32ch' },
                            }}
                        >
                            {currentTitle}
                        </Box>
                    </Button>
                ) : (
                    <IconButton {...buttonProps} size="small" sx={{ ml: 0.5 }}>
                        <FolderOpen />
                    </IconButton>
                )}
            </Tooltip>
            <Menu
                anchorEl={anchor}
                open={open}
                onClose={close}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                container={container}
                disableScrollLock
                slotProps={{
                    list: { 'aria-label': BUILDS_HEADING },
                    paper: { sx: { maxWidth: 'min(28rem, calc(100vw - 32px))' } },
                }}
            >
                <ListSubheader sx={{ lineHeight: 2.5, bgcolor: 'background.paper' }}>{BUILDS_HEADING}</ListSubheader>
                {builds.map((build) => (
                    <MenuItem key={build.id} role="menuitemradio" aria-checked={build.id === currentId} onClick={pick(build.id)}>
                        <ListItemIcon>{build.id === currentId && <Check fontSize="small" />}</ListItemIcon>
                        <ListItemText
                            primary={build.title}
                            secondary={build.secondary}
                            slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
                        />
                    </MenuItem>
                ))}
                <Divider />
                <MenuItem onClick={run(onNew)} disabled={readOnly}>
                    <ListItemIcon>
                        <Add fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>New build</ListItemText>
                </MenuItem>
                <MenuItem onClick={run(onDuplicate)} disabled={readOnly}>
                    <ListItemIcon>
                        <ContentCopy fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Duplicate build</ListItemText>
                </MenuItem>
                <MenuItem onClick={run(onRename)} disabled={readOnly}>
                    <ListItemIcon>
                        <Edit fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Rename build…</ListItemText>
                </MenuItem>
                {/* in the error text red (TEXT.error), as Reset build: it throws the build away (Undo brings it back) */}
                <MenuItem onClick={run(onDelete)} disabled={readOnly} sx={{ color: 'error.light' }}>
                    <ListItemIcon sx={{ color: 'inherit' }}>
                        <DeleteOutline fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>Delete build</ListItemText>
                </MenuItem>
            </Menu>
        </>
    );
}
