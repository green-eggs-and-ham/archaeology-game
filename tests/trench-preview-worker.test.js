const { test, assert, fs, path, vm } = require("./helpers/scene-harness.js");

function workerFixture() {
  const tasks = [];
  const messages = [];
  let time = 0;
  const worker = {
    performance: { now: () => time++ },
    postMessage: (message) => messages.push(message),
    OffscreenCanvas: class {
      constructor(width, height) { this.width = width; this.height = height; }
      getContext() {
        return {
          createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
          putImageData() {}
        };
      }
      transferToImageBitmap() { return { width: this.width, height: this.height }; }
    },
    MessageChannel: class {
      constructor() {
        this.port1 = {};
        this.port2 = { postMessage: () => tasks.push(() => this.port1.onmessage()) };
      }
    }
  };
  worker.self = worker;
  vm.createContext(worker);
  const read = (file) => fs.readFileSync(path.join(__dirname, "../src/game", file), "utf8");
  worker.importScripts = (...files) => files.forEach((file) => vm.runInContext(read(file), worker));
  vm.runInContext(read("TrenchPreviewWorker.js"), worker);
  const configContext = vm.createContext({ window: {} });
  for (const file of ["data/game-config.js", "src/game/ArtefactCatalogue.js", "src/game/TrenchModel.js"]) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, "..", file), "utf8"), configContext);
  }
  const config = configContext.window.GameConfig;
  const model = new configContext.window.TrenchModel(config.trenches[0], config);
  model.artefacts = [];
  model.depths.forEach((row, y) => row.forEach((_, x) => { row[x] = (x + y) % 2 ? 14 : 16; }));
  function request(jobId) {
    const identity = worker.TrenchPreviewGraphics.keys(model, "lite");
    return {
      type: "render-preview", jobId, trenchId: model.id, quality: "lite",
      key: identity.preview, terrainKey: identity.terrain,
      snapshot: worker.TrenchPreviewGraphics.snapshot(model)
    };
  }
  const evaluate = (code) => vm.runInContext(code, worker);
  const dispatch = (message) => worker.onmessage({ data: message });
  function tick() { assert.ok(tasks.length, "a continuation should be queued"); tasks.shift()(); }
  function drain() {
    let count = 0;
    while (tasks.length && count++ < 1000) tick();
    assert.ok(count < 1000, "worker must finish or cancel without an endless continuation");
  }
  return { worker, messages, tasks, model, request, evaluate, dispatch, tick, drain };
}

test("worker yields bounded chunks and cancels construction without committing terrain", () => {
  const fixture = workerFixture();
  fixture.dispatch(fixture.request(1));
  fixture.tick();
  assert.equal(fixture.messages.length, 0, "construction yields before completion");
  assert.equal(fixture.tasks.length, 1);
  fixture.dispatch({ type: "cancel-preview", jobId: 1 });
  fixture.drain();
  assert.equal(fixture.messages.length, 1);
  assert.equal(fixture.messages[0].type, "preview-cancelled");
  assert.ok(fixture.messages[0].computeMs > 0);
  assert.equal(fixture.messages[0].retainedBytes, 0);
  assert.equal(fixture.evaluate("previewEngine.terrains.size"), 0);
  assert.equal(fixture.evaluate("activePreview"), null);
  fixture.dispatch(fixture.request(2));
  fixture.drain();
  const result = fixture.messages.at(-1);
  assert.equal(result.type, "preview-result");
  assert.equal(result.jobId, 2);
  assert.equal(result.rebuilt, true);
  assert.ok(result.computeMs < result.elapsedMs, "elapsed time includes cooperative yields");
  assert.ok(result.maxChunkMs <= 10, "synthetic clock bounds the eight-ms chunk loop");
  fixture.dispatch(fixture.request(3));
  fixture.drain();
  assert.equal(fixture.messages.at(-1).rebuilt, false, "the live worker retains completed geometry");
});

test("cancelling find composition preserves the previous terrain cache, including newly built geometry", () => {
  const fixture = workerFixture();
  fixture.dispatch(fixture.request(1));
  fixture.drain();
  const committed = fixture.evaluate("previewEngine.terrains.values().next().value");
  // Use an opaque deterministic silhouette, then observe the real composition generator.
  fixture.evaluate(`
    previewEngine.glyph = () => new Uint8ClampedArray(64 * 64 * 4).fill(255);
    const originalCompose = previewEngine.compose;
    let composing = false;
    previewEngine.compose = function* (...args) { composing = true; yield* originalCompose.apply(this, args); };
  `);
  for (const rebuild of [false, true]) {
    if (rebuild) fixture.model.terrainRevision += 1;
    fixture.model.visualRevision += 1;
    const request = fixture.request(rebuild ? 3 : 2);
    request.snapshot.artefacts = Array.from({ length: 6 }, (_, index) => ({
      id: String(index), visualKey: "coin", colour: "#ffffff", shape: "coin",
      depth: 13, centerX: 2 + index * 2, centerY: 10, footprintSize: 2,
      visibleQuadrants: [0, 1, 2, 3]
    }));
    fixture.evaluate("composing = false");
    fixture.dispatch(request);
    while (!fixture.evaluate("composing")) fixture.tick();
    assert.notEqual(fixture.evaluate("activePreview"), null);
    assert.equal(fixture.evaluate("previewEngine.terrains.values().next().value"), committed);
    fixture.dispatch({ type: "cancel-preview", jobId: request.jobId });
    fixture.drain();
    assert.equal(fixture.messages.at(-1).type, "preview-cancelled");
    assert.equal(fixture.evaluate("previewEngine.terrains.values().next().value"), committed);
  }
  fixture.dispatch(fixture.request(4));
  fixture.drain();
  assert.equal(fixture.messages.at(-1).rebuilt, true);
  assert.notEqual(fixture.evaluate("previewEngine.terrains.values().next().value"), committed);
});

test("stale cancellation IDs cannot stop newer worker jobs or duplicate a finished result", () => {
  const fixture = workerFixture();
  fixture.dispatch(fixture.request(1));
  fixture.tick();
  fixture.dispatch(fixture.request(2));
  assert.equal(fixture.messages[0].type, "preview-cancelled");
  fixture.dispatch({ type: "cancel-preview", jobId: 1 });
  assert.equal(fixture.evaluate("activePreview.request.jobId"), 2);
  fixture.drain();
  assert.equal(fixture.messages.at(-1).jobId, 2);
  const count = fixture.messages.length;
  fixture.dispatch({ type: "cancel-preview", jobId: 2 });
  fixture.drain();
  assert.equal(fixture.messages.length, count);
});

test("cancelling during the screen-size fit preserves committed colours and releases the temporary canvas", () => {
  const f = workerFixture();
  const request = f.request(1);
  request.snapshot.artefacts = [{ id: "find", shape: "coin", colour: "#ffcc44", depth: 3,
    centerX: 10.5, centerY: 10.5, visibleQuadrants: [0, 1, 2, 3] }];
  f.evaluate("previewEngine.glyph = () => new Uint8ClampedArray(64 * 64 * 4).fill(255)");
  f.dispatch(request);
  f.drain();
  const committed = f.evaluate("previewEngine.terrains.values().next().value.composition");
  assert.ok(committed.levels.length);
  f.evaluate("let fitting; previewEngine.canvasFactory = (w, h) => (fitting = new OffscreenCanvas(w, h));");
  f.model.visualRevision++;
  const display = { width: 80.625, height: 40.3125, phaseX: 0.25, phaseY: 0.75, filterX: 1, filterY: 1, key: "phone" };
  f.dispatch({ ...f.request(2), display });
  while (!f.evaluate("fitting")) f.tick();
  f.dispatch({ type: "cancel-preview", jobId: 2 });
  f.drain();
  assert.equal(f.messages.at(-1).type, "preview-cancelled");
  assert.equal(f.evaluate("fitting.width"), 1);
  assert.equal(f.evaluate("previewEngine.terrains.values().next().value.composition"), committed);
  f.dispatch({ ...f.request(3), display });
  f.drain();
  assert.equal(f.messages.at(-1).rebuilt, false);
  assert.equal(f.messages.at(-1).fitted.width, 81);
});
