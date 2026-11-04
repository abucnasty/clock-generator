#!/usr/bin/env python3
"""
run-suite.py [options] [file filter ...]

The whole local game suite (vitest.game.config.ts) as case-level jobs on every Factorio lane the guard allows.

Vitest runs the cases of a file one after another, so a big file is one long job while the other lanes sit idle. This
lists the suite's cases (`vitest list --json`), cuts them into jobs, orders the jobs longest first by the last known
duration of each case, and runs them on as many lanes as the guard's policy allows (machine.factorio_max, or -j). One
combined result at the end: passed / failed / skipped / no result per case, and the exit code.

Jobs. A case taking at least --chunk-seconds (default 120) is a job of its own; shorter cases of the same file are packed
into jobs of about that many seconds (a job is `vitest run <file> -t '^(case|case|...)$'`, one Factorio at a time), so
the many 1 to 5 second probes do not each pay vitest's start-up. Cases are cut freely: every case of this suite starts
its own game (`recordInFactorio`), or opens a CachedHarnessSession inside the one case that needs it (the staged-start
tests), so no recording key or result depends on a neighbouring case. The one place cases share a game, the watched
scaffold-recordings session (FACTORIO_HARNESS_WATCH), is not run here: this runner never watches. A file or a group of
cases that must stay in one job goes into KEEP_TOGETHER below.

Recording cache (tests/game/README.md). tests/game/mechanics always runs with CLOCK_RECORDING_CACHE=on: a probe records
again only when the game binary changes (the binary's hash is in the key). --cache on|off|refresh (default on) applies
to tests/game/builds only; a cold pass over the suite is `--cache off`, a refresh `--cache refresh`.

Every job goes through the guard (PROCESS.md section 1) when it is found (--guard-dir, $GUARD_DIR, or
/home/abucnasty/dev/factorio-work/tools/guard); without it jobs start directly, -j lanes at once (default 2). The
environment a job needs (FACTORIO_PATH, FACTORIO_HARNESS_SAVE, CLOCK_RECORDING_CACHE_DIR) is passed on the command line,
because the guard's systemd unit does not inherit yours; the rest comes from clock-generator/.env as for any game test.

  file filter        only cases of the test files whose path contains one of these (e.g. car-clock, tests/game/mechanics/drills)
  -o, --out DIR      a new folder for the run (default .scratch/game-suite/<time>): list.json, jobs.tsv, json/ (vitest's
                     report per job), logs/, guard/, events/ (cache hits and misses), results.tsv, results.json,
                     durations.json (seconds per case seen in this run), lanes.log
  -j, --lanes N      lanes at once (default: machine.factorio_max of the guard policy)
  --cache MODE       on (default) | off | refresh, for tests/game/builds only
  --chunk-seconds S  job size, see above (default 120)
  --durations FILE   last known seconds per case (default scripts/game/case-seconds.json: a cold pass, 2026-11-02, Factorio 2.1.24)
  --calibrate        tests/game/builds record their runs' summaries without comparing them with the controls files
                     (BELT_CLOCK_CALIBRATE=1, ORE_VOIDER_CALIBRATE=1), each job into its own capture/<job>/ under the run's
                     folder (BELT_SPEED_CAPTURE_DIR, ORE_VOIDER_CAPTURE_DIR and the recyclers' capture folders): the pass that
                     records a protocol change, whose summaries are then written into the controls
  --plan             print the jobs and an estimate of the wall time, run nothing
  --owner NAME       the guard's owner label (default game-suite)
"""
import argparse
import json
import os
import re
import shlex
import subprocess
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]  # clock-generator/
DEFAULT_GUARD_DIR = "/home/abucnasty/dev/factorio-work/tools/guard"
DEFAULT_DURATIONS = Path(__file__).resolve().parent / "case-seconds.json"
# per job: vitest start-up, the guard's unit, loading the game data (measured about 8 s on a warm job)
JOB_OVERHEAD_SECONDS = 8
UNKNOWN_CASE_SECONDS = 1.0
MAX_CASES_PER_JOB = 40
# test files whose cases must run in one job: file path (from clock-generator/) -> regex over the case's full name that
# picks the group (cases with the same match stay together; None keeps the whole file). None today, see the docstring.
KEEP_TOGETHER: dict[str, str | None] = {}

# environment the guarded command gets from the runner's own environment, when set
PASS_ENV = ["FACTORIO_PATH", "FACTORIO_HARNESS_SAVE", "CLOCK_RECORDING_CACHE_DIR"]
# environment that would change what a case does or where it writes: cleared for every job
CLEAR_ENV = ["FACTORIO_HARNESS_WATCH", "CLOCK_PROOF_PHASES", "BELT_CLOCK_GENERATION_DIR", "BELT_CLOCK_GENERATION_ONLY",
             "BELT_CLOCK_REPLAY_DIR", "BELT_CLOCK_EXPECTATIONS", "BELT_CLOCK_TRACE_PICKUPS", "BELT_CLOCK_CALIBRATE",
             "BELT_SPEED_CAPTURE_DIR", "SCAFFOLD_CAPTURE_DIR"]

# the capture folders a calibrating pass sets (--calibrate), one per job
CAPTURE_ENV = ["BELT_SPEED_CAPTURE_DIR", "ORE_VOIDER_CAPTURE_DIR", "RECYCLER_MACHINE_CAPTURE_DIR", "RECYCLER_ORIGINAL_CAPTURE_DIR"]


def js_escape(text: str) -> str:
    return re.sub(r"[.*+?^${}()|\[\]\\]", lambda m: "\\" + m.group(0), text)


def full_name(listed: str) -> str:
    """vitest list joins the suites and the test with ' > '; -t is matched against them joined with a space"""
    return listed.replace(" > ", " ")


def is_mechanics(file: str) -> bool:
    return file.startswith("tests/game/mechanics/")


def load_cases(path: Path, filters: list[str]) -> list[tuple[str, str]]:
    listed = json.loads(path.read_text())
    cases = []
    for entry in listed:
        file = os.path.relpath(entry["file"], ROOT)
        if filters and not any(f in file for f in filters):
            continue
        cases.append((file, full_name(entry["name"])))
    return cases


def load_durations(path: Path) -> dict[tuple[str, str], float]:
    if not path.exists():
        return {}
    raw = json.loads(path.read_text())
    return {(file, name): seconds for file, names in raw.items() for name, seconds in names.items()}


def pack(cases: list[tuple[str, str]], seconds: dict[tuple[str, str], float], chunk: float) -> list[dict]:
    """Jobs: {file, cases, seconds}. Long cases alone, the others first-fit-decreasing into bins of about `chunk` seconds."""
    by_file: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for file, name in cases:
        by_file[file].append((file, name))
    jobs: list[dict] = []
    for file, file_cases in by_file.items():
        groups: list[list[tuple[str, str]]] = []
        if file in KEEP_TOGETHER:
            key = KEEP_TOGETHER[file]
            if key is None:
                groups = [file_cases]
            else:
                grouped: dict[str, list[tuple[str, str]]] = defaultdict(list)
                for case in file_cases:
                    match = re.search(key, case[1])
                    grouped[match.group(0) if match else ""].append(case)
                groups = list(grouped.values())
            for group in groups:
                jobs.append({"file": file, "cases": [name for _, name in group],
                             "seconds": sum(seconds.get(c, UNKNOWN_CASE_SECONDS) for c in group)})
            continue
        ordered = sorted(file_cases, key=lambda c: -seconds.get(c, UNKNOWN_CASE_SECONDS))
        bins: list[dict] = []
        for case in ordered:
            s = seconds.get(case, UNKNOWN_CASE_SECONDS)
            for b in bins:
                if b["seconds"] + s <= chunk and len(b["cases"]) < MAX_CASES_PER_JOB and b["seconds"] < chunk:
                    b["cases"].append(case[1])
                    b["seconds"] += s
                    break
            else:
                bins.append({"file": file, "cases": [case[1]], "seconds": s})
        jobs.extend(bins)
    jobs.sort(key=lambda j: (-j["seconds"], j["file"]))
    for index, job in enumerate(jobs):
        stem = re.sub(r"\.game\.test\.ts$", "", Path(job["file"]).name)
        job["id"] = f"{index:03d}-{stem}"
        job["pattern"] = "^(" + "|".join(js_escape(c) for c in job["cases"]) + ")$"
    return jobs


def check_patterns(jobs: list[dict], cases: list[tuple[str, str]]) -> None:
    """Each job's -t pattern must select exactly its own cases among the cases of its file"""
    by_file: dict[str, list[str]] = defaultdict(list)
    for file, name in cases:
        by_file[file].append(name)
    for job in jobs:
        regex = re.compile(job["pattern"])
        matched = sorted(n for n in by_file[job["file"]] if regex.search(n))
        if matched != sorted(job["cases"]):
            raise SystemExit(f"job {job['id']}: the pattern selects {len(matched)} cases, not the {len(job['cases'])} it was cut for")


def simulate(jobs: list[dict], lanes: int) -> float:
    """Wall time of the jobs, longest first, on `lanes` lanes, with the per-job overhead"""
    free = [0.0] * lanes
    for job in jobs:
        i = free.index(min(free))
        free[i] += job["seconds"] + JOB_OVERHEAD_SECONDS
    return max(free) if free else 0.0


def guard_lanes(guard_dir: Path) -> int | None:
    try:
        return int(json.loads((guard_dir / "policy.json").read_text())["machine"]["factorio_max"])
    except (OSError, KeyError, ValueError):
        return None


class Runner:
    def __init__(self, args: argparse.Namespace, out: Path, guard: Path | None):
        self.args, self.out, self.guard = args, out, guard
        self.lock = threading.Lock()
        self.running = 0
        self.peak = 0
        self.lane_log = open(out / "lanes.log", "a", buffering=1)
        self.children: set[subprocess.Popen] = set()
        self.stopping = False

    def note(self, text: str) -> None:
        line = f"{datetime.now():%H:%M:%S} {text}"
        with self.lock:
            print(line, flush=True)
            self.lane_log.write(line + "\n")

    def command(self, job: dict) -> list[str]:
        mode = "on" if is_mechanics(job["file"]) else self.args.cache
        env = [f"{k}={os.environ[k]}" for k in PASS_ENV if os.environ.get(k)]
        env += ["NO_COLOR=1", f"CLOCK_RECORDING_CACHE={mode}", f"CLOCK_RECORDING_CACHE_LOG={self.out / 'events' / (job['id'] + '.jsonl')}"]
        vitest = ["npx", "vitest", "run", "--config", "vitest.game.config.ts", job["file"], "-t", job["pattern"],
                  "--reporter=json", f"--outputFile={self.out / 'json' / (job['id'] + '.json')}"]
        if self.args.calibrate and not is_mechanics(job["file"]):
            capture = self.out / "capture" / job["id"]
            env += ["BELT_CLOCK_CALIBRATE=1", "ORE_VOIDER_CALIBRATE=1"] + [f"{k}={capture}" for k in CAPTURE_ENV]
        inner = ["env"] + [f"-u{k}" for k in CLEAR_ENV] + env + vitest
        if not self.guard:
            return inner
        return ["python3", str(self.guard / "guarded-run-budget.py"), self.args.owner, str(self.out / "guard" / job["id"]),
                "--wait", "14400", "--"] + inner

    def run(self, job: dict) -> dict:
        if self.stopping:
            return {**job, "exit": None, "started": None, "elapsed": 0.0}
        with self.lock:
            self.running += 1
            self.peak = max(self.peak, self.running)
            now_running = self.running
        started = time.time()
        self.note(f"start  {job['id']} ({len(job['cases'])} cases, about {job['seconds']:.0f} s), {now_running} running")
        log = open(self.out / "logs" / (job["id"] + ".txt"), "w")
        proc = subprocess.Popen(self.command(job), cwd=ROOT, stdout=log, stderr=subprocess.STDOUT)
        with self.lock:
            self.children.add(proc)
        code = proc.wait()
        with self.lock:
            self.children.discard(proc)
            self.running -= 1
            now_running = self.running
        elapsed = time.time() - started
        self.note(f"finish {job['id']} exit {code} after {elapsed:.0f} s, {now_running} running")
        return {**job, "exit": code, "started": started, "elapsed": elapsed}

    def stop(self) -> None:
        self.stopping = True
        with self.lock:
            for child in list(self.children):
                child.terminate()


def collect(job: dict, out: Path) -> list[tuple[str, str, float]]:
    """(case, status, seconds) for each case of the job, from vitest's report; 'no result' when the report is missing"""
    report = out / "json" / (job["id"] + ".json")
    seen: dict[str, tuple[str, float]] = {}
    try:
        data = json.loads(report.read_text())
        for suite in data["testResults"]:
            for result in suite["assertionResults"]:
                name = result["fullName"]
                if name in job["cases"]:
                    seen[name] = (result["status"], (result.get("duration") or 0) / 1000)
    except (OSError, ValueError, KeyError):
        pass
    return [(c, *seen.get(c, ("no result", 0.0))) for c in job["cases"]]


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("filters", nargs="*")
    p.add_argument("-o", "--out")
    p.add_argument("-j", "--lanes", type=int)
    p.add_argument("--cache", choices=["on", "off", "refresh"], default="on")
    p.add_argument("--chunk-seconds", type=float, default=120)
    p.add_argument("--durations", type=Path, default=DEFAULT_DURATIONS)
    p.add_argument("--guard-dir", default=os.environ.get("GUARD_DIR", DEFAULT_GUARD_DIR))
    p.add_argument("--owner", default="game-suite")
    p.add_argument("--calibrate", action="store_true")
    p.add_argument("--plan", action="store_true")
    if len(sys.argv) > 1 and sys.argv[1] in ("-h", "--help"):
        print(__doc__)
        return 0
    args = p.parse_args()

    guard_dir = Path(args.guard_dir)
    guard = guard_dir if (guard_dir / "guarded-run-budget.py").exists() else None
    lanes = args.lanes or (guard_lanes(guard_dir) if guard else None) or 2
    out = Path(args.out) if args.out else ROOT / ".scratch" / "game-suite" / datetime.now().strftime("%Y%m%d-%H%M%S")
    out = out.resolve()
    if out.exists() and any(out.iterdir()):
        raise SystemExit(f"{out} exists: pass a new folder")
    for sub in ("json", "logs", "guard", "events"):
        (out / sub).mkdir(parents=True, exist_ok=True)

    # 1. the cases
    list_file = out / "list.json"
    list_cmd = ["npx", "vitest", "list", "--config", "vitest.game.config.ts", f"--json={list_file}"]
    if guard:
        list_cmd = ["python3", str(guard / "guarded-run-budget.py"), args.owner, str(out / "guard" / "list"), "--wait", "14400", "--"] + list_cmd
    print("listing the game suite's cases ...", flush=True)
    listed = subprocess.run(list_cmd, cwd=ROOT, capture_output=True, text=True)
    if listed.returncode != 0 or not list_file.exists():
        sys.stderr.write(listed.stdout[-2000:] + listed.stderr[-2000:])
        raise SystemExit("vitest list failed")
    cases = load_cases(list_file, args.filters)
    if not cases:
        raise SystemExit("no case matches " + " ".join(args.filters))
    known = load_durations(args.durations)
    seconds = {c: known[c] for c in cases if c in known}
    jobs = pack(cases, seconds, args.chunk_seconds)
    check_patterns(jobs, cases)

    total = sum(seconds.get(c, UNKNOWN_CASE_SECONDS) for c in cases)
    estimate = simulate(jobs, lanes)
    with open(out / "jobs.tsv", "w") as f:
        for job in jobs:
            f.write("\t".join([job["id"], job["file"], f"{job['seconds']:.0f}", str(len(job["cases"])), job["pattern"]]) + "\n")
    print(f"{len(cases)} cases in {len(set(f for f, _ in cases))} files -> {len(jobs)} jobs, {total:.0f} s of known case time, "
          f"{lanes} lanes: about {estimate / 60:.0f} min wall (cache for builds: {args.cache}, mechanics: on)", flush=True)
    if args.plan:
        for job in jobs:
            print(f"  {job['id']:<48} {job['seconds']:6.0f} s  {len(job['cases']):3d} cases")
        return 0

    # 2. run, longest first, as many at once as there are lanes
    runner = Runner(args, out, guard)
    start = time.time()
    done: list[dict] = []
    try:
        with ThreadPoolExecutor(max_workers=lanes) as pool:
            for result in pool.map(runner.run, jobs):
                done.append(result)
    except KeyboardInterrupt:
        runner.stop()
        print("interrupted: running jobs were sent SIGTERM", file=sys.stderr)
    wall = time.time() - start

    # 3. one combined result
    rows = []
    for job in jobs:
        for name, status, secs in collect(job, out):
            rows.append({"job": job["id"], "file": job["file"], "case": name, "status": status, "seconds": round(secs, 3)})
    with open(out / "results.tsv", "w") as f:
        for r in rows:
            f.write("\t".join([r["status"], r["file"], r["case"], f"{r['seconds']:.1f}", r["job"]]) + "\n")
    (out / "results.json").write_text(json.dumps(rows, indent=1))
    durations: dict[str, dict[str, float]] = defaultdict(dict)
    for r in rows:
        if r["status"] == "passed" and r["seconds"] >= 1:
            durations[r["file"]][r["case"]] = round(r["seconds"])
    (out / "durations.json").write_text(json.dumps(durations, indent=1, sort_keys=True))

    counts: dict[str, int] = defaultdict(int)
    for r in rows:
        counts[r["status"]] += 1
    bad = [r for r in rows if r["status"] != "passed"]
    for r in bad:
        print(f"{r['status'].upper():9} {r['file']} :: {r['case']}  (log {out / 'logs' / (r['job'] + '.txt')})")
    print(f"{len(rows)} cases: " + ", ".join(f"{n} {s}" for s, n in sorted(counts.items())) +
          f"; {len(jobs)} jobs, up to {runner.peak} at once, wall {wall / 60:.1f} min, results in {out}")
    return 0 if not bad and len(done) == len(jobs) else 1


if __name__ == "__main__":
    sys.exit(main())
