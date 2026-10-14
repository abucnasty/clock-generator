import { Box } from '@mui/material';

interface FactorioIconProps {
    name: string;
    size?: number;
    /** What the picture says. Pass "" when the item's name is written next to it, so it is not read out twice. */
    alt?: string;
    fallback?: React.ReactNode;
}

/**
 * Displays a Factorio icon if available in public/icons folder.
 * Falls back to nothing or a custom fallback if the icon doesn't exist.
 */
export function FactorioIcon({ name, size = 24, alt = name, fallback: _fallback = null }: FactorioIconProps) {
    // Note: fallback not yet implemented - could be used to show placeholder
    void _fallback;
    // Normalize the name to match icon file naming convention
    const iconName = name.toLowerCase().replace(/_/g, '-');
    const iconPath = `/icons/${iconName}.png`;

    return (
        <Box
            component="img"
            src={iconPath}
            alt={alt}
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
