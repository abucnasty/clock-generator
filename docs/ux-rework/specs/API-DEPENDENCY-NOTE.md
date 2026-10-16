# Exact proposed seams and adoption checklist

Source-only planning. Root must replace mutable evidence below with exact accepted compatibility source, pin exports/consumers in every item spec, then record D3 baseline before product authoring. Existing accepted Phase3 and frozen master are source evidence, not proof that the proposed compatibility code passes. No new tests/builds/browser/Git operations were run here.

## Compatibility-owned API observed in the MUTABLE author tree

`clock-generator-ui/src/worker/types.ts` currently exports:

```ts
interface ClockModelAssumptions {
  loopSeeds: { machineId: string; item: string; items: number }[];
  outputDrops: {
    beltId: number; inserterIds: number[];
    mode: 'shared-lanes' | 'free-lane';
  }[];
  overrides: Config['overrides'];
  machineFuel: { machineId: number; fuel: string }[];
}
interface GenerationAssumptions {
  startDependenceRequested: boolean;
  complete: boolean;
}
// ClockAlternativeView.assumptions: ClockModelAssumptions
// PlannedResponse.assumptions:
//   Pick<GenerationAssumptions, 'startDependenceRequested'>
```

`hooks/useSimulationWorker.ts` exposes `generationAssumptions: GenerationAssumptions | null`; `utils/resultsCache.ts` KeptResults carries it, with existing resultsStore ownership. `components/ResultsWorkspace.tsx` accepts it and ResultSummaryCard consumes it. Actual per-clock outcomes are `assessment.start_dependence?.starts` with id/label/reaches_target/output_items_per_period/cycle/off_bins/span_items/long_run_keeps_up; original type is engine `crafting/start-dependence.ts`. Loss facts are `assessment.backpressure_loss` (`survives`, `broken_by`, `recovered_after_periods`) or null. `assessment.holds` is distinct from top-level verdict; no verdict-derived loss conclusion.

Mutable `utils/modelAssumptions.ts` currently exports exactly:

```ts
startCheckSummary(
  clocks: Pick<ClockAlternativeView, 'assessment'>[],
  generation: GenerationAssumptions | null,
): string;
MODELED_START: string;
PLANNING_START: string;
modeledDetails(clock: ClockAlternativeView, itemLabel?: (id: string) => string): string[];
```

D5 consumes/recomposes these accepted presentation facts; this is not a second semantic provider. Additional metadata summary should reuse inserterMetadata/inserterFilters locally, not create another generation facts API. Root must pin any accepted rename/change in D1A/D4/D5 before implementation.

**Candidate-local caution to resolve on accepted source:** observed worker `toRunView(run, config)` stores `assumptions.overrides` from its supplied generation config. Upstream lean definitions use `definition.planned_on` internally. Therefore that field must not be described as the selected candidate's effective lean-plan overrides unless the accepted provider establishes that meaning. Candidate period/windows, description/insights and assessment already remain candidate-local. Do not parse an ID to synthesize a competing effective-plan provider; request/reuse the compatibility provider if a genuinely missing read-only fact is required. No claim here that the mutable implementation has settled this seam.

## Proposed new preference API — ONE provider

`clock-generator-ui/src/utils/displayPreferences.ts` exports exactly:

```ts
export type DisplayDensity = 'explanatory' | 'compact';
export type DisplayScheme = 'system' | 'light' | 'dark';
export interface DisplayPreferences {
  version: 1;
  density: DisplayDensity;
  scheme: DisplayScheme;
}
export const DISPLAY_PREFERENCES_KEY = 'clock-generator-display-preferences';
export const DEFAULT_DISPLAY_PREFERENCES: DisplayPreferences;
// { version: 1, density: 'explanatory', scheme: 'system' }
export function readDisplayPreferences(
  storage: Pick<Storage, 'getItem'> | null,
): DisplayPreferences;
export function writeDisplayPreferences(
  storage: Pick<Storage, 'setItem'> | null,
  preferences: DisplayPreferences,
): void;
```

`hooks/useDisplayPreferences.tsx` exports exactly:

```ts
export interface DisplayPreferencesContextValue {
  density: DisplayDensity;
  scheme: DisplayScheme;
  setDensity(density: DisplayDensity): void;
  setScheme(scheme: DisplayScheme): void;
}
export function DisplayPreferencesProvider(
  props: { children: ReactNode },
): ReactElement;
export function useDisplayPreferences(): DisplayPreferencesContextValue;
```

`components/DisplayPreferences.tsx` exports `DisplayPreferencesButton(): ReactElement`, consuming the hook itself. In foundation its control changes only density; D2 later adds working scheme controls. D2 resolves System via matchMedia in its theme adapter and consumes the same scheme; no second preferences state, storage or public resolved-mode API is needed. The current source uses static appTheme; the adapter is D2 work, not an existing capability. D1B consumes only density. Root pins this exact contract into D1A, D1B, D2 and D6 before provider/consumer authoring. D7 gets no preference fields.

## Proposed controlled detail + indexed presentation seams

`utils/resultsView.ts` exports only `type ResultDetail = 'why' | 'wake' | 'install'`. App owns state initialized to why; ResultsWorkspace gains `detail: ResultDetail`, `onDetailChange(detail: ResultDetail): void`, `generatedFor: GeneratedFor | null` in addition to accepted compatibility's generationAssumptions. Reuse existing staleFor/change props for existing warnings; generatedFor is present fresh and stale. Any selected-detail child receives this controlled pair, not another state owner. D7 later may persist this owner, without implementation here.

Proposed additions to existing `utils/recommendedClock.ts`:

```ts
export interface ClockRow<T> { alternative: T; index: number }
export interface BeltClockGroups<T> {
  matches: ClockRow<T>[];
  requiresChange: ClockRow<T>[];
}
export function groupClockRowsByBelt<
  T extends Pick<ClockAlternativeView, 'ranking'>,
>(rows: readonly ClockRow<T>[]): BeltClockGroups<T>;
```

The existing private ClockRow has this shape; export it once. Group already eligible/indexed output of existing partitionClockRows, retaining references/relative order. Apply grouping to stable/other row lists, then render each belt group's stable/other rows. Pending labels remain outside. Do not pass subarrays into partitionClockRows and reinterpret indexes/anyStable. No recommendedIndexOf change.

## Concrete files and downstream dependencies

| Provider/owner | Consumers or invariant |
|---|---|
| App PageProviders/header/view/generatedFor | DisplayPreferencesButton; D1A composition; D1B density; D2 theme; existing WorkflowBar/BuildSwitcher/ConfigImportExport/MessageSlot/sticky measurement |
| worker/types + simulation.worker + pool/hook + resultsCache/resultsStore | Accepted 0.16 saved assumption contract; ResultsWorkspace/card/Why; Cancel/Undo/reload/stale ownership; do not add a second payload |
| recommendedClock + clockSummary + rateWarning + glossary | Card/table/Why/WorkflowBar/old-Copy warning; preserve accepted start/recovery semantics and ranking |
| ResultsWorkspace + ResultSummaryCard + InstallSteps/WakeWindowsView/DetailsPanel | Single context ownership, full install/wiring, legend/help, Insights/Fuel/blueprint, source-matched capture selectors |
| resultsStaleness.GeneratedFor + App snapshot decoding | Fresh/stale metadata/Copies/belt provenance; no current-form substitution |
| pastePreview + ConfigImportExport Apply + configForm/{formData,configMapping,edits} | Prospective import composition, metadata/overrides/fuel/drop preservation and accepted geometry refusal/recovery; future D10 must reconcile its own API here |
| inserterMetadata + inserterFilters + shared editor | Missing/explicit/automatic semantics in import/Results now and D1B/D5 Configure later |
| capture/lib.mjs + all affected scripts | Root reconciles labels/state/helpers on accepted source before evidence; no fabricated results |

Root finalization checks: accepted compatibility source/hash and exact exports; sampled counts from actual starts; candidate-local versus generation-config override meaning; geometry policy unchanged for ordinary edits; one preference API copied to every provider/consumer spec; D3 baseline receipts; minimum meaningful tests reused; common independent reviews/full gates/native widths/personas retained. These are source/API reconciliation steps within existing approvals, not additional owner requirements.

Root reconciled036b4d6 API: modeledDetails receives existing useGameNames itemLabel for new player-facing names; raw saved IDs remain unchanged. D6 scope needs saved browser-wide preferences on reload, no new live storage-event synchronization project. Exact accepted source/evidence pin remains pending compatibility acceptance.
