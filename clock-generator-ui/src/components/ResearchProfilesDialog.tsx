import { Close } from '@mui/icons-material';
import { Alert, Box, Button, FormControl, FormControlLabel, FormHelperText, FormLabel, IconButton, Radio, RadioGroup, TextField, Typography } from '@mui/material';
import { useEffect, useState, type ReactNode } from 'react';
import { useGameNames } from '../hooks/useGameNames';
import type { StorageLike } from '../utils/buildLibrary';
import {
    PROFILES_KEY,
    TEMPLATES,
    checkBonuses,
    cloneBonuses,
    inserterHand,
    laneStack,
    openProfileStore,
    templateOf,
    type BonusProblem,
    type Bonuses,
    type Outcome,
    type Refusal,
    type TemplateId,
} from '../utils/researchProfiles';
import { AppDialog } from './AppDialog';
import { FactorioIcon } from './FactorioIcon';
import { ItemSelector } from './ItemSelector';
import { NumberField } from './NumberField';
import { ResearchProfileSelect } from './ResearchProfileSelect';

/** The page's localStorage, reached only inside the calls: in some browsers merely reading `localStorage` throws */
const pageStorage: StorageLike = {
    getItem: key => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: key => window.localStorage.removeItem(key),
    key: i => window.localStorage.key(i),
    get length() {
        return window.localStorage.length;
    },
};

const REFUSALS: Record<Refusal, string> = {
    'empty-name': 'Type a name.',
    'name-in-use': 'A profile with that name exists.',
    'template-name': 'That is the name of a template.',
    'read-only': 'A template cannot be changed.',
    'no-template': 'This profile has no template to revert to.',
    'not-found': 'This profile is gone. Choose another.',
};

/** The game's names on its Bonuses screen */
const LABELS = {
    mining: 'Mining productivity',
    inserter: 'Inserter capacity',
    bulk: 'Bulk inserter capacity',
    belt: 'Belt stack size bonus',
} as const;

type NumberKey = 'mining_drill_productivity_bonus' | 'inserter_stack_size_bonus' | 'bulk_inserter_capacity_bonus' | 'belt_stack_size_bonus';

const WHOLE = 'must be a whole number, 0 or more';
const RULES: Record<BonusProblem['field'], string> = {
    mining_drill_productivity_bonus: 'must be a number, 0 or more',
    inserter_stack_size_bonus: WHOLE,
    bulk_inserter_capacity_bonus: 'must be a whole number from 0 to 254',
    belt_stack_size_bonus: WHOLE,
    recipes: 'must be a number, 0 or more',
};

function sameRecipes(a: Bonuses, b: Bonuses): boolean {
    const recipes = Object.keys(a.recipes);
    return recipes.length === Object.keys(b.recipes).length
        && recipes.every(recipe => b.recipes[recipe]?.productivity_bonus === a.recipes[recipe].productivity_bonus);
}

function sameBonuses(a: Bonuses, b: Bonuses): boolean {
    return a.mining_drill_productivity_bonus === b.mining_drill_productivity_bonus
        && a.inserter_stack_size_bonus === b.inserter_stack_size_bonus
        && a.bulk_inserter_capacity_bonus === b.bulk_inserter_capacity_bonus
        && a.belt_stack_size_bonus === b.belt_stack_size_bonus
        && sameRecipes(a, b);
}

interface ResearchProfilesDialogProps {
    open: boolean;
    onClose: () => void;
    /** The recipe ids the picker offers for a recipe's productivity */
    recipeOptions: string[];
    /** Where the profiles are kept; this page's localStorage by default */
    storage?: StorageLike;
    /** Makes the id of a new profile */
    newId?: () => string;
}

/** The research profiles: a list to choose from, the actions on it, and the numbers of the one chosen */
export function ResearchProfilesDialog({ open, onClose, recipeOptions, storage, newId }: ResearchProfilesDialogProps) {
    return <AppDialog open={open} onClose={onClose} title="Research profiles" maxWidth="md" cancel="Close"
        description="The research numbers of your game, kept in this browser under a name.">
        <ProfilesPanel recipeOptions={recipeOptions} storage={storage ?? pageStorage} newId={newId} />
    </AppDialog>;
}

type Action = 'new' | 'rename' | 'remove' | 'revert' | null;

function ProfilesPanel({ recipeOptions, storage, newId }: { recipeOptions: string[]; storage: StorageLike; newId?: () => string }) {
    const { recipeLabel } = useGameNames();
    const [store] = useState(() => openProfileStore(storage, newId));
    // the store changes in place: a counter makes the panel read it again
    const [, setReads] = useState(0);
    const refresh = () => setReads(reads => reads + 1);
    const [chosen, setChosen] = useState(() => store.snapshot().lastUsed ?? TEMPLATES[0].id);
    const [action, setAction] = useState<Action>(null);
    const [draftName, setDraftName] = useState('');
    const [draftTemplate, setDraftTemplate] = useState<TemplateId>('all-finite-research');
    const [refusal, setRefusal] = useState<string | null>(null);
    const [problems, setProblems] = useState<Record<string, string>>({});
    const [adding, setAdding] = useState(false);

    // another tab wrote or cleared the profiles
    useEffect(() => {
        const read = (event: StorageEvent) => {
            if (event.key !== null && event.key !== PROFILES_KEY) return;
            store.reload();
            refresh();
        };
        window.addEventListener('storage', read);
        return () => window.removeEventListener('storage', read);
    }, [store]);

    const entries = store.entries();
    const entry = store.find(chosen) ?? entries[0];
    const template = entry.template === null ? undefined : templateOf(entry.template);
    // the template whose numbers the rows show: the chosen one, or the one the chosen profile was made from
    const shown = entry.isTemplate ? templateOf(entry.id) : template;
    const readOnly = entry.isTemplate;

    const choose = (id: string) => {
        store.select(id);
        setChosen(id);
        setProblems({});
        setAdding(false);
        refresh();
    };
    const finish = (outcome: Outcome, then?: (id: string) => void): boolean => {
        refresh();
        if (!outcome.ok) {
            setRefusal(outcome.reason === 'invalid' ? 'Check the numbers.' : REFUSALS[outcome.reason]);
            return false;
        }
        setRefusal(null);
        then?.(outcome.profile.id);
        return true;
    };
    const closeAction = () => {
        setAction(null);
        setRefusal(null);
    };
    const start = (next: Exclude<Action, null>) => {
        setDraftName(next === 'rename' ? entry.name : '');
        setDraftTemplate(entry.isTemplate ? templateOf(entry.id)!.id : entry.template ?? 'all-finite-research');
        setRefusal(null);
        setAction(next);
    };

    const change = (key: string, next: Bonuses, name: string) => {
        const problem = checkBonuses(next);
        if (problem) {
            setProblems(shown => ({ ...shown, [key]: `${name} ${RULES[problem.field]}.` }));
            return;
        }
        setProblems(shown => Object.fromEntries(Object.entries(shown).filter(([shownKey]) => shownKey !== key)));
        store.setBonuses(entry.id, next);
        refresh();
    };
    const setNumber = (field: NumberKey, label: string) => (value: number | null) => {
        if (value === null) return;
        change(field, { ...cloneBonuses(entry.bonuses), [field]: value }, label);
    };
    const setRecipe = (recipe: string, value: number | null) => {
        if (value === null) return;
        const next = cloneBonuses(entry.bonuses);
        next.recipes[recipe] = { productivity_bonus: value };
        change(`recipe:${recipe}`, next, recipeLabel(recipe));
    };
    const addRecipe = (recipe: string | null) => {
        setAdding(false);
        if (recipe === null || recipe in entry.bonuses.recipes) return;
        const next = cloneBonuses(entry.bonuses);
        next.recipes[recipe] = { productivity_bonus: 0 };
        store.setBonuses(entry.id, next);
        refresh();
    };
    const removeRecipe = (recipe: string) => {
        const next = cloneBonuses(entry.bonuses);
        delete next.recipes[recipe];
        store.setBonuses(entry.id, next);
        refresh();
    };

    const bonuses = entry.bonuses;
    const recipes = Object.keys(bonuses.recipes);
    const atTemplate = template !== undefined && sameBonuses(bonuses, template.bonuses);
    const markYours = {
        mining: shown?.setYours.mining === true && bonuses.mining_drill_productivity_bonus === shown.bonuses.mining_drill_productivity_bonus,
        recipes: shown?.setYours.recipes === true && sameRecipes(bonuses, shown.bonuses),
    };
    const yours = (<Typography component="span" variant="caption" color="text.secondary" sx={{ ml: 1 }}>Set yours</Typography>);

    return <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        {!store.saved && <Alert severity="warning">These profiles are not saved. The browser blocks the storage of this page, or a newer version of the page wrote it. They last until the page closes.</Alert>}
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
            <Box sx={{ flex: '1 1 240px', minWidth: 0 }}>
                <ResearchProfileSelect entries={entries} value={entry.id} onChange={choose} />
            </Box>
            <Button onClick={() => start('new')}>New</Button>
            <Button onClick={() => start('rename')} disabled={readOnly}>Rename</Button>
            <Button onClick={() => finish(store.copy(entry.id), choose)} disabled={readOnly}>Copy</Button>
            <Button onClick={() => start('remove')} disabled={readOnly} color="error">Remove</Button>
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography variant="body2" color="text.secondary">
                {readOnly ? 'A template. Its numbers cannot be changed.'
                    : template ? `Started from the template: ${template.name}` : 'Not started from a template.'}
            </Typography>
            {readOnly
                ? <Button onClick={() => start('new')}>New profile from this template</Button>
                : null}
            <Button onClick={() => start('revert')} disabled={readOnly || template === undefined || atTemplate}>Revert to template</Button>
        </Box>

        <Box key={entry.id} sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 18rem) auto', justifyContent: 'start', columnGap: 1.5, rowGap: 1.5, alignItems: 'start' }}>
            <ForceRow icon="electric-mining-drill" label={LABELS.mining} note={markYours.mining ? yours : null}>
                <NumberField inputAriaLabel={LABELS.mining} value={bonuses.mining_drill_productivity_bonus} readOnly={readOnly} min={0} step={1} size="small" displayDecimals={4}
                    onValueCommitted={setNumber('mining_drill_productivity_bonus', LABELS.mining)} problem={problems.mining_drill_productivity_bonus} sx={{ width: 140 }} />
                <Unit>%</Unit>
            </ForceRow>
            <ForceRow icon="inserter" label={LABELS.inserter} note={<Gives>{`gives an inserter ${inserterHand('inserter', bonuses)}`}</Gives>}>
                <NumberField inputAriaLabel={LABELS.inserter} value={bonuses.inserter_stack_size_bonus} readOnly={readOnly} min={0} step={1} size="small"
                    onValueCommitted={setNumber('inserter_stack_size_bonus', LABELS.inserter)} problem={problems.inserter_stack_size_bonus} sx={{ width: 140 }} />
            </ForceRow>
            <ForceRow icon="bulk-inserter" label={LABELS.bulk}
                note={<Gives>{`gives a bulk inserter ${inserterHand('bulk-inserter', bonuses)}, a stack inserter ${inserterHand('stack-inserter', bonuses)}`}</Gives>}>
                <NumberField inputAriaLabel={LABELS.bulk} value={bonuses.bulk_inserter_capacity_bonus} readOnly={readOnly} min={0} max={254} step={1} size="small"
                    onValueCommitted={setNumber('bulk_inserter_capacity_bonus', LABELS.bulk)} problem={problems.bulk_inserter_capacity_bonus} sx={{ width: 140 }} />
            </ForceRow>
            <ForceRow icon="transport-belt" label={LABELS.belt} note={<Gives>{`gives stacks of ${laneStack(bonuses)}`}</Gives>}>
                <NumberField inputAriaLabel={LABELS.belt} value={bonuses.belt_stack_size_bonus} readOnly={readOnly} min={0} step={1} size="small"
                    onValueCommitted={setNumber('belt_stack_size_bonus', LABELS.belt)} problem={problems.belt_stack_size_bonus} sx={{ width: 140 }} />
            </ForceRow>
        </Box>

        <Box component="section" aria-labelledby="research-profile-recipes" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography id="research-profile-recipes" variant="subtitle2" component="h3">
                Recipe productivity{markYours.recipes && yours}
            </Typography>
            {recipes.map(recipe => <Box key={recipe} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flex: '0 1 18rem', width: '18rem', minWidth: 0 }}>
                    <FactorioIcon name={recipe} size={24} alt="" />
                    <Typography variant="body2" noWrap>{recipeLabel(recipe)}</Typography>
                </Box>
                <NumberField inputAriaLabel={recipeLabel(recipe)} value={bonuses.recipes[recipe].productivity_bonus} readOnly={readOnly} min={0} step={1} size="small"
                    displayDecimals={4} onValueCommitted={value => setRecipe(recipe, value)} problem={problems[`recipe:${recipe}`]} sx={{ width: 140 }} />
                <Unit>%</Unit>
                {!readOnly && <IconButton size="small" aria-label={`Remove ${recipeLabel(recipe)}`} onClick={() => removeRecipe(recipe)}><Close fontSize="small" /></IconButton>}
            </Box>)}
            {recipes.length === 0 && <Typography variant="body2" color="text.secondary">No recipe has research productivity.</Typography>}
            {!readOnly && (adding
                ? <ItemSelector kind="recipe" label="Recipe to add" value={null} options={recipeOptions.filter(recipe => !(recipe in bonuses.recipes))} onChange={addRecipe} />
                : <Box><Button onClick={() => setAdding(true)}>Add a recipe</Button></Box>)}
        </Box>

        {(action === 'new' || action === 'rename') && <AppDialog onClose={closeAction} maxWidth="xs" cancel="Cancel"
            title={action === 'new' ? 'New research profile' : 'Rename research profile'}
            onSubmit={() => {
                if (action === 'new') finish(store.create(draftName, draftTemplate), id => { closeAction(); choose(id); });
                else if (finish(store.rename(entry.id, draftName))) closeAction();
            }}
            actions={<Button type="submit" variant="contained">{action === 'new' ? 'Create' : 'Rename'}</Button>}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                <TextField label="Name" value={draftName} onChange={event => { setDraftName(event.target.value); setRefusal(null); }} autoFocus size="small" fullWidth
                    error={refusal !== null} helperText={refusal ?? undefined} />
                {action === 'new' && <FormControl>
                    <FormLabel id="research-profile-start">Start from</FormLabel>
                    <RadioGroup aria-labelledby="research-profile-start" value={draftTemplate} onChange={event => setDraftTemplate(event.target.value as TemplateId)}>
                        {TEMPLATES.map(choice => <FormControlLabel key={choice.id} value={choice.id} control={<Radio size="small" />} label={choice.name} />)}
                    </RadioGroup>
                    <FormHelperText>You can change every number after.</FormHelperText>
                </FormControl>}
            </Box>
        </AppDialog>}

        {action === 'remove' && <AppDialog onClose={closeAction} maxWidth="xs" title={`Remove "${entry.name}"?`} focusCancel cancel="Cancel"
            description="The profile is deleted from this browser. This cannot be undone."
            actions={<Button color="error" onClick={() => { finish(store.remove(entry.id), () => choose(TEMPLATES[0].id)); closeAction(); }}>Remove</Button>} />}

        {action === 'revert' && template && <AppDialog onClose={closeAction} maxWidth="xs" title={`Revert "${entry.name}" to "${template.name}"?`} focusCancel cancel="Cancel"
            description="Every number goes back to the template's. A recipe you added is removed."
            actions={<Button color="error" onClick={() => { finish(store.revert(entry.id)); closeAction(); }}>Revert</Button>} />}
    </Box>;
}

function ForceRow({ icon, label, note, children }: { icon: string; label: string; note: ReactNode; children: ReactNode }) {
    return <>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1, minWidth: 0 }}>
            <Box sx={{ pt: 0.5 }}><FactorioIcon name={icon} size={24} alt="" /></Box>
            <Box sx={{ minWidth: 0 }}>
                <Typography variant="body2" sx={{ pt: 0.75 }}>{label}</Typography>
                {note}
            </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>{children}</Box>
    </>;
}

const Unit = ({ children }: { children: ReactNode }) => <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }} aria-hidden>{children}</Typography>;
const Gives = ({ children }: { children: ReactNode }) => <Typography variant="caption" color="text.secondary" component="p">{children}</Typography>;
