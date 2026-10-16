# Phase 3 B — additive 3.J minor recheck, round 1

**Verdict: PASS.** B3E-4 is fixed. The related saved-run/selected-clock belt copy now distinguishes the run’s saved setting from the selected alternative’s requirement. No blocker, major, or new regression found in this bounded diff.

This is an additive affected-persona recheck. The original independent report at /tmp/ux-phase3-end/B-r16-FULL.md remains unchanged.

## Scope and source

I read the 3.J specification, the six-file diff, the exact frozen source, actual current-source PNGs and ARIA, the standing-selection receipt, and recorded verification results. I did not operate the app/browser, run Git/npm/tests, alter product files, delegate, or read another current recheck or formal review. This report is the sole authorized write.

- Product: bca47c8d666178f37f8dbb9334e1379812ef9e3a.
- Immutable source: /tmp/ux-phase3-result-copy-verifier.
- UI tree: 74bcbf9db4ea3f90f84a1867f061fb831edfbfca.
- Unchanged engine tree: 81e2f2279361387d3141a14e53e147d37288c3d4.
- Specification: /tmp/ux-p3-integration/docs/ux-rework/specs/3.J-result-copy.md.
- Reviewed diff: /tmp/ux-phase3-result-copy-review/DIFF.patch, against 7433d6c.

The diff changes two UI utility implementations, assertions in their two existing test files, and two existing capture consumers. It does not change the engine, event extraction, intervals, result selection, persistence, lifecycle, layout, or timing.

## Finding dispositions

| Finding | Prior severity | Disposition | Evidence |
|---|---|---|---|
| B3E-4 — floating-point noise in Fuel summary prose | minor | **Fixed** | The actual 720px image and ARIA now say “82.094 items burned (fuel amounts rounded for display).” The persistent summary retains duration, zero-empty-tick information and the same Fuel event table. |
| Related saved-run/selected-clock belt explanation | minor copy correction | **Fixed** | A native checked standing-only alternative retains its Standing still tile and selected-clock condition, while the line separately says “This run used your Moving belt setting.” Selection preserves exact build RAW in CURRENT-COPY.json. |

### Fuel

The visible result is readable, and the single inline rounding qualifier avoids implying that the displayed fuel quantities are exact. It appears in the persistent accessible paragraph as well.

Actual evidence:

- /tmp/ux-phase3-result-copy-native-fuel/w720/03-fuel-events-and-trace-text-720-part5of6.png.
- /tmp/ux-phase3-result-copy-native-fuel/w720/03-fuel-events-and-trace-text-720.aria.yml:231–280.
- /tmp/ux-phase3-result-copy-native-fuel/w720/INDEX.md: 108 PASS, 0 FAIL, 0 failed steps.

The ARIA still contains the six event rows with starts/ends 1–12, 385–396, 577–588, 961–972, 1345–1356 and 1729–1740, each with 16 items. The run remains 1920 ticks, with zero ticks without fuel.

Source evidence:

- /tmp/ux-phase3-result-copy-verifier/clock-generator-ui/src/utils/fuelAccessibility.ts:41–48 formats only the summary quantities through formatNumberText with maxDecimals: 3.
- The event mapping at :13–22 and sampled-interval computation at :25–38 are unchanged.
- /tmp/ux-phase3-result-copy-verifier/clock-generator-ui/src/utils/numberText.ts:46–62 preserves the established nonzero-small-value display behavior.
- FuelPanel.tsx:315 still renders this summary, and :204/:395 still connect the level chart to its persistent description.

The existing assertion now uses the observed 82.09359999999995 input. This is a useful concrete regression replacement in an existing case, without increasing the suite count.

### Saved run and selected clock

The corrected sentence is accurate in the important mixed case: the run used Moving, while I manually selected a clock made for standing belts. It does not reinterpret the selected clock as moving-compatible, change the build’s setting on selection, or hide the alternative’s condition.

Actual evidence:

- /tmp/ux-phase3-result-copy-native-standing/w720/01-standing-alternative-saved-moving-setting-720.png shows the Standing still tile and the saved Moving line together.
- The matching ARIA contains the full selected-card explanation, “It is made for belts that stand still,” Back to recommended, the explicit saved-setting line, and the checked standing-only radio with “Only for belts that stand still.”
- /tmp/ux-phase3-result-copy-native-standing/CURRENT-COPY.json records selectedStanding: true, rawUnchanged: true and the complete card text.
- /tmp/ux-phase3-result-copy-native-standing/INDEX.md records 23 PASS, 0 FAIL, 0 failed steps.

Source evidence:

- /tmp/ux-phase3-result-copy-verifier/clock-generator-ui/src/utils/beltQuestion.ts:26–29 changes only the two result sentences; :83–86 retains the existing actions and switch direction.
- App.tsx:600 still takes the assumption from generatedFor.beltQuestion; :1157–1163 passes that saved assumption to the result line.

The cancel capture’s selected clock was Moving. I do not use that capture as evidence of a selected-standing/saved-moving state. The dedicated standing capture supplies that evidence. Its screenshot is an observation, not keyboard/focus proof.

## Verification and limits

Recorded author gates all exit 0: UI tests, lint, default knip, icons and build. The independent repeat records test/build exit 0 against the frozen source and matching own engine. Both test logs retain 1295 tests in 80 files. The preview receipt records 412 exact HTTP assets and the same own engine.

I did not rerun these commands. Their records support provenance and regression confidence; they are not my UX verdict by themselves.

This is the bounded minors-only recheck specified by 3.J. The original full r16 broad 8002/0/0 and supplement 8043/0/0 remain preceding-source evidence, not fresh full post-fix runs. The current Fuel and selected-standing captures cover the changed prose.

All other original minor carries and evidence limits remain open exactly as recorded: comparison travel, menu-close scroll movement, working context, previous-check reason retention, passive 320px chip clipping, unknown-recipe feedback, and the unexercised native pending-Undo interval. This does not claim blanket AA, human usability proof or additional gameplay certification.

D9 still requires independent audit **and actual justified cleanup of UX-added UI tests before feature → master**. No arbitrary coverage quota or deferred report-only substitute is implied.
