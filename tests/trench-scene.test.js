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
  grid,
  configureBrushScene
} = require("./helpers/scene-harness.js");

test("the debug ridge control toggles direction while retaining compatible terrain during rebuilding", () => {
  const scene = manager();
  scene.currentScene = "trench";
  scene.ridgeDirectionMode = "current";
  scene.gridCache = { key: "stale" };
  scene.activateDebugOption("ridge");
  assert.equal(scene.ridgeDirectionMode, "high-cut");
  assert.equal(scene.gridCache.key, "stale");
  assert.equal(scene.terrainWorkerDesiredKey, null);
});

test("all six diagnostics live in a two-column overlay without reserving scene space", () => {
  const scene = manager();
  sandbox.width = 600;
  sandbox.height = 400;
  scene.debugMenuOpen = true;
  const debug = scene.debugMenuLayout();
  assert.equal(debug.options.length, 6);
  assert.deepEqual(Array.from(debug.options, (entry) => entry.id), ["depth", "performance", "smoothing", "pillar", "ridge", "water"]);
  assert.equal(debug.button.width, 44);
  assert.equal(debug.button.height, 44);
  debug.options.forEach((option) => {
    assert.ok(option.bounds.x >= debug.panel.x && option.bounds.x + option.bounds.width <= debug.panel.x + debug.panel.width);
    assert.ok(option.bounds.y >= debug.panel.y && option.bounds.y + option.bounds.height <= debug.panel.y + debug.panel.height);
  });
  delete sandbox.width;
  delete sandbox.height;
});

test("an outside tap closes the debug overlay before the underlying scene handles it", () => {
  const scene = manager();
  sandbox.width = 600;
  sandbox.height = 400;
  scene.currentScene = "site";
  scene.debugMenuOpen = true;
  const debug = scene.debugMenuLayout();
  scene.layout = { debugButton: debug.button, debugPanel: debug.panel, debugOptions: debug.options };
  scene.requestFrame = () => {};
  let mapHits = 0;
  scene.hitMapTile = () => { mapHits += 1; return null; };
  scene.pointerStart(5, 5, "mouse");
  assert.equal(scene.debugMenuOpen, false);
  assert.equal(mapHits, 0);
  delete sandbox.width;
  delete sandbox.height;
});

test("performance mode participates in caching and Lite locks visual comparison controls", () => {
  const scene = manager();
  const testGrid = { x: 10, y: 20, width: 200, height: 200, cellSize: 10 };
  const testTrench = { id: "performance-cache", visualRevision: 2 };
  const fullKey = scene.gridCacheKey(testTrench, testGrid);
  scene.performanceMode = "lite";
  assert.notEqual(scene.gridCacheKey(testTrench, testGrid), fullKey);

  scene.gridCache = { key: "stale" };
  scene.ambientBuffer = { stale: true };
  const originalSmoothing = scene.terrainSmoothingMode;
  sandbox.width = 600;
  sandbox.height = 400;
  scene.debugMenuOpen = true;
  assert.equal(scene.debugMenuLayout().options.find((option) => option.id === "smoothing").disabled, true);
  assert.equal(scene.terrainSmoothingMode, originalSmoothing);
  scene.activateDebugOption("performance");
  assert.equal(scene.performanceMode, "full");
  assert.equal(scene.gridCache.key, "stale");
  assert.equal(scene.ambientBuffer, null);
  delete sandbox.width;
  delete sandbox.height;
});

test("scoop clumps use the reduced portrait multiplier for carried and deposited effects", () => {
  const scene = manager();
  scene.activeTrench = { scoopRadius: 3 };
  scene.layout = { isPortrait: false, grid: { cellSize: 10 } };
  assert.equal(scene.scoopClumpSize(), 57);

  scene.layout.isPortrait = true;
  assert.equal(scene.scoopClumpSize(), 37.5);

  sandbox.millis = () => 100;
  scene.scheduleEffectFrame = () => {};
  scene.spawnDepositedClump(12, 18, ["#aa7744"]);
  assert.equal(scene.depositedClumps[0].size, 37.5);
});

test("brush stamping starts immediately then uses cumulative back-and-forth travel", () => {
  const scene = manager();
  const stamps = [];
  configureBrushScene(scene, stamps);

  scene.pointerStart(105, 105);
  assert.equal(stamps.length, 1, "pressing creates the initial stamp");
  scene.pointerMove(120, 105);
  assert.equal(stamps.length, 1, "half a threshold is retained without stamping");
  scene.pointerMove(105, 105);
  assert.equal(stamps.length, 2, "return travel completes the cumulative threshold in the same footprint");
  assert.equal(scene.pointerAction.travelRemainder, 0);
});

test("brush path interpolation emits every threshold crossing and retains its remainder", () => {
  const scene = manager();
  const stamps = [];
  configureBrushScene(scene, stamps);
  scene.pointerStart(105, 105);
  scene.pointerMove(170, 105);

  assert.equal(stamps.length, 3, "the initial stamp plus two path stamps are emitted");
  assert.ok(Math.abs(stamps[1].x - 3) < 1e-9);
  assert.ok(Math.abs(stamps[2].x - 6) < 1e-9);
  assert.equal(scene.pointerAction.travelRemainder, 5);
});

test("brush travel outside the trench and the re-entry jump do not count", () => {
  const scene = manager();
  const stamps = [];
  configureBrushScene(scene, stamps);
  scene.pointerStart(105, 105);
  scene.pointerMove(90, 105);
  assert.equal(scene.pointerAction.travelRemainder, 5, "only the in-trench distance to the edge is retained");
  scene.pointerMove(105, 105);
  assert.equal(scene.pointerAction.travelRemainder, 5, "re-entry establishes a new start without adding its jump");
  scene.pointerMove(130, 105);
  assert.equal(stamps.length, 2, "only new in-trench travel completes the threshold");
});

test("the player-facing tool name is Shovel while internal scoop APIs remain intact", () => {
  assert.equal(trenchSceneSource.includes('"Scoop"'), false);
  assert.equal(trenchSceneSource.includes('"Shovel"'), true);
  assert.equal(fs.readFileSync(path.join(__dirname, "../README.md"), "utf8").includes("shovel-loads"), true);
});

test("every trench entry resets excavation to Shovel", () => {
  const scene = manager();
  assert.equal(scene.tool, "scoop");
  scene.tool = "brush";
  scene.selectTrench({ id: "first" });
  assert.equal(scene.tool, "scoop");
  assert.match(scene.message, /shovel-load/);
  scene.tool = "brush";
  scene.selectTrench({ id: "revisit" });
  assert.equal(scene.tool, "scoop");
});

test("effect storage is FIFO-bounded and Lite mode applies the reduced limits", () => {
  const scene = manager();
  scene.config.trench.effects = {
    brushParticleLimitFull: 384,
    brushParticleLimitLite: 128,
    clumpLimitFull: 16,
    clumpLimitLite: 8
  };
  scene.config.cleaning = {
    effects: {
      waterDroplets: 10,
      waterRipples: 2,
      dirtParticlesPerEvent: 8,
      dirtParticleLimit: 80,
      liteDirtParticleLimit: 40,
      liteWaterDropletLimit: 20,
      liteWaterRippleLimit: 4,
      liteSpawnScale: 0.5
    }
  };
  scene.performanceMode = "lite";
  scene.layout = {
    grid: { x: 0, y: 0, width: 200, height: 200, cellSize: 10 },
    isPortrait: false,
    bucketWater: { x: 0, y: 0, width: 100, height: 30 }
  };
  scene.activeTrench = { scoopRadius: 3 };
  scene.scheduleEffectFrame = () => {};
  sandbox.millis = () => 100;

  for (let index = 0; index < 80; index += 1) {
    scene.spawnBrushParticles({ x: 10, y: 10 }, { colour: "#886644" });
    scene.spawnDepositedClump(20, 20, ["#886644"]);
    scene.spawnCleaningWaterEffects();
    scene.spawnCleaningDirtParticles(
      Array.from({ length: 8 }, (_, spot) => ({ x: spot / 10, y: 0.5, amount: 0.5 })),
      { x: 0, y: 0, width: 100, height: 100, size: 80 }
    );
  }

  assert.equal(scene.brushParticles.length, 128);
  assert.equal(scene.depositedClumps.length, 8);
  assert.equal(scene.cleaningWaterDrops.length, 20);
  assert.equal(scene.cleaningRipples.length, 4);
  assert.equal(scene.cleaningDirtParticles.length, 40);
  assert.equal(scene.effectStats.brushParticleActive, 128);
  assert.equal(scene.effectStats.clumpActive, 8);
  assert.equal(scene.effectStats.cleaningEffectActive, 64);
});

test("excavation particles draw a cheap offset earth shadow before their soil fill", () => {
  const scene = manager();
  const previous = {
    millis: sandbox.millis,
    color: sandbox.color,
    red: sandbox.red,
    green: sandbox.green,
    blue: sandbox.blue,
    fill: sandbox.fill,
    circle: sandbox.circle
  };
  const draws = [];
  sandbox.millis = () => 100;
  sandbox.color = () => ({ r: 120, g: 90, b: 60 });
  sandbox.red = (value) => value.r;
  sandbox.green = (value) => value.g;
  sandbox.blue = (value) => value.b;
  sandbox.fill = (...values) => draws.push(["fill", ...values]);
  sandbox.circle = (...values) => draws.push(["circle", ...values]);
  scene.scheduleEffectFrame = () => {};
  scene.brushParticles = [{
    x: 20,
    y: 30,
    vx: 0,
    vy: 0,
    size: 6,
    colour: "#785a3c",
    startedAt: 0,
    duration: 200
  }];
  scene.depositedClumps = [];

  scene.drawExcavationEffects();
  const fills = draws.filter((draw) => draw[0] === "fill");
  const circles = draws.filter((draw) => draw[0] === "circle");
  assert.deepEqual(fills[0].slice(1, 4), [45, 31, 22]);
  assert.ok(circles[0][1] > circles[1][1]);
  assert.ok(circles[0][2] > circles[1][2]);
  assert.ok(circles[0][3] > circles[1][3]);
  assert.doesNotMatch(sceneManagerSource, /shadowBlur|shadowColor/);

  Object.assign(sandbox, previous);
});

test("in-place effect compaction keeps the same array and releases expired entries", () => {
  const scene = manager();
  const items = [{ active: true }, { active: false }, { active: true }];
  const identity = items;
  scene.compactActive(items, (item) => item.active);
  assert.equal(items, identity);
  assert.deepEqual(items, [{ active: true }, { active: true }]);
});

test("shovel release velocity is time-windowed, thresholded, and speed-clamped", () => {
  const scene = manager();
  scene.config.trench.shovelSwipeSampleWindowMs = 120;
  scene.config.trench.shovelSwipeMinSpeedCellsPerSecond = 8;
  scene.config.trench.shovelSwipeMaxSpeedCellsPerSecond = 28;
  scene.layout = { grid: { cellSize: 10 } };

  const slow = { type: "scoop", velocitySamples: [{ x: 0, y: 0, time: 0 }] };
  assert.equal(scene.scoopReleaseVelocity(slow, 5, 0, 100), null);

  const fast = { type: "scoop", velocitySamples: [{ x: 0, y: 0, time: 0 }] };
  const velocity = scene.scoopReleaseVelocity(fast, 100, 0, 100);
  assert.equal(velocity.speed, 28);
  assert.ok(Math.abs(velocity.x - 28) < 1e-12);
  assert.equal(velocity.y, 0);

  const bounded = { type: "scoop", velocitySamples: [] };
  for (let index = 0; index < 20; index += 1) scene.recordScoopPointerSample(bounded, index, 0, index * 20);
  assert.ok(bounded.velocitySamples.length <= 7);
  assert.ok(bounded.velocitySamples[0].time >= 260);
});

test("heavier shovel clumps decelerate and settle sooner", () => {
  const scene = manager();
  scene.config.trench.clumpDecelerationCellsPerSecondSquared = 10;
  scene.config.trench.effects = { clumpLimitFull: 16 };
  scene.layout = { grid: { cellSize: 10 }, isPortrait: false };
  scene.activeTrench = { scoopRadius: 3 };
  scene.scheduleEffectFrame = () => {};
  sandbox.millis = () => 50;

  scene.spawnDepositedClump(0, 0, ["#886644"], { velocity: { x: 20, y: 0 }, clumpWeight: 0.8 });
  scene.spawnDepositedClump(0, 0, ["#6f6b62"], { velocity: { x: 20, y: 0 }, clumpWeight: 1.6 });
  const [light, heavy] = scene.depositedClumps;
  assert.ok(heavy.deceleration > light.deceleration);
  assert.ok(heavy.motionDuration < light.motionDuration);
});

test("a qualifying in-trench shovel flick commits once while a slow release is rejected", () => {
  const scene = manager();
  scene.currentScene = "trench";
  scene.config.trench.shovelSwipeSampleWindowMs = 120;
  scene.config.trench.shovelSwipeMinSpeedCellsPerSecond = 8;
  scene.config.trench.shovelSwipeMaxSpeedCellsPerSecond = 28;
  scene.layout = { grid: { x: 0, y: 0, width: 200, height: 200, cellSize: 10 }, isPortrait: false };
  let scoopCalls = 0;
  let deposited = null;
  scene.activeTrench = {
    scoopRadius: 3,
    scoop() {
      scoopCalls += 1;
      return { allowed: true, reason: "Soil set aside.", soilColours: ["#886644"], clumpWeight: 1.35 };
    }
  };
  scene.spawnDepositedClump = (...args) => { deposited = args; };
  scene.interactionNow = () => 100;
  scene.pointerAction = {
    type: "scoop",
    center: { x: 8, y: 8 },
    x: 80,
    y: 80,
    soilColours: ["#886644"],
    clumpWeight: 1.35,
    velocitySamples: [{ x: 50, y: 80, time: 0 }]
  };
  scene.pointerEnd(80, 80, "mouse");
  assert.equal(scoopCalls, 1);
  assert.ok(deposited[3].velocity);
  assert.equal(scene.message, "Shovel-load flicked aside.");

  deposited = null;
  scene.pointerAction = {
    type: "scoop",
    center: { x: 8, y: 8 },
    x: 80,
    y: 80,
    soilColours: ["#886644"],
    clumpWeight: 1,
    velocitySamples: [{ x: 76, y: 80, time: 0 }]
  };
  scene.pointerEnd(80, 80, "mouse");
  assert.equal(scoopCalls, 1);
  assert.equal(deposited, null);
  assert.equal(scene.messageTone, "warning");
});

test("tool buttons and canvas pointers use shared hotspot-aligned vector icons", () => {
  assert.match(rendererSource, /drawToolIcon\(tool, x, y, size/);
  assert.match(rendererSource, /drawToolCursor\(tool, x, y, pressed = false, pose = null\)/);
  for (const icon of ["brush", "scoop"]) assert.ok(trenchSceneSource.includes(`icon: "${icon}"`));
  for (const icon of ["hand", "toothbrush", "fine-brush", "flip"]) {
    assert.ok(cleaningSceneSource.includes(`icon: "${icon}"`));
  }
  assert.match(rendererSource, /pose === "pointing"/);
  assert.match(rendererSource, /variant === "in-use"/);
  assert.match(rendererSource, /#b98252/);
  assert.match(rendererSource, /#668248/);
  assert.match(trenchSceneSource, /revealedArtefactAtCanvas/);
  assert.match(sceneManagerSource, /tapFeedback/);
  assert.match(stylesSource, /#game-shell\.is-ready,\s*#game-shell\.is-ready \*\s*\{[^}]*cursor:\s*none/s);
  assert.match(mainSource, /setPointerCapture/);
  assert.match(mainSource, /pointercancel/);
  assert.match(mainSource, /canvasPointFromEvent/);
  assert.doesNotMatch(mainSource, /function mouseDragged/);
});

test("empty pressed pointer feedback follows movement in every scene", () => {
  const scene = manager();
  scene.currentScene = "site";
  scene.pointer = {
    x: 10,
    y: 10,
    source: "mouse",
    pressed: true,
    interactionTool: "hand",
    interactionVariant: "pointing",
    interactionPose: "pointing"
  };
  scene.pointerAction = null;
  scene.pointerMove(75, 90, "mouse");
  assert.equal(scene.pointer.x, 75);
  assert.equal(scene.pointer.y, 90);
  assert.equal(scene.pointer.interactionPose, "pointing");
  assert.deepEqual({ ...scene.customPointerPresentation() }, { tool: "hand", variant: "pointing", pose: "pointing" });
});

test("active mouse and touch tools suppress concurrent pointing-glove feedback", () => {
  const scene = manager();
  const cursorDraws = [];
  scene.renderer = { drawToolCursor: (...args) => cursorDraws.push(args) };
  scene.interactionNow = () => 20;
  sandbox.width = 300;
  sandbox.height = 200;

  scene.pointer = { x: 40, y: 50, source: "touch", pressed: true };
  scene.tapFeedback = { x: 40, y: 50, startedAt: 0, duration: 180 };
  scene.setPointerToolUse("brush");
  scene.pointerAction = { type: "brush" };
  scene.drawCustomPointer();
  assert.equal(scene.tapFeedback, null);
  assert.deepEqual(cursorDraws.map((draw) => draw.slice(0, 4)), [["brush", 40, 50, true]]);

  cursorDraws.length = 0;
  scene.pointer = { x: 70, y: 80, source: "mouse", pressed: true };
  scene.pointerAction = { type: "cleaning-brush", tool: "fine-brush" };
  scene.drawCustomPointer();
  assert.deepEqual(cursorDraws.map((draw) => draw.slice(0, 4)), [["fine-brush", 70, 80, true]]);

  delete sandbox.width;
  delete sandbox.height;
});

test("a rejected trench tool press keeps tool ownership instead of showing the pointing glove", () => {
  const scene = manager();
  scene.currentScene = "trench";
  scene.tool = "scoop";
  scene.layout = {
    grid: { x: 100, y: 100, width: 200, height: 200, cellSize: 10 },
    mapButton: { x: 0, y: 0, width: 40, height: 30 },
    brushButton: { x: 45, y: 0, width: 40, height: 30 },
    scoopButton: { x: 90, y: 0, width: 40, height: 30 }
  };
  scene.activeTrench = {
    id: "cursor-trench",
    rows: 20,
    columns: 20,
    artefacts: [],
    canScoop: () => ({ allowed: false, reason: "Bedrock has been reached here." })
  };
  scene.scheduleEffectFrame = () => {};
  scene.requestFrame = () => {};

  scene.pointerStart(105, 105, "touch");
  assert.equal(scene.pointerAction, null);
  assert.equal(scene.tapFeedback, null);
  assert.deepEqual({ ...scene.customPointerPresentation() }, { tool: "scoop", variant: "in-use", pose: null });
  scene.pointerMove(150, 150, "touch");
  assert.deepEqual({ ...scene.customPointerPresentation() }, { tool: "scoop", variant: "in-use", pose: null });
});

test("the contextual Flip shortcut is icon-only with a full-sized centred symbol", () => {
  assert.match(cleaningSceneSource, /contextFlipButton, "", false, true, false/);
  assert.match(cleaningSceneSource, /iconOnly: true/);
  assert.match(rendererSource, /iconOnly \? x \+ buttonWidth \/ 2/);
  assert.match(rendererSource, /Math\.min\(buttonHeight \* 0\.58, buttonWidth \* 0\.58, 24\)/);
});

test("compact portrait trench layouts prioritise the grid and retain a short profile strip", () => {
  const scene = manager();
  scene.activeTrench = { rows: 20, columns: 20 };
  for (const [viewportWidth, viewportHeight] of [[320, 427], [360, 480], [375, 500], [390, 520], [560, 747]]) {
    sandbox.width = viewportWidth;
    sandbox.height = viewportHeight;
    const layout = scene.trenchLayout();
    assert.equal(layout.isPortrait, true);
    assert.ok(layout.profile.height >= 78 && layout.profile.height <= 96);
    assert.ok(layout.grid.height >= Math.min(230, viewportHeight * 0.5), `${viewportWidth}x${viewportHeight} keeps a useful excavation area`);
    assert.ok(layout.grid.y + layout.grid.height < layout.profile.y);
    assert.ok(layout.profile.y + layout.profile.height <= viewportHeight);
  }
  delete sandbox.width;
  delete sandbox.height;
});

test("site hint measurement keeps its text inside the available panel at representative widths", () => {
  const scene = manager();
  scene.config.map = { rows: 0, columns: 0 };
  scene.drawHeading = () => {};
  scene.pendingCleaningCount = () => 0;
  scene.renderer.button = () => {};
  let fontSize = 10;
  let panel = null;
  sandbox.textSize = (value) => { fontSize = value; };
  sandbox.textWidth = (value) => String(value).length * fontSize * 0.56;
  sandbox.text = () => {};
  sandbox.textAlign = () => {};
  sandbox.textStyle = () => {};
  sandbox.LEFT = "left";
  sandbox.CENTER = "center";
  scene.renderer.panel = (x, y, width, height) => { panel = { x, y, width, height }; };

  for (const viewportWidth of [320, 360, 375, 390, 560, 960, 1280]) {
    sandbox.width = viewportWidth;
    sandbox.height = Math.round(viewportWidth * 4 / 3);
    scene.drawSiteMap();
    const measuredText = sandbox.textWidth("Tap a diamond to inspect a trench from above.");
    assert.ok(panel.width <= viewportWidth - 36);
    assert.ok(measuredText + 24 <= panel.width + 0.01);
  }
  delete sandbox.width;
  delete sandbox.height;
  delete sandbox.textSize;
  delete sandbox.textWidth;
  delete sandbox.text;
  delete sandbox.textAlign;
  delete sandbox.textStyle;
  delete sandbox.LEFT;
  delete sandbox.CENTER;
});

test("the trench finds indicator shows six icons when space permits and uses an overflow count when constrained", () => {
  const scene = manager();
  const artefacts = Array.from({ length: 6 }, (_, index) => ({ id: `find-${index}`, exposure: "collected" }));
  const testTrench = { artefacts };
  let fontSize = 10;
  let icons = 0;
  const labels = [];
  sandbox.textSize = (value) => { fontSize = value; };
  sandbox.textWidth = (value) => String(value).length * fontSize * 0.56;
  sandbox.text = (value) => { labels.push(String(value)); };
  sandbox.textAlign = () => {};
  sandbox.textStyle = () => {};
  sandbox.LEFT = "left";
  sandbox.TOP = "top";
  sandbox.CENTER = "center";
  sandbox.BOLD = "bold";
  sandbox.NORMAL = "normal";
  scene.renderer.artefact = () => { icons += 1; };

  scene.drawInventory(testTrench, { x: 500, y: 10, width: 340, height: 38 });
  assert.equal(icons, 6);
  assert.equal(labels.some((label) => label.startsWith("+")), false);
  assert.equal(scene.layout.findInventoryTargets.size, 6);

  scene.collectionFlights = [{ artefact: artefacts[5], trenchId: "test" }];
  icons = 0;
  scene.drawInventory(testTrench, { x: 500, y: 10, width: 340, height: 38 });
  assert.equal(icons, 5, "the destination icon is reserved until its flight completes");

  scene.collectionFlights = [];
  icons = 0;
  labels.length = 0;
  scene.drawInventory(testTrench, { x: 240, y: 10, width: 130, height: 38 });
  assert.ok(icons < 6);
  assert.ok(labels.some((label) => /^\+\d+$/.test(label)));

  delete sandbox.textSize;
  delete sandbox.textWidth;
  delete sandbox.text;
  delete sandbox.textAlign;
  delete sandbox.textStyle;
  delete sandbox.LEFT;
  delete sandbox.TOP;
  delete sandbox.CENTER;
  delete sandbox.BOLD;
  delete sandbox.NORMAL;
});

test("Finds lab buttons use numeric notification badges instead of bracketed labels", () => {
  assert.match(rendererSource, /notificationBadge\(bounds, count\)/);
  assert.match(rendererSource, /badgeCount/);
  assert.match(sceneManagerSource, /button\(this\.layout\.labButton, "Finds lab"/);
  assert.match(trenchSceneSource, /button\(this\.layout\.findsLabButton, "Finds lab"/);
  assert.doesNotMatch(`${sceneManagerSource}\n${trenchSceneSource}`, /Finds lab \(\$\{this\.pendingCleaningCount\(\)\}\)/);
});

test("revealed artefacts override excavation cursors across their full footprint", () => {
  const scene = manager();
  scene.currentScene = "trench";
  scene.tool = "brush";
  scene.layout = { grid: { x: 20, y: 30, width: 200, height: 200, cellSize: 10 } };
  scene.activeTrench = {
    artefacts: [{
      exposure: "revealed",
      footprint: [{ x: 3, y: 4 }, { x: 4, y: 4 }, { x: 3, y: 5 }, { x: 4, y: 5 }]
    }]
  };
  scene.pointer = { x: 55, y: 75, source: "mouse", pressed: false };
  assert.equal(scene.customPointerTool(), "hand");
  scene.pointer.x = 75;
  assert.equal(scene.customPointerTool(), "brush");
});

test("touch collection expands revealed footprints by one cell and resolves overlaps by distance", () => {
  const scene = manager();
  scene.currentScene = "trench";
  scene.layout = { grid: { x: 0, y: 0, width: 100, height: 100, cellSize: 10 } };
  const first = {
    id: "first",
    exposure: "revealed",
    centerX: 3.5,
    centerY: 3.5,
    footprint: [{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 3, y: 4 }, { x: 4, y: 4 }]
  };
  const second = {
    id: "second",
    exposure: "revealed",
    centerX: 5.5,
    centerY: 3.5,
    footprint: [{ x: 5, y: 3 }, { x: 6, y: 3 }, { x: 5, y: 4 }, { x: 6, y: 4 }]
  };
  scene.activeTrench = { rows: 10, columns: 10, artefacts: [first, second] };

  assert.equal(scene.collectionArtefactAtCanvas(22, 40, "mouse"), null, "mouse collection remains exact-cell based");
  assert.equal(scene.collectionArtefactAtCanvas(22, 40, "touch"), first, "the adjacent cell is included for touch");
  assert.equal(scene.collectionArtefactAtCanvas(48, 40, "touch"), first, "the nearest overlapping target wins");
  assert.equal(scene.collectionArtefactAtCanvas(50, 40, "touch"), first, "artefact order breaks an exact distance tie");
  assert.equal(scene.collectionArtefactAtCanvas(-1, 40, "touch"), null, "expanded targets remain clipped to the trench");
});

test("clicking a revealed artefact commits collection and starts its inventory flight", () => {
  const scene = manager();
  const find = {
    id: "clickable-find",
    label: "Clickable find",
    exposure: "revealed",
    centerX: 3.5,
    centerY: 4.5,
    footprint: [{ x: 3, y: 4 }, { x: 4, y: 4 }, { x: 3, y: 5 }, { x: 4, y: 5 }]
  };
  scene.currentScene = "trench";
  scene.layout = {
    grid: { x: 0, y: 0, width: 200, height: 200, cellSize: 10 },
    mapButton: { x: -100, y: -100, width: 1, height: 1 },
    brushButton: { x: -100, y: -100, width: 1, height: 1 },
    scoopButton: { x: -100, y: -100, width: 1, height: 1 },
    findsLabButton: { x: -100, y: -100, width: 1, height: 1 }
  };
  scene.activeTrench = {
    id: "click-trench",
    rows: 20,
    columns: 20,
    artefacts: [find],
    collectAt(x, y) {
      if (find.exposure !== "revealed" || !find.footprint.some((cell) => cell.x === x && cell.y === y)) return null;
      find.exposure = "collected";
      return find;
    }
  };
  scene.handleDebugPointerStart = () => false;
  scene.scheduleEffectFrame = () => {};
  scene.requestFrame = () => {};

  scene.pointerStart(40, 50, "mouse");

  assert.equal(find.exposure, "collected");
  assert.equal(scene.collectionFlights.length, 1);
  assert.equal(scene.collectionFlights[0].artefact, find);
  assert.equal(scene.pointer.interactionTool, "hand");
});

test("same-find shovel coaching triggers at three of five attempts and persists until reveal", () => {
  const scene = manager();
  const first = { id: "buried-first", exposure: "partial" };
  const second = { id: "buried-second", exposure: "partial" };
  scene.activeTrench = { id: "coach-trench" };
  scene.recordShovelAttempt(first);
  scene.recordShovelAttempt(null);
  scene.recordShovelAttempt(first);
  scene.recordShovelAttempt(second);
  assert.equal(scene.activeArtefactCoach, null);
  assert.equal(scene.recordShovelAttempt(first), true);
  assert.equal(scene.activeArtefactCoach.artefact, first);
  assert.equal(scene.activeArtefactCoach.promptVisible, true);
  assert.equal(scene.shovelAttemptHistory.get("coach-trench").length, 0);

  scene.activeArtefactCoach.promptVisible = false;
  scene.updateArtefactCoachCompletion();
  assert.equal(scene.activeArtefactCoach.artefact, first, "selecting Brush leaves the find highlight active");
  first.exposure = "revealed";
  scene.updateArtefactCoachCompletion();
  assert.equal(scene.activeArtefactCoach, null);
  assert.equal(scene.artefactCoaches.has("coach-trench"), false);
  for (let index = 0; index < 3; index += 1) scene.recordShovelAttempt(second);
  assert.equal(scene.activeArtefactCoach.artefact, second, "a later artefact can receive its own coaching");
});

test("selecting Brush dismisses coaching copy but keeps the artefact target highlighted", () => {
  const scene = manager();
  const artefact = { id: "coach-find", exposure: "partial" };
  const coach = { trenchId: "coach-trench", artefact, promptVisible: true };
  scene.currentScene = "trench";
  scene.activeTrench = { id: "coach-trench" };
  scene.activeArtefactCoach = coach;
  scene.artefactCoaches = new Map([["coach-trench", coach]]);
  scene.layout = {
    mapButton: { x: 0, y: 0, width: 20, height: 20 },
    brushButton: { x: 30, y: 0, width: 40, height: 20 },
    scoopButton: { x: 80, y: 0, width: 40, height: 20 },
    findsLabButton: { x: 130, y: 0, width: 40, height: 20 }
  };
  scene.handleDebugPointerStart = () => false;

  scene.pointerStart(50, 10, "mouse");

  assert.equal(scene.tool, "brush");
  assert.equal(coach.promptVisible, false);
  assert.equal(scene.activeArtefactCoach, coach);
  assert.equal(scene.artefactCoaches.get("coach-trench"), coach);
});

test("collection flights ease from the trench to a reserved inventory target", () => {
  const scene = manager();
  const find = { id: "flying-find", centerX: 3.5, centerY: 4.5 };
  scene.activeTrench = { id: "flight-trench", artefacts: [find] };
  scene.layout = {
    grid: { x: 10, y: 20, width: 200, height: 200, cellSize: 10 },
    findInventoryTargets: new Map([[find.id, { x: 260, y: 24, size: 14 }]])
  };
  scene.collectionFlights = [{ artefact: find, trenchId: "flight-trench", startedAt: 0, duration: 450 }];
  let now = 225;
  scene.interactionNow = () => now;
  scene.scheduleEffectFrame = () => {};
  let requested = 0;
  scene.requestFrame = () => { requested += 1; };
  const renders = [];
  scene.renderer.artefact = (...args) => renders.push(args);

  scene.drawCollectionFlights();
  assert.equal(renders.length, 1);
  assert.ok(renders[0][1] > 50 && renders[0][1] < 260);
  assert.equal(scene.collectionFlights.length, 1);
  now = 450;
  scene.drawCollectionFlights();
  assert.equal(scene.collectionFlights.length, 0);
  assert.equal(requested, 1, "a final frame reveals the normal header icon");
});
