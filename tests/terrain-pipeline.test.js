const {
  assert,
  fs,
  path,
  test,
  vm,
  mobileWebKitTerrainFixture,
  operations,
  drawingContext,
  sandbox,
  sceneManagerSource,
  rendererSource,
  terrainGraphicsSource,
  terrainPipelineSource,
  cleaningSceneSource,
  trenchSceneSource,
  terrainWorkerSource,
  mainSource,
  indexSource,
  stylesSource,
  SceneManager,
  manager,
  surface,
  trench,
  grid
} = require("./helpers/scene-harness.js");

test("Focus smoothing and current ridges are the defaults and participate in the terrain cache key", () => {
  const scene = manager();
  const testGrid = { x: 10, y: 20, width: 200, height: 200, cellSize: 10 };
  const testTrench = { id: "ridge-cache", visualRevision: 2 };
  assert.equal(scene.terrainSmoothingMode, "focus");
  assert.equal(scene.ridgeDirectionMode, "current");

  const currentKey = scene.gridCacheKey(testTrench, testGrid);
  scene.ridgeDirectionMode = "high-cut";
  assert.notEqual(scene.gridCacheKey(testTrench, testGrid), currentKey);
});

test("terrain cache identity ignores overlay-only state and follows terrain revisions", () => {
  const scene = manager();
  const testGrid = { x: 10, y: 20, width: 200, height: 200, cellSize: 10 };
  const testTrench = { id: "terrain-only-cache", terrainRevision: 4, visualRevision: 7 };
  const initial = scene.gridCacheKey(testTrench, testGrid);

  scene.showDepthDebug = true;
  testTrench.visualRevision += 1;
  assert.equal(scene.gridCacheKey(testTrench, testGrid), initial);

  testTrench.terrainRevision += 1;
  assert.notEqual(scene.gridCacheKey(testTrench, testGrid), initial);
});

test("cached effect frames do not rebuild terrain topology", () => {
  const scene = manager();
  const testGrid = { x: 10, y: 20, width: 200, height: 200, cellSize: 10 };
  const testTrench = { id: "cache-test", visualRevision: 3 };
  let rebuilds = 0;
  scene.renderExcavationGrid = () => { rebuilds += 1; };
  sandbox.get = () => ({ cached: true });
  sandbox.image = () => {};

  scene.drawExcavationGrid(testTrench, testGrid);
  scene.drawExcavationGrid(testTrench, testGrid);

  assert.equal(rebuilds, 1);
  assert.equal(scene.terrainStats.cacheMisses, 1);
  assert.equal(scene.terrainStats.cacheHits, 1);
});

test("the terrain cache reuses its backing canvas until its pixel dimensions change", () => {
  const scene = manager();
  let allocations = 0;
  const canvases = [];
  sandbox.document = {
    createElement() {
      allocations += 1;
      const canvas = { width: 0, height: 0, getContext: () => drawingContext };
      canvases.push(canvas);
      return canvas;
    }
  };

  const first = scene.ensureGridCacheSurface({ width: 200, height: 180 });
  first.key = "old-revision";
  scene.invalidateTerrainCache();
  const reused = scene.ensureGridCacheSurface({ width: 200, height: 180 });
  assert.equal(reused, first);
  assert.equal(reused.key, "old-revision", "ordinary invalidation retains a compatible stale frame");
  assert.equal(allocations, 1);

  const replacement = scene.ensureGridCacheSurface({ width: 220, height: 180 });
  assert.notEqual(replacement, first);
  assert.equal(allocations, 2);
  assert.equal(canvases[0].width, 1, "the replaced backing surface is explicitly released");
  assert.equal(scene.effectStats.allocatedCanvasPixels, 220 * 180);
  delete sandbox.document;
});

test("releasing a fallback p5 image cache disposes its backing image", () => {
  const scene = manager();
  let removals = 0;

  scene.releaseCanvasBuffer({
    image: {
      remove() {
        removals += 1;
      }
    }
  });

  assert.equal(removals, 1);
});

test("profile rendering is rebuilt only when its visual identity changes", () => {
  const scene = manager();
  const profile = { x: 20, y: 30, width: 240, height: 180 };
  const testTrench = { id: "profile-cache", visualRevision: 2 };
  scene.layout = { isPortrait: false };
  let rebuilds = 0;
  scene.drawProfile = () => { rebuilds += 1; };
  sandbox.get = () => ({ cachedProfile: true });
  sandbox.image = () => {};

  scene.drawCachedProfile(testTrench, profile);
  scene.drawCachedProfile(testTrench, profile);
  assert.equal(rebuilds, 1);
  assert.equal(scene.frameStats.profileRebuilds, 1);
  assert.equal(scene.frameStats.profileCacheHits, 1);

  testTrench.visualRevision += 1;
  scene.drawCachedProfile(testTrench, profile);
  assert.equal(rebuilds, 2);
});

test("browser profile caching copies device pixels and reuses its backing surface", () => {
  const scene = manager();
  const profile = { x: 20.25, y: 30.5, width: 240, height: 180 };
  const testTrench = { id: "browser-profile-cache", visualRevision: 2 };
  const sourceCanvas = { width: 1600, height: 1200 };
  const previousSourceCanvas = drawingContext.canvas;
  const previousPixelDensity = sandbox.pixelDensity;
  const previousDocument = sandbox.document;
  const cacheCanvases = [];
  const cacheDraws = [];
  sandbox.pixelDensity = () => 2;
  sandbox.document = {
    createElement() {
      const context = {
        setTransform() {},
        clearRect() {},
        drawImage(...args) { cacheDraws.push(args); }
      };
      const canvas = { width: 0, height: 0, getContext: () => context };
      cacheCanvases.push(canvas);
      return canvas;
    }
  };
  drawingContext.canvas = sourceCanvas;
  scene.layout = { isPortrait: false };
  scene.drawProfile = () => {};

  try {
    const bounds = scene.profileCacheBounds(profile);
    scene.drawCachedProfile(testTrench, profile);
    assert.equal(cacheCanvases.length, 1);
    assert.deepEqual(cacheDraws[0], [
      sourceCanvas,
      bounds.x * 2,
      bounds.y * 2,
      bounds.width * 2,
      bounds.height * 2,
      0,
      0,
      bounds.width * 2,
      bounds.height * 2
    ]);

    scene.drawCachedProfile(testTrench, profile);
    assert.equal(cacheCanvases.length, 1, "the same profile dimensions reuse the canvas");

    profile.width += 12;
    scene.drawCachedProfile(testTrench, profile);
    assert.equal(cacheCanvases.length, 2);
    assert.equal(cacheCanvases[0].width, 1, "a resized profile explicitly releases the old surface");
    assert.equal(cacheCanvases[0].height, 1);
  } finally {
    drawingContext.canvas = previousSourceCanvas;
    if (previousPixelDensity === undefined) delete sandbox.pixelDensity;
    else sandbox.pixelDensity = previousPixelDensity;
    if (previousDocument === undefined) delete sandbox.document;
    else sandbox.document = previousDocument;
  }
});

test("terrain worker coalesces requests, closes stale bitmaps, and accepts only the desired key", () => {
  const scene = manager();
  const posted = [];
  scene.terrainWorker = { postMessage: (request) => posted.push(request) };
  scene.terrainPipeline.ensureTerrainWorker = () => scene.terrainWorker;
  let payloadBuilds = 0;
  scene.terrainPipeline.terrainWorkerPayload = (key) => {
    payloadBuilds += 1;
    return { key, jobId: ++scene.terrainWorkerSequence, requestedAt: 0 };
  };
  scene.terrainTimingNow = () => 20;
  const dummyTrench = {};
  const dummyGrid = {};
  scene.currentScene = "trench";
  scene.activeTrench = dummyTrench;
  scene.layout.grid = dummyGrid;
  scene.terrainPipeline.gridCacheKey = () => scene.terrainWorkerDesiredKey;

  assert.equal(scene.requestWorkerTerrain("first", dummyTrench, dummyGrid), true);
  assert.equal(scene.requestWorkerTerrain("second", dummyTrench, dummyGrid), true);
  assert.equal(posted.length, 1);
  assert.equal(scene.terrainWorkerPending.key, "second");
  assert.equal(payloadBuilds, 1, "pending requests remain lazy until dispatch");

  let staleClosed = 0;
  scene.handleTerrainWorkerMessage({
    type: "terrain-result",
    key: "first",
    bitmap: { close: () => { staleClosed += 1; } },
    timings: { total: 4 }
  });
  assert.equal(staleClosed, 1);
  assert.equal(posted.length, 2);
  assert.equal(payloadBuilds, 2);
  assert.equal(posted[1].key, "second");
  assert.equal(scene.terrainWorkerActive.key, "second");

  scene.handleTerrainWorkerMessage({
    type: "terrain-result",
    key: "second",
    bitmap: { close() {} },
    timings: { total: 5 },
    stats: { junctionsVisited: 441 }
  });
  assert.equal(scene.terrainWorkerResult.key, "second");
  assert.equal(scene.terrainStats.junctionsVisited, 441);
});

test("a worker result arriving after leaving the trench is closed as stale", () => {
  const scene = manager();
  let bitmapCloses = 0;
  let frameRequests = 0;
  scene.currentScene = "site";
  scene.terrainWorkerDesiredKey = "departed-trench";
  scene.terrainWorkerActive = { key: "departed-trench", requestedAt: 0 };
  scene.requestFrame = () => { frameRequests += 1; };

  scene.handleTerrainWorkerMessage({
    type: "terrain-result",
    key: "departed-trench",
    bitmap: { close: () => { bitmapCloses += 1; } },
    timings: { total: 4 }
  });

  assert.equal(bitmapCloses, 1);
  assert.equal(scene.terrainWorkerResult, null);
  assert.equal(scene.terrainStats.workerStaleResults, 1);
  assert.equal(frameRequests, 0);
});

test("requesting a newer terrain key closes an unpresented older worker bitmap", () => {
  const scene = manager();
  let closes = 0;
  scene.terrainWorkerResult = {
    key: "old-terrain",
    bitmap: { close: () => { closes += 1; } }
  };
  scene.terrainWorker = { postMessage() {} };
  scene.ensureTerrainWorker = () => scene.terrainWorker;
  scene.terrainWorkerPayload = (key) => ({ key, type: "render-terrain", requestedAt: 0 });

  scene.requestWorkerTerrain("new-terrain", {}, {});

  assert.equal(closes, 1);
  assert.equal(scene.terrainWorkerResult, null);
  assert.equal(scene.terrainStats.workerStaleResults, 1);
});

test("a terrain worker failure disables the worker once and selects synchronous fallback", () => {
  const scene = manager();
  let terminated = 0;
  let closed = 0;
  scene.terrainWorker = { terminate: () => { terminated += 1; } };
  scene.terrainWorkerActive = { key: "active" };
  scene.terrainWorkerPending = { key: "pending" };
  scene.terrainWorkerResult = { bitmap: { close: () => { closed += 1; } } };

  scene.handleTerrainWorkerMessage({ type: "terrain-error", key: "active", message: "unsupported" });
  assert.equal(scene.terrainWorkerDisabled, true);
  assert.equal(scene.terrainWorker, null);
  assert.equal(scene.terrainWorkerActive, null);
  assert.equal(scene.terrainWorkerPending, null);
  assert.equal(scene.terrainWorkerResult, null);
  assert.equal(scene.terrainStats.workerFallbacks, 1);
  assert.equal(terminated, 1);
  assert.equal(closed, 1);

  scene.disableTerrainWorker();
  assert.equal(scene.terrainStats.workerFallbacks, 1, "repeat error events do not double-count fallback");
});

test("worker-backed Full rendering creates one cold Lite preview when no compatible terrain exists", () => {
  const scene = manager();
  const testGrid = { x: 10, y: 20, width: 200, height: 200, cellSize: 10 };
  const testTrench = { id: "worker-preview", visualRevision: 3 };
  let renderOptions = null;
  let capturedKey = null;
  scene.requestWorkerTerrain = () => true;
  scene.renderExcavationGrid = (_trench, _grid, options) => { renderOptions = options; };
  let capturedQuality = null;
  scene.captureGridCache = (_bounds, key, _compatibilityKey, quality) => {
    capturedKey = key;
    capturedQuality = quality;
  };
  scene.drawExcavationGrid(testTrench, testGrid);
  assert.equal(renderOptions.forceLite, true);
  assert.match(capturedKey, /^cold-preview:/);
  assert.equal(capturedQuality, "cold-preview");
});

test("worker-backed Full rendering retains compatible terrain instead of repainting a Lite preview", () => {
  const scene = manager();
  const testGrid = { x: 10, y: 20, width: 200, height: 200, cellSize: 10 };
  const testTrench = {
    id: "worker-retained",
    rows: 20,
    columns: 20,
    terrainRevision: 4,
    artefacts: []
  };
  const cacheBounds = scene.gridCacheBounds(testGrid);
  scene.gridCache = {
    key: "older-full-key",
    compatibilityKey: scene.gridCacheCompatibilityKey(testTrench, cacheBounds),
    quality: "full",
    canvas: {}
  };
  scene.requestWorkerTerrain = () => true;
  scene.renderExcavationGrid = () => { throw new Error("compatible terrain should suppress the Lite preview"); };
  let cacheDraws = 0;
  scene.drawGridCache = () => { cacheDraws += 1; };

  scene.drawExcavationGrid(testTrench, testGrid);
  assert.equal(cacheDraws, 1);
  assert.equal(scene.gridCache.key, "older-full-key");
  assert.equal(scene.gridCache.quality, "full");
});

test("live depth and artefact overlays are redrawn above retained terrain", () => {
  const scene = manager();
  const testGrid = { x: 10, y: 20, width: 200, height: 200, cellSize: 10 };
  const testTrench = {
    id: "worker-live-overlays",
    rows: 20,
    columns: 20,
    terrainRevision: 1,
    artefacts: []
  };
  const cacheBounds = scene.gridCacheBounds(testGrid);
  scene.gridCache = {
    key: "older",
    compatibilityKey: scene.gridCacheCompatibilityKey(testTrench, cacheBounds),
    canvas: {}
  };
  scene.requestWorkerTerrain = () => true;
  scene.drawGridCache = () => {};
  let overlays = 0;
  scene.drawExcavationGridOverlays = () => { overlays += 1; };

  scene.drawExcavationGrid(testTrench, testGrid);
  scene.showDepthDebug = true;
  scene.drawExcavationGrid(testTrench, testGrid);
  assert.equal(overlays, 2);
});

test("live excavation overlays do not redraw the cached static grid border", () => {
  const scene = manager();
  let borderDraws = 0;
  scene.showDepthDebug = false;
  scene.drawExcavationGridBorder = () => { borderDraws += 1; };

  scene.drawExcavationGridOverlays({ artefacts: [] }, grid());

  assert.equal(borderDraws, 0);
});

test("the worker and main thread share the authoritative terrain geometry module", () => {
  assert.match(indexSource, /src\/game\/TerrainGraphics\.js/);
  assert.match(terrainWorkerSource, /importScripts\("\.\/TerrainGraphics\.js"\)/);
  assert.doesNotMatch(terrainWorkerSource, /SceneManager\.js/);
  assert.match(terrainWorkerSource, /transferToImageBitmap/);
  assert.match(terrainWorkerSource, /let terrainCanvas = null/);
  assert.match(terrainWorkerSource, /terrainSurface\(request\.pixelWidth, request\.pixelHeight\)/);
  assert.equal(SceneManager.prototype.buildLocalJunctionDescriptors,
    sandbox.window.TerrainGraphics.TerrainEngine.prototype.buildLocalJunctionDescriptors);
  assert.match(terrainGraphicsSource, /buildLocalJunctionDescriptors/);
  assert.match(terrainGraphicsSource, /collectPixelSnappedSurfacePatches/);
  assert.match(terrainGraphicsSource, /drawPixelSnappedSurfacePatches/);
  assert.match(terrainGraphicsSource, /collectAmbientOcclusion/);
});

test("the terrain worker starts without importing or evaluating SceneManager", () => {
  const importedScripts = [];
  const workerGlobal = {};
  const workerSandbox = {
    self: workerGlobal,
    OffscreenCanvas: class OffscreenCanvas {},
    importScripts(...scripts) {
      importedScripts.push(...scripts);
      workerGlobal.TerrainGraphics = {
        createEngine: () => ({ workerOnly: true }),
        render: () => ({ timings: {}, stats: {} })
      };
    }
  };

  assert.doesNotMatch(terrainWorkerSource, /SceneManager/);
  assert.doesNotThrow(() => vm.runInNewContext(terrainWorkerSource, workerSandbox));
  assert.deepEqual(importedScripts, ["./TerrainGraphics.js"]);
  assert.equal(typeof workerGlobal.onmessage, "function");
  assert.equal("SceneManager" in workerGlobal, false);
});
