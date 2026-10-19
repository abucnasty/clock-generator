import zlib from "zlib";
import {FactorioBlueprintFile} from "../../../../src/blueprints/blueprint";
import {encodeBlueprintFile} from "../../../../src/blueprints/serde";

/** Reflect the complete ordinary cell after speed routing/gate setup, putting physical near supply on lane 2. */
export function reflectOrdinaryPickup(text: string): string {
    const decoded = JSON.parse(zlib.inflateSync(Buffer.from(text.trim().slice(1), "base64")).toString()) as FactorioBlueprintFile;
    for (const entity of decoded.blueprint!.entities!) {
        entity.position = {x: entity.position.x, y: 1 - entity.position.y};
        if (!entity.direction) entity.direction = 8;
        else if (entity.direction === 8) entity.direction = 0;
    }
    return encodeBlueprintFile(decoded);
}
