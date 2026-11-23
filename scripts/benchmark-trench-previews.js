/* DevTools-only harness. Load after tests/fixtures/iso-adversarial-terrain.js in a disposable game tab. */
(function registerBenchmark(root) {
  "use strict";
  const graphics = root.TrenchPreviewGraphics;
  const canvasFactory = (width, height) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  };
  const summary = (values) => {
    const ordered = [...values].sort((a, b) => a - b);
    const middle = Math.floor(ordered.length / 2);
    return {
      median: ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2,
      p95: ordered[Math.ceil(ordered.length * 0.95) - 1]
    };
  };

  async function run({ pattern = "deep-checkerboard", quality = "full", mode = "sync", cpuRate = 1,
    samples = 20, warmups = 3, findOnly = false, displayWidth = null } = {}) {
    if (!["sync", "worker", "fallback"].includes(mode)) throw new Error(`Unknown benchmark mode: ${mode}`);
    const model = root.IsoAdversarialTerrain.create(root.TrenchModel, root.GameConfig, pattern);
    const engine = mode === "sync" ? new graphics.PreviewEngine(canvasFactory) : null;
    const canvas = engine ? canvasFactory(1, 1) : null;
    const worker = mode === "worker" ? new Worker("./src/game/TrenchPreviewWorker.js") : null;
    const display = displayWidth ? { width: displayWidth, height: displayWidth / 2, phaseX: 0.25, phaseY: 0.5,
      filterX: 1, filterY: 1, key: "benchmark-display" } : null;
    const host = {
      trenches: [model], activeTrench: model, currentScene: "cleaning", pointerAction: { type: "cleaning" },
      performanceMode: quality, mapRenderMode: "relief", isoOnPause: false, requestFrame() {},
      siteScene: { previewTarget: () => display }
    };
    const pipeline = mode === "fallback" ? new root.TrenchPreviewPipeline(host, { createWorker: () => null, canvasFactory }) : null;
    const timings = [];
    let jobId = 0;

    async function sample(forceTerrain = false) {
      if (!findOnly || forceTerrain) model.terrainRevision += 1;
      if (findOnly && !forceTerrain) {
        const find = model.artefacts[0];
        find.exposure = find.exposure === "revealed" ? "collected" : "revealed";
      }
      model.visualRevision += 1;
      const identity = graphics.keys(model, quality);
      const request = {
        type: "render-preview", jobId: ++jobId, trenchId: model.id, key: identity.preview,
        terrainKey: identity.terrain, quality, display, snapshot: graphics.snapshot(model)
      };
      const started = performance.now();
      if (engine) {
        const iterator = engine.render(request, canvas);
        let step;
        do { step = iterator.next(); } while (!step.done);
        graphics.releaseLevels?.(step.value.levels);
        graphics.releaseImage?.(step.value.fitted);
        return { activeMs: step.value.renderMs, totalMs: performance.now() - started, rebuilt: step.value.rebuilt };
      }
      if (worker) {
        return await new Promise((resolve, reject) => {
          worker.onerror = reject;
          worker.onmessage = ({ data }) => {
            if (data.type !== "preview-result") { reject(new Error(JSON.stringify(data))); return; }
            data.bitmap.close();
            graphics.releaseLevels?.(data.levels);
            graphics.releaseImage?.(data.fitted);
            resolve({ activeMs: data.computeMs, totalMs: performance.now() - started,
              maxChunkMs: data.maxChunkMs, rebuilt: data.rebuilt });
          };
          worker.postMessage(request);
        });
      }
      return await new Promise((resolve) => {
        const receive = root.TrenchPreviewPipeline.prototype.receive;
        pipeline.receive = (result) => {
          receive.call(pipeline, result);
          resolve({ activeMs: pipeline.stats.lastComputeMs, totalMs: pipeline.stats.lastLatencyMs,
            maxChunkMs: pipeline.stats.lastMaxChunkMs, rebuilt: result.rebuilt });
        };
        pipeline.request(model, "lab");
      });
    }

    try {
      if (findOnly) await sample(true);
      for (let index = 0; index < warmups + samples; index += 1) {
        const timing = await sample();
        if (timing.rebuilt === findOnly) throw new Error("Benchmark did not exercise the requested cache path.");
        if (index >= warmups) timings.push(timing);
      }
      return {
        pattern, quality, mode, cpuRate, findOnly, displayWidth, samples, warmups,
        topology: root.IsoAdversarialTerrain.topology(model.depths), finds: model.artefacts.length,
        activeMs: summary(timings.map((item) => item.activeMs)),
        totalMs: summary(timings.map((item) => item.totalMs)),
        maxChunkMs: mode === "sync" ? null : summary(timings.map((item) => item.maxChunkMs)), timings,
        userAgent: navigator.userAgent, rendererVersion: graphics.VERSION
      };
    } finally {
      engine?.dispose();
      pipeline?.dispose();
      worker?.terminate();
      if (canvas) canvas.width = canvas.height = 1;
    }
  }

  // A complete replay uses a separate manager and never edits the player's finds.
  function lab({ samples = 20, warmups = 3, cpuRate = 1 } = {}) {
    const scene = new root.SceneManager(root.GameConfig);
    scene.requestFrame = () => {};
    scene.currentScene = "cleaning";
    for (const trench of scene.trenches) {
      for (const find of trench.artefacts) {
        find.exposure = "collected";
        scene.assignCollectionSequence(find);
        if (find.cleanable) scene.cleaningModel.ensureState(find);
      }
    }
    const find = scene.cleanableCollectedArtefacts()[0];
    scene.cleaningModel.immerse(find);
    scene.cleaningModel.placeOnMat(find);
    scene.cleaningTool = find.cleaningTool;
    const timings = [];
    try {
      for (let i = 0; i < samples + warmups; i++) {
        const mat = scene.cleaningLayout().matSurface;
        scene.pointer = { x: mat.x + mat.width * (0.4 + (i % 6) * 0.04),
          y: mat.y + mat.height / 2, pressed: false, source: "mouse" };
        const start = performance.now();
        scene.draw();
        const elapsed = performance.now() - start;
        if (i >= warmups) timings.push(elapsed);
      }
      return { cpuRate, samples, warmups, finds: scene.allCollectedArtefacts().length, ms: summary(timings),
        timings, sorts: scene.frameStats.inventorySorts, panels: scene.frameStats.inventoryRebuilds };
    } finally {
      scene.cleaningScene.leave();
      scene.siteScene.dispose();
      scene.terrainPipeline.dispose();
      scene.renderer.backgroundLayer?.remove();
    }
  }

  function profile({ samples = 20, warmups = 3, cpuRate = 1 } = {}) {
    const scene = new root.SceneManager(root.GameConfig);
    const trench = scene.activeTrench = scene.trenches[0];
    const centre = Math.floor(trench.rows / 2);
    trench.depths[centre].fill(trench.maxDepth);
    trench.artefacts = [];
    scene.layout = scene.trenchLayout();
    const cases = {};
    try {
      for (const row of [0, centre]) {
        const times = [];
        for (let i = 0; i < samples + warmups; i++) {
          trench.depths[row][3] = trench.maxDepth - 1 - i % 2;
          trench.terrainRevision++;
          trench.visualRevision++;
          scene.renderer.drawBackground();
          const start = performance.now();
          scene.drawCachedProfile(trench, scene.layout.profile);
          const elapsed = performance.now() - start;
          if (i >= warmups) times.push(elapsed);
        }
        cases[row === centre ? "centre" : "offRow"] = { ms: summary(times), times };
      }
      return { cpuRate, samples, warmups, ...cases };
    } finally {
      scene.trenchScene.handleResize();
      scene.siteScene.dispose();
      scene.terrainPipeline.dispose();
      scene.renderer.backgroundLayer?.remove();
    }
  }

  // Compare the displayed deep wall with the exact area average of the same
  // canonical image. Ignore pixels crossing a silhouette, floor or opening.
  function wallFidelity(tileWidth = 80.625, quality = "full") {
    const model = root.IsoAdversarialTerrain.create(root.TrenchModel, root.GameConfig, "deep-floor");
    model.artefacts = [];
    const engine = new graphics.PreviewEngine(canvasFactory);
    const canvas = canvasFactory(1, 1);
    const iterator = engine.render({ trenchId: model.id, terrainKey: "wall", quality,
      snapshot: graphics.snapshot(model) }, canvas);
    let step;
    do { step = iterator.next(); } while (!step.done);
    const terrain = engine.terrains.get(model.id);
    const record = { bitmap: canvas, width: canvas.width, levels: step.value.levels };
    const site = root.sceneManager.siteScene;
    const tileHeight = tileWidth / 2;
    const output = canvasFactory(Math.ceil(tileWidth) + 2, Math.ceil(tileHeight) + 2);
    const ctx = output.getContext("2d", { willReadFrequently: true });
    const errors = [];
    try {
      for (const phase of [0, 0.25, 0.5, 0.75]) {
        ctx.clearRect(0, 0, output.width, output.height);
        if (site.drawPreview) {
          ctx.imageSmoothingQuality = "high";
          site.drawPreview(ctx, record, { x: phase + tileWidth / 2, y: phase + tileHeight / 2, width: tileWidth, height: tileHeight },
            { x: 1, y: 1, filterX: 1, filterY: 1 });
        } else ctx.drawImage(canvas, phase, phase, tileWidth, tileHeight);
        const measured = ctx.getImageData(0, 0, output.width, output.height).data;
        for (let y = 1; y < tileHeight - 1; y++) {
          for (let x = 1; x < tileWidth - 1; x++) {
            const scale = canvas.width / tileWidth;
            const left = (x - phase) * scale, top = (y - phase) * scale;
            const right = left + scale, bottom = top + scale;
            const sum = [0, 0, 0];
            let wall = true;
            for (let sy = Math.floor(top); sy < bottom && wall; sy++) {
              const overlapY = Math.min(bottom, sy + 1) - Math.max(top, sy);
              for (let sx = Math.floor(left); sx < right; sx++) {
                const pixel = sy * terrain.width + sx;
                if (!(terrain.visibility[pixel] < model.maxDepth)) { wall = false; break; }
                const area = overlapY * (Math.min(right, sx + 1) - Math.max(left, sx));
                for (let c = 0; c < 3; c++) sum[c] += terrain.pixels[4 * pixel + c] * area;
              }
            }
            if (wall) {
              const offset = 4 * (y * output.width + x);
              errors.push(Math.max(...sum.map((value, c) => Math.abs(value / (scale * scale) - measured[offset + c]))));
            }
          }
        }
      }
      return { tileWidth, quality, wallPixels: errors.length, error: summary(errors), max: Math.max(...errors) };
    } finally {
      graphics.releaseLevels?.(record.levels);
      graphics.releaseImage?.(record.fitted);
      engine.dispose();
      canvas.width = canvas.height = output.width = output.height = 1;
    }
  }

  root.TrenchPreviewBenchmark = { run, lab, profile, wallFidelity, summary };
})(window);
