import { Box, Chip, Tooltip, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import type { ClockBadge } from '../utils/clockSummary';
import { clockChipsOf, type NamedClock } from '../utils/strategyNames';

/** The chips that say how the clock's windows were made */
const HOW_MADE_CHIPS = new Set(['tuning_method', 'selection']);

/**
 * What qualifies a clock's strategy, after its name: "· 2 output swings each output cycle · shared enable windows". Each is a few
 * words in the page's grey, with its line in the hover and for the keyboard.
 */
export function ClockChips({ clock, settingsOnly = false, after }: {
    clock: NamedClock;
    /** Only the chips of the clock's settings, without how its windows were made (tuning method and selection): the card's */
    settingsOnly?: boolean;
    /** What stands after the last chip and never wraps away from it: the compare table's (?) */
    after?: ReactNode;
}) {
    const chips = clockChipsOf(clock).filter(chip => !settingsOnly || !HOW_MADE_CHIPS.has(chip.id));
    if (chips.length === 0) return after ?? null;
    const chipOf = (chip: (typeof chips)[number]) => (
        <Tooltip key={chip.id} title={chip.line} arrow describeChild>
            <Typography component="span" variant="body2" color="text.secondary" tabIndex={0} data-strategy-chip={chip.id}
                sx={{ whiteSpace: 'nowrap' }}>
                · {chip.label}
            </Typography>
        </Tooltip>
    );
    return (
        <>
            {chips.slice(0, -1).map(chipOf)}
            {after === undefined ? chipOf(chips[chips.length - 1])
                : <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', columnGap: 0.5, whiteSpace: 'nowrap' }}>{chipOf(chips[chips.length - 1])}{after}</Box>}
        </>
    );
}

/** The chips beside a clock's name: its status, and what it has fewest of. `meanings` says what a chip means, by its text */
export function BadgeChips({ badges, meanings = {} }: { badges: ClockBadge[]; meanings?: Record<string, string> }) {
    return (
        <Box component="span" sx={{ display: 'contents' }}>
            {badges.map(badge => {
                const chip = (
                    <Chip size="small" variant="outlined" label={badge.text} data-badge={badge.kind}
                        // Stable in the colour of a good state; Error in the red of a failed check ("Check failed"); the other status chips warn
                        color={badge.kind !== 'status' ? 'default' : badge.status === 'stable' ? 'success' : badge.status === 'error' ? 'error' : 'warning'}
                        tabIndex={meanings[badge.text] ? 0 : undefined}
                        // on the card colour of its own: the selected row's orange tint, hovered, takes warning words under 4.5:1
                        sx={{ bgcolor: 'background.paper' }} />
                );
                // beside the status chip: the rate, or the words for the engine's reason code (outputTermOf)
                const reason = badge.detail !== undefined
                    && <Typography component="span" variant="body2" color="text.secondary" data-badge-detail="">{badge.detail}</Typography>;
                return meanings[badge.text]
                    ? <Box component="span" key={badge.text} sx={{ display: 'contents' }}><Tooltip title={meanings[badge.text]} arrow describeChild>{chip}</Tooltip>{reason}</Box>
                    : <Box component="span" key={badge.text} sx={{ display: 'contents' }}>{chip}{reason}</Box>;
            })}
        </Box>
    );
}
