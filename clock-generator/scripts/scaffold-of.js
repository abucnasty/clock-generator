// The scaffold beside a sample config: the config's file name with `.scaffold` for `.json`. A config with no scaffold of its
// own uses the one whose stem is the longest prefix of its own at a hyphen (advanced-circuit-230.json uses
// advanced-circuit.scaffold). Returns the first path that exists, else the config's own name with `.scaffold`.
const path = require("path"), fs = require("fs");

function scaffoldOf(configPath) {
    const folder = path.dirname(configPath);
    let stem = path.basename(configPath).replace(/\.json$/, "");
    const own = path.join(folder, `${stem}.scaffold`);
    for (;;) {
        const found = path.join(folder, `${stem}.scaffold`);
        if (fs.existsSync(found)) return found;
        const cut = stem.lastIndexOf("-");
        if (cut <= 0) return own;
        stem = stem.slice(0, cut);
    }
}

module.exports = { scaffoldOf };
