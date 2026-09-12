# MISTLINE / Handle with care

A Three.js driving game with a first careful-delivery route, free driving, seven selectable vehicles, and existing peer multiplayer.

## Play locally

```powershell
npm.cmd install
npm.cmd run dev -- --port 4173
```

Choose **소중한 배달 / CAREFUL DELIVERY** in the garage. Carry a cake 900 metres to MIST BAKERY. Avoid harsh acceleration, cornering, braking and impacts. Stop in the green roadside bay for 1.5 seconds to receive a condition-based S–D grade. There is no deadline. Road recovery costs 3 condition points. A ruined cake can still be delivered with grade D; retry from the receipt.

Keyboard: W throttle, A/D steer, S brake/reverse, Shift boost, Space handbrake, C camera, R recover, Q time, E season, Escape pause. Mobile uses the joystick, latched boost, handbrake, and top-edge camera/recovery buttons. Delivery damage, time and sway pause with the game. Free drive disables the delivery overlay/rules. Multiplayer continues as shared driving; delivery scoring is local, not a synchronized team mission.

## Assets and rendering

The seven new Blender exteriors are in `public/models/vehicles/`; editable originals and regeneration instructions are in `art/vehicles/`. The cars retain their existing handling profiles and interactive interiors. Selected models load on demand with a procedural fallback on failure. NPCs keep their lightweight models. Showroom reflections use a generated environment; daylight shadows use soft filtering. Chase cameras use frame-rate-independent damping and a reduced speed/FOV change; cockpit cameras remain rigidly attached. Time-of-day lighting eases to the new setting.

## Verification

```powershell
npm.cmd run build
npm.cmd test
```

Tests use Chrome on this Windows machine (path in `playwright.config.ts`). They cover cargo rules, model bounds/pivots, seven vehicle selections, driving/cockpit/pause, delivery completion/retry, free drive, and 390×844 / 844×390 / 820×1180 touch layouts. Screenshots are written to `art/qa/` (git-ignored). These viewport tests do not establish frame rates on physical low-end devices.

`?qa` exposes simulation handles only during Vite development for deterministic arrival/pause tests. Production builds omit the test hook. GitHub Actions builds with the repository subpath; models use Vite's base URL.
