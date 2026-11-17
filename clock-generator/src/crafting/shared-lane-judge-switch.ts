/**
 * The switch of the judge of the lanes the copies share (#733). On: each machine's rate against its target is the first
 * judge, and the comparison with a run of one copy alone stays only for the cases the rate cannot judge yet
 * (shared-lane-verdict.ts, `judgeSharedLanes`). Off: the comparison with the run alone is the first judge, as before.
 * Off until the default is ruled.
 */
export const SHARED_LANES_JUDGED_BY_RATE: boolean = false;
