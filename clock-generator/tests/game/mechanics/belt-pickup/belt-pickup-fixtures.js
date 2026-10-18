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

module.exports = { makeInputBeltBackedUp };
