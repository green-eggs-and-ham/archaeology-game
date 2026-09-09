# Architecture

The prototype is a build-free p5.js application. Browser modules are classic scripts that publish their public classes on `window`, so the order in `index.html` is part of the runtime contract.

## Runtime layers

- `data/game-config.js` is the single source of configuration and catalogue data. `GameConfigValidator` checks it against the artefact visual registry before the game is constructed.
- `ArtefactCatalogue`, `TrenchModel`, and `CleaningModel` own deterministic catalogue selection and session state. They do not render the canvas.
- `ArtefactRenderer` owns reusable find silhouettes and face details. `GameRenderer` owns shared canvas controls and presentation primitives.
- `TerrainGraphics` contains terrain geometry shared by the browser and `TerrainWorker`. `TerrainPipeline` coordinates worker requests, cache reuse, and main-thread fallback rendering.
- `CleaningScene` and `TrenchScene` own scene-specific layout, drawing, and pointer behavior. `SceneManager` owns navigation, shared state, the redraw scheduler, and cross-scene services.
- `main.js` validates configuration, creates the responsive p5 canvas, and forwards Pointer Events to the manager.

Some extracted modules install compatibility methods on `SceneManager.prototype`. Keep the extracted module authoritative: new terrain or scene behavior belongs in its owning module rather than being copied back into `SceneManager`.

## Rendering and state

The canvas uses p5 `noLoop()` and redraws only after state, input, effects, or worker output changes. Full terrain can render in a worker; Lite terrain and live overlays remain on the main thread. Trench terrain and profile rasters are cached independently so cursor-only frames avoid rebuilding either surface.

Game progress is intentionally session-only. Models hold excavation, collection, and cleaning state in memory; resizing changes semantic layout positions without migrating gameplay data.

## Dependency order

Load configuration and validation first, then catalogue/models, renderers, terrain modules, scenes, `SceneManager`, and finally `main.js`. When adding a classic script, update both the ordered tags and `GameBoot.total`.
