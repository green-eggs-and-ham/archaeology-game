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

test("the standalone terrain engine renders a serializable request into an explicit canvas", () => {
  operations.length = 0;
  const canvas = {
    width: 21,
    height: 19,
    getContext(type) {
      assert.equal(type, "2d");
      return drawingContext;
    }
  };
  const request = {
    width: 10.25,
    height: 9.25,
    pixelWidth: 21,
    pixelHeight: 19,
    density: 2,
    cellSize: 10.25,
    rows: 1,
    columns: 1,
    maxDepth: 16,
    depthResolutionScale: 2,
    terrainSmoothingMode: "focus",
    pillarRenderMode: "round",
    ridgeDirectionMode: "current",
    performanceMode: "full",
    layers: [
      { id: "topsoil", colour: "#886644", pattern: null },
      { id: "bedrock", colour: "#445566", pattern: null }
    ],
    cells: [{ x: 0, y: 0, depth: 0, layerId: "topsoil", renderColour: "#886644" }],
    config: { trench: { depthResolutionScale: 2, maxDepthDarkening: 0.16 } }
  };

  const result = sandbox.window.TerrainGraphics.render(request, canvas);

  assert.ok(result.timings.total >= 0);
  assert.deepEqual(
    JSON.parse(JSON.stringify(result.stats)),
    { junctionsVisited: 0, junctionsSmoothed: 0, edgeChecks: 0 }
  );
  assert.ok(operations.some((operation) => operation[0] === "setTransform" && operation[1] === 2));
  assert.ok(operations.some((operation) => operation[0] === "fillRect"), "the request paints an opaque terrain surface");
});

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
