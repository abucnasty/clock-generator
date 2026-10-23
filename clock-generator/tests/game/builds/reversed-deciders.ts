/** The clock's deciders built in the mirror order: each decider's conditions move to the mirror slot (the game updates the last built first) */
export function reversedDeciders<B extends {entities: any[]}, S extends {inserter_combinators: {entity_number: number; inserter_ids: number[]}[]}>(blueprint: B, schedule: S) {
    const permuted: B = JSON.parse(JSON.stringify(blueprint));
    const slots = schedule.inserter_combinators.map(it => it.entity_number);
    const byNumber = new Map<number, any>(permuted.entities.map(entity => [entity.entity_number, entity]));
    const contents = slots.map(number => { const {entity_number: _, position: __, ...rest} = byNumber.get(number); return rest; });
    slots.forEach((number, k) => {
        const entity = byNumber.get(number);
        for (const key of Object.keys(entity)) if (key !== "entity_number" && key !== "position") delete entity[key];
        Object.assign(entity, JSON.parse(JSON.stringify(contents[slots.length - 1 - k])));
    });
    return {blueprint: permuted, schedule: {...schedule, inserter_combinators: slots.map((entity_number, k) =>
        ({entity_number, inserter_ids: schedule.inserter_combinators[slots.length - 1 - k].inserter_ids}))}};
}
