#!/usr/bin/env node
// Checks docs/game-labels.tsv, the labels of Factorio itself that the user topics name in bold, against the English
// locale of an installed Factorio 2.1 (data/*/locale/en/*.cfg): each locale key must be in it, with the game string of
// its row. CI has no game, so this runs where one is installed, and skips (exit code 0) where none is. Usage, from
// clock-generator/:
//   npm run docs:game-labels [-- --factorio=<executable or install folder>]
// The game is found as the game tests find it: --factorio, else FACTORIO_PATH (from the environment or clock-generator/.env).
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const LIST = path.join(ROOT, "docs", "game-labels.tsv");

/** FACTORIO_PATH from clock-generator/.env, where the game tests keep it */
function fromDotEnv() {
    const file = path.join(ROOT, "clock-generator", ".env");
    if (!fs.existsSync(file)) return undefined;
    const line = fs.readFileSync(file, "utf8").split("\n").find(each => /^\s*FACTORIO_PATH\s*=/.test(each));
    return line?.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "") || undefined;
}

/** The install folder of a Factorio executable (bin/x64/factorio) or of a folder in it */
function installOf(given) {
    let dir = fs.existsSync(given) && fs.statSync(given).isFile() ? path.dirname(given) : given;
    for (let up = 0; up < 3; up += 1) {
        if (fs.existsSync(path.join(dir, "data", "base", "info.json"))) return dir;
        dir = path.dirname(dir);
    }
    return undefined;
}

/** Every key of the English locale files of the game's data, as section.key, with its string */
function gameLocale(install) {
    const strings = new Map();
    const data = path.join(install, "data");
    for (const mod of fs.readdirSync(data)) {
        const dir = path.join(data, mod, "locale", "en");
        if (!fs.existsSync(dir)) continue;
        for (const file of fs.readdirSync(dir).filter(name => name.endsWith(".cfg"))) {
            let section = "";
            for (const line of fs.readFileSync(path.join(dir, file), "utf8").split(/\r?\n/)) {
                const header = line.match(/^\[([^\]]+)\]\s*$/);
                if (header) section = header[1];
                else if (/^[^;#\s][^=]*=/.test(line)) {
                    strings.set(`${section}.${line.slice(0, line.indexOf("="))}`, { value: line.slice(line.indexOf("=") + 1), at: `${mod}/locale/en/${file}` });
                }
            }
        }
    }
    return strings;
}

const given = process.argv.find(arg => arg.startsWith("--factorio="))?.slice("--factorio=".length) ?? process.env.FACTORIO_PATH ?? fromDotEnv();
const install = given === undefined ? undefined : installOf(path.resolve(given));
if (install === undefined) {
    console.log(`skipped: no Factorio install ${given === undefined ? "named (set FACTORIO_PATH or pass --factorio=<path>)" : `at ${given}`}`);
    process.exit(0);
}
const version = JSON.parse(fs.readFileSync(path.join(install, "data", "base", "info.json"), "utf8")).version;
console.log(`Factorio ${version} at ${install}`);
if (!version.startsWith("2.1.")) {
    console.error(`docs/game-labels.tsv names the labels of Factorio 2.1, not ${version}`);
    process.exit(1);
}

const strings = gameLocale(install);
const rows = fs.readFileSync(LIST, "utf8").split("\n").filter(line => line.trim() !== "" && !line.startsWith("#")).slice(1);
const problems = [];
for (const row of rows) {
    const [label, key, game] = row.split("\t");
    const found = strings.get(key);
    if (found === undefined) problems.push(`${label}: no locale key ${key}`);
    else if (found.value !== game) problems.push(`${label}: ${key} is "${found.value}" in the game (${found.at}), not "${game}"`);
    else console.log(`ok  ${label}  ${key} = "${found.value}" (${found.at})`);
}
if (problems.length > 0) {
    console.error(`\n${problems.length} of ${rows.length} game labels do not match Factorio ${version}:\n${problems.map(problem => `  ${problem}`).join("\n")}`);
    process.exit(1);
}
console.log(`all ${rows.length} game labels match Factorio ${version}`);
