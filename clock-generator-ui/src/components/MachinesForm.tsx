import { EntityBadge } from './EntityBadge';
import { EntitySettings } from './EntitySettings';
import {
    Box,
    Button,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Typography,
} from '@mui/material';
import { memo, useMemo, useState } from 'react';
import type { Config, MachineTargetRate, OutputTransferGenerationIssue, OutputTransferSummary } from 'clock-generator/browser';
import type { BeltFormData, ChestFormData, DrillFormData, InserterFormData, MachineFormData } from '../hooks/useConfigForm';
import type { RecipeInfo } from '../hooks/useSimulationWorker';
import { useMachineFacts } from '../hooks/useMachineFacts';
import { useMachineTargetRates } from '../hooks/useMachineTargetRates';
import { useEntityRows } from '../hooks/useEntityRows';
import { MachineSettingsFields } from './EntityFields';
import { MachineIcon } from './MachineIcon';
import { MachineIconPicker, RecipeNotMadeNote } from './MachineFields';
import { useCraftingMachines, useMachineRecipeOptions } from '../hooks/useCraftingMachines';
import { burnsNutrients, machineIconText, placesResults, recipePatch } from '../utils/machinePrototype';
import type { ResultTargetBuild } from '../utils/resultTarget';
import { ResultTargetField } from './ResultTargetField';
import { HelpCommand } from './HelpButton';
import { PanelSection } from './Panel';
import { ItemSelector } from './ItemSelector';
import { MachineFactsAccordion } from './MachineFactsAccordion';
import { MachineProductionSummary } from './MachineProductionSummary';
import { OutputTransferPanel } from './OutputTransferPanel';
import { InputRoutesPanel } from './InputRoutesPanel';
import { SidecarModLink } from './IntroCard';
import { SortableList } from './SortableList';
import { AddButton } from './AddRow';
import { EntityRow, EntityRowActions, EntityRowTop } from './EntityRow';
import { useGameNames } from '../hooks/useGameNames';
import { nameWithId } from '../utils/gameNames';
import { entityLabel, settingsSlotId } from '../utils/entityLabel';
import { ELEMENT_IDS, machineRecipeElementId } from '../utils/firstProblem';
import { BUTTON_NAMES, changeMachineName, recipeName } from '../utils/a11yLabels';

interface MachinesFormProps {
    engineConfig: Config;
    machines: MachineFormData[];
    /** The build's other entities: a machine that places its results itself puts them into one of its containers */
    belts: BeltFormData[];
    chests: ChestFormData[];
    inserters: InserterFormData[];
    drills: readonly DrillFormData[];
    getRecipeInfo?: (name: string) => RecipeInfo | null;
    recipeNames: string[];
    onAdd: () => void;
    onUpdate: (index: number, field: keyof MachineFormData, value: string | number) => void;
    onPatch: (index: number, patch: Partial<MachineFormData>) => void;
    onRemove: (index: number) => void;
    onReorder: (fromIndex: number, toIndex: number) => void;
    onDuplicate: (index: number) => void;
    outputTransfers?: readonly OutputTransferSummary[] | null;
    outputGenerationIssues?: OutputTransferGenerationIssue[];
    outputTransfersLoading?: boolean;
    onFixOutput?: (machineId: number, item: string) => void;
    onEditInserter?: (id: number) => void;
}

const CRAFTING_SPEED_COMMAND = '/c game.print(game.player.selected.crafting_speed)';

function MachinesFormComponent({
    engineConfig,
    machines,
    belts,
    chests,
    inserters,
    drills,
    getRecipeInfo,
    recipeNames,
    onAdd,
    onUpdate,
    onPatch,
    onRemove,
    onReorder,
    onDuplicate,
    outputTransfers = null,
    outputGenerationIssues = [],
    outputTransfersLoading = false,
    onFixOutput,
    onEditInserter,
}: MachinesFormProps) {
    const craftingMachines = useCraftingMachines();
    const [rateView, setRateView] = useState<'max' | 'target'>('max');
    const targetRates = useMachineTargetRates(engineConfig, rateView === 'target');
    const build = useMemo(() => ({ machines, belts, chests, inserters, drills }), [machines, belts, chests, inserters, drills]);
    const common = machines.length === 0 ? [] : [
        machines.every(row => row.productivity === machines[0].productivity) ? `productivity ${machines[0].productivity}%` : null,
        machines.every(row => row.crafting_speed === machines[0].crafting_speed) ? `speed ${machines[0].crafting_speed}×` : null,
        machines.every(row => burnsNutrients(row, craftingMachines) && (row.energy_consumption_bonus ?? 0) === (machines[0].energy_consumption_bonus ?? 0)) ? `energy consumption ${machines[0].energy_consumption_bonus ?? 0}%` : null,
    ].filter(Boolean);
    // the row's delete button goes with it: the keyboard moves on to a neighbour's
    const { cardRef, add: addRow, duplicate, remove } = useEntityRows(machines, { labelOf: machine => entityLabel('machine', machine.id), onRemove, onDuplicate });

    return (
        <PanelSection
            ref={cardRef}
            level={3}
            title={`Machines (${machines.length})`}
            help={{
                label: BUTTON_NAMES.aboutMachines,
                content: (
                    <>
                        <Typography variant="body2" sx={{ mb: 1 }}>
                            Rates are per machine, per copy. Max shows the machine's capacity; At target shows its share
                            of the requested output. Open Entity details to edit a machine's speed and productivity or inspect its routes.
                        </Typography>
                        {common.length > 0 && <Typography variant="body2" sx={{ mb: 1 }}>
                            All {machines.length} machines: {common.join(' · ')}. Each machine's values remain editable.
                        </Typography>}
                        <Typography variant="body2" sx={{ mb: 1 }}>
                            The <SidecarModLink /> copies the crafting speeds of your build: then click Paste from
                            Factorio.
                        </Typography>
                        <Typography variant="body2" sx={{ mb: 1 }}>
                            Without it, hover over a machine in Factorio and run this command. A /c command turns off
                            achievements for that save.
                        </Typography>
                        <HelpCommand command={CRAFTING_SPEED_COMMAND} />
                    </>
                ),
            }}
            actions={(
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" color="text.secondary">Per machine · per copy</Typography>
                <ToggleButtonGroup value={rateView} exclusive size="small" color="standard" aria-label="Machine rate view"
                    onChange={(_, value: 'max' | 'target' | null) => { if (value) setRateView(value); }}>
                    <ToggleButton value="max" sx={{ px: 1, py: 0.5 }}>Max</ToggleButton>
                    <ToggleButton value="target" sx={{ px: 1, py: 0.5 }}>At target</ToggleButton>
                </ToggleButtonGroup>
                <AddButton id={ELEMENT_IDS.addMachine} label="Add Machine" onClick={() => addRow(onAdd)} />
                </Box>
            )}
        >
            {rateView === 'target' && targetRates.error && <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                At-target rates unavailable: {targetRates.error}
            </Typography>}
            <SortableList itemKeys={machines.map((m) => m._uuid)} onReorder={onReorder}>
                {machines.map((machine, index) => <MachineRow
                    key={machine._uuid}
                    machine={machine}
                    index={index}
                    count={machines.length}
                    recipeNames={recipeNames}
                    build={build}
                    getRecipeInfo={getRecipeInfo}
                    atTarget={rateView === 'target'}
                    targetRate={targetRates.rates?.find(rate => rate.machine_id === machine.id)}
                    targetUpdating={targetRates.updating}
                    outputTransfer={outputTransfers?.find(transfer => transfer.source.type === 'machine' && transfer.source.id === machine.id) ?? null}
                    outputGenerationIssues={outputGenerationIssues.filter(issue => issue.machine_id === machine.id)}
                    outputTransfersLoading={outputTransfersLoading}
                    allOutputTransfers={outputTransfers}
                    onFixOutput={onFixOutput}
                    onEditInserter={onEditInserter}
                    onUpdate={onUpdate}
                    onPatch={onPatch}
                    onRemove={remove}
                    onDuplicate={duplicate}
                    onReorder={onReorder}
                />)}
            </SortableList>
        </PanelSection>
    );
}

interface MachineRowProps {
    atTarget: boolean;
    targetRate?: MachineTargetRate;
    targetUpdating: boolean;
    outputTransfer: OutputTransferSummary | null;
    outputGenerationIssues: OutputTransferGenerationIssue[];
    outputTransfersLoading: boolean;
    allOutputTransfers: readonly OutputTransferSummary[] | null;
    onFixOutput?: (machineId: number, item: string) => void;
    onEditInserter?: (id: number) => void;
    machine: MachineFormData;
    index: number;
    recipeNames: string[];
    build: ResultTargetBuild;
    getRecipeInfo?: (name: string) => RecipeInfo | null;
    count: number;
    onDuplicate: (index: number) => void;
    onReorder: (fromIndex: number, toIndex: number) => void;
    onUpdate: (index: number, field: keyof MachineFormData, value: string | number) => void;
    onPatch: (index: number, patch: Partial<MachineFormData>) => void;
    onRemove: (index: number) => void;
}

function MachineRow({ machine, index, recipeNames, build, getRecipeInfo, atTarget, targetRate, targetUpdating, outputTransfer, outputGenerationIssues, outputTransfersLoading, allOutputTransfers, onFixOutput, onEditInserter, count, onUpdate, onPatch, onRemove, onDuplicate, onReorder }: MachineRowProps) {
    const { itemLabel, recipeLabel } = useGameNames();
    const craftingMachines = useCraftingMachines();
    const recipes = useMachineRecipeOptions(machine.prototype, recipeNames);
    const { facts, error, updating } = useMachineFacts({
        recipe: machine.recipe,
        productivity: machine.productivity,
        crafting_speed: machine.crafting_speed,
        prototype: machine.prototype,
        energy_consumption_bonus: machine.energy_consumption_bonus,
        fuel: machine.fuel,
    });
    const inputs = [...new Set(!updating && facts ? facts.inputs.map(input => input.item_name)
        : [...(getRecipeInfo?.(machine.recipe)?.ingredients ?? []), ...(machine.fuel ? [machine.fuel] : [])])];
    const missingOutputs = outputTransfer?.results.filter(result => result.coverage === 'missing').length ?? 0;

    const label = entityLabel('machine', machine.id);

    return <EntityRow kind="machine" row={machine} label={label} chipTitle={`${machineIconText(machine, itemLabel)}. Click to change the machine.`}
        chip={<MachineIconPicker machine={machine} onPatch={patch => onPatch(index, patch)} buttonName={changeMachineName(label)} rowName={label}>
            <EntityBadge id={machine.id}><MachineIcon machine={machine} size={28} /></EntityBadge>
        </MachineIconPicker>}>
        {dragHandle => <>
            {/* the recipe stays in line: it shrinks to its picture instead */}
            <EntityRowTop dragHandle={dragHandle} actions={<EntityRowActions kind="machine" id={machine.id} label={label}
                index={index} count={count} onReorder={onReorder} onDuplicate={onDuplicate} onDelete={onRemove} canDelete={count > 1} />}>
                <Tooltip title={machine.recipe ? nameWithId(recipeLabel(machine.recipe), machine.recipe) : ''} describeChild>
                    <Box data-row-first="" sx={{ minWidth: 0, containerType: 'inline-size', containerName: 'machine-recipe' }}>
                        <ItemSelector
                            kind="recipe"
                            inputId={machineRecipeElementId(machine.id)}
                            sx={{
                                width: '100%',
                                minWidth: 0,
                                '@container machine-recipe (max-width: 160px)': {
                                    '&:has(img):not(:focus-within) .MuiInputBase-input': { color: 'transparent' },
                                    '&:has(img):not(:focus-within) .MuiInputLabel-root': { visibility: 'hidden' },
                                    '&:has(img):not(:focus-within) .MuiOutlinedInput-notchedOutline legend': { maxWidth: 0 },
                                    '&:has(img):not(:focus-within) .MuiAutocomplete-clearIndicator': { display: 'none' },
                                    '& .MuiInputBase-input': { minWidth: '0 !important' },
                                },
                            }}
                            minWidth={0}
                            dropdownMinWidth={300}
                            options={recipes.options}
                            searchOnlyIds={recipes.searchOnly}
                            value={machine.recipe || null}
                            onChange={(newValue) => onPatch(index, recipePatch(machine, newValue || '', craftingMachines))}
                            label="Recipe"
                            placeholder="Search recipes..."
                            // the label says "Recipe" in every row: say whose it is
                            inputAriaLabel={recipeName(label)}
                            freeSolo
                        />
                    </Box>
                </Tooltip>
            </EntityRowTop>
            <RecipeNotMadeNote machine={machine} />
            {placesResults(machine, craftingMachines) && <ResultTargetField machine={machine} machineLabel={label} build={build}
                getRecipeInfo={getRecipeInfo} onChange={result_target => onPatch(index, { result_target })} />}
            <EntitySettings actionContainerId={settingsSlotId('machine', machine.id)} label={label} tabs={[
                { label: 'Input Routes', content: <InputRoutesPanel machineId={machine.id} build={build} getRecipeInfo={getRecipeInfo} inputs={inputs}
                    transfers={allOutputTransfers} loading={outputTransfersLoading || updating} onEditInserter={onEditInserter} /> },
                { label: 'Output Routes', content: <OutputTransferPanel summary={outputTransfer} chests={build.chests} facts={updating ? null : facts}
                    fallbackItems={machine.recipe ? getRecipeInfo?.(machine.recipe)?.results ?? [] : []} targetRate={atTarget ? targetRate : undefined} atTarget={atTarget}
                    generationIssues={outputGenerationIssues} loading={outputTransfersLoading} onFix={item => onFixOutput?.(machine.id, item)} onEditInserter={onEditInserter} /> },
                { label: 'Machine Facts', content: !machine.recipe
                ? <Typography variant="body2">Choose a recipe to see machine facts.</Typography>
                : updating || (atTarget && targetUpdating)
                    ? <Typography variant="body2">Updating production…</Typography>
                    : atTarget && !targetRate
                        ? <Typography variant="body2">At-target rates unavailable for this build.</Typography>
                : <MachineFactsAccordion inline machineId={machine.id} facts={facts} error={error} targetRate={atTarget ? targetRate : undefined} /> }]} summary={openTab =>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 2, rowGap: 0.75, justifyContent: 'space-between' }}>
                    {updating
                        ? <Typography variant="caption">Updating production…</Typography>
                        : facts && !error && <MachineProductionSummary facts={facts} targetRate={atTarget ? targetRate : undefined} atTarget={atTarget} />}
                    <Typography variant="caption">
                        Speed {Number(machine.crafting_speed.toFixed(3))}× · Productivity {machine.productivity}%
                        {burnsNutrients(machine, craftingMachines) && ` · Energy ${Number((machine.energy_consumption_bonus ?? 0).toFixed(2))}%`}
                    </Typography>
                    {missingOutputs > 0 && <Button size="small" color="warning" onClick={() => openTab('Output Routes')}>
                        {missingOutputs} {missingOutputs === 1 ? 'output needs' : 'outputs need'} a route</Button>}
                    {outputGenerationIssues.length > 0 && <Button size="small" color="warning" onClick={() => openTab('Output Routes')}>Output target cannot be clocked</Button>}
                    {!outputTransfersLoading && (!outputTransfer || outputTransfer.status === 'unavailable') && <Button size="small" color="inherit" onClick={() => openTab('Output Routes')}>Output routes unavailable</Button>}
                </Box>
            }>
            <MachineSettingsFields machine={machine} onChange={(field, value) => onUpdate(index, field, value)} onPatch={patch => onPatch(index, patch)}
                nutrients={burnsNutrients(machine, craftingMachines)} />

            {machine.fuel !== undefined && <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }} title={nameWithId(itemLabel(machine.fuel), machine.fuel)}>Imported fuel (read-only): {itemLabel(machine.fuel)}.</Typography>}
            </EntitySettings>
        </>}
    </EntityRow>;
}

export const MachinesForm = memo(MachinesFormComponent);
