import { Typography } from '@mui/material';
import { useGameNames } from '../hooks/useGameNames';
import { inserterDetailLines } from '../utils/pasteText';

type Inserters = Parameters<typeof inserterDetailLines>[0];

/** The paste's import details for the inserters it will leave in the build, those with the same settings together */
export function InserterDetails({ inserters }: { inserters: Inserters }) {
    const { itemLabel } = useGameNames();
    if (inserters.length === 0) return <Typography variant="body2">No inserters in this composition.</Typography>;
    return <>{inserterDetailLines(inserters, itemLabel).map(line => <Typography key={line} variant="body2">{line}</Typography>)}</>;
}
