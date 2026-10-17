import { Alert, AlertTitle, Box, Button } from '@mui/material';
import { useId } from 'react';
import { checkErrorText } from '../utils/checkErrorText';
import { CHECK_TEXT } from '../utils/checkThenGenerate';
import { ELEMENT_IDS } from '../utils/firstProblem';
import type { RepeatedUnitsRecovery } from '../worker/types';

function recoveryText(recovery: RepeatedUnitsRecovery): string {
    const conversion = recovery.conversion;
    if (conversion.kind === 'unavailable') {
        return conversion.stage === 'check'
            ? `One complete unit was identified, but its check failed: ${conversion.message} Your build has not changed. Keep Items per Second as the total rate.`
            : `${conversion.message} Select one complete unit in Factorio and paste it again. Keep Items per Second as the total rate. Your build has not changed.`;
    }
    const grouping = conversion.multiplicity === recovery.detectedCopies
        ? `${conversion.multiplicity} identical units found.`
        : `A complete modeled grouping repeats ${conversion.multiplicity} times.`;
    return `${grouping} Use one complete modeled unit with ${conversion.copies} copies. `
        + (recovery.configuredCopies !== 1 ? `Copies will change from ${recovery.configuredCopies} to ${conversion.copies}. ` : '')
        + 'Items per Second stays the total for all copies. Your build has not changed.';
}

/**
 * At the top of Configure: why the last check of this build failed, in the engine's words (or the page's, for the ones it rewords). Generate and the note in the
 * workflow bar move the focus here, which reads it out. Not a live region (role note, not MUI's role alert), so that it is
 * read once, not once as an alert and again as the focus; a check from Check only says its result through the page's
 * announcer instead.
 */
export function CheckErrorAlert({ message, crashed = false, recovery, conversionPending = false, onConvert }: {
    message: string | null; crashed?: boolean; recovery?: RepeatedUnitsRecovery;
    conversionPending?: boolean; onConvert?: () => void;
}) {
    const titleId = useId();
    const messageId = useId();
    if (message === null) {
        return null;
    }
    return (
        <Alert
            severity="error"
            role="note"
            id={ELEMENT_IDS.validationError}
            // named by its title and described by the message, so the focus reads both
            aria-labelledby={titleId}
            aria-describedby={messageId}
            tabIndex={-1}
            // a visible outline when Generate or the note in the workflow bar moves the focus here
            sx={{ mb: 2, '&:focus': { outline: '2px solid', outlineColor: 'error.main', outlineOffset: 2 } }}
        >
            {/* a check whose worker stopped says it was not the build; the browser's words are in the Log */}
            <AlertTitle id={titleId}>{crashed ? CHECK_TEXT.crashTitle : CHECK_TEXT.errorTitle}</AlertTitle>
            <span id={messageId}>{crashed ? CHECK_TEXT.crashText : recovery ? recoveryText(recovery) : checkErrorText(message)}</span>
            {!crashed && recovery?.conversion.kind === 'available' && onConvert && (
                <Box sx={{ mt: 1, p: '6px' }}>
                    {/* MUI's message scroll container clips outside focus rings; reserve paint space on every side. */}
                    <Button variant="contained" color="success" onClick={onConvert} disabled={conversionPending}>
                        {conversionPending ? 'Checking one unit…' : `Use one unit · ${recovery.conversion.copies} copies`}
                    </Button>
                </Box>
            )}
        </Alert>
    );
}
