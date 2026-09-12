# MISTLINE Atelier — editable vehicle sources

Open `mistline-atelier.blend` with Blender 5.2 or later. All seven original vehicle designs are arranged in two rows. Select a vehicle root in the Outliner and use Numpad `.` to frame it. These are newly authored procedural Blender meshes, not third-party car assets.

## Rebuild

From the repository directory in PowerShell:

```powershell
& 'C:/Program Files/Blender Foundation/Blender 5.2/blender.exe' --background --python tools/build-vehicles.py
npm.cmd run models:optimize
npm.cmd run build
```

The generator overwrites this `.blend` and `public/models/vehicles/*.glb`. Save hand-edited versions under a different name before rebuilding. The source is an editable mesh collection; it is not a rigged production automotive CAD asset.

## Runtime contract

- Metres. Blender +Y is forward, +Z is up. Export glTF Y-up: game forward is -Z.
- Move a source vehicle root back to `(0, 0, 0)` before manually exporting it; the source sheet is spaced out only for editing.
- Preserve `Steer_FL/FR` and `Spin_FL/FR/RL/RR` empties. Motorcycle uses `F/R`. Number suffixes are supported.
- Steering rotates around game Y. Wheel rotation is game X. Keep their local origins at axle centres.
- Materials `Paint` and `WheelFinish` support runtime customization. `optionalWing` extras gate the sports wing.
- Export only the selected root and its children, with extras enabled, animations/cameras/lights disabled.
- Keep models below approximately 25k triangles / 500KB. No texture download or decoder is necessary.
- The loader streams only a selected model. NPCs retain the existing lightweight geometry. Cockpits retain the existing interactive cockpit renderer.
- Game collision uses the existing vehicle dimensions and driving model, not visual mesh triangles.

`tools/optimize-vehicles.mjs` preserves material extensions, welds/deduplicates/prunes assets, and rejects glTF validation errors. `public/models/vehicles/manifest.json` records current geometry and file budgets. No geometry codec is used to avoid extra decoder download/CPU work on tablets.
