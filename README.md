# MISTLINE / Atelier

A Three.js free-driving game with seven selectable Blender vehicles, an Atelier showroom, and peer multiplayer.

## Play locally

```powershell
npm.cmd install
npm.cmd run dev -- --port 4173
```

Choose a vehicle and map in the garage, then select **DRIVE** to explore freely.

Keyboard: W throttle, A/D steer, S brake/reverse, Shift boost, Space handbrake, C camera, R recover, Q time, E season, Escape pause. Mobile uses the joystick, latched boost, handbrake, and top-edge camera/recovery buttons.

## Assets and rendering

The seven new Blender exteriors are in `public/models/vehicles/`; editable originals and regeneration instructions are in `art/vehicles/`. The cars retain their existing handling profiles and interactive interiors. Selected models load on demand with a procedural fallback on failure. NPCs keep their lightweight models. Showroom reflections use a generated environment; daylight shadows use soft filtering. Chase cameras use frame-rate-independent damping and a reduced speed/FOV change; cockpit cameras remain rigidly attached. Time-of-day lighting eases to the new setting.

## Verification

```powershell
npm.cmd run build
npm.cmd test
```

Tests use Chrome on this Windows machine (path in `playwright.config.ts`). They cover model bounds/pivots, seven vehicle selections, free driving/cockpit/pause, absence of delivery UI, and 390×844 / 844×390 / 820×1180 touch layouts. Screenshots are written to `art/qa/` (git-ignored). These viewport tests do not establish frame rates on physical low-end devices.

GitHub Actions builds with the repository subpath; models use Vite's base URL.
