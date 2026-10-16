import { searchIds } from './gameNames';

/** Keep matches in their groups; MUI groupBy requires each group's options to be contiguous. */
export function prioritizedIds(query: string, priority: string[], all: string[], label: (id: string) => string, priorityLabel = 'From source') {
    const first = [...new Set(priority)];
    const prioritySet = new Set(first);
    const rest = [...new Set(all)].filter(id => !prioritySet.has(id));
    return {
        ids: [...searchIds(query, first, label), ...searchIds(query, rest, label)],
        groupOf: (id: string) => prioritySet.has(id) ? priorityLabel : 'All items',
    };
}
