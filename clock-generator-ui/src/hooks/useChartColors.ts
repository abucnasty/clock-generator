import { useTheme } from '@mui/material/styles';
import { useMemo } from 'react';
import { chartColorsFor } from '../components/colors';

export function useChartColors() {
    const { palette: { mode } } = useTheme();
    return useMemo(() => chartColorsFor(mode), [mode]);
}
