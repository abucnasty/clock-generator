// @ts-check
const zlib = require("node:zlib");

/** Stop the electromagnetic fixture's ingredient drain so supply really backs up in the game.
 * @param {string} text
 */
function makeInputBeltBackedUp(text) {
    /** @type {import("../../../../src/blueprints/blueprint").FactorioBlueprintFile} */
    const decoded = JSON.parse(zlib.inflateSync(Buffer.from(text.trim().slice(1), "base64")).toString());
    const blueprint = decoded.blueprint;
    if (!blueprint?.entities) throw new Error("missing blueprint entities");
    const entities = blueprint.entities;
    const plant = entities.find(entity => String(entity.name) === "electromagnetic-plant");
    if (!plant) throw new Error("missing electromagnetic plant");
    blueprint.entities = entities.filter(entity => !(String(entity.name) === "turbo-loader" && entity.position.y > plant.position.y));
    if (blueprint.entities.length !== entities.length - 1) throw new Error("expected one ingredient drain loader");
    return "0" + zlib.deflateSync(Buffer.from(JSON.stringify(decoded), "utf8")).toString("base64");
}

/** Swap only the four electromagnetic ingredient feeders, preserving geometry and inserter controls.
 * @param {string} text
 */
function swapElectromagneticIngredientFeeds(text) {
    const decoded = JSON.parse(zlib.inflateSync(Buffer.from(text.trim().slice(1), "base64")).toString());
    if (!decoded.blueprint?.entities) throw new Error("missing blueprint entities");
    let changed = 0;
    for (const entity of decoded.blueprint.entities) {
        for (const filter of entity.infinity_settings?.filters ?? []) {
            if (filter.name === "accumulator" || filter.name === "supercapacitor") {
                filter.name = filter.name === "accumulator" ? "supercapacitor" : "accumulator";
                changed++;
            }
        }
    }
    if (changed !== 4) throw new Error("expected four electromagnetic ingredient feeder filters");
    return "0" + zlib.deflateSync(Buffer.from(JSON.stringify(decoded), "utf8")).toString("base64");
}

/** Flip only the cell's input inserter in a front underground fixture.
 * @param {string} text
 * @param {"entrance" | "exit"} [endpoint]
 */
function flipFrontUndergroundInput(text, endpoint = "exit") {
    const decoded = JSON.parse(zlib.inflateSync(Buffer.from(text.trim().slice(1), "base64")).toString());
    /** @type {{name: string, position: {x: number, y: number}, mirror?: boolean}[] | undefined} */
    const entities = decoded.blueprint?.entities;
    if (!entities) throw new Error("missing blueprint entities");
    const plant = entities.find(entity => entity.name === "electromagnetic-plant");
    if (!plant) throw new Error("missing electromagnetic plant");
    const offset = endpoint === "entrance" ? { x: -2.5, y: -0.5 } : { x: -1.5, y: 2.5 };
    const inputs = entities.filter(entity => entity.name === "stack-inserter"
        && entity.position.x === plant.position.x + offset.x && entity.position.y === plant.position.y + offset.y);
    if (inputs.length !== 1) throw new Error("expected one front underground input inserter");
    inputs[0].mirror = !inputs[0].mirror;
    return "0" + zlib.deflateSync(Buffer.from(JSON.stringify(decoded), "utf8")).toString("base64");
}

/** Remove only the ingredient drain in the eastbound front-entrance fixture.
 * Its ingredient belt is above the plant's center, unlike the side-pickup fixtures.
 * @param {string} text
 */
function backUpFrontUndergroundEntrance(text) {
    const decoded = JSON.parse(zlib.inflateSync(Buffer.from(text.trim().slice(1), "base64")).toString());
    /** @type {{name: string, position: {x: number, y: number}, direction?: number, type?: string}[]} */
    const entities = decoded.blueprint?.entities;
    if (!entities) throw new Error("missing blueprint entities");
    const plant = entities.find(entity => entity.name === "electromagnetic-plant");
    if (!plant) throw new Error("missing electromagnetic plant");
    const drains = entities.filter(entity => entity.name === "turbo-loader" && entity.type === "input"
        && entity.direction === 4 && entity.position.y === plant.position.y - 0.5);
    if (drains.length !== 1) throw new Error("expected one front-entrance ingredient drain");
    decoded.blueprint.entities = entities.filter(entity => entity !== drains[0]);
    return "0" + zlib.deflateSync(Buffer.from(JSON.stringify(decoded), "utf8")).toString("base64");
}

/** Feed accumulators on both lanes, retaining all four feeders, geometry and drains.
 * @param {string} text
 */
function useAccumulatorsOnBothLanes(text) {
    const decoded = JSON.parse(zlib.inflateSync(Buffer.from(text.trim().slice(1), "base64")).toString());
    if (!decoded.blueprint?.entities) throw new Error("missing blueprint entities");
    let changed = 0, retained = 0;
    for (const entity of decoded.blueprint.entities) {
        for (const filter of entity.infinity_settings?.filters ?? []) {
            if (filter.name === "supercapacitor") {
                filter.name = "accumulator";
                changed++;
            } else if (filter.name === "accumulator") retained++;
        }
    }
    if (changed !== 2 || retained !== 2) throw new Error("expected two feeders for each electromagnetic ingredient");
    return "0" + zlib.deflateSync(Buffer.from(JSON.stringify(decoded), "utf8")).toString("base64");
}

module.exports = { makeInputBeltBackedUp, swapElectromagneticIngredientFeeds, flipFrontUndergroundInput, backUpFrontUndergroundEntrance, useAccumulatorsOnBothLanes };
