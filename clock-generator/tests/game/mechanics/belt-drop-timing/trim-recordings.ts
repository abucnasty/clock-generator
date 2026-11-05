import fs from "fs";
import path from "path";
import zlib from "zlib";
import {loadFullRecording, RECORDINGS_DIR} from "./recording";
import {trimRecording} from "./summary";

/**
 * Makes the recordings kept in recordings/ from full ones (timing.game.test.ts writes them with DROP_TIMING_CAPTURE_DIR):
 *   node trim-recordings.cjs <directory of the full <run>.json.gz files> [directory to write, default recordings/]
 * See README.md for how to run it.
 */
const [from, to = RECORDINGS_DIR] = process.argv.slice(2);
if (!from) throw new Error("Usage: trim-recordings <directory of full recordings> [output directory]");
fs.mkdirSync(to, {recursive: true});
for (const file of fs.readdirSync(from).filter(name => name.endsWith(".json.gz")).sort()) {
    const trimmed = JSON.stringify(trimRecording(loadFullRecording(path.join(from, file))));
    fs.writeFileSync(path.join(to, file), zlib.gzipSync(trimmed, {level: 9}));
    console.log(file, trimmed.length);
}
