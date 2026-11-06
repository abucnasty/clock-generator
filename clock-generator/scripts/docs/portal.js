#!/usr/bin/env node
// Generates clock-generator-sidecar/PORTAL.md, the long description of the sidecar's mod portal page (pasted there by
// hand after a release), from the two user topics on exporting a build. Usage, from clock-generator/:
//   npm run docs:portal              writes PORTAL.md
//   npm run docs:portal -- --check   exit code 1 and a diff when the committed PORTAL.md is not what the topics give (CI)
// The page holds both topics in full, since readers of the portal do not follow links: front matter dropped, each
// heading one level lower, the "Related information" sections dropped and relative links made plain text. Edit the
// topics in docs/user/, never PORTAL.md.
const fs = require("node:fs");
const path = require("node:path");
const { REPO_ROOT, writeOrCheck } = require("./generated-file");

const TOPICS = ["docs/user/export-a-build.md", "docs/user/sidecar-export-contents.md"];
const PORTAL = "clock-generator-sidecar/PORTAL.md";

const HEADER = "Export a Factorio build as text for the **Clock Generator** website: <https://clock-generator-self.vercel.app>";
const FOOTER = "Source and bug reports: <https://github.com/abucnasty/clock-generator>";

/** A link that leaves the page: a scheme (https:, mailto:) */
const isAbsolute = target => /^[a-z][a-z0-9+.-]*:/i.test(target);

/** A topic as a section of the portal page */
function portalSection(file) {
    const text = fs.readFileSync(path.join(REPO_ROOT, file), "utf8").replace(/\r\n/g, "\n");
    const front = text.match(/^---\n[\s\S]*?\n---\n/);
    if (!front) throw new Error(`${file}: no front matter, so it is not an MDITA topic`);
    const out = [];
    let fenced = false;
    let skipping = false;
    for (const line of text.slice(front[0].length).split("\n")) {
        if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
        const heading = !fenced && line.match(/^(#+)\s+(.*)$/);
        if (heading) {
            skipping = heading[2].trim() === "Related information";
            if (skipping) continue;
            out.push(`#${line}`);
            continue;
        }
        if (skipping) continue;
        out.push(fenced ? line : line.replace(/\[([^\]]*)\]\(([^)\s]*)\)/g, (link, label, target) => isAbsolute(target) ? link : label));
    }
    return out.join("\n").trim();
}

const page = [HEADER, ...TOPICS.map(portalSection), FOOTER].join("\n\n") + "\n";
writeOrCheck(PORTAL, page, process.argv.includes("--check"), "npm run docs:portal");
