import { Box } from '@mui/material';
import { useGameNames } from '../hooks/useGameNames';
import { nameWithId } from '../utils/gameNames';

interface FactorioIconProps {
    name: string;
    size?: number;
    /** What the picture says; the in-game name by default. Pass "" when the item's name is written next to it, so it is not read out twice. */
    alt?: string;
    /** Shows "Name (id)" on hover. For icons that stand alone and are not inside a Tooltip, which has its own text. */
    titled?: boolean;
    fallback?: React.ReactNode;
}

/**
 * Displays a Factorio icon if available in public/icons folder.
 * Falls back to nothing or a custom fallback if the icon doesn't exist.
 */
export function FactorioIcon({ name, size = 24, alt, titled = false, fallback: _fallback = null }: FactorioIconProps) {
    const { iconLabel } = useGameNames();
    const label = iconLabel(name);
    // Note: fallback not yet implemented - could be used to show placeholder
    void _fallback;
    // Normalize the name to match icon file naming convention
    const iconName = name.toLowerCase().replace(/_/g, '-');
    const iconPath = `/icons/${iconName}.png`;

    return (
        <Box
            component="img"
            // a new element for a new picture: one that failed to load hid itself, and the next one must show
            key={iconPath}
            src={iconPath}
            alt={alt ?? label}
            title={titled ? nameWithId(label, name) : undefined}
            sx={{
                width: size,
                height: size,
                objectFit: 'contain',
                imageRendering: 'pixelated', // Crisp pixel art scaling
            }}
            onError={(e) => {
                // Hide the image if it fails to load
                const target = e.target as HTMLImageElement;
                target.style.display = 'none';
            }}
        />
    );
}
