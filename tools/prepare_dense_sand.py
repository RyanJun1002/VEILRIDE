from __future__ import annotations

import argparse
import os
from pathlib import Path

os.environ.setdefault("OPENCV_IO_ENABLE_OPENEXR", "1")

import cv2
import numpy as np
from PIL import Image


def resize_linear_texture(source: Path, size: int) -> np.ndarray:
    encoded = np.fromfile(source, dtype=np.uint8)
    image = cv2.imdecode(encoded, cv2.IMREAD_UNCHANGED)
    if image is None:
        raise RuntimeError(f"Could not read texture: {source}")
    return cv2.resize(image, (size, size), interpolation=cv2.INTER_AREA)


def to_uint8(image: np.ndarray) -> np.ndarray:
    if np.issubdtype(image.dtype, np.floating):
        image = np.clip(image, 0.0, 1.0) * 255.0
    return np.clip(image, 0, 255).astype(np.uint8)


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare Poly Haven Dense Sand for the web runtime.")
    parser.add_argument("source", type=Path, help="Extracted textures directory")
    parser.add_argument("output", type=Path, help="Runtime texture directory")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    diffuse_source = args.source / "dense_sand_diff_4k.jpg"
    normal_source = args.source / "dense_sand_nor_gl_4k.exr"
    roughness_source = args.source / "dense_sand_rough_4k.exr"

    with Image.open(diffuse_source) as diffuse:
        diffuse.convert("RGB").resize((2048, 2048), Image.Resampling.LANCZOS).save(
            args.output / "dense-sand-diffuse-2k.webp",
            "WEBP",
            quality=84,
            method=6,
        )

    normal = to_uint8(resize_linear_texture(normal_source, 1024))
    normal_rgb = cv2.cvtColor(normal, cv2.COLOR_BGR2RGB)
    Image.fromarray(normal_rgb, mode="RGB").save(
        args.output / "dense-sand-normal-1k.webp",
        "WEBP",
        quality=92,
        method=6,
    )

    roughness = to_uint8(resize_linear_texture(roughness_source, 1024))
    if roughness.ndim == 3:
        roughness = roughness[:, :, 0]
    Image.fromarray(roughness, mode="L").save(
        args.output / "dense-sand-roughness-1k.webp",
        "WEBP",
        quality=88,
        method=6,
    )


if __name__ == "__main__":
    main()
