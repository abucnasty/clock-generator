import path from "path";

export const ENGINE_ROOT = path.resolve(__dirname, "../../..");
export const REPOSITORY_ROOT = path.dirname(ENGINE_ROOT);
export const SAMPLE_BUILDS_DIR = path.join(ENGINE_ROOT, "resources/config-samples");
const PICKUP = path.join(ENGINE_ROOT, "tests/game/mechanics/belt-pickup/fixtures");

/** Mechanic fixtures are deliberately separate from ConfigPaths and ordinary sample sweeps. */
export const GameFixturePaths = {
    SAME_ITEM: path.join(PICKUP, "same-item"),
    SAME_ITEM_CONFIG: path.join(PICKUP, "same-item/config.json"),
    SAME_ITEM_STRAIGHT_CONFIG: path.join(PICKUP, "same-item/straight-belt.json"),
    DIFFERENT_ITEMS: path.join(PICKUP, "different-items"),
    DIFFERENT_ITEMS_CONFIG: path.join(PICKUP, "different-items/config.json"),
    FRONT_UNDERGROUND_ENTRANCE: path.join(PICKUP, "front-underground-entrance"),
    FRONT_UNDERGROUND_ENTRANCE_SAME_ITEM_CONFIG: path.join(PICKUP, "front-underground-entrance/same-item-moving.json"),
    SIDE_LOADED_STRAIGHT: path.join(PICKUP, "side-loaded-straight"),
    FRONT_UNDERGROUND_EXIT: path.join(PICKUP, "front-underground-exit"),
    TURBO_BELT_DROP: path.join(ENGINE_ROOT, "tests/game/mechanics/belt-drop/fixtures/turbo-stacks"),
    SPLITTER: path.join(PICKUP, "splitter"),
    SPLITTER_TWO_INSERTERS: path.join(PICKUP, "splitter-two-inserters"),
};
