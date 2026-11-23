(function registerTrenchPreviewPipeline(root) {
  "use strict";

  const urgentOrigin = (origin) => origin === "map" || origin === "startup";

  class TrenchPreviewPipeline {
    constructor(host, options = {}) {
      this.host = host;
      this.cache = new Map();
      this.pending = new Map();
      this.dirty = new Set();
      this.lastChangedTrench = null;
      this.active = null;
      this.worker = null;
      this.workerDisabled = false;
      this.disposed = false;
      this.sequence = 0;
      this.debounce = null;
      this.pauseReady = false;
      this.excavatingGesture = false;
      this.watchdog = null;
      this.fallbackTimer = null;
      this.fallbackJob = null;
      this.fallbackEngine = null;
      this.lastCancelledJobId = null;
      this.bootCounted = new Set();
      this.stats = {
        cacheHits: 0, terrainRebuilds: 0, compositions: 0, workerDispatches: 0,
        staleResults: 0, fallbacks: 0, retainedBytes: 0, bitmapBytes: 0,
        lastRenderMs: 0, lastComputeMs: 0, lastLatencyMs: 0, lastQueueMs: 0,
        lastMaxChunkMs: 0, cancelledJobs: 0, lastCancelledComputeMs: 0
      };
      this.setTimer = options.setTimer || ((callback, delay) => setTimeout(callback, delay));
      this.clearTimer = options.clearTimer || ((handle) => clearTimeout(handle));
      this.canvasFactory = options.canvasFactory || ((width, height) => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas;
      });
      this.createWorker = options.createWorker || (() => {
        if (typeof Worker !== "function" || typeof OffscreenCanvas !== "function") return null;
        return new Worker("./src/game/TrenchPreviewWorker.js");
      });
    }

    now() { return root.TrenchPreviewGraphics.now(); }
    identity(trench) { return root.TrenchPreviewGraphics.keys(trench, this.host.performanceMode); }

    isReady() {
      return this.host.mapRenderMode === "flat" || this.host.trenches.every((trench) =>
        this.cache.get(trench.id)?.key === this.identity(trench).preview
      );
    }

    orderedTrenches() {
      const first = this.lastChangedTrench || this.host.activeTrench;
      return [...this.host.trenches].sort((a, b) => Number(b === first) - Number(a === first));
    }

    clearPause() {
      if (this.debounce !== null) this.clearTimer(this.debounce);
      this.debounce = null;
      this.pauseReady = false;
    }

    clearWatchdog() {
      if (this.watchdog !== null) this.clearTimer(this.watchdog);
      this.watchdog = null;
    }

    request(trench, origin = "map") {
      if (this.disposed || this.host.mapRenderMode === "flat") return;
      const key = this.identity(trench).preview;
      if (this.cache.get(trench.id)?.key === key) {
        this.stats.cacheHits += 1;
        this.dirty.delete(trench);
        this.pending.delete(trench.id);
        return;
      }
      this.dirty.add(trench);
      if (this.active?.trenchId === trench.id && this.active.key === key) {
        if (urgentOrigin(origin) || origin === "lab") this.active.origin = origin;
        return;
      }
      const previous = this.pending.get(trench.id);
      const priority = urgentOrigin(previous?.origin) ? previous.origin : origin;
      this.pending.set(trench.id, { trench, key, origin: priority, queuedAt: previous?.queuedAt ?? this.now() });
      this.pump();
    }

    prepareSite() {
      this.clearPause();
      this.orderedTrenches().forEach((trench) => this.request(trench, "map"));
    }

    prepareLab() {
      this.clearPause();
      this.orderedTrenches().forEach((trench) => this.request(trench, "lab"));
    }

    sceneChanged() {
      this.clearPause();
      this.excavatingGesture = false;
      if (this.host.currentScene === "cleaning") this.prepareLab();
      else if (this.host.currentScene === "site") this.prepareSite();
      // Lab work already in progress may finish while inspecting a trench.
      // Its remaining queue stays parked until the next eligible scene/pause.
    }

    eligible(entry) {
      if (urgentOrigin(entry.origin)) return true;
      if (this.host.currentScene === "cleaning") return true;
      return entry.origin === "pause" && this.host.currentScene === "trench" &&
        this.host.isoOnPause && this.pauseReady && !this.excavatingGesture && !this.host.pointerAction;
    }

    changed(trench) {
      if (this.disposed || !this.host.trenches.includes(trench)) return;
      this.lastChangedTrench = trench;
      this.dirty.add(trench);
      this.pending.delete(trench.id);
      if (this.active?.trenchId === trench.id && !urgentOrigin(this.active.origin) &&
          this.active.key !== this.identity(trench).preview) this.cancelActive();
      if (this.host.currentScene === "cleaning") this.prepareLab();
      else if (this.host.currentScene === "site") this.prepareSite();
      else this.schedulePause();
    }

    schedulePause() {
      this.clearPause();
      if (this.disposed || !this.host.isoOnPause || this.host.mapRenderMode === "flat" ||
          this.host.currentScene !== "trench" || this.excavatingGesture || this.host.pointerAction || !this.dirty.size) return;
      this.debounce = this.setTimer(() => {
        this.debounce = null;
        if (this.disposed || !this.host.isoOnPause || this.host.currentScene !== "trench" || this.excavatingGesture || this.host.pointerAction) return;
        this.pauseReady = true;
        this.orderedTrenches().filter((trench) => this.dirty.has(trench)).forEach((trench) => this.request(trench, "pause"));
      }, 250);
    }

    gestureEnded() {
      this.excavatingGesture = false;
      this.schedulePause();
    }

    excavationStarted() {
      this.excavatingGesture = true;
      this.clearPause();
      this.cancelSpeculative();
    }

    pauseModeChanged() {
      this.clearPause();
      if (!this.host.isoOnPause) this.cancelSpeculative("pause");
      else this.schedulePause();
    }

    presentationChanged() {
      this.clearPause();
      this.cancelSpeculative();
      if (this.host.currentScene === "site") this.prepareSite();
      else if (this.host.currentScene === "cleaning") this.prepareLab();
      else this.schedulePause();
    }

    cancelSpeculative(origin = null) {
      for (const [id, entry] of this.pending) {
        if (!urgentOrigin(entry.origin) && (!origin || entry.origin === origin)) {
          this.dirty.add(entry.trench);
          this.pending.delete(id);
        }
      }
      if (this.active && !urgentOrigin(this.active.origin) && (!origin || this.active.origin === origin)) this.cancelActive();
    }

    cancelActive() {
      const request = this.active;
      if (!request) return;
      this.active = null;
      this.clearWatchdog();
      const trench = this.host.trenches.find((item) => item.id === request.trenchId);
      if (trench) this.dirty.add(trench);
      this.stats.cancelledJobs += 1;
      this.lastCancelledJobId = request.jobId;
      this.stats.lastCancelledComputeMs = 0;
      if (this.fallbackJob?.request.jobId === request.jobId) {
        this.stats.lastCancelledComputeMs = this.fallbackJob.computeMs;
        this.releaseFallback();
        this.stats.retainedBytes = this.fallbackEngine.retainedBytes();
      } else if (this.worker) {
        try { this.worker.postMessage({ type: "cancel-preview", jobId: request.jobId }); }
        catch (_error) { this.disableWorker(); }
      }
      this.host.updateCanvasPixelStats?.();
    }

    ensureWorker() {
      if (this.workerDisabled) return null;
      if (this.worker) return this.worker;
      try {
        this.worker = this.createWorker();
        if (!this.worker) {
          this.workerDisabled = true;
          this.stats.fallbacks += 1;
          return null;
        }
        this.worker.onmessage = (event) => this.receive(event.data);
        this.worker.onerror = (event) => { event?.preventDefault?.(); this.disableWorker(); };
        this.worker.onmessageerror = () => this.disableWorker();
        return this.worker;
      } catch (_error) {
        this.workerDisabled = true;
        this.stats.fallbacks += 1;
        return null;
      }
    }

    pump() {
      if (this.disposed || this.active || this.host.mapRenderMode === "flat") return;
      const eligible = [...this.pending.values()].filter((item) => this.eligible(item));
      const entry = eligible.find((item) => urgentOrigin(item.origin)) ||
        eligible.find((item) => item.trench === this.lastChangedTrench) || eligible[0];
      if (!entry) return;
      const id = entry.trench.id;
      this.pending.delete(id);
      const identity = this.identity(entry.trench);
      if (this.cache.get(id)?.key === identity.preview) {
        this.dirty.delete(entry.trench);
        this.pump();
        return;
      }
      const request = {
        type: "render-preview", jobId: ++this.sequence, trenchId: id, key: identity.preview,
        terrainKey: identity.terrain, quality: this.host.performanceMode, origin: entry.origin,
        terrainRevision: entry.trench.terrainRevision || 0, visualRevision: entry.trench.visualRevision || 0,
        display: this.host.siteScene?.previewTarget?.(id),
        snapshot: root.TrenchPreviewGraphics.snapshot(entry.trench),
        queuedAt: entry.queuedAt, dispatchedAt: this.now()
      };
      this.active = request;
      const worker = this.ensureWorker();
      if (worker) {
        try {
          this.stats.workerDispatches += 1;
          this.watchdog = this.setTimer(() => {
            if (this.active?.jobId === request.jobId) this.disableWorker();
          }, 5000);
          worker.postMessage(request);
        } catch (_error) { this.disableWorker(); }
      } else this.renderFallback(request);
    }

    renderFallback(request) {
      if (!this.fallbackEngine) this.fallbackEngine = new root.TrenchPreviewGraphics.PreviewEngine(this.canvasFactory);
      const canvas = this.canvasFactory(1, 1);
      const job = { request, canvas, iterator: this.fallbackEngine.render(request, canvas), computeMs: 0, maxChunkMs: 0 };
      this.fallbackJob = job;
      const advance = () => {
        if (this.disposed || this.active?.jobId !== request.jobId) return;
        this.fallbackTimer = null;
        const began = this.now();
        try {
          let step;
          do { step = job.iterator.next(); } while (!step.done && this.now() - began < 4);
          const duration = this.now() - began;
          job.computeMs += duration;
          job.maxChunkMs = Math.max(job.maxChunkMs, duration);
          if (step.done) {
            this.fallbackJob = null;
            this.receive({
              type: "preview-result", jobId: request.jobId, trenchId: request.trenchId,
              key: request.key, bitmap: canvas, ...step.value,
              computeMs: job.computeMs, maxChunkMs: job.maxChunkMs,
              elapsedMs: this.now() - request.dispatchedAt
            });
          } else this.fallbackTimer = this.setTimer(advance, 0);
        } catch (error) {
          this.releaseFallback();
          this.lastError = String(error);
          this.active = null;
          this.pending.clear();
          this.clearPause();
          this.host.mapRenderMode = "flat";
          this.host.debugMessage = "Relief preview unavailable; flat map restored.";
          this.host.requestFrame();
        }
      };
      this.fallbackTimer = this.setTimer(advance, 0);
    }

    releaseFallback() {
      if (this.fallbackTimer !== null) this.clearTimer(this.fallbackTimer);
      this.fallbackTimer = null;
      this.fallbackJob?.iterator.return();
      root.TrenchPreviewGraphics.releaseImage(this.fallbackJob?.canvas);
      this.fallbackJob = null;
    }

    disableWorker() {
      if (this.disposed || this.workerDisabled) return;
      this.workerDisabled = true;
      this.stats.fallbacks += 1;
      this.stats.retainedBytes = 0;
      this.clearWatchdog();
      this.worker?.terminate();
      this.worker = null;
      const active = this.active;
      this.active = null;
      if (active) {
        const trench = this.host.trenches.find((item) => item.id === active.trenchId);
        if (trench) this.pending.set(trench.id, { trench, origin: active.origin, queuedAt: active.queuedAt });
      }
      this.pump();
    }

    releaseResult(record) {
      root.TrenchPreviewGraphics.releaseImage(record?.bitmap);
      root.TrenchPreviewGraphics.releaseImage(record?.fitted);
      root.TrenchPreviewGraphics.releaseLevels(record?.levels);
    }

    receive(result) {
      if (result?.type === "preview-cancelled") {
        if (!this.disposed && result.jobId === this.lastCancelledJobId) {
          this.stats.lastCancelledComputeMs = result.computeMs;
          this.stats.retainedBytes = result.retainedBytes;
          this.host.updateCanvasPixelStats?.();
        }
        return;
      }
      if (this.disposed || result?.jobId !== this.active?.jobId) {
        this.releaseResult(result);
        if (result?.bitmap) this.stats.staleResults += 1;
        return;
      }
      if (result.type === "preview-error" || result.type !== "preview-result" || !result.bitmap) {
        this.releaseResult(result);
        this.disableWorker();
        return;
      }
      const active = this.active;
      this.clearWatchdog();
      this.active = null;
      this.stats.retainedBytes = result.retainedBytes;
      this.stats.lastRenderMs = result.elapsedMs ?? result.renderMs;
      this.stats.lastComputeMs = result.computeMs ?? result.renderMs;
      this.stats.lastLatencyMs = this.now() - active.queuedAt;
      this.stats.lastQueueMs = active.dispatchedAt - active.queuedAt;
      this.stats.lastMaxChunkMs = result.maxChunkMs || 0;
      this.stats.terrainRebuilds += result.rebuilt ? 1 : 0;
      this.stats.compositions += 1;
      const trench = this.host.trenches.find((item) => item.id === result.trenchId);
      if (trench && result.key === this.identity(trench).preview) {
        this.releaseResult(this.cache.get(trench.id));
        this.cache.set(trench.id, result);
        this.dirty.delete(trench);
        if (this.host.previewBootTracking && !this.bootCounted.has(trench.id)) {
          this.bootCounted.add(trench.id);
          root.GameBoot?.resourceLoaded();
        }
        if (this.host.currentScene === "site" || this.host.debugMenuOpen) this.host.requestFrame();
      } else {
        this.releaseResult(result);
        this.stats.staleResults += 1;
        if (trench) {
          this.dirty.add(trench);
          if (this.host.currentScene === "site") this.request(trench, "map");
          else if (this.host.currentScene === "cleaning") this.request(trench, "lab");
          else this.schedulePause();
        }
      }
      this.updateBitmapBytes();
      this.pump();
    }

    updateBitmapBytes() {
      this.stats.bitmapBytes = 0;
      for (const item of this.cache.values()) {
        this.stats.bitmapBytes += item.width * item.height * 4;
        if (item.fitted) this.stats.bitmapBytes += item.fitted.width * item.fitted.height * 4;
        for (const level of item.levels || []) this.stats.bitmapBytes += level.width * level.height * 4;
      }
      this.host.updateCanvasPixelStats?.();
    }

    dispose() {
      this.disposed = true;
      this.clearPause();
      this.clearWatchdog();
      this.releaseFallback();
      this.worker?.terminate();
      this.worker = null;
      this.fallbackEngine?.dispose();
      this.cache.forEach((record) => this.releaseResult(record));
      this.cache.clear();
      this.pending.clear();
      this.dirty.clear();
      this.active = null;
      this.stats.retainedBytes = this.stats.bitmapBytes = 0;
      this.host.updateCanvasPixelStats?.();
    }
  }

  root.TrenchPreviewPipeline = TrenchPreviewPipeline;
})(typeof window !== "undefined" ? window : globalThis);
