import { Alert } from '@mui/material';
import { useGameNames } from '../hooks/useGameNames';
import { staleResultsMessage, type GeneratedFor } from '../utils/resultsStaleness';

/** Over Results while the clocks on screen were made for an earlier build than the one in the form */
export function StaleResultsBanner({ generatedFor }: { generatedFor: GeneratedFor }) {
    const { recipeLabel } = useGameNames();
    return (
        <Alert severity="warning" sx={{ mb: 2 }}>
            {staleResultsMessage(generatedFor, recipeLabel)}
        </Alert>
    );
}
