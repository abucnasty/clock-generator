import { neverOverrideEntitiesOf, type NeverOverrideEntity } from 'clock-generator/light';

/** "2", "2 and 5", "2, 5 and 9" */
function numbersText(ids: number[]): string {
    return ids.length <= 1 ? ids.join('') : `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`;
}

/**
 * What the site tells the user when a file, a share link or a saved build held the Never on override, which is removed: each
 * such inserter and mining drill now uses Auto. Null when none did.
 * "Never on is no longer an option: inserters 2 and 5, and mining drill 1 now use Auto."
 */
export function neverOverrideNoteOf(entities: readonly NeverOverrideEntity[]): string | null {
    if (entities.length === 0) return null;
    const idsOf = (type: NeverOverrideEntity['type']) => entities.filter(entity => entity.type === type).map(entity => entity.id);
    const named = (noun: string, ids: number[]) => ids.length === 0 ? [] : [`${ids.length === 1 ? noun : `${noun}s`} ${numbersText(ids)}`];
    const who = [...named('inserter', idsOf('inserter')), ...named('mining drill', idsOf('drill'))].join(', and ');
    return `Never on is no longer an option: ${who} now ${entities.length === 1 ? 'uses' : 'use'} Auto.`;
}

/** The note for a config that is not yet checked (a saved form, an imported file, a share link), before its Never on overrides are read as Auto */
export function neverOverrideNoteOfConfig(config: unknown): string | null {
    return neverOverrideNoteOf(neverOverrideEntitiesOf(config));
}

/** The same for the text of a file or a saved build; null when the text is not JSON */
export function neverOverrideNoteOfText(text: string): string | null {
    try {
        return neverOverrideNoteOfConfig(JSON.parse(text));
    } catch {
        return null;
    }
}

/** A message with the note after it, when there is one */
export function withNeverOverrideNote(message: string, note: string | null): string {
    return note === null ? message : `${message} ${note}`;
}
