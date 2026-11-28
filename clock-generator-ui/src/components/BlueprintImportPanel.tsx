import { useState } from 'react';
import { Alert, Box, Checkbox, Chip, FormControl, IconButton, FormControlLabel, FormLabel, Radio, RadioGroup, Typography } from '@mui/material';
import type { ImportEntity, ImportNote, ImportQuestion, ImportSpeed } from 'clock-generator/browser';
import { useGameNames } from '../hooks/useGameNames';
import {
    ANOTHER_ITEM, ANSWERED, entityName, FOUND_IN_BLUEPRINT, GROUPED_NOTE, noteText, NOTES_HEADING, notReadText, numbersUsedText, PLEASE_CHECK, productivityText, questionText,
    readText, SHARING_ANSWER_TEXT, speedText,
} from '../utils/blueprintPaste';
import { entityLabel } from '../utils/entityLabel';
import type { LaneEditor } from '../utils/layoutLanes';
import { questionLanes, questionLayoutFeed } from '../utils/questionLayoutFeed';
import type { TargetValues } from '../utils/pasteTarget';
import type { PastedBlueprint } from '../worker/types';
import { FactorioIcon } from './FactorioIcon';
import { ItemSelector } from './ItemSelector';
import { LayoutView } from './LayoutView';
import { NumberField } from './NumberField';
import { ResearchProfileSelect } from './ResearchProfileSelect';

/** A value of a machine the user typed over in the dialog, by the machine's entity number in the blueprint */
export type MachineOverrides = Readonly<Record<number, { crafting_speed?: number; productivity?: number }>>;

interface ProfileChoice {
    id: string;
    name: string;
    isTemplate: boolean;
}

interface BlueprintImportPanelProps {
    pasted: PastedBlueprint;
    profiles: readonly ProfileChoice[];
    profileId: string;
    onProfileChange: (id: string) => void;
    answers: Readonly<Record<string, string>>;
    onAnswer: (key: string, value: string) => void;
    itemNames: readonly string[];
}

const entitiesOf = (pasted: PastedBlueprint) => new Map(pasted.entities.map(entity => [entity.entity_number, entity]));

/** What the layout has selected: a belt or a drill, by the number its question calls it by */
type Selected = { kind: 'belt' | 'drill'; id: number };

const kindOfSelection = (question: ImportQuestion): Selected['kind'] => question.kind === 'drill-ore' ? 'drill' : 'belt';
const QUESTION_ORDER: readonly ImportQuestion['kind'][] = ['drill-ore', 'lane-item', 'lane-sharing'];

/**
 * The top of the confirm dialog of a pasted blueprint: the research profile and the numbers it gives, what the blueprint
 * holds that is read and what is not, the layout of the build once a question has been asked, and a row for each open
 * question. A lane question that is answered keeps its row, marked, while the panel is shown. The rows under it (the
 * setpoint, each category with its machine values, and the notes) are the dialog's own, in the order of the dialog.
 */
export function BlueprintImportPanel({ pasted, profiles, profileId, onProfileChange, answers, onAnswer, itemNames }: BlueprintImportPanelProps) {
    const { itemLabel } = useGameNames();
    const entityOf = entitiesOf(pasted);
    const notReadNames = new Set(pasted.notes.filter(note => note.code === GROUPED_NOTE).map(note => entityOf.get(note.entity_number)?.name).filter(name => name !== undefined));
    const notRead = notReadText(pasted.ignored, itemLabel);

    // every question asked while the panel is shown: the import drops an answered one, and its row and its candidates stay
    const [seen, setSeen] = useState<ReadonlyMap<string, ImportQuestion>>(new Map());
    const shown = pasted.questions.every(question => seen.get(question.key) === question) ? seen : new Map([...seen, ...pasted.questions.map(question => [question.key, question] as const)]);
    if (shown !== seen) setSeen(shown);
    const asked = new Set(pasted.questions.map(question => question.key));
    const rows = [...shown.values()].filter(question => asked.has(question.key) || (question.kind === 'lane-item' && answers[question.key] !== undefined))
        .sort((a, b) => QUESTION_ORDER.indexOf(a.kind) - QUESTION_ORDER.indexOf(b.kind) || a.subject.entity_number - b.subject.entity_number || (a.subject.lane ?? 0) - (b.subject.lane ?? 0));

    // the selection is the layout's; a row marks the belt or drill it is about, and the lane for a lane question
    const [selection, setSelection] = useState<Selected | null>(null);
    const [lane, setLane] = useState<number | null>(null);
    const placeOf = (question: ImportQuestion) => question.kind === 'drill-ore'
        ? pasted.layout.drills.find(drill => drill.entity_number === question.subject.entity_number)?.place
        : pasted.layout.lines.find(line => line.first === question.subject.entity_number)?.place;
    const select = (question: ImportQuestion) => {
        const id = placeOf(question);
        if (id === undefined) return;
        setSelection({ kind: kindOfSelection(question), id });
        setLane(question.kind === 'lane-item' ? question.subject.lane ?? null : null);
    };
    const marked = (question: ImportQuestion) => selection !== null && selection.kind === kindOfSelection(question) && placeOf(question) === selection.id
        && (lane === null || question.kind !== 'lane-item' || question.subject.lane === lane);

    const feed = questionLayoutFeed(pasted);
    const lanes = questionLanes(pasted, shown, answers);
    const laneEditor: LaneEditor = {
        belts: lanes.belts, itemNames, markedLane: selection?.kind === 'belt' ? lane : null,
        onEdit: (beltId, laneId, item) => { const target = lanes.keyOf(beltId, laneId); if (target !== null) onAnswer(target.key, item); },
    };

    return <Box data-blueprint-import="" sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mb: 1 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
            <Box sx={{ minWidth: 220 }}><ResearchProfileSelect entries={profiles} value={profileId} onChange={onProfileChange} label="Research profile" /></Box>
            <Typography variant="body2" color="text.secondary">Numbers used: {numbersUsedText(pasted.research.bonuses)}</Typography>
        </Box>
        <Typography variant="body2">
            {readText(pasted.read)}{notRead && ` ${notRead}`}
            {notReadNames.size > 0 && ` The site has no data for ${[...notReadNames].map(name => itemLabel(name)).join(', ')}.`}
        </Typography>

        {shown.size > 0 && <LayoutView machines={feed.machines} inserters={feed.inserters} belts={feed.belts} chests={feed.chests} drills={feed.drills} orbits={null}
            selection={selection} onSelectionChange={next => { setSelection(next === null ? null : next.kind === 'belt' || next.kind === 'drill' ? { kind: next.kind, id: next.id } : null); setLane(null); }}
            height={400} laneEditor={laneEditor} />}
        {rows.length > 0 && <Box role="group" aria-label="Questions" sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {rows.map(question => <QuestionRow key={question.key} question={question} entity={entityOf.get(question.subject.entity_number)}
                answer={answers[question.key]} onAnswer={value => onAnswer(question.key, value)} itemNames={itemNames}
                marked={marked(question)} answered={question.kind === 'lane-item' && answers[question.key] !== undefined} onSelect={() => select(question)} />)}
        </Box>}
    </Box>;
}

interface BlueprintSetpointRowProps {
    setpoint: TargetValues;
    onSetpointChange: (setpoint: TargetValues) => void;
    itemNames: readonly string[];
    checked: boolean;
    onToggle: () => void;
    /** The ids of the lines under the row that say where the setpoint comes from */
    describedBy?: string;
}

/** The one setpoint row of the confirm dialog of a pasted blueprint: its checkbox and the item, rate and copies it would write, which can be typed over */
export function BlueprintSetpointRow({ setpoint, onSetpointChange, itemNames, checked, onToggle, describedBy }: BlueprintSetpointRowProps) {
    return <Box role="group" aria-label="Setpoint" sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
        <FormControlLabel control={<Checkbox checked={checked && setpoint.item !== ''} onChange={onToggle} disabled={setpoint.item === ''}
            slotProps={{ input: { 'aria-describedby': describedBy } }} />} label="Setpoint" sx={{ mr: 0 }} />
        <ItemSelector label="Setpoint item" value={setpoint.item === '' ? null : setpoint.item} options={[...itemNames]} size="small" minWidth={200}
            onChange={item => onSetpointChange({ ...setpoint, item: item ?? '' })} />
        <NumberField label="Items per second" size="small" min={0} sx={{ width: 120 }}
            value={typeof setpoint.items_per_second === 'number' ? setpoint.items_per_second : setpoint.items_per_second.numerator / setpoint.items_per_second.denominator}
            onValueCommitted={(value: number | null) => { if (value !== null && value > 0) onSetpointChange({ ...setpoint, items_per_second: value }); }} />
        <NumberField label="Copies" size="small" min={1} step={1} sx={{ width: 96 }} value={setpoint.copies}
            onValueCommitted={(value: number | null) => { if (value !== null && Number.isInteger(value) && value >= 1) onSetpointChange({ ...setpoint, copies: value }); }} />
    </Box>;
}

interface BlueprintMachineValuesProps {
    pasted: PastedBlueprint;
    /** The machines as they will be imported, with the values typed over */
    machines: PastedBlueprint['machines'];
    onOverride: (entity_number: number, field: 'crafting_speed' | 'productivity', value: number) => void;
}

/** Under the Machines row: each machine's speed and productivity with what they are made of, and the fields to type over them */
export function BlueprintMachineValues({ pasted, machines, onOverride }: BlueprintMachineValuesProps) {
    const numberOf = new Map(pasted.entities.flatMap(entity => entity.row ? [[`${entity.row.list}:${entity.row.id}`, entity.entity_number] as const] : []));
    const speedOf = new Map(pasted.speeds.map(row => [`${row.list}:${row.id}`, row]));
    if (machines.length === 0) return null;
    return <Box role="group" aria-label="Machine values" sx={{ display: 'flex', flexDirection: 'column', gap: 1, ml: 4, mt: 1 }}>
        {machines.map(machine => {
            const number = numberOf.get(`machines:${machine.id}`);
            const row: ImportSpeed | undefined = speedOf.get(`machines:${machine.id}`);
            const label = entityLabel('machine', machine.id);
            const check = pasted.notes.some(note => note.entity_number === number && note.please_check && note.code.startsWith('speeds'));
            return <Box key={machine.id} data-machine-values={machine.id} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center' }}>
                {machine.prototype && <FactorioIcon name={machine.prototype} size={20} />}
                <Typography variant="body2" sx={{ minWidth: 90 }}>{label}</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ flex: '1 1 320px' }}>
                    {speedText(machine.crafting_speed, row)}; {productivityText(machine.productivity, row)}
                    {check && <Chip size="small" label={PLEASE_CHECK} color="warning" variant="outlined" sx={{ ml: 1 }} />}
                </Typography>
                {number !== undefined && <>
                    <NumberField label="Speed" size="small" min={0} sx={{ width: 120 }} value={machine.crafting_speed} inputAriaLabel={`Speed, ${label}`}
                        onValueCommitted={(value: number | null) => { if (value !== null && value > 0) onOverride(number, 'crafting_speed', value); }} />
                    <NumberField label="Productivity %" size="small" min={0} sx={{ width: 140 }} value={machine.productivity} inputAriaLabel={`Productivity, ${label}`}
                        onValueCommitted={(value: number | null) => { if (value !== null && value >= 0) onOverride(number, 'productivity', value); }} />
                </>}
            </Box>;
        })}
    </Box>;
}

/** The last part of the confirm dialog of a pasted blueprint: the notes, each beside the entity it is about */
export function BlueprintNotes({ pasted }: { pasted: PastedBlueprint }) {
    const entityOf = entitiesOf(pasted);
    const notes = pasted.notes.filter(note => note.code !== GROUPED_NOTE);
    if (notes.length === 0) return null;
    return <Alert severity="info" icon={false} role="region" aria-label={NOTES_HEADING}>
        <Typography variant="subtitle2">{NOTES_HEADING}</Typography>
        <Box component="ul" sx={{ pl: 2.5, my: 0 }}>
            {notes.map(note => <NoteLine key={`${note.entity_number}|${note.code}|${note.lane ?? ''}|${note.field ?? ''}`} note={note} entity={entityOf.get(note.entity_number)} />)}
        </Box>
    </Alert>;
}

function NoteLine({ note, entity }: { note: ImportNote; entity: ImportEntity | undefined }) {
    const { itemLabel } = useGameNames();
    return <Box component="li" data-note={note.code} sx={{ mb: 0.25 }}>
        <Typography variant="body2" component="span">
            {entity && <Box component="span" sx={{ verticalAlign: 'middle', mr: 0.5, display: 'inline-flex' }}><FactorioIcon name={entity.name} size={18} /></Box>}
            {entityName(entity, itemLabel)}: {noteText(note)}
        </Typography>
        {note.please_check && <Chip size="small" label={PLEASE_CHECK} color="warning" variant="outlined" sx={{ ml: 1 }} />}
    </Box>;
}

function QuestionRow({ question, entity, answer, onAnswer, itemNames, marked, answered, onSelect }: {
    question: ImportQuestion; entity: ImportEntity | undefined; answer: string | undefined; onAnswer: (value: string) => void; itemNames: readonly string[];
    /** The row's belt or drill is selected on the layout (and, for a lane row, its lane) */
    marked: boolean; answered: boolean; onSelect: () => void;
}) {
    const { itemLabel } = useGameNames();
    const text = questionText(question);
    const icon = entity && <FactorioIcon name={entity.name} size={20} />;
    // the row's own element carries what links it to the layout: a focus or a pointer on it selects its belt
    const link = { 'data-question': question.key, 'data-marked': marked ? '' : undefined, 'data-answered': answered ? '' : undefined, onFocus: onSelect, onPointerEnter: onSelect };
    const markSx = { p: 0.5, borderRadius: 1, border: '2px solid', borderColor: marked ? 'secondary.main' : 'transparent' } as const;
    if (question.kind === 'lane-sharing') {
        return <FormControl {...link} sx={markSx}>
            <FormLabel sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>{icon}{text}</FormLabel>
            <RadioGroup row value={answer ?? ''} onChange={(_, value) => onAnswer(value)}>
                {(['shared', 'per_copy'] as const).map(value => <FormControlLabel key={value} value={value} control={<Radio size="small" />} label={SHARING_ANSWER_TEXT[value]} />)}
            </RadioGroup>
        </FormControl>;
    }
    return <Box {...link} sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, alignItems: 'center', ...markSx }}>
        {icon}
        <Typography variant="body2" sx={{ minWidth: 160 }}>{text}</Typography>
        <Box sx={{ display: 'flex', gap: 0.25 }}>
            {question.candidates.slice(0, 8).map(item => <IconButton key={item} size="small" aria-label={itemLabel(item)} aria-pressed={answer === item}
                onClick={() => onAnswer(item)} sx={answer === item ? { outline: '2px solid', outlineColor: 'secondary.main' } : undefined}>
                <FactorioIcon name={item} size={20} alt="" />
            </IconButton>)}
        </Box>
        {/* the question is said once, on the row; the field's own name still says whose it is */}
        <ItemSelector label={ANOTHER_ITEM} inputAriaLabel={text} value={answer ?? null} size="small" minWidth={220}
            priority={{ label: FOUND_IN_BLUEPRINT, ids: question.candidates }} options={[...new Set([...question.candidates, ...itemNames])]}
            onChange={value => { if (value !== null) onAnswer(value); }} />
        {answered && <Typography variant="caption" color="text.secondary">{ANSWERED}</Typography>}
    </Box>;
}
