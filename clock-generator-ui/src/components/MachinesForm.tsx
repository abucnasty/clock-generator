import { EntityBadge } from './EntityBadge';
import { EntitySettings } from './EntitySettings';
import { Add, Delete } from '@mui/icons-material';
import {
    Box,
    Button,
    IconButton,
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
import { useFocusAfterRemove } from '../hooks/useFocusAfterRemove';
import { themeTokens } from '../theme/runtimeTokens';
import type { Theme } from '@mui/material/styles';
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
import { SidecarModLink } from './IntroCard';
import { SortableItem, SortableList } from './SortableList';
import { RowActionsMenu } from './RowActionsMenu';
import { useAnnounce } from '../hooks/useMessages';
import { useGameNames } from '../hooks/useGameNames';
import { nameWithId } from '../utils/gameNames';
import { deleteButtonLabel, entityLabel } from '../utils/entityLabel';
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
    const { itemLabel } = useGameNames();
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
    const { cardRef, remove, afterAdd } = useFocusAfterRemove(machines.length, onRemove);
    const announce = useAnnounce();
    const addedLabel = () => entityLabel('machine', Math.max(0, ...machines.map(row => row.id)) + 1);
    const duplicate = (index: number) => {
        afterAdd(() => onDuplicate(index));
        announce(`Added ${addedLabel()}, a copy of ${entityLabel('machine', machines[index].id)}.`);
    };

    const add = () => {
        afterAdd(onAdd);
        announce(`Added ${addedLabel()}.`);
    };

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
                            of the requested output. Open a machine's settings to edit its speed and productivity.
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
                <Button id={ELEMENT_IDS.addMachine} startIcon={<Add />} color="inherit" onClick={add} variant="text" size="small" data-row-add="">
                    Add Machine
                </Button>
                </Box>
            )}
        >
            {rateView === 'target' && targetRates.error && <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                At-target rates unavailable: {targetRates.error}
            </Typography>}
            <SortableList itemKeys={machines.map((m) => m._uuid)} onReorder={onReorder}>
                {machines.map((machine, index) => (
                    <SortableItem key={machine._uuid} stableKey={machine._uuid} label={entityLabel('machine', machine.id)}
                        displayTitle={`${machineIconText(machine, itemLabel)}. Click to change the machine.`}
                        displayLabel={<MachineIconPicker machine={machine} onPatch={patch => onPatch(index, patch)}
                            buttonName={changeMachineName(entityLabel('machine', machine.id))} rowName={entityLabel('machine', machine.id)}>
                            <EntityBadge id={machine.id}>
                                <MachineIcon machine={machine} size={28} />
                            </EntityBadge>
                        </MachineIconPicker>}>
                        {(dragHandle) => (
                            <MachineRow
                                machine={machine}
                                index={index}
                                recipeNames={recipeNames}
                                build={build}
                                getRecipeInfo={getRecipeInfo}
                                atTarget={rateView === 'target'}
                                targetRate={targetRates.rates?.find(rate => rate.machine_id === machine.id)}
                                targetUpdating={targetRates.updating}
                                outputTransfer={outputTransfers?.find(transfer => transfer.source.type === 'machine' && transfer.source.id === machine.id) ?? null}
                                outputGenerationIssues={outputGenerationIssues.filter(issue => issue.machine_id === machine.id)}
                                outputTransfersLoading={outputTransfersLoading}
                                onFixOutput={onFixOutput}
                                onEditInserter={onEditInserter}
                                canDelete={machines.length > 1}
                                dragHandle={dragHandle}
                                onUpdate={onUpdate}
                                onPatch={onPatch}
                                onRemove={remove}
                                onDuplicate={() => duplicate(index)}
                                onMoveUp={index > 0 ? () => onReorder(index, index - 1) : undefined}
                                onMoveDown={index < machines.length - 1 ? () => onReorder(index, index + 1) : undefined}
                            />
                        )}
                    </SortableItem>
                ))}
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
    onFixOutput?: (machineId: number, item: string) => void;
    onEditInserter?: (id: number) => void;
    machine: MachineFormData;
    index: number;
    recipeNames: string[];
    build: ResultTargetBuild;
    getRecipeInfo?: (name: string) => RecipeInfo | null;
    canDelete: boolean;
    onDuplicate: () => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    dragHandle: React.ReactNode;
    onUpdate: (index: number, field: keyof MachineFormData, value: string | number) => void;
    onPatch: (index: number, patch: Partial<MachineFormData>) => void;
    onRemove: (index: number) => void;
}

function MachineRow({ machine, index, recipeNames, build, getRecipeInfo, atTarget, targetRate, targetUpdating, outputTransfer, outputGenerationIssues, outputTransfersLoading, onFixOutput, onEditInserter, canDelete, dragHandle, onUpdate, onPatch, onRemove, onDuplicate, onMoveUp, onMoveDown }: MachineRowProps) {
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

    return (
        <Box
            id={`entity-machine-${machine.id}`}
            role="group"
            aria-label={entityLabel('machine', machine.id)}
            sx={{
                mb: 1,
                p: 1.5,
                minWidth: 0,
                bgcolor: (theme: Theme) => themeTokens(theme).surface.row,
                containerType: 'inline-size',
                containerName: 'machine-row',
            }}
        >
            <Box
                sx={{
                    display: 'grid',
                    gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                    gap: 1,
                    alignItems: 'center',
                    mb: 1.5,
                }}
            >
                {dragHandle}
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
                            inputAriaLabel={recipeName(entityLabel('machine', machine.id))}
                            freeSolo
                        />
                    </Box>
                </Tooltip>
                <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                    <Box id={`settings-actions-machine-${machine.id}`} sx={{ display: 'flex' }} />
                    <RowActionsMenu label={entityLabel('machine', machine.id)} onDuplicate={onDuplicate} onMoveUp={onMoveUp} onMoveDown={onMoveDown} />
                    <IconButton
                        onClick={() => onRemove(index)}
                        color="error"
                        disabled={!canDelete}
                        aria-label={deleteButtonLabel('machine', machine.id)}
                        data-row-delete=""
                    >
                        <Delete />
                    </IconButton>
                </Box>
            </Box>
            <RecipeNotMadeNote machine={machine} sx={{ mb: 1 }} />
            <OutputTransferPanel summary={outputTransfer} chests={build.chests} facts={facts} fallbackItems={machine.recipe ? getRecipeInfo?.(machine.recipe)?.results ?? [] : []} targetRate={atTarget ? targetRate : undefined} atTarget={atTarget}
                generationIssues={outputGenerationIssues} loading={outputTransfersLoading}
                onFix={item => onFixOutput?.(machine.id, item)} onEditInserter={onEditInserter}
                control={placesResults(machine, craftingMachines) ? <ResultTargetField machine={machine} machineLabel={entityLabel('machine', machine.id)} build={build}
                    getRecipeInfo={getRecipeInfo} sx={{ mb: 1.5 }} onChange={result_target => onPatch(index, { result_target })} /> : undefined} />
            <EntitySettings actionContainerId={`settings-actions-machine-${machine.id}`} label={entityLabel('machine', machine.id)} tabs={[{ label: 'Machine facts', content: !machine.recipe
                ? <Typography variant="body2">Choose a recipe to see machine facts.</Typography>
                : updating || (atTarget && targetUpdating)
                    ? <Typography variant="body2">Updating production…</Typography>
                    : atTarget && !targetRate
                        ? <Typography variant="body2">At-target rates unavailable for this build.</Typography>
                        : <MachineFactsAccordion inline machineId={machine.id} facts={facts} error={error} targetRate={atTarget ? targetRate : undefined} /> }]} summary={
                <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', columnGap: 2, rowGap: 0.75, justifyContent: 'space-between' }}>
                    {updating
                        ? <Typography variant="caption">Updating production…</Typography>
                        : facts && !error && <MachineProductionSummary facts={facts} targetRate={atTarget ? targetRate : undefined} atTarget={atTarget} />}
                    <Typography variant="caption">
                        Speed {Number(machine.crafting_speed.toFixed(3))}× · Productivity {machine.productivity}%
                        {burnsNutrients(machine, craftingMachines) && ` · Energy ${Number((machine.energy_consumption_bonus ?? 0).toFixed(2))}%`}
                    </Typography>
                </Box>
            }>
            <MachineSettingsFields machine={machine} onChange={(field, value) => onUpdate(index, field, value)} onPatch={patch => onPatch(index, patch)}
                nutrients={burnsNutrients(machine, craftingMachines)} />

            {machine.fuel !== undefined && <Typography variant="body2" sx={{ overflowWrap: 'anywhere' }} title={nameWithId(itemLabel(machine.fuel), machine.fuel)}>Imported fuel (read-only): {itemLabel(machine.fuel)}.</Typography>}
            </EntitySettings>
        </Box>
    );
}

export const MachinesForm = memo(MachinesFormComponent);
