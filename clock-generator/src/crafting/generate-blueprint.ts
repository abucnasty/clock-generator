// The clock generator, by boundary. This file re-exports the public surface, unchanged, from the modules it was
// split into: the planning run (plan/), the clock (clock.ts), the trial of a clock (trial.ts), the ways a clock is
// made from another (candidates/, each a transform of the windows searched with search.ts), the ranking (rank.ts), the alternatives (alternatives.ts) and the export.
export { FuelConsumptionView, ClockOnlyRun, SimulationStabilityCheck, SwingAttemptResult, SwingBackoffReport, BlueprintGenerationResult, DebugSteps, GenerateClockOptions, MachineStartStock, GenerationProgress } from "./plan/plan-run";
export { generateClockForConfig, generateClockWithSwingBackoff } from "./generate-clock";
export { ConfigValidation, validateConfig } from "./plan/validate-config";
export { SerializableClockWindows, ClockBelt, clockBeltLabel } from "./clock";
export { AsBuiltStabilityCheck, ClockAssessment, ClockVerdict, clockVerdictOf, LOOP_WINDOW_CHECK_TICKS, simulateClockOnly, clockFromWindows, backpressureLossOf } from "./trial";
export { observedWindowsClock } from "./candidates/observed-windows";
export { SearchReport, SearchCandidate, SearchRangeEdge } from "./candidates/search";
export { hasPlannedWindowsNotHands } from "./candidates/full-hand";
export { anyFeederCarriesFuel, drawWindowTicks } from "./candidates/loop-windows";
export { ClockRanking, rankingOf, rankingWindowCount, combineClockAlternativeRuns, selectableAsStable, searchesAreNeeded } from "./rank";
export { ClockAlternative, ClockAlternativesResult, ClockAlternativeRun, ClockAlternativeContext, ClockAlternativeTask, ClockAlternativesPlan, planClockAlternatives, runClockAlternativeTask, generateClockAlternatives } from "./alternatives";
export { blueprintFileFor } from "./blueprint-export";
export type { AlwaysOnReason, AlwaysOnReasons } from "./always-on-reasons";
