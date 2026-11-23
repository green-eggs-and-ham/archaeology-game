const { test, assert, fs, path, vm, sandbox, manager } = require("./helpers/scene-harness.js");

const context = vm.createContext({ window: {} });
for (const file of [
  "data/game-config.js", "src/game/ArtefactCatalogue.js", "src/game/TrenchModel.js",
  "src/game/ArtefactRenderer.js", "src/game/TerrainGraphics.js", "src/game/TrenchPreviewGraphics.js",
  "src/game/TrenchPreviewPipeline.js"
]) vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), context);
const graphics = context.window.TrenchPreviewGraphics;
const Pipeline = context.window.TrenchPreviewPipeline;
const referenceRay = require("./helpers/reference-trench-ray.js");
const fixtures = require("./fixtures/iso-adversarial-terrain.js");

function trench(index = 0) {
  const config = context.window.GameConfig;
  const model = new context.window.TrenchModel(config.trenches[index], config);
  model.artefacts = [];
  return model;
}

function canvasFactory() {
  const canvas = { width: 1, height: 1 };
  canvas.getContext = () => ({
    createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
    putImageData: (image) => { canvas.pixels = image.data; }
  });
  return canvas;
}

function render(engine, model, quality = "lite", display = null) {
  const keys = graphics.keys(model, quality);
  const request = { trenchId: model.id, terrainKey: keys.terrain, quality, display, snapshot: graphics.snapshot(model) };
  const canvas = canvasFactory();
  const iterator = engine.render(request, canvas);
  let step;
  do { step = iterator.next(); } while (!step.done);
  return { ...step.value, canvas, terrain: engine.terrains.get(model.id) };
}

function clock() {
  let sequence = 0;
  const callbacks = new Map();
  return {
    callbacks,
    setTimer(callback, delay) { callbacks.set(++sequence, { callback, delay }); return sequence; },
    clearTimer(id) { callbacks.delete(id); },
    fire(delay) {
      const entry = [...callbacks.entries()].find(([, value]) => value.delay === delay);
      assert.ok(entry, `Expected a ${delay} ms timer`);
      callbacks.delete(entry[0]);
      entry[1].callback();
    }
  };
}

function pipelineFixture(models = [trench()]) {
  const timers = clock();
  const sent = [];
  const cancellations = [];
  const worker = {
    postMessage: (request) => (request.type === "cancel-preview" ? cancellations : sent).push(request),
    terminate() { this.terminated = true; }
  };
  const host = {
    trenches: models, performanceMode: "lite", mapRenderMode: "relief", currentScene: "trench",
    pointerAction: null, activeTrench: models[0], frames: 0, isoOnPause: false,
    requestFrame() { this.frames += 1; }
  };
  const pipeline = new Pipeline(host, { ...timers, createWorker: () => worker, canvasFactory });
  function complete(request = sent.at(-1), extra = {}) {
    const bitmap = { width: 256, height: 128, closes: 0, close() { this.closes += 1; } };
    worker.onmessage({ data: {
      type: "preview-result", jobId: request.jobId, trenchId: request.trenchId,
      key: request.key, bitmap, width: 256, height: 128,
      rebuilt: true, retainedBytes: 500, renderMs: 3, ...extra
    } });
    return bitmap;
  }
  return { timers, sent, cancellations, worker, host, pipeline, complete };
}

test("adversarial benchmark fixtures preserve reproducible topology and all authoritative cell depths", () => {
  const expected = {
    "deep-checkerboard": [400, 760], "deep-mosaic": [258, 615], "deep-floor": [1, 0],
    "cliff-checkerboard": [400, 760], "deep-comb": [148, 508]
  };
  const engine = new graphics.PreviewEngine(canvasFactory);
  for (const pattern of Object.keys(expected)) {
    const model = fixtures.create(context.window.TrenchModel, context.window.GameConfig, pattern);
    assert.deepEqual(Object.values(fixtures.topology(model.depths)), expected[pattern]);
    model.artefacts = [];
    const { terrain } = render(engine, model);
    for (let y = 0; y < 20; y += 1) {
      for (let x = 0; x < 20; x += 1) {
        assert.equal(terrain.heights[(y * 4 + 2) * terrain.atlasWidth + x * 4 + 2], model.depths[y][x]);
      }
    }
    assert.ok(terrain.visibility.every((depth) => depth === Infinity || (depth >= 0 && depth <= 16)));
  }
  engine.dispose();
});

test("column traversal matches the original ray at every pixel on adversarial and edge terrain", () => {
  const engine = new graphics.PreviewEngine(canvasFactory);
  for (const quality of ["lite", "full"]) {
    for (const pattern of [...Object.keys(fixtures.patterns), "raised-island", "untouched"]) {
      const model = pattern in fixtures.patterns
        ? fixtures.create(context.window.TrenchModel, context.window.GameConfig, pattern) : trench();
      model.artefacts = [];
      if (pattern === "raised-island") {
        model.depths.forEach((row) => row.fill(11));
        model.depths[3][5] = model.depths[0][0] = 0;
        model.depths[0][1] = model.maxDepth;
      }
      model.id = pattern;
      const { terrain } = render(engine, model, quality);
      for (let y = 0; y < terrain.height; y++) {
        for (let x = 0; x < terrain.width; x++) {
          const u = (x + 0.5) / terrain.width + (y + 0.5) / terrain.height - 0.5;
          const v = (y + 0.5) / terrain.height - (x + 0.5) / terrain.width + 0.5;
          const expected = u >= 0 && v >= 0 && u < 1 && v < 1 ? referenceRay(terrain, u, v).depth : Infinity;
          const actual = terrain.visibility[y * terrain.width + x];
          if (actual !== expected && Math.abs(actual - expected) > 0.00001) {
            assert.fail(`${pattern} ${quality} at ${x},${y}: expected ${expected}, saw ${actual}`);
          }
        }
      }
    }
  }
  engine.dispose();
});

test("the terrain atlas retains the quadratic corner samples on a rectangular trench", () => {
  const model = trench();
  model.rows = 7; model.columns = 11;
  model.depths = model.depths.slice(0, 7).map((row, y) => row.slice(0, 11).map((_, x) => (3 * x + y) % 4 === 0 ? 0 : 9));
  const engine = new graphics.PreviewEngine(canvasFactory);
  const geometry = context.window.TerrainGraphics.createEngine({ trench: { maxDepthDarkening: 0.16 } });
  const field = geometry.buildVisibleSurfaceField(model);
  const descriptors = geometry.buildLocalJunctionDescriptors(field, model, { x: 0, y: 0, width: 88, height: 56, cellSize: 8 });
  const junctions = new Map(descriptors.map((j) => [j.x + ":" + j.y, j]));
  const { terrain } = render(engine, model, "full");
  const palette = [...model.layers, model.bedrock, model.grassLayer];
  for (let y = 0; y < terrain.atlasHeight; y++) {
    for (let x = 0; x < terrain.atlasWidth; x++) {
      const u = (x + 0.5) / 8, v = (y + 0.5) / 8;
      let expected = field[Math.floor(v)][Math.floor(u)];
      const j = junctions.get(Math.floor(u + 0.5) + ":" + Math.floor(v + 0.5));
      if (j) {
        const dx = u - j.x, dy = v - j.y;
        const corner = (dy < 0 ? "t" : "b") + (dx < 0 ? "l" : "r");
        const lobe = j.lobes.find((item) => item.corner === corner);
        expected = lobe && Math.sqrt(2 * Math.abs(dx)) + Math.sqrt(2 * Math.abs(dy)) >= 1 ? lobe.surface : j.owner;
      }
      const i = y * terrain.atlasWidth + x;
      assert.equal(terrain.heights[i], expected.depth);
      assert.equal(palette[terrain.materials[i]].id, expected.layer.id);
    }
  }
  for (let y = 0; y < terrain.height; y += 3) {
    for (let x = 0; x < terrain.width; x += 3) {
      const u = (x + 0.5) / terrain.width + (y + 0.5) / terrain.height - 0.5;
      const v = (y + 0.5) / terrain.height - (x + 0.5) / terrain.width + 0.5;
      if (u >= 0 && v >= 0 && u < 1 && v < 1) assert.ok(Math.abs(referenceRay(terrain, u, v).depth - terrain.visibility[y * terrain.width + x]) < 1e-5);
    }
  }
});

test("reduced previews average covered colour at a transparent rim and cancel without publishing", () => {
  const engine = new graphics.PreviewEngine(canvasFactory);
  const model = trench();
  const built = render(engine, model);
  const levels = Array.from(built.levels);
  assert.deepEqual(levels.map((level) => level.width), [128, 64, 32, 16]);
  const source = built.canvas.pixels, target = levels[0].data;
  let rimPixels = 0;
  for (let pixel = 0; pixel < target.length / 4; pixel++) {
    const input = 2 * (pixel % 128) + 2 * Math.floor(pixel / 128) * 256;
    const indices = [input, input + 1, input + 256, input + 257];
    const covered = indices.filter((i) => source[i * 4 + 3]);
    if (!covered.length || covered.length === 4) continue;
    rimPixels++;
    assert.ok(Math.abs(target[4 * pixel + 3] - covered.length * 255 / 4) <= 0.5);
    for (let c = 0; c < 3; c++) {
      const expected = covered.reduce((sum, i) => sum + source[i * 4 + c], 0) / covered.length;
      assert.ok(Math.abs(target[4 * pixel + c] - expected) <= 0.5);
    }
  }
  assert.ok(rimPixels > 0);
  let pendingLevels;
  const buildLevels = engine.buildLevels;
  engine.buildLevels = function* (image, width, height, levels) {
    pendingLevels = levels;
    yield* buildLevels.call(this, image, width, height, levels);
  };
  const job = engine.render({ trenchId: model.id, terrainKey: "new", quality: "lite",
    snapshot: graphics.snapshot(model) }, canvasFactory());
  while (!pendingLevels?.length) assert.equal(job.next().done, false);
  job.return();
  assert.ok(pendingLevels.every((level) => level.data === null));
  assert.equal(engine.terrains.get(model.id), built.terrain);
});

test("partial exposure, collection and resizing produce identical fitted pixels to a fresh composition", () => {
  const model = trench();
  model.depths.forEach((row) => row.fill(9));
  const find = { id: "rim-find", shape: "coin", colour: "#ff2200", depth: 5, centerX: 10.5, centerY: 10.5,
    footprint: [{ x: 10, y: 10 }, { x: 11, y: 10 }, { x: 10, y: 11 }, { x: 11, y: 11 }] };
  model.artefacts = [find];
  let quadrants = [0];
  model.artefactVisibleQuadrants = () => quadrants;
  const make = () => {
    const engine = new graphics.PreviewEngine(canvasFactory);
    engine.glyph = () => new Uint8ClampedArray(64 * 64 * 4).fill(255);
    return engine;
  };
  const engine = make();
  let previousPixels;
  for (const [state, visible, tileWidth] of [
    ["hidden", [], 80.625], ["partial", [0], 80.625], ["revealed", [0, 1, 2, 3], 80.625],
    ["collected", [], 80.625], ["partial", [2], 59], ["partial", [2], 59]
  ]) {
    find.exposure = state;
    quadrants = visible;
    model.visualRevision++;
    const display = { width: tileWidth, height: tileWidth / 2, phaseX: 0.25, phaseY: 0.75,
      filterX: 1, filterY: 1, key: String(tileWidth) };
    const actual = render(engine, model, "full", display);
    const expected = render(make(), model, "full", display);
    assert.deepEqual(actual.fitted.pixels, expected.fitted.pixels, state);
    for (let i = 0; i < actual.levels.length; i++) assert.deepEqual(actual.levels[i].data, expected.levels[i].data);
    if (tileWidth === 80.625 && previousPixels) assert.notDeepEqual(actual.fitted.pixels, previousPixels, "find affects the image");
    previousPixels = actual.fitted.pixels;
  }
});

test("screen-size filtering preserves fractional coverage and colour at four different pixel origins", () => {
  const source = { width: 16, height: 8, data: new Uint8ClampedArray(16 * 8 * 4) };
  for (let i = 0; i < source.width * source.height; i++) {
    source.data.set([i % 2 ? 217 : 45, i % 31 * 7, 61, i % 5 === 0 ? 0 : i % 3 ? 255 : 128], i * 4);
  }
  for (const phase of [0, 0.25, 0.5, 0.75]) {
    const output = canvasFactory();
    const target = { width: 6.2, height: 3.1, phaseX: phase, phaseY: phase, filterX: 1, filterY: 1 };
    const fit = graphics.fitPreview(source, target, output);
    while (!fit.next().done) {}
    for (let y = 0; y < output.height; y++) {
      for (let x = 0; x < output.width; x++) {
        const total = [0, 0, 0, 0];
        for (let sy = 0; sy < source.height; sy++) {
          for (let sx = 0; sx < source.width; sx++) {
            const left = sx * target.width / source.width + phase, top = sy * target.height / source.height + phase;
            const area = Math.max(0, Math.min(x + 1, left + target.width / source.width) - Math.max(x, left)) *
              Math.max(0, Math.min(y + 1, top + target.height / source.height) - Math.max(y, top));
            const i = (sy * source.width + sx) * 4, mass = area * source.data[i + 3];
            total[3] += mass;
            for (let c = 0; c < 3; c++) total[c] += mass * source.data[i + c];
          }
        }
        const i = (y * output.width + x) * 4;
        assert.ok(Math.abs(total[3] - output.pixels[i + 3]) <= 0.501);
        if (total[3] > 0.01) for (let c = 0; c < 3; c++) assert.ok(Math.abs(total[c] / total[3] - output.pixels[i + c]) <= 0.501);
      }
    }
  }
});

test("all transferred preview images are counted and released on stale delivery, replacement and disposal", () => {
  const f = pipelineFixture();
  const extras = () => ({ fitted: { width: 81, height: 41, close() { this.closed = true; } },
    levels: [{ width: 128, height: 64, data: new Uint8ClampedArray(128 * 64 * 4) }] });
  f.pipeline.prepareSite();
  const first = extras(), next = extras(), stale = extras();
  f.complete(f.sent[0], first);
  assert.equal(f.pipeline.stats.bitmapBytes, 4 * (256 * 128 + 128 * 64 + 81 * 41));
  f.host.activeTrench.visualRevision++;
  f.pipeline.prepareSite();
  f.complete(f.sent[0], stale);
  assert.equal(stale.fitted.closed, true);
  assert.equal(stale.levels[0].data, null);
  assert.ok(!first.fitted.closed);
  f.complete(f.sent[1], next);
  assert.equal(first.fitted.closed, true);
  f.pipeline.dispose();
  assert.equal(next.fitted.closed, true);
  assert.equal(next.levels[0].data, null);
  assert.equal(f.pipeline.stats.bitmapBytes, 0);
});

test("snapshot is independent of live excavation and excludes hidden and collected finds", () => {
  const model = trench();
  model.artefacts = ["hidden", "partial", "revealed", "collected"].map((exposure, index) => ({
    id: String(index), exposure, centerX: 2.5, centerY: 2.5, depth: 3,
    footprint: [{ x: 2, y: 2 }, { x: 3, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 3 }]
  }));
  const result = graphics.snapshot(model);
  assert.equal(result.artefacts.length, 2);
  assert.equal(result.artefacts[1].visibleQuadrants.length, 4);
  model.depths[0][0] = 5;
  model.stratigraphy[0][0][0] = 3;
  assert.equal(result.depths[0][0], 0);
  assert.notEqual(result.stratigraphy[0][0][0], 3);
});

test("untouched grass variants and geology render deterministic, opaque diamond interiors", () => {
  const engine = new graphics.PreviewEngine(canvasFactory);
  const results = [0, 1, 2].map((index) => render(engine, trench(index)));
  for (const result of results) {
    assert.equal(result.width, 256);
    assert.equal(result.height, 128);
    assert.equal(result.canvas.pixels.filter((_, index) => index % 4 === 3 && result.canvas.pixels[index] === 255).length, 256 * 128 / 2);
    assert.ok(result.terrain.visibility.every((depth) => depth === 0 || depth === Infinity));
  }
  assert.notDeepEqual(results[0].canvas.pixels, results[1].canvas.pixels);
  assert.notDeepEqual(results[1].canvas.pixels, results[2].canvas.pixels);
  assert.deepEqual(render(engine, trench()).canvas.pixels, results[0].canvas.pixels);
});

test("deep excavation intersects bedrock floors and sediment walls, with near-rim occlusion", () => {
  const model = trench();
  model.depths.forEach((row) => row.fill(model.maxDepth));
  const engine = new graphics.PreviewEngine(canvasFactory);
  const { terrain, canvas } = render(engine, model);
  const floor = referenceRay(terrain, 0.8, 0.8);
  const wall = referenceRay(terrain, 0.1, 0.1);
  assert.equal(floor.depth, model.maxDepth);
  assert.equal(floor.wall, false);
  assert.ok(wall.depth > 0 && wall.depth < model.maxDepth);
  assert.equal(wall.wall, true);
  assert.equal(canvas.pixels[(0 * terrain.width + 0) * 4 + 3], 0, "outside the opening cannot reveal a lowered floor");
  assert.ok(terrain.visibility.some((depth) => depth === model.maxDepth));
});

test("softened terrain preserves cell-centre depths, isolated pillars and trench-edge excavations", () => {
  const model = trench();
  model.depths.forEach((row) => row.fill(8));
  model.depths[10][10] = 0;
  model.depths[0][0] = 15;
  const engine = new graphics.PreviewEngine(canvasFactory);
  const { terrain } = render(engine, model, "full");
  assert.equal(terrain.width, 512);
  for (let y = 0; y < model.rows; y += 1) {
    for (let x = 0; x < model.columns; x += 1) {
      const index = (y * 8 + 4) * terrain.atlasWidth + x * 8 + 4;
      assert.equal(terrain.heights[index], model.depths[y][x], `${x},${y}`);
    }
  }
  assert.ok(terrain.visibility.every((depth) => depth === Infinity || (depth >= 0 && depth <= model.maxDepth)));
});

test("partial finds respect quadrant masks and terrain visibility; collection reuses terrain", () => {
  const model = trench();
  model.depths.forEach((row) => row.fill(8));
  const find = {
    id: "visible", colour: "#ff0000", visualKey: "coin", shape: "coin", depth: 5,
    centerX: 10.5, centerY: 10.5, exposure: "partial",
    footprint: [{ x: 10, y: 10 }, { x: 11, y: 10 }, { x: 10, y: 11 }, { x: 11, y: 11 }]
  };
  const engine = new graphics.PreviewEngine(canvasFactory);
  engine.glyph = () => {
    const pixels = new Uint8ClampedArray(64 * 64 * 4);
    for (let index = 0; index < pixels.length; index += 4) { pixels[index] = 255; pixels[index + 3] = 255; }
    return pixels;
  };
  const initial = render(engine, model);
  model.artefacts = [find];
  model.artefactVisibleQuadrants = () => [0];
  model.visualRevision += 1;
  const partial = render(engine, model);
  assert.equal(partial.rebuilt, false);
  const red = (pixels) => pixels.filter((value, index) => index % 4 === 0 && value === 255 && pixels[index + 1] === 0).length;
  assert.ok(red(partial.canvas.pixels) > 0);
  model.artefactVisibleQuadrants = () => [0, 1, 2, 3];
  const full = render(engine, model);
  assert.ok(red(full.canvas.pixels) > red(partial.canvas.pixels));
  find.depth = 10;
  assert.equal(red(render(engine, model).canvas.pixels), 0, "find beneath the floor is obscured");
  find.exposure = "collected";
  const collected = render(engine, model);
  assert.equal(collected.terrain, initial.terrain);
  assert.deepEqual(collected.canvas.pixels, initial.canvas.pixels);
});

test("navigation and offscreen worker completion reuse previews without requesting a scene redraw", () => {
  const fixture = pipelineFixture();
  fixture.pipeline.prepareSite();
  assert.equal(fixture.sent.length, 1);
  fixture.complete();
  assert.equal(fixture.host.frames, 0);
  assert.equal(fixture.pipeline.isReady(), true);
  fixture.host.currentScene = "site";
  fixture.pipeline.prepareSite();
  fixture.pipeline.prepareSite();
  assert.equal(fixture.sent.length, 1);
  assert.equal(fixture.pipeline.stats.cacheHits, 2);
  fixture.pipeline.dispose();
});

test("rapid brush stamps debounce until gesture end and coalesce the newest pending revision", () => {
  const fixture = pipelineFixture();
  fixture.host.isoOnPause = true;
  fixture.pipeline.excavationStarted();
  fixture.host.pointerAction = { type: "brush" };
  for (let index = 0; index < 20; index += 1) {
    fixture.host.activeTrench.terrainRevision += 1;
    fixture.pipeline.changed(fixture.host.activeTrench);
  }
  assert.equal(fixture.timers.callbacks.size, 0, "holding a still brush cannot start a pause timer");
  assert.equal(fixture.sent.length, 0);
  fixture.host.pointerAction = null;
  fixture.pipeline.gestureEnded();
  fixture.timers.fire(250);
  assert.equal(fixture.sent.length, 1);
  assert.equal(fixture.sent[0].terrainRevision, 20);
  fixture.host.activeTrench.terrainRevision += 1;
  fixture.pipeline.changed(fixture.host.activeTrench);
  fixture.timers.fire(250);
  fixture.host.activeTrench.terrainRevision += 1;
  fixture.pipeline.changed(fixture.host.activeTrench);
  fixture.timers.fire(250);
  const stale = fixture.complete(fixture.sent[0]);
  assert.equal(stale.closes, 1);
  assert.equal(fixture.sent.length, 3);
  assert.equal(fixture.sent[2].terrainRevision, 22);
  assert.equal(fixture.cancellations.length, 2);
  fixture.complete();
  assert.equal(fixture.pipeline.isReady(), true);
  fixture.pipeline.dispose();
});

test("default-Off excavation retains dirtiness without speculative requests or timers", () => {
  const fixture = pipelineFixture();
  fixture.pipeline.prepareSite();
  const committed = fixture.complete();
  fixture.pipeline.excavationStarted();
  fixture.host.activeTrench.terrainRevision += 1;
  fixture.pipeline.changed(fixture.host.activeTrench);
  fixture.pipeline.gestureEnded();
  assert.equal(fixture.timers.callbacks.size, 0);
  assert.equal(fixture.sent.length, 1);
  assert.equal(fixture.pipeline.pending.size, 0);
  assert.equal(fixture.pipeline.dirty.size, 1);
  assert.equal(committed.closes, 0);
  fixture.host.currentScene = "site";
  fixture.pipeline.sceneChanged();
  assert.equal(fixture.sent.length, 2, "map entry urgently prepares dirty trenches");
  fixture.complete();
  assert.equal(fixture.pipeline.dirty.size, 0);
  assert.equal(committed.closes, 1);
  fixture.pipeline.dispose();
});

test("pause work starts once after release, including an exposure-only shovel press", () => {
  const fixture = pipelineFixture();
  fixture.host.isoOnPause = true;
  fixture.pipeline.excavationStarted();
  fixture.host.activeTrench.visualRevision += 1;
  fixture.pipeline.changed(fixture.host.activeTrench);
  assert.equal(fixture.timers.callbacks.size, 0, "no pointerAction is needed to recognise a held press");
  fixture.pipeline.gestureEnded();
  assert.deepEqual([...fixture.timers.callbacks.values()].map((item) => item.delay), [250]);
  fixture.timers.fire(250);
  assert.equal(fixture.sent.length, 1);
  fixture.complete();
  fixture.pipeline.gestureEnded();
  assert.equal(fixture.timers.callbacks.size, 0, "no further changes need another pause job");
  fixture.pipeline.dispose();
});

test("resuming excavation cancels active and pending speculation while preserving committed images", () => {
  const fixture = pipelineFixture([trench(), trench(1)]);
  fixture.pipeline.prepareSite();
  fixture.complete();
  fixture.complete();
  const committed = fixture.pipeline.cache.get(fixture.host.trenches[1].id).bitmap;
  fixture.host.isoOnPause = true;
  fixture.host.trenches.forEach((model) => {
    model.terrainRevision += 1;
    fixture.pipeline.changed(model);
  });
  fixture.timers.fire(250);
  const request = fixture.sent.at(-1);
  assert.equal(fixture.pipeline.pending.size, 1);
  fixture.pipeline.excavationStarted();
  assert.equal(fixture.pipeline.active, null);
  assert.equal(fixture.pipeline.pending.size, 0);
  assert.equal(fixture.pipeline.dirty.size, 2);
  assert.equal(fixture.timers.callbacks.size, 0, "intentional cancellation clears the watchdog");
  assert.equal(fixture.cancellations[0].jobId, request.jobId);
  assert.equal(fixture.worker.terminated, undefined, "cancellation keeps the worker and terrain caches alive");
  const late = fixture.complete(request);
  assert.equal(late.closes, 1, "a result delivered after resumption cannot enter the preview cache");
  assert.equal(committed.closes, 0);
  fixture.worker.onmessage({ data: { type: "preview-cancelled", jobId: request.jobId, computeMs: 8, retainedBytes: 500 } });
  assert.equal(fixture.pipeline.stats.cancelledJobs, 1);
  assert.equal(fixture.pipeline.stats.lastCancelledComputeMs, 8);
  assert.equal(fixture.pipeline.stats.fallbacks, 0);
  fixture.pipeline.gestureEnded();
  fixture.timers.fire(250);
  const next = fixture.pipeline.active;
  fixture.worker.onmessage({ data: { type: "preview-cancelled", jobId: request.jobId, computeMs: 8, retainedBytes: 500 } });
  assert.equal(fixture.pipeline.active, next, "an old acknowledgement cannot consume the new request");
  fixture.complete();
  fixture.complete();
  assert.equal(fixture.pipeline.isReady(), true);
  fixture.pipeline.dispose();
});

test("Finds Lab prioritises the latest trench and continues throughout cleaning with pause Off", () => {
  const fixture = pipelineFixture([trench(), trench(1), trench(2)]);
  fixture.host.trenches.forEach((model) => fixture.pipeline.changed(model));
  fixture.host.currentScene = "cleaning";
  fixture.host.pointerAction = { type: "cleaning-brush" };
  fixture.pipeline.sceneChanged();
  assert.equal(fixture.sent[0].trenchId, fixture.host.trenches[2].id);
  fixture.complete();
  assert.equal(fixture.sent.length, 2, "cleaning pointer state cannot stall the next job");
  fixture.complete();
  fixture.complete();
  assert.equal(fixture.pipeline.isReady(), true);
  fixture.host.currentScene = "site";
  fixture.pipeline.sceneChanged();
  assert.equal(fixture.sent.length, 3, "fresh lab previews supply an immediate map return");
  fixture.pipeline.dispose();
});

test("lab queues park when inspecting a trench; a tool press cancels its running lab job", () => {
  const fixture = pipelineFixture([trench(), trench(1)]);
  fixture.host.currentScene = "cleaning";
  fixture.pipeline.sceneChanged();
  fixture.host.currentScene = "trench";
  fixture.pipeline.sceneChanged();
  fixture.complete();
  assert.equal(fixture.sent.length, 1);
  assert.equal(fixture.pipeline.pending.size, 1);
  fixture.host.currentScene = "cleaning";
  fixture.pipeline.sceneChanged();
  assert.equal(fixture.sent.length, 2);
  fixture.host.currentScene = "trench";
  fixture.pipeline.sceneChanged();
  fixture.pipeline.excavationStarted();
  assert.equal(fixture.pipeline.active, null);
  assert.equal(fixture.pipeline.dirty.size, 1);
  fixture.host.currentScene = "cleaning";
  fixture.pipeline.sceneChanged();
  fixture.complete();
  assert.equal(fixture.pipeline.isReady(), true);
  fixture.pipeline.dispose();
});

test("turning pause Off cancels pause-origin jobs, but preserves urgent and lab preparation", () => {
  for (const origin of ["pause", "map", "lab"]) {
    const fixture = pipelineFixture();
    fixture.host.isoOnPause = true;
    if (origin === "pause") {
      fixture.pipeline.changed(fixture.host.activeTrench);
      fixture.timers.fire(250);
    } else if (origin === "map") fixture.pipeline.prepareSite();
    else { fixture.host.currentScene = "cleaning"; fixture.pipeline.prepareLab(); }
    fixture.host.isoOnPause = false;
    fixture.pipeline.pauseModeChanged();
    assert.equal(fixture.cancellations.length, origin === "pause" ? 1 : 0);
    assert.equal(fixture.pipeline.active === null, origin === "pause");
    fixture.pipeline.dispose();
  }
});

test("quality changes replace speculative work and ignore errors from cancelled jobs", () => {
  const fixture = pipelineFixture();
  fixture.host.currentScene = "cleaning";
  fixture.pipeline.prepareLab();
  const old = fixture.sent[0];
  fixture.host.performanceMode = "full";
  fixture.pipeline.presentationChanged();
  assert.equal(fixture.sent.length, 2);
  assert.equal(fixture.sent[1].quality, "full");
  fixture.worker.onmessage({ data: { type: "preview-error", jobId: old.jobId } });
  assert.equal(fixture.pipeline.stats.fallbacks, 0);
  fixture.worker.onmessage({ data: {
    type: "preview-cancelled", jobId: old.jobId, retainedBytes: 0, computeMs: 2
  } });
  fixture.complete();
  assert.equal(fixture.pipeline.isReady(), true);
  assert.equal(fixture.pipeline.stats.lastComputeMs, 3);
  assert.ok(fixture.pipeline.stats.lastLatencyMs >= fixture.pipeline.stats.lastQueueMs);
  fixture.pipeline.dispose();
});

test("fallback cancellation drops temporary buffers without replacing committed terrain", () => {
  const fixture = pipelineFixture();
  fixture.pipeline.createWorker = () => null;
  let ticks = 0;
  fixture.pipeline.now = () => ticks++;
  const drain = () => {
    let steps = 0;
    while (fixture.pipeline.active && steps++ < 1000) fixture.timers.fire(0);
    assert.ok(steps < 1000);
  };
  fixture.pipeline.prepareSite();
  drain();
  const engine = fixture.pipeline.fallbackEngine;
  const terrain = engine.terrains.get(fixture.host.activeTrench.id);
  fixture.host.isoOnPause = true;
  fixture.host.activeTrench.terrainRevision += 1;
  fixture.pipeline.changed(fixture.host.activeTrench);
  fixture.timers.fire(250);
  fixture.timers.fire(0);
  const temporary = fixture.pipeline.fallbackJob.canvas;
  fixture.pipeline.excavationStarted();
  assert.equal(fixture.pipeline.fallbackJob, null);
  assert.equal(fixture.timers.callbacks.size, 0);
  assert.equal(temporary.width, 1);
  assert.equal(engine.terrains.get(fixture.host.activeTrench.id), terrain);
  assert.equal(fixture.pipeline.stats.cancelledJobs, 1);
  assert.equal(fixture.pipeline.stats.fallbacks, 1, "cancellation does not count as worker failure");
  fixture.host.currentScene = "site";
  fixture.pipeline.sceneChanged();
  drain();
  assert.equal(fixture.pipeline.isReady(), true);
  assert.notEqual(engine.terrains.get(fixture.host.activeTrench.id), terrain);
  fixture.pipeline.dispose();
});

test("pause toggle defaults Off in each new session without changing quality or presentation", () => {
  const scene = manager();
  assert.equal(scene.isoOnPause, false);
  const quality = scene.performanceMode;
  const presentation = scene.mapRenderMode;
  scene.activateDebugOption("iso-pause");
  assert.equal(scene.isoOnPause, true);
  assert.equal(scene.performanceMode, quality);
  assert.equal(scene.mapRenderMode, presentation);
  assert.equal(manager().isoOnPause, false);
});

test("only changed trenches rebuild and stale job identifiers cannot consume an active request", () => {
  const fixture = pipelineFixture([trench(), trench(1)]);
  fixture.pipeline.prepareSite();
  fixture.complete();
  fixture.complete();
  const oldBitmap = fixture.pipeline.cache.get(fixture.host.trenches[0].id).bitmap;
  fixture.host.trenches[0].terrainRevision += 1;
  fixture.host.currentScene = "site";
  fixture.pipeline.prepareSite();
  assert.equal(fixture.sent.length, 3);
  const active = fixture.pipeline.active;
  fixture.complete(fixture.sent[0]);
  assert.equal(fixture.pipeline.active, active);
  fixture.complete();
  assert.equal(oldBitmap.closes, 1);
  assert.equal(fixture.pipeline.cache.size, 2);
  fixture.pipeline.dispose();
});

test("worker failure and watchdog timeout switch to sliced rendering and complete fresh previews", () => {
  for (const failure of ["error", "timeout"]) {
    const fixture = pipelineFixture();
    fixture.pipeline.prepareSite();
    if (failure === "error") fixture.worker.onerror();
    else fixture.timers.fire(5000);
    assert.equal(fixture.worker.terminated, true);
    let steps = 0;
    while (fixture.timers.callbacks.size && steps++ < 500) fixture.timers.fire(0);
    assert.equal(fixture.pipeline.isReady(), true);
    assert.equal(fixture.pipeline.stats.fallbacks, 1);
    assert.ok(fixture.pipeline.cache.values().next().value.bitmap.pixels.length > 0);
    fixture.pipeline.dispose();
  }
});

test("cache replacement and disposal release buffers and ignore late worker results", () => {
  const fixture = pipelineFixture();
  fixture.pipeline.prepareSite();
  const bitmap = fixture.complete();
  fixture.pipeline.dispose();
  assert.equal(bitmap.closes, 1);
  assert.equal(fixture.pipeline.stats.bitmapBytes, 0);
  assert.equal(fixture.timers.callbacks.size, 0);
  const late = fixture.complete();
  assert.equal(late.closes, 1);
});

test("quality changes reject old results and retain only one terrain and image per trench", () => {
  const fixture = pipelineFixture();
  fixture.pipeline.prepareSite();
  fixture.host.performanceMode = "full";
  fixture.pipeline.prepareSite();
  const stale = fixture.complete(fixture.sent[0]);
  assert.equal(stale.closes, 1);
  assert.equal(fixture.sent.length, 2);
  assert.equal(fixture.sent[1].quality, "full");
  fixture.complete();
  assert.equal(fixture.pipeline.isReady(), true);
  fixture.pipeline.dispose();
  const model = trench();
  const engine = new graphics.PreviewEngine(canvasFactory);
  for (let index = 0; index < 8; index += 1) {
    model.depths[9][9] = index;
    model.terrainRevision += 1;
    render(engine, model);
    assert.equal(engine.terrains.size, 1);
    assert.ok(engine.retainedBytes() < 400000);
  }
});

test("changes in multiple trenches survive a shared debounce timer and unsupported workers fall back", () => {
  const fixture = pipelineFixture([trench(), trench(1)]);
  fixture.host.isoOnPause = true;
  for (const model of fixture.host.trenches) {
    model.terrainRevision += 1;
    fixture.pipeline.changed(model);
  }
  fixture.timers.fire(250);
  assert.equal(fixture.sent.length, 1);
  fixture.complete();
  assert.equal(fixture.sent.length, 2);
  fixture.complete();
  assert.equal(fixture.pipeline.isReady(), true);
  fixture.pipeline.dispose();

  const unsupported = pipelineFixture();
  unsupported.pipeline.createWorker = () => null;
  unsupported.pipeline.prepareSite();
  let steps = 0;
  while (unsupported.timers.callbacks.size && steps++ < 500) unsupported.timers.fire(0);
  assert.equal(unsupported.pipeline.isReady(), true);
  assert.equal(unsupported.pipeline.stats.fallbacks, 1);
  unsupported.pipeline.dispose();
});

test("portrait and desktop ground projections fit and shared walkways never select a trench", () => {
  const scene = manager();
  scene.config.map = { rows: 3, columns: 3 };
  scene.config.trench.columns = 20;
  scene.trenches = Array.from({ length: 9 }, (_, index) => ({ id: String(index) }));
  for (const [width, height] of [[240, 320], [375, 667], [667, 375], [280, 373], [375, 500], [640, 480], [1280, 720]]) {
    const layout = scene.siteScene.computeLayout(width, height);
    scene.mapTiles = layout.tiles;
    assert.equal(layout.axisLabels.map((ref) => ref.label).join(""), "ABC123");
    for (const ref of layout.axisLabels) {
      assert.equal(scene.hitMapTile(ref.x, ref.y), undefined);
      assert.ok(ref.x > 9 && ref.x < width - 9 && ref.y >= 76);
    }
    layout.tiles.forEach((tile, index) => {
      const row = layout.axisLabels[Math.floor(index / 3)];
      const col = layout.axisLabels[3 + index % 3];
      const rowEdge = layout.project(0, tile.v + 0.5);
      const colEdge = layout.project(tile.u + 0.5, 0);
      assert.ok(Math.hypot(row.x + 7 - rowEdge.x, row.y + 14 - rowEdge.y) < 1e-8);
      assert.ok(Math.hypot(col.x - 7 - colEdge.x, col.y + 14 - colEdge.y) < 1e-8);
    });
    for (const tile of layout.tiles) {
      assert.equal(scene.hitMapTile(tile.x, tile.y), tile);
      assert.ok(tile.x - tile.width / 2 >= 18);
      assert.ok(tile.x + tile.width / 2 <= width - 18);
      assert.ok(tile.y - tile.height / 2 >= 76);
      assert.ok(tile.y + tile.height / 2 < height - 65);
    }
    const walkway = layout.project(1.075, 0.55);
    assert.equal(scene.hitMapTile(walkway.x, walkway.y), undefined);
  }
});

test("both return routes use the preparation gate and resize leaves preview caches intact", () => {
  const scene = manager();
  let prepares = 0;
  scene.siteScene.prepare = () => { prepares += 1; };
  scene.currentScene = "trench";
  scene.leaveTrenchToSite();
  assert.equal(scene.currentScene, "site");
  scene.currentScene = "cleaning";
  scene.layout = { labBackButton: { x: 0, y: 0, width: 30, height: 30 } };
  scene.cleaningPointerStart(10, 10);
  assert.equal(scene.currentScene, "site");
  assert.equal(prepares, 2);
  const cache = scene.siteScene.pipeline.cache;
  scene.handleResize();
  assert.equal(scene.siteScene.pipeline.cache, cache);
});

test("incomplete site preparation blocks map interactions and first-frame loader removal", () => {
  const scene = manager();
  let entries = 0;
  scene.siteScene.isReady = () => false;
  scene.trenchScene.enter = () => { entries += 1; };
  scene.mapTiles = [{ x: 10, y: 10, width: 50, height: 25 }];
  scene.pointerStart(10, 10);
  assert.equal(entries, 0);
  const main = fs.readFileSync(path.join(__dirname, "../src/main.js"), "utf8");
  assert.match(main, /!firstFramePresented && sceneManager\.siteScene\.isReady\(\)/);
  assert.match(main, /GameBoot\?\.addResources\(sceneManager\.trenches\.length\)/);
});
