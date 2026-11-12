import { Box, Chip, Tooltip, Typography } from '@mui/material';
import { SUMMARY_COPY, type ClockBadge } from '../utils/clockSummary';
import { clockChipsOf, type NamedClock } from '../utils/strategyNames';

/**
 * What qualifies a clock's strategy, after its name: "· 2 output swings each output cycle · shared enable windows". Each is a few
 * words in the page's grey, with its line in the hover and for the keyboard.
 */
export function ClockChips({ clock }: { clock: NamedClock }) {
    const chips = clockChipsOf(clock);
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
                        // Stable in the colour of a good state, as the full table's "Recovery: Yes"; the other status chips warn
                        color={badge.kind !== 'status' ? 'default' : badge.text === SUMMARY_COPY.stable ? 'success' : 'warning'}
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
