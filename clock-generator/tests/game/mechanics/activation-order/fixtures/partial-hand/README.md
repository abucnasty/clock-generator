# Partial machine-source notifications

The [scaffold](scaffold.txt) has three copper-cable assemblers, legendary 16-item inserters and 48-slot chests.
Source outputs receive 0/8/16 cable; hands pick it up themselves. One craft follows visible row 8, using one copper
plate and progress 0.99. Direct insertion of 8 source output items after visible row 14 is a separate intervention.
The inherited disconnected condition setter was ineffective, so this case has no condition-assignment conclusion.

![Three-cell source layout](scaffold.jpg)

The [screenshot provenance](../../../screenshots.generated.json) identifies the exact scaffold and game version.
It shows the warmed layout without the observation stock/interventions.

The fixture preserves 20 updates, 14 alarms, 6 wakes and 6 directly observed sleeps. Partial hands sleep after a
top-up; a full 16-item hand stays awake to swing and delivers before source event 8. Craft 8 wakes hands 3,2,1;
updates at 9 are 1,2,3. Direct insertion at 14 wakes 1,2,3; updates at 14 are 3,2,1. These source-specific sequences
do not establish a universal subscriber order.

The first reference has exact 24-row equality. A repeat starts one absolute game tick earlier: absolute equality is
false, while equality after the declared installation-origin subtraction is true. Do not fit a phase to outputs.
Transfers in actual tick k appear in visible row k+1. The complete visible rows and initial inventory/topology remain.
SHA256SUMS seals the fixture and scaffold. Replay supplies observed notification/outcome data to the scheduler;
it is not a hand-physics prediction or a whole-factory cure.
