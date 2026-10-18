import assert from "../../../../src/common/assert";
import zlib from "zlib";
import { FactorioBlueprintFile } from "../../../../src/blueprints/blueprint";
import { encodeBlueprintFile } from "../../../../src/blueprints/serde";

/** Stop the electromagnetic fixture's ingredient drain so supply really backs up in the game. */
export function makeInputBeltBackedUp(blueprint: string): string {
    const decoded = JSON.parse(zlib.inflateSync(Buffer.from(blueprint.trim().slice(1), "base64")).toString()) as FactorioBlueprintFile;
    const entities = decoded.blueprint!.entities!;
    const plant = entities.find(entity => String(entity.name) === "electromagnetic-plant");
    assert(plant, "missing electromagnetic plant");
    decoded.blueprint!.entities = entities.filter(entity => !(String(entity.name) === "turbo-loader" && entity.position.y > plant.position.y));
    assert(decoded.blueprint!.entities.length === entities.length - 1, "expected one ingredient drain loader");
    return encodeBlueprintFile(decoded);
}
