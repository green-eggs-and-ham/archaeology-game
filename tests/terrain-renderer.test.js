const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { mobileWebKitTerrainFixture } = require("./fixtures/mobile-webkit-terrain.js");

const operations = [];
const drawingContext = {
  beginPath() { operations.push(["beginPath"]); },
  closePath() { operations.push(["closePath"]); },
  clearRect(...values) { operations.push(["clearRect", ...values]); },
  arc(...values) { operations.push(["arc", ...values]); },
  clip(rule) { operations.push(["clip", rule]); },
  drawImage(...values) { operations.push(["drawImage", ...values]); },
  fill(rule) { operations.push(["fill", this.fillStyle, rule, this.globalCompositeOperation]); },
  fillRect(...values) { operations.push(["fillRect", ...values, this.fillStyle]); },
  lineTo(...values) { operations.push(["lineTo", ...values]); },
  moveTo(...values) { operations.push(["moveTo", ...values]); },
  quadraticCurveTo(...values) { operations.push(["quadraticCurveTo", ...values]); },
  rect(...values) { operations.push(["clipRect", ...values]); },
  restore() { operations.push(["restore"]); },
  save() { operations.push(["save"]); },
  setTransform(...values) { operations.push(["setTransform", ...values]); },
  stroke() { operations.push(["contextStroke"]); }
};

const sandbox = {
  window: {
    GameRenderer: class GameRenderer {},
    TrenchModel: class TrenchModel {}
  },
  drawingContext,
  fill: () => {},
  line: (...values) => operations.push(["line", ...values]),
  noFill: () => {},
  noStroke: () => {},
  point: (...values) => operations.push(["point", ...values]),
  redraw: () => {},
  rect: () => {},
  stroke: () => {},
  strokeWeight: () => {}
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/game/CleaningModel.js"), "utf8"), sandbox);
const sceneManagerSource = fs.readFileSync(path.join(__dirname, "../src/game/SceneManager.js"), "utf8");
const rendererSource = fs.readFileSync(path.join(__dirname, "../src/game/Renderer.js"), "utf8");
const terrainGraphicsSource = fs.readFileSync(path.join(__dirname, "../src/game/TerrainGraphics.js"), "utf8");
const terrainWorkerSource = fs.readFileSync(path.join(__dirname, "../src/game/TerrainWorker.js"), "utf8");
const mainSource = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
const indexSource = fs.readFileSync(path.join(__dirname, "../index.html"), "utf8");
const stylesSource = fs.readFileSync(path.join(__dirname, "../styles.css"), "utf8");
vm.runInContext(sceneManagerSource, sandbox);
const SceneManager = sandbox.window.SceneManager;

function manager() {
  return new SceneManager({
    trenches: [],
    trench: { maxDepthDarkening: 0.16, brushTravelPerStampCells: 3 }
  });
}

function surface(id, depth, colour, componentSize = 8, pattern = "dots") {
  return {
    signature: `${depth}:${id}`,
    depth,
    componentSize,
    layer: { id, colour, pattern }
  };
}

function trench(rows, columns, layers) {
  return {
    rows,
    columns,
    layers,
    bedrock: { id: "bedrock", colour: "#445566" },
    artefacts: []
  };
}

function grid(cellSize = 10) {
  return { x: 0, y: 0, width: cellSize * 20, height: cellSize * 20, cellSize };
}

test("junction patches form a pixel-snapped partition without even-odd colour fills", () => {
  const first = surface("first", 2, "#aa7744");
  const second = surface("second", 2, "#557799");
  const field = [[first, second], [second, first]];
  const testTrench = trench(2, 2, [first.layer, second.layer]);

  for (const smoothingMode of ["all", "focus"]) {
    for (const pillarMode of ["round", "merge"]) {
      operations.length = 0;
      const scene = manager();
      scene.terrainSmoothingMode = smoothingMode;
      scene.pillarRenderMode = pillarMode;
      const descriptors = scene.drawLocalJunctions(field, testTrench, grid());

      assert.equal(descriptors.length, 1);
      assert.deepEqual(
        { left: descriptors[0].bounds.left, top: descriptors[0].bounds.top, right: descriptors[0].bounds.right, bottom: descriptors[0].bounds.bottom },
        { left: 5, top: 5, right: 15, bottom: 15 }
      );
      assert.equal(descriptors[0].logicalSpan, 5);
      assert.deepEqual([...descriptors[0].lobes].map((lobe) => lobe.corner), ["tr", "bl"]);
      assert.equal(operations.some((operation) => operation[0] === "clip"), false);
      assert.equal(operations.some((operation) => operation[0] === "fillRect"), true);
      assert.equal(operations.some((operation) => operation[0] === "contextStroke"), false, "equal-depth lobes have no AO");
      const fills = operations.filter((operation) => operation[0] === "fill");
      assert.equal(fills.length, 2, "the two non-owner lobes are the only curved fills");
      fills.forEach((fillOperation) => assert.equal(fillOperation[2], undefined));

      const patches = scene.collectPixelSnappedSurfacePatches(field, testTrench, grid(), descriptors);
      const regions = scene.collectSurfaceRegionsFromPatches(patches);
      const ownerRegion = regions.get(descriptors[0].owner.signature);
      const lobeRegion = regions.get(descriptors[0].lobes[0].surface.signature);
      assert.equal(ownerRegion.ownerPatches.length, 1);
      assert.equal(ownerRegion.ownerPatches[0].holes.length, 2);
      assert.equal(lobeRegion.positiveLobes.length, 2, "the selected owner remains a diagonal bridge");
    }
  }
});

test("adjacent junction patches share exact physical boundaries without clips", () => {
  const high = surface("high", 0, "#aa7744");
  const low = surface("low", 3, "#557799");
  const field = [[high, low, high], [low, high, low]];
  const scene = manager();
  scene.terrainSmoothingMode = "focus";
  operations.length = 0;

  const descriptors = scene.drawLocalJunctions(field, trench(2, 3, [high.layer, low.layer]), grid());
  assert.equal(descriptors.length, 2);
  assert.equal(descriptors[0].bounds.right, descriptors[1].bounds.left);
  assert.equal(operations.some((operation) => operation[0] === "fillRect"), true);
  assert.equal(operations.some((operation) => operation[0] === "clip"), false);
  assert.equal(operations.filter((operation) => operation[0] === "fill" && operation[2] === "evenodd").length, 0);
});

test("the iOS stress fixture has mixed shared axes while its snapped atlas owns every physical pixel once", () => {
  const scenarios = [
    { viewport: "iPhone 8", density: 2, gridSize: 284.25 },
    { viewport: "iPhone 13 mini DPR 3 emulation", density: 3, gridSize: 270.75 },
    { viewport: "desktop fallback", density: 1, gridSize: 360.4 }
  ];
  const fixture = mobileWebKitTerrainFixture();

  scenarios.forEach(({ viewport, density, gridSize }) => {
    const scene = manager();
    scene.terrainSmoothingMode = "focus";
    scene.ridgeDirectionMode = "current";
    const testGrid = {
      x: 17.25,
      y: 111.75,
      width: gridSize,
      height: gridSize,
      cellSize: gridSize / fixture.trench.columns
    };
    const junctions = scene.buildLocalJunctionDescriptors(fixture.field, fixture.trench, testGrid);
    const patches = scene.collectPixelSnappedSurfacePatches(
      fixture.field,
      fixture.trench,
      testGrid,
      junctions,
      density
    );
    assert.ok(junctions.length > 20, `${viewport} fixture must exercise many mixed smoothed junctions`);

    const left = Math.floor(testGrid.x * density);
    const top = Math.floor(testGrid.y * density);
    const right = Math.ceil((testGrid.x + testGrid.width) * density);
    const bottom = Math.ceil((testGrid.y + testGrid.height) * density);
    const physicalWidth = right - left;
    const physicalHeight = bottom - top;
    const coverage = new Uint8Array(physicalWidth * physicalHeight);

    patches.forEach((patch) => {
      const pieces = patch.smoothed ? [patch.bounds] : patch.pieces.map((piece) => piece.bounds);
      pieces.forEach((bounds) => {
        const x0 = Math.round(bounds.left * density) - left;
        const x1 = Math.round(bounds.right * density) - left;
        const y0 = Math.round(bounds.top * density) - top;
        const y1 = Math.round(bounds.bottom * density) - top;
        assert.equal(bounds.left * density, Math.round(bounds.left * density), `${viewport} left edge is physical-pixel aligned`);
        assert.equal(bounds.top * density, Math.round(bounds.top * density), `${viewport} top edge is physical-pixel aligned`);
        for (let y = y0; y < y1; y += 1) {
          for (let x = x0; x < x1; x += 1) coverage[y * physicalWidth + x] += 1;
        }
      });
    });

    assert.equal(coverage.includes(0), false, `${viewport} contains no safety-base seam pixels`);
    assert.equal(coverage.some((count) => count !== 1), false, `${viewport} assigns each physical pixel exactly once`);
  });
});

test("each smoothed patch paints its authoritative owner before its lobes", () => {
  const shallow = surface("shallow", 1, "#aa7744");
  const deep = surface("deep", 5, "#557799");
  const scene = manager();
  operations.length = 0;

  const descriptors = scene.drawLocalJunctions(
    [[shallow, deep], [deep, shallow]],
    trench(2, 2, [shallow.layer, deep.layer]),
    grid()
  );
  assert.equal(descriptors[0].owner.signature, deep.signature);
  const ownerIndex = operations.findIndex((operation) => operation[0] === "fillRect" && operation[5] === deep.layer.colour);
  const lobeIndex = operations.findIndex((operation) => operation[0] === "fill" && operation[1] === shallow.layer.colour);
  assert.ok(ownerIndex >= 0 && lobeIndex > ownerIndex);
});

test("opaque base cells overlap on every edge at fractional cell sizes", () => {
  const first = surface("first", 1, "#aa7744");
  const second = surface("second", 1, "#557799");
  const scene = manager();
  const fractionalGrid = { x: 2.25, y: 3.75, width: 20.5, height: 20.5, cellSize: 10.25 };
  operations.length = 0;
  scene.drawBaseTerrain([[first, second], [second, first]], trench(2, 2, [first.layer, second.layer]), fractionalGrid);

  const fills = operations.filter((operation) => operation[0] === "fillRect");
  assert.equal(fills.length, 4);
  const [topLeft, topRight, bottomLeft] = fills;
  assert.ok(topLeft[1] + topLeft[3] > topRight[1], "horizontal neighbours overlap");
  assert.ok(topLeft[2] + topLeft[4] > bottomLeft[2], "vertical neighbours overlap");
  assert.ok(topLeft[1] < fractionalGrid.x && topLeft[2] < fractionalGrid.y, "outer edges extend into the grid-wide clip");
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

test("the obsolete cell-centre repair pass is absent", () => {
  assert.equal(typeof manager().drawCellCentreSeamRepair, "undefined");
});

test("Focus mode leaves an ordinary large 2:2 boundary on the opaque base", () => {
  const first = surface("first", 1, "#aa7744", 12);
  const second = surface("second", 2, "#557799", 12);
  const field = [[first, first], [second, second]];
  const scene = manager();
  scene.terrainSmoothingMode = "focus";
  operations.length = 0;

  assert.equal(scene.drawLocalJunctions(field, trench(2, 2, [first.layer, second.layer]), grid()).length, 0);
  assert.equal(operations.some((operation) => operation[0] === "fillRect"), true);
  assert.equal(operations.some((operation) => operation[0] === "fill"), false, "no curved feature is introduced");
});

test("Focus mode leaves small cardinal 2:2 joins flush but still rounds their 3:1 corners", () => {
  const surrounding = surface("surrounding", 0, "#aa7744", 40);
  const feature = surface("feature", 4, "#557799", 4);
  const scene = manager();
  scene.terrainSmoothingMode = "focus";

  const cardinalJoin = [[feature, feature], [surrounding, surrounding]];
  assert.equal(
    scene.drawLocalJunctions(cardinalJoin, trench(2, 2, [surrounding.layer, feature.layer]), grid()).length,
    0,
    "a small feature must not add a ridge between cardinally connected cells"
  );

  const outerCorner = [[surrounding, surrounding], [surrounding, feature]];
  assert.equal(
    scene.drawLocalJunctions(outerCorner, trench(2, 2, [surrounding.layer, feature.layer]), grid()).length,
    1,
    "the feature's outer 3:1 corner should remain rounded"
  );
});

test("ridge direction can cut into the shallower surface without changing equal-depth ownership", () => {
  const shallow = surface("shallow", 1, "#aa7744", 40);
  const deep = surface("deep", 6, "#557799", 1);
  const scene = manager();
  const mixedGroups = scene.junctionGroups([
    { surface: shallow },
    { surface: shallow },
    { surface: deep },
    { surface: shallow }
  ]);
  const testTrench = trench(2, 2, [shallow.layer, deep.layer]);

  scene.ridgeDirectionMode = "current";
  assert.equal(scene.chooseJunctionOwner(mixedGroups, testTrench).signature, shallow.signature);
  scene.ridgeDirectionMode = "high-cut";
  assert.equal(scene.chooseJunctionOwner(mixedGroups, testTrench).signature, deep.signature);

  const first = surface("first", 3, "#bb7744", 30);
  const second = surface("second", 3, "#5577aa", 2);
  const equalDepthGroups = scene.junctionGroups([
    { surface: first },
    { surface: first },
    { surface: second },
    { surface: first }
  ]);
  scene.ridgeDirectionMode = "current";
  const currentOwner = scene.chooseJunctionOwner(equalDepthGroups, trench(2, 2, [first.layer, second.layer]));
  scene.ridgeDirectionMode = "high-cut";
  assert.equal(scene.chooseJunctionOwner(equalDepthGroups, trench(2, 2, [first.layer, second.layer])).signature, currentOwner.signature);
});

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

test("Lite fields skip pillar merging and component analysis", () => {
  const scene = manager();
  let mergeCalls = 0;
  let componentCalls = 0;
  scene.pillarRenderMode = "merge";
  scene.mergeSmallExtrema = () => { mergeCalls += 1; };
  scene.buildCardinalComponents = () => { componentCalls += 1; return { items: [] }; };
  const layer = { id: "top", colour: "#886644", pattern: "dots" };
  const testTrench = {
    rows: 2,
    columns: 2,
    maxDepth: 16,
    getDepth: () => 0,
    getSurfaceAt: () => layer
  };
  scene.buildVisibleSurfaceField(testTrench, { lightweight: true });
  assert.equal(mergeCalls, 0);
  assert.equal(componentCalls, 0);
});

test("Lite AO uses opaque cardinal strips wholly inside the deeper cell", () => {
  const scene = manager();
  const shallow = surface("shallow", 1, "#aa7744");
  const deep = surface("deep", 5, "#557799");
  operations.length = 0;
  scene.drawLiteAmbientOcclusion([[deep, shallow]], trench(1, 2, [deep.layer, shallow.layer]), { x: 0, y: 0, width: 20, height: 10, cellSize: 10 });
  const fills = operations.filter((operation) => operation[0] === "fillRect");
  assert.equal(fills.length, 1);
  assert.ok(fills[0][1] >= 0 && fills[0][1] + fills[0][3] <= 10, "shadow remains in the deeper left cell");
  assert.match(fills[0][5], /^rgb\(/, "Lite AO is preblended and opaque");
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

test("depth tint darkens monotonically to sixteen percent without changing the source colour", () => {
  const scene = manager();
  const source = "#8b603b";
  assert.equal(scene.depthTintColour(source, 0, 16), "rgb(139, 96, 59)");
  assert.equal(scene.depthTintColour(source, 8, 16), "rgb(128, 88, 54)");
  assert.equal(scene.depthTintColour(source, 16, 16), "rgb(117, 81, 50)");
  assert.equal(source, "#8b603b", "key and configured layer colours remain unchanged");
});

test("AO depth strength remains proportional after vertical resolution doubles", () => {
  const scene = manager();
  const testGrid = { x: 0, y: 0, width: 200, height: 200, cellSize: 10 };
  scene.activeTrench = { depthResolutionScale: 1 };
  const reference = scene.aoStyle(2, testGrid);
  scene.activeTrench = { depthResolutionScale: 2 };
  const detailed = scene.aoStyle(4, testGrid);
  assert.deepEqual(detailed, reference);
  assert.equal(scene.aoStyle(2, testGrid).alpha, 0.2, "one physical depth step uses the higher-contrast AO alpha");
});

function configureBrushScene(scene, stamps) {
  scene.currentScene = "trench";
  scene.layout = {
    grid: { x: 100, y: 100, width: 200, height: 200, cellSize: 10 },
    mapButton: { x: 0, y: 0, width: 40, height: 30 },
    brushButton: { x: 45, y: 0, width: 40, height: 30 },
    scoopButton: { x: 90, y: 0, width: 40, height: 30 },
    depthButton: { x: 0, y: 35, width: 40, height: 30 },
    smoothingButton: { x: 45, y: 35, width: 70, height: 30 },
    pillarButton: { x: 120, y: 35, width: 70, height: 30 },
    ridgeButton: { x: 195, y: 35, width: 80, height: 30 }
  };
  scene.activeTrench = {
    collectAt: () => null,
    brushAt: (x, y) => {
      stamps.push({ x, y });
      return { changed: false, cells: [], removedLayers: [] };
    }
  };
}

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
  assert.equal(sceneManagerSource.includes('"Scoop"'), false);
  assert.equal(sceneManagerSource.includes('"Shovel"'), true);
  assert.equal(fs.readFileSync(path.join(__dirname, "../README.md"), "utf8").includes("shovel-loads"), true);
});

test("complete unsmoothed surface masks partition the full grid", () => {
  const scene = manager();
  const first = surface("first", 1, "#aa7744", 12);
  const second = surface("second", 2, "#557799", 12);
  const field = [[first, first], [second, second]];
  const testGrid = { x: 0, y: 0, width: 20, height: 20, cellSize: 10 };
  const regions = scene.collectCompleteSurfaceRegions(field, trench(2, 2, [first.layer, second.layer]), testGrid, []);
  const rectangleArea = (region) => region.rectangles.reduce(
    (total, bounds) => total + (bounds.right - bounds.left) * (bounds.bottom - bounds.top),
    0
  );

  assert.equal(rectangleArea(regions.get(first.signature)), 200);
  assert.equal(rectangleArea(regions.get(second.signature)), 200);
  assert.equal([...regions.values()].reduce((total, region) => total + rectangleArea(region), 0), 400);
});

test("complete masks retain smoothed owner holes and positive diagonal lobes", () => {
  const scene = manager();
  const first = surface("first", 2, "#aa7744");
  const second = surface("second", 2, "#557799");
  const field = [[first, second], [second, first]];
  const testTrench = trench(2, 2, [first.layer, second.layer]);
  const testGrid = { x: 0, y: 0, width: 20, height: 20, cellSize: 10 };
  const junctions = scene.buildLocalJunctionDescriptors(field, testTrench, testGrid);
  const regions = scene.collectCompleteSurfaceRegions(field, testTrench, testGrid, junctions);
  const ownerRegion = regions.get(junctions[0].owner.signature);
  const lobeRegion = regions.get(junctions[0].lobes[0].surface.signature);

  assert.equal(ownerRegion.ownerPatches.length, 1);
  assert.equal(ownerRegion.ownerPatches[0].holes.length, 2);
  assert.equal(lobeRegion.positiveLobes.length, 2);
});

test("Full mode compiles reusable surface paths for AO clipping", () => {
  class FakePath2D {
    constructor() { this.operations = []; }
    addPath(path) { this.operations.push(["addPath", path]); }
    beginPath() {}
    closePath() { this.operations.push(["closePath"]); }
    lineTo(...values) { this.operations.push(["lineTo", ...values]); }
    moveTo(...values) { this.operations.push(["moveTo", ...values]); }
    quadraticCurveTo(...values) { this.operations.push(["quadraticCurveTo", ...values]); }
    rect(...values) { this.operations.push(["rect", ...values]); }
  }
  sandbox.Path2D = FakePath2D;
  const scene = manager();
  const first = surface("first", 2, "#aa7744");
  const second = surface("second", 2, "#557799");
  const field = [[first, second], [second, first]];
  const testTrench = trench(2, 2, [first.layer, second.layer]);
  const testGrid = { x: 0, y: 0, width: 20, height: 20, cellSize: 10 };
  const junctions = scene.buildLocalJunctionDescriptors(field, testTrench, testGrid);
  const regions = scene.collectCompleteSurfaceRegions(field, testTrench, testGrid, junctions);
  const prepared = scene.prepareSurfaceRegions(regions, testTrench);

  assert.equal(prepared.byDepth.length, 1);
  assert.ok(prepared.byDepth[0].compiledPath instanceof FakePath2D);
  regions.forEach((region) => assert.ok(region.compiledPath instanceof FakePath2D));
  assert.equal(typeof scene.drawSurfaceRegion, "undefined", "compound even-odd terrain colour fills have been removed");
  delete sandbox.Path2D;
});

test("pixel-snapped terrain renders once before patterns and the clipped AO buffer", () => {
  const scene = manager();
  const order = [];
  scene.drawPixelSnappedSurfacePatches = () => order.push("terrain-patches");
  scene.drawTerrainPatterns = (_field, _trench, _grid, depth) => order.push(`patterns:${depth}`);
  const originalDrawImage = drawingContext.drawImage;
  drawingContext.drawImage = () => order.push("ao");
  scene.drawDepthCompositedTerrain([], trench(0, 0, []), grid(), new Map(), { canvas: {} }, null, null, []);
  drawingContext.drawImage = originalDrawImage;

  assert.deepEqual(order, ["terrain-patches", "patterns:null", "ao"]);
});

test("cardinal AO is collected as filled ribbons on the deeper side", () => {
  const dark = surface("dark", 1, "#664422");
  const light = surface("light", 4, "#ddbb77");
  const field = Array.from({ length: 3 }, (_, y) =>
    Array.from({ length: 3 }, (_, x) => ((x + y) % 2 ? dark : light))
  );
  const logicalSpan = 5;
  const boundsFor = (x, y, span) => ({ left: x * 10 - span, top: y * 10 - span, right: x * 10 + span, bottom: y * 10 + span, centerX: x * 10, centerY: y * 10 });
  const junctions = [
    { x: 1, y: 1, bounds: boundsFor(1, 1, logicalSpan), logicalSpan, owner: dark, lobes: [] },
    { x: 2, y: 1, bounds: boundsFor(2, 1, logicalSpan), logicalSpan, owner: dark, lobes: [] },
    { x: 1, y: 2, bounds: boundsFor(1, 2, logicalSpan), logicalSpan, owner: dark, lobes: [] },
    { x: 2, y: 2, bounds: boundsFor(2, 2, logicalSpan), logicalSpan, owner: dark, lobes: [] }
  ];
  const scene = manager();
  operations.length = 0;
  const batches = scene.collectAmbientOcclusion(field, trench(3, 3, [dark.layer, light.layer]), grid(), junctions);

  assert.equal(scene.terrainStats.edgeChecks, 12);
  assert.equal([...batches.values()].reduce((total, batch) => total + batch.polygons.length, 0), 12);
  assert.equal(operations.some((operation) => operation[0] === "line" || operation[0] === "contextStroke"), false);

  const leftSide = scene.straightAORibbon(10, 0, 10, 10, "vertical", true, 2);
  const rightSide = scene.straightAORibbon(10, 0, 10, 10, "vertical", false, 2);
  assert.ok(leftSide.every((point) => point.x <= 10), "left/deeper AO never crosses onto the right tile");
  assert.ok(rightSide.every((point) => point.x >= 10), "right/deeper AO never crosses onto the left tile");
});

test("equal-depth material boundaries never generate AO", () => {
  const first = surface("first", 2, "#aa7744");
  const second = surface("second", 2, "#557799");
  const scene = manager();
  const bounds = { left: 5, top: 5, right: 15, bottom: 15, centerX: 10, centerY: 10 };
  operations.length = 0;
  scene.drawLocalAmbientOcclusion(
    [[first, second], [second, first]],
    trench(2, 2, [first.layer, second.layer]),
    grid(),
    [{ x: 1, y: 1, bounds, logicalSpan: 5, owner: first, lobes: [{ corner: "tr", surface: second }] }]
  );

  assert.equal(scene.terrainStats.edgeChecks, 4);
  assert.equal(operations.some((operation) => operation[0] === "line" || operation[0] === "contextStroke"), false);
});

test("curved AO follows a height lobe and batches overlapping geometry once", () => {
  const shallow = surface("shallow", 1, "#aa7744");
  const deep = surface("deep", 5, "#557799");
  const scene = manager();
  const bounds = { left: 5, top: 5, right: 15, bottom: 15, centerX: 10, centerY: 10 };
  operations.length = 0;

  const boundary = scene.cornerBoundary("br", bounds);
  const polygon = scene.curvedAORibbon(boundary, 2, true, 0.5);
  const batches = new Map([[deep.signature, {
    surface: deep,
    polygons: [{ points: polygon, alpha: 0.42 }, { points: polygon, alpha: 0.42 }]
  }]]);
  scene.drawAmbientOcclusionBatches(batches);

  assert.equal(polygon.length, 18);
  assert.equal(operations.filter((operation) => operation[0] === "fill").length, 1, "overlapping ribbons share one alpha fill");
  assert.equal(operations.some((operation) => operation[0] === "contextStroke"), false);
});

test("stronger AO replaces weaker overlap instead of accumulating alpha", () => {
  const scene = manager();
  const deep = surface("deep", 5, "#557799");
  const polygon = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
  operations.length = 0;
  const batch = {
    surface: deep,
    polygons: [{ points: polygon, alpha: 0.42 }, { points: polygon, alpha: 0.14 }]
  };
  scene.drawAmbientBatch(batch, drawingContext, true);

  const fills = operations.filter((operation) => operation[0] === "fill");
  assert.equal(fills.length, 1);
  assert.equal(fills[0][1], "rgba(18, 24, 29, 0.14)");
  assert.equal(fills[0][3], "source-over");
  const replacement = operations.find((operation) => operation[0] === "fillRect");
  assert.equal(replacement[5], "rgba(18, 24, 29, 0.42)");
  assert.equal(drawingContext.globalCompositeOperation, "copy");
});

test("AO buffer clips every shadow batch to its authoritative deeper surface mask", () => {
  const scene = manager();
  const deep = surface("deep", 5, "#557799");
  const polygon = [{ x: 0, y: 0 }, { x: 12, y: 0 }, { x: 12, y: 2 }, { x: 0, y: 2 }];
  const regions = new Map([[deep.signature, {
    signature: deep.signature,
    surface: deep,
    rectangles: [{ left: 0, top: 0, right: 10, bottom: 10 }],
    ownerPatches: [],
    positiveLobes: []
  }]]);
  const batches = new Map([[deep.signature, { surface: deep, polygons: [{ points: polygon, alpha: 0.28 }] }]]);
  scene.ensureAmbientBuffer = () => ({ canvas: {}, context: drawingContext, pixelWidth: 20, pixelHeight: 20, density: 1 });
  operations.length = 0;
  scene.buildAmbientOcclusionBuffer(batches, regions, { x: 0, y: 0, width: 20, height: 20, cellSize: 10 });

  assert.ok(operations.some((operation) => operation[0] === "clip" && operation[1] === "evenodd"));
  assert.ok(operations.some((operation) => operation[0] === "clipRect" && operation[1] === 0 && operation[3] === 10));
});

test("AO polygon winding is normalized so overlapping ribbons union instead of cancelling", () => {
  const scene = manager();
  const clockwise = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: 0, y: 2 }];
  const reversed = [...clockwise].reverse();

  assert.equal(
    JSON.stringify(scene.normalisePolygonWinding(clockwise)),
    JSON.stringify(scene.normalisePolygonWinding(reversed))
  );
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

test("effect storage is FIFO-bounded and Lite mode applies the reduced limits", () => {
  const scene = manager();
  scene.config.trench.effects = {
    brushParticleLimitFull: 256,
    brushParticleLimitLite: 96,
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

  assert.equal(scene.brushParticles.length, 96);
  assert.equal(scene.depositedClumps.length, 8);
  assert.equal(scene.cleaningWaterDrops.length, 20);
  assert.equal(scene.cleaningRipples.length, 4);
  assert.equal(scene.cleaningDirtParticles.length, 40);
  assert.equal(scene.effectStats.brushParticleActive, 96);
  assert.equal(scene.effectStats.clumpActive, 8);
  assert.equal(scene.effectStats.cleaningEffectActive, 64);
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
  for (const icon of ["hand", "brush", "scoop", "toothbrush", "fine-brush", "flip"]) {
    assert.ok(sceneManagerSource.includes(`icon: "${icon}"`));
  }
  assert.match(rendererSource, /pose === "pointing"/);
  assert.match(sceneManagerSource, /revealedArtefactAtCanvas/);
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
  scene.pointer = { x: 10, y: 10, source: "mouse", pressed: true, feedbackTool: "hand", feedbackPose: "pointing" };
  scene.pointerAction = null;
  scene.pointerMove(75, 90, "mouse");
  assert.equal(scene.pointer.x, 75);
  assert.equal(scene.pointer.y, 90);
  assert.equal(scene.pointer.feedbackPose, "pointing");
});

test("terrain worker coalesces requests, closes stale bitmaps, and accepts only the desired key", () => {
  const scene = manager();
  const posted = [];
  scene.terrainWorker = { postMessage: (request) => posted.push(request) };
  scene.ensureTerrainWorker = () => scene.terrainWorker;
  let payloadBuilds = 0;
  scene.terrainWorkerPayload = (key) => {
    payloadBuilds += 1;
    return { key, jobId: ++scene.terrainWorkerSequence, requestedAt: 0 };
  };
  scene.terrainTimingNow = () => 20;
  const dummyTrench = {};
  const dummyGrid = {};
  scene.currentScene = "trench";
  scene.activeTrench = dummyTrench;
  scene.layout.grid = dummyGrid;
  scene.gridCacheKey = () => scene.terrainWorkerDesiredKey;

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
  assert.match(terrainWorkerSource, /importScripts\("\.\/SceneManager\.js", "\.\/TerrainGraphics\.js"\)/);
  assert.match(terrainWorkerSource, /transferToImageBitmap/);
  assert.match(terrainWorkerSource, /let terrainCanvas = null/);
  assert.match(terrainWorkerSource, /terrainSurface\(request\.pixelWidth, request\.pixelHeight\)/);
  assert.match(terrainGraphicsSource, /buildLocalJunctionDescriptors/);
  assert.match(terrainGraphicsSource, /collectPixelSnappedSurfacePatches/);
  assert.match(terrainGraphicsSource, /drawPixelSnappedSurfacePatches/);
  assert.match(terrainGraphicsSource, /collectAmbientOcclusion/);
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

test("the page reserves its canvas and exposes progressive boot and failure states", () => {
  assert.match(indexSource, /class="canvas-skeleton"/);
  assert.match(indexSource, /id="game-loading-progress"/);
  assert.match(indexSource, /GameBoot\.resourceLoaded\(\)/);
  assert.match(indexSource, /GameBoot\.resourceFailed/);
  assert.match(indexSource, /loader\.remove\(\)/);
  assert.match(indexSource, /querySelectorAll\("#p5_loading"\)/);
  assert.equal((indexSource.match(/<script defer/g) || []).length, 9);
  assert.match(stylesSource, /max-width:\s*min\(1280px/);
  assert.match(stylesSource, /aspect-ratio:\s*16\s*\/\s*9/);
  assert.match(stylesSource, /@media \(max-width: 640px\).*aspect-ratio:\s*3\s*\/\s*4/s);
});

test("configured clump motion decays at twice its original rate", () => {
  const jsConfigSource = fs.readFileSync(path.join(__dirname, "../data/game-config.js"), "utf8");
  const jsonConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/game-config.json"), "utf8"));
  assert.match(jsConfigSource, /clumpDecelerationCellsPerSecondSquared:\s*20/);
  assert.equal(jsonConfig.trench.clumpDecelerationCellsPerSecondSquared, 20);
  assert.match(sceneManagerSource, /clumpDecelerationCellsPerSecondSquared \|\| 20/);
});
