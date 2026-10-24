#!/usr/bin/env python3
"""The engine half of a blast cache key, from git: what the generator's output can depend on, and nothing a docs or
tests-only commit changes.

  src       every file of clock-generator/src except *.test.ts and *.md (tsc builds neither into dist/), as
            `git ls-tree -r` lines (mode, blob, path), hashed
  resources the git tree of clock-generator/resources (game data, config samples)
  lock      the blob of clock-generator/package-lock.json (the dependencies' exact versions)
  tsconfig  the blob of clock-generator/tsconfig.json (how dist/ is built)

and, beside the key and not in it, resources_data (data_key): the resources without the sample configs and notes.

The other half is the job list's hash (each job's config, canonical JSON; blast.sh `key`), which covers the fixture
definitions in tests/ by what they produce rather than by their source. The engine reads one environment variable
that changes generation, CLOCK_PROOF_PHASES; the runner always clears it.

usage: key.py <worktree> [<rev>]      prints JSON; "dirty" lists uncommitted changes to the key's paths (tracked or
                                      untracked), which make a key from the commit wrong for the working tree
       key.py --state <worktree> [<file>...]
                                      prints one sha256 of the working tree's engine as it is: HEAD's engine key, the
                                      uncommitted diff and untracked files of the key's paths, and the given files (a
                                      rule patch); blast.sh stamps a run folder with it, so a resume never mixes engines
"""
import hashlib, json, subprocess, sys

# the format's name since the first cached entry: renaming it would change every key
FORMAT = 't1-engine-1'
PATHS = ['clock-generator/src', 'clock-generator/resources', 'clock-generator/package-lock.json', 'clock-generator/tsconfig.json']


def git(w, *args):
    return subprocess.run(['git', '-C', w, *args], capture_output=True, text=True, check=True).stdout


def counted(path):
    return not (path.startswith('clock-generator/src/') and (path.endswith('.test.ts') or path.endswith('.md')))


def engine_key(w, rev='HEAD'):
    lines = [l for l in git(w, 'ls-tree', '-r', rev, '--', 'clock-generator/src').splitlines() if counted(l.split('\t', 1)[1])]
    parts = {
        'src': hashlib.sha256('\n'.join(lines).encode()).hexdigest(),
        'src_files': len(lines),
        'resources': git(w, 'rev-parse', f'{rev}:clock-generator/resources').strip(),
        'lock': git(w, 'rev-parse', f'{rev}:clock-generator/package-lock.json').strip(),
        'tsconfig': git(w, 'rev-parse', f'{rev}:clock-generator/tsconfig.json').strip(),
    }
    engine = hashlib.sha256(json.dumps({'format': FORMAT, **{k: parts[k] for k in ['src', 'resources', 'lock', 'tsconfig']}}, sort_keys=True).encode()).hexdigest()
    return {'format': FORMAT, 'rev': git(w, 'rev-parse', rev).strip(), 'engine': engine, **parts, 'resources_data': data_key(w, rev)}


def data_key(w, rev='HEAD'):
    """What the engine reads at run time from clock-generator/resources apart from the sample configs (each job's own config
    hash covers those) and the notes: the game data. blast.sh's selection carries jobs forward only between engines that
    have the same one. Not part of the cache key."""
    lines = [l for l in git(w, 'ls-tree', '-r', rev, '--', 'clock-generator/resources').splitlines()
             if not l.split('\t', 1)[1].startswith('clock-generator/resources/config-samples/') and not l.endswith('.md')]
    return hashlib.sha256('\n'.join(lines).encode()).hexdigest()


def data_key_or_none(w, rev):
    try:
        return data_key(w, rev)
    except subprocess.CalledProcessError:
        return None


def dirty(w):
    out = git(w, 'status', '--porcelain', '--untracked-files=all', '--', *PATHS)
    return [l for l in out.splitlines() if counted(l[3:].split(' -> ')[-1])]


def state(w, extra=()):
    h = hashlib.sha256(engine_key(w)['engine'].encode())
    h.update(subprocess.run(['git', '-C', w, 'diff', 'HEAD', '--binary', '--', *PATHS], capture_output=True, check=True).stdout)
    untracked = git(w, 'ls-files', '--others', '--exclude-standard', '--', *PATHS).split('\n')
    for f in sorted(filter(None, untracked)) + list(extra):
        h.update(f.encode() + b'\0')
        h.update(open(f if f in extra else f'{w}/{f}', 'rb').read())
    return h.hexdigest()


if __name__ == '__main__':
    if sys.argv[1] == '--state':
        print(state(sys.argv[2], sys.argv[3:]))
        sys.exit(0)
    w = sys.argv[1]
    rev = sys.argv[2] if len(sys.argv) > 2 else 'HEAD'
    key = engine_key(w, rev)
    key['dirty'] = dirty(w) if rev == 'HEAD' else None
    print(json.dumps(key, indent=1))
