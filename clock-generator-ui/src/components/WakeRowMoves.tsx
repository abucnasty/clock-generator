import { Box } from '@mui/material';
import type { WakeWindowRow } from '../utils/wakeWindows';
import { FactorioIcon } from './FactorioIcon';

/**
 * What a Wake windows row moves and between what: the item's icon, then ": Belt 1 to Machine 2" (a drill's ": into
 * Machine 1"). The icon's name and hover text are the item's game name, so a screen reader says "Electronic circuit:
 * Belt 1 to Machine 2" and no id is shown.
 */
export function WakeRowMoves({ row }: { row: Pick<WakeWindowRow, 'items' | 'route'> }) {
    return (
        <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.5, verticalAlign: 'middle' }}>
            {row.items.map(item => <FactorioIcon key={item} name={item} size={16} titled />)}
            {row.items.length > 0 && row.route ? <span aria-hidden>:</span> : null}
            {row.route ? <span>{row.route}</span> : null}
        </Box>
    );
}
