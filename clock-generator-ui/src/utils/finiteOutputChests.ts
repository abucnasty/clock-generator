import { isBufferChest, type ChestFormData, type InserterFormData } from './configForm/formData';

/** A finite sink with no modelled drain eventually backs up, unlike a buffer between stages. */
export function finiteOutputChests(chests: ChestFormData[], inserters: InserterFormData[]) {
    const receives = new Set(inserters.filter(inserter => inserter.sink.type === 'chest').map(inserter => inserter.sink.id));
    const supplies = new Set(inserters.filter(inserter => inserter.source.type === 'chest').map(inserter => inserter.source.id));
    return chests.flatMap((chest, index) => isBufferChest(chest) && receives.has(chest.id) && !supplies.has(chest.id)
        ? [{ chest, index }] : []);
}
