from __future__ import annotations

import argparse
import io
import json
import urllib.request
from dataclasses import dataclass
from pathlib import Path

from PIL import Image


API_ROOT = "https://api.polyhaven.com/files"


@dataclass(frozen=True)
class Surface:
    asset: str
    output: str
    diffuse_key: str = "Diffuse"
    normal_key: str | None = "nor_gl"


SURFACES = (
    Surface("marble_cliff_04", "desert-cliff"),
    Surface("marble_cliff_05", "mountain-cliff"),
    Surface("snow_01", "snow-ground"),
    Surface("forest_leaves_04", "autumn-leaves"),
    Surface("grass_bermuda_01", "bermuda-grass"),
    Surface("red_brick", "red-brick"),
    Surface("stone_wall_05", "stone-wall"),
    Surface("namaqualand_boulder_05", "boulder-namaqualand-05"),
    Surface("boulder_01", "boulder-01"),
    Surface("namaqualand_boulder_03", "boulder-namaqualand-03"),
    Surface("jacaranda_tree", "jacaranda-trunk", "trunk_diff", None),
    Surface("jacaranda_tree", "jacaranda-leaves", "leaves_diff", None),
    Surface("searsia_lucida", "searsia-leaves", "Diffuse", None),
    Surface("dead_tree_trunk_02", "dead-tree", "Diffuse", None),
    Surface("othonna_cerarioides", "winter-tree", "Diffuse", None),
)


def request_json(url: str) -> dict:
    request = urllib.request.Request(url, headers={"User-Agent": "MISTLINE asset pipeline"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def request_bytes(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "MISTLINE asset pipeline"})
    with urllib.request.urlopen(request, timeout=120) as response:
        return response.read()


def map_url(files: dict, key: str) -> str:
    entry = files.get(key, {}).get("1k", {})
    for extension in ("jpg", "png"):
        if extension in entry:
            return entry[extension]["url"]
    raise KeyError(f"No 1K JPG/PNG map found for {key}")


def save_webp(url: str, destination: Path, quality: int) -> None:
    source = Image.open(io.BytesIO(request_bytes(url))).convert("RGB")
    if max(source.size) > 1024:
        source.thumbnail((1024, 1024), Image.Resampling.LANCZOS)
    source.save(destination, "WEBP", quality=quality, method=6)


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch CC0 Poly Haven environment surfaces.")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    manifests: dict[str, dict] = {}
    for surface in SURFACES:
        files = manifests.get(surface.asset)
        if files is None:
            files = request_json(f"{API_ROOT}/{surface.asset}")
            manifests[surface.asset] = files
        diffuse_url = map_url(files, surface.diffuse_key)
        save_webp(diffuse_url, args.output / f"{surface.output}-diffuse-1k.webp", 84)
        if surface.normal_key:
            normal_url = map_url(files, surface.normal_key)
            save_webp(normal_url, args.output / f"{surface.output}-normal-1k.webp", 92)
        print(surface.output)


if __name__ == "__main__":
    main()
