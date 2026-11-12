#!/usr/bin/env python3
"""Workbench for moving the fingerprint patches to a new Chromium version.

It works on a partial source tree: only the files the patch series touches,
as downloaded by `devutils/validate_patches.py -c <cache_dir>`. No Chromium
checkout is needed. GNU patch and git must be on PATH.

  port_workbench.py init <cache_dir> <work_dir>
      Copy the cache, apply every series patch outside the directories being
      ported (they must apply cleanly, otherwise upstream itself is broken)
      and commit the result as the base of a scratch git repository.

  port_workbench.py apply <work_dir> <series_path>
      Apply one patch, e.g. extra/fingerprint/003-audio-fingerprint.patch,
      with GNU patch. Failed hunks are left as .rej files next to the
      sources; fix them by hand in <work_dir>.

  port_workbench.py commit <work_dir> <series_path>
      Commit the current state and rewrite patches/<series_path> from it.
      Refuses to run while .rej or .orig files are left.

Typical run, from the repository root:

  python devutils/validate_patches.py -c ../cache
  python facet/port_workbench.py init ../cache ../work
  python facet/port_workbench.py apply ../work extra/fingerprint/000-add-fingerprint-switches.patch
  ... fix rejects ...
  python facet/port_workbench.py commit ../work extra/fingerprint/000-add-fingerprint-switches.patch
  ... next patch ...
  python devutils/validate_patches.py -l ../cache
"""

import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PATCHES = os.path.join(ROOT, 'patches')
# Patch directories that are ported by hand; everything else is upstream's.
PORTED_PREFIXES = ('extra/fingerprint/', 'extra/facet/')


def series():
    with open(os.path.join(PATCHES, 'series'), encoding='utf-8') as series_file:
        return [
            line.strip() for line in series_file if line.strip() and not line.startswith('#')
        ]


def gnu_patch(work, patch_file):
    result = subprocess.run([
        'patch', '-p1', '--forward', '--batch', '--binary', '--no-backup-if-mismatch', '-i',
        os.path.abspath(patch_file)
    ],
                            cwd=work,
                            capture_output=True,
                            text=True,
                            check=False)
    return result.returncode, result.stdout + result.stderr


def git(work, *args, binary=False):
    result = subprocess.run(
        ['git', '-c', 'core.autocrlf=false', '-c', 'core.safecrlf=false', *args],
        cwd=work,
        capture_output=True,
        text=not binary,
        check=False)
    if result.returncode != 0:
        err = result.stderr if not binary else result.stderr.decode('utf-8', 'replace')
        raise SystemExit(f'git {" ".join(args)} failed:\n{err}')
    return result.stdout


def leftovers(work):
    found = []
    for root, dirs, files in os.walk(work):
        if '.git' in dirs:
            dirs.remove('.git')
        found.extend(os.path.join(root, name) for name in files if name.endswith(('.rej', '.orig')))
    return found


def cmd_init(cache, work):
    if os.path.exists(work):
        raise SystemExit(f'{work} already exists; remove it first')
    shutil.copytree(cache, work)
    not_clean = 0
    for path in series():
        if path.startswith(PORTED_PREFIXES):
            continue
        code, out = gnu_patch(work, os.path.join(PATCHES, path))
        if code != 0 or 'FAILED' in out or 'fuzz' in out:
            not_clean += 1
            print('NOT CLEAN', path)
            print(out[-1500:])
    for path in leftovers(work):
        print('LEFTOVER', path)
    git(work, 'init', '-q')
    git(work, 'config', 'user.name', 'port-workbench')
    git(work, 'config', 'user.email', 'port-workbench@localhost')
    git(work, 'add', '-A')
    git(work, 'commit', '-q', '-m', 'base: pristine sources + upstream series')
    print('init done; upstream patches that did not apply cleanly:', not_clean)


def cmd_apply(work, series_path):
    status = git(work, 'status', '--porcelain').strip()
    if status:
        raise SystemExit('work tree is not clean:\n' + status)
    code, out = gnu_patch(work, os.path.join(PATCHES, series_path))
    failed = re.findall(r'Hunk #\d+ FAILED at \d+', out)
    fuzz = re.findall(r'Hunk #\d+ succeeded at \d+ with fuzz \d+', out)
    print(out)
    print(f'SUMMARY {series_path} exit={code} failed={len(failed)} fuzz={len(fuzz)}')


def cmd_commit(work, series_path):
    left = leftovers(work)
    if left:
        raise SystemExit('unresolved:\n' + '\n'.join(left))
    git(work, 'add', '-A')
    git(work, 'commit', '-q', '-m', series_path)
    diff = git(work,
               'diff',
               '--no-color',
               '--no-ext-diff',
               '--abbrev=10',
               'HEAD~1',
               'HEAD',
               binary=True)
    target = os.path.join(PATCHES, series_path)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, 'wb') as patch_file:
        patch_file.write(diff)
    print('wrote', series_path, '|', git(work, 'diff', '--shortstat', 'HEAD~1', 'HEAD').strip())


def main():
    commands = {'init': (cmd_init, 2), 'apply': (cmd_apply, 2), 'commit': (cmd_commit, 2)}
    if len(sys.argv) < 2 or sys.argv[1] not in commands or len(
            sys.argv) != 2 + commands[sys.argv[1]][1]:
        raise SystemExit(__doc__)
    commands[sys.argv[1]][0](*sys.argv[2:])


if __name__ == '__main__':
    main()
