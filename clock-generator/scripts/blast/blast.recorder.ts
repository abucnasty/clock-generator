// Starts V8 precise coverage before the engine loads, so that what runs while it loads (the data tables it builds, the
// enums, the functions a top-level statement calls) is recorded too. A vitest setup file, first in vitest.scratch-dist.config.ts's
// list; blast.blastrun.ts takes the coverage from here (see its header). Nothing happens if BLAST_FUNCTIONS is 0 or the
// inspector is not there. blast.sh installs it into tests/game/builds/.scratch/ (gitignored), where the config finds it.
import inspector from 'node:inspector';

if (process.env.BLAST_FUNCTIONS !== '0') {
    try {
        const session = new inspector.Session();
        session.connect();
        const post = (method: string, params?: object) => new Promise<any>((resolve, reject) =>
            session.post(method, params, (error, result) => error ? reject(error) : resolve(result)));
        await post('Profiler.enable');
        await post('Profiler.startPreciseCoverage', { callCount: false, detailed: false });
        (globalThis as any).__blastCoverage = { post };
    } catch { /* no coverage: the entry will not be a base for a selective run */ }
}
