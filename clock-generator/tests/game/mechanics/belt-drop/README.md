# Belt drop experiments

The [turbo stack-size calibration](fixtures/turbo-stacks/README.md) verifies native deposits at effective belt
stack sizes 1, 2, 3 and 4 against `Belt::amountToDropAtTick`. Both full hands per case match, including every
empty tick. Stack size 3 uses the existing 15-item effective hand rule. No production timing change is needed.

Run only this topic with `npm run test:game -- tests/game/mechanics/belt-drop/turbo-stacks.game.test.ts`.
Other speeds remain outside this calibration; obstructed receiving lanes, further approaches and other inserter kinds are in [belt-drop-timing](../belt-drop-timing/README.md).
