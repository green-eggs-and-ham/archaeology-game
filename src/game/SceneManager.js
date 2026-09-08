window.SceneManager = class SceneManager {
  constructor(config) {
    this.config = config;
    this.renderer = new window.GameRenderer();
    this.currentScene = "site";
    this.tool = "brush";
    this.activeTrench = null;
    this.pointerAction = null;
    this.tapFeedback = null;
    this.message = "Choose a trench to begin your dig.";
    this.messageTone = "neutral";
    this.pointer = null;
    this.showDepthDebug = false;
    this.terrainSmoothingMode = "focus";
    this.pillarRenderMode = "round";
    this.ridgeDirectionMode = "current";
    this.performanceMode = "full";
    this.gridCache = null;
    this.profileCache = null;
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
    this.frameRequestPending = false;
    this.frameRequestHandle = null;
    this.frameRequestKind = null;
    this.frameRequestGeneration = 0;
    this.frameStats = {
      requests: 0,
      coalesced: 0,
      presented: 0,
      profileCacheHits: 0,
      profileRebuilds: 0
    };
    this.brushParticles = [];
    this.depositedClumps = [];
    this.mapTiles = [];
    this.layout = {};
    this.cleaningModel = new window.CleaningModel(config.cleaning || {});
    this.cleaningTool = "hand";
    this.cleaningInventoryPage = 0;
    this.cleaningInventoryView = "all";
    this.cleaningInventoryChooserOpen = false;
    this.bucketOcclusionMode = "obscured";
    this.cleaningWaterDrops = [];
    this.cleaningRipples = [];
    this.cleaningDirtParticles = [];
    this.effectStats = {
      brushParticleActive: 0,
      brushParticleHighWater: 0,
      clumpActive: 0,
      clumpHighWater: 0,
      cleaningEffectActive: 0,
      cleaningParticleHighWater: 0,
      allocatedCanvasPixels: 0
    };
    this.trenches = config.trenches.map((definition) => new window.TrenchModel(definition, config));
    this.allCollectedArtefacts().forEach((artefact) => this.cleaningModel.ensureState(artefact));
  }

  handleResize() {
    this.cancelFrameRequest();
    if (this.pointerAction?.type === "cleaning-item") {
      this.pointerAction.artefact.cleaning.location = this.pointerAction.originLocation;
    }
    if (this.currentScene === "cleaning") this.pointerAction = null;
    this.tapFeedback = null;
    this.cleaningInventoryChooserOpen = false;
    this.mapTiles = [];
    this.layout = {};
    this.invalidateTerrainCache({ releaseGrid: true, releaseAmbient: true });
    this.releaseCanvasBuffer(this.profileCache);
    this.profileCache = null;
    this.updateCanvasPixelStats();
    this.cleaningWaterDrops = [];
    this.cleaningRipples = [];
    this.cleaningDirtParticles = [];
    this.brushParticles.length = 0;
    this.depositedClumps.length = 0;
  }

  draw() {
    // A direct p5 redraw (for example after a discrete button press or resize)
    // satisfies any queued pointer/effect frame. Consume it here so the old
    // callback cannot repaint the whole scene again on the following frame.
    this.cancelFrameRequest();
    this.renderer.drawBackground();
    if (this.currentScene === "site") this.drawSiteMap();
    else if (this.currentScene === "cleaning") this.drawCleaning();
    else this.drawTrench();
    this.drawCustomPointer();
  }

  requestFrame() {
    this.frameStats ||= {
      requests: 0,
      coalesced: 0,
      presented: 0,
      profileCacheHits: 0,
      profileRebuilds: 0
    };
    this.frameStats.requests += 1;
    if (this.frameRequestPending) {
      this.frameStats.coalesced += 1;
      return;
    }
    this.frameRequestPending = true;
    const generation = ++this.frameRequestGeneration;
    const present = () => {
      if (!this.frameRequestPending || generation !== this.frameRequestGeneration) return;
      this.frameRequestPending = false;
      this.frameRequestHandle = null;
      this.frameRequestKind = null;
      this.frameStats.presented += 1;
      if (typeof redraw === "function") redraw();
    };
    if (typeof requestAnimationFrame === "function") {
      this.frameRequestKind = "animation-frame";
      this.frameRequestHandle = requestAnimationFrame(present);
    } else if (typeof setTimeout === "function") {
      this.frameRequestKind = "timeout";
      this.frameRequestHandle = setTimeout(present, 16);
    } else present();
  }

  cancelFrameRequest() {
    if (!this.frameRequestPending) return false;
    const handle = this.frameRequestHandle;
    if (handle !== null && this.frameRequestKind === "animation-frame" && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(handle);
    } else if (handle !== null && this.frameRequestKind === "timeout" && typeof clearTimeout === "function") {
      clearTimeout(handle);
    }
    this.frameRequestPending = false;
    this.frameRequestHandle = null;
    this.frameRequestKind = null;
    this.frameRequestGeneration += 1;
    return true;
  }

  releaseCanvasBuffer(record) {
    if (record?.image && typeof record.image.remove === "function") {
      try {
        record.image.remove();
      } catch (_error) {
        // p5 image cleanup is also best-effort.
      }
    }
    const canvas = record?.canvas;
    if (!canvas) return;
    try {
      canvas.width = 1;
      canvas.height = 1;
    } catch (_error) {
      // Off-screen canvas cleanup is best-effort across browser implementations.
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
    return !this.terrainWorkerDisabled && this.performanceMode === "full" &&
      typeof Worker === "function" && typeof OffscreenCanvas === "function" && Boolean(window.TerrainGraphics);
  }

  ensureTerrainWorker() {
    if (!this.terrainWorkerSupported()) return null;
    if (this.terrainWorker) return this.terrainWorker;
    try {
      const worker = new Worker("./src/game/TerrainWorker.js");
      worker.onmessage = (event) => this.handleTerrainWorkerMessage(event.data);
      worker.onerror = () => this.disableTerrainWorker();
      this.terrainWorker = worker;
      // Full-mode AO now lives in the worker. Do not retain the synchronous
      // grid-sized buffer alongside it after worker startup.
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
    this.requestFrame();
  }

  terrainWorkerPayload(key, trench, grid) {
    const density = typeof pixelDensity === "function" ? pixelDensity() : 1;
    const source = this.buildVisibleSurfaceField(trench, { lightweight: true });
    const layers = [];
    const seenLayers = new Set();
    this.terrainLayers(trench).forEach((layer) => {
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
      depthResolutionScale: trench.depthResolutionScale || this.config.trench.depthResolutionScale || 1,
      terrainSmoothingMode: this.terrainSmoothingMode,
      pillarRenderMode: this.pillarRenderMode,
      ridgeDirectionMode: this.ridgeDirectionMode,
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
          depthResolutionScale: trench.depthResolutionScale || this.config.trench.depthResolutionScale || 1,
          maxDepthDarkening: this.config.trench.maxDepthDarkening || 0
        }
      },
      requestedAt: this.terrainTimingNow()
    };
  }

  requestWorkerTerrain(key, trench, grid) {
    this.terrainWorkerDesiredKey = key;
    if (this.terrainWorkerResult && this.terrainWorkerResult.key !== key) {
      if (this.terrainWorkerResult.bitmap?.close) this.terrainWorkerResult.bitmap.close();
      this.terrainWorkerResult = null;
      this.terrainStats.workerStaleResults += 1;
    }
    if (this.terrainWorkerResult?.key === key || this.terrainWorkerActive?.key === key || this.terrainWorkerPending?.key === key) return true;
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
    if (!request || request.key !== this.terrainWorkerDesiredKey) return false;
    if (this.currentScene !== "trench" || !this.activeTrench || !this.layout.grid) return false;
    return request.key === this.gridCacheKey(this.activeTrench, this.layout.grid);
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
      ? this.terrainTimingNow() - active.requestedAt
      : result.timings?.total || 0;
    if (this.terrainWorkerRequestIsCurrent(result)) {
      if (this.terrainWorkerResult?.bitmap?.close) this.terrainWorkerResult.bitmap.close();
      this.terrainWorkerResult = result;
      if (result.stats) Object.assign(this.terrainStats, result.stats);
      this.requestFrame();
    } else {
      if (result.bitmap?.close) result.bitmap.close();
      this.terrainStats.workerStaleResults += 1;
    }
    const pending = this.terrainWorkerPending;
    this.terrainWorkerPending = null;
    if (this.terrainWorkerRequestIsCurrent(pending)) this.dispatchTerrainWorkerRequest(pending);
  }

  updateCanvasPixelStats() {
    if (!this.effectStats) return;
    const gridPixels = (this.gridCache?.pixelWidth || 0) * (this.gridCache?.pixelHeight || 0);
    const ambientPixels = (this.ambientBuffer?.pixelWidth || 0) * (this.ambientBuffer?.pixelHeight || 0);
    const profilePixels = (this.profileCache?.pixelWidth || 0) * (this.profileCache?.pixelHeight || 0);
    this.effectStats.allocatedCanvasPixels = gridPixels + ambientPixels + profilePixels;
  }

  compactActive(items, keep) {
    let writeIndex = 0;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!keep(item)) continue;
      items[writeIndex] = item;
      writeIndex += 1;
    }
    items.length = writeIndex;
    return items;
  }

  trenchEffectLimits() {
    const effects = this.config.trench.effects || {};
    return this.performanceMode === "lite"
      ? {
          brushParticles: effects.brushParticleLimitLite || 96,
          clumps: effects.clumpLimitLite || 8
        }
      : {
          brushParticles: effects.brushParticleLimitFull || 256,
          clumps: effects.clumpLimitFull || 16
        };
  }

  recordEffectHighWater() {
    if (!this.effectStats) return;
    this.effectStats.brushParticleActive = this.brushParticles.length;
    this.effectStats.clumpActive = this.depositedClumps.length;
    this.effectStats.cleaningEffectActive =
      this.cleaningWaterDrops.length + this.cleaningRipples.length + this.cleaningDirtParticles.length;
    this.effectStats.brushParticleHighWater = Math.max(this.effectStats.brushParticleHighWater, this.brushParticles.length);
    this.effectStats.clumpHighWater = Math.max(this.effectStats.clumpHighWater, this.depositedClumps.length);
    this.effectStats.cleaningParticleHighWater = Math.max(
      this.effectStats.cleaningParticleHighWater,
      this.cleaningWaterDrops.length + this.cleaningRipples.length + this.cleaningDirtParticles.length
    );
  }

  trimEffectsForMode() {
    const trenchLimits = this.trenchEffectLimits();
    if (this.brushParticles.length > trenchLimits.brushParticles) {
      this.brushParticles.splice(0, this.brushParticles.length - trenchLimits.brushParticles);
    }
    if (this.depositedClumps.length > trenchLimits.clumps) {
      this.depositedClumps.splice(0, this.depositedClumps.length - trenchLimits.clumps);
    }
    const cleaning = this.cleaningEffectsConfig();
    if (this.cleaningDirtParticles.length > cleaning.dirtParticleLimit) {
      this.cleaningDirtParticles.splice(0, this.cleaningDirtParticles.length - cleaning.dirtParticleLimit);
    }
    if (this.cleaningWaterDrops.length > cleaning.waterDropletLimit) {
      this.cleaningWaterDrops.splice(0, this.cleaningWaterDrops.length - cleaning.waterDropletLimit);
    }
    if (this.cleaningRipples.length > cleaning.waterRippleLimit) {
      this.cleaningRipples.splice(0, this.cleaningRipples.length - cleaning.waterRippleLimit);
    }
    this.recordEffectHighWater();
  }

  drawHeading(title, subtitle) {
    const titleSize = Math.max(17, Math.min(28, width * 0.035));
    const subtitleSize = Math.max(10, Math.min(14, width * 0.016));
    fill("#fff9e9");
    noStroke();
    textAlign(LEFT, TOP);
    textStyle(BOLD);
    textSize(titleSize);
    text(title, 18, 14);
    textStyle(NORMAL);
    fill("#c9d9d8");
    textSize(subtitleSize);
    text(subtitle, 18, 17 + titleSize);
  }

  allCollectedArtefacts() {
    return this.trenches.flatMap((trench) => trench.artefacts.filter((artefact) => artefact.exposure === "collected"));
  }

  cleanableCollectedArtefacts() {
    return this.allCollectedArtefacts().filter((artefact) => artefact.cleanable);
  }

  pendingCleaningCount() {
    return this.cleanableCollectedArtefacts().filter((artefact) => {
      const state = this.cleaningModel.ensureState(artefact);
      return !["ready-to-identify", "awaiting-specialist"].includes(state.status);
    }).length;
  }

  activeCleaningArtefact() {
    if (this.pointerAction?.type === "cleaning-item") return this.pointerAction.artefact;
    return this.cleanableCollectedArtefacts().find((artefact) => this.cleaningModel.ensureState(artefact).location !== "inventory") || null;
  }

  drawSiteMap() {
    this.drawHeading("Dig Site", "Choose a trench to start digging.");
    const labWidth = Math.max(104, Math.min(160, width * 0.24));
    const labHeight = Math.max(30, Math.min(38, height * 0.09));
    this.layout.labButton = { x: width - labWidth - 14, y: 12, width: labWidth, height: labHeight };
    this.renderer.button(this.layout.labButton, `Finds lab (${this.pendingCleaningCount()})`, false, true);
    const tileWidth = Math.min(width * 0.27, height * 0.55);
    const tileHeight = tileWidth * 0.5;
    const originX = width / 2;
    const originY = height * 0.3;
    this.mapTiles = [];

    for (let row = 0; row < this.config.map.rows; row += 1) {
      for (let column = 0; column < this.config.map.columns; column += 1) {
        const trench = this.trenches[row * this.config.map.columns + column];
        const x = originX + (column - row) * tileWidth * 0.48;
        const y = originY + (column + row) * tileHeight * 0.48;
        const tile = { x, y, width: tileWidth, height: tileHeight, trench };
        this.mapTiles.push(tile);
        this.drawMapTile(tile, row, column);
      }
    }

    this.renderer.panel(18, height - 45, Math.min(width - 36, 385), 30, "#e6d3a9");
    fill("#25444a");
    textAlign(LEFT, CENTER);
    textSize(Math.max(10, width * 0.017));
    text("Tap a diamond to inspect a trench from above.", 30, height - 30);
  }

  drawMapTile(tile, row, column) {
    const { x, y, width: tileWidth, height: tileHeight, trench } = tile;
    const progress = trench.artefacts.filter((artefact) => artefact.exposure === "collected").length;
    const soil = trench.getRenderableSurfaceAt(Math.floor(trench.columns / 2), Math.floor(trench.rows / 2));
    const topY = y;
    const bottomY = y + tileHeight * 0.25;

    noStroke();
    fill("#102d34");
    quad(x, bottomY + tileHeight * 0.16, x + tileWidth / 2, bottomY, x, bottomY - tileHeight * 0.16, x - tileWidth / 2, bottomY);
    fill(soil.colour);
    quad(x, topY - tileHeight / 2, x + tileWidth / 2, topY, x, topY + tileHeight / 2, x - tileWidth / 2, topY);
    stroke("#ecd9ab");
    strokeWeight(1.5);
    noFill();
    quad(x, topY - tileHeight / 2, x + tileWidth / 2, topY, x, topY + tileHeight / 2, x - tileWidth / 2, topY);
    noStroke();
    fill("#263f37");
    textAlign(CENTER, CENTER);
    textStyle(BOLD);
    textSize(Math.max(10, tileWidth * 0.16));
    text(trench.label, x, y - 2);
    textStyle(NORMAL);

    if (progress > 0 || trench.isComplete()) {
      fill(trench.isComplete() ? "#4c9d67" : "#f4b942");
      circle(x + tileWidth * 0.3, y - tileHeight * 0.06, Math.max(10, tileWidth * 0.17));
      fill("#17333b");
      textSize(Math.max(8, tileWidth * 0.11));
      text(progress, x + tileWidth * 0.3, y - tileHeight * 0.055);
    }
  }

  cleaningLayout() {
    const margin = Math.max(10, width * 0.018);
    const gap = Math.max(7, width * 0.012);
    const isPortrait = height > width;
    const headerHeight = isPortrait
      ? Math.max(66, Math.min(76, height * 0.14))
      : Math.max(58, Math.min(68, height * 0.13));
    const backWidth = Math.max(82, Math.min(118, width * 0.22));
    const layout = {
      isPortrait,
      headerHeight,
      labBackButton: { x: margin, y: 10, width: backWidth, height: 34 }
    };

    if (isPortrait) {
      const inventoryHeight = Math.max(120, Math.min(164, width * 0.38));
      const bucketHeight = Math.max(84, Math.min(150, width * 0.28));
      const inventoryY = headerHeight;
      const matY = inventoryY + inventoryHeight + gap;
      const bucketY = height - margin - bucketHeight;
      const lowerWidth = width - margin * 2;
      layout.inventory = { x: margin, y: inventoryY, width: lowerWidth, height: inventoryHeight };
      layout.mat = { x: margin, y: matY, width: lowerWidth, height: Math.max(1, bucketY - matY - gap) };
      layout.bucket = { x: margin, y: bucketY, width: lowerWidth, height: bucketHeight };
    } else {
      const contentY = headerHeight;
      const contentHeight = height - contentY - margin;
      const inventoryWidth = Math.max(145, Math.min(215, width * 0.23));
      layout.inventory = { x: margin, y: contentY, width: inventoryWidth, height: contentHeight };
      const workspaceX = margin + inventoryWidth + gap;
      const workspaceWidth = width - workspaceX - margin;
      const bucketHeight = Math.max(120, Math.min(190, contentHeight * 0.36));
      layout.mat = {
        x: workspaceX,
        y: contentY,
        width: workspaceWidth,
        height: Math.max(1, contentHeight - bucketHeight - gap)
      };
      layout.bucket = {
        x: workspaceX,
        y: layout.mat.y + layout.mat.height + gap,
        width: workspaceWidth,
        height: bucketHeight
      };
    }

    const matInset = isPortrait ? 7 : 9;
    const titleHeight = isPortrait ? 18 : 22;
    const careHeight = isPortrait ? 14 : 18;
    const toolbarGap = isPortrait ? 3 : 5;
    const toolbarHeight = isPortrait ? 28 : 32;
    const toolbarY = layout.mat.y + matInset + titleHeight + careHeight;
    const toolbarWidth = layout.mat.width - matInset * 2;
    const buttonWidth = (toolbarWidth - toolbarGap * 3) / 4;
    const buttonNames = ["handButton", "toothbrushButton", "fineBrushButton", "flipButton"];
    buttonNames.forEach((name, index) => {
      layout[name] = {
        x: layout.mat.x + matInset + index * (buttonWidth + toolbarGap),
        y: toolbarY,
        width: buttonWidth,
        height: toolbarHeight
      };
    });
    const surfaceY = toolbarY + toolbarHeight + (isPortrait ? 3 : 7);
    layout.matHeader = {
      x: layout.mat.x + matInset,
      y: layout.mat.y + matInset,
      width: toolbarWidth,
      height: surfaceY - layout.mat.y - matInset
    };
    layout.matSurface = {
      x: layout.mat.x + matInset,
      y: surfaceY,
      width: toolbarWidth,
      height: Math.max(1, layout.mat.y + layout.mat.height - surfaceY - matInset)
    };
    const bucketControlHeight = Math.max(24, Math.min(30, layout.bucket.height * 0.28));
    const bucketControlWidth = Math.max(102, Math.min(172, layout.bucket.width * (isPortrait ? 0.43 : 0.3)));
    layout.bucketModeButton = {
      x: layout.bucket.x + layout.bucket.width - bucketControlWidth - 8,
      y: layout.bucket.y + 6,
      width: bucketControlWidth,
      height: bucketControlHeight
    };
    return layout;
  }

  drawCleaning() {
    this.layout = this.cleaningLayout();
    this.drawCleaningHeader();
    this.drawCleaningInventory();
    this.drawCleaningMat();
    this.drawCleaningBucketBack();
    if (this.bucketOcclusionMode === "obscured") {
      this.drawCleaningBucketArtefact();
      const action = this.pointerAction;
      const draggedImmersed = action?.type === "cleaning-item"
        && action.dunkPhase === "immersed";
      if (draggedImmersed) {
        this.drawDraggedCleaningArtefact();
        this.drawCleaningBucketForeground(true);
      } else {
        this.drawCleaningBucketForeground(true);
        this.drawDraggedCleaningArtefact();
      }
    } else {
      this.drawCleaningBucketForeground(false);
      this.drawCleaningBucketArtefact();
      this.drawDraggedCleaningArtefact();
    }
    this.drawCleaningEffects();
    this.drawCleaningBrushCursor();
    this.drawCleaningInventoryChooser();
  }

  drawCleaningHeader() {
    const portrait = this.layout.isPortrait;
    this.renderer.button(
      this.layout.labBackButton,
      "Site map",
      false,
      false,
      false,
      portrait ? { minimumSize: 11, maximumSize: 15 } : {}
    );
    const titleX = this.layout.labBackButton.x + this.layout.labBackButton.width + 10;
    fill("#fff9e9");
    noStroke();
    textAlign(LEFT, TOP);
    textStyle(BOLD);
    textSize(portrait
      ? Math.max(20, Math.min(26, width * 0.055))
      : Math.max(16, Math.min(25, width * 0.032)));
    text("Finds lab", titleX, 9);
    textStyle(NORMAL);
    fill(this.messageTone === "warning" ? "#ffd889" : "#c9d9d8");
    textSize(portrait
      ? Math.max(10, Math.min(14, width * 0.026))
      : Math.max(8, Math.min(12, width * 0.014)));
    const messageX = portrait ? this.layout.labBackButton.x : titleX;
    const messageY = portrait ? 45 : 37;
    text(
      this.message || "Choose a collected find to clean.",
      messageX,
      messageY,
      width - messageX - (portrait ? this.layout.labBackButton.x : 10),
      this.layout.headerHeight - messageY
    );
  }

  inventoryStatusLabel(artefact) {
    if (!artefact.cleanable) return "Not available";
    const status = this.cleaningModel.ensureState(artefact).status;
    if (status === "ready-to-identify") return "Ready to identify";
    if (status === "awaiting-specialist") return "Needs specialist";
    if (status === "ready-to-return") return "Clean";
    if (status === "wet") return "In progress";
    return "Dirty";
  }

  cleaningInventoryViewOptions() {
    return [
      { id: "all", label: "All" },
      { id: "name", label: "Name A-Z" },
      { id: "dirty", label: "Dirty" },
      { id: "specialist", label: "Needs specialist" },
      { id: "identify", label: "Ready to identify" },
      { id: "other", label: "Other / unavailable" }
    ];
  }

  cleaningInventoryViewLabel(view = this.cleaningInventoryView) {
    return this.cleaningInventoryViewOptions().find((option) => option.id === view)?.label || "All";
  }

  cleaningInventoryStatusGroup(artefact) {
    if (!artefact.cleanable) return "other";
    const status = this.cleaningModel.ensureState(artefact)?.status;
    if (status === "dirty") return "dirty";
    if (status === "awaiting-specialist") return "specialist";
    if (status === "ready-to-identify") return "identify";
    return "other";
  }

  cleaningInventoryGrid(isPortrait = this.layout.isPortrait) {
    return isPortrait ? { columns: 3, rows: 1 } : { columns: 1, rows: 6 };
  }

  portraitInventoryLabel(label) {
    const words = String(label || "").trim().split(/\s+/).filter(Boolean);
    if (words.length < 3) return words.join(" ");
    let bestIndex = 1;
    let bestDifference = Infinity;
    for (let index = 1; index < words.length; index += 1) {
      const firstLength = words.slice(0, index).join(" ").length;
      const secondLength = words.slice(index).join(" ").length;
      const difference = Math.abs(firstLength - secondLength);
      if (difference < bestDifference) {
        bestDifference = difference;
        bestIndex = index;
      }
    }
    return `${words.slice(0, bestIndex).join(" ")}\n${words.slice(bestIndex).join(" ")}`;
  }

  cleaningInventoryArtefacts() {
    const active = this.activeCleaningArtefact();
    const collected = this.allCollectedArtefacts().filter(
      (artefact) => artefact !== active || artefact.cleaning?.location === "inventory"
    );
    const view = this.cleaningInventoryView || "all";
    const filtered = ["dirty", "specialist", "identify", "other"].includes(view)
      ? collected.filter((artefact) => this.cleaningInventoryStatusGroup(artefact) === view)
      : [...collected];
    if (view === "all") return filtered;
    return filtered.sort((first, second) => {
      const byName = String(first.label || "").localeCompare(String(second.label || ""), undefined, { sensitivity: "base" });
      if (byName !== 0) return byName;
      return String(first.id || "").localeCompare(String(second.id || ""));
    });
  }

  drawCleaningInventory() {
    const bounds = this.layout.inventory;
    const portrait = this.layout.isPortrait;
    this.renderer.panel(bounds.x, bounds.y, bounds.width, bounds.height, "#ead9b9");
    fill("#25444a");
    noStroke();
    textAlign(LEFT, TOP);
    textStyle(BOLD);
    textSize(portrait
      ? Math.max(12, Math.min(16, bounds.height * 0.105))
      : Math.max(10, Math.min(14, bounds.height * 0.12)));
    text("COLLECTED FINDS", bounds.x + 9, bounds.y + 7);
    textStyle(NORMAL);

    const viewButtonHeight = portrait ? 30 : 24;
    this.layout.inventoryViewButton = {
      x: bounds.x + 8,
      y: bounds.y + (portrait ? 25 : 26),
      width: bounds.width - 16,
      height: viewButtonHeight
    };
    this.renderer.button(
      this.layout.inventoryViewButton,
      `View: ${this.cleaningInventoryViewLabel()}`,
      this.cleaningInventoryView !== "all",
      true,
      false,
      portrait ? { minimumSize: 10, maximumSize: 12 } : { minimumSize: 8, maximumSize: 11 }
    );

    const active = this.activeCleaningArtefact();
    const availableArtefacts = this.allCollectedArtefacts().filter(
      (artefact) => artefact !== active || artefact.cleaning?.location === "inventory"
    );
    const artefacts = this.cleaningInventoryArtefacts();
    const { columns, rows } = this.cleaningInventoryGrid(portrait);
    const pageSize = columns * rows;
    const pages = Math.max(1, Math.ceil(artefacts.length / pageSize));
    this.cleaningInventoryPage = Math.max(0, Math.min(pages - 1, this.cleaningInventoryPage));
    const footerHeight = pages > 1 ? (portrait ? 22 : 25) : 5;
    const contentTop = this.layout.inventoryViewButton.y + this.layout.inventoryViewButton.height + 4;
    const contentHeight = Math.max(1, bounds.y + bounds.height - contentTop - footerHeight);
    const cellWidth = (bounds.width - 12) / columns;
    const cellHeight = contentHeight / rows;
    const visible = artefacts.slice(this.cleaningInventoryPage * pageSize, (this.cleaningInventoryPage + 1) * pageSize);
    this.layout.inventorySlots = [];

    if (!artefacts.length) {
      fill("#5c665e");
      textAlign(CENTER, CENTER);
      textSize(portrait ? Math.max(10, Math.min(13, bounds.width * 0.04)) : Math.max(9, Math.min(12, bounds.width * 0.055)));
      text(
        availableArtefacts.length
          ? `No finds match ${this.cleaningInventoryViewLabel().toLowerCase()}.`
          : active
            ? "The current find is on the cleaning bench."
            : "Collect a find at the dig site to place it here.",
        bounds.x + 12,
        contentTop,
        bounds.width - 24,
        contentHeight
      );
    }

    visible.forEach((artefact, index) => {
      if (artefact.cleanable) this.cleaningModel.ensureState(artefact);
      const column = index % columns;
      const row = Math.floor(index / columns);
      const slot = {
        x: bounds.x + 6 + column * cellWidth + 2,
        y: contentTop + row * cellHeight + 2,
        width: cellWidth - 4,
        height: cellHeight - 4
      };
      this.layout.inventorySlots.push({ artefact, bounds: slot });
      noStroke();
      fill(artefact.cleanable ? "#d9c7a5" : "#b9ad96");
      rect(slot.x, slot.y, slot.width, slot.height, 6);
      const itemSize = portrait
        ? Math.max(13, Math.min(slot.width * 0.28, slot.height * 0.3))
        : Math.max(24, Math.min(slot.width * 0.27, slot.height * 0.68));
      const portraitLabelLines = portrait ? this.portraitInventoryLabel(artefact.label).split("\n") : [];
      const portraitGroupHeight = itemSize + portraitLabelLines.length * 9.5 + 12;
      const portraitGroupTop = Math.max(2, (slot.height - portraitGroupHeight) / 2);
      const itemX = portrait ? slot.x + slot.width / 2 : slot.x + 8 + itemSize / 2;
      const itemY = portrait
        ? slot.y + portraitGroupTop + itemSize / 2
        : slot.y + slot.height / 2;
      const status = artefact.cleaning?.status;
      this.renderer.artefact(artefact, itemX, itemY, itemSize, {
        face: "front",
        showDirt: artefact.cleanable && !["ready-to-identify", "awaiting-specialist", "ready-to-return"].includes(status)
      });
      fill("#25444a");
      noStroke();
      textAlign(portrait ? CENTER : LEFT, TOP);
      textStyle(BOLD);
      textSize(portrait ? Math.max(9, Math.min(11, slot.width / 11)) : Math.max(10, Math.min(12, slot.width / 16)));
      if (portrait) {
        portraitLabelLines.forEach((labelLine, lineIndex) => {
          text(labelLine, slot.x + slot.width / 2, slot.y + portraitGroupTop + itemSize + 1 + lineIndex * 9.5);
        });
      } else {
        const textX = slot.x + itemSize + 15;
        const textWidth = Math.max(1, slot.x + slot.width - textX - 6);
        text(
          artefact.label,
          textX,
          slot.y + 7,
          textWidth,
          Math.max(18, slot.height - 30)
        );
        this.layout.inventorySlots[this.layout.inventorySlots.length - 1].thumbnailBounds = {
          x: itemX - itemSize / 2,
          y: itemY - itemSize / 2,
          width: itemSize,
          height: itemSize
        };
        this.layout.inventorySlots[this.layout.inventorySlots.length - 1].nameBounds = {
          x: textX,
          y: slot.y + 7,
          width: textWidth,
          height: Math.max(18, slot.height - 30)
        };
      }
      textStyle(NORMAL);
      fill(status === "ready-to-identify" ? "#39734e" : status === "awaiting-specialist" ? "#8d5c20" : "#5b625d");
      textSize(portrait ? Math.max(8, Math.min(9.5, slot.width / 13)) : Math.max(9, Math.min(10, slot.width / 18)));
      if (portrait) {
        text(
          this.inventoryStatusLabel(artefact),
          slot.x + slot.width / 2,
          slot.y + portraitGroupTop + itemSize + portraitLabelLines.length * 9.5 + 2
        );
      } else {
        const textX = slot.x + itemSize + 15;
        const textWidth = Math.max(1, slot.x + slot.width - textX - 6);
        text(this.inventoryStatusLabel(artefact), textX, slot.y + slot.height - 18, textWidth, 14);
        this.layout.inventorySlots[this.layout.inventorySlots.length - 1].statusBounds = {
          x: textX,
          y: slot.y + slot.height - 18,
          width: textWidth,
          height: 14
        };
      }
    });

    this.layout.inventoryPreviousButton = null;
    this.layout.inventoryNextButton = null;
    if (pages > 1) {
      const buttonHeight = portrait ? 19 : 18;
      const buttonWidth = Math.min(portrait ? 76 : 62, (bounds.width - 34) / 2);
      this.layout.inventoryPreviousButton = { x: bounds.x + 8, y: bounds.y + bounds.height - buttonHeight - 4, width: buttonWidth, height: buttonHeight };
      this.layout.inventoryNextButton = { x: bounds.x + bounds.width - buttonWidth - 8, y: bounds.y + bounds.height - buttonHeight - 4, width: buttonWidth, height: buttonHeight };
      const pagingText = portrait ? { minimumSize: 8, maximumSize: 10 } : {};
      this.renderer.button(this.layout.inventoryPreviousButton, "Previous", false, true, false, pagingText);
      this.renderer.button(this.layout.inventoryNextButton, "Next", false, true, false, pagingText);
      fill("#25444a");
      noStroke();
      textAlign(CENTER, CENTER);
      textSize(portrait ? 9 : 7);
      text(`${this.cleaningInventoryPage + 1}/${pages}`, bounds.x + bounds.width / 2, bounds.y + bounds.height - buttonHeight / 2 - 4);
    }
  }

  drawCleaningInventoryChooser() {
    this.layout.inventoryViewOptions = [];
    if (!this.cleaningInventoryChooserOpen) return;

    const options = this.cleaningInventoryViewOptions();
    const portrait = this.layout.isPortrait;
    const margin = Math.max(10, width * 0.018);
    const menuWidth = Math.min(420, width - margin * 2);
    const columns = 2;
    const rows = Math.ceil(options.length / columns);
    const gap = 6;
    const optionHeight = portrait ? 44 : 38;
    const titleHeight = portrait ? 34 : 30;
    const menuHeight = titleHeight + rows * optionHeight + (rows + 1) * gap;
    const preferredY = this.layout.mat.y + (this.layout.mat.height - menuHeight) / 2;
    const menuY = Math.max(this.layout.headerHeight + 4, Math.min(height - menuHeight - margin, preferredY));
    const menuX = (width - menuWidth) / 2;

    noStroke();
    fill(6, 20, 27, 150);
    rect(0, this.layout.headerHeight, width, height - this.layout.headerHeight);
    this.renderer.panel(menuX, menuY, menuWidth, menuHeight, "#ead9b9");
    fill("#25444a");
    textAlign(CENTER, CENTER);
    textStyle(BOLD);
    textSize(portrait ? 13 : 11);
    text("CHOOSE INVENTORY VIEW", menuX + menuWidth / 2, menuY + titleHeight / 2 + 1);
    textStyle(NORMAL);

    const optionWidth = (menuWidth - gap * 3) / columns;
    options.forEach((option, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const bounds = {
        x: menuX + gap + column * (optionWidth + gap),
        y: menuY + titleHeight + gap + row * (optionHeight + gap),
        width: optionWidth,
        height: optionHeight
      };
      this.layout.inventoryViewOptions.push({ view: option.id, bounds });
      this.renderer.button(
        bounds,
        option.label,
        this.cleaningInventoryView === option.id,
        true,
        false,
        portrait ? { minimumSize: 10, maximumSize: 12 } : { minimumSize: 9, maximumSize: 11 }
      );
    });
  }

  cleaningItemBaseSize() {
    const mat = this.layout.matSurface || this.layout.mat;
    const bucket = this.layout.bucket;
    if (!mat || !bucket) return 52;
    const matCapacity = Math.min(mat.width * 0.32, mat.height * 0.48);
    const bucketHeader = this.layout.isPortrait ? 38 : 42;
    const bucketInteriorDepth = Math.max(36, (bucket.height - bucketHeader) * 0.82);
    const bucketCapacity = Math.min(bucket.width * 0.3, bucketInteriorDepth / (1.24 * 1.08));
    return Math.max(38, Math.min(125, matCapacity, bucketCapacity));
  }

  cleaningItemSize(_location = "mat") {
    return this.cleaningItemBaseSize();
  }

  drawCleaningArtefactAt(artefact, centerX, centerY, size, location) {
    const state = this.cleaningModel.ensureState(artefact);
    this.renderer.artefact(artefact, centerX, centerY, size, {
      face: state.activeFace,
      showDirt: !["ready-to-identify", "awaiting-specialist", "ready-to-return"].includes(state.status),
      dampened: Boolean(state.dampened && location !== "inventory")
    });
    this.layout.cleaningItemBounds = { x: centerX - size * 0.58, y: centerY - size * 0.62, width: size * 1.16, height: size * 1.24, size, location, artefact };
  }

  shouldShowContextFlip(artefact = this.activeCleaningArtefact()) {
    if (!artefact || artefact.cleaning?.location !== "mat") return false;
    const currentFace = artefact.cleaning.activeFace;
    const otherFace = currentFace === "front" ? "back" : "front";
    return this.cleaningModel.faceComplete(artefact, currentFace)
      && !this.cleaningModel.faceComplete(artefact, otherFace);
  }

  contextualFlipBounds(item, surface, targetSize) {
    const preferredRight = item.x + item.width + 8;
    const fallbackLeft = item.x - targetSize - 8;
    const targetX = preferredRight + targetSize <= surface.x + surface.width - 4
      ? preferredRight
      : Math.max(surface.x + 4, fallbackLeft);
    return {
      x: Math.min(surface.x + surface.width - targetSize - 4, targetX),
      y: Math.max(surface.y + 4, Math.min(surface.y + surface.height - targetSize - 4, item.y - 8)),
      width: targetSize,
      height: targetSize
    };
  }

  drawCleaningMat() {
    const bounds = this.layout.mat;
    const surface = this.layout.matSurface;
    const portrait = this.layout.isPortrait;
    this.renderer.panel(bounds.x, bounds.y, bounds.width, bounds.height, "#d6c9aa");
    fill("#25444a");
    noStroke();
    textAlign(LEFT, TOP);
    textStyle(BOLD);
    textSize(portrait ? 12 : Math.max(12, Math.min(16, bounds.height * 0.06)));
    text("CLEANING MAT", this.layout.matHeader.x, this.layout.matHeader.y);
    textStyle(NORMAL);
    const artefact = this.activeCleaningArtefact();
    fill("#5b625d");
    textSize(portrait ? 8.5 : 10);
    const care = artefact
      ? portrait
        ? `${artefact.material} • ${artefact.robustness} • ${artefact.cleaningTool === "toothbrush" ? "Toothbrush fastest" : "Hand/fine brush"}`
        : `${artefact.material} • ${artefact.robustness} • ${artefact.cleaningTool === "toothbrush" ? "Toothbrush fastest; handwashing and fine brush safe" : "Handwash or use fine paintbrush"}`
      : "Choose a find, then use Hand to move it through clean water.";
    text(care, this.layout.matHeader.x, this.layout.matHeader.y + (portrait ? 16 : 20), this.layout.matHeader.width, portrait ? 13 : 16);

    const buttonText = portrait ? { minimumSize: 8, maximumSize: 10 } : { minimumSize: 9, maximumSize: 12 };
    this.renderer.button(this.layout.handButton, "Hand", this.cleaningTool === "hand", true, false, { ...buttonText, icon: "hand" });
    this.renderer.button(this.layout.toothbrushButton, "Toothbrush", this.cleaningTool === "toothbrush", true, false, { ...buttonText, icon: "toothbrush" });
    this.renderer.button(this.layout.fineBrushButton, portrait ? "Fine brush" : "Fine paintbrush", this.cleaningTool === "fine-brush", true, false, { ...buttonText, icon: "fine-brush" });
    const face = artefact?.cleaning?.activeFace === "back" ? "Back" : "Front";
    this.renderer.button(this.layout.flipButton, `Flip: ${face}`, false, true, false, {
      ...buttonText,
      icon: "flip",
      iconActive: true
    });

    fill("#857a65");
    rect(surface.x, surface.y, surface.width, surface.height, 12);
    stroke(255, 255, 255, 28);
    strokeWeight(1);
    for (let index = 1; index < 5; index += 1) {
      line(surface.x + 2, surface.y + surface.height * index / 5, surface.x + surface.width - 2, surface.y + surface.height * index / 5);
    }
    noStroke();
    this.layout.cleaningItemBounds = null;
    this.layout.contextFlipButton = null;
    if (artefact?.cleaning?.location === "mat" && this.pointerAction?.type !== "cleaning-item") {
      const size = this.cleaningItemSize("mat");
      const centerX = surface.x + surface.width / 2;
      const centerY = surface.y + surface.height * 0.48;
      this.drawCleaningArtefactAt(artefact, centerX, centerY, size, "mat");
      fill("#efe4c8");
      noStroke();
      textAlign(CENTER, BOTTOM);
      textSize(portrait ? Math.max(10, Math.min(14, bounds.width * 0.03)) : Math.max(8, Math.min(12, bounds.width * 0.027)));
      const front = Math.round(this.cleaningModel.progress(artefact, "front") * 100);
      const back = Math.round(this.cleaningModel.progress(artefact, "back") * 100);
      text(`Front ${front}%  •  Back ${back}%`, surface.x + surface.width / 2, surface.y + surface.height - 7);

      if (this.shouldShowContextFlip(artefact)) {
        const targetSize = Math.min(
          Math.max(44, Math.min(52, Math.min(surface.width, surface.height) * 0.24)),
          surface.width - 12,
          surface.height - 12
        );
        const item = this.layout.cleaningItemBounds;
        this.layout.contextFlipButton = this.contextualFlipBounds(item, surface, targetSize);
        this.renderer.button(this.layout.contextFlipButton, "Flip", false, true, false, {
          minimumSize: 8,
          maximumSize: 10,
          icon: "flip",
          iconActive: true
        });
      }
    } else if (!artefact) {
      fill("#d8cfb6");
      textAlign(CENTER, CENTER);
      textSize(portrait ? Math.max(10, Math.min(14, bounds.width * 0.032)) : Math.max(9, Math.min(13, bounds.width * 0.03)));
      text("Wet a dirty find, then place it here.", surface.x + 12, surface.y, surface.width - 24, surface.height);
    }
  }

  drawCleaningBucketBack() {
    const bounds = this.layout.bucket;
    const portrait = this.layout.isPortrait;
    this.renderer.panel(bounds.x, bounds.y, bounds.width, bounds.height, "#d9cdb1");
    fill("#25444a");
    noStroke();
    textAlign(LEFT, TOP);
    textStyle(BOLD);
    textSize(portrait ? Math.max(11, Math.min(14, bounds.height * 0.15)) : Math.max(10, Math.min(14, bounds.height * 0.1)));
    text("CLEAN WATER", bounds.x + 9, bounds.y + 8);
    textStyle(NORMAL);
    this.renderer.button(
      this.layout.bucketModeButton,
      this.bucketOcclusionMode === "obscured" ? "Water B: Obscured" : "Water A: Visible",
      this.bucketOcclusionMode === "obscured",
      true,
      false,
      { minimumSize: portrait ? 7.5 : 8, maximumSize: portrait ? 10 : 11 }
    );
    const bucketWidth = Math.min(bounds.width * 0.94, 600);
    const headerBottom = Math.max(bounds.y + (portrait ? 31 : 34), this.layout.bucketModeButton.y + this.layout.bucketModeButton.height + 2);
    const availableHeight = Math.max(28, bounds.y + bounds.height - headerBottom - 5);
    const bucketHeight = Math.max(28, availableHeight * 0.98);
    const centerX = bounds.x + bounds.width / 2;
    const waterY = headerBottom + bucketHeight * 0.09;
    const waterHeight = Math.max(18, bucketHeight * 0.36);
    const bodyBottom = Math.min(bounds.y + bounds.height - 5, waterY + bucketHeight * 0.82);
    this.layout.bucketGeometry = { bounds, centerX, waterY, bodyBottom, bucketWidth, bucketHeight, waterHeight };
    noStroke();
    fill("#56676b");
    quad(
      centerX - bucketWidth * 0.46, waterY,
      centerX + bucketWidth * 0.46, waterY,
      centerX + bucketWidth * 0.37, bodyBottom,
      centerX - bucketWidth * 0.37, bodyBottom
    );
    noFill();
    stroke("#344b50");
    strokeWeight(Math.max(2.5, bucketWidth * 0.027));
    arc(centerX, waterY, bucketWidth, waterHeight, Math.PI, Math.PI * 2);
    fill("#70b7c4");
    ellipse(centerX, waterY, bucketWidth, waterHeight);
    this.layout.bucketWater = { x: centerX - bucketWidth / 2, y: waterY - waterHeight / 2, width: bucketWidth, height: waterHeight };
    this.layout.bucketDunkAperture = { ...this.layout.bucketWater };
    const dropWidth = Math.min(bounds.width - 12, bucketWidth * 1.15);
    const dropHeight = Math.min(bounds.height - 12, Math.max(44, bucketHeight * 0.58));
    this.layout.bucketDropTarget = {
      x: centerX - dropWidth / 2,
      y: waterY - dropHeight / 2,
      width: dropWidth,
      height: dropHeight
    };
  }

  drawCleaningBucketArtefact() {
    const geometry = this.layout.bucketGeometry;
    if (!geometry) return;
    const artefact = this.activeCleaningArtefact();
    if (artefact?.cleaning?.location === "bucket" && this.pointerAction?.type !== "cleaning-item") {
      const size = this.cleaningItemSize("bucket");
      this.drawCleaningArtefactAt(artefact, geometry.centerX, geometry.waterY + size * 0.08, size, "bucket");
    }
  }

  traceBucketFrontPath(context = drawingContext) {
    const geometry = this.layout.bucketGeometry;
    if (!geometry) return;
    const { centerX, waterY, bodyBottom, bucketWidth, waterHeight } = geometry;
    context.beginPath();
    context.moveTo(centerX - bucketWidth * 0.46, waterY);
    context.ellipse(
      centerX,
      waterY,
      bucketWidth * 0.46,
      waterHeight * 0.5,
      0,
      Math.PI,
      0,
      true
    );
    context.lineTo(centerX + bucketWidth * 0.37, bodyBottom);
    context.quadraticCurveTo(centerX, bodyBottom + 3, centerX - bucketWidth * 0.37, bodyBottom);
    context.closePath();
  }

  immersedCleaningItem() {
    const aperture = this.layout.bucketDunkAperture;
    if (!aperture) return null;
    const parked = this.layout.cleaningItemBounds;
    if (parked?.location === "bucket") {
      return {
        artefact: parked.artefact,
        x: parked.x + parked.width / 2,
        y: parked.y + parked.height / 2,
        size: parked.size
      };
    }
    const action = this.pointerAction;
    if (action?.type !== "cleaning-item" || action.dunkPhase !== "immersed") return null;
    return { artefact: action.artefact, x: action.x, y: action.y, size: this.cleaningDraggedItemBounds(action).size };
  }

  drawCleaningBucketForeground(obscured = false) {
    const geometry = this.layout.bucketGeometry;
    if (!geometry) return;
    const context = drawingContext;
    const immersed = obscured ? this.immersedCleaningItem() : null;
    if (obscured) {
      context.save();
      this.traceBucketFrontPath(context);
      context.fillStyle = "#6d7b7d";
      context.fill();
      context.restore();
    } else {
      this.traceBucketFrontPath(context);
      context.fillStyle = "#6d7b7d";
      context.fill();
    }
    noFill();
    stroke("#f2e2bd");
    strokeWeight(Math.max(2, geometry.bucketWidth * 0.022));
    arc(geometry.centerX, geometry.waterY, geometry.bucketWidth, this.layout.bucketWater.height, 0, Math.PI);
    if (immersed) {
      context.save();
      this.traceBucketFrontPath(context);
      context.clip();
      this.renderer.artefactOutline(immersed.artefact, immersed.x, immersed.y, immersed.size);
      context.restore();
    }
  }

  drawDraggedCleaningArtefact() {
    if (this.pointerAction?.type !== "cleaning-item") return;
    const { artefact, x, y } = this.pointerAction;
    const size = this.pointerAction.displaySize || this.cleaningItemBaseSize() * 1.08;
    this.renderer.artefact(artefact, x, y, size, {
      face: artefact.cleaning.activeFace,
      showDirt: !["ready-to-identify", "awaiting-specialist", "ready-to-return"].includes(artefact.cleaning.status),
      dampened: Boolean(artefact.cleaning.dampened)
    });
  }

  drawCleaningBrushCursor() {
    const item = this.layout.cleaningItemBounds;
    const artefact = item?.artefact;
    if (this.cleaningTool === "hand" || !this.pointer || !artefact || item.location !== "mat" || this.pointerAction?.type === "cleaning-item") return;
    if (!this.pointIn(item, this.pointer.x, this.pointer.y)) return;
    const radius = item.size * this.cleaningModel.brushRadii[this.cleaningTool];
    noFill();
    stroke(this.cleaningModel.canUseTool(artefact, this.cleaningTool) ? "#e8f4e9" : "#ffd889");
    strokeWeight(1.4);
    circle(this.pointer.x, this.pointer.y, radius * 2);
  }

  cleaningEffectsConfig() {
    const settings = {
      waterDroplets: 10,
      waterRipples: 2,
      waterDuration: 500,
      dirtParticlesPerEvent: 8,
      dirtParticleLimit: 80,
      dirtDuration: 320,
      ...(this.config.cleaning?.effects || {})
    };
    if (this.performanceMode === "lite") {
      const scale = settings.liteSpawnScale ?? 0.5;
      settings.waterDroplets = Math.max(1, Math.round(settings.waterDroplets * scale));
      settings.waterRipples = Math.max(1, Math.round(settings.waterRipples * scale));
      settings.dirtParticlesPerEvent = Math.max(1, Math.round(settings.dirtParticlesPerEvent * scale));
      settings.dirtParticleLimit = settings.liteDirtParticleLimit || 40;
      settings.waterDropletLimit = settings.liteWaterDropletLimit || 20;
      settings.waterRippleLimit = settings.liteWaterRippleLimit || 4;
    } else {
      settings.waterDropletLimit = Math.max(settings.waterDroplets, settings.waterDroplets * 4);
      settings.waterRippleLimit = Math.max(settings.waterRipples, settings.waterRipples * 4);
    }
    return settings;
  }

  spawnCleaningWaterEffects() {
    const water = this.layout.bucketWater;
    if (!water || typeof millis !== "function") return;
    const settings = this.cleaningEffectsConfig();
    const startedAt = millis();
    const centerX = water.x + water.width / 2;
    const centerY = water.y + water.height / 2;
    for (let index = 0; index < settings.waterDroplets; index += 1) {
      this.cleaningWaterDrops.push({
        x: centerX + (Math.random() - 0.5) * water.width * 0.58,
        y: centerY + (Math.random() - 0.5) * water.height * 0.2,
        vx: (Math.random() - 0.5) * 0.07,
        vy: -0.05 - Math.random() * 0.08,
        size: 1.8 + Math.random() * 2.7,
        startedAt,
        duration: settings.waterDuration * (0.72 + Math.random() * 0.28)
      });
    }
    for (let index = 0; index < settings.waterRipples; index += 1) {
      this.cleaningRipples.push({
        x: centerX,
        y: centerY,
        startWidth: water.width * (0.18 + index * 0.12),
        endWidth: water.width * (0.72 + index * 0.13),
        ratio: water.height / Math.max(1, water.width),
        startedAt: startedAt + index * 55,
        duration: settings.waterDuration
      });
    }
    const dropletLimit = settings.waterDropletLimit;
    const rippleLimit = settings.waterRippleLimit;
    if (this.cleaningWaterDrops.length > dropletLimit) {
      this.cleaningWaterDrops.splice(0, this.cleaningWaterDrops.length - dropletLimit);
    }
    if (this.cleaningRipples.length > rippleLimit) {
      this.cleaningRipples.splice(0, this.cleaningRipples.length - rippleLimit);
    }
    this.recordEffectHighWater();
    this.scheduleEffectFrame();
  }

  spawnCleaningDirtParticles(affectedSpots, item = this.layout.cleaningItemBounds) {
    if (!affectedSpots?.length || !item || typeof millis !== "function") return;
    const settings = this.cleaningEffectsConfig();
    const available = Math.max(0, settings.dirtParticleLimit - this.cleaningDirtParticles.length);
    const count = Math.min(settings.dirtParticlesPerEvent, available, affectedSpots.length);
    if (!count) return;
    const startedAt = millis();
    const centerX = item.x + item.width / 2;
    const centerY = item.y + item.height / 2;
    for (let index = 0; index < count; index += 1) {
      const spot = affectedSpots[Math.floor(index * affectedSpots.length / count)];
      this.cleaningDirtParticles.push({
        x: centerX + spot.x * item.size,
        y: centerY + spot.y * item.size,
        vx: (Math.random() - 0.5) * 0.055,
        vy: -0.025 - Math.random() * 0.035,
        size: Math.max(1.4, item.size * (0.012 + Math.random() * 0.014)),
        amount: spot.amount,
        startedAt,
        duration: settings.dirtDuration * (0.8 + Math.random() * 0.25)
      });
    }
    this.recordEffectHighWater();
    this.scheduleEffectFrame();
  }

  drawCleaningEffects() {
    if (typeof millis !== "function") return;
    const now = millis();
    this.compactActive(this.cleaningWaterDrops, (particle) => now - particle.startedAt < particle.duration);
    this.compactActive(this.cleaningRipples, (ripple) => now - ripple.startedAt < ripple.duration);
    this.compactActive(this.cleaningDirtParticles, (particle) => now - particle.startedAt < particle.duration);
    this.recordEffectHighWater();

    this.cleaningRipples.forEach((ripple) => {
      const progress = Math.max(0, (now - ripple.startedAt) / ripple.duration);
      const rippleWidth = ripple.startWidth + (ripple.endWidth - ripple.startWidth) * progress;
      noFill();
      stroke(221, 250, 252, 150 * (1 - progress));
      strokeWeight(1.4);
      ellipse(ripple.x, ripple.y, rippleWidth, rippleWidth * ripple.ratio);
    });
    this.cleaningWaterDrops.forEach((particle) => {
      const elapsed = now - particle.startedAt;
      const progress = elapsed / particle.duration;
      noStroke();
      fill(148, 222, 235, 220 * (1 - progress));
      circle(
        particle.x + particle.vx * elapsed,
        particle.y + particle.vy * elapsed + progress * progress * 18,
        particle.size * (1 - progress * 0.25)
      );
    });
    this.cleaningDirtParticles.forEach((particle, index) => {
      const elapsed = now - particle.startedAt;
      const progress = elapsed / particle.duration;
      noStroke();
      const alpha = (120 + particle.amount * 100) * (1 - progress);
      fill(index % 2 ? 105 : 76, index % 2 ? 76 : 54, index % 2 ? 46 : 35, alpha);
      circle(
        particle.x + particle.vx * elapsed,
        particle.y + particle.vy * elapsed + progress * progress * 6,
        particle.size * (1 - progress * 0.35)
      );
    });

    if (this.cleaningWaterDrops.length || this.cleaningRipples.length || this.cleaningDirtParticles.length) {
      this.scheduleEffectFrame();
    }
  }

  handleCleaningBrushResult(result, item = this.layout.cleaningItemBounds) {
    if (!result) return;
    if (result.affectedSpots?.length) this.spawnCleaningDirtParticles(result.affectedSpots, item);
    if (result.complete) {
      this.cleaningTool = "hand";
      this.message = "Both faces are clean. Drag the find back to the inventory tray.";
    } else if (result.faceComplete) {
      this.message = "This face is clean. Use Flip to clean the other side.";
    } else if (result.changed) {
      this.message = "Keep brushing gently across the dirty areas.";
    }
    if (result.changed) this.messageTone = "neutral";
  }

  trenchLayout() {
    const margin = Math.max(12, width * 0.025);
    const isPortrait = height > width;
    const primaryButtonHeight = Math.max(28, Math.min(38, height * 0.19));
    const diagnosticButtonHeight = Math.max(26, Math.min(30, height * 0.065));
    const titleSize = Math.max(12, width * 0.025);
    const guidanceSize = Math.max(9, width * 0.015);
    const diagnosticY = 17 + primaryButtonHeight;
    const titleY = diagnosticY + diagnosticButtonHeight + 6;
    const guidanceY = titleY + titleSize * 1.2 + 3;
    const statusY = guidanceY + guidanceSize * 1.45 + 8;
    const headerHeight = statusY + Math.max(9, width * 0.015) * 0.7 + 6;
    const contentY = headerHeight + 6;

    if (isPortrait) {
      const minimumProfileHeight = Math.max(92, width * 0.3);
      const availableGridHeight = height - contentY - margin * 2 - minimumProfileHeight;
      const cellSize = Math.max(8, Math.min((width - margin * 2) / this.activeTrench.columns, availableGridHeight / this.activeTrench.rows));
      const gridWidth = cellSize * this.activeTrench.columns;
      const gridHeight = cellSize * this.activeTrench.rows;
      return {
        headerHeight,
        isPortrait,
        grid: { x: (width - gridWidth) / 2, y: contentY, width: gridWidth, height: gridHeight, cellSize },
        profile: { x: margin, y: contentY + gridHeight + 10, width: width - margin * 2, height: height - (contentY + gridHeight + 10) - margin }
      };
    }

    const contentHeight = height - contentY - margin;
    const minimumProfileWidth = Math.max(250, width * 0.29);
    const gridSize = Math.min(contentHeight, width - margin * 3 - minimumProfileWidth);
    const cellSize = Math.max(8, gridSize / this.activeTrench.columns);
    const gridWidth = cellSize * this.activeTrench.columns;
    const gridHeight = gridWidth;
    const profileX = margin * 2 + gridWidth;
    return {
      headerHeight,
      isPortrait,
      grid: { x: margin, y: contentY, width: gridWidth, height: gridHeight, cellSize },
      profile: { x: profileX, y: contentY, width: width - profileX - margin, height: contentHeight }
    };
  }

  drawTrench() {
    this.layout = this.trenchLayout();
    const trench = this.activeTrench;
    this.drawTrenchHeader(trench);
    this.drawExcavationGrid(trench, this.layout.grid);
    this.drawCachedProfile(trench, this.layout.profile);
    this.drawToolPreview();
    this.drawMessage();
    this.drawExcavationEffects();
    this.drawCarriedScoop();
  }

  drawTrenchHeader(trench) {
    const buttonHeight = Math.max(28, Math.min(38, height * 0.19));
    const diagnosticHeight = Math.max(26, Math.min(30, height * 0.065));
    const mapWidth = Math.max(70, width * 0.22);
    const toolWidth = Math.max(62, width * 0.18);
    this.layout.mapButton = { x: 12, y: 11, width: mapWidth, height: buttonHeight };
    this.layout.brushButton = { x: 18 + mapWidth, y: 11, width: toolWidth, height: buttonHeight };
    this.layout.scoopButton = { x: 24 + mapWidth + toolWidth, y: 11, width: toolWidth, height: buttonHeight };
    this.renderer.button(this.layout.mapButton, "Site map");
    this.renderer.button(this.layout.brushButton, "Brush", this.tool === "brush", false, false, { icon: "brush" });
    this.renderer.button(this.layout.scoopButton, "Shovel", this.tool === "scoop", false, false, { icon: "scoop" });

    const diagnosticY = 17 + buttonHeight;
    const diagnosticGap = 6;
    const diagnosticButtons = this.diagnosticButtonLayout(width, diagnosticY, diagnosticHeight, diagnosticGap);
    this.layout.depthButton = diagnosticButtons.depth;
    this.layout.performanceButton = diagnosticButtons.performance;
    this.layout.smoothingButton = diagnosticButtons.smoothing;
    this.layout.pillarButton = diagnosticButtons.pillar;
    this.layout.ridgeButton = diagnosticButtons.ridge;
    this.renderer.button(this.layout.depthButton, "Depths", this.showDepthDebug, true);
    this.renderer.button(
      this.layout.performanceButton,
      this.performanceMode === "full" ? "Performance: Full" : "Performance: Lite",
      this.performanceMode === "lite",
      true
    );
    const terrainControlsDisabled = this.performanceMode === "lite";
    this.renderer.button(
      this.layout.smoothingButton,
      this.terrainSmoothingMode === "all" ? "Smooth A: All" : "Smooth B: Focus",
      this.terrainSmoothingMode === "focus",
      true,
      terrainControlsDisabled
    );
    this.renderer.button(
      this.layout.pillarButton,
      this.pillarRenderMode === "round" ? "Pillars A: Round" : "Pillars B: Merge",
      this.pillarRenderMode === "merge",
      true,
      terrainControlsDisabled
    );
    this.renderer.button(
      this.layout.ridgeButton,
      this.ridgeDirectionMode === "current" ? "Ridges A: Current" : "Ridges B: High cut",
      this.ridgeDirectionMode === "high-cut",
      true,
      terrainControlsDisabled
    );

    const titleSize = Math.max(12, width * 0.025);
    const guidanceSize = Math.max(9, width * 0.015);
    const titleY = diagnosticY + diagnosticHeight + 6;
    const guidanceY = titleY + titleSize * 1.2 + 3;
    const statusY = guidanceY + guidanceSize * 1.45 + 8;
    this.layout.header = { titleY, guidanceY, statusY };

    this.drawInventory(trench, {
      x: this.layout.scoopButton.x + this.layout.scoopButton.width + 8,
      y: 11,
      width: width - (this.layout.scoopButton.x + this.layout.scoopButton.width + 20),
      height: buttonHeight
    });

    fill("#fff9e9");
    textAlign(LEFT, TOP);
    textStyle(BOLD);
    textSize(titleSize);
    text(`${trench.label} trench`, 16, titleY);
    textStyle(NORMAL);
    fill("#c9d9d8");
    textSize(guidanceSize);
    text(this.tool === "brush" ? "Drag over soil carefully." : "Drag a shovel-load out, or flick it aside.", 16, guidanceY);
  }

  drawExcavationGrid(trench, grid) {
    const cacheBounds = this.gridCacheBounds(grid);
    const cacheKey = this.gridCacheKey(trench, grid);
    const compatibilityKey = this.gridCacheCompatibilityKey(trench, cacheBounds);
    if (this.gridCache?.key === cacheKey && (this.gridCache.canvas || this.gridCache.image)) {
      this.drawGridCache(cacheBounds);
      this.terrainStats.cacheHits += 1;
      this.drawExcavationGridOverlays(trench, grid);
      return;
    }

    if (this.performanceMode === "full" && this.terrainWorkerResult?.key === cacheKey) {
      this.terrainStats.cacheMisses += 1;
      this.renderWorkerExcavationGrid(trench, grid, this.terrainWorkerResult);
      if (this.terrainWorkerResult.bitmap?.close) this.terrainWorkerResult.bitmap.close();
      this.terrainWorkerResult = null;
      this.captureGridCache(cacheBounds, cacheKey, compatibilityKey, "full");
      this.drawExcavationGridOverlays(trench, grid);
      return;
    }

    if (this.performanceMode === "full" && this.requestWorkerTerrain(cacheKey, trench, grid)) {
      if (this.gridCache?.compatibilityKey === compatibilityKey && (this.gridCache.canvas || this.gridCache.image)) {
        this.drawGridCache(cacheBounds);
        this.terrainStats.cacheHits += 1;
        this.drawExcavationGridOverlays(trench, grid);
        return;
      }
      this.terrainStats.cacheMisses += 1;
      this.renderExcavationGrid(trench, grid, { forceLite: true });
      this.captureGridCache(cacheBounds, `cold-preview:${cacheKey}`, compatibilityKey, "cold-preview");
      this.drawExcavationGridOverlays(trench, grid);
      return;
    }

    this.terrainStats.cacheMisses += 1;
    this.renderExcavationGrid(trench, grid);
    this.captureGridCache(
      cacheBounds,
      cacheKey,
      compatibilityKey,
      this.performanceMode === "lite" ? "lite" : "full"
    );
    this.drawExcavationGridOverlays(trench, grid);
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

  drawExcavationGridBackdrop(grid) {
    this.renderer.panel(grid.x - 5, grid.y - 5, grid.width + 10, grid.height + 10, "#3b2f25");
    noStroke();
    fill("#665e50");
    rect(grid.x, grid.y, grid.width, grid.height, 4);
  }

  drawExcavationGridOverlays(trench, grid) {
    if (this.showDepthDebug) this.drawDepthDebug(trench, grid);
    (trench.artefacts || []).forEach((artefact) => {
      if (artefact.exposure !== "partial" && artefact.exposure !== "revealed") return;
      this.renderer.artefact(
        artefact,
        grid.x + (artefact.centerX + 0.5) * grid.cellSize,
        grid.y + (artefact.centerY + 0.5) * grid.cellSize,
        Math.max(10, grid.cellSize * 1.45),
        {
          partial: artefact.exposure === "partial",
          visibleQuadrants: typeof trench.artefactVisibleQuadrants === "function"
            ? trench.artefactVisibleQuadrants(artefact)
            : [0]
        }
      );
    });
  }

  drawExcavationGridBorder(grid) {
    noFill();
    stroke("#f5e6bb");
    strokeWeight(2);
    rect(grid.x, grid.y, grid.width, grid.height, 3);
  }

  renderWorkerExcavationGrid(trench, grid, result) {
    const startedAt = this.terrainTimingNow();
    this.drawExcavationGridBackdrop(grid);
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
    this.drawExcavationGridBorder(grid);
    const mainCompositeMs = this.terrainTimingNow() - startedAt;
    this.recordTerrainTimings({
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
    return [
      trench.id,
      trench.terrainRevision ?? trench.visualRevision ?? 0,
      this.performanceMode,
      this.terrainSmoothingMode,
      this.pillarRenderMode,
      this.ridgeDirectionMode,
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
      cacheBounds.width.toFixed(2),
      cacheBounds.height.toFixed(2)
    ].join(":");
  }

  renderExcavationGrid(trench, grid, options = {}) {
    const totalStartedAt = this.terrainTimingNow();
    this.drawExcavationGridBackdrop(grid);
    const useLite = options.forceLite || this.performanceMode === "lite";
    const fieldStartedAt = this.terrainTimingNow();
    const surfaceField = this.buildVisibleSurfaceField(trench, { lightweight: useLite });
    const fieldDuration = this.terrainTimingNow() - fieldStartedAt;
    const terrainContext = drawingContext;
    terrainContext.save();
    terrainContext.beginPath();
    terrainContext.rect(grid.x, grid.y, grid.width, grid.height);
    terrainContext.clip();
    this.drawBaseTerrain(surfaceField, trench, grid);
    let topologyDuration = 0;
    let ambientDuration = 0;
    let compositeDuration = 0;
    if (useLite) {
      this.terrainStats.junctionsVisited = 0;
      this.terrainStats.junctionsSmoothed = 0;
      const compositeStartedAt = this.terrainTimingNow();
      this.drawTerrainPatterns(surfaceField, trench, grid);
      this.drawLiteAmbientOcclusion(surfaceField, trench, grid);
      compositeDuration = this.terrainTimingNow() - compositeStartedAt;
    } else {
      const topologyStartedAt = this.terrainTimingNow();
      const junctions = this.buildLocalJunctionDescriptors(surfaceField, trench, grid);
      const regions = this.collectCompleteSurfaceRegions(surfaceField, trench, grid, junctions);
      const preparedRegions = this.prepareSurfaceRegions(regions, trench);
      topologyDuration = this.terrainTimingNow() - topologyStartedAt;
      const ambientStartedAt = this.terrainTimingNow();
      const ambientBatches = this.collectAmbientOcclusion(surfaceField, trench, grid, junctions);
      const ambientBuffer = this.buildAmbientOcclusionBuffer(ambientBatches, regions, grid);
      ambientDuration = this.terrainTimingNow() - ambientStartedAt;
      const compositeStartedAt = this.terrainTimingNow();
      const patternGroups = this.buildTerrainPatternGroups(surfaceField, trench);
      this.drawDepthCompositedTerrain(surfaceField, trench, grid, regions, ambientBuffer, preparedRegions, patternGroups);
      compositeDuration = this.terrainTimingNow() - compositeStartedAt;
    }
    terrainContext.restore();
    this.drawExcavationGridBorder(grid);
    this.recordTerrainTimings({
      total: this.terrainTimingNow() - totalStartedAt,
      field: fieldDuration,
      topology: topologyDuration,
      ambient: ambientDuration,
      composite: compositeDuration
    });
  }

  terrainTimingNow() {
    return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  }

  recordTerrainTimings(timings) {
    this.terrainStats.lastTimings = { mode: this.performanceMode, ...timings };
    const sample = Math.min(60, (this.terrainStats.timingSamples || 0) + 1);
    Object.entries(timings).forEach(([name, value]) => {
      const previous = this.terrainStats.averageTimings[name] || 0;
      this.terrainStats.averageTimings[name] = previous + (value - previous) / sample;
    });
    this.terrainStats.timingSamples = sample;
  }

  buildVisibleSurfaceField(trench, options = {}) {
    const field = Array.from({ length: trench.rows }, (_, y) =>
      Array.from({ length: trench.columns }, (_, x) => {
        const depth = trench.getDepth(x, y);
        const layer = typeof trench.getRenderableSurfaceAt === "function"
          ? trench.getRenderableSurfaceAt(x, y)
          : trench.getSurfaceAt(x, y);
        return {
          x,
          y,
          actualDepth: depth,
          depth,
          actualLayer: layer,
          layer,
          renderColour: this.depthTintColour(layer.colour, depth, trench.maxDepth),
          signature: `${depth}:${layer.id}`,
          componentSize: 1,
          merged: false
        };
      })
    );

    if (!options.lightweight) {
      if (this.pillarRenderMode === "merge") this.mergeSmallExtrema(field, trench);
      const components = this.buildCardinalComponents(field, (cell) => cell.signature);
      components.items.forEach((component) => {
        component.cells.forEach((cell) => { field[cell.y][cell.x].componentSize = component.cells.length; });
      });
    }
    return field;
  }

  terrainLayers(trench) {
    return [trench.grassLayer, ...trench.layers, trench.bedrock].filter(Boolean);
  }

  buildCardinalComponents(field, keyForCell) {
    const rows = field.length;
    const columns = field[0]?.length || 0;
    const ids = Array.from({ length: rows }, () => Array(columns).fill(-1));
    const items = [];
    const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        if (ids[y][x] !== -1) continue;
        const id = items.length;
        const key = keyForCell(field[y][x]);
        const component = { id, key, cells: [] };
        const queue = [{ x, y }];
        ids[y][x] = id;
        for (let index = 0; index < queue.length; index += 1) {
          const cell = queue[index];
          component.cells.push(cell);
          directions.forEach(([dx, dy]) => {
            const nextX = cell.x + dx;
            const nextY = cell.y + dy;
            if (nextX < 0 || nextX >= columns || nextY < 0 || nextY >= rows || ids[nextY][nextX] !== -1) return;
            if (keyForCell(field[nextY][nextX]) !== key) return;
            ids[nextY][nextX] = id;
            queue.push({ x: nextX, y: nextY });
          });
        }
        items.push(component);
      }
    }
    return { ids, items };
  }

  mergeSmallExtrema(field, trench) {
    const depthComponents = this.buildCardinalComponents(field, (cell) => String(cell.depth));
    const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const layerOrder = new Map(this.terrainLayers(trench).map((layer, index) => [layer.id, index]));
    const pendingMerges = [];

    depthComponents.items.forEach((component) => {
      if (component.cells.length > 4) return;
      const componentDepth = field[component.cells[0].y][component.cells[0].x].depth;
      const boundary = [];
      component.cells.forEach((cell) => {
        directions.forEach(([dx, dy], directionIndex) => {
          const x = cell.x + dx;
          const y = cell.y + dy;
          if (x < 0 || x >= trench.columns || y < 0 || y >= trench.rows) return;
          if (depthComponents.ids[y][x] === component.id) return;
          boundary.push({ surface: field[y][x], directionIndex });
        });
      });
      if (!boundary.length) return;
      const entirelyDeeper = boundary.every((entry) => entry.surface.depth > componentDepth);
      const entirelyShallower = boundary.every((entry) => entry.surface.depth < componentDepth);
      if (!entirelyDeeper && !entirelyShallower) return;

      const candidates = new Map();
      boundary.forEach((entry) => {
        if (!candidates.has(entry.surface.signature)) {
          candidates.set(entry.surface.signature, { surface: entry.surface, count: 0, firstDirection: entry.directionIndex });
        }
        candidates.get(entry.surface.signature).count += 1;
      });
      const replacement = [...candidates.values()].sort((first, second) =>
        second.count - first.count ||
        Math.abs(first.surface.depth - componentDepth) - Math.abs(second.surface.depth - componentDepth) ||
        second.surface.depth - first.surface.depth ||
        (layerOrder.get(first.surface.layer.id) ?? 99) - (layerOrder.get(second.surface.layer.id) ?? 99) ||
        first.firstDirection - second.firstDirection
      )[0]?.surface;
      if (!replacement) return;
      pendingMerges.push({
        cells: component.cells,
        replacement: {
          depth: replacement.depth,
          layer: replacement.layer,
          renderColour: replacement.renderColour,
          signature: replacement.signature
        }
      });
    });

    pendingMerges.forEach(({ cells, replacement }) => {
      cells.forEach((cell) => {
        const target = field[cell.y][cell.x];
        target.depth = replacement.depth;
        target.layer = replacement.layer;
        target.renderColour = replacement.renderColour;
        target.signature = replacement.signature;
        target.merged = true;
      });
    });
  }

  drawBaseTerrain(field, trench, grid, context = drawingContext) {
    const overlap = this.terrainSeamOverlap(grid);
    for (let y = 0; y < trench.rows; y += 1) {
      for (let x = 0; x < trench.columns; x += 1) {
        context.fillStyle = field[y][x].renderColour || field[y][x].layer.colour;
        context.fillRect(
          grid.x + x * grid.cellSize - overlap,
          grid.y + y * grid.cellSize - overlap,
          grid.cellSize + overlap * 2,
          grid.cellSize + overlap * 2
        );
      }
    }
  }

  terrainSeamOverlap(grid) {
    return Math.min(0.75, Math.max(0.5, grid.cellSize * 0.02));
  }

  depthTintColour(sourceColour, depth, maxDepth = this.activeTrench?.maxDepth || 1) {
    const match = /^#([0-9a-f]{6})$/i.exec(sourceColour || "");
    if (!match) return sourceColour;
    const value = Number.parseInt(match[1], 16);
    const amount = Math.max(0, Math.min(1, depth / Math.max(1, maxDepth))) *
      (this.config.trench?.maxDepthDarkening || 0);
    const channel = (shift) => Math.round(((value >> shift) & 0xff) * (1 - amount));
    return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
  }

  buildTerrainPatternGroups(field, trench) {
    const groups = new Map();
    for (let y = 0; y < trench.rows; y += 1) {
      for (let x = 0; x < trench.columns; x += 1) {
        if ((x * 7 + y * 11) % 3 !== 0) continue;
        const surface = field[y][x];
        if (!groups.has(surface.depth)) groups.set(surface.depth, []);
        groups.get(surface.depth).push({ x, y, layer: surface.layer });
      }
    }
    return groups;
  }

  drawTerrainPatterns(field, trench, grid, depth = null, patternGroups = null, context = drawingContext) {
    const groups = patternGroups || this.buildTerrainPatternGroups(field, trench);
    const entries = depth === null ? [...groups.values()].flat() : (groups.get(depth) || []);
    const lineWidth = Math.max(0.7, grid.cellSize * 0.035);
    context.save();
    context.strokeStyle = "rgba(255, 255, 255, 0.149)";
    context.fillStyle = "rgba(255, 255, 255, 0.149)";
    context.lineWidth = lineWidth;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.beginPath();
    entries.forEach(({ x, y, layer }) => {
      const left = grid.x + x * grid.cellSize;
      const top = grid.y + y * grid.cellSize;
      if (layer.pattern === "lines") {
        context.moveTo(left + grid.cellSize * 0.4, top + grid.cellSize * 0.6);
        context.lineTo(left + grid.cellSize * 0.6, top + grid.cellSize * 0.4);
      } else if (layer.pattern === "cracks") {
        context.moveTo(left + grid.cellSize * 0.4, top + grid.cellSize * 0.4);
        context.lineTo(left + grid.cellSize * 0.51, top + grid.cellSize * 0.51);
        context.lineTo(left + grid.cellSize * 0.6, top + grid.cellSize * 0.44);
      } else if (layer.pattern === "grass") {
        const centerX = left + grid.cellSize * 0.5;
        const baseY = top + grid.cellSize * 0.62;
        context.moveTo(centerX, baseY);
        context.lineTo(centerX - grid.cellSize * 0.08, top + grid.cellSize * 0.4);
        context.moveTo(centerX, baseY);
        context.lineTo(centerX + grid.cellSize * 0.09, top + grid.cellSize * 0.36);
      }
    });
    context.stroke();
    context.beginPath();
    entries.forEach(({ x, y, layer }) => {
      if (layer.pattern !== "dots" && layer.pattern !== "specks") return;
      const centerX = grid.x + (x + 0.5) * grid.cellSize;
      const centerY = grid.y + (y + 0.5) * grid.cellSize;
      const radius = Math.max(0.4, lineWidth * 0.5);
      context.moveTo(centerX + radius, centerY);
      context.arc(centerX, centerY, radius, 0, Math.PI * 2);
    });
    context.fill();
    context.restore();
  }

  colourChannels(sourceColour) {
    const hex = /^#([0-9a-f]{6})$/i.exec(sourceColour || "");
    if (hex) {
      const value = Number.parseInt(hex[1], 16);
      return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff];
    }
    const rgb = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i.exec(sourceColour || "");
    return rgb ? rgb.slice(1, 4).map(Number) : [84, 72, 58];
  }

  preblendedShadowColour(sourceColour, amount) {
    const source = this.colourChannels(sourceColour);
    const shadow = [18, 24, 29];
    const blend = Math.max(0, Math.min(1, amount));
    const channels = source.map((channel, index) => Math.round(channel + (shadow[index] - channel) * blend));
    return `rgb(${channels[0]}, ${channels[1]}, ${channels[2]})`;
  }

  drawLiteAmbientOcclusion(field, trench, grid) {
    const records = [];
    const overlap = this.terrainSeamOverlap(grid);
    this.terrainStats.edgeChecks = 0;
    const addEdge = (first, second, orientation, edge, start) => {
      this.terrainStats.edgeChecks += 1;
      if (first.depth === second.depth) return;
      const deeperIsFirst = first.depth > second.depth;
      const deeper = deeperIsFirst ? first : second;
      const difference = Math.abs(first.depth - second.depth);
      const style = this.aoStyle(difference, grid);
      const width = Math.max(1, Math.min(grid.cellSize * 0.3, style.width));
      records.push({ deeper, difference, style, width, orientation, edge, start, deeperIsFirst });
    };

    for (let y = 0; y < trench.rows; y += 1) {
      for (let x = 0; x < trench.columns; x += 1) {
        if (x + 1 < trench.columns) {
          addEdge(field[y][x], field[y][x + 1], "vertical", grid.x + (x + 1) * grid.cellSize, grid.y + y * grid.cellSize);
        }
        if (y + 1 < trench.rows) {
          addEdge(field[y][x], field[y + 1][x], "horizontal", grid.y + (y + 1) * grid.cellSize, grid.x + x * grid.cellSize);
        }
      }
    }

    records.sort((first, second) => first.difference - second.difference);
    const context = drawingContext;
    records.forEach((record) => {
      context.fillStyle = this.preblendedShadowColour(
        record.deeper.renderColour || record.deeper.layer.colour,
        Math.min(0.48, record.style.alpha * 0.9)
      );
      if (record.orientation === "vertical") {
        const x = record.deeperIsFirst ? record.edge - record.width : record.edge;
        context.fillRect(x, record.start - overlap, record.width, grid.cellSize + overlap * 2);
      } else {
        const y = record.deeperIsFirst ? record.edge - record.width : record.edge;
        context.fillRect(record.start - overlap, y, grid.cellSize + overlap * 2, record.width);
      }
    });
  }

  junctionGroups(samples) {
    const groups = new Map();
    samples.forEach((sample) => {
      if (!groups.has(sample.surface.signature)) {
        groups.set(sample.surface.signature, {
          signature: sample.surface.signature,
          surface: sample.surface,
          samples: [],
          count: 0,
          componentSize: 0
        });
      }
      const group = groups.get(sample.surface.signature);
      group.samples.push(sample);
      group.count += 1;
      group.componentSize = Math.max(group.componentSize, sample.surface.componentSize);
    });
    return groups;
  }

  chooseJunctionOwner(groups, trench) {
    const layerOrder = new Map(this.terrainLayers(trench).map((layer, index) => [layer.id, index]));
    const hasMixedDepths = new Set([...groups.values()].map((group) => group.surface.depth)).size > 1;
    return [...groups.values()].sort((first, second) =>
      (this.ridgeDirectionMode === "high-cut" && hasMixedDepths
        ? second.surface.depth - first.surface.depth
        : 0) ||
      second.count - first.count ||
      second.componentSize - first.componentSize ||
      second.surface.depth - first.surface.depth ||
      (layerOrder.get(first.surface.layer.id) ?? 99) - (layerOrder.get(second.surface.layer.id) ?? 99) ||
      first.signature.localeCompare(second.signature)
    )[0];
  }

  shouldSmoothJunction(samples, groups) {
    if (groups.size <= 1) return false;
    if (this.terrainSmoothingMode === "all") return true;
    const counts = [...groups.values()].map((group) => group.count).sort((a, b) => b - a);
    const diagonalPair = groups.size === 2 && counts[0] === 2 &&
      samples[0].surface.signature === samples[2].surface.signature &&
      samples[1].surface.signature === samples[3].surface.signature;
    const cardinalPair = groups.size === 2 && counts[0] === 2 && counts[1] === 2 && (
      (samples[0].surface.signature === samples[1].surface.signature &&
        samples[3].surface.signature === samples[2].surface.signature) ||
      (samples[0].surface.signature === samples[3].surface.signature &&
        samples[1].surface.signature === samples[2].surface.signature)
    );
    const threeToOne = counts[0] === 3;
    const smallFeature = samples.some((sample) => sample.surface.componentSize <= 4);
    return diagonalPair || threeToOne || (smallFeature && !cardinalPair);
  }

  appendCornerLobePath(context, corner, bounds) {
    const { left, top, right, bottom, centerX, centerY } = bounds;
    if (corner === "tl") {
      context.moveTo(left, top);
      context.lineTo(centerX, top);
      context.quadraticCurveTo(centerX, centerY, left, centerY);
    } else if (corner === "tr") {
      context.moveTo(right, top);
      context.lineTo(right, centerY);
      context.quadraticCurveTo(centerX, centerY, centerX, top);
    } else if (corner === "br") {
      context.moveTo(right, bottom);
      context.lineTo(centerX, bottom);
      context.quadraticCurveTo(centerX, centerY, right, centerY);
    } else {
      context.moveTo(left, bottom);
      context.lineTo(left, centerY);
      context.quadraticCurveTo(centerX, centerY, centerX, bottom);
    }
    context.closePath();
  }

  drawLocalJunctions(field, trench, grid) {
    const descriptors = this.buildLocalJunctionDescriptors(field, trench, grid);
    const regions = this.collectJunctionSurfaceRegions(descriptors);
    this.drawBatchedJunctionSurfaces(regions, trench);
    return descriptors;
  }

  buildLocalJunctionDescriptors(field, trench, grid) {
    const descriptors = [];
    this.terrainStats.junctionsVisited = 0;
    this.terrainStats.junctionsSmoothed = 0;
    const corners = ["tl", "tr", "br", "bl"];
    const logicalSpan = grid.cellSize * 0.5;

    for (let y = 1; y < trench.rows; y += 1) {
      for (let x = 1; x < trench.columns; x += 1) {
        this.terrainStats.junctionsVisited += 1;
        const samples = [
          { corner: "tl", surface: field[y - 1][x - 1] },
          { corner: "tr", surface: field[y - 1][x] },
          { corner: "br", surface: field[y][x] },
          { corner: "bl", surface: field[y][x - 1] }
        ];
        const groups = this.junctionGroups(samples);
        if (!this.shouldSmoothJunction(samples, groups)) continue;
        const owner = this.chooseJunctionOwner(groups, trench);
        const centerX = grid.x + x * grid.cellSize;
        const centerY = grid.y + y * grid.cellSize;
        const bounds = {
          left: centerX - logicalSpan,
          top: centerY - logicalSpan,
          right: centerX + logicalSpan,
          bottom: centerY + logicalSpan,
          centerX,
          centerY
        };
        const lobes = [];
        samples.forEach((sample, index) => {
          if (sample.surface.signature === owner.signature) return;
          lobes.push({ corner: corners[index], surface: sample.surface });
        });
        descriptors.push({
          x,
          y,
          bounds,
          logicalSpan,
          owner: owner.surface,
          lobes
        });
        this.terrainStats.junctionsSmoothed += 1;
      }
    }
    return descriptors;
  }

  collectJunctionSurfaceRegions(junctions) {
    const regions = new Map();
    const regionFor = (surface) => {
      if (!regions.has(surface.signature)) {
        regions.set(surface.signature, {
          signature: surface.signature,
          surface,
          ownerPatches: [],
          positiveLobes: []
        });
      }
      return regions.get(surface.signature);
    };

    junctions.forEach((junction) => {
      regionFor(junction.owner).ownerPatches.push({ bounds: junction.bounds, holes: junction.lobes });
      junction.lobes.forEach((lobe) => {
        regionFor(lobe.surface).positiveLobes.push({ bounds: junction.bounds, corner: lobe.corner });
      });
    });
    return regions;
  }

  surfaceRegionFor(regions, surface) {
    if (!regions.has(surface.signature)) {
      regions.set(surface.signature, {
        signature: surface.signature,
        surface,
        rectangles: [],
        ownerPatches: [],
        positiveLobes: []
      });
    }
    return regions.get(surface.signature);
  }

  addSurfaceRectangle(regions, surface, left, top, right, bottom) {
    if (right - left <= 0.001 || bottom - top <= 0.001) return;
    this.surfaceRegionFor(regions, surface).rectangles.push({ left, top, right, bottom });
  }

  collectCompleteSurfaceRegions(field, trench, grid, junctions) {
    const regions = new Map();
    const descriptors = new Map(junctions.map((junction) => [`${junction.x}:${junction.y}`, junction]));
    const halfCell = grid.cellSize * 0.5;

    for (let vertexY = 0; vertexY <= trench.rows; vertexY += 1) {
      for (let vertexX = 0; vertexX <= trench.columns; vertexX += 1) {
        const centerX = grid.x + vertexX * grid.cellSize;
        const centerY = grid.y + vertexY * grid.cellSize;
        const bounds = {
          left: Math.max(grid.x, centerX - halfCell),
          top: Math.max(grid.y, centerY - halfCell),
          right: Math.min(grid.x + grid.width, centerX + halfCell),
          bottom: Math.min(grid.y + grid.height, centerY + halfCell),
          centerX,
          centerY
        };
        const descriptor = descriptors.get(`${vertexX}:${vertexY}`);
        if (descriptor) {
          this.surfaceRegionFor(regions, descriptor.owner).ownerPatches.push({ bounds, holes: descriptor.lobes });
          descriptor.lobes.forEach((lobe) => {
            this.surfaceRegionFor(regions, lobe.surface).positiveLobes.push({ bounds, corner: lobe.corner });
          });
          continue;
        }

        if (vertexX > 0 && vertexY > 0) {
          this.addSurfaceRectangle(regions, field[vertexY - 1][vertexX - 1], bounds.left, bounds.top, centerX, centerY);
        }
        if (vertexX < trench.columns && vertexY > 0) {
          this.addSurfaceRectangle(regions, field[vertexY - 1][vertexX], centerX, bounds.top, bounds.right, centerY);
        }
        if (vertexX < trench.columns && vertexY < trench.rows) {
          this.addSurfaceRectangle(regions, field[vertexY][vertexX], centerX, centerY, bounds.right, bounds.bottom);
        }
        if (vertexX > 0 && vertexY < trench.rows) {
          this.addSurfaceRectangle(regions, field[vertexY][vertexX - 1], bounds.left, centerY, centerX, bounds.bottom);
        }
      }
    }
    return regions;
  }

  appendSurfaceRegionPath(context, region) {
    region.rectangles.forEach((bounds) => {
      context.rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
    });
    region.ownerPatches.forEach((patch) => {
      const { bounds } = patch;
      context.rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
      patch.holes.forEach((hole) => this.appendCornerLobePath(context, hole.corner, bounds));
    });
    region.positiveLobes.forEach((lobe) => this.appendCornerLobePath(context, lobe.corner, lobe.bounds));
  }

  orderedSurfaceRegions(regions, trench) {
    const layerOrder = new Map(this.terrainLayers(trench).map((layer, index) => [layer.id, index]));
    return [...regions.values()].sort((first, second) =>
      second.surface.depth - first.surface.depth ||
      (layerOrder.get(first.surface.layer.id) ?? 99) - (layerOrder.get(second.surface.layer.id) ?? 99) ||
      first.signature.localeCompare(second.signature)
    );
  }

  prepareSurfaceRegions(regions, trench) {
    const ordered = this.orderedSurfaceRegions(regions, trench);
    const supportsPaths = typeof Path2D === "function";
    const byDepth = new Map();
    ordered.forEach((region) => {
      if (supportsPaths && !region.compiledPath) {
        region.compiledPath = new Path2D();
        this.appendSurfaceRegionPath(region.compiledPath, region);
      }
      const depth = region.surface.depth;
      if (!byDepth.has(depth)) byDepth.set(depth, { depth, regions: [], compiledPath: supportsPaths ? new Path2D() : null });
      const group = byDepth.get(depth);
      group.regions.push(region);
      if (group.compiledPath && region.compiledPath && typeof group.compiledPath.addPath === "function") {
        group.compiledPath.addPath(region.compiledPath);
      }
    });
    return {
      ordered,
      byDepth: [...byDepth.values()].sort((first, second) => second.depth - first.depth)
    };
  }

  drawSurfaceRegion(region, context = drawingContext) {
    context.fillStyle = region.surface.renderColour || region.surface.layer.colour;
    if (region.compiledPath) {
      context.fill(region.compiledPath, "evenodd");
    } else {
      context.beginPath();
      this.appendSurfaceRegionPath(context, region);
      context.fill("evenodd");
    }
  }

  drawBatchedJunctionSurfaces(regions, trench, context = drawingContext) {
    const layerOrder = new Map(this.terrainLayers(trench).map((layer, index) => [layer.id, index]));
    const orderedRegions = [...regions.values()].sort((first, second) =>
      second.surface.depth - first.surface.depth ||
      (layerOrder.get(first.surface.layer.id) ?? 99) - (layerOrder.get(second.surface.layer.id) ?? 99) ||
      first.signature.localeCompare(second.signature)
    );

    context.save();
    orderedRegions.forEach((region) => {
      context.beginPath();
      region.ownerPatches.forEach((patch) => {
        const { bounds } = patch;
        context.rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
        patch.holes.forEach((hole) => this.appendCornerLobePath(context, hole.corner, bounds));
      });
      region.positiveLobes.forEach((lobe) => this.appendCornerLobePath(context, lobe.corner, lobe.bounds));
      context.fillStyle = region.surface.renderColour || region.surface.layer.colour;
      context.fill("evenodd");
    });
    context.restore();
  }

  cornerBoundary(corner, bounds) {
    const { left, top, right, bottom, centerX, centerY } = bounds;
    if (corner === "tl") return { start: [centerX, top], control: [centerX, centerY], end: [left, centerY], vector: [-1, -1] };
    if (corner === "tr") return { start: [right, centerY], control: [centerX, centerY], end: [centerX, top], vector: [1, -1] };
    if (corner === "br") return { start: [centerX, bottom], control: [centerX, centerY], end: [right, centerY], vector: [1, 1] };
    return { start: [left, centerY], control: [centerX, centerY], end: [centerX, bottom], vector: [-1, 1] };
  }

  aoStyle(depthDifference, grid) {
    const resolutionScale = this.activeTrench?.depthResolutionScale || this.config.trench?.depthResolutionScale || 1;
    const physicalDifference = depthDifference / resolutionScale;
    return {
      width: grid.cellSize * Math.min(0.24, 0.055 + physicalDifference * 0.032),
      alpha: Math.min(0.6, 0.1 + physicalDifference * 0.1)
    };
  }

  ambientBatchFor(batches, surface) {
    if (!batches.has(surface.signature)) batches.set(surface.signature, { surface, polygons: [] });
    return batches.get(surface.signature);
  }

  straightAORibbon(startX, startY, endX, endY, orientation, deeperIsFirst, width) {
    if (orientation === "vertical") {
      const innerX = startX + (deeperIsFirst ? -width : width);
      return [{ x: startX, y: startY }, { x: endX, y: endY }, { x: innerX, y: endY }, { x: innerX, y: startY }];
    }
    const innerY = startY + (deeperIsFirst ? -width : width);
    return [{ x: startX, y: startY }, { x: endX, y: endY }, { x: endX, y: innerY }, { x: startX, y: innerY }];
  }

  quadraticPoint(start, control, end, amount) {
    const inverse = 1 - amount;
    return {
      x: inverse * inverse * start[0] + 2 * inverse * amount * control[0] + amount * amount * end[0],
      y: inverse * inverse * start[1] + 2 * inverse * amount * control[1] + amount * amount * end[1]
    };
  }

  quadraticDerivative(start, control, end, amount) {
    return {
      x: 2 * (1 - amount) * (control[0] - start[0]) + 2 * amount * (end[0] - control[0]),
      y: 2 * (1 - amount) * (control[1] - start[1]) + 2 * amount * (end[1] - control[1])
    };
  }

  curvedAORibbon(boundary, width, deeperIsLobe, overlap = 0.5) {
    const boundaryPoints = [];
    const innerPoints = [];
    const segments = 8;
    for (let index = 0; index <= segments; index += 1) {
      const amount = index / segments;
      const point = this.quadraticPoint(boundary.start, boundary.control, boundary.end, amount);
      const tangent = this.quadraticDerivative(boundary.start, boundary.control, boundary.end, amount);
      const tangentLength = Math.max(0.0001, Math.hypot(tangent.x, tangent.y));
      let normalX = -tangent.y / tangentLength;
      let normalY = tangent.x / tangentLength;
      if (normalX * boundary.vector[0] + normalY * boundary.vector[1] < 0) {
        normalX *= -1;
        normalY *= -1;
      }
      if (!deeperIsLobe) {
        normalX *= -1;
        normalY *= -1;
      }
      let extensionX = 0;
      let extensionY = 0;
      if (index === 0) {
        extensionX = -tangent.x / tangentLength * overlap;
        extensionY = -tangent.y / tangentLength * overlap;
      } else if (index === segments) {
        extensionX = tangent.x / tangentLength * overlap;
        extensionY = tangent.y / tangentLength * overlap;
      }
      boundaryPoints.push({ x: point.x + extensionX, y: point.y + extensionY });
      innerPoints.push({ x: point.x + extensionX + normalX * width, y: point.y + extensionY + normalY * width });
    }
    return [...boundaryPoints, ...innerPoints.reverse()];
  }

  normalisePolygonWinding(polygon) {
    let signedArea = 0;
    for (let index = 0; index < polygon.length; index += 1) {
      const current = polygon[index];
      const next = polygon[(index + 1) % polygon.length];
      signedArea += current.x * next.y - next.x * current.y;
    }
    return signedArea < 0 ? [...polygon].reverse() : polygon;
  }

  collectAmbientOcclusion(field, trench, grid, junctions) {
    const smoothedVertices = new Map(junctions.map((junction) => [`${junction.x}:${junction.y}`, junction]));
    const batches = new Map();
    const joinOverlap = Math.min(0.5, grid.cellSize * 0.04);
    this.terrainStats.edgeChecks = 0;

    const addEdge = (first, second, startX, startY, endX, endY, startVertex, endVertex, orientation) => {
      this.terrainStats.edgeChecks += 1;
      if (first.depth === second.depth) return;
      const deeperIsFirst = first.depth > second.depth;
      const deeperSurface = deeperIsFirst ? first : second;
      const difference = Math.abs(first.depth - second.depth);
      const style = this.aoStyle(difference, grid);
      const startJunction = smoothedVertices.get(startVertex);
      const endJunction = smoothedVertices.get(endVertex);
      if (startJunction) {
        if (orientation === "vertical") startY += startJunction.logicalSpan - joinOverlap;
        else startX += startJunction.logicalSpan - joinOverlap;
      }
      if (endJunction) {
        if (orientation === "vertical") endY -= endJunction.logicalSpan - joinOverlap;
        else endX -= endJunction.logicalSpan - joinOverlap;
      }
      const remainingLength = orientation === "vertical" ? endY - startY : endX - startX;
      if (remainingLength <= 0.01) return;
      this.ambientBatchFor(batches, deeperSurface).polygons.push(
        {
          points: this.straightAORibbon(startX, startY, endX, endY, orientation, deeperIsFirst, style.width),
          alpha: style.alpha,
          depthDifference: difference
        }
      );
    };

    for (let y = 0; y < trench.rows; y += 1) {
      for (let x = 0; x < trench.columns; x += 1) {
        if (x + 1 < trench.columns) {
          const edgeX = grid.x + (x + 1) * grid.cellSize;
          addEdge(
            field[y][x], field[y][x + 1],
            edgeX, grid.y + y * grid.cellSize,
            edgeX, grid.y + (y + 1) * grid.cellSize,
            `${x + 1}:${y}`, `${x + 1}:${y + 1}`, "vertical"
          );
        }
        if (y + 1 < trench.rows) {
          const edgeY = grid.y + (y + 1) * grid.cellSize;
          addEdge(
            field[y][x], field[y + 1][x],
            grid.x + x * grid.cellSize, edgeY,
            grid.x + (x + 1) * grid.cellSize, edgeY,
            `${x}:${y + 1}`, `${x + 1}:${y + 1}`, "horizontal"
          );
        }
      }
    }

    junctions.forEach((junction) => {
      junction.lobes.forEach((lobe) => {
        if (lobe.surface.depth === junction.owner.depth) return;
        const lobeIsDeeper = lobe.surface.depth > junction.owner.depth;
        const deeperSurface = lobeIsDeeper ? lobe.surface : junction.owner;
        const style = this.aoStyle(Math.abs(lobe.surface.depth - junction.owner.depth), grid);
        const boundary = this.cornerBoundary(lobe.corner, junction.bounds);
        this.ambientBatchFor(batches, deeperSurface).polygons.push(
          {
            points: this.curvedAORibbon(boundary, style.width, lobeIsDeeper, joinOverlap),
            alpha: style.alpha,
            depthDifference: Math.abs(lobe.surface.depth - junction.owner.depth)
          }
        );
      });
    });
    return batches;
  }

  appendAmbientPolygonPath(context, polygon) {
    const normalisedPolygon = this.normalisePolygonWinding(polygon);
    context.moveTo(normalisedPolygon[0].x, normalisedPolygon[0].y);
    for (let index = 1; index < normalisedPolygon.length; index += 1) {
      context.lineTo(normalisedPolygon[index].x, normalisedPolygon[index].y);
    }
    context.closePath();
  }

  drawAmbientBatch(batch, context = drawingContext, replaceOverlaps = false) {
    const opacityGroups = new Map();
    batch.polygons.forEach((polygonRecord) => {
      const record = Array.isArray(polygonRecord) ? { points: polygonRecord, alpha: 0.24 } : polygonRecord;
      const key = record.alpha.toFixed(3);
      if (!opacityGroups.has(key)) opacityGroups.set(key, { alpha: record.alpha, polygons: [] });
      opacityGroups.get(key).polygons.push(record.points);
    });
    const orderedGroups = [...opacityGroups.values()].sort((first, second) => first.alpha - second.alpha);
    context.save();
    orderedGroups.forEach((group, index) => {
      context.globalCompositeOperation = "source-over";
      context.fillStyle = `rgba(18, 24, 29, ${group.alpha})`;
      context.beginPath();
      group.polygons.forEach((polygon) => this.appendAmbientPolygonPath(context, polygon));
      if (!replaceOverlaps || index === 0) {
        context.fill();
        return;
      }
      const points = group.polygons.flat();
      const left = Math.min(...points.map((point) => point.x));
      const top = Math.min(...points.map((point) => point.y));
      const right = Math.max(...points.map((point) => point.x));
      const bottom = Math.max(...points.map((point) => point.y));
      context.save();
      context.clip();
      context.globalCompositeOperation = "copy";
      context.fillRect(left - 1, top - 1, right - left + 2, bottom - top + 2);
      context.restore();
    });
    context.restore();
  }

  drawAmbientOcclusionBatches(batches, context = drawingContext) {
    context.save();
    batches.forEach((batch) => this.drawAmbientBatch(batch, context));
    context.restore();
  }

  drawLocalAmbientOcclusion(field, trench, grid, junctions) {
    this.drawAmbientOcclusionBatches(this.collectAmbientOcclusion(field, trench, grid, junctions));
  }

  ensureAmbientBuffer(grid) {
    const density = typeof pixelDensity === "function" ? pixelDensity() : 1;
    const pixelWidth = Math.max(1, Math.ceil(grid.width * density));
    const pixelHeight = Math.max(1, Math.ceil(grid.height * density));
    if (!this.ambientBuffer ||
      this.ambientBuffer.pixelWidth !== pixelWidth ||
      this.ambientBuffer.pixelHeight !== pixelHeight ||
      this.ambientBuffer.logicalWidth !== grid.width ||
      this.ambientBuffer.logicalHeight !== grid.height ||
      this.ambientBuffer.density !== density) {
      this.releaseCanvasBuffer(this.ambientBuffer);
      let canvas = null;
      if (typeof document !== "undefined") canvas = document.createElement("canvas");
      else if (typeof OffscreenCanvas !== "undefined") canvas = new OffscreenCanvas(pixelWidth, pixelHeight);
      if (!canvas) return null;
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      this.ambientBuffer = {
        canvas,
        context: canvas.getContext("2d"),
        pixelWidth,
        pixelHeight,
        logicalWidth: grid.width,
        logicalHeight: grid.height,
        density
      };
      this.updateCanvasPixelStats();
    }
    return this.ambientBuffer;
  }

  buildAmbientOcclusionBuffer(batches, regions, grid) {
    const buffer = this.ensureAmbientBuffer(grid);
    if (!buffer) return null;
    const context = buffer.context;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, buffer.pixelWidth, buffer.pixelHeight);
    context.setTransform(buffer.density, 0, 0, buffer.density, -grid.x * buffer.density, -grid.y * buffer.density);
    batches.forEach((batch, signature) => {
      const region = regions.get(signature);
      if (!region || !batch.polygons.length) return;
      context.save();
      if (region.compiledPath) {
        context.clip(region.compiledPath, "evenodd");
      } else {
        context.beginPath();
        this.appendSurfaceRegionPath(context, region);
        context.clip("evenodd");
      }
      this.drawAmbientBatch(batch, context, true);
      context.restore();
    });
    context.setTransform(1, 0, 0, 1, 0, 0);
    return buffer;
  }

  drawDepthCompositedTerrain(field, trench, grid, regions, ambientBuffer, preparedRegions = null, patternGroups = null) {
    const context = drawingContext;
    const prepared = preparedRegions || this.prepareSurfaceRegions(regions, trench);
    const patterns = patternGroups || this.buildTerrainPatternGroups(field, trench);
    prepared.byDepth.forEach((depthGroup) => {
      depthGroup.regions.forEach((region) => this.drawSurfaceRegion(region, context));
      this.drawTerrainPatterns(field, trench, grid, depthGroup.depth, patterns);
      if (!ambientBuffer) return;
      context.save();
      if (depthGroup.compiledPath) {
        context.clip(depthGroup.compiledPath, "evenodd");
      } else {
        context.beginPath();
        depthGroup.regions.forEach((region) => this.appendSurfaceRegionPath(context, region));
        context.clip("evenodd");
      }
      context.drawImage(ambientBuffer.canvas, grid.x, grid.y, grid.width, grid.height);
      context.restore();
    });
  }

  drawDepthDebug(trench, grid) {
    textAlign(CENTER, CENTER);
    textStyle(BOLD);
    textSize(Math.max(5, Math.min(12, grid.cellSize * 0.42)));
    for (let y = 0; y < trench.rows; y += 1) {
      for (let x = 0; x < trench.columns; x += 1) {
        const centerX = grid.x + (x + 0.5) * grid.cellSize;
        const centerY = grid.y + (y + 0.5) * grid.cellSize;
        noStroke();
        fill(11, 22, 27, 185);
        text(trench.getDepth(x, y), centerX + 0.8, centerY + 1);
        fill("#fff9e9");
        text(trench.getDepth(x, y), centerX, centerY);
      }
    }
    textStyle(NORMAL);
  }

  diagnosticButtonLayout(totalWidth, y, buttonHeight, gap = 6) {
    const usableWidth = totalWidth - 24 - gap * 4;
    const depthWidth = usableWidth * 0.13;
    const performanceWidth = usableWidth * 0.18;
    const comparisonWidth = (usableWidth - depthWidth - performanceWidth) / 3;
    const depth = { x: 12, y, width: depthWidth, height: buttonHeight };
    const performance = { x: depth.x + depth.width + gap, y, width: performanceWidth, height: buttonHeight };
    const smoothing = { x: performance.x + performance.width + gap, y, width: comparisonWidth, height: buttonHeight };
    const pillar = { x: smoothing.x + smoothing.width + gap, y, width: comparisonWidth, height: buttonHeight };
    const ridge = { x: pillar.x + pillar.width + gap, y, width: comparisonWidth, height: buttonHeight };
    return { depth, performance, smoothing, pillar, ridge };
  }

  profileCacheBounds(profile) {
    const x = Math.floor(profile.x);
    const y = Math.floor(profile.y);
    return {
      x,
      y,
      width: Math.ceil(profile.x + profile.width + 4) - x,
      height: Math.ceil(profile.y + profile.height + 5) - y
    };
  }

  profileCacheKey(trench, profile) {
    return [
      trench.id,
      trench.visualRevision ?? 0,
      this.layout.isPortrait ? 1 : 0,
      profile.x.toFixed(2),
      profile.y.toFixed(2),
      profile.width.toFixed(2),
      profile.height.toFixed(2)
    ].join(":");
  }

  ensureProfileCacheSurface(bounds) {
    const density = typeof pixelDensity === "function" ? pixelDensity() : 1;
    const pixelWidth = Math.max(1, Math.ceil(bounds.width * density));
    const pixelHeight = Math.max(1, Math.ceil(bounds.height * density));
    const existing = this.profileCache;
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
    this.profileCache = {
      key: null,
      canvas,
      context: canvas.getContext("2d", { alpha: true }),
      pixelWidth,
      pixelHeight,
      density
    };
    this.updateCanvasPixelStats();
    return this.profileCache;
  }

  drawProfileCache(bounds) {
    if (this.profileCache?.canvas) {
      drawingContext.drawImage(this.profileCache.canvas, bounds.x, bounds.y, bounds.width, bounds.height);
    } else if (this.profileCache?.image) {
      image(this.profileCache.image, bounds.x, bounds.y, bounds.width, bounds.height);
    }
  }

  captureProfileCache(bounds, key) {
    const cache = this.ensureProfileCacheSurface(bounds);
    if (cache?.context && drawingContext?.canvas) {
      cache.context.setTransform(1, 0, 0, 1, 0, 0);
      cache.context.clearRect(0, 0, cache.pixelWidth, cache.pixelHeight);
      const density = cache.density;
      cache.context.drawImage(
        drawingContext.canvas,
        bounds.x * density,
        bounds.y * density,
        bounds.width * density,
        bounds.height * density,
        0,
        0,
        cache.pixelWidth,
        cache.pixelHeight
      );
      cache.key = key;
    } else if (typeof get === "function") {
      this.profileCache = {
        key,
        image: get(bounds.x, bounds.y, bounds.width, bounds.height)
      };
    }
    this.updateCanvasPixelStats();
  }

  drawCachedProfile(trench, profile) {
    const bounds = this.profileCacheBounds(profile);
    const key = this.profileCacheKey(trench, profile);
    if (this.profileCache?.key === key && (this.profileCache.canvas || this.profileCache.image)) {
      this.drawProfileCache(bounds);
      this.frameStats.profileCacheHits += 1;
      return;
    }
    this.drawProfile(trench, profile);
    this.captureProfileCache(bounds, key);
    this.frameStats.profileRebuilds += 1;
  }

  drawProfile(trench, profile) {
    this.renderer.panel(profile.x, profile.y, profile.width, profile.height, "#e8dcc2");
    const titleHeight = Math.max(30, Math.min(42, profile.height * 0.22));
    const keyWidth = Math.max(94, profile.width * (this.layout.isPortrait ? 0.34 : 0.38));
    const diagram = {
      x: profile.x + 6,
      y: profile.y + titleHeight + 4,
      width: profile.width - keyWidth - 14,
      height: profile.height - titleHeight - 10
    };
    const gaugeWidth = Math.max(23, diagram.width * 0.2);
    const inner = {
      x: diagram.x + gaugeWidth + 5,
      y: diagram.y,
      width: Math.max(18, diagram.width - gaugeWidth - 7),
      height: Math.max(26, diagram.height)
    };
    const levelHeight = inner.height / (trench.maxDepth + 1);
    const sampleRow = Math.floor(trench.rows / 2);
    fill("#24444a");
    noStroke();
    textAlign(LEFT, TOP);
    textStyle(BOLD);
    textSize(Math.max(12, Math.min(24, titleHeight * 0.64)));
    text("PROFILE", profile.x + 7, profile.y + Math.max(4, titleHeight * 0.12));
    textStyle(NORMAL);

    noStroke();
    fill("#b8ac94");
    rect(inner.x, inner.y, inner.width, inner.height, 2);
    const columnWidth = inner.width / trench.columns;
    for (let column = 0; column < trench.columns; column += 1) {
      const revealedDepth = trench.getDepth(column, sampleRow);
      const columnX = inner.x + column * columnWidth;
      for (let depth = 0; depth < revealedDepth; depth += 1) {
        const layer = trench.getStratumAt(column, sampleRow, depth);
        const faceColour = this.depthTintColour(layer.colour, depth, trench.maxDepth);
        const top = inner.y + depth * levelHeight;
        noStroke();
        fill(this.mutedColour(faceColour));
        rect(columnX, top, columnWidth + 0.5, levelHeight + 0.5);
        fill(faceColour);
        rect(columnX + 1.2, top + 1.2, Math.max(1, columnWidth - 2.1), Math.max(1, levelHeight - 2.1));
      }
      if (revealedDepth >= trench.maxDepth) {
        const bedrockTop = inner.y + trench.maxDepth * levelHeight;
        const bedrockColour = this.depthTintColour(trench.bedrock.colour, trench.maxDepth, trench.maxDepth);
        noStroke();
        fill(this.mutedColour(bedrockColour));
        rect(columnX, bedrockTop, columnWidth + 0.5, levelHeight + 0.5);
        fill(bedrockColour);
        rect(columnX + 1.2, bedrockTop + 1.2, Math.max(1, columnWidth - 2.1), Math.max(1, levelHeight - 2.1));
      }
    }

    stroke("#5e6b70");
    strokeWeight(1);
    line(diagram.x + gaugeWidth, inner.y, diagram.x + gaugeWidth, inner.y + inner.height);
    fill("#25444a");
    noStroke();
    textAlign(RIGHT, CENTER);
    textSize(Math.max(5, Math.min(12, levelHeight * 0.72)));
    for (let depth = 0; depth <= trench.maxDepth; depth += 1) {
      const y = inner.y + depth * levelHeight;
      stroke("#5e6b70");
      line(diagram.x + gaugeWidth - 4, y, diagram.x + gaugeWidth + 2, y);
      noStroke();
      if (depth % (trench.depthResolutionScale || 1) === 0 || depth === trench.maxDepth) {
        text(depth, diagram.x + gaugeWidth - 6, y);
      }
    }

    const visibleArtefacts = trench.artefacts.filter((artefact) => artefact.exposure !== "hidden");
    visibleArtefacts.forEach((artefact, index) => {
      if (artefact.exposure !== "hidden") {
        const matchingMarkers = visibleArtefacts.filter(
          (other, otherIndex) => otherIndex < index && other.x === artefact.x && other.depth === artefact.depth
        ).length;
        const markerOffset = matchingMarkers * Math.max(4, profile.width * 0.025);
        const x = inner.x + (artefact.centerX + 0.5) * columnWidth;
        const y = inner.y + (artefact.depth + 0.5) * levelHeight;
        this.renderer.artefact(
          artefact,
          x + markerOffset,
          y,
          Math.max(7, Math.min(columnWidth * 1.45, levelHeight * (trench.depthResolutionScale || 1) * 1.45)),
          {
            collected: artefact.exposure === "collected",
            partial: artefact.exposure === "partial",
            visibleQuadrants: typeof trench.artefactVisibleQuadrants === "function"
              ? trench.artefactVisibleQuadrants(artefact)
              : [0]
          }
        );
      }
    });

    this.drawLayerKey(trench, {
      x: profile.x + profile.width - keyWidth - 5,
      y: diagram.y,
      width: keyWidth,
      height: diagram.height
    });
  }

  drawLayerKey(trench, bounds) {
    const layers = trench.getDiscoveredLayers();
    fill("#25444a");
    noStroke();
    textAlign(CENTER, TOP);
    textStyle(BOLD);
    textSize(Math.max(8, Math.min(12, bounds.height * 0.12)));
    text("KEY", bounds.x + bounds.width / 2, bounds.y);
    textStyle(NORMAL);
    if (!layers.length) return;

    const top = bounds.y + Math.max(14, bounds.height * 0.16);
    const availableHeight = Math.max(12, bounds.y + bounds.height - top - 3);
    const entryHeight = Math.max(10, availableHeight / layers.length);
    const swatchHeight = Math.max(8, Math.min(22, entryHeight - 3));
    const swatchWidth = Math.max(24, Math.min(34, bounds.width * 0.3));
    layers.forEach((layer, index) => {
      const y = top + index * entryHeight + Math.max(0, (entryHeight - swatchHeight) / 2);
      noStroke();
      fill(this.mutedColour(layer.colour));
      rect(bounds.x + 3, y, swatchWidth, swatchHeight, 2);
      fill(layer.colour);
      rect(bounds.x + 5, y + 2, Math.max(2, swatchWidth - 4), Math.max(2, swatchHeight - 4), 1);
      stroke(255, 255, 255, 120);
      strokeWeight(1);
      if (layer.pattern === "lines") {
        line(bounds.x + 7, y + swatchHeight - 4, bounds.x + swatchWidth - 4, y + 4);
      } else if (layer.pattern === "dots" || layer.pattern === "specks") {
        point(bounds.x + swatchWidth * 0.35, y + swatchHeight * 0.45);
        point(bounds.x + swatchWidth * 0.66, y + swatchHeight * 0.62);
      } else if (layer.pattern === "cracks") {
        line(bounds.x + 7, y + 4, bounds.x + swatchWidth * 0.55, y + swatchHeight * 0.56);
        line(bounds.x + swatchWidth * 0.55, y + swatchHeight * 0.56, bounds.x + swatchWidth - 4, y + 4);
      }
      noStroke();
      fill("#25444a");
      textAlign(LEFT, CENTER);
      textSize(Math.max(7, Math.min(11, swatchHeight * 0.55)));
      text(layer.name, bounds.x + swatchWidth + 6, y + swatchHeight / 2);
    });
  }

  mutedColour(hex) {
    const source = color(hex);
    return color(
      red(source) * 0.58,
      green(source) * 0.58,
      blue(source) * 0.58
    );
  }

  drawCarriedScoop() {
    if (this.pointerAction?.type !== "scoop") return;
    const { x, y, soilColours } = this.pointerAction;
    this.drawSoilClump(x, y, soilColours, this.scoopClumpSize());
  }

  scoopClumpSize() {
    const scale = this.layout.isPortrait ? 1.25 : 1.9;
    return Math.max(22, this.layout.grid.cellSize * this.activeTrench.scoopRadius * scale);
  }

  drawSoilClump(x, y, soilColours, clumpSize, alpha = 255) {
    const offsets = [[-0.32, 0.12], [0.12, -0.16], [0.38, 0.18], [-0.04, 0.34], [-0.42, -0.2]];
    push();
    translate(x, y);
    noStroke();
    fill(0, 0, 0, alpha * 0.38);
    ellipse(3, clumpSize * 0.42, clumpSize * 1.55, clumpSize * 0.62);
    offsets.forEach((offset, index) => {
      const outlineColour = color("#382719");
      stroke(red(outlineColour), green(outlineColour), blue(outlineColour), alpha);
      strokeWeight(Math.max(1.2, clumpSize * 0.09));
      const clumpColour = color(soilColours[index % soilColours.length] || "#8b603b");
      fill(red(clumpColour), green(clumpColour), blue(clumpColour), alpha);
      circle(offset[0] * clumpSize, offset[1] * clumpSize, clumpSize * 0.64);
    });
    pop();
  }

  drawExcavationEffects() {
    const now = millis();
    this.compactActive(this.brushParticles, (particle) => now - particle.startedAt < particle.duration);
    this.compactActive(this.depositedClumps, (clump) =>
      now - clump.startedAt < (clump.motionDuration || 0) + clump.holdDuration + clump.fadeDuration
    );
    this.recordEffectHighWater();

    this.brushParticles.forEach((particle) => {
      const progress = (now - particle.startedAt) / particle.duration;
      const alpha = 210 * (1 - progress);
      noStroke();
      const particleColour = color(particle.colour);
      fill(red(particleColour), green(particleColour), blue(particleColour), alpha);
      circle(
        particle.x + particle.vx * (now - particle.startedAt),
        particle.y + particle.vy * (now - particle.startedAt) + progress * progress * 7,
        particle.size * (1 - progress * 0.35)
      );
    });

    this.depositedClumps.forEach((clump) => {
      const elapsed = now - clump.startedAt;
      const movingFor = Math.min(elapsed, clump.motionDuration || 0) / 1000;
      const speed = clump.launchSpeed || 0;
      const deceleration = clump.deceleration || 0;
      const distance = speed && deceleration
        ? Math.max(0, speed * movingFor - deceleration * movingFor * movingFor / 2)
        : 0;
      const drawX = clump.x + (clump.directionX || 0) * distance;
      const drawY = clump.y + (clump.directionY || 0) * distance;
      const settledElapsed = Math.max(0, elapsed - (clump.motionDuration || 0));
      const fadeProgress = settledElapsed <= clump.holdDuration
        ? 0
        : (settledElapsed - clump.holdDuration) / clump.fadeDuration;
      this.drawSoilClump(drawX, drawY, clump.soilColours, clump.size, 255 * (1 - fadeProgress));
    });

    if (this.brushParticles.length || this.depositedClumps.length) this.scheduleEffectFrame();
  }

  scheduleEffectFrame() {
    this.requestFrame();
  }

  spawnBrushParticles(cell, layer) {
    const centerX = this.layout.grid.x + (cell.x + 0.5) * this.layout.grid.cellSize;
    const centerY = this.layout.grid.y + (cell.y + 0.5) * this.layout.grid.cellSize;
    const startedAt = millis();
    const particleCount = this.performanceMode === "lite"
      ? 2 + Math.floor(Math.random() * 2)
      : 4 + Math.floor(Math.random() * 3);
    for (let index = 0; index < particleCount; index += 1) {
      this.brushParticles.push({
        x: centerX + (Math.random() - 0.5) * this.layout.grid.cellSize * 0.35,
        y: centerY + (Math.random() - 0.5) * this.layout.grid.cellSize * 0.35,
        vx: (Math.random() - 0.5) * 0.09,
        vy: -0.025 - Math.random() * 0.055,
        size: Math.max(2, this.layout.grid.cellSize * (0.08 + Math.random() * 0.1)),
        colour: layer.colour,
        startedAt,
        duration: 300 + Math.random() * 90
      });
    }
    const limit = this.trenchEffectLimits().brushParticles;
    if (this.brushParticles.length > limit) this.brushParticles.splice(0, this.brushParticles.length - limit);
    this.recordEffectHighWater();
    this.scheduleEffectFrame();
  }

  spawnDepositedClump(x, y, soilColours, options = {}) {
    const velocity = options.velocity || null;
    const launchSpeed = velocity ? Math.hypot(velocity.x, velocity.y) * this.layout.grid.cellSize : 0;
    const directionX = launchSpeed ? velocity.x / Math.hypot(velocity.x, velocity.y) : 0;
    const directionY = launchSpeed ? velocity.y / Math.hypot(velocity.x, velocity.y) : 0;
    const weight = Math.max(0.25, Number(options.clumpWeight) || 1);
    const deceleration = launchSpeed
      ? (this.config.trench.clumpDecelerationCellsPerSecondSquared || 20) * this.layout.grid.cellSize * weight
      : 0;
    const motionDuration = deceleration ? launchSpeed / deceleration * 1000 : 0;
    this.depositedClumps.push({
      x,
      y,
      soilColours,
      size: this.scoopClumpSize(),
      startedAt: millis(),
      launchSpeed,
      directionX,
      directionY,
      deceleration,
      motionDuration,
      clumpWeight: weight,
      holdDuration: 900,
      fadeDuration: 350
    });
    const limit = this.trenchEffectLimits().clumps;
    if (this.depositedClumps.length > limit) this.depositedClumps.splice(0, this.depositedClumps.length - limit);
    this.recordEffectHighWater();
    this.scheduleEffectFrame();
  }

  drawToolPreview() {
    if (!this.pointer || (this.pointer.source === "touch" && !this.pointer.pressed)) return;
    if (this.revealedArtefactAtCanvas(this.pointer.x, this.pointer.y)) return;
    const cell = this.cellAt(this.pointer.x, this.pointer.y);
    if (!cell) return;
    const toolRadius = this.tool === "scoop" ? this.activeTrench.scoopRadius : this.activeTrench.brushRadius;
    const radius = this.layout.grid.cellSize * toolRadius;
    const dotCount = this.tool === "scoop" ? 34 : 20;
    noStroke();
    fill(this.tool === "scoop" ? "#f4b942" : "#e8f4e9");
    for (let index = 0; index < dotCount; index += 1) {
      const angle = (TWO_PI * index) / dotCount;
      const x = this.pointer.x + Math.cos(angle) * radius;
      const y = this.pointer.y + Math.sin(angle) * radius;
      if (this.pointIn(this.layout.grid, x, y)) circle(x, y, Math.max(1.8, this.layout.grid.cellSize * 0.08));
    }
  }

  drawInventory(trench, inventory) {
    const collected = trench.artefacts.filter((artefact) => artefact.exposure === "collected");
    if (inventory.width < 48) return;
    fill("#fff9e9");
    textAlign(LEFT, TOP);
    textStyle(BOLD);
    textSize(Math.max(8, Math.min(12, inventory.height * 0.29)));
    text(`FINDS ${collected.length}/${trench.artefacts.length}`, inventory.x, inventory.y + 2);
    textStyle(NORMAL);
    const itemSize = Math.max(9, Math.min(15, inventory.height * 0.35));
    const itemGap = Math.max(itemSize + 4, inventory.width / Math.max(1, Math.min(3, collected.length)));
    collected.slice(0, 3).forEach((artefact, index) => {
      const itemX = inventory.x + itemSize / 2 + index * itemGap;
      const itemY = inventory.y + inventory.height - itemSize / 2 - 1;
      this.renderer.artefact(artefact, itemX, itemY, itemSize, { collected: true });
      if (inventory.width >= 150) {
        fill("#c9d9d8");
        textAlign(CENTER, TOP);
        textSize(7);
        text(artefact.label.split(" ")[0], itemX, inventory.y + inventory.height + 1);
      }
    });
  }

  drawMessage() {
    if (!this.message) return;
    const messageY = this.layout.header?.statusY ?? Math.max(60, this.layout.grid.y - 9);
    fill(this.messageTone === "warning" ? "#ffd889" : "#d9eee2");
    textAlign(LEFT, CENTER);
    textSize(Math.max(9, width * 0.015));
    text(this.message, 16, messageY);
  }

  hitMapTile(x, y) {
    return this.mapTiles.find((tile) =>
      Math.abs((x - tile.x) / (tile.width / 2)) + Math.abs((y - tile.y) / (tile.height / 2)) <= 1
    );
  }

  pointIn(bounds, x, y) {
    return x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height;
  }

  pointInEllipse(bounds, x, y) {
    const radiusX = bounds.width / 2;
    const radiusY = bounds.height / 2;
    if (radiusX <= 0 || radiusY <= 0) return false;
    const centerX = bounds.x + radiusX;
    const centerY = bounds.y + radiusY;
    return ((x - centerX) / radiusX) ** 2 + ((y - centerY) / radiusY) ** 2 <= 1;
  }

  cleaningNormalisedPoint(x, y, itemBounds = this.layout.cleaningItemBounds) {
    if (!itemBounds) return null;
    return {
      x: (x - (itemBounds.x + itemBounds.width / 2)) / itemBounds.size,
      y: (y - (itemBounds.y + itemBounds.height / 2)) / itemBounds.size
    };
  }

  cellAt(x, y) {
    const grid = this.layout.grid;
    if (!this.pointIn(grid, x, y)) return null;
    return {
      x: Math.floor((x - grid.x) / grid.cellSize),
      y: Math.floor((y - grid.y) / grid.cellSize)
    };
  }

  toolCenterAt(x, y) {
    const grid = this.layout.grid;
    if (!this.pointIn(grid, x, y)) return null;
    return {
      x: (x - grid.x) / grid.cellSize - 0.5,
      y: (y - grid.y) / grid.cellSize - 0.5
    };
  }

  interactionNow() {
    if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
    if (typeof millis === "function") return millis();
    return Date.now();
  }

  recordScoopPointerSample(action, x, y, time = this.interactionNow()) {
    if (action?.type !== "scoop") return;
    action.velocitySamples ||= [];
    action.velocitySamples.push({ x, y, time });
    const windowMs = this.config.trench.shovelSwipeSampleWindowMs || 120;
    const cutoff = time - windowMs;
    while (action.velocitySamples.length > 1 && action.velocitySamples[0].time < cutoff) action.velocitySamples.shift();
    if (action.velocitySamples.length > 8) action.velocitySamples.splice(0, action.velocitySamples.length - 8);
  }

  scoopReleaseVelocity(action, x, y, time = this.interactionNow()) {
    if (action?.type !== "scoop" || !this.layout.grid?.cellSize) return null;
    this.recordScoopPointerSample(action, x, y, time);
    const samples = action.velocitySamples || [];
    if (samples.length < 2) return null;
    const latest = samples[samples.length - 1];
    let earliest = samples[0];
    for (let index = samples.length - 2; index >= 0; index -= 1) {
      if (latest.time - samples[index].time >= 24) {
        earliest = samples[index];
        break;
      }
    }
    const elapsedSeconds = (latest.time - earliest.time) / 1000;
    if (elapsedSeconds <= 0) return null;
    let velocityX = (latest.x - earliest.x) / this.layout.grid.cellSize / elapsedSeconds;
    let velocityY = (latest.y - earliest.y) / this.layout.grid.cellSize / elapsedSeconds;
    const speed = Math.hypot(velocityX, velocityY);
    const minimum = this.config.trench.shovelSwipeMinSpeedCellsPerSecond || 8;
    if (speed < minimum) return null;
    const maximum = this.config.trench.shovelSwipeMaxSpeedCellsPerSecond || 28;
    if (speed > maximum) {
      velocityX *= maximum / speed;
      velocityY *= maximum / speed;
    }
    return { x: velocityX, y: velocityY, speed: Math.min(speed, maximum) };
  }

  selectTrench(trench) {
    this.activeTrench = trench;
    this.currentScene = "trench";
    this.tool = "brush";
    this.message = "Brush slowly to reveal what is beneath the soil.";
    this.messageTone = "neutral";
    redraw();
  }

  enterCleaningLab() {
    this.currentScene = "cleaning";
    this.pointerAction = null;
    this.cleaningTool = "hand";
    this.cleaningInventoryChooserOpen = false;
    this.message = this.allCollectedArtefacts().length
      ? "Move a dirty pottery sherd or coin into the clean water."
      : "Collect a find at the dig site to begin cleaning.";
    this.messageTone = "neutral";
    redraw();
  }

  restoreCleaningDrag(action = this.pointerAction) {
    if (action?.type === "cleaning-item") action.artefact.cleaning.location = action.originLocation;
  }

  startCleaningItemDrag(artefact, originLocation, x, y) {
    artefact.cleaning.location = "dragging";
    const aperture = this.layout.bucketDunkAperture || this.layout.bucketWater;
    const apertureCenterY = aperture ? aperture.y + aperture.height / 2 : Infinity;
    const dunkPhase = originLocation === "bucket"
      ? "immersed"
      : aperture && !this.pointInEllipse(aperture, x, y) && y < apertureCenterY
        ? "armed"
        : "unarmed";
    this.pointerAction = {
      type: "cleaning-item",
      artefact,
      originLocation,
      x,
      y,
      rawX: x,
      rawY: y,
      lastRawPoint: { x, y },
      dunkPhase,
      displaySize: this.cleaningItemBaseSize() * 1.08
    };
    this.updateCleaningDragPosition(this.pointerAction, x, y);
    this.message = originLocation === "inventory"
      ? "Hold the find and dunk it through the water, or release it into the bucket."
      : originLocation === "bucket"
        ? "Use Hand to dunk the find again or place it on the cleaning mat."
        : "Use Hand to move the find between the mat, water, and inventory.";
    this.messageTone = "neutral";
    redraw();
  }

  flipActiveCleaningArtefact() {
    const artefact = this.activeCleaningArtefact();
    if (artefact && this.cleaningModel.flip(artefact)) {
      this.message = `${artefact.cleaning.activeFace === "front" ? "Front" : "Back"} face turned upwards.`;
      this.messageTone = "neutral";
      return true;
    }
    this.message = "Place a wet find on the mat before flipping it.";
    this.messageTone = "warning";
    return false;
  }

  cleaningDraggedItemBounds(action = this.pointerAction) {
    if (action?.type !== "cleaning-item") return null;
    const size = action.displaySize || this.cleaningItemBaseSize() * 1.08;
    return {
      x: action.x - size * 0.58,
      y: action.y - size * 0.62,
      width: size * 1.16,
      height: size * 1.24,
      size,
      location: "dragging",
      artefact: action.artefact
    };
  }

  updateCleaningDragPosition(action, rawX, rawY) {
    if (action?.type !== "cleaning-item") return;
    action.rawX = rawX;
    action.rawY = rawY;
    action.x = rawX;
    action.y = rawY;
    if (action.dunkPhase !== "immersed" || !this.layout.bucketGeometry) return;
    const item = this.cleaningDraggedItemBounds(action);
    const bottomInset = Math.max(3, item.size * 0.03);
    const maximumY = this.layout.bucketGeometry.bodyBottom - item.size * 0.62 - bottomInset;
    action.y = Math.min(rawY, maximumY);
  }

  segmentEllipseCrossings(bounds, start, end) {
    if (!bounds || !start || !end) return [];
    const radiusX = bounds.width / 2;
    const radiusY = bounds.height / 2;
    if (radiusX <= 0 || radiusY <= 0) return [];
    const centerX = bounds.x + radiusX;
    const centerY = bounds.y + radiusY;
    const startX = (start.x - centerX) / radiusX;
    const startY = (start.y - centerY) / radiusY;
    const deltaX = (end.x - start.x) / radiusX;
    const deltaY = (end.y - start.y) / radiusY;
    const a = deltaX * deltaX + deltaY * deltaY;
    if (a <= 1e-10) return [];
    const b = 2 * (startX * deltaX + startY * deltaY);
    const c = startX * startX + startY * startY - 1;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return [];
    const root = Math.sqrt(discriminant);
    const candidates = [(-b - root) / (2 * a), (-b + root) / (2 * a)]
      .filter((value, index, values) => value > 1e-7 && value <= 1 && (index === 0 || Math.abs(value - values[0]) > 1e-7))
      .sort((first, second) => first - second);
    return candidates.map((amount) => {
      const before = Math.max(0, amount - 1e-5);
      const after = Math.min(1, amount + 1e-5);
      const beforePoint = {
        x: start.x + (end.x - start.x) * before,
        y: start.y + (end.y - start.y) * before
      };
      const afterPoint = {
        x: start.x + (end.x - start.x) * after,
        y: start.y + (end.y - start.y) * after
      };
      return {
        amount,
        x: start.x + (end.x - start.x) * amount,
        y: start.y + (end.y - start.y) * amount,
        entering: !this.pointInEllipse(bounds, beforePoint.x, beforePoint.y)
          && this.pointInEllipse(bounds, afterPoint.x, afterPoint.y)
      };
    });
  }

  handleHandwashResult(result, action) {
    if (!result) return;
    if (result.affectedSpots?.length) {
      this.spawnCleaningDirtParticles(result.affectedSpots, this.cleaningDraggedItemBounds(action));
    }
    if (result.complete) {
      this.cleaningTool = "hand";
      this.message = "Both faces are clean. Return the find to the inventory tray.";
    } else if (result.faceComplete) {
      this.message = "This face is clean. Place the find on the mat and flip it.";
    } else if (result.changed) {
      this.message = "Keep dunking this face through the water to handwash it.";
    }
    if (result.changed) this.messageTone = "neutral";
  }

  advanceCleaningDunk(action, start, end) {
    const aperture = this.layout.bucketDunkAperture || this.layout.bucketWater;
    if (!aperture || action.artefact.cleaning.status === "ready-to-return") return;
    const centerY = aperture.y + aperture.height / 2;
    const movingDown = end.y > start.y;
    const verticalMotion = Math.abs((end.y - start.y) / Math.max(1, aperture.height))
      >= Math.abs((end.x - start.x) / Math.max(1, aperture.width));
    const crossings = this.segmentEllipseCrossings(aperture, start, end);

    crossings.forEach((crossing) => {
      const upperBoundary = crossing.y <= centerY + 1e-5;
      if (crossing.entering) {
        if (upperBoundary && movingDown && verticalMotion && action.dunkPhase === "armed") {
          action.dunkPhase = "immersed";
          if (this.cleaningModel.dampen(action.artefact)) {
            this.spawnCleaningWaterEffects();
            this.message = "The find is wet. Lift it back through the opening to complete a handwash dunk.";
            this.messageTone = "neutral";
          }
        } else if (action.dunkPhase !== "immersed") {
          action.dunkPhase = "unarmed";
        }
      } else if (action.dunkPhase === "immersed" && upperBoundary && !movingDown && verticalMotion) {
        action.dunkPhase = "armed";
        const result = this.cleaningModel.handwashDunk(action.artefact, action.artefact.cleaning.activeFace);
        this.handleHandwashResult(result, action);
      } else if (action.dunkPhase === "immersed" && !upperBoundary && movingDown && verticalMotion) {
        // Keep a valid dunk immersed when the raw pointer overshoots below the opening.
      } else {
        action.dunkPhase = "unarmed";
      }
    });

    const endsInside = this.pointInEllipse(aperture, end.x, end.y);
    if (action.dunkPhase !== "immersed" && !endsInside && end.y < centerY) action.dunkPhase = "armed";
  }

  cleaningPointerStart(x, y) {
    if (this.pointIn(this.layout.labBackButton, x, y)) {
      this.restoreCleaningDrag();
      this.pointerAction = null;
      this.cleaningInventoryChooserOpen = false;
      this.currentScene = "site";
      this.cleaningWaterDrops.length = 0;
      this.cleaningRipples.length = 0;
      this.cleaningDirtParticles.length = 0;
      this.message = "Choose a trench or return to the finds lab.";
      this.messageTone = "neutral";
      redraw();
      return;
    }
    if (this.cleaningInventoryChooserOpen) {
      const option = (this.layout.inventoryViewOptions || []).find((entry) => this.pointIn(entry.bounds, x, y));
      if (option) {
        this.cleaningInventoryView = option.view;
        this.cleaningInventoryPage = 0;
        this.message = `${this.cleaningInventoryViewLabel()} inventory view selected.`;
        this.messageTone = "neutral";
      }
      this.cleaningInventoryChooserOpen = false;
      redraw();
      return;
    }
    if (this.layout.inventoryViewButton && this.pointIn(this.layout.inventoryViewButton, x, y)) {
      this.cleaningInventoryChooserOpen = true;
      redraw();
      return;
    }
    if (this.layout.bucketModeButton && this.pointIn(this.layout.bucketModeButton, x, y)) {
      this.bucketOcclusionMode = this.bucketOcclusionMode === "obscured" ? "visible" : "obscured";
      this.message = this.bucketOcclusionMode === "obscured"
        ? "Water B hides the submerged part behind the bucket front."
        : "Water A keeps the immersed find fully visible.";
      this.messageTone = "neutral";
      redraw();
      return;
    }
    if (this.layout.inventoryPreviousButton && this.pointIn(this.layout.inventoryPreviousButton, x, y)) {
      this.cleaningInventoryPage = Math.max(0, this.cleaningInventoryPage - 1);
      redraw();
      return;
    }
    if (this.layout.inventoryNextButton && this.pointIn(this.layout.inventoryNextButton, x, y)) {
      this.cleaningInventoryPage += 1;
      redraw();
      return;
    }
    if (this.layout.handButton && this.pointIn(this.layout.handButton, x, y)) {
      this.cleaningTool = "hand";
      this.message = "Hand selected. Move or dunk the artefact without scrubbing it.";
      this.messageTone = "neutral";
      redraw();
      return;
    }
    if (this.pointIn(this.layout.toothbrushButton, x, y)) {
      this.cleaningTool = "toothbrush";
      this.message = "Toothbrush selected for robust finds.";
      this.messageTone = "neutral";
      redraw();
      return;
    }
    if (this.pointIn(this.layout.fineBrushButton, x, y)) {
      this.cleaningTool = "fine-brush";
      this.message = "Fine paintbrush selected for fragile or delicate finds.";
      this.messageTone = "neutral";
      redraw();
      return;
    }
    if (this.pointIn(this.layout.flipButton, x, y)
      || (this.layout.contextFlipButton && this.pointIn(this.layout.contextFlipButton, x, y))) {
      this.flipActiveCleaningArtefact();
      redraw();
      return;
    }

    const slot = (this.layout.inventorySlots || []).find((entry) => this.pointIn(entry.bounds, x, y));
    if (slot) {
      const artefact = slot.artefact;
      if (!artefact.cleanable) {
        this.message = "Cleaning is not yet available for this type of find.";
        this.messageTone = "warning";
        redraw();
        return;
      }
      const state = this.cleaningModel.ensureState(artefact);
      if (["ready-to-identify", "awaiting-specialist"].includes(state.status)) {
        this.message = state.status === "awaiting-specialist"
          ? "This coin is waiting for specialist treatment."
          : "This find is clean and ready for identification.";
        this.messageTone = "neutral";
        redraw();
        return;
      }
      const active = this.activeCleaningArtefact();
      if (active && active !== artefact) {
        this.message = "Finish or return the find already on the cleaning bench first.";
        this.messageTone = "warning";
        redraw();
        return;
      }
      this.cleaningTool = "hand";
      this.startCleaningItemDrag(artefact, "inventory", x, y);
      return;
    }

    const item = this.layout.cleaningItemBounds;
    if (!item || !this.pointIn(item, x, y)) return;
    const artefact = item.artefact;
    if (item.location === "bucket") {
      if (this.cleaningTool !== "hand") {
        this.message = "Select Hand to lift the find from the bucket.";
        this.messageTone = "warning";
        redraw();
        return;
      }
      this.startCleaningItemDrag(artefact, "bucket", x, y);
      return;
    }
    if (item.location !== "mat") return;
    if (this.cleaningTool === "hand") {
      this.startCleaningItemDrag(artefact, "mat", x, y);
      return;
    }
    if (!this.cleaningModel.canUseTool(artefact, this.cleaningTool)) {
      const brushName = artefact.cleaningTool === "toothbrush" ? "toothbrush" : "fine paintbrush";
      this.message = `${artefact.label} is ${artefact.robustness.toLowerCase()}; use the ${brushName}.`;
      this.messageTone = "warning";
      redraw();
      return;
    }
    const point = this.cleaningNormalisedPoint(x, y, item);
    const contactedSpots = new Set();
    this.pointerAction = {
      type: "cleaning-brush",
      artefact,
      face: artefact.cleaning.activeFace,
      tool: this.cleaningTool,
      lastPoint: point,
      contactedSpots
    };
    const result = this.cleaningModel.clearAlongSegment(
      artefact,
      artefact.cleaning.activeFace,
      point,
      point,
      this.cleaningTool,
      contactedSpots
    );
    this.handleCleaningBrushResult(result, item);
    redraw();
  }

  cleaningPointerMove(x, y) {
    const action = this.pointerAction;
    if (!action) {
      this.requestFrame();
      return;
    }
    if (action.type === "cleaning-item") {
      const previous = action.lastRawPoint || { x: action.rawX ?? action.x, y: action.rawY ?? action.y };
      this.advanceCleaningDunk(action, previous, { x, y });
      this.updateCleaningDragPosition(action, x, y);
      action.lastRawPoint = { x, y };
      this.requestFrame();
      return;
    }
    if (action.type !== "cleaning-brush") return;
    const current = this.cleaningNormalisedPoint(x, y, this.layout.cleaningItemBounds);
    if (!current) return;
    const result = this.cleaningModel.clearAlongSegment(
      action.artefact,
      action.face,
      action.lastPoint,
      current,
      action.tool,
      action.contactedSpots
    );
    action.lastPoint = current;
    this.handleCleaningBrushResult(result, this.layout.cleaningItemBounds);
    this.requestFrame();
  }

  cleaningPointerEnd(x, y) {
    const action = this.pointerAction;
    if (!action) {
      this.requestFrame();
      return;
    }
    if (action.type === "cleaning-brush") {
      this.pointerAction = null;
      this.requestFrame();
      return;
    }
    if (action.type !== "cleaning-item") return;
    const artefact = action.artefact;
    if (!action.lastRawPoint || action.lastRawPoint.x !== x || action.lastRawPoint.y !== y) {
      const previous = action.lastRawPoint || { x: action.rawX ?? action.x, y: action.rawY ?? action.y };
      this.advanceCleaningDunk(action, previous, { x, y });
      this.updateCleaningDragPosition(action, x, y);
      action.lastRawPoint = { x, y };
    }
    let accepted = false;
    if (artefact.cleaning.status === "ready-to-return" && this.pointIn(this.layout.inventory, x, y)) {
      accepted = this.cleaningModel.returnToInventory(artefact);
      if (accepted) {
        this.message = artefact.cleaning.status === "awaiting-specialist"
          ? `${artefact.label} has completed washing and now needs specialist treatment.`
          : `${artefact.label} is clean and ready for identification.`;
      }
    } else if (["dirty", "wet"].includes(artefact.cleaning.status)
      && action.dunkPhase === "immersed") {
      accepted = this.cleaningModel.immerse(artefact);
      this.message = accepted ? "The find is parked safely in the clean water." : "This find cannot be submerged right now.";
    } else if (["dirty", "wet"].includes(artefact.cleaning.status)
      && this.pointInEllipse(this.layout.bucketDropTarget || this.layout.bucketWater, x, y)) {
      accepted = this.cleaningModel.immerse(artefact);
      if (accepted) this.spawnCleaningWaterEffects();
      this.message = accepted ? "The find is wet. Move it onto the cleaning mat." : "This find cannot be submerged right now.";
    } else if (["wet", "ready-to-return"].includes(artefact.cleaning.status)
      && this.pointIn(this.layout.matSurface || this.layout.mat, x, y)) {
      accepted = this.cleaningModel.placeOnMat(artefact);
      this.message = accepted
        ? "Select Hand, Toothbrush, or Fine paintbrush for the next step."
        : "Wet the find before placing it on the mat.";
    }

    if (!accepted) {
      artefact.cleaning.location = action.originLocation;
      this.message = "Release the find over the bucket, cleaning surface, or inventory when it is ready.";
      this.messageTone = "warning";
    } else {
      this.messageTone = "neutral";
    }
    this.pointerAction = null;
    this.requestFrame();
  }

  pointerHover(x, y) {
    this.pointer = { x, y, source: "mouse", pressed: false };
    this.requestFrame();
  }

  pointerLeave() {
    if (this.pointer?.source !== "mouse" || this.pointer?.pressed) return;
    this.pointer = null;
    this.requestFrame();
  }

  revealedArtefactAtCanvas(x, y) {
    if (this.currentScene !== "trench" || !this.activeTrench?.artefacts || !this.layout.grid) return null;
    const cell = this.cellAt(x, y);
    if (!cell) return null;
    return this.activeTrench.artefacts.find((artefact) =>
      artefact.exposure === "revealed"
      && artefact.footprint.some((footprintCell) => footprintCell.x === cell.x && footprintCell.y === cell.y)
    ) || null;
  }

  customPointerTool() {
    if (this.pointerAction?.type === "brush") return "brush";
    if (this.pointerAction?.type === "scoop") return "scoop";
    if (this.pointerAction?.type === "cleaning-brush") return this.pointerAction.tool;
    if (this.pointerAction?.type === "cleaning-item") return "hand";
    if (this.pointer?.feedbackTool) return this.pointer.feedbackTool;
    if (this.revealedArtefactAtCanvas(this.pointer?.x, this.pointer?.y)) return "hand";
    if (this.currentScene === "trench") return this.tool;
    if (this.currentScene === "cleaning") return this.cleaningTool;
    return "hand";
  }

  drawCustomPointer() {
    const now = this.interactionNow();
    if (this.tapFeedback) {
      if (now - this.tapFeedback.startedAt < this.tapFeedback.duration) {
        this.renderer.drawToolCursor("hand", this.tapFeedback.x, this.tapFeedback.y, false, "pointing");
        this.scheduleEffectFrame();
      } else {
        this.tapFeedback = null;
      }
    }
    if (!this.pointer || this.pointer.source !== "mouse") return;
    if (this.pointer.x < 0 || this.pointer.x > width || this.pointer.y < 0 || this.pointer.y > height) return;
    const grabbing = Boolean(this.pointer.pressed && (
      this.pointerAction?.type === "cleaning-item" || this.pointerAction?.type === "scoop"
    ));
    const pointerTool = this.customPointerTool();
    const pose = pointerTool === "hand"
      ? grabbing
        ? "closed"
        : this.pointer.pressed || this.pointer.feedbackPose === "pointing"
          ? "pointing"
          : "open"
      : null;
    this.renderer.drawToolCursor(pointerTool, this.pointer.x, this.pointer.y, grabbing, pose);
  }

  pointerStart(x, y, source = "mouse") {
    this.pointer = { x, y, source, pressed: true, feedbackTool: "hand", feedbackPose: "pointing" };
    if (source === "touch") {
      this.tapFeedback = { x, y, startedAt: this.interactionNow(), duration: 180 };
      this.scheduleEffectFrame();
    }
    if (this.currentScene === "site") {
      if (this.layout.labButton && this.pointIn(this.layout.labButton, x, y)) {
        this.enterCleaningLab();
        return;
      }
      const tile = this.hitMapTile(x, y);
      if (tile) this.selectTrench(tile.trench);
      return;
    }
    if (this.currentScene === "cleaning") {
      this.cleaningPointerStart(x, y);
      return;
    }

    if (this.pointIn(this.layout.mapButton, x, y)) {
      this.currentScene = "site";
      this.pointerAction = null;
      // Keep the reusable raster for a possible return to this trench, but
      // release worker-only state that can no longer be presented here.
      this.invalidateTerrainCache();
      this.brushParticles.length = 0;
      this.depositedClumps.length = 0;
      this.message = "Choose a trench to continue exploring.";
      redraw();
      return;
    }
    if (this.pointIn(this.layout.brushButton, x, y)) {
      this.tool = "brush";
      this.message = "Drag over soil carefully.";
      this.messageTone = "neutral";
      redraw();
      return;
    }
    if (this.pointIn(this.layout.scoopButton, x, y)) {
      this.tool = "scoop";
      this.message = "Drag a safe shovel-load outside the trench.";
      this.messageTone = "neutral";
      redraw();
      return;
    }
    if (this.pointIn(this.layout.depthButton, x, y)) {
      this.showDepthDebug = !this.showDepthDebug;
      this.message = this.showDepthDebug ? "Depth debug enabled." : "Depth debug hidden.";
      this.messageTone = "neutral";
      redraw();
      return;
    }
    if (this.layout.performanceButton && this.pointIn(this.layout.performanceButton, x, y)) {
      this.performanceMode = this.performanceMode === "full" ? "lite" : "full";
      this.invalidateTerrainCache({ releaseAmbient: true });
      this.trimEffectsForMode();
      this.message = this.performanceMode === "lite"
        ? "Performance Lite uses simple cells and edge shading."
        : "Performance Full restores smoothed terrain and curved shadows.";
      this.messageTone = "neutral";
      redraw();
      return;
    }
    const disabledTerrainControl = this.performanceMode === "lite" && [
      this.layout.smoothingButton,
      this.layout.pillarButton,
      this.layout.ridgeButton
    ].some((button) => button && this.pointIn(button, x, y));
    if (disabledTerrainControl) {
      this.message = "Switch Performance back to Full to change terrain smoothing options.";
      this.messageTone = "neutral";
      redraw();
      return;
    }
    if (this.pointIn(this.layout.smoothingButton, x, y)) {
      this.terrainSmoothingMode = this.terrainSmoothingMode === "all" ? "focus" : "all";
      this.invalidateTerrainCache();
      this.message = this.terrainSmoothingMode === "all"
        ? "Smoothing A applies to every terrain junction."
        : "Smoothing B focuses on diagonals and small features.";
      this.messageTone = "neutral";
      redraw();
      return;
    }
    if (this.pointIn(this.layout.pillarButton, x, y)) {
      this.pillarRenderMode = this.pillarRenderMode === "round" ? "merge" : "round";
      this.invalidateTerrainCache();
      this.message = this.pillarRenderMode === "round"
        ? "Pillars A keeps small features as rounded islands."
        : "Pillars B visually merges isolated height extrema.";
      this.messageTone = "neutral";
      redraw();
      return;
    }
    if (this.pointIn(this.layout.ridgeButton, x, y)) {
      this.ridgeDirectionMode = this.ridgeDirectionMode === "current" ? "high-cut" : "current";
      this.invalidateTerrainCache();
      this.message = this.ridgeDirectionMode === "high-cut"
        ? "Ridges B cuts rounded edges into shallower terrain."
        : "Ridges A uses the original terrain ownership direction.";
      this.messageTone = "neutral";
      redraw();
      return;
    }

    const cell = this.cellAt(x, y);
    if (!cell) return;
    const collected = this.activeTrench.collectAt(cell.x, cell.y);
    if (collected) {
      this.message = `${collected.label} carefully collected.`;
      this.messageTone = "neutral";
      redraw();
      return;
    }

    if (this.tool === "brush") {
      this.pointer.feedbackTool = null;
      this.pointer.feedbackPose = null;
      this.pointerAction = { type: "brush", lastPoint: { x, y }, travelRemainder: 0 };
      this.applyBrush(this.toolCenterAt(x, y));
    } else {
      this.pointer.feedbackTool = null;
      this.pointer.feedbackPose = null;
      const toolCenter = this.toolCenterAt(x, y);
      const scoopCheck = this.activeTrench.canScoop(toolCenter.x, toolCenter.y);
      if (!scoopCheck.allowed) {
        if (scoopCheck.artefact) this.activeTrench.partiallyExpose(scoopCheck.artefact);
        this.message = scoopCheck.reason;
        this.messageTone = scoopCheck.artefact ? "warning" : "neutral";
        redraw();
        return;
      }
      this.pointerAction = {
        type: "scoop",
        center: toolCenter,
        x,
        y,
        soilColours: scoopCheck.soilColours,
        materialIds: scoopCheck.materialIds || [],
        clumpWeight: scoopCheck.clumpWeight || 1,
        velocitySamples: [{ x, y, time: this.interactionNow() }]
      };
      this.message = "Carry the shovel-load out, or flick it aside with a quick swipe.";
      this.messageTone = "neutral";
      redraw();
    }
  }

  pointerMove(x, y, source = "mouse") {
    const previousPointer = this.pointer;
    this.pointer = {
      x,
      y,
      source,
      pressed: true,
      feedbackTool: previousPointer?.feedbackTool,
      feedbackPose: previousPointer?.feedbackPose
    };
    if (this.currentScene === "cleaning") {
      this.cleaningPointerMove(x, y);
      return;
    }
    if (!this.pointerAction) {
      this.requestFrame();
      return;
    }
    if (this.pointerAction.type === "brush") {
      this.advanceBrushPath(x, y);
    } else if (this.pointerAction.type === "scoop") {
      this.pointerAction.x = x;
      this.pointerAction.y = y;
      this.recordScoopPointerSample(this.pointerAction, x, y);
      this.requestFrame();
    }
  }

  pointerEnd(x, y, source = "mouse") {
    this.pointer = { x, y, source, pressed: false };
    if (this.currentScene === "cleaning") {
      this.cleaningPointerEnd(x, y);
      if (source === "touch") this.pointer = null;
      return;
    }
    if (!this.pointerAction) {
      if (source === "touch") this.pointer = null;
      if (this.currentScene === "trench") this.requestFrame();
      return;
    }
    if (this.pointerAction.type === "scoop") {
      const flickVelocity = this.scoopReleaseVelocity(this.pointerAction, x, y);
      if (!this.pointIn(this.layout.grid, x, y) || flickVelocity) {
        const result = this.activeTrench.scoop(this.pointerAction.center.x, this.pointerAction.center.y);
        this.message = result.reason;
        this.messageTone = result.allowed ? "neutral" : "warning";
        if (result.allowed) {
          this.spawnDepositedClump(x, y, result.soilColours || this.pointerAction.soilColours, {
            velocity: flickVelocity,
            clumpWeight: result.clumpWeight || this.pointerAction.clumpWeight
          });
          if (flickVelocity && this.pointIn(this.layout.grid, x, y)) this.message = "Shovel-load flicked aside.";
        }
      } else {
        this.message = "Move the shovel-load outside the trench or use a quicker flick.";
        this.messageTone = "warning";
      }
    }
    this.pointerAction = null;
    if (source === "touch") this.pointer = null;
    this.requestFrame();
  }

  pointerCancel(x, y, source = "mouse") {
    if (this.pointerAction?.type === "cleaning-item") this.restoreCleaningDrag(this.pointerAction);
    this.pointerAction = null;
    this.pointer = source === "touch" ? null : { x, y, source, pressed: false };
    this.messageTone = "neutral";
    this.requestFrame();
  }

  brushTravelThreshold() {
    return this.layout.grid.cellSize * (this.config.trench.brushTravelPerStampCells || 3);
  }

  advanceBrushPath(x, y) {
    const action = this.pointerAction;
    if (action?.type !== "brush") return;
    const currentCenter = this.toolCenterAt(x, y);
    if (!currentCenter) {
      if (action.lastPoint) this.consumeBrushSegment(action.lastPoint, { x, y });
      action.lastPoint = null;
      this.requestFrame();
      return;
    }
    if (!action.lastPoint) {
      action.lastPoint = { x, y };
      this.requestFrame();
      return;
    }
    this.consumeBrushSegment(action.lastPoint, { x, y });
    action.lastPoint = { x, y };
    this.requestFrame();
  }

  consumeBrushSegment(start, end) {
    const action = this.pointerAction;
    const clipped = this.clipSegmentToBounds(start, end, this.layout.grid);
    if (!clipped || action?.type !== "brush") return;
    const dx = clipped.end.x - clipped.start.x;
    const dy = clipped.end.y - clipped.start.y;
    const length = Math.hypot(dx, dy);
    if (length <= 0) return;
    const threshold = this.brushTravelThreshold();
    let travelled = 0;
    let distanceToStamp = threshold - action.travelRemainder;
    while (travelled + distanceToStamp <= length + 1e-7) {
      travelled += distanceToStamp;
      const progress = Math.min(1, travelled / length);
      const stampX = clipped.start.x + dx * progress;
      const stampY = clipped.start.y + dy * progress;
      this.applyBrush(this.toolCenterAt(stampX, stampY), false);
      action.travelRemainder = 0;
      distanceToStamp = threshold;
    }
    action.travelRemainder += Math.max(0, length - travelled);
  }

  clipSegmentToBounds(start, end, bounds) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    let entry = 0;
    let exit = 1;
    const edges = [
      [-dx, start.x - bounds.x],
      [dx, bounds.x + bounds.width - start.x],
      [-dy, start.y - bounds.y],
      [dy, bounds.y + bounds.height - start.y]
    ];
    for (const [direction, distance] of edges) {
      if (Math.abs(direction) < 1e-9) {
        if (distance < 0) return null;
        continue;
      }
      const ratio = distance / direction;
      if (direction < 0) entry = Math.max(entry, ratio);
      else exit = Math.min(exit, ratio);
      if (entry > exit) return null;
    }
    return {
      start: { x: start.x + dx * entry, y: start.y + dy * entry },
      end: { x: start.x + dx * exit, y: start.y + dy * exit }
    };
  }

  applyBrush(center, requestDraw = true) {
    if (!center) return;
    const result = this.activeTrench.brushAt(center.x, center.y);
    if (result.changed) {
      result.removedLayers.forEach((removed) => this.spawnBrushParticles(removed, removed.layer));
      this.message = "Careful brushing exposes another part of the profile.";
      this.messageTone = "neutral";
      if (requestDraw) this.requestFrame();
      return true;
    }
    return false;
  }
};
