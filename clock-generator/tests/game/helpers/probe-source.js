// @ts-check
const fs = require("node:fs");
const path = require("node:path");

/** JSON is decoded in Lua; a long-string delimiter is chosen that cannot terminate inside the payload.
 * @param {Record<string, unknown>} value
 */
function luaOptions(value) {
    const json = JSON.stringify(value);
    let equals = "";
    while (json.includes(`]${equals}]`)) equals += "=";
    return `helpers.json_to_table([${equals}[${json}]${equals}])`;
}

/** Compose host-side files into the single chunk accepted by the existing harness/--lua interface.
 * @param {string} scenario Absolute scenario file path.
 * @param {Record<string, unknown>} [options] Explicit scenario parameters; no Lua placeholder replacement.
 */
function composeProbeSource(scenario, options = {}) {
    const modules = [ ["capture", "capture.lua"], ["pickup", "belt-pickup.lua"] ];
    const shared = modules.map(([name, file]) =>
        `local ${name} = (function()\n${fs.readFileSync(path.join(__dirname, "lua", file), "utf8")}\nend)()\n`).join("");
    return `${shared}\nlocal options = ${luaOptions(options)}\n${fs.readFileSync(scenario, "utf8")}\n`;
}

module.exports = { composeProbeSource };
