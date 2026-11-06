import { Box, Chip, Tooltip, Typography } from '@mui/material';
import type { ClockBadge } from '../utils/clockSummary';
import { qualifierChipsOf, type NamedClock } from '../utils/strategyNames';

/**
 * What qualifies a clock's strategy, after its name: "· 2 output swings a cycle · shared enable windows". Each is a few
 * words in the page's grey, with its line in the hover and for the keyboard.
 */
export function QualifierChips({ clock }: { clock: NamedClock }) {
    const chips = qualifierChipsOf(clock);
    if (chips.length === 0) return null;
    return (
        <>
            {chips.map(chip => (
                <Tooltip key={chip.id} title={chip.line} arrow describeChild>
                    <Typography component="span" variant="body2" color="text.secondary" tabIndex={0} data-strategy-chip={chip.id}
                        sx={{ whiteSpace: 'nowrap' }}>
                        · {chip.label}
                    </Typography>
                </Tooltip>
            ))}
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
                        color={badge.kind === 'status' ? 'warning' : 'default'} tabIndex={meanings[badge.text] ? 0 : undefined}
                        // on the card colour of its own: the selected row's orange tint, hovered, takes warning words under 4.5:1
                        sx={{ bgcolor: 'background.paper' }} />
                );
                return meanings[badge.text]
                    ? <Tooltip key={badge.text} title={meanings[badge.text]} arrow describeChild>{chip}</Tooltip>
                    : <Box component="span" key={badge.text} sx={{ display: 'contents' }}>{chip}</Box>;
            })}
        </Box>
    );
}
