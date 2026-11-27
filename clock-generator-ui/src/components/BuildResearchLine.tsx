import { Box, Button, Typography } from '@mui/material';
import { useEffect, useMemo, useState } from 'react';
import type { ResearchBuild, ResearchDifferences, ResearchEdit } from 'clock-generator/browser';
import { formDataToConfig } from '../utils/configForm/configMapping';
import type { ConfigFormData } from '../utils/configForm/formData';
import type { StorageLike } from '../utils/buildLibrary';
import { numbersUsedText } from '../utils/blueprintPaste';
import { editText, outsideText, pageStorage, RESEARCH_LINE, researchChoiceOf, yoursText } from '../utils/researchLine';
import { openProfileStore } from '../utils/researchProfiles';
import { askEngine } from '../worker/engineClient';
import { AppDialog } from './AppDialog';
import { ResearchProfileSelect } from './ResearchProfileSelect';

/** The parts of the form research gives a value to, as the engine reads them */
function researchBuildOf(form: ConfigFormData): ResearchBuild {
    const config = formDataToConfig(form);
    return { machines: config.machines, drills: config.drills, inserters: config.inserters, belts: config.belts, chests: config.chests };
}

/**
 * The form with the values research gave, row by row by id, so each row keeps what only the form holds; an edited value
 * that is kept goes back on its row
 */
function withResearch(form: ConfigFormData, build: ResearchBuild, block: NonNullable<ConfigFormData['research']>, kept: readonly ResearchEdit[]): ConfigFormData {
    const keep = (kind: ResearchEdit['kind'], id: number, lane?: 1 | 2) => kept.find(edit => edit.kind === kind && edit.id === id && edit.lane === lane)?.actual;
    const machineOf = new Map(build.machines.map(row => [row.id, row]));
    const drillOf = new Map((build.drills?.configs ?? []).map(row => [row.id, row]));
    const inserterOf = new Map(build.inserters.flatMap(row => row.id === undefined ? [] : [[row.id, row] as const]));
    const beltOf = new Map(build.belts.map(row => [row.id, row]));
    const chestOf = new Map((build.chests ?? []).map(row => [row.id, row]));
    return {
        ...form,
        research: block,
        machines: form.machines.map(row => {
            const next = machineOf.get(row.id);
            return next ? { ...row, productivity: keep('machine', row.id) ?? next.productivity } : row;
        }),
        ...(form.drills && { drills: { ...form.drills, configs: form.drills.configs.map(row => {
            const next = drillOf.get(row.id);
            return next ? { ...row, productivity: keep('drill', row.id) ?? next.productivity } : row;
        }) } }),
        inserters: form.inserters.map(row => {
            const next = inserterOf.get(row.id);
            if (!next) return row;
            const hand = keep('inserter', row.id) ?? next.stack_size;
            return hand === undefined ? row : { ...row, stack_size: hand };
        }),
        belts: form.belts.map(row => {
            const next = beltOf.get(row.id);
            return next ? { ...row, lanes: row.lanes.map((lane, i) => ({ ...lane, stack_size: keep('lane', row.id, (i + 1) as 1 | 2) ?? next.lanes[i]?.stack_size ?? lane.stack_size })) } as typeof row : row;
        }),
        chests: form.chests.map(row => {
            const next = chestOf.get(row.id);
            if (!next || next.type !== 'rocket-silo' || row.type !== 'rocket-silo') return row;
            return { ...row, productivity: keep('silo', row.id) ?? next.productivity } as typeof row;
        }),
    };
}

interface BuildResearchLineProps {
    form: ConfigFormData;
    /** Replaces the build with the research put on, as one step that Undo takes back; the message says what happened */
    onApply: (next: ConfigFormData, message: string) => void;
    /** Where the profiles are kept; this page's localStorage by default */
    storage?: StorageLike;
}

/**
 * The research a build was made with, under the setpoint: the profile and the numbers it gave, the values changed by hand
 * since and the rows that are not from the blueprint, worked out each time the build changes. Another profile puts its
 * numbers on the build from the block's base; where a value was changed by hand it asks first. A build with no block
 * says so, with no chooser. Nothing is written into the profiles but the choice of one.
 */
export function BuildResearchLine({ form, onApply, storage = pageStorage }: BuildResearchLineProps) {
    const [store] = useState(() => openProfileStore(storage));
    const block = form.research;
    // only a build with a block is read: a build typed by hand never goes through the engine's shape here
    const build = useMemo(() => block === undefined ? null : researchBuildOf(form), [form, block]);
    const key = useMemo(() => build === null ? null : JSON.stringify({ build, block }), [build, block]);
    const [differences, setDifferences] = useState<{ key: string; of: ResearchDifferences } | null>(null);
    const [asking, setAsking] = useState<{ name: string; next: { build: ResearchBuild; block: NonNullable<ConfigFormData['research']> }; edited: ResearchEdit[] } | null>(null);

    useEffect(() => {
        if (key === null || build === null || block === undefined) return;
        let live = true;
        askEngine({ kind: 'research-differences', build: { ...build, research: block } }).then(found => { if (live) setDifferences({ key, of: found }); }, () => {});
        return () => { live = false; };
    }, [key, build, block]);

    if (block === undefined || build === null) {
        return <Box data-research-line="" sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary">{RESEARCH_LINE.notRecorded}</Typography>
        </Box>;
    }

    // a profile made or renamed in the profiles dialog since shows here
    store.reload();
    const entries = store.entries();
    const stored = entries.find(entry => entry.name === block.profile);
    const found = differences?.key === key && differences.of.recorded ? differences.of : null;
    const edited = found?.edited ?? [];
    const outside = found?.outside ?? [];

    const choose = async (id: string) => {
        const entry = store.find(id);
        if (!entry) return;
        store.select(id);
        // the values changed by hand as the build is now, not as the line last showed them: a choice made before the
        // line's answer came never writes over a value changed by hand without the question
        const [next, now] = await Promise.all([
            askEngine({ kind: 'apply-research', build, base: block.base, choice: researchChoiceOf(entry) }),
            askEngine({ kind: 'research-differences', build: { ...build, research: block } }),
        ]);
        const changed = now.recorded ? now.edited : [];
        if (changed.length === 0) onApply(withResearch(form, next.build, next.block, []), RESEARCH_LINE.undo(entry.name));
        else setAsking({ name: entry.name, next, edited: changed });
    };
    const answer = (keepMine: boolean) => {
        if (!asking) return;
        onApply(withResearch(form, asking.next.build, asking.next.block, keepMine ? asking.edited : []), RESEARCH_LINE.undo(asking.name));
        setAsking(null);
    };
    const profileValue = (edit: ResearchEdit) => {
        const rows = asking!.next.build;
        if (edit.kind === 'machine') return rows.machines.find(row => row.id === edit.id)?.productivity;
        if (edit.kind === 'drill') return rows.drills?.configs.find(row => row.id === edit.id)?.productivity;
        if (edit.kind === 'inserter') return rows.inserters.find(row => row.id === edit.id)?.stack_size;
        if (edit.kind === 'lane') return rows.belts.find(row => row.id === edit.id)?.lanes[(edit.lane ?? 1) - 1]?.stack_size;
        const silo = rows.chests?.find(row => row.id === edit.id);
        return silo?.type === 'rocket-silo' ? silo.productivity : undefined;
    };

    return <Box data-research-line="" sx={{ mb: 2, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
            <Box sx={{ minWidth: 220 }}>
                <ResearchProfileSelect entries={entries} value={stored?.id ?? ''} onChange={id => { void choose(id); }} label={RESEARCH_LINE.label} />
            </Box>
            {!stored && <Typography variant="body2">{RESEARCH_LINE.notStored(block.profile)}</Typography>}
            <Typography variant="body2" color="text.secondary">{RESEARCH_LINE.numbersUsed} {numbersUsedText(block.bonuses)}</Typography>
        </Box>
        {edited.length > 0 && <Typography variant="body2" data-research-edited="">
            {RESEARCH_LINE.edited(edited.length)} {edited.map(edit => editText(edit, edit.actual)).join(', ')}
        </Typography>}
        {outside.length > 0 && <Typography variant="body2" data-research-outside="">
            {RESEARCH_LINE.outside} {outside.map(outsideText).join(', ')} {RESEARCH_LINE.outsideNote}
        </Typography>}
        <AppDialog open={asking !== null} onClose={() => setAsking(null)} title={RESEARCH_LINE.questionTitle} cancel={RESEARCH_LINE.cancel}
            actions={<>
                <Button onClick={() => answer(true)} color="inherit" variant="outlined">{RESEARCH_LINE.keepMine}</Button>
                <Button onClick={() => answer(false)} color="secondary" variant="contained">{RESEARCH_LINE.useProfile}</Button>
            </>}>
            {asking && <>
                <Typography variant="body2" sx={{ mb: 1 }}>{RESEARCH_LINE.question(asking.edited.length, asking.name)}</Typography>
                <Box component="ul" sx={{ pl: 2.5, my: 0 }}>
                    {asking.edited.map(edit => <li key={`${edit.kind}-${edit.id}-${edit.lane ?? ''}`}>
                        <Typography variant="body2">{editText(edit, profileValue(edit) ?? edit.expected)} {yoursText(edit)}</Typography>
                    </li>)}
                </Box>
            </>}
        </AppDialog>
    </Box>;
}
