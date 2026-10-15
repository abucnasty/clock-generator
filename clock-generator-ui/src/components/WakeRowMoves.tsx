import { Box } from '@mui/material';
import type { WakeWindowRow } from '../utils/wakeWindows';
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
                {row.items.map(item => (
                    <FactorioIcon key={item} name={item} size={20} titled fallback={<GameName id={item} />} />
                ))}
            </Box>
            <Box component="span" sx={{ minWidth: 0 }}>{colon}{row.route}</Box>
        </Box>
    );
}
