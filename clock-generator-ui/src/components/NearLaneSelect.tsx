import { Box, MenuItem, TextField, Tooltip } from '@mui/material';
import { useId, useState } from 'react';
import { useGameNames } from '../hooks/useGameNames';
import type { BeltFormData, InserterFormData } from '../hooks/useConfigForm';
import { nearLaneItems, withNearLane } from '../utils/nearLane';
import { FactorioIcon } from './FactorioIcon';

const LABEL = 'Nearest lane of the belt';
const HELP = 'An inserter takes from the lane nearest to it first when its machine takes both items. The sidecar mod exports it; not set, the order of the filters is used.';
const NOT_SET = 'Not set';
const BEND_HELP = 'This bend pickup takes from lane 1 first. Its supported layout fixes the lane.';

interface NearLaneSelectProps {
    source: InserterFormData['source'];
    belts: BeltFormData[];
    onChange: (source: InserterFormData['source']) => void;
    /** "Inserter 3": added to the accessible name where several rows have the same select */
    entityLabel?: string;
    /** For a List row: no helper text under the field, the same sentence in a tooltip instead */
    compact?: boolean;
}

/**
 * Which lane of its belt an inserter is nearest to, which it takes from first. Shown only when the source is a belt
 * whose two lanes carry different items. The List row and the diagram's inserter dialog both use it.
 */
/** A lane's icon and "Lane 1: bioflux"; the text ends in an ellipsis where the field is narrow, with the whole in its title */
function LaneText({ lane, item }: { lane: number; item: string }) {
    const { itemLabel } = useGameNames();
    const text = `Lane ${lane}: ${itemLabel(item)}`;
    return (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            {/* the text names the item: the icon's alt would say it twice ("Bioflux Lane 1: Bioflux") */}
            <Box component="span" aria-hidden sx={{ display: 'flex', flexShrink: 0 }}>
                <FactorioIcon name={item} size={18} alt="" />
            </Box>
            <Box component="span" title={text} sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{text}</Box>
        </Box>
    );
}

export function NearLaneSelect({ source, belts, onChange, entityLabel, compact }: NearLaneSelectProps) {
    const helpId = useId();
    const [tipOpen, setTipOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const lanes = nearLaneItems(source, belts);
    if (!lanes) return null;
    const fixedLane = source.pickup_layout === 'bend-right-upstream';
    const help = fixedLane ? BEND_HELP : HELP;

    const field = (
        <TextField
            select
            size="small"
            fullWidth={!compact}
            label={LABEL}
            helperText={compact ? undefined : help}
            value={source.near_lane ?? 0}
            onChange={(e) => {
                const lane = Number(e.target.value);
                onChange(withNearLane(source, lane === 1 || lane === 2 ? lane : 0));
            }}
            // narrow in a row, so the row keeps to one line at 1440; a long lane name ends in an ellipsis
            sx={compact ? { width: 160 } : undefined}
            slotProps={{
                select: {
                    // the help tooltip would cover the open list
                    onOpen: () => { setMenuOpen(true); setTipOpen(false); },
                    onClose: () => setMenuOpen(false),
                    renderValue: (value) => (value === 1 || value === 2 ? <LaneText lane={value} item={lanes[value - 1]} /> : NOT_SET),
                    SelectDisplayProps: {
                        // the visible label first, then which inserter (WCAG 2.5.3)
                        ...(entityLabel && { 'aria-label': `${LABEL}, ${entityLabel}`, 'aria-labelledby': undefined }),
                        ...(compact && { 'aria-describedby': helpId }),
                    },
                },
            }}
        >
            <MenuItem value={0} disabled={fixedLane}>{NOT_SET}</MenuItem>
            {lanes.map((item, i) => (
                <MenuItem key={i} value={i + 1} disabled={fixedLane && i !== 0}>
                    <LaneText lane={i + 1} item={item} />
                </MenuItem>
            ))}
        </TextField>
    );

    if (!compact) return field;
    return (
        <>
            <Tooltip
                title={help}
                describeChild
                open={tipOpen && !menuOpen}
                onOpen={() => setTipOpen(true)}
                onClose={() => setTipOpen(false)}
            >
                {field}
            </Tooltip>
            {/* hidden, but aria-describedby still reads it */}
            <span id={helpId} hidden>{help}</span>
        </>
    );
}
