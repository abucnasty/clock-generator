// Shared by the documentation generators in this folder: write a generated file, or with --check compare it with the
// committed one and fail with a diff when they differ (the "Docs checks" job of .github/workflows/test.yml).
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

/** The root of the repository: scripts/docs/ is in clock-generator/ */
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

/**
 * Writes `content` to `file` (a path from the root of the repository), or with `check` compares them: exit code 1 and a
 * unified diff (committed, then generated) when they differ. `command` is what regenerates the file, for the message.
 */
function writeOrCheck(file, content, check, command) {
    const target = path.join(REPO_ROOT, file);
    if (!check) {
        fs.writeFileSync(target, content);
        console.log(`wrote ${file}`);
        return;
    }
    const committed = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
    if (committed === content) {
        console.log(`${file} is current`);
        return;
    }
    const generated = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "docs-check-")), path.basename(file));
    fs.writeFileSync(generated, content);
    const diff = spawnSync("diff", ["-u", "--label", `${file} (committed)`, "--label", `${file} (generated)`,
        committed === null ? "/dev/null" : target, generated], { encoding: "utf8" });
    console.error(`${file} is not what its sources generate${committed === null ? " (it is missing)" : ""}. `
        + `Run \`${command}\` from clock-generator/ and commit the result.\n`);
    console.error(diff.stdout || diff.error?.message || "");
    process.exitCode = 1;
}

module.exports = { REPO_ROOT, writeOrCheck };
