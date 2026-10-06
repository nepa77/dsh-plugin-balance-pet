"""Check that every relative path the package README points at actually exists.

Run:  python tools/check-readme-paths.py
"""
import io
import os
import re
import sys

PKG = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PATTERNS = [
    r"`([A-Za-z0-9_./\\-]+\.(?:md|js|mjs|json|py|ps1|yml|svg|webp|png))`",
    r"!\[[^\]]*\]\(([^)]+)\)",
    r"\[[^\]]+\]\(([^)]+)\)",
]
SKIP = ("http://", "https://", "#", "mailto:", "<")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    text = io.open(os.path.join(PKG, "README.md"), encoding="utf-8").read()
    seen = set()
    for pattern in PATTERNS:
        for match in re.finditer(pattern, text):
            candidate = match.group(1).replace("\\", "/").strip()
            if candidate.startswith(SKIP) or "<" in candidate:
                continue
            seen.add(candidate)
    missing = sorted(p for p in seen if not os.path.exists(os.path.join(PKG, p)))
    print("checked %d relative paths in README.md" % len(seen))
    for path in missing:
        print("  MISSING  %s" % path)
    if not missing:
        print("all of them resolve from the package root")
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
