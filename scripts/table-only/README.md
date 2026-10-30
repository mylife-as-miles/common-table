# Common Table physical table assets

The scene, geometry, procedural materials, camera, lights and projection metadata
are original to this repository. No third-party restaurant assets or models are
used. Guest names and selected state are live DOM content, never baked into images.

Run `python3 scripts/table-only/build_assets.py` with Blender 4.3+ and Python Pillow
installed. The script renders six arrangements at 1100×1100, converts each to WebP
and removes raw PNG intermediates. `render_table.py --metadata-only` exports the
same camera projection without rendering. The normal build does not run Blender.

Lighting, refraction, contact shadows, materials and table geometry are baked
offline with Cycles. This is not a real-time 3D renderer. The browser loads the selected seat-count image, prewarms the next possible
arrangement, and projects native seat controls and live place-card text onto that
exact image. Responsive resizing uses the same aspect ratio and
source-camera coordinates. The small optional pointer tilt transforms image and
controls together. Low-power and reduced-motion modes retain static imagery and
fully working controls without a render loop.
