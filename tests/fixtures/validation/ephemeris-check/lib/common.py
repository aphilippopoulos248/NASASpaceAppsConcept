"""Path set-up shared by the check scripts: run them with `python3 -I` from anywhere."""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BASE = os.path.dirname(HERE)                                   # tests/fixtures/validation/ephemeris-check
ROOT = os.path.normpath(os.path.join(BASE, '..', '..', '..', '..'))
CACHE = os.path.join(ROOT, 'scripts', '.cache', 'ephemeris-check')   # git-ignored: downloads, numpy
for p in (os.path.join(CACHE, 'pylib'), HERE):
    if os.path.isdir(p) and p not in sys.path:
        sys.path.insert(0, p)
