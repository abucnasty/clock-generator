import { Box, MenuItem, TextField, Tooltip } from '@mui/material';
import { useId, useState } from 'react';
import type { BeltFormData, InserterFormData } from '../hooks/useConfigForm';
import { nearLaneItems, withNearLane } from '../utils/nearLane';
import { VISUALLY_HIDDEN } from '../utils/visuallyHidden';
import { FactorioIcon } from './FactorioIcon';

const LABEL = 'Nearest lane of the belt';
const HELP = 'An inserter takes from the lane nearest to it first when its machine takes both items. The sidecar mod exports it; not set, the order of the filters is used.';
const NOT_SET = 'Not set';

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
export function NearLaneSelect({ source, belts, onChange, entityLabel, compact }: NearLaneSelectProps) {
    const helpId = useId();
    const [tipOpen, setTipOpen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const lanes = nearLaneItems(source, belts);
    if (!lanes) return null;

    const field = (
        <TextField
            select
            size="small"
            fullWidth={!compact}
            label={LABEL}
            helperText={compact ? undefined : HELP}
            value={source.near_lane ?? 0}
            onChange={(e) => {
                const lane = Number(e.target.value);
                onChange(withNearLane(source, lane === 1 || lane === 2 ? lane : 0));
            }}
            sx={compact ? { minWidth: 210 } : undefined}
            slotProps={{
                select: {
                    // the help tooltip would cover the open list
                    onOpen: () => { setMenuOpen(true); setTipOpen(false); },
                    onClose: () => setMenuOpen(false),
                    SelectDisplayProps: {
                        // the visible label first, then which inserter (WCAG 2.5.3)
                        ...(entityLabel && { 'aria-label': `${LABEL}, ${entityLabel}`, 'aria-labelledby': undefined }),
                        ...(compact && { 'aria-describedby': helpId }),
                    },
                },
            }}
        >
            <MenuItem value={0}>{NOT_SET}</MenuItem>
            {lanes.map((item, i) => (
                <MenuItem key={i} value={i + 1}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        {/* the text names the item: the icon's alt would say it twice ("bioflux Lane 1: bioflux") */}
                        <Box component="span" aria-hidden sx={{ display: 'flex' }}>
                            <FactorioIcon name={item} size={18} />
                        </Box>
                        Lane {i + 1}: {item}
                    </Box>
                </MenuItem>
            ))}
        </TextField>
    );

    if (!compact) return field;
    return (
        <>
            <Tooltip
                title={HELP}
                describeChild
                open={tipOpen && !menuOpen}
                onOpen={() => setTipOpen(true)}
                onClose={() => setTipOpen(false)}
            >
                {field}
            </Tooltip>
            <Box component="span" id={helpId} sx={VISUALLY_HIDDEN}>{HELP}</Box>
        </>
    );
}
