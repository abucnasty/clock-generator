import { Box, Paper, Typography, type SxProps, type Theme } from '@mui/material';
import { useId, type FocusEventHandler, type ReactNode, type Ref } from 'react';
import { themeTokens } from '../theme/runtimeTokens';
import { HelpButton } from './HelpButton';

interface PanelProps {
    title: string;
    /** The heading's level: 2 for a card of the page, 3 for a card inside a section, 4 for a card inside that */
    level?: 2 | 3 | 4;
    /** The heading's id is `${id}-title`; one is made up when not given */
    id?: string;
    /**
     * For a heading the page moves the focus to (as to Target Output when the intro card goes): its id instead, and
     * focusable by script only
     */
    focusableTitleId?: string;
    /** A "?" after the title that opens this */
    help?: { label: string; content: ReactNode };
    /** At the right of the title bar */
    actions?: ReactNode;
    children: ReactNode;
    sx?: SxProps<Theme>;
    ref?: Ref<HTMLElement>;
    /** For whoever needs to find the card: a capture script, a test */
    [dataAttribute: `data-${string}`]: string | undefined;
}

/**
 * A card in the game's look: a title bar (a lighter band with the heading, its help and the card's actions), over the
 * dark body. A section of the page, named by its heading.
 */
export function Panel({ title, level = 2, id, focusableTitleId, help, actions, children, sx, ref, ...data }: PanelProps) {
    const madeUpId = useId();
    const titleId = focusableTitleId ?? `${id ?? madeUpId}-title`;
    return (
        <Paper
            ref={ref as Ref<HTMLDivElement> | undefined}
            variant="outlined"
            component="section"
            aria-labelledby={titleId}
            sx={[{ mb: 2 }, ...(Array.isArray(sx) ? sx : [sx])]}
            {...data}
        >
            <TitleBar component="header" title={title} titleId={titleId} level={level} focusable={Boolean(focusableTitleId)} help={help} actions={actions}
                variant={level === 2 ? 'h6' : level === 3 ? 'subtitle1' : 'subtitle2'} titleSx={{ fontWeight: 600 }} sx={{
                    minHeight: 40,
                    px: 2,
                    py: 0.5,
                    bgcolor: (theme: Theme) => themeTokens(theme).surface.titleBar,
                    borderBottom: (theme: Theme) => `1px solid ${themeTokens(theme).surface.inset}`,
                }} />
            <Box sx={{ p: 2 }}>{children}</Box>
        </Paper>
    );
}

interface PanelSectionProps {
    title: string;
    /** 3 for a section of a card, 4 for a part of a section */
    level: 3 | 4;
    /** A "?" after the title that opens this */
    help?: { label: string; content: ReactNode };
    /** At the right of the heading */
    actions?: ReactNode;
    children?: ReactNode;
    sx?: SxProps<Theme>;
    ref?: Ref<HTMLElement>;
    /** The focus comes into the section, or moves within it (React's focus events bubble) */
    onFocus?: FocusEventHandler<HTMLElement>;
    onBlur?: FocusEventHandler<HTMLElement>;
    /** For whoever needs to find the section: a capture script, a test */
    [dataAttribute: `data-${string}`]: string | undefined;
}

/**
 * A section inside a card: a bold heading, then the help and the section's actions, then its rows. A section (h3) has a
 * rule under its heading; a part of one (h4) is smaller, grey and has none, so the two read apart and their rules do not
 * stack. No band of its own, so the card's title bar stays the one band. A section of the page, named by its heading.
 */
export function PanelSection({ title, level, help, actions, children, sx, ref, onFocus, onBlur, ...data }: PanelSectionProps) {
    const titleId = `${useId()}-title`;
    const part = level === 4;
    return (
        <Box
            ref={ref}
            component="section"
            aria-labelledby={titleId}
            sx={[{ mb: part ? 2 : 3, '&:last-child': { mb: 0 } }, ...(Array.isArray(sx) ? sx : [sx])]}
            onFocus={onFocus}
            onBlur={onBlur}
            {...data}
        >
            <TitleBar title={title} titleId={titleId} level={level} help={help} actions={actions} variant={part ? 'subtitle2' : 'subtitle1'}
                titleSx={part ? { fontWeight: 600, color: 'text.secondary' } : { fontWeight: 700, fontSize: '1.0625rem' }} sx={{
                    minHeight: part ? 32 : 40,
                    mb: part ? 1 : 1.5,
                    borderBottom: part ? 'none' : (theme: Theme) => `1px solid ${themeTokens(theme).control.edge}`,
                }} />
            {children}
        </Box>
    );
}

/** A card's or a section's heading, its help after it and its actions at the right, wrapping under it when they do not fit */
function TitleBar({ component = 'div', title, titleId, level, focusable = false, variant, titleSx, help, actions, sx }: {
    component?: 'header' | 'div'; title: string; titleId: string; level: 2 | 3 | 4; focusable?: boolean;
    variant: 'h6' | 'subtitle1' | 'subtitle2'; titleSx: SxProps<Theme>;
    help?: { label: string; content: ReactNode }; actions?: ReactNode; sx: SxProps<Theme>;
}) {
    return <Box component={component} sx={[{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 1 }, ...(Array.isArray(sx) ? sx : [sx])]}>
        {/* the level is set: the theme makes a subtitle a paragraph */}
        <Typography id={titleId} tabIndex={focusable ? -1 : undefined} component={`h${level}`} variant={variant} sx={titleSx}>
            {title}
        </Typography>
        {help && <HelpButton label={help.label}>{help.content}</HelpButton>}
        {actions && <Box sx={{ ml: 'auto', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>{actions}</Box>}
    </Box>;
}
