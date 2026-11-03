export interface Resettable {
    /** Keeps its count when a later step of a run starts, as a clock of the game does (ClockedEnableControl.reset) */
    readonly runs_through_steps?: boolean;
    /**
     * @param starts_clock the reset puts a clock on the build as it starts, rather than starting a step of a run whose
     * clock has run since (see ClockedEnableControl.reset)
     */
    reset(starts_clock?: boolean): void;
}