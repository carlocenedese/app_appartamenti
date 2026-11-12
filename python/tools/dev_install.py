"""Makes `python -I -m bollette_pdf` find the package of this repository (development and CI).

Under -I neither the current folder nor PYTHONPATH is on sys.path, so the package must be in
site-packages. `pip install ./python` would need setuptools, which is not among the hashed
requirements (ruling R72); instead this script writes a `.pth` file into the site-packages of the
interpreter that runs it, naming the folder `python/` of the repository. The package then always
runs from the working tree, and finds the schemas in `docs/schemas/` by walking up from it.

It refuses the system Python: it only writes inside a virtual environment, or when the variable
CI is `true` (the throw-away Python of a CI runner).

Usage: python3 -I python/tools/dev_install.py   (exit code 1 when it refuses)
"""

from __future__ import annotations

import os
import sys
import sysconfig
from pathlib import Path

PTH_NAME = "bollette_pdf-dev.pth"
PYTHON_DIR = Path(__file__).resolve().parents[1]


def allowed(prefix: str, base_prefix: str, environ: dict[str, str]) -> bool:
    """True inside a virtual environment or on a CI runner."""
    return prefix != base_prefix or environ.get("CI") == "true"


def write_pth(site_packages: Path, python_dir: Path = PYTHON_DIR) -> Path:
    """Writes the `.pth` file into `site_packages` and returns its path."""
    path = site_packages / PTH_NAME
    path.write_text(f"{python_dir}\n", encoding="utf-8")
    return path


def main() -> int:
    if not allowed(sys.prefix, sys.base_prefix, dict(os.environ)):
        sys.stderr.write(
            "Rifiutato: usare un virtualenv (PYTHON=<interprete>), mai il Python di sistema.\n"
        )
        return 1
    path = write_pth(Path(sysconfig.get_path("purelib")))
    print(f"Scritto {path.name} in site-packages.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
