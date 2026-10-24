/**
 * A list of items with a React key for each, for a list that may name an item more than once (a belt with the same item
 * on both lanes): the item, then which copy of it it is, so each key stays with its item when the list is reordered.
 */
export function keyedItems(items: readonly string[]): { item: string; key: string }[] {
    const copies = new Map<string, number>();
    return items.map(item => {
        const copy = (copies.get(item) ?? 0) + 1;
        copies.set(item, copy);
        return { item, key: copy === 1 ? item : `${item}#${copy}` };
    });
}
