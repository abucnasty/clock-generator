import { Box } from '@mui/material';
import { Fragment } from 'react';
import type { WakeWindowRow } from '../utils/wakeWindows';
import { VISUALLY_HIDDEN } from '../utils/visuallyHidden';
import { FactorioIcon } from './FactorioIcon';
import { GameName } from './GameName';

/**
 * What a Wake windows row moves and between what: the item's icon, then ": Belt 1 to Machine 2" (a drill's ": into
 * Machine 1"). The icon's name and hover text are the item's game name, so a screen reader says "Electronic circuit:
 * Belt 1 to Machine 2" and no id is shown. An item with no icon shows its name instead.
 */
export function WakeRowMoves({ row }: { row: Pick<WakeWindowRow, 'items' | 'route'> }) {
    const colon = row.items.length > 0 && row.route ? ': ' : '';
    return (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'nowrap', maxWidth: '100%', verticalAlign: 'middle' }}>
            <Box component="span" sx={{ display: 'inline-flex', flexShrink: 0, gap: 0.5 }}>
                {row.items.map((item, index) => (
                    <Fragment key={item}>
                        {/* the icons stand apart on screen; a screen reader hears "Bioflux, Jelly", not one run of names */}
                        {index > 0 && <Box component="span" sx={VISUALLY_HIDDEN}>, </Box>}
                        <FactorioIcon name={item} size={20} titled fallback={<GameName id={item} />} />
                    </Fragment>
                ))}
            </Box>
            <Box component="span" sx={{ minWidth: 0 }}>{colon}{row.route}</Box>
        </Box>
    );
}
