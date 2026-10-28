import { Box, type SxProps, type Theme } from '@mui/material';
import { MACHINE_QUALITIES, qualityLabel } from '../utils/machinePrototype';
import { SelectField } from './SelectField';

type Quality = typeof MACHINE_QUALITIES[number];
const QUALITIES = new Set<string>(MACHINE_QUALITIES);

const pipSrc = (quality: string) => `/images/inserter-preview/badge-${quality}.png`;

/** The game's quality icon alone, `size` wide, for a quality's name beside it; nothing for an unknown quality */
export function QualityPip({ quality, size }: { quality: string; size: number }) {
    if (!QUALITIES.has(quality)) return null;
    return <Box component="img" src={pipSrc(quality)} alt="" sx={{ width: size, height: size, imageRendering: 'pixelated', flexShrink: 0 }} />;
}

/**
 * The game's quality pip at the bottom-left of an icon of `size`, as the game draws an entity's quality; nothing for an
 * unknown quality. Its parent must be positioned (relative).
 */
export function QualityBadge({ quality, size }: { quality: string | undefined; size: number }) {
    if (quality === undefined || !QUALITIES.has(quality)) return null;
    return <Box component="img" src={pipSrc(quality)} alt=""
        sx={{ position: 'absolute', bottom: -1, left: -1, width: Math.round(size * 0.42), height: Math.round(size * 0.42), imageRendering: 'pixelated', filter: 'drop-shadow(0 1px 1px #000)' }} />;
}

/** A quality dropdown, each quality with the game's pip before its name */
export function QualityField({ label = 'Quality', value, onChange, inputAriaLabel, sx }: {
    label?: string; value: Quality | undefined; onChange: (quality: Quality) => void; inputAriaLabel: string; sx?: SxProps<Theme>;
}) {
    return <SelectField label={label} shrink value={value ?? 'normal'} options={MACHINE_QUALITIES} onChange={onChange} inputAriaLabel={inputAriaLabel} sx={sx}
        render={quality => <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <QualityPip quality={quality} size={16} />{qualityLabel(quality)}
        </Box>} />;
}

/** An icon with its quality pip, the size of the icon */
export function WithQuality({ quality, size, children }: { quality: string | undefined; size: number; children: React.ReactNode }) {
    return <Box component="span" sx={{ position: 'relative', display: 'inline-flex', width: size, height: size, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}>
        {children}
        <QualityBadge quality={quality} size={size} />
    </Box>;
}
