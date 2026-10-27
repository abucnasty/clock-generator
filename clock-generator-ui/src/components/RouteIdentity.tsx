import { Box, Typography } from '@mui/material';
import type { EntitySelectorOption } from '../utils/entitySelector';
import { EntityBadge } from './EntityBadge';
import { FactorioIcon } from './FactorioIcon';
import { BeltLanePreview } from './BeltLanePreview';

/** Shared visual identity for route fields and suggested connections. */
export function RouteBadge({ option }: { option: EntitySelectorOption }) {
    return <Box component="span" aria-hidden sx={{ display: 'inline-flex', flexShrink: 0 }}>
        <EntityBadge id={option.id} size="small">
            {option.belt
                ? <Box component="span" sx={{ width: 31, height: 28, position: 'relative', '& > span': { position: 'absolute', left: 0, top: 0, transform: 'scale(0.7)', transformOrigin: 'top left' } }}><BeltLanePreview belt={option.belt} /></Box>
                : <FactorioIcon name={option.icon} size={22} alt="" />}
        </EntityBadge>
    </Box>;
}

export function ContentIcons({ option, size = 18, maxIcons = 2 }: { option: EntitySelectorOption; size?: number; maxIcons?: number }) {
    const icons = option.ingredientIcons ?? [];
    if (!icons.length) return null;
    return <Box component="span" aria-hidden sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
        {icons.slice(0, maxIcons).map((item, i) => <FactorioIcon key={`${item}-${i}`} name={item} size={size} alt="" />)}
        {icons.length > maxIcons && <Typography component="span" variant="caption">+{icons.length - maxIcons}</Typography>}
    </Box>;
}

