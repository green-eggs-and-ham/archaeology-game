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

test("scene controllers expose one consistent lifecycle and pointer contract", () => {
  const scene = manager();
  const contract = [
    "enter", "leave", "draw", "handleResize",
    "pointerStart", "pointerMove", "pointerEnd", "pointerCancel", "cursorPresentation"
  ];
  for (const controller of [scene.trenchScene, scene.cleaningScene]) {
    contract.forEach((method) => assert.equal(typeof controller[method], "function", `${controller.constructor.name}.${method}`));
  }
  assert.equal(scene.trenchScene.terrainPipeline, scene.terrainPipeline);
  assert.equal(scene.trenchScene.brushParticles, scene.brushParticles);
  assert.equal(scene.cleaningScene.cleaningDirtParticles, scene.cleaningDirtParticles);
});

test("scene controllers route lifecycle and pointer behavior through a real coordinator", () => {
  const scene = manager();
  const calls = [];
  const methods = {
    selectTrench: (...args) => calls.push(["trench-enter", ...args]),
    drawTrench: () => calls.push(["trench-draw"]),
    trenchPointerStart: (...args) => calls.push(["trench-start", ...args]),
    trenchPointerMove: (...args) => calls.push(["trench-move", ...args]),
    trenchPointerEnd: (...args) => calls.push(["trench-end", ...args]),
    trenchPointerCancel: (...args) => calls.push(["trench-cancel", ...args]),
    enterCleaningLab: () => calls.push(["cleaning-enter"]),
    drawCleaning: () => calls.push(["cleaning-draw"]),
    cleaningPointerStart: (...args) => calls.push(["cleaning-start", ...args]),
    cleaningPointerMove: (...args) => calls.push(["cleaning-move", ...args]),
    cleaningPointerEnd: (...args) => calls.push(["cleaning-end", ...args])
  };
  Object.assign(scene, methods);

  const trench = { id: "controller-contract" };
  scene.trenchScene.enter(trench);
  scene.trenchScene.draw();
  scene.trenchScene.pointerStart(1, 2, "mouse");
  scene.trenchScene.pointerMove(3, 4, "touch");
  scene.trenchScene.pointerEnd(5, 6, "mouse");
  scene.trenchScene.pointerCancel(7, 8, "touch");
  scene.cleaningScene.enter();
  scene.cleaningScene.draw();
  scene.cleaningScene.pointerStart(9, 10);
  scene.cleaningScene.pointerMove(11, 12);
  scene.cleaningScene.pointerEnd(13, 14);

  assert.deepEqual(calls, [
    ["trench-enter", trench],
    ["trench-draw"],
    ["trench-start", 1, 2, "mouse"],
    ["trench-move", 3, 4, "touch"],
    ["trench-end", 5, 6, "mouse"],
    ["trench-cancel", 7, 8, "touch"],
    ["cleaning-enter"],
    ["cleaning-draw"],
    ["cleaning-start", 9, 10],
    ["cleaning-move", 11, 12],
    ["cleaning-end", 13, 14]
  ]);

  scene.profileCache = { canvas: { width: 20, height: 20 } };
  scene.collectionFlights.push({});
  scene.brushParticles.push({});
  scene.depositedClumps.push({});
  scene.trenchScene.handleResize();
  assert.equal(scene.profileCache, null);
  assert.equal(scene.collectionFlights.length, 0);
  assert.equal(scene.brushParticles.length, 0);
  assert.equal(scene.depositedClumps.length, 0);

  scene.cleaningInventorySortChooserOpen = true;
  scene.cleaningWaterDrops.push({});
  scene.cleaningRipples.push({});
  scene.cleaningDirtParticles.push({});
  scene.cleaningScene.handleResize();
  assert.equal(scene.cleaningInventorySortChooserOpen, false);
  assert.equal(scene.cleaningWaterDrops.length, 0);
  assert.equal(scene.cleaningRipples.length, 0);
  assert.equal(scene.cleaningDirtParticles.length, 0);
});

test("canvas pointers convert to floating-point cell-centre coordinates", () => {
  const scene = manager();
  scene.layout.grid = { x: 100, y: 50, width: 200, height: 200, cellSize: 10 };

  const cellCentre = scene.toolCenterAt(105, 55);
  const junction = scene.toolCenterAt(110, 60);
  assert.equal(cellCentre.x, 0);
  assert.equal(cellCentre.y, 0);
  assert.equal(junction.x, 0.5);
  assert.equal(junction.y, 0.5);
});

test("pointer and effect redraw requests share one animation-frame gate", () => {
  const scene = manager();
  const callbacks = [];
  let redraws = 0;
  sandbox.requestAnimationFrame = (callback) => {
    callbacks.push(callback);
    return callbacks.length;
  };
  sandbox.redraw = () => { redraws += 1; };

  for (let index = 0; index < 100; index += 1) scene.pointerHover(index, index + 1);
  scene.scheduleEffectFrame();
  assert.equal(callbacks.length, 1);
  assert.equal(redraws, 0);
  assert.equal(scene.pointer.x, 99);
  assert.equal(scene.pointer.y, 100);
  callbacks.shift()();
  assert.equal(redraws, 1);
  assert.equal(scene.frameStats.requests, 101);
  assert.equal(scene.frameStats.coalesced, 100);

  delete sandbox.requestAnimationFrame;
  sandbox.redraw = () => {};
});

test("a direct draw consumes a queued frame instead of presenting a duplicate redraw", () => {
  const scene = manager();
  const callbacks = new Map();
  let nextFrameId = 0;
  let redraws = 0;
  sandbox.requestAnimationFrame = (callback) => {
    nextFrameId += 1;
    callbacks.set(nextFrameId, callback);
    return nextFrameId;
  };
  sandbox.cancelAnimationFrame = (frameId) => {
    callbacks.delete(frameId);
  };
  sandbox.redraw = () => { redraws += 1; };
  scene.renderer.drawBackground = () => {};
  scene.drawSiteMap = () => {};
  scene.drawDebugMenu = () => {};
  scene.drawCustomPointer = () => {};

  scene.requestFrame();
  assert.equal(scene.frameRequestPending, true);
  assert.equal(callbacks.size, 1);

  scene.draw();
  assert.equal(scene.frameRequestPending, false);

  [...callbacks.values()].forEach((callback) => callback());
  assert.equal(redraws, 0);

  delete sandbox.requestAnimationFrame;
  delete sandbox.cancelAnimationFrame;
  sandbox.redraw = () => {};
});

test("coalesced brush movement processes every input segment before one visual frame", () => {
  const scene = manager();
  const callbacks = [];
  const samples = [];
  sandbox.requestAnimationFrame = (callback) => { callbacks.push(callback); };
  scene.currentScene = "trench";
  scene.pointer = { x: 0, y: 0, source: "mouse", pressed: true };
  scene.pointerAction = { type: "brush" };
  scene.advanceBrushPath = (x, y) => {
    samples.push([x, y]);
    scene.requestFrame();
  };

  for (let index = 0; index < 20; index += 1) scene.pointerMove(index, index * 2, "mouse");
  assert.equal(samples.length, 20);
  assert.equal(callbacks.length, 1);

  delete sandbox.requestAnimationFrame;
});

test("compact canvases cap high-density phones at DPR 2 within the pixel budget", () => {
  const context = {
    window: {
      innerWidth: 375,
      innerHeight: 667,
      devicePixelRatio: 3,
      GameConfig: {
        canvas: {
          compactBreakpoint: 640,
          compactPixelDensity: 2,
          maxCompactCanvasPixels: 1300000
        }
      }
    },
    document: {}
  };
  vm.createContext(context);
  vm.runInContext(mainSource, context);
  assert.equal(context.getCanvasPixelDensity({ width: 375, height: 500 }), 2);
  context.window.innerWidth = 360;
  assert.equal(context.getCanvasPixelDensity({ width: 360, height: 480 }), 2);
  context.window.innerWidth = 560;
  assert.equal(context.getCanvasPixelDensity({ width: 560, height: 747 }), 1, "the bounded pixel budget prevents an oversized backing surface");
  context.window.innerWidth = 960;
  assert.equal(context.getCanvasPixelDensity({ width: 960, height: 540 }), 1);
  assert.match(mainSource, /pixelDensity\(activeCanvasDensity\);\s*const canvas = createCanvas/s);
});

test("the page reserves its canvas and exposes progressive boot and failure states", () => {
  assert.match(indexSource, /class="canvas-skeleton"/);
  assert.match(indexSource, /id="game-loading-progress"/);
  assert.match(indexSource, /GameBoot\.resourceLoaded\(\)/);
  assert.match(indexSource, /GameBoot\.resourceFailed/);
  assert.match(indexSource, /loader\.remove\(\)/);
  assert.match(indexSource, /querySelectorAll\("#p5_loading"\)/);
  assert.equal((indexSource.match(/<script defer/g) || []).length, 15);
  assert.match(indexSource, /window\.GameBoot\s*=\s*\{[\s\S]*?total:\s*15,/);
  assert.match(indexSource, /GameConfigValidator\.js[\s\S]*ArtefactCatalogue\.js[\s\S]*TrenchModel\.js/);
  assert.match(indexSource, /ArtefactRenderer\.js[\s\S]*Renderer\.js/);
  assert.match(indexSource, /TerrainGraphics\.js[\s\S]*TerrainPipeline\.js/);
  assert.match(indexSource, /CleaningScene\.js[\s\S]*TrenchScene\.js[\s\S]*SceneManager\.js[\s\S]*main\.js/);
  assert.match(mainSource, /GameConfigValidator\.validate\(window\.GameConfig/);
  assert.match(mainSource, /visualRegistry:\s*window\.ArtefactRenderer\.visualRegistry\(\)/);
  assert.match(stylesSource, /max-width:\s*min\(1280px/);
  assert.match(stylesSource, /aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(stylesSource, /@media \(max-width: 640px\).*aspect-ratio:\s*3\s*\/\s*4/s);
  assert.doesNotMatch(indexSource, /A portable excavation and artefact-care prototype/);
  assert.doesNotMatch(indexSource, /<header class="hero">/);
  assert.match(stylesSource, /100dvh/);
});

test("the worker reports the exact rounded backing-surface dimensions", () => {
  assert.match(terrainWorkerSource, /sourcePixelWidth:\s*request\.pixelWidth/);
  assert.match(terrainWorkerSource, /sourcePixelHeight:\s*request\.pixelHeight/);
  assert.doesNotMatch(terrainWorkerSource, /sourcePixelWidth:\s*request\.width\s*\*\s*request\.density/);
});

test("configured clump motion decays at thirty cell units per second squared", () => {
  const jsConfigSource = fs.readFileSync(path.join(__dirname, "../data/game-config.js"), "utf8");
  assert.match(jsConfigSource, /clumpDecelerationCellsPerSecondSquared:\s*30/);
  assert.match(trenchSceneSource, /clumpDecelerationCellsPerSecondSquared \|\| 30/);
  assert.match(jsConfigSource, /brushParticleLimitFull:\s*384/);
  assert.match(jsConfigSource, /brushParticleLimitLite:\s*128/);
});
