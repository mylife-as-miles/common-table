"""Reproduce the table-only runtime assets with Blender + Pillow.

python3 scripts/table-only/build_assets.py
Raw PNG intermediates are removed after WebP conversion. No guest names baked.
"""
from pathlib import Path
import argparse
import json
import subprocess
from PIL import Image

root = Path(__file__).resolve().parents[2]
output = root / 'public/images/table'
parser = argparse.ArgumentParser()
parser.add_argument('--seats', nargs='+', type=int, default=list(range(1,7)), choices=range(1,7))
args = parser.parse_args()
for count in args.seats:
    subprocess.run(['blender', '-b', '-t', '5', '--python', str(root / 'scripts/table-only/render_table.py'), '--', '--seats', str(count), '--samples', '80', '--size', '1100'], cwd=root, check=True)
    raw = output / f'table-{count}.png'
    with Image.open(raw) as image:
        image.convert('RGB').save(output / f'table-{count}.webp', 'WEBP', quality=88, method=6)
    raw.unlink()
manifest = {str(count): json.loads((output / f'table-{count}.json').read_text()) for count in range(1, 7)}
(root / 'src/components/table-only/projections.json').write_text(json.dumps(manifest, separators=(',', ':')) + '\n')
