#!/usr/bin/env python3
"""The engine half of a blast cache key, from git: what the generator's output can depend on, and nothing a docs or
tests-only commit changes.

  src       every file of clock-generator/src except *.test.ts and *.md (tsc builds neither into dist/), as
            `git ls-tree -r` lines (mode, blob, path), hashed
  resources the git tree of clock-generator/resources (game data, config samples)
  lock      the blob of clock-generator/package-lock.json (the dependencies' exact versions)
  tsconfig  the blob of clock-generator/tsconfig.json (how dist/ is built)

and, beside the key and not in it, resources_data (data_key): the resources without the sample configs and notes.

  env       the environment variables of the engine that change what it generates, by name and value: only those that are
            set (unset is not the same as set to the empty string). With none set the key is what it was before the field.

The other half is the job list's hash (each job's config, canonical JSON; blast.sh `key`), which covers the fixture
definitions in tests/ by what they produce rather than by their source.

The environment is read by variable, never whole (PATH would make every machine miss). Every CLOCK_* variable of the
environment the blast would run with is on one of three lists (ENV_KEYED, ENV_CLEARED, ENV_IGNORED below); one that is on
none of them stops the key, and so every blast.sh command that runs or stores, with a message naming it. A new variable of
the engine that changes generation goes on ENV_KEYED; one that does not, on ENV_IGNORED.

A run folder records the keyed environment it was generated under (.env.json, written by blast.sh); `blast.sh store` compares it
with the current key's and refuses when they differ or when the folder has no record (--made-under NAME=VALUE, or `none`, says
what a folder without one was made under; it must still equal the current environment).

usage: key.py <worktree> [<rev>]      prints JSON; "dirty" lists uncommitted changes to the key's paths (tracked or
                                      untracked), which make a key from the commit wrong for the working tree
       key.py --check-store <folder> <engine.json> [<NAME=VALUE|none>...]
                                      exits 0 when the folder's recorded environment is the one in engine.json, else 1 and says why
       key.py --state <worktree> [<file>...]
                                      prints one sha256 of the working tree's engine as it is: HEAD's engine key, the
                                      uncommitted diff and untracked files of the key's paths, and the given files (a
                                      rule patch); blast.sh stamps a run folder with it, so a resume never mixes engines
"""
import hashlib, json, os, subprocess, sys

# the format's name since the first cached entry: renaming it would change every key
FORMAT = 't1-engine-1'
PATHS = ['clock-generator/src', 'clock-generator/resources', 'clock-generator/package-lock.json', 'clock-generator/tsconfig.json']


# CLOCK_* variables that change what a blast generates: keyed, by name and value. CLOCK_EXPLORE=1 is read by blast.blastrun.ts (not by the engine), which
# then passes `explore_strategies`: the jobs also hold the explored clocks, so a run under it has an entry of its own and is never carried from another
ENV_KEYED: list[str] = ['CLOCK_EXPLORE']
# changes generation too, but the runner clears it (blast.sh runs every process with `env -u`), so it is never in effect
ENV_CLEARED = ['CLOCK_PROOF_PHASES']
# read by the harness or the scripts, not by generation: the game recording store (src/harness) and the sweep scripts' checkout
ENV_IGNORED = ['CLOCK_RECORDING_CACHE', 'CLOCK_RECORDING_CACHE_DIR', 'CLOCK_RECORDING_CACHE_LOG', 'CLOCK_GENERATOR_ROOT']


class UnknownEnvironment(Exception):
    pass


def environment(env=None):
    """{name: value} of the keyed variables that are set in env (the process's environment by default). Raises
    UnknownEnvironment naming every CLOCK_* variable that is on no list."""
    env = os.environ if env is None else env
    unknown = sorted(n for n in env if n.startswith('CLOCK_') and n not in ENV_KEYED + ENV_CLEARED + ENV_IGNORED)
    if unknown:
        raise UnknownEnvironment(f"{', '.join(unknown)} {'is' if len(unknown) == 1 else 'are'} set, and key.py does not know whether "
                                 f"{'it changes' if len(unknown) == 1 else 'they change'} what the engine generates: unset "
                                 f"{'it' if len(unknown) == 1 else 'them'}, or add {'it' if len(unknown) == 1 else 'each'} to ENV_KEYED or ENV_IGNORED in "
                                 f"{os.path.abspath(__file__)} (a blast under an unlisted variable could be stored under the wrong key)")
    return {n: env[n] for n in ENV_KEYED if n in env}


class StoreRefused(Exception):
    pass


def shown(variables):
    return ', '.join(f'{n}={v!r}' for n, v in variables.items()) or 'none set'


def check_store(folder, current, claimed=None):
    """Raises StoreRefused unless the keyed environment the run folder was generated under (its .env.json, or what the caller
    claims for a folder without one: a list of NAME=VALUE, or ['none']) is the current key's. A folder without a record is
    never guessed."""
    try:
        recorded = json.load(open(os.path.join(folder, '.env.json')))
        source = 'recorded in the folder'
    except FileNotFoundError:
        if not claimed:
            raise StoreRefused(f"{folder} has no record of the environment it was generated under (a folder from before the record): "
                               f"rerun it, or say what it was made under with --made-under NAME=VALUE (repeat it; --made-under none for no keyed variable set)")
        recorded = {} if claimed == ['none'] else dict(c.split('=', 1) for c in claimed)
        source = 'given by --made-under'
    if recorded != current:
        raise StoreRefused(f"{folder} was generated under {shown(recorded)} ({source}), but the environment now is {shown(current)}: "
                           f"storing it would file it under the wrong key; run the command under the environment the jobs were made with")


def git(w, *args):
    return subprocess.run(['git', '-C', w, *args], capture_output=True, text=True, check=True).stdout


def counted(path):
    return not (path.startswith('clock-generator/src/') and (path.endswith('.test.ts') or path.endswith('.md')))


def engine_key(w, rev='HEAD', env=None):
    lines = [l for l in git(w, 'ls-tree', '-r', rev, '--', 'clock-generator/src').splitlines() if counted(l.split('\t', 1)[1])]
    parts = {
        'src': hashlib.sha256('\n'.join(lines).encode()).hexdigest(),
        'src_files': len(lines),
        'resources': git(w, 'rev-parse', f'{rev}:clock-generator/resources').strip(),
        'lock': git(w, 'rev-parse', f'{rev}:clock-generator/package-lock.json').strip(),
        'tsconfig': git(w, 'rev-parse', f'{rev}:clock-generator/tsconfig.json').strip(),
    }
    variables = environment(env)
    hashed = {'format': FORMAT, **{k: parts[k] for k in ['src', 'resources', 'lock', 'tsconfig']}}
    if variables:  # left out when empty, so that the key of a run with none set is the one it always was
        hashed['env'] = variables
    engine = hashlib.sha256(json.dumps(hashed, sort_keys=True).encode()).hexdigest()
    return {'format': FORMAT, 'rev': git(w, 'rev-parse', rev).strip(), 'engine': engine, **parts, 'env': variables, 'resources_data': data_key(w, rev)}


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
    if sys.argv[1] == '--check-store':
        try:
            check_store(sys.argv[2], json.load(open(sys.argv[3])).get('env') or {}, sys.argv[4:] or None)
        except StoreRefused as e:
            sys.exit(f'key.py: refusing to store: {e}')
        sys.exit(0)
    try:
        if sys.argv[1] == '--state':
            print(state(sys.argv[2], sys.argv[3:]))
            sys.exit(0)
        w = sys.argv[1]
        rev = sys.argv[2] if len(sys.argv) > 2 else 'HEAD'
        key = engine_key(w, rev)
    except UnknownEnvironment as e:
        sys.exit(f'key.py: refusing: {e}')
    key['dirty'] = dirty(w) if rev == 'HEAD' else None
    print(json.dumps(key, indent=1))
