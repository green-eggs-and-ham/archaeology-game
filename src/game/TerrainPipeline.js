(function registerTerrainPipeline(root) {
  "use strict";

  const STATE_PROPERTIES = [
    "gridCache",
    "ambientBuffer",
    "terrainWorker",
    "terrainWorkerDisabled",
    "terrainWorkerActive",
    "terrainWorkerPending",
    "terrainWorkerResult",
    "terrainWorkerDesiredKey",
    "terrainWorkerSequence",
    "terrainStats"
  ];

  const COMPATIBILITY_METHODS = [
    "releaseCanvasBuffer",
    "invalidateTerrainCache",
    "terrainWorkerSupported",
    "ensureTerrainWorker",
    "disableTerrainWorker",
    "terrainWorkerPayload",
    "requestWorkerTerrain",
    "dispatchTerrainWorkerRequest",
    "terrainWorkerRequestIsCurrent",
    "handleTerrainWorkerMessage",
    "updateCanvasPixelStats",
    "drawGridCache",
    "captureGridCache",
    "renderWorkerExcavationGrid",
    "ensureGridCacheSurface",
    "gridCacheBounds",
    "gridCacheKey",
    "gridCacheCompatibilityKey",
    "renderExcavationGrid"
  ];

  /**
   * Owns the raster cache and asynchronous rendering lifecycle for one trench
   * scene. The host supplies terrain data, Canvas/p5 drawing primitives and the
   * shared frame scheduler; no pointer or navigation state is retained here.
   */
  class TerrainPipeline {
    constructor(host) {
      if (!host) throw new Error("TerrainPipeline requires a scene host.");
      this.host = host;
      this.gridCache = null;
      this.ambientBuffer = null;
      this.terrainWorker = null;
      this.terrainWorkerDisabled = false;
      this.terrainWorkerActive = null;
      this.terrainWorkerPending = null;
      this.terrainWorkerResult = null;
      this.terrainWorkerDesiredKey = null;
      this.terrainWorkerSequence = 0;
      this.terrainStats = {
        junctionsVisited: 0,
        junctionsSmoothed: 0,
        edgeChecks: 0,
        cacheHits: 0,
        cacheMisses: 0,
        lastTimings: {},
        averageTimings: {},
        timingSamples: 0,
        workerDispatches: 0,
        workerCompleted: 0,
        workerStaleResults: 0,
        workerFallbacks: 0,
        workerLastRenderMs: 0,
        workerLastLatencyMs: 0
      };
    }

    releaseCanvasBuffer(record) {
      if (record?.image && typeof record.image.remove === "function") {
        try {
          record.image.remove();
        } catch (_error) {
          // p5 image cleanup is best-effort.
        }
      }
      const canvas = record?.canvas;
      if (!canvas) return;
      try {
        canvas.width = 1;
        canvas.height = 1;
      } catch (_error) {
        // Canvas cleanup is best-effort across browser implementations.
      }
    }

    invalidateTerrainCache(options = {}) {
      const { releaseGrid = false, releaseAmbient = false } = options;
      if (releaseGrid) {
        this.releaseCanvasBuffer(this.gridCache);
        this.gridCache = null;
      }
      if (releaseAmbient) {
        this.releaseCanvasBuffer(this.ambientBuffer);
        this.ambientBuffer = null;
      }
      this.terrainWorkerDesiredKey = null;
      this.terrainWorkerPending = null;
      if (this.terrainWorkerResult?.bitmap?.close) this.terrainWorkerResult.bitmap.close();
      this.terrainWorkerResult = null;
      this.updateCanvasPixelStats();
    }

    terrainWorkerSupported() {
      const host = this.host;
      return !this.terrainWorkerDisabled && host.performanceMode === "full" &&
        typeof Worker === "function" && typeof OffscreenCanvas === "function" && Boolean(root.TerrainGraphics);
    }

    ensureTerrainWorker() {
      if (!this.terrainWorkerSupported()) return null;
      if (this.terrainWorker) return this.terrainWorker;
      try {
        const worker = new Worker("./src/game/TerrainWorker.js");
        worker.onmessage = (event) => this.handleTerrainWorkerMessage(event.data);
        worker.onerror = () => this.disableTerrainWorker();
        this.terrainWorker = worker;
        // Full-mode AO lives in the worker. Do not retain a synchronous AO
        // surface alongside it after the worker starts.
        this.releaseCanvasBuffer(this.ambientBuffer);
        this.ambientBuffer = null;
        this.updateCanvasPixelStats();
        return worker;
      } catch (_error) {
        this.disableTerrainWorker();
        return null;
      }
    }

    disableTerrainWorker() {
      if (this.terrainWorkerDisabled) return;
      this.terrainWorkerDisabled = true;
      this.terrainStats.workerFallbacks += 1;
      if (this.terrainWorker) this.terrainWorker.terminate();
      this.terrainWorker = null;
      this.terrainWorkerActive = null;
      this.terrainWorkerPending = null;
      this.terrainWorkerDesiredKey = null;
      if (this.terrainWorkerResult?.bitmap?.close) this.terrainWorkerResult.bitmap.close();
      this.terrainWorkerResult = null;
      this.host.requestFrame();
    }

    terrainWorkerPayload(key, trench, grid) {
      const host = this.host;
      const density = typeof pixelDensity === "function" ? pixelDensity() : 1;
      const source = host.buildVisibleSurfaceField(trench, { lightweight: true });
      const layers = [];
      const seenLayers = new Set();
      host.terrainLayers(trench).forEach((layer) => {
        if (!layer || seenLayers.has(layer.id)) return;
        seenLayers.add(layer.id);
        layers.push({ id: layer.id, colour: layer.colour, pattern: layer.pattern || null });
      });
      return {
        type: "render-terrain",
        jobId: ++this.terrainWorkerSequence,
        key,
        width: grid.width,
        height: grid.height,
        pixelWidth: Math.max(1, Math.ceil(grid.width * density)),
        pixelHeight: Math.max(1, Math.ceil(grid.height * density)),
        density,
        cellSize: grid.cellSize,
        rows: trench.rows,
        columns: trench.columns,
        maxDepth: trench.maxDepth,
        depthResolutionScale: trench.depthResolutionScale || host.config.trench.depthResolutionScale || 1,
        terrainSmoothingMode: host.terrainSmoothingMode,
        pillarRenderMode: host.pillarRenderMode,
        ridgeDirectionMode: host.ridgeDirectionMode,
        performanceMode: host.performanceMode,
        layers,
        cells: source.flat().map((surface) => ({
          x: surface.x,
          y: surface.y,
          depth: surface.depth,
          layerId: surface.layer.id,
          renderColour: surface.renderColour
        })),
        config: {
          trench: {
            depthResolutionScale: trench.depthResolutionScale || host.config.trench.depthResolutionScale || 1,
            maxDepthDarkening: host.config.trench.maxDepthDarkening || 0
          }
        },
        requestedAt: host.terrainTimingNow()
      };
    }

    requestWorkerTerrain(key, trench, grid) {
      this.terrainWorkerDesiredKey = key;
      if (this.terrainWorkerResult && this.terrainWorkerResult.key !== key) {
        if (this.terrainWorkerResult.bitmap?.close) this.terrainWorkerResult.bitmap.close();
        this.terrainWorkerResult = null;
        this.terrainStats.workerStaleResults += 1;
      }
      if (this.terrainWorkerResult?.key === key || this.terrainWorkerActive?.key === key || this.terrainWorkerPending?.key === key) {
        return true;
      }
      const worker = this.ensureTerrainWorker();
      if (!worker) return false;
      const request = {
        key,
        trench,
        terrainRevision: trench.terrainRevision ?? trench.visualRevision ?? 0,
        grid: { ...grid }
      };
      if (this.terrainWorkerActive) {
        this.terrainWorkerPending = request;
        return true;
      }
      this.dispatchTerrainWorkerRequest(request);
      return true;
    }

    dispatchTerrainWorkerRequest(request) {
      if (!this.terrainWorker || !request) return;
      const payload = request.type === "render-terrain"
        ? request
        : this.terrainWorkerPayload(request.key, request.trench, request.grid);
      this.terrainWorkerActive = payload;
      this.terrainStats.workerDispatches += 1;
      this.terrainWorker.postMessage(payload);
    }

    terrainWorkerRequestIsCurrent(request) {
      const host = this.host;
      if (!request || request.key !== this.terrainWorkerDesiredKey) return false;
      if (host.currentScene !== "trench" || !host.activeTrench || !host.layout.grid) return false;
      return request.key === this.gridCacheKey(host.activeTrench, host.layout.grid);
    }

    handleTerrainWorkerMessage(result) {
      const active = this.terrainWorkerActive;
      this.terrainWorkerActive = null;
      if (result?.type === "terrain-error") {
        this.disableTerrainWorker();
        return;
      }
      if (!result || result.type !== "terrain-result") return;
      this.terrainStats.workerCompleted += 1;
      this.terrainStats.workerLastRenderMs = result.timings?.total || 0;
      this.terrainStats.workerLastLatencyMs = active
        ? this.host.terrainTimingNow() - active.requestedAt
        : result.timings?.total || 0;
      if (this.terrainWorkerRequestIsCurrent(result)) {
        if (this.terrainWorkerResult?.bitmap?.close) this.terrainWorkerResult.bitmap.close();
        this.terrainWorkerResult = result;
        if (result.stats) Object.assign(this.terrainStats, result.stats);
        this.host.requestFrame();
      } else {
        if (result.bitmap?.close) result.bitmap.close();
        this.terrainStats.workerStaleResults += 1;
      }
      const pending = this.terrainWorkerPending;
      this.terrainWorkerPending = null;
      if (this.terrainWorkerRequestIsCurrent(pending)) this.dispatchTerrainWorkerRequest(pending);
    }

    updateCanvasPixelStats() {
      const host = this.host;
      if (!host.effectStats) return;
      const gridPixels = (this.gridCache?.pixelWidth || 0) * (this.gridCache?.pixelHeight || 0);
      const ambientPixels = (this.ambientBuffer?.pixelWidth || 0) * (this.ambientBuffer?.pixelHeight || 0);
      const profilePixels = (host.profileCache?.pixelWidth || 0) * (host.profileCache?.pixelHeight || 0);
      host.effectStats.allocatedCanvasPixels = gridPixels + ambientPixels + profilePixels;
    }

    drawGridCache(cacheBounds) {
      if (this.gridCache?.canvas) {
        drawingContext.drawImage(this.gridCache.canvas, cacheBounds.x, cacheBounds.y, cacheBounds.width, cacheBounds.height);
      } else if (this.gridCache?.image) {
        image(this.gridCache.image, cacheBounds.x, cacheBounds.y, cacheBounds.width, cacheBounds.height);
      }
    }

    captureGridCache(cacheBounds, cacheKey, compatibilityKey = null, quality = "full") {
      const cache = this.ensureGridCacheSurface(cacheBounds);
      if (cache?.context && drawingContext?.canvas) {
        cache.context.setTransform(1, 0, 0, 1, 0, 0);
        cache.context.clearRect(0, 0, cache.pixelWidth, cache.pixelHeight);
        const density = cache.density;
        cache.context.drawImage(
          drawingContext.canvas,
          cacheBounds.x * density,
          cacheBounds.y * density,
          cacheBounds.width * density,
          cacheBounds.height * density,
          0,
          0,
          cache.pixelWidth,
          cache.pixelHeight
        );
        cache.key = cacheKey;
        cache.compatibilityKey = compatibilityKey;
        cache.quality = quality;
      } else if (typeof get === "function") {
        this.gridCache = {
          key: cacheKey,
          compatibilityKey,
          quality,
          image: get(cacheBounds.x, cacheBounds.y, cacheBounds.width, cacheBounds.height)
        };
      }
      this.updateCanvasPixelStats();
    }

    renderWorkerExcavationGrid(trench, grid, result) {
      const host = this.host;
      const startedAt = host.terrainTimingNow();
      host.drawExcavationGridBackdrop(grid);
      const context = drawingContext;
      context.save();
      context.beginPath();
      context.rect(grid.x, grid.y, grid.width, grid.height);
      context.clip();
      context.drawImage(
        result.bitmap,
        0,
        0,
        result.sourcePixelWidth || result.bitmap.width,
        result.sourcePixelHeight || result.bitmap.height,
        grid.x,
        grid.y,
        grid.width,
        grid.height
      );
      context.restore();
      host.drawExcavationGridBorder(grid);
      const mainCompositeMs = host.terrainTimingNow() - startedAt;
      host.recordTerrainTimings({
        total: (result.timings?.total || 0) + mainCompositeMs,
        field: result.timings?.field || 0,
        topology: result.timings?.topology || 0,
        ambient: result.timings?.ambient || 0,
        composite: (result.timings?.composite || 0) + mainCompositeMs
      });
    }

    ensureGridCacheSurface(bounds) {
      const density = typeof pixelDensity === "function" ? pixelDensity() : 1;
      const pixelWidth = Math.max(1, Math.ceil(bounds.width * density));
      const pixelHeight = Math.max(1, Math.ceil(bounds.height * density));
      const existing = this.gridCache;
      if (existing?.canvas && existing.pixelWidth === pixelWidth && existing.pixelHeight === pixelHeight && existing.density === density) {
        return existing;
      }
      this.releaseCanvasBuffer(existing);
      let canvas = null;
      if (typeof document !== "undefined") canvas = document.createElement("canvas");
      else if (typeof OffscreenCanvas !== "undefined") canvas = new OffscreenCanvas(pixelWidth, pixelHeight);
      if (!canvas) return null;
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      this.gridCache = {
        key: null,
        canvas,
        context: canvas.getContext("2d", { alpha: true }),
        pixelWidth,
        pixelHeight,
        logicalWidth: bounds.width,
        logicalHeight: bounds.height,
        density
      };
      this.updateCanvasPixelStats();
      return this.gridCache;
    }

    gridCacheBounds(grid) {
      const x = Math.floor(grid.x - 7);
      const y = Math.floor(grid.y - 7);
      return {
        x,
        y,
        width: Math.ceil(grid.x + grid.width + 7) - x,
        height: Math.ceil(grid.y + grid.height + 7) - y
      };
    }

    gridCacheKey(trench, grid) {
      const host = this.host;
      const density = host.terrainRasterDensity();
      return [
        trench.id,
        trench.terrainRevision ?? trench.visualRevision ?? 0,
        density,
        Math.ceil(grid.width * density),
        Math.ceil(grid.height * density),
        host.performanceMode,
        host.terrainSmoothingMode,
        host.pillarRenderMode,
        host.ridgeDirectionMode,
        grid.x.toFixed(2),
        grid.y.toFixed(2),
        grid.width.toFixed(2),
        grid.height.toFixed(2)
      ].join(":");
    }

    gridCacheCompatibilityKey(trench, cacheBounds) {
      const density = typeof pixelDensity === "function" ? pixelDensity() : 1;
      return [
        trench.id,
        trench.rows,
        trench.columns,
        density,
        Math.ceil(cacheBounds.width * density),
        Math.ceil(cacheBounds.height * density)
      ].join(":");
    }

    renderExcavationGrid(trench, grid, options = {}) {
      const host = this.host;
      const totalStartedAt = host.terrainTimingNow();
      host.drawExcavationGridBackdrop(grid);
      const useLite = options.forceLite || host.performanceMode === "lite";
      const fieldStartedAt = host.terrainTimingNow();
      const surfaceField = host.buildVisibleSurfaceField(trench, { lightweight: useLite });
      const fieldDuration = host.terrainTimingNow() - fieldStartedAt;
      const terrainContext = drawingContext;
      terrainContext.save();
      terrainContext.beginPath();
      terrainContext.rect(grid.x, grid.y, grid.width, grid.height);
      terrainContext.clip();
      host.drawBaseTerrain(surfaceField, trench, grid);
      let topologyDuration = 0;
      let ambientDuration = 0;
      let compositeDuration = 0;
      if (useLite) {
        this.terrainStats.junctionsVisited = 0;
        this.terrainStats.junctionsSmoothed = 0;
        const compositeStartedAt = host.terrainTimingNow();
        host.drawTerrainPatterns(surfaceField, trench, grid);
        host.drawLiteAmbientOcclusion(surfaceField, trench, grid);
        compositeDuration = host.terrainTimingNow() - compositeStartedAt;
      } else {
        const topologyStartedAt = host.terrainTimingNow();
        const junctions = host.buildLocalJunctionDescriptors(surfaceField, trench, grid);
        const patches = host.collectPixelSnappedSurfacePatches(surfaceField, trench, grid, junctions);
        const regions = host.collectSurfaceRegionsFromPatches(patches);
        const preparedRegions = host.prepareSurfaceRegions(regions, trench);
        topologyDuration = host.terrainTimingNow() - topologyStartedAt;
        const ambientStartedAt = host.terrainTimingNow();
        const ambientBatches = host.collectAmbientOcclusion(surfaceField, trench, grid, junctions);
        const ambientBuffer = host.buildAmbientOcclusionBuffer(ambientBatches, regions, grid);
        ambientDuration = host.terrainTimingNow() - ambientStartedAt;
        const compositeStartedAt = host.terrainTimingNow();
        const patternGroups = host.buildTerrainPatternGroups(surfaceField, trench);
        host.drawDepthCompositedTerrain(
          surfaceField,
          trench,
          grid,
          regions,
          ambientBuffer,
          preparedRegions,
          patternGroups,
          patches
        );
        compositeDuration = host.terrainTimingNow() - compositeStartedAt;
      }
      terrainContext.restore();
      host.drawExcavationGridBorder(grid);
      host.recordTerrainTimings({
        total: host.terrainTimingNow() - totalStartedAt,
        field: fieldDuration,
        topology: topologyDuration,
        ambient: ambientDuration,
        composite: compositeDuration
      });
    }

    dispose() {
      this.releaseCanvasBuffer(this.gridCache);
      this.releaseCanvasBuffer(this.ambientBuffer);
      this.gridCache = null;
      this.ambientBuffer = null;
      if (this.terrainWorker) this.terrainWorker.terminate();
      this.terrainWorker = null;
      this.terrainWorkerActive = null;
      this.terrainWorkerPending = null;
      this.terrainWorkerDesiredKey = null;
      if (this.terrainWorkerResult?.bitmap?.close) this.terrainWorkerResult.bitmap.close();
      this.terrainWorkerResult = null;
      this.updateCanvasPixelStats();
    }

    static installSceneManagerCompatibility(prototype) {
      if (!prototype) throw new Error("A SceneManager prototype is required.");
      STATE_PROPERTIES.forEach((name) => {
        Object.defineProperty(prototype, name, {
          configurable: true,
          get() {
            return this.terrainPipeline?.[name];
          },
          set(value) {
            if (!this.terrainPipeline) {
              throw new Error(`TerrainPipeline must be created before assigning ${name}.`);
            }
            this.terrainPipeline[name] = value;
          }
        });
      });
      COMPATIBILITY_METHODS.forEach((name) => {
        Object.defineProperty(prototype, name, {
          configurable: true,
          writable: true,
          value(...args) {
            if (!this.terrainPipeline) throw new Error("SceneManager has no TerrainPipeline.");
            return this.terrainPipeline[name](...args);
          }
        });
      });
      return prototype;
    }
  }

  TerrainPipeline.stateProperties = [...STATE_PROPERTIES];
  TerrainPipeline.compatibilityMethods = [...COMPATIBILITY_METHODS];
  root.TerrainPipeline = TerrainPipeline;
})(typeof self !== "undefined" ? self : window);
