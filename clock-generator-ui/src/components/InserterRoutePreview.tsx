import ArrowForward from '@mui/icons-material/ArrowForward';
import { Box, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import type { InserterFormData } from '../utils/configForm/formData';
import { entityLabel } from '../utils/entityLabel';
import { findOption, type EntityOption } from '../utils/inserterOptions';
import { entitySelectorLabel } from '../utils/entitySelector';
import { BLACKLIST_NOTE, usesAutomaticFilters, usesBlacklist } from '../utils/inserterFilters';
import { useGameNames } from '../hooks/useGameNames';
import { FactorioIcon } from './FactorioIcon';
import { RouteBadge } from './RouteIdentity';

interface InserterRoutePreviewProps {
    value: InserterFormData;
    options: EntityOption[];
    /** The current whitelist, automatic item inference, or blacklist items, as computed by the caller. */
    filterItems: readonly string[];
    /** Existing row drag handle and inserter badge, supplied by the parent. */
    identity: ReactNode;
}

export function InserterRoutePreview({ value, options, filterItems, identity }: InserterRoutePreviewProps) {
    const { itemLabel } = useGameNames();
    const blacklist = usesBlacklist(value);
    const automatic = usesAutomaticFilters(value.filters);
    const endpoint = (side: 'source' | 'sink') => {
        const ref = value[side];
        const option = findOption(options, ref.type, ref.id);
        const name = option ? option.label : `${entityLabel(ref.type, ref.id)} · unavailable`;
        const title = option ? entitySelectorLabel(option) : `${entityLabel(ref.type, ref.id)} · endpoint unavailable`;
        return <Box key={side} role="group" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }} title={title} aria-label={`${side === 'source' ? 'Source' : 'Destination'}: ${title}`}>
            {option ? <RouteBadge option={option} /> : <Typography component="span" aria-hidden sx={{ flexShrink: 0 }}>?</Typography>}
            <Box sx={{ minWidth: 0 }}>
                <Typography variant="caption" color="text.secondary" component="div">{side === 'source' ? 'Source' : 'Destination'}</Typography>
                <Typography variant="body2" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</Typography>
                {option?.sublabel && <Typography variant="caption" color="text.secondary" component="div" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{option.sublabel}</Typography>}
            </Box>
        </Box>;
    };
    const mode = blacklist ? 'Blacklist · Excluded' : automatic ? 'Auto' : 'Explicit filters';
    const visibleItems = [...filterItems];
    const noItems = automatic && visibleItems.length === 0;
    const explicitlyEmpty = !automatic && !blacklist && visibleItems.length > 0 && visibleItems.every(item => item === 'no-item');
    const visible = visibleItems.slice(0, 5);
    const allNames = visibleItems.map(itemLabel);
    const itemSummary = blacklist
        ? `Excluded items: ${allNames.join(', ') || 'none listed'}`
        : noItems ? 'No items inferred' : explicitlyEmpty ? 'No items' : `Items: ${allNames.join(', ')}`;

    return <Box sx={{ containerType: 'inline-size', minWidth: 0 }}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto minmax(120px, 0.8fr) auto minmax(0, 1fr)', alignItems: 'center', gap: 1,
            '@container (max-width: 650px)': { gridTemplateColumns: 'minmax(0, 1fr)', gap: 1.25 } }}>
            {endpoint('source')}
            <ArrowForward aria-hidden sx={{ color: 'text.secondary', '@container (max-width: 650px)': { display: 'none' } }} />
            <Box role="group" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0, flexWrap: 'wrap' }} title={itemSummary} aria-label={itemSummary}>
                <Box sx={{ display: 'inline-flex', alignItems: 'center', flexShrink: 0 }}>{identity}</Box>
                {noItems ? <Typography variant="caption" color="text.secondary">No items inferred</Typography>
                        : <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.35, minWidth: 0 }}>
                            {visible.map((item, index) => <FactorioIcon key={`${item}-${index}`} name={item} size={22} titled alt="" />)}
                            {visibleItems.length > visible.length && <Typography variant="caption" color="text.secondary" aria-label={`${visibleItems.length - visible.length} more items`}>+{visibleItems.length - visible.length}</Typography>}
                        </Box>}
                <Typography variant="caption" color={blacklist ? 'warning.main' : 'text.secondary'} sx={{ whiteSpace: 'nowrap' }}>{mode}</Typography>
                {explicitlyEmpty && <Typography variant="caption" color="text.secondary">No items</Typography>}
            </Box>
            <ArrowForward aria-hidden sx={{ color: 'text.secondary', '@container (max-width: 650px)': { display: 'none' } }} />
            {endpoint('sink')}
        </Box>
        {blacklist && <Typography variant="caption" color="warning.main" component="div" sx={{ mt: 0.5 }}>{BLACKLIST_NOTE}</Typography>}
    </Box>;
}
