import { describe, expect, it } from 'vitest';
import { ChestType } from 'clock-generator/light';
import { chestLabel, entityLabel, entityLabelIn, type LabelKind } from './entityLabel';

describe('entityLabel', () => {
    it('names an entity by its kind and id, with no #', () => {
        expect(entityLabel('inserter', 3)).toBe('Inserter 3');
        const kinds: LabelKind[] = ['machine', 'inserter', 'belt', 'chest', 'drill'];
        expect(kinds.map((kind) => entityLabel(kind, 2))).toEqual(['Machine 2', 'Inserter 2', 'Belt 2', 'Chest 2', 'Drill 2']);
        expect(kinds.some((kind) => entityLabel(kind, 12).includes('#'))).toBe(false);
    });
});

describe('chestLabel', () => {
    it('names a car, a tank, a cargo wagon or a rocket silo by what it is, and a buffer or infinity chest a chest', () => {
        expect(chestLabel({ id: 1, type: ChestType.CAR })).toBe('Car 1');
        expect(chestLabel({ id: 2, type: ChestType.CARGO_WAGON })).toBe('Cargo wagon 2');
        expect(chestLabel({ id: 3, type: ChestType.ROCKET_SILO })).toBe('Rocket silo 3');
        expect(chestLabel({ id: 4, type: ChestType.TANK })).toBe('Tank 4');
        expect(chestLabel({ id: 5, type: ChestType.BUFFER_CHEST })).toBe('Chest 5');
        expect(chestLabel({ id: 6, type: ChestType.INFINITY_CHEST })).toBe('Chest 6');
    });

    it('finds the chest of an id in the build, and names any other entity by its kind', () => {
        const chests = [{ id: 1, type: ChestType.CAR }, { id: 2, type: ChestType.INFINITY_CHEST }];
        expect(entityLabelIn(chests, 'chest', 1)).toBe('Car 1');
        expect(entityLabelIn(chests, 'chest', 2)).toBe('Chest 2');
        expect(entityLabelIn(chests, 'chest', 9)).toBe('Chest 9');
        expect(entityLabelIn(chests, 'machine', 1)).toBe('Machine 1');
    });
});
