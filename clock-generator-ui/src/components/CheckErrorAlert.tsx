import { Alert, AlertTitle } from '@mui/material';
import { CHECK_TEXT } from '../utils/checkThenGenerate';
import { ELEMENT_IDS } from '../utils/firstProblem';

/**
 * At the top of Configure: why the last check of this build failed, in the engine's words. Generate and the note in the
 * workflow bar move the focus here, which reads it out. Not a live region (role note, not MUI's role alert), so that it is
 * read once, not once as an alert and again as the focus; a check from Check only says its result through the page's
 * announcer instead.
 */
export function CheckErrorAlert({ message }: { message: string | null }) {
    if (message === null) {
        return null;
    }
    return (
        <Alert
            severity="error"
            role="note"
            id={ELEMENT_IDS.validationError}
            tabIndex={-1}
            // a visible outline when Generate or the note in the workflow bar moves the focus here
            sx={{ mb: 2, '&:focus': { outline: '2px solid', outlineColor: 'error.main', outlineOffset: 2 } }}
        >
            <AlertTitle>{CHECK_TEXT.errorTitle}</AlertTitle>
            {message}
        </Alert>
    );
}
