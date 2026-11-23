# Architecture

The prototype is a build-free p5.js application. Browser modules are classic scripts that publish their public classes on `window`, so the order in `index.html` is part of the runtime contract.

## Runtime layers

- `data/game-config.js` is the single source of configuration and catalogue data. `GameConfigValidator` checks it against the artefact visual registry before the game is constructed.
- `ArtefactCatalogue`, `TrenchModel`, and `CleaningModel` own deterministic catalogue selection and session state. They do not render the canvas.
- `ArtefactRenderer` owns reusable find silhouettes and face details. `GameRenderer` owns shared canvas controls and presentation primitives.
- `TerrainGraphics` contains terrain geometry shared by the browser and `TerrainWorker`. `TerrainPipeline` coordinates worker requests, cache reuse, and main-thread fallback rendering.
- `TrenchPreviewGraphics` raycasts isometric height fields using the shared terrain corner rules and artefact silhouettes. `TrenchPreviewPipeline` owns a dedicated worker, bounded per-trench caches, revision checks, idle preparation and sliced fallback rendering. `SiteMapScene` owns the connected ground plane, selection layout and preparation gate.
- `CleaningScene` and `TrenchScene` own scene-specific layout, drawing, and pointer behavior. `SceneManager` owns navigation, shared state, the redraw scheduler, and cross-scene services.
- `main.js` validates configuration, creates the responsive p5 canvas, and forwards Pointer Events to the manager.

Some extracted modules install compatibility methods on `SceneManager.prototype`. Keep the extracted module authoritative: new terrain or scene behavior belongs in its owning module rather than being copied back into `SceneManager`.

## Rendering and state

The canvas uses p5 `noLoop()` and redraws only after state, input, effects, or worker output changes. Full terrain can render in a worker; Lite terrain and live overlays remain on the main thread. The profile caches the exposed centre-row columns separately from its markers and discovered-layer key. Each changed column repaints its overlapping device pixels in draw order. The Finds Lab caches the inventory order, visible page and corresponding touch targets. The active find, water and particles still draw on each requested frame.

Game progress is intentionally session-only. Models hold excavation, collection, and cleaning state in memory; resizing changes semantic layout positions without migrating gameplay data.

Site previews use 512×256 Full or 256×128 Lite colour and visibility buffers. Each screen column traverses the smoothed height field from front to back. The closest visible floor or wall determines depth, sediment, lighting and which portions of a find can appear. Each wall pixel integrates the geological layers and fine depth marking over its visible span.

A completed preview includes the canonical bitmap, half-size colour buffers down to 16 pixels wide, and one image fitted to the current opening when reduction is needed. The worker or sliced fallback computes the fit on the canvas backing-pixel grid, including fractional tile placement and CSS scaling. A resize filters the existing colours once at the new size. Grid references draw outside the two upper edges of the completed site. Progress badges follow individual trench rims. Both map styles use the same ground-plane projection and selection targets.

Geometry follows `terrainRevision`, quality and renderer version. Find composition also follows `visualRevision`. While finds are visible, the renderer retains the last completed filtered colours so an exposure or collection change only refilters the affected footprints. The main thread and worker own independent buffers. The memory counters include those buffers and fitted images.

The initial nine previews are counted in boot progress. Successful excavation/exposure changes always retain dirty state. The session-only `isoOnPause` diagnostic defaults Off: no speculative jobs are enqueued during excavation or subsequent pauses. When On, one shared timer coalesces changes and prepares the latest dirty revisions 250 ms after release. Held or rejected excavation presses cannot qualify as a pause. Entering the Finds Lab flushes dirty work, prioritises the most recently changed trench and keeps preparing during cleaning gestures, independently of the toggle. Lab queues park while inspecting a trench, though an already active job may finish offscreen.

Starting a brush or shovel press cancels speculative jobs and timers, removes pending speculative requests and preserves dirty state and completed previews. Turning the pause option Off cancels pause-origin work only. One job runs at a time. The dedicated worker accepts `render-preview` and `cancel-preview`, acknowledges active cancellation with `preview-cancelled`, and advances the rendering generator in approximately 8 ms chunks using a `MessageChannel`. Cancelling returns the generator, releasing temporary arrays without terminating the worker. New terrain enters its geometry cache only after the complete preview succeeds, including find composition.

Both scene return routes call `enterSiteMap`, and the site remains covered until every displayed preview matches its model revision and quality. These urgent requests bypass the pause toggle. Worker results are cached offscreen; obsolete job IDs and revisions cannot replace current previews or consume a newer job. Unsupported workers, errors and five-second watchdog timeouts use the same renderer in approximately 4 ms cancellable main-thread slices. Intentional cancellation clears its watchdog and is counted independently of failure. A renderer failure restores the flat comparison rather than leaving navigation blocked.

The eight-option debug menu includes Map: Relief/Flat, ISO on pause, preview rebuilds, cache hits, retained memory, active rendering time, total request latency and cancellation counts. `previewStats` also retains queue time, maximum chunk time and the most recent cancelled job's compute time. Active time sums generator work; elapsed latency includes scheduling, queueing and delivery. Preview bitmaps, height/visibility buffers and the ground canvas are bounded and released on replacement or disposal. A shell resize observer follows layout changes after loading without invalidating trench preview caches. Reproducible stress fixtures and the browser harness are documented in [ISO performance measurements](iso-preview-performance.md).

## Dependency order

Load configuration and validation first, then catalogue/models, renderers, terrain modules, scenes, `SceneManager`, and finally `main.js`. When adding a classic script, update both the ordered tags and `GameBoot.total`.
