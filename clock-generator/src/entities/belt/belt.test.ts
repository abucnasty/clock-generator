import { describe, test, expect } from "vitest"
import { Belt, BeltSpeed } from "./belt"
import { fraction } from "../../data-types/fraction"
import { BeltStackSize } from "./belt-stack-size"

describe("Belt", () => {

    describe("Belt::tileSpeedDuration", () => {

        test("transport-belt", () => {
            const belt_speed = BeltSpeed.TRANSPORT_BELT
            const duration = Belt.ticksPerTile(belt_speed)
            expect(duration).toStrictEqual(fraction(32, 1))
            expect(duration.toDecimal()).toBe(32)
        })

        test("fast-transport-belt", () => {
            const belt_speed = BeltSpeed.FAST_TRANSPORT_BELT
            const duration = Belt.ticksPerTile(belt_speed)
            expect(duration).toStrictEqual(fraction(32, 2))
            expect(duration.toDecimal()).toBe(16)
        })

        test("express-transport-belt", () => {
            const belt_speed = BeltSpeed.EXPRESS_TRANSPORT_BELT
            const duration = Belt.ticksPerTile(belt_speed)
            expect(duration).toStrictEqual(fraction(32, 3))
            expect(duration.toDecimal()).toBe(10.666666666666666)
        })

        test("turbo-transport-belt", () => {
            const belt_speed = BeltSpeed.TURBO_TRANSPORT_BELT
            const duration = Belt.ticksPerTile(belt_speed)
            expect(duration).toStrictEqual(fraction(32, 4))
            expect(duration.toDecimal()).toBe(8)
        })
    })

    describe("Belt::amountToDropAtTick", () => {
        test("turbo-transport-belt with stack size 4", () => {
            const belt_speed = BeltSpeed.TURBO_TRANSPORT_BELT
            const stack_size = 4

            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 0)).toBe(4)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 1)).toBe(4)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 2)).toBe(4)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 3)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 4)).toBe(4)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 5)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 6)).toBe(4)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 7)).toBe(0)
        })

        // Native two-hand calibration: tests/game/mechanics/belt-drop/fixtures/turbo-stacks/README.md.
        // Offsets include every empty tick between the first and last deposit.
        test.each([
            {stackSize: BeltStackSize.TWO, amounts: [2, 2, 2, 0, 2, 0, 2, 0, 2, 0, 2, 0, 2]},
            {stackSize: BeltStackSize.THREE, amounts: [3, 3, 3, 0, 3, 0, 3]},
        ])("turbo native drop trace with stack size $stackSize", ({stackSize, amounts}) => {
            expect(amounts.map((_, tick) => Belt.amountToDropAtTick(BeltSpeed.TURBO_TRANSPORT_BELT, stackSize, tick)))
                .toEqual(amounts);
        });

        test("transport-belt with stack size 1", () => {
            const belt_speed = BeltSpeed.TRANSPORT_BELT
            const stack_size = 1

            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 0)).toBe(1) // 15
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 1)).toBe(1) // 14
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 2)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 3)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 4)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 5)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 6)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 7)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 8)).toBe(1) // 13
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 9)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 10)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 11)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 12)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 13)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 14)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 15)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 16)).toBe(1) // 12
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 17)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 18)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 19)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 20)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 21)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 22)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 23)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 24)).toBe(1) // 11
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 25)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 26)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 27)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 28)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 29)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 30)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 31)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 32)).toBe(1) // 10
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 33)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 34)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 35)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 36)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 37)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 38)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 39)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 40)).toBe(1) // 09
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 41)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 42)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 43)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 44)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 45)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 46)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 47)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 48)).toBe(1) // 08
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 49)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 50)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 51)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 52)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 53)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 54)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 55)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 56)).toBe(1) // 07
        })

        test("turbo-transport-belt with stack size 1", () => {
            const belt_speed = BeltSpeed.TURBO_TRANSPORT_BELT
            const stack_size = 1

            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 0)).toBe(1) // 15
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 1)).toBe(1) // 14
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 2)).toBe(1) // 13
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 3)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 4)).toBe(1) // 12
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 5)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 6)).toBe(1) // 11
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 7)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 8)).toBe(1) // 10
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 9)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 10)).toBe(1) // 09
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 11)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 12)).toBe(1) // 08
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 13)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 14)).toBe(1) // 07
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 15)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 16)).toBe(1) // 06
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 17)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 18)).toBe(1) // 05
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 19)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 20)).toBe(1) // 04
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 21)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 22)).toBe(1) // 03
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 23)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 24)).toBe(1) // 02
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 25)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 26)).toBe(1) // 01
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 27)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 28)).toBe(1) // 00
        })

        test("fast-transport-belt with stack size 1", () => {
            const belt_speed = BeltSpeed.FAST_TRANSPORT_BELT
            const stack_size = 1

            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 0)).toBe(1) // 15
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 1)).toBe(1) // 14
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 2)).toBe(0) 
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 3)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 4)).toBe(1) // 13
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 5)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 6)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 7)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 8)).toBe(1) // 12
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 9)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 10)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 11)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 12)).toBe(1) // 11
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 13)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 14)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 15)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 16)).toBe(1) // 10
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 17)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 18)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 19)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 20)).toBe(1) // 09
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 21)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 22)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 23)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 24)).toBe(1) // 08
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 25)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 26)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 27)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 28)).toBe(1) // 07
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 29)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 30)).toBe (0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 31)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 32)).toBe(1) // 06
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 33)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 34)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 35)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 36)).toBe(1) // 05
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 37)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 38)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 39)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 40)).toBe(1) // 04
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 41)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 42)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 43)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 44)).toBe(1) // 03
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 45)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 46)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 47)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 48)).toBe(1) // 02
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 49)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 50)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 51)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 52)).toBe(1) // 01
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 53)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 54)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 55)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 56)).toBe(1) // 00
        })

        test("express-transport-belt with stack size 1", () => {
            const belt_speed = BeltSpeed.EXPRESS_TRANSPORT_BELT
            const stack_size = 1

            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 0)).toBe(1) // 15
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 1)).toBe(1) // 14
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 2)).toBe(1) // 13
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 3)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 4)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 5)).toBe(1) // 12
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 6)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 7)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 8)).toBe(1) // 11
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 9)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 10)).toBe(1) // 10
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 11)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 12)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 13)).toBe(1) // 09
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 14)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 15)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 16)).toBe(1) // 08
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 17)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 18)).toBe(1) // 07
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 19)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 20)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 21)).toBe(1) // 06
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 22)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 23)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 24)).toBe(1) // 05
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 25)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 26)).toBe(1) // 04
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 27)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 28)).toBe(0) 
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 29)).toBe(1) // 03
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 30)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 31)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 32)).toBe(1) // 02
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 33)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 34)).toBe(1) // 01
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 35)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 36)).toBe(0)
            expect(Belt.amountToDropAtTick(belt_speed, stack_size, 37)).toBe(1) // 00

            
        })
    })

    describe("Belt::dropDuration", () => {

        test("turbo-transport-belt dropping 16 items", () => {
            const belt_speed = BeltSpeed.TURBO_TRANSPORT_BELT
            const belt_stack_size = BeltStackSize.FOUR
            const inserter_stack_size = 16
            const duration = Belt.dropDuration(belt_speed, belt_stack_size, inserter_stack_size)
            expect(duration.ticks).toBe(5)
        })

        test("turbo-transport-belt dropping 12 items", () => {
            const belt_speed = BeltSpeed.TURBO_TRANSPORT_BELT
            const belt_stack_size = BeltStackSize.FOUR
            const inserter_stack_size = 12
            const duration = Belt.dropDuration(belt_speed, belt_stack_size, inserter_stack_size)
            expect(duration.ticks).toBe(3)
        })

        test("turbo-transport-belt dropping 8 items", () => {
            const belt_speed = BeltSpeed.TURBO_TRANSPORT_BELT
            const belt_stack_size = BeltStackSize.FOUR
            const inserter_stack_size = 8
            const duration = Belt.dropDuration(belt_speed, belt_stack_size, inserter_stack_size)
            expect(duration.ticks).toBe(2)
        })

        test("turbo-transport-belt dropping 8 items", () => {
            const belt_speed = BeltSpeed.TURBO_TRANSPORT_BELT
            const belt_stack_size = BeltStackSize.FOUR
            const inserter_stack_size = 4
            const duration = Belt.dropDuration(belt_speed, belt_stack_size, inserter_stack_size)
            expect(duration.ticks).toBe(1)
        })
    })
})