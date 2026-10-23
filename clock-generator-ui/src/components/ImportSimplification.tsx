import { Alert, AlertTitle, Box, Button, Typography } from '@mui/material';
import { useEffect, useRef, useState } from 'react';
import type { Config, RepeatedUnitConversionPlan } from 'clock-generator/browser';
import type { CheckedRepeatedUnitConversion } from '../worker/types';
import { askEngine } from '../worker/engineClient';
import { useGameNames } from '../hooks/useGameNames';
import { importReduction, type ImportReduction } from '../utils/importReduction';
import { importedAsOneUnitText } from '../utils/pasteText';

function Changes({ reduction }: { reduction: ImportReduction }) {
    return <Box component="ul" sx={{ my: 1, pl: 2 }}>
        {reduction.changes.map(change => <Typography component="li" variant="body2" key={change.label}>
            <strong>{change.label}:</strong> {change.before} → {change.after}
        </Typography>)}
    </Box>;
}

/** One conversion check per exact preview; never runs generation or modifies the build. */
export function ImportSimplification({ config, applied, onSimplify, onRestore, onRepeated }: {
    config: Config | null;
    applied?: ImportReduction;
    onSimplify: (plan: RepeatedUnitConversionPlan) => void;
    onRestore: () => void;
    onRepeated: (sourceKey: string) => void;
}) {
    const { recipeLabel } = useGameNames();
    const key = config ? JSON.stringify(config) : null;
    const [result, setResult] = useState<{ key: string; checked: CheckedRepeatedUnitConversion | null } | null>(null);
    const reportedKey = useRef<string | null>(null);
    const simplifyButton = useRef<HTMLButtonElement>(null);
    const wasApplied = useRef(false);
    useEffect(() => {
        if (applied) document.getElementById('confirm-factorio-import')?.focus();
        else if (wasApplied.current) simplifyButton.current?.focus();
        wasApplied.current = Boolean(applied);
    }, [applied]);
    useEffect(() => {
        if (!key || applied || result?.key === key) return;
        let current = true;
        const timer = setTimeout(() => {
            askEngine({ kind: 'repeated-unit-conversion', config: JSON.parse(key) as Config }).then(
                checked => { if (current) setResult({ key, checked }); },
                () => { if (current) setResult({ key, checked: null }); },
            );
        }, 200);
        return () => { current = false; clearTimeout(timer); };
    }, [key, applied, result]);
    useEffect(() => {
        if (key && !applied && result?.key === key && result.checked?.kind === 'available' && reportedKey.current !== key) {
            reportedKey.current = key;
            onRepeated(key);
        }
    }, [key, applied, result, onRepeated]);
    if (applied) return <Alert severity="success" sx={{ mb: 2 }}>
        <AlertTitle>Simpler build ready to import</AlertTitle>
        <Changes reduction={applied} />
        <Typography variant="body2">Total output: {applied.target.items_per_second}/s {recipeLabel(applied.target.recipe)} across {applied.copies} copies.</Typography>
        <Button size="small" color="inherit" onClick={onRestore} sx={{ mt: 0.5 }}>Review full pasted build</Button>
    </Alert>;
    const checked = result?.key === key ? result.checked : null;
    if (!config) return null;
    if (result?.key !== key) return <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>Checking for a simpler version…</Typography>;
    // a refusal matters to an export of several copies, which Check will not take as it is; one copy needs no box
    if (checked?.kind === 'unavailable' && checked.repeatedGroups > 1) {
        const text = importedAsOneUnitText(checked, config);
        return <Alert severity="info" sx={{ mb: 2 }}>
            <AlertTitle>Imported as one unit</AlertTitle>
            <Typography variant="body2">{text.what}</Typography>
            <Typography variant="body2" sx={{ mt: 0.75 }}>{text.next}</Typography>
        </Alert>;
    }
    if (checked?.kind !== 'available') return null;
    return <Alert severity="warning" sx={{ mb: 2 }}>
        <AlertTitle>Hold up, fellow engineer—trying to melt your CPU?</AlertTitle>
        <Typography variant="body2">We found {checked.plan.multiplicity} identical groups. Keep one complete group and use Copies for the rest: fewer entities to calculate, the same total output.</Typography>
        <Changes reduction={importReduction(config, checked.plan.candidate)} />
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, p: 0.5 }}>
            <Button ref={simplifyButton} size="small" variant="contained" color="success" onClick={() => onSimplify(checked.plan)}>Use simpler version</Button>
        </Box>
        <Typography variant="caption" component="p" sx={{ mt: 0.75, mb: 0 }}>Force importing keeps every pasted entity. Check will still require reducing these repeated groups before generating a clock.</Typography>
    </Alert>;
}
