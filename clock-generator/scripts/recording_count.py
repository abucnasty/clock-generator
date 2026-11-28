"""Which record jobs have a game recording of the clock the record selects, started as the generator's default judged start.

For each job of the record (`clock-generator/record/<job>.json`) it lists the game recordings that the controls files
(`tests/game/builds/*-controls.json`) pin at the job's selected clock, and says what each lacks of a recording that
counts. A recording counts ("holds from ruling 60's start") when it:
  - is at the job's selected clock hash;
  - starts from ruling 60's start (the backpressure start: every entity that needs no clocked entity is full, the clock
    starts at the first tick its lock is off): `start: "backpressure"` in the missing-recordings fixtures, or
    `staged: true, backpressure: true` in the code that builds a family's scenario (the pickup speed coverage); in the
    other fixtures `staged: true` is a plain staged start, which is not the judged start, and the rest is a free warm-up;
  - builds at least the job's copies, so every copy is judged;
  - ran at least one loss;
  - holds: the stored run holds its baseline and recovers from every loss (`runHolds`, a stock-guard waiver honoured).
A scaffold pin (`scaffold-recordings-clock-pins.json`) stores no result, so it never counts. The picks of the search from
every stable clock (`filled-start-search-clock-controls.json`) are other picks than the record's and are left out.

Reads only the repository's files at one commit (git show and git ls-tree), no game and no simulator. The repository is
the one this file is in. Run it twice and the output is the same: nothing here depends on the clock, the host or the order
of a directory.

Usage, from anywhere (the output file is written, the summary is printed):
    python3 -I clock-generator/scripts/recording_count.py <commit> <out.md>
To count a branch's tip, name its commit: `python3 -I clock-generator/scripts/recording_count.py $(git rev-parse HEAD) count.md`.
The job table of the output (status and what is missing per job) is what to compare between two commits.
"""
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
CG = "clock-generator/"
BUILDS = CG + "tests/game/builds/"
RECORD = CG + "record/"

STATUS_HOLDS = "holds from ruling 60's start"
STATUS_PARTIAL = "recorded but not from ruling 60's start or not per copy"
STATUS_PIN = "only a scaffold pin (no stored result)"
STATUS_OTHER = "recorded at another clock"
STATUS_NONE = "none"
STATUS_UNKNOWN = "start not known"
STATUSES = [STATUS_HOLDS, STATUS_PARTIAL, STATUS_PIN, STATUS_UNKNOWN, STATUS_OTHER, STATUS_NONE]

SEARCH_FILE = "filled-start-search-clock-controls.json"  # the picks of the search from every stable clock: other picks than the record's, never counted
MISSING_FILE = "missing-recordings-clock-controls.json"
MISSING_FIXTURES = "missing-recordings-clock-fixtures.ts"

# Copies of the build a recorded case holds, where a case builds more than one copy and its fixtures say so outside the missing-recordings
# fixtures (those state `copies` for each case, read by missing_cases): the full grenade build and the three copies of the inserter crafting
# build. Any other case is one copy.
CASE_COPIES = {
    ("grenade-clock-controls.json", "hand-made-full-build"): 7,
    ("grenade-clock-controls.json", "generated-full-build"): 7,
    ("inserter-crafting-240-shared-signal-clock-controls.json", "hand-made-clock-three-copies"): 3,
    ("inserter-crafting-240-shared-signal-clock-controls.json", "generated-three-copies"): 3,
}

# Controls file stem (before "-clock-controls") to the config it records, where the name does not start the config's.
STEM_CONFIG = {"electromagnetic-science-330-drained-end": "ELECTROMAGNETIC_SCIENCE_330"}

# Fixture families: record group, to the controls file and the strip that turns a job's name into the case's name.
FIXTURE_FILES = {
    "pickup": ("pickup-clock-controls.json", ""),
    "overhood": ("over-hood-clock-controls.json", ""),
    "front": ("front-clock-controls.json", ""),
    "blocked": ("blocked-output-clock-controls.json", ""),
    "containers": ("container-clock-controls.json", ""),
}


def git(*args, repo=None):
    return subprocess.run(["git", "-C", repo or HERE, *args], check=True, capture_output=True, text=True).stdout


class Repo:
    def __init__(self, commit):
        self.commit = git("rev-parse", "--verify", commit + "^{commit}").strip()
        self._cache = {}

    def show(self, path):
        if path not in self._cache:
            self._cache[path] = git("show", f"{self.commit}:{path}")
        return self._cache[path]

    def json(self, path):
        return json.loads(self.show(path))

    def ls(self, directory):
        return [line for line in git("ls-tree", "--full-tree", "--name-only", self.commit, directory).split("\n") if line]


def code_only(text):
    """The text of a source file without whole-line comments"""
    return "\n".join(line for line in text.split("\n") if not re.match(r"\s*(//|/\*|\*)", line))


def run_holds(native, known):
    """helpers/run-judgement.js runHolds, with clock-controls.ts' known stock-guard waiver"""
    if native.get("protocol") != "trailing-minute":
        return None
    stock = native.get("stock")
    if known and known.get("stock_guard"):
        stock = None
    return (native.get("result") == "holds" and (native.get("baseline") or {}).get("meets") is True
            and all(d.get("recovered") is not None for d in native.get("disturbances", []))
            and (stock is None or stock.get("holds") is True))


def versions_of(text):
    return sorted(set(re.findall(r"Factorio (2\.\d+\.\d+)", text)))


def start_of_controls(repo, name, sources):
    """How the game tests of a controls file start the recording, read from their code: (start, evidence files)"""
    texts = {f: repo.show(BUILDS + f) for f in sources}
    # the files that run a scenario through the capture (a fixture that only imports its helpers or types does not)
    imported = {f for f, t in texts.items() if "capturePickupClockScenario" in code_only(t)}
    chain = set(texts)
    # a game test of the family imports the fixtures that name the controls file: add the game tests and what they import
    for f in repo.ls(BUILDS):
        base = os.path.basename(f)
        if base.endswith(".game.test.ts"):
            t = repo.show(f)
            if any("./" + os.path.splitext(s)[0] in t for s in sources) or base in sources:
                chain.add(base)
                texts[base] = t
                if "capturePickupClockScenario" in code_only(t):
                    imported.add(base)
    if imported:
        # a game test that runs the capture protocol records by pickup-clock-capture.ts alone: its start is that file's
        # the capture holds both starts (the scenario's `staged`, `backpressure`): the start is per case, read from the fixtures
        return "capture", ["pickup-clock-capture.ts"]
    staged = sorted(f for f in chain if "staged_start" in code_only(texts[f]))
    # a staged start runs no warm-up (`warmup_ticks: 0`): only a warm-up of ticks is a free warm-up
    free = sorted(f for f in chain if re.search(r"warmup_ticks:\s*[1-9]\d*", code_only(texts[f])))
    if staged and not free:
        # `staged_start: {backpressure: ...}` is ruling 60's start, `staged_start: {...}` another staged start
        return ("backpressure" if any(re.search(r"staged_start:\s*\{\s*backpressure\b", code_only(texts[f])) for f in staged) else "staged"), staged
    if free and not staged:
        return "free warm-up", free
    return None, sorted(chain)


def staged_case_names(repo, sources):
    """The start of a family's fixtures, read from their text: (case name -> "staged" or "backpressure", the start of every case of a file whose scenario sets `staged: true, backpressure: true` itself)

    A case literal (`{name: "...", ..., staged: true}`) marks that case a plain staged start, and one that also says `backpressure: true` ruling 60's start (the family's scenario passes both on).
    A fixtures file whose scenario function says `staged: true, backpressure: true` on a line of its own starts every case it builds that way (cases named by a template, like the over-the-hood ones)."""
    names = {}
    family = None
    for b in sources:
        text = code_only(repo.show(BUILDS + b))
        for m in re.finditer(r'\{name: "([^"]+)"[^{}]*\}', text):
            if re.search(r"\bstaged: true\b", m.group(0)):
                names[m.group(1)] = "backpressure" if re.search(r"\bbackpressure: true\b", m.group(0)) else "staged"
        if re.search(r"^\s+staged: true, backpressure: true,\s*$", text, re.M):
            family = "backpressure"
    return names, family


def capture_scenario_start(repo, sources):
    """The start every case of a family gets from the file that builds its capture scenario (not a fixtures file with a literal per case):
    `staged: true, backpressure: true` in its code is ruling 60's start (the pickup speed coverage); None where no source says so"""
    for b in sources:
        if b.endswith(".test.ts") or b == "pickup-clock-capture.ts":
            continue
        if re.search(r"\bstaged: true, backpressure: true\b", code_only(repo.show(BUILDS + b))):
            return "backpressure"
    return None


def missing_cases(repo):
    """The missing-recordings fixtures: case name to (copies the scaffold holds, ruling 60's start asked)"""
    text = code_only(repo.show(BUILDS + MISSING_FIXTURES))
    region = text.split("export const MISSING_RECORDING_CASES", 1)[1]
    out = {}
    for block in re.split(r"\n    \{\n", region)[1:]:
        m = re.search(r'name: "([^"]+)"', block)
        c = re.search(r"\bcopies: ([\d.]+),", block)
        out[m.group(1)] = (float(c.group(1)), re.search(r'^\s+(?:from_every_start: true, )?start: "backpressure"', block, re.M) is not None
                           and "from_every_start: true" not in block)
    return out


def main(commit, out_path):
    repo = Repo(commit)
    # ------------------------------------------------------------------ the record
    jobs = {}
    for f in repo.ls(RECORD):
        base = os.path.basename(f)
        if not base.endswith(".json"):
            continue
        job = repo.json(f)
        jobs[job["job"]] = job
    config_paths = {}
    for m in re.finditer(r"^\s+(\w+): path\.join\(CONFIG_SAMPLES_DIR, ([^)]*)\)", repo.show(CG + "src/config/config-paths.ts"), re.M):
        config_paths[m.group(1)] = CG + "resources/config-samples/" + "/".join(re.findall(r"'([^']+)'", m.group(2)))
    names = sorted(config_paths, key=len, reverse=True)

    def config_of(job):
        if job["group"] == "config":
            return job["name"] if job["name"] in config_paths else None
        if job["group"] == "variants":
            return next((n for n in names if job["name"] == n or job["name"].startswith(n + "_")), None)
        return None

    def copies_of(job):
        name = config_of(job)
        if name is None:
            return 1.0
        return float(repo.json(config_paths[name])["setpoint"].get("copies", 1))

    # ------------------------------------------------------------------ recordings
    recs = []  # one dict each

    def add(**r):
        r.setdefault("hashes", [])
        r.setdefault("config", None)
        r.setdefault("job_link", None)
        recs.append(r)

    builds_files = [os.path.basename(f) for f in repo.ls(BUILDS)]
    controls_files = [f for f in builds_files if f.endswith("-controls.json")]
    history_without_hash = 0
    history_with_hash = 0
    for f in controls_files:
        data = repo.json(BUILDS + f)
        if f == "scaffold-recordings-clock-pins.json" or f == "lane-phase-controls.json" or f == SEARCH_FILE:
            continue
        if f == "pickup-clock-start-controls.json":
            continue
        if f.endswith("history-controls.json"):
            for case, entries in data["cases"].items():
                for e in entries:
                    h = (e.get("recorded") or {}).get("clock_sha256")
                    if h is None:
                        history_without_hash += 1
                    else:
                        history_with_hash += 1
            continue
        stem = f[: -len("-clock-controls.json")] if f.endswith("-clock-controls.json") else f[: -len("-controls.json")]
        sources = [b for b in builds_files if b.endswith(".ts") and not b.endswith(".test.ts") and f in repo.show(BUILDS + b)]
        start_file, evidence = start_of_controls(repo, f, sources)
        staged_names, staged_family = staged_case_names(repo, [b for b in sources if b.endswith("-fixtures.ts")])
        scenario_start = capture_scenario_start(repo, [b for b in sources if not b.endswith("-fixtures.ts")])
        missing = missing_cases(repo) if f == MISSING_FILE else {}
        file_versions = versions_of(data["meaning"])
        for case in sorted(data["cases"]):
            e = data["cases"][case]
            copies = float(CASE_COPIES.get((f, case), 1))
            if f == MISSING_FILE:
                copies, backpressure = missing[case]
                start = "backpressure" if backpressure else "staged"
            elif start_file == "capture":
                start = staged_names.get(case, staged_family or scenario_start or "free warm-up")
            else:
                start = start_file
            hashes = sorted({h for h in [(e.get("recorded") or {}).get("clock_sha256"), (e.get("generation") or {}).get("clock_sha256")] if h})
            native = e["native"]
            capture = (e.get("recorded") or {}).get("capture")
            version = capture["game_version"] if capture else None
            add(file=f, case=case, hashes=hashes, kind="controls", start=start, start_evidence=evidence,
                version=version, file_versions=file_versions, copies=copies,
                losses=[d["kind"] for d in native.get("disturbances", [])], holds=run_holds(native, e.get("known_differences")),
                result=native.get("result"), stem=stem, ties=(e.get("known_differences") or {}))

    # the clocked cold starts: staged start, no loss run
    start_data = repo.json(BUILDS + "pickup-clock-start-controls.json")
    start_text_sources = ["pickup-clock-cold-start.game.test.ts"]
    cold_code = code_only(repo.show(BUILDS + start_text_sources[0]))
    cold_staged = "staged_start" in cold_code
    for run_name in sorted(start_data["cold_start"]["runs"]):
        run = start_data["cold_start"]["runs"][run_name]
        clock = start_data["cold_start"]["clocks"][run["clock"]]
        add(file="pickup-clock-start-controls.json", case=run_name, hashes=[clock["clock_sha256"]], kind="cold start",
            start="staged" if cold_staged else None, start_evidence=start_text_sources, version=None,
            file_versions=versions_of(start_data["meaning"]), copies=1.0, losses=[], holds=run.get("steady") is not None,
            result=f"reaches steady state at tick {run.get('steady')}", stem=None, ties={})

    # the scaffold pins
    pins = repo.json(BUILDS + "scaffold-recordings-clock-pins.json")
    scaffold_text = repo.show(BUILDS + "scaffold-recordings.game.test.ts")
    region = scaffold_text.split("const BUILDS: Record<string, ScaffoldBuild> = {", 1)[1].split("\n};", 1)[0]
    blocks, pending, current, depth_name = {}, [], None, None
    for line in region.split("\n"):
        m = re.match(r'^    "([^"]+)": \{$', line)
        if current is None:
            if m:
                current = {"name": m.group(1), "comments": pending, "body": []}
                pending = []
            elif re.match(r"\s*//", line):
                pending.append(line)
            else:
                pending = []
        else:
            if line == "    },":
                blocks[current["name"]] = current
                current = None
            else:
                current["body"].append(line)
    pin_versions = versions_of(pins["meaning"])
    for case in sorted(pins["cases"]):
        pin = pins["cases"][case]
        block = blocks[case]
        body = "\n".join(block["body"])
        text = "\n".join(block["comments"]) + "\n" + body
        copies_match = re.search(r"^\s+copies: ([\d.]+),", body, re.M)
        staged = re.search(r"^\s+staged_start: \{", body, re.M) is not None
        add(file="scaffold-recordings-clock-pins.json", case=case, hashes=[pin["clock_sha256"]], kind="scaffold pin",
            start="staged" if staged else "free warm-up", start_evidence=["scaffold-recordings.game.test.ts"],
            version=(versions_of(text) or [None])[-1] if len(versions_of(text)) == 1 else None,
            file_versions=pin_versions, copies=float(copies_match.group(1)) if copies_match else 1.0, losses=[],
            holds=None, result="asserted by the test in every window cycle (no stored result)", stem=None,
            config=pin["config"], ties={})

    # ------------------------------------------------------------------ per job
    rows = []
    by_hash = {}
    for r in recs:
        for h in r["hashes"]:
            by_hash.setdefault(h, []).append(r)

    def linked(job):
        """Recordings the files tie to the job by name, whatever clock they are on"""
        out = []
        config = config_of(job)
        for r in recs:
            if r["kind"] == "controls":
                if job["group"] in FIXTURE_FILES:
                    if r["file"] == FIXTURE_FILES[job["group"]][0] and job["name"].endswith(r["case"].replace("front-", "", 1) if job["group"] == "front" else r["case"]):
                        out.append(r)
                elif config and r["stem"]:
                    n = config.lower().replace("_", "-")
                    if STEM_CONFIG.get(r["stem"]) == config or (r["stem"] not in STEM_CONFIG and n.startswith(r["stem"])):
                        out.append(r)
            elif r["kind"] == "scaffold pin" and config and r["config"] == config:
                if job["group"] == "variants" or job["group"] == "config":
                    out.append(r)
        return out

    for jid in sorted(jobs):
        job = jobs[jid]
        if "error" in job:
            rows.append({"job": jid, "error": job["error"], "status": STATUS_NONE})
            continue
        sel = next(a for a in job["alternatives"] if a["id"] == job["selected"])
        n_copies = copies_of(job)
        hit = by_hash.get(sel["clock_sha256"], [])
        links = linked(job)
        for_job = []
        for r in hit:
            own = r in links
            ok_start = r["start"] == "backpressure"
            per_copy = r["copies"] >= n_copies
            ran_losses = len(r["losses"]) > 0
            holds = r["holds"]
            judged = bool(r["kind"] != "scaffold pin" and ok_start and per_copy and ran_losses and holds is True)
            gaps = []
            if r["start"] is None:
                gaps.append("start not known")
            elif not ok_start:
                gaps.append(r["start"] if r["start"] == "free warm-up" else "plain staged start, not ruling 60's")
            if not per_copy:
                gaps.append(f"{r['copies']:g} of {n_copies:g} copies built")
            if not ran_losses:
                gaps.append("no loss run")
            if holds is False:
                gaps.append(f"short: {r['result']}")
            for_job.append({"rec": r, "own": own, "judged": judged, "gaps": gaps})
        if any(x["judged"] for x in for_job):
            status = STATUS_HOLDS
        elif for_job and all(x["rec"]["kind"] == "scaffold pin" for x in for_job):
            status = STATUS_PIN
        elif for_job:
            status = STATUS_UNKNOWN if any(x["rec"]["start"] is None for x in for_job) and not any(x["rec"]["start"] for x in for_job) else STATUS_PARTIAL
        elif links:
            status = STATUS_OTHER
        else:
            status = STATUS_NONE
        # a recording at the hash with the fewest gaps names the reason
        reason = ""
        if status in (STATUS_PARTIAL, STATUS_UNKNOWN, STATUS_PIN):
            parts = []
            for label, pick in (("ruling 60's start", lambda x: x["rec"]["start"] == "backpressure"), ("other start", lambda x: x["rec"]["start"] != "backpressure")):
                group = [x for x in for_job if pick(x)]
                if group:
                    best = min(group, key=lambda x: (len(x["gaps"]), x["rec"]["file"], x["rec"]["case"]))
                    parts.append(f"{label}: " + (", ".join(best["gaps"]) or "none missing"))
            reason = "; ".join(parts)
        elif status == STATUS_OTHER:
            named = sorted({r["file"] for r in links})
            reason = f"no file pins {sel['clock_sha256'][:8]}; the build is named in " + ", ".join(named)
        rows.append({"job": jid, "group": job["group"], "selected": sel["id"], "verdict": sel["verdict"], "holds_sim": sel["holds"],
                     "hash": sel["clock_sha256"], "copies": n_copies, "status": status, "reason": reason, "recs": for_job, "links": links})

    # ------------------------------------------------------------------ output
    counts = {s: sum(1 for r in rows if r["status"] == s) for s in STATUSES}
    reasons = {}
    for r in rows:
        if r["status"] in (STATUS_PARTIAL, STATUS_PIN):
            reasons[r["reason"]] = reasons.get(r["reason"], 0) + 1
    out = []
    w = out.append
    w("# Which record jobs have a game recording of today's pick")
    w("")
    w(f"Commit `{repo.commit}`. Generated by `recording_count.py`; reads only files of that commit. {len(rows)} record jobs.")
    w("")
    w("## Counts by status")
    w("")
    w("| Status | Jobs |")
    w("|---|---|")
    for s in STATUSES:
        w(f"| {s} | {counts[s]} |")
    w(f"| all | {len(rows)} |")
    w("")
    w("Status rules (only ruling 60's start, the backpressure start, is the judged start; a plain staged start is not). "
      "A recording counts when a file pins the job's selected clock hash. It is 'holds from ruling 60's start' when one such recording starts from the backpressure start, "
      "builds at least the job's copies (so every copy is judged), ran at least one loss, and holds (`runHolds` over the stored run, a stock-guard waiver honoured). "
      "'recorded but not ...' is every other controls-file recording at the hash: the reason column names what is missing. "
      "'only a scaffold pin': the job's only recordings at the hash are scaffold pins, which store no result (the test asserts the pin in every window cycle), so none can count as held. "
      "'recorded at another clock': a file names the job's build but no file pins the selected hash. 'none': no file names the job. "
      "'start not known': the start of the only recordings cannot be read. "
      "The cases of `filled-start-search-clock-controls.json` (the picks of the search from every stable clock) are other picks than the record's and are left out. "
      "The start is read per case: the missing-recordings fixtures say `start: \"backpressure\"` or not; in the other fixtures `staged: true` is a plain staged start and the rest a free warm-up; `backpressure` is set only by the search cases.")
    w("")
    w("What the partial recordings lack (best recording of each job):")
    w("")
    w("| Reason | Jobs |")
    w("|---|---|")
    for reason in sorted(reasons, key=lambda k: (-reasons[k], k)):
        w(f"| {reason} | {reasons[reason]} |")
    w("")
    w(f"## The {len(rows)} jobs")
    w("")
    w("| Job | Selected | Verdict | Hash | Copies | Recordings at hash | Status | What is missing |")
    w("|---|---|---|---|---|---|---|---|")
    for r in rows:
        if "error" in r:
            w(f"| {r['job']} | error | | | | 0 | {r['status']} | config failed to generate |")
            continue
        w(f"| {r['job']} | {r['selected']} | {r['verdict']}{'' if r['holds_sim'] else ' (below target)'} | {r['hash'][:8]} | {r['copies']:g} | {len(r['recs'])} | {r['status']} | {r['reason']} |")
    w("")
    w("## Recordings per job")
    w("")
    w("Each line: file, case, Factorio version, start, copies built, losses run, result. `own` marks a case the files tie to the job by name; "
      "the others share its clock hash only.")
    w("")
    for r in rows:
        if "error" in r or not r["recs"]:
            continue
        w(f"- **{r['job']}** ({r['hash'][:8]}, {r['status']})")
        def describe(rec):
            version = rec["version"] or ("one of " + "/".join(rec["file_versions"]) + " (file text, not per case)" if len(rec["file_versions"]) > 1 else (rec["file_versions"][0] + " (file text)" if rec["file_versions"] else "not in the files"))
            losses = ", ".join(rec["losses"]) if rec["losses"] else "none"
            return f"{rec['start'] or 'start not known'}; {version}; {rec['copies']:g} copies; losses: {losses}; {rec['result']}"
        own = [x for x in r["recs"] if x["own"]]
        rest = [x for x in r["recs"] if not x["own"]]
        for x in sorted(own, key=lambda x: (x["rec"]["file"], x["rec"]["case"])):
            w(f"  - {x['rec']['file']}:{x['rec']['case']} (own); {describe(x['rec'])}")
        groups = {}
        for x in rest:
            groups.setdefault((x["rec"]["file"], describe(x["rec"])), []).append(x["rec"]["case"])
        for (file, text), cases in sorted(groups.items()):
            w(f"  - {file}: {len(cases)} other case{'s' if len(cases) > 1 else ''} at this hash ({', '.join(sorted(cases)) if len(cases) <= 2 else sorted(cases)[0] + ', ...'}); {text}")
    w("")
    w("## Not read")
    w("")
    w(f"- History controls: {history_with_hash} entries with a clock hash, {history_without_hash} without one (they cannot be tied to a job).")
    w("- ELECTROMAGNETIC_SCIENCE_240_RECYCLER_BELT_FED keeps its cold runs in its game test's own constants, with no clock hash in a file: counted by name only if a controls file names it.")
    w("- The record's config of a variant with no named config (STEEL_HUB_26_CONTAINER_OUTPUT) is taken as one copy.")
    text = "\n".join(out) + "\n"
    with open(out_path, "w") as fh:
        fh.write(text)
    print("\n".join(out[: out.index(f"## The {len(rows)} jobs")]))
    print(f"written: {out_path} ({len(text)} bytes)")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
