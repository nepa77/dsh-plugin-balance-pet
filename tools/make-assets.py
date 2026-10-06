"""Verify the artwork against the upstream git blob ids, then re-generate assets/.

Only needed to REPLACE or re-derive the images — never to build or install the plugin, whose
assets already ship verified. It refuses to write anything unless every source file it reads
matches the blob id published by GitHub for that path, which is what makes the provenance
claims in THIRD-PARTY-NOTICES.md checkable.

  python tools/make-assets.py --source DIR

The source folder is the one you supply with `--source DIR` (or `DSH_PET_ASSET_SOURCE`).
It must hold the originals in two groups:

    外观/                  five characters, 1536 x 1024 (including the bowl pose)
    四个差分表情/           four differential expressions, 1024 x 1024

Both groups are checked by git blob SHA-1 against the id GitHub publishes for that path
before anything is written, so a substituted file cannot silently reach the plugin. Those
ids are listed in THIRD-PARTY-NOTICES.md, which is what makes its provenance claims
checkable rather than merely asserted.

`外观/sprite.png` is verified but NOT shipped: the 蓝色大肥鱼 appearance is served by the
differential set, because that is the only way the 表情 axis can switch her mood without
the framing jumping. See the README's 宽构图 note.

Requires Pillow.

Run:  python tools/make-assets.py --source DIR
"""
import hashlib
import os
import sys

from PIL import Image


# Console-safe output: a Windows console is often a legacy code page that cannot encode
# the ¥ sign or the Chinese copy, and printing them must not crash the tool.
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:  # pragma: no cover - very old or redirected stdout
    pass

# Where the original PNGs live. Supply it with --source or DSH_PET_ASSET_SOURCE;
# it is only needed to RE-GENERATE assets/, never to build or install the plugin.
SOURCE = os.environ.get("DSH_PET_ASSET_SOURCE", "")
for _index, _argument in enumerate(sys.argv):
    if _argument == "--source" and _index + 1 < len(sys.argv):
        SOURCE = sys.argv[_index + 1]
SOURCE = os.path.abspath(os.path.expanduser(SOURCE)) if SOURCE else ""
APPEARANCE_DIR = os.path.join(SOURCE, "外观")
EXPRESSION_DIR = os.path.join(SOURCE, "四个差分表情")
ASSETS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets")

# git blob ids published by https://api.github.com/repos/VKmich16/VK-1/git/trees/HEAD
EXPECTED = {
    "外观/sprite.png": "0cf081ad4226b40ac745523c4866acb712c6cd99",
    "外观/sprite-gpt.png": "66a73e8543884c5b6ae679b897c7edf2859bbdbc",
    "外观/sprite-claude.png": "bf12181516b132b5d191ac64e30929c9355af667",
    "外观/sprite-gemini.png": "9a75b26f0583cec30db0655657c8e68cce209cf4",
    "外观/sprite-deepseek-offline.png": "346dd449236a409bb9763adff24a6de9400e31d7",
    "四个差分表情/expression_11.png": "bfc234a670be2e22db61b43235e17f27c15704ba",
    "四个差分表情/expression_12.png": "01e4c9d3743d75c03964d5e35df49c512ea61b05",
    "四个差分表情/expression_21.png": "2576111000016fc08ef6080cbef49979e4eeb974",
    "四个差分表情/expression_22.png": "8192e78b4ead83d21915622cdd408ead2ce0cc4f",
}


# output file -> (source path relative to SOURCE, target width)
OUTPUTS = {
    "appearance-bowl.webp": ("外观/sprite-deepseek-offline.png", 1152),
    "appearance-gpt.webp": ("外观/sprite-gpt.png", 1152),
    "appearance-claude.webp": ("外观/sprite-claude.png", 1152),
    "appearance-gemini.webp": ("外观/sprite-gemini.png", 1152),
    "expression-11.webp": ("四个差分表情/expression_11.png", 768),
    "expression-12.webp": ("四个差分表情/expression_12.png", 768),
    "expression-21.webp": ("四个差分表情/expression_21.png", 768),
    "expression-22.webp": ("四个差分表情/expression_22.png", 768),
}


def git_blob_sha1(path):
    """The git object id of a file: sha1('blob <len>\\0' + content)."""
    size = os.path.getsize(path)
    digest = hashlib.sha1()
    digest.update(b"blob %d\0" % size)
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main():
    if not SOURCE:
        print("No source folder given.")
        print("")
        print("  python tools/make-assets.py --source DIR")
        print("  # or set DSH_PET_ASSET_SOURCE=DIR")
    if not SOURCE or not os.path.isdir(SOURCE):
        if SOURCE:
            print("The source folder is not present:")
            print("  %s" % SOURCE)
        print("")
        print("This tool only RE-GENERATES the artwork from the originals, and it verifies")
        print("each source file against its published git blob id while doing so. The")
        print("generated, verified images already ship inside the package:")
        print("  packages/dsh-plugin-balance-pet/assets/")
        print("")
        print("Nothing is missing for installing or packing the plugin. Re-create the")
        print("source folder (the five 外观 files and the four 四个差分表情 files) only if")
        print("you want to replace or re-derive the artwork.")
        return 2

    print("== supplied folder: %s ==" % SOURCE)
    failures = []
    for relative, want in EXPECTED.items():
        if want is None:
            continue
        path = os.path.join(SOURCE, relative.replace("/", os.sep))
        if not os.path.exists(path):
            failures.append("%s: missing (%s)" % (relative, path))
            continue
        got = git_blob_sha1(path)
        print("%s %-42s %s" % ("OK  " if got == want else "DIFF", relative, got))
        if got != want:
            failures.append("%s: %s != %s" % (relative, got, want))

    if failures:
        print("\nINTEGRITY FAILURE:\n  " + "\n  ".join(failures))
        return 1

    os.makedirs(ASSETS, exist_ok=True)
    written = set()
    print("")
    for target, (relative, width) in OUTPUTS.items():
        source = os.path.join(SOURCE, relative.replace("/", os.sep))
        with Image.open(source) as image:
            image = image.convert("RGBA")
            height = round(image.height * width / image.width)
            resized = image.resize((width, height), Image.LANCZOS)
            destination = os.path.join(ASSETS, target)
            resized.save(destination, "WEBP", quality=90, method=6)
            written.add(target)
            print("wrote %-30s %7d bytes  %s" % (target, os.path.getsize(destination), resized.size))

    # Anything the plugin no longer references is removed, so a stale artwork file
    # can never be served by the asset route.
    for name in sorted(os.listdir(ASSETS)):
        if name in written:
            continue
        os.remove(os.path.join(ASSETS, name))
        print("removed stale %s" % name)

    print("\nassets verified and generated in %s" % os.path.normpath(ASSETS))
    return 0


if __name__ == "__main__":
    sys.exit(main())
