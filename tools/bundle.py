#!/usr/bin/env python3
"""bundle.py — test, stage and zip the Sky Captain web build.

Usage:  python3 tools/bundle.py [--skip-tests]

Steps:
  1. Run tools/test-logic.js, tools/test-flight.js and tools/test-render.js (fail fast).
  2. Copy index.html, css/, js/, README.md into dist/sky-captain/.
  3. Stamp dist/sky-captain/build.json (version, date, file list).
  4. Zip it as dist/sky-captain.zip.
"""
import json
import os
import shutil
import subprocess
import sys
import zipfile
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIST = os.path.join(ROOT, "dist")
STAGE = os.path.join(DIST, "sky-captain")
VERSION = "1.1.0"


def run(cmd, cwd=ROOT):
    print("+ " + " ".join(cmd))
    r = subprocess.run(cmd, cwd=cwd)
    if r.returncode != 0:
        sys.exit("BUILD ABORTED: %s failed (exit %d)" % (" ".join(cmd), r.returncode))


def main():
    skip_tests = "--skip-tests" in sys.argv
    os.chdir(ROOT)

    if not skip_tests:
        run(["node", "tools/test-logic.js"])
        run(["node", "tools/test-flight.js"])
        run(["node", "tools/test-render.js"])
        run(["node", "tools/test-ui.js"])
    else:
        print("(skipping tests)")

    if os.path.isdir(STAGE):
        shutil.rmtree(STAGE)
    os.makedirs(STAGE, exist_ok=True)

    staged = []
    for name in ["index.html", "README.md"]:
        shutil.copy2(os.path.join(ROOT, name), os.path.join(STAGE, name))
        staged.append(name)
    for d in ["css", "js"]:
        shutil.copytree(os.path.join(ROOT, d), os.path.join(STAGE, d),
                        ignore=shutil.ignore_patterns("__pycache__"))
        for dp, _, fns in os.walk(os.path.join(STAGE, d)):
            for fn in fns:
                staged.append(os.path.relpath(os.path.join(dp, fn), STAGE))

    with open(os.path.join(STAGE, "build.json"), "w") as f:
        json.dump({
            "name": "sky-captain",
            "version": VERSION,
            "built": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "files": sorted(staged),
        }, f, indent=2)

    zip_path = os.path.join(DIST, "sky-captain.zip")
    if os.path.exists(zip_path):
        os.remove(zip_path)
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        for dp, _, fns in os.walk(STAGE):
            for fn in fns:
                full = os.path.join(dp, fn)
                z.write(full, os.path.relpath(full, DIST))

    size = os.path.getsize(zip_path)
    print("OK  staged %d files -> %s" % (len(staged), STAGE))
    print("OK  zipped -> %s (%.1f KB)" % (zip_path, size / 1024))


if __name__ == "__main__":
    main()
