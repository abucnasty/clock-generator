# 3.F checking focus continuity — independent prebuild approval

Verdict: APPROVE WITH ONE REFINEMENT (design only; formal item review not begun).
Reviewer cancel_keep_code_sol, GPT-6.1 Sol/high/fastoff; actual UTC2026-10-16 11:32:03–11:32:29.

Read actual App/CheckPlanSection/TransferPlanPanel/check hook flow. App effect retains the same valid ValidationState reference during exclusion-update→effect gap; validate creates a new running reference. Store that reference before invoking the existing guarded Exclude handler. Preserve checking Chip root and block all mutations. Bridge ONLY while pendingValidation===validation AND checkStatus==='out-of-date'. Clear the marker during render if validation identity changes OR status returns valid, covering no-op/cancel without indefinite checking. Ordinary stale edits without marker remain read-only; none/build replacement clears normally. No timer, focus restoration, engine change or public API.

Required tests: gap→running→valid/invalid, no-op, cancellation restoring old reference, replacement→none. Real readonly observer must show ORIGINAL node connected/focused throughout and aria-disabled while checking. Initial probe4 actual failure remains retained /tmp/ux-phase3-followups-probe4/CHECKING-FOCUS-SUMMARY.json; full new immutable gates, root repeat and real observer closure before full acceptance. Earlier original design approvals/review caps/owner checkpoints unchanged.
