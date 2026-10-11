// The clock generator, by boundary. This file re-exports the public surface, unchanged, from the modules it was
// split into: the planning run (plan/), the clock (clock.ts), the trial of a clock (trial.ts), the ways a clock is
// made from another (candidates/), the ranking (rank.ts), the alternatives (alternatives.ts) and the export.
export { SerializableInserterClock, FuelConsumptionView, ClockOnlyRun, SimulationStabilityCheck, SwingAttemptResult, SwingBackoffReport, BlueprintGenerationResult, DebugSteps, GenerateClockOptions, MachineStartStock, GenerationProgress, generateClockForConfig, generateClockWithSwingBackoff } from "./plan/plan-run";
export { ConfigValidation, validateConfig } from "./plan/validate-config";
export { SerializableClockWindows, ClockBelt, clockBeltLabel } from "./clock";
export { AsBuiltStabilityCheck, ClockAssessment, ClockVerdict, clockVerdictOf, OUTPUT_FEEDER_CHECK_TICKS, simulateClockOnly, clockFromWindows, backpressureLossOf } from "./trial";
export { DerivedClockWindowsReport } from "./candidates/observed-windows";
export { CheckedShift, CheckedShiftRow, ShiftRangeEdge, ShiftedSwings } from "./candidates/shifted-swings";
export { hasPlannedWindowsNotHands } from "./candidates/full-hand";
export { feedersOfOutputMachines, anyFeederCarriesFuel } from "./candidates/output-feeders";
export { ClockRanking, rankingOf, rankingWindowCount, combineClockAlternativeRuns } from "./rank";
export { ClockAlternative, ClockAlternativesResult, ClockAlternativeRun, ClockAlternativeContext, ClockAlternativeTask, ClockAlternativesPlan, planClockAlternatives, runClockAlternativeTask, generateClockAlternatives } from "./alternatives";
export { blueprintFileFor } from "./blueprint-export";
