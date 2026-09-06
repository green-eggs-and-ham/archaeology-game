const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const operations = [];
const drawingContext = {
  beginPath() { operations.push(["beginPath"]); },
  closePath() { operations.push(["closePath"]); },
  clearRect(...values) { operations.push(["clearRect", ...values]); },
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
const sceneManagerSource = fs.readFileSync(path.join(__dirname, "../src/game/SceneManager.js"), "utf8");
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

test("junction patches batch exact cell-centre regions without per-patch painting in every A/B combination", () => {
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
      assert.equal(operations.some((operation) => operation[0] === "fillRect"), false);
      assert.equal(operations.some((operation) => operation[0] === "contextStroke"), false, "equal-depth lobes have no AO");
      const fills = operations.filter((operation) => operation[0] === "fill");
      assert.equal(fills.length, 2, "each full signature is filled once");
      fills.forEach((fillOperation) => assert.equal(fillOperation[2], "evenodd"));

      const regions = scene.collectJunctionSurfaceRegions(descriptors);
      const ownerRegion = regions.get(descriptors[0].owner.signature);
      const lobeRegion = regions.get(descriptors[0].lobes[0].surface.signature);
      assert.equal(ownerRegion.ownerPatches.length, 1);
      assert.equal(ownerRegion.ownerPatches[0].holes.length, 2);
      assert.equal(lobeRegion.positiveLobes.length, 2, "the selected owner remains a diagonal bridge");
    }
  }
});

test("adjacent junctions batch each signature once instead of repainting owner rectangles", () => {
  const high = surface("high", 0, "#aa7744");
  const low = surface("low", 3, "#557799");
  const field = [[high, low, high], [low, high, low]];
  const scene = manager();
  scene.terrainSmoothingMode = "focus";
  operations.length = 0;

  const descriptors = scene.drawLocalJunctions(field, trench(2, 3, [high.layer, low.layer]), grid());
  assert.equal(descriptors.length, 2);
  assert.equal(operations.filter((operation) => operation[0] === "fill").length, 2);
  assert.equal(operations.some((operation) => operation[0] === "fillRect"), false);
});

test("batched regions render deeper signatures before shallower signatures", () => {
  const shallow = surface("shallow", 1, "#aa7744");
  const deep = surface("deep", 5, "#557799");
  const scene = manager();
  operations.length = 0;

  scene.drawLocalJunctions(
    [[shallow, deep], [deep, shallow]],
    trench(2, 2, [shallow.layer, deep.layer]),
    grid()
  );

  assert.deepEqual(
    operations.filter((operation) => operation[0] === "fill").map((operation) => operation[1]),
    [deep.layer.colour, shallow.layer.colour]
  );
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
  assert.equal(operations.some((operation) => operation[0] === "fillRect"), false);
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

test("ridge direction is high-cut by default and participates in the terrain cache key", () => {
  const scene = manager();
  const testGrid = { x: 10, y: 20, width: 200, height: 200, cellSize: 10 };
  const testTrench = { id: "ridge-cache", visualRevision: 2 };
  assert.equal(scene.ridgeDirectionMode, "high-cut");

  const highCutKey = scene.gridCacheKey(testTrench, testGrid);
  scene.ridgeDirectionMode = "current";
  assert.notEqual(scene.gridCacheKey(testTrench, testGrid), highCutKey);
});

test("the ridge control toggles direction and invalidates the cached terrain", () => {
  const scene = manager();
  scene.currentScene = "trench";
  scene.ridgeDirectionMode = "current";
  scene.gridCache = { key: "stale" };
  scene.layout = {
    mapButton: { x: 0, y: 0, width: 40, height: 30 },
    brushButton: { x: 45, y: 0, width: 40, height: 30 },
    scoopButton: { x: 90, y: 0, width: 40, height: 30 },
    depthButton: { x: 0, y: 35, width: 40, height: 30 },
    smoothingButton: { x: 45, y: 35, width: 70, height: 30 },
    pillarButton: { x: 120, y: 35, width: 70, height: 30 },
    ridgeButton: { x: 195, y: 35, width: 80, height: 30 }
  };

  scene.pointerStart(220, 50);
  assert.equal(scene.ridgeDirectionMode, "high-cut");
  assert.equal(scene.gridCache, null);
});

test("all four diagnostic controls share one non-overlapping row", () => {
  const scene = manager();
  const buttons = scene.diagnosticButtonLayout(600, 52, 30, 6);
  const row = [buttons.depth, buttons.smoothing, buttons.pillar, buttons.ridge];

  row.forEach((button) => {
    assert.equal(button.y, 52);
    assert.equal(button.height, 30);
  });
  for (let index = 1; index < row.length; index += 1) {
    assert.equal(row[index].x - (row[index - 1].x + row[index - 1].width), 6);
  }
  assert.ok(Math.abs(buttons.ridge.x + buttons.ridge.width - 588) < 1e-9);
  assert.ok(buttons.depth.width < buttons.smoothing.width);
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

test("terrain renders deepest terrain, patterns, and AO before the next shallower depth", () => {
  const scene = manager();
  const order = [];
  const deep = surface("deep", 5, "#557799");
  const shallow = surface("shallow", 1, "#aa7744");
  const regions = new Map([
    [deep.signature, { signature: deep.signature, surface: deep, rectangles: [], ownerPatches: [], positiveLobes: [] }],
    [shallow.signature, { signature: shallow.signature, surface: shallow, rectangles: [], ownerPatches: [], positiveLobes: [] }]
  ]);
  scene.drawSurfaceRegion = (region) => order.push(`terrain:${region.surface.depth}`);
  scene.drawTerrainPatterns = (_field, _trench, _grid, depth) => order.push(`patterns:${depth}`);
  scene.appendSurfaceRegionPath = () => {};
  const originalDrawImage = drawingContext.drawImage;
  drawingContext.drawImage = () => order.push("ao");
  scene.drawDepthCompositedTerrain([], trench(0, 0, [shallow.layer, deep.layer]), grid(), regions, { canvas: {} });
  drawingContext.drawImage = originalDrawImage;

  assert.deepEqual(order, ["terrain:5", "patterns:5", "ao", "terrain:1", "patterns:1", "ao"]);
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
