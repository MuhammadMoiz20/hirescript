from pathlib import Path

_SKELETON = (Path(__file__).parent / "jakes_skeleton.tex").read_text()

JAKES = {
    "id": "jakes",
    "name": "Jake's Resume",
    "latex_skeleton": _SKELETON,
}
