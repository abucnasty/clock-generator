#!/usr/bin/env python3
"""The harness-related processes on this machine: vitest runs and their fork workers, harness Factorio games, and
vite/esbuild servers, each with the worktree it belongs to (by working directory, else by a path on its command line)
and whether its parent is still alive. Never matches by process name alone, and never a game the harness did not start.

usage: procs.py [--worktree <dir>] [--orphans] [--kinds k1,k2] [--json] [--pids]

  --worktree <dir>  only processes of that worktree (the deepest registered worktree containing the path)
  --orphans         only processes whose parent is gone (PPID 1) or whose worktree folder no longer exists
  --kinds           vitest, vitest-worker, factorio, vite, esbuild (default: all)
  --json            one JSON object per line instead of a table
  --pids            only the PIDs, one per line

A process is
  vitest         the node executable running node_modules/.bin/vitest or vitest/vitest.mjs (a vitest run)
  vitest-worker  the node executable running vitest/dist/workers/*.js (a fork or thread worker; it outlives a killed
                 parent)
  factorio       the factorio executable started by the harness: a server with --start-server and --rcon-password, or
                 the watching client with --mp-connect and --config. A game the harness did not start has neither and never matches.
  vite           the node executable running node_modules/.bin/vite or vite/bin/vite.js (a dev server or preview)
  esbuild        node_modules/@esbuild/*/bin/esbuild --service (vite's helper)
The executable decides first (on Linux the /proc/<pid>/exe link, since ps comm is the thread name there, `MainThread` for
node; elsewhere ps comm, which is the executable's path): a shell whose command line only mentions one of these never matches.
"""
import json, os, re, subprocess, sys

# the main checkout: the parent of the repository's common git folder, the same from every worktree
MAIN = os.path.realpath(os.path.join(subprocess.run(
    ['git', '-C', os.path.dirname(os.path.abspath(__file__)), 'rev-parse', '--path-format=absolute', '--git-common-dir'],
    capture_output=True, text=True, check=True).stdout.strip(), '..'))
KINDS = ['vitest', 'vitest-worker', 'factorio', 'vite', 'esbuild']


def kind_of(exe, cmd):
    """The kind of a process from its executable and command line; None for anything else. The executable
    decides first, so a shell whose command line only mentions vitest or factorio never matches."""
    name = os.path.basename(exe)
    if name == 'node':
        if re.search(r'/vitest/dist/workers/[A-Za-z]+\.js(\s|$)', cmd):
            return 'vitest-worker'
        if re.search(r'(/node_modules/\.bin/vitest|/vitest/vitest\.mjs)(\s|$)', cmd):
            return 'vitest'
        if re.search(r'(/node_modules/\.bin/vite|/node_modules/vite/bin/vite\.js)(\s|$)', cmd):
            return 'vite'
        return None
    if name == 'factorio':
        if ('--start-server' in cmd and '--rcon-password' in cmd) or ('--mp-connect' in cmd and '--config' in cmd):
            return 'factorio'
        return None  # any Factorio the harness did not start
    if name == 'esbuild' and '/node_modules/@esbuild/' in exe and '--service' in cmd:
        return 'esbuild'
    return None


def worktrees():
    """Every registered worktree of the repository (the main checkout included), deepest first."""
    out = subprocess.run(['git', '-C', MAIN, 'worktree', 'list', '--porcelain'], capture_output=True, text=True).stdout
    trees = []
    for line in out.splitlines():
        if line.startswith('worktree '):
            p = line[len('worktree '):]
            trees.append(os.path.realpath(p) if os.path.exists(p) else p)
    return sorted(set(trees), key=len, reverse=True)


def owner(path, trees):
    """The deepest registered worktree that contains path, else its .claude/worktrees/<name> folder (a worktree removed
    while its processes ran), else None."""
    if not path:
        return None
    for t in trees:
        if path == t or path.startswith(t + '/'):
            if t == MAIN:
                break  # a removed worktree under the main checkout's .claude/worktrees/ is not the main checkout's
            return t
    m = re.match(r'(.*/\.claude/worktrees/[^/]+)', path)
    if m:
        return m.group(1)
    return MAIN if path == MAIN or path.startswith(MAIN + '/') else None


def cwds(pids):
    if not pids:
        return {}
    out = subprocess.run(['lsof', '-a', '-p', ','.join(map(str, pids)), '-d', 'cwd', '-Fpn'],
                         capture_output=True, text=True).stdout
    res, pid = {}, None
    for line in out.splitlines():
        if line.startswith('p'):
            pid = int(line[1:])
        elif line.startswith('n') and pid is not None:
            res[pid] = line[1:]
    return res


def processes(extra_trees=()):
    exes = {}
    for line in subprocess.run(['ps', '-axo', 'pid=,comm='], capture_output=True, text=True).stdout.splitlines():
        parts = line.strip().split(None, 1)
        if len(parts) == 2:
            exes[int(parts[0])] = parts[1]
    # On Linux ps comm is the thread name (`MainThread` for node), so read the real executable where /proc has it;
    # elsewhere (macOS) comm is already the executable's path.
    for pid in exes:
        try:
            exes[pid] = os.readlink(f'/proc/{pid}/exe').removesuffix(' (deleted)')
        except OSError:
            pass
    out = subprocess.run(['ps', '-axo', 'pid=,ppid=,etime=,pcpu=,command='], capture_output=True, text=True).stdout
    rows, alive = [], set()
    for line in out.splitlines():
        parts = line.split(None, 4)
        if len(parts) < 5:
            continue
        pid, ppid, etime, cpu, cmd = int(parts[0]), int(parts[1]), parts[2], parts[3], parts[4]
        alive.add(pid)
        k = kind_of(exes.get(pid, ''), cmd)
        if k:
            rows.append({'pid': pid, 'ppid': ppid, 'etime': etime, 'cpu': cpu, 'kind': k, 'exe': exes.get(pid), 'command': cmd})
    cw = cwds(sorted(r['pid'] for r in rows))
    # a named worktree counts even when it is no longer registered or no longer exists
    trees = sorted(set(worktrees()) | set(extra_trees), key=len, reverse=True)
    for r in rows:
        r['cwd'] = cw.get(r['pid'])
        cwd = r['cwd']
        tree = owner(os.path.realpath(cwd) if cwd and os.path.exists(cwd) else cwd, trees)
        if tree is None or tree == MAIN:
            # by a path on the command line (a vite server started with --prefix, a worker of a removed worktree)
            for m in re.finditer(r'(/[^\s]+)', r['command']):
                t = owner(m.group(1), trees)
                if t and t != MAIN:
                    tree = t
                    break
        r['worktree'] = tree
        r['worktree_gone'] = bool(tree) and not os.path.isdir(tree)
        r['parent_alive'] = r['ppid'] != 1 and r['ppid'] in alive
        r['orphan'] = not r['parent_alive'] or r['worktree_gone']
    return rows


def main(argv):
    want_tree = None; only_orphans = False; kinds = KINDS; as_json = False; only_pids = False
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == '--worktree':
            want_tree = os.path.realpath(argv[i + 1]) if os.path.exists(argv[i + 1]) else os.path.abspath(argv[i + 1]); i += 1
        elif a == '--orphans': only_orphans = True
        elif a == '--kinds': kinds = argv[i + 1].split(','); i += 1
        elif a == '--json': as_json = True
        elif a == '--pids': only_pids = True
        else: sys.exit(f'procs.py: unknown argument {a}')
        i += 1
    rows = [r for r in processes([want_tree] if want_tree else []) if r['kind'] in kinds]
    if want_tree:
        rows = [r for r in rows if r['worktree'] == want_tree]
    if only_orphans:
        rows = [r for r in rows if r['orphan']]
    for r in rows:
        if only_pids:
            print(r['pid'])
        elif as_json:
            print(json.dumps(r))
        else:
            tree = (r['worktree'] or '-').replace(MAIN + '/.claude/worktrees/', 'wt:')
            tree = 'main' if tree == MAIN else tree
            flags = ('ORPHAN ' if r['orphan'] else '') + ('(worktree gone) ' if r['worktree_gone'] else '')
            print(f"{r['pid']:>6} {r['ppid']:>6} {r['etime']:>12} {r['cpu']:>5}% {r['kind']:<13} {tree[:40]:<40} {flags}{r['command'][:100]}")


if __name__ == '__main__':
    main(sys.argv[1:])
