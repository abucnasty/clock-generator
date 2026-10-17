import { Box } from '@mui/material';
import { Fragment } from 'react';
import type { WakeWindowRow } from '../utils/wakeWindows';
import { VISUALLY_HIDDEN } from '../utils/visuallyHidden';
import { FactorioIcon } from './FactorioIcon';
import { GameName } from './GameName';
import { RouteBadge, ContentIcons } from './RouteIdentity';
import { useGameNames } from '../hooks/useGameNames';

/** Numbered endpoint badges with recipe/content context; older results without config keep their recorded route. */
export function WakeRowMoves({ row }: { row: Pick<WakeWindowRow, 'items' | 'route' | 'source' | 'sink'> }) {
    const { itemLabel } = useGameNames();
    const ends = [row.source, row.sink].filter(option => option !== undefined);
    if (row.sink && (row.source || row.route.startsWith('into '))) {
        const description = ends.map(option => [option.label, option.sublabel,
            !option.sublabel ? option.ingredientIcons?.map(itemLabel).join(', ') : undefined].filter(Boolean).join(' · ')).join(' → ');
        return <Box component="span" role="img" aria-label={description} title={description}
            sx={{ display: 'inline-flex', flexDirection: 'column', gap: 0.25, maxWidth: '100%', verticalAlign: 'middle' }}>
            <Box component="span" aria-hidden sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                {row.source && <><RouteBadge option={row.source} /><ContentIcons option={row.source} size={18} /></>}
                <Box component="span">→</Box>
                <RouteBadge option={row.sink} /><ContentIcons option={row.sink} size={18} />
            </Box>
            <Box component="span" aria-hidden sx={{ overflowWrap: 'anywhere' }}>{row.route.replace(' to ', ' → ')}</Box>
        </Box>;
    }
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
