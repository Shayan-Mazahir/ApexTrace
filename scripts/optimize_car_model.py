"""Makes the car model light enough for an integrated GPU.

The game loads frontend/public/models/car.glb (git-ignored, like the raw model
dropped in frontend/public/). The raw RB22 model carries ~391 MB of textures in
GPU memory — three 4096x4096 images alone are ~270 MB — for a car that is a
few hundred pixels wide on screen. This caps every texture at MAX_SIZE and
leaves everything else byte-for-byte alone: meshes, nodes and material names
(CarModel.tsx finds the wheels and steering wheel by material name).

    python scripts/optimize_car_model.py                 # default paths below
    python scripts/optimize_car_model.py IN.glb OUT.glb --max-size 1024

Needs Pillow (pip install pillow). Reload the page afterwards: the game checks
for the model once per page load.
"""

import argparse
import io
import json
import struct
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_IN = ROOT / "frontend" / "public" / "2026_red_bull_racing_rb22.glb"
DEFAULT_OUT = ROOT / "frontend" / "public" / "models" / "car.glb"

GLB_MAGIC, CHUNK_JSON, CHUNK_BIN = b"glTF", 0x4E4F534A, 0x004E4942


def read_glb(path):
    data = path.read_bytes()
    magic, version, length = struct.unpack("<4sII", data[:12])
    if magic != GLB_MAGIC or version != 2:
        sys.exit(f"{path} is not a glTF 2.0 binary (.glb)")
    offset, gltf, binary = 12, None, b""
    while offset < length:
        chunk_len, chunk_type = struct.unpack("<II", data[offset:offset + 8])
        chunk = data[offset + 8: offset + 8 + chunk_len]
        if chunk_type == CHUNK_JSON:
            gltf = json.loads(chunk)
        elif chunk_type == CHUNK_BIN:
            binary = chunk
        offset += 8 + chunk_len
    return gltf, binary


def write_glb(path, gltf, binary):
    js = json.dumps(gltf, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)  # JSON chunk is space-padded to 4 bytes
    binary += b"\0" * (-len(binary) % 4)
    total = 12 + 8 + len(js) + 8 + len(binary)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", GLB_MAGIC, 2, total))
        f.write(struct.pack("<II", len(js), CHUNK_JSON) + js)
        f.write(struct.pack("<II", len(binary), CHUNK_BIN) + binary)


def downscale(image_bytes, max_size):
    """Returns (new bytes, (old w, h), (new w, h)); unchanged if already small."""
    img = Image.open(io.BytesIO(image_bytes))
    fmt = img.format
    w, h = img.size
    if max(w, h) <= max_size:
        return image_bytes, (w, h), (w, h)
    scale = max_size / max(w, h)
    size = (max(1, round(w * scale)), max(1, round(h * scale)))
    small = img.resize(size, Image.LANCZOS)
    out = io.BytesIO()
    if fmt == "JPEG":
        small.save(out, "JPEG", quality=90)
    else:
        small.save(out, "PNG", optimize=True)
    return out.getvalue(), (w, h), size


def texture_bytes(sizes):
    """GPU memory for RGBA8 textures with a full mip chain (x 4/3)."""
    return sum(w * h * 4 * 4 / 3 for w, h in sizes)


def main():
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("input", nargs="?", type=Path, default=DEFAULT_IN)
    parser.add_argument("output", nargs="?", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--max-size", type=int, default=1024, help="largest texture side in pixels")
    args = parser.parse_args()

    gltf, binary = read_glb(args.input)
    views = gltf.get("bufferViews", [])
    image_views = {img["bufferView"]: i for i, img in enumerate(gltf.get("images", [])) if "bufferView" in img}

    before, after = [], []
    blobs = []
    for index, view in enumerate(views):
        start = view.get("byteOffset", 0)
        blob = binary[start:start + view["byteLength"]]
        if index in image_views:
            blob, old, new = downscale(blob, args.max_size)
            before.append(old)
            after.append(new)
        blobs.append(blob)

    # Lay the buffer out again in the original order; every view stays 4-byte
    # aligned, and accessors (offsets *within* a view) need no change.
    rebuilt = bytearray()
    for view, blob in zip(views, blobs):
        rebuilt += b"\0" * (-len(rebuilt) % 4)
        view["byteOffset"] = len(rebuilt)
        view["byteLength"] = len(blob)
        rebuilt += blob
    gltf["buffers"][0]["byteLength"] = len(rebuilt)

    write_glb(args.output, gltf, bytes(rebuilt))
    shrunk = sum(1 for a, b in zip(before, after) if a != b)
    print(f"{args.output}: {args.output.stat().st_size / 1e6:.1f} MB "
          f"(was {args.input.stat().st_size / 1e6:.1f} MB)")
    print(f"textures resized: {shrunk} of {len(before)}; GPU texture memory "
          f"~{texture_bytes(before) / 1e6:.0f} MB -> ~{texture_bytes(after) / 1e6:.0f} MB")


if __name__ == "__main__":
    main()
