import { Box } from '@mui/material';

const QUALITIES = new Set(['normal', 'uncommon', 'rare', 'epic', 'legendary']);

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

/** An icon with its quality pip, the size of the icon */
export function WithQuality({ quality, size, children }: { quality: string | undefined; size: number; children: React.ReactNode }) {
    return <Box component="span" sx={{ position: 'relative', display: 'inline-flex', width: size, height: size, flexShrink: 0, alignItems: 'center', justifyContent: 'center' }}>
        {children}
        <QualityBadge quality={quality} size={size} />
    </Box>;
}
