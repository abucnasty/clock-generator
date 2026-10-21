export interface Resettable {
    /**
     * @param starts_clock the reset puts a clock on the build as it starts, rather than starting a step of a run whose
     * clock has run since (see ClockedEnableControl.reset)
     */
    reset(starts_clock?: boolean): void;
}