# Kart

- [controller](/kart/controller.md) — Rapier impulse-based kart physics:
  suspension, grip, drift, reset, buoyancy
- [kart-mesh](/kart/kart-mesh.md) — Procedural kart mesh built from the
  per-file model registry (`src/kart/models/`), rounded chassis + colorway
  paints, shared kart visual builder, visual sync, chase camera, and LOD
- [vfx](/kart/vfx.md) — GPU particle effects: dust, drift smoke, splash, respawn poof
- [kart-variants](/kart/kart-variants.md) — Kart archetypes derived from the
  model registry: tuning, silhouette, stock colorway, and stat bars
- [measurement](/kart/measurement.md) — Derived kart dimensions
  (wheelbase/track/ride height + real mesh bounds) for the garage and tests
- [free-fly-camera](/kart/free-fly-camera.md) — Spectator free-fly camera,
  selectable from the main menu CAMERA row (CHASE|FREE-FLY, persisted) or
  `?freefly`, KeyC toggle, seeded from the live view + pose HUD
- [skid-marks](/kart/skid-marks.md) — Terrain-conformed skid marks with age-fade shader
- [snow-tracks](/kart/snow-tracks.md) — Living depth-profiled snow tire tracks:
  berm/channel relief via shading, snowfall-driven fade, terrain untouched
- [imported-mesh-pipeline](/kart/imported-mesh-pipeline.md) — Experimental method:
  car photo to imported kart mesh via Hunyuan3D on Apple Silicon, the image
  prompt, and the `ownWheels` wiring pattern
