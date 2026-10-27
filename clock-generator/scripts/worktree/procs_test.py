#!/usr/bin/env python3
"""Tests of procs.py: run with `python3 -m unittest procs_test` from this folder."""
import os, subprocess, sys, tempfile, time, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import procs


class KindOf(unittest.TestCase):
    def test_vitest_run_and_worker_and_vite(self):
        self.assertEqual(procs.kind_of('/usr/bin/node', 'node /w/node_modules/.bin/vitest run'), 'vitest')
        self.assertEqual(procs.kind_of('/usr/bin/node', 'node /w/node_modules/vitest/dist/workers/forks.js'), 'vitest-worker')
        self.assertEqual(procs.kind_of('/usr/bin/node', 'node /w/node_modules/.bin/vite preview'), 'vite')

    def test_esbuild_and_shell_mentioning_vitest(self):
        self.assertEqual(procs.kind_of('/w/node_modules/@esbuild/linux-x64/bin/esbuild', 'esbuild --service=0.1 --ping'), 'esbuild')
        self.assertIsNone(procs.kind_of('/usr/bin/zsh', 'zsh -c node_modules/.bin/vitest run'))
        self.assertIsNone(procs.kind_of('MainThread', 'node /w/node_modules/.bin/vitest run'))


@unittest.skipUnless(os.path.isdir('/proc/self'), 'needs /proc')
class RunningProcess(unittest.TestCase):
    def test_node_named_script_is_listed_by_executable_not_thread_name(self):
        """A node process running <dir>/node_modules/.bin/vitest is found, as a real vitest run is on Linux."""
        node = subprocess.run(['sh', '-c', 'command -v node'], capture_output=True, text=True).stdout.strip()
        if not node:
            self.skipTest('node not installed')
        with tempfile.TemporaryDirectory() as d:
            script = os.path.join(d, 'node_modules', '.bin', 'vitest')
            os.makedirs(os.path.dirname(script))
            with open(script, 'w') as f:
                f.write('setTimeout(() => {}, 60000)\n')
            p = subprocess.Popen([node, script, 'run'], cwd=d)
            try:
                found = []
                for _ in range(50):
                    found = [r for r in procs.processes([d]) if r['pid'] == p.pid]
                    if found:
                        break
                    time.sleep(0.1)
                self.assertEqual([r['kind'] for r in found], ['vitest'])
                self.assertEqual(os.path.basename(found[0]['exe']), 'node')
            finally:
                p.kill()
                p.wait()


if __name__ == '__main__':
    unittest.main()
