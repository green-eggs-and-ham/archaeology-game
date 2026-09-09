(function registerTrenchScene(root) {
  "use strict";

  const OWNED_STATE = [
    "tool",
    "activeTrench",
    "profileCache",
    "brushParticles",
    "depositedClumps",
    "collectionFlights",
    "shovelAttemptHistory",
    "coachedArtefactIds",
    "artefactCoaches",
    "activeArtefactCoach"
  ];

  const STATE_DEFAULTS = {
    tool: () => "scoop",
    activeTrench: () => null,
    profileCache: () => null,
    brushParticles: () => [],
    depositedClumps: () => [],
    collectionFlights: () => [],
    shovelAttemptHistory: () => new Map(),
    coachedArtefactIds: () => new Set(),
    artefactCoaches: () => new Map(),
    activeArtefactCoach: () => null
  };

  class TrenchScene {
    constructor(context) {
      if (!context) throw new Error("TrenchScene requires an application context.");
      this.context = context;
      this.terrainPipeline = new root.TerrainPipeline(context);
      context.terrainPipeline = this.terrainPipeline;
      this.state = {};
      OWNED_STATE.forEach((name) => {
        this.state[name] = context[name] === undefined ? STATE_DEFAULTS[name]() : context[name];
        Object.defineProperty(this, name, {
          configurable: false,
          get: () => this.state[name],
          set: (value) => { this.state[name] = value; }
        });
        Object.defineProperty(context, name, {
          configurable: true,
          get: () => this.state[name],
          set: (value) => { this.state[name] = value; }
        });
      });
    }

    enter(trench) {
      return this.context.selectTrench(trench);
    }

    leave() {
      this.context.pointerAction = null;
      this.collectionFlights.length = 0;
      this.terrainPipeline.invalidateTerrainCache();
      this.brushParticles.length = 0;
      this.depositedClumps.length = 0;
    }

    draw() {
      return this.context.drawTrench();
    }

    handleResize() {
      this.terrainPipeline.releaseCanvasBuffer(this.profileCache);
      this.profileCache = null;
      this.collectionFlights.length = 0;
      this.brushParticles.length = 0;
      this.depositedClumps.length = 0;
    }

    pointerStart(x, y, source) {
      return this.context.trenchPointerStart(x, y, source);
    }

    pointerMove(x, y, source) {
      return this.context.trenchPointerMove(x, y, source);
    }

    pointerEnd(x, y, source) {
      return this.context.trenchPointerEnd(x, y, source);
    }

    pointerCancel(x, y, source) {
      return this.context.trenchPointerCancel(x, y, source);
    }

    cursorPresentation(pointer = this.context.pointer) {
      if (this.context.revealedArtefactAtCanvas(pointer?.x, pointer?.y)) {
        return { tool: "hand", variant: "idle", pose: "open" };
      }
      return { tool: this.tool, variant: "idle", pose: null };
    }

  trenchLayout() {
    const margin = Math.max(12, width * 0.025);
    const isPortrait = height > width;
    const primaryButtonHeight = Math.max(32, Math.min(38, height * 0.095));
    const titleSize = Math.max(12, Math.min(18, width * 0.025));
    const guidanceSize = Math.max(9, Math.min(13, width * 0.015));
    const titleY = 16 + primaryButtonHeight + 5;
    const guidanceY = titleY + titleSize * 1.2 + 3;
    const statusY = guidanceY + guidanceSize * 1.35 + 3;
    const headerHeight = statusY + Math.max(9, Math.min(13, width * 0.015)) * 1.25 + 5;
    const contentY = headerHeight + 6;

    if (isPortrait) {
      const profileHeight = Math.max(78, Math.min(96, width * 0.22));
      const availableGridHeight = height - contentY - margin - profileHeight - 8;
      const cellSize = Math.max(8, Math.min((width - margin * 2) / this.activeTrench.columns, availableGridHeight / this.activeTrench.rows));
      const gridWidth = cellSize * this.activeTrench.columns;
      const gridHeight = cellSize * this.activeTrench.rows;
      const profileY = contentY + gridHeight + 8;
      return {
        headerHeight,
        isPortrait,
        grid: { x: (width - gridWidth) / 2, y: contentY, width: gridWidth, height: gridHeight, cellSize },
        profile: { x: margin, y: profileY, width: width - margin * 2, height: Math.max(1, Math.min(profileHeight, height - profileY - margin)) }
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
    this.updateArtefactCoachCompletion();
    this.drawTrenchHeader(trench);
    this.drawExcavationGrid(trench, this.layout.grid);
    this.drawCachedProfile(trench, this.layout.profile);
    this.drawToolPreview();
    this.drawMessage();
    this.drawExcavationEffects();
    this.drawCarriedScoop();
    this.drawCollectionFlights();
    this.drawArtefactCoachPopup();
  }

  drawTrenchHeader(trench) {
    const buttonHeight = Math.max(32, Math.min(38, height * 0.095));
    const portrait = this.layout.isPortrait;
    const margin = 12;
    const gap = portrait ? 5 : 6;
    if (portrait) {
      const buttonWidth = (width - margin * 2 - gap * 3) / 4;
      this.layout.mapButton = { x: margin, y: 11, width: buttonWidth, height: buttonHeight };
      this.layout.brushButton = { x: margin + buttonWidth + gap, y: 11, width: buttonWidth, height: buttonHeight };
      this.layout.scoopButton = { x: margin + (buttonWidth + gap) * 2, y: 11, width: buttonWidth, height: buttonHeight };
      this.layout.findsLabButton = { x: margin + (buttonWidth + gap) * 3, y: 11, width: buttonWidth, height: buttonHeight };
    } else {
      const mapWidth = Math.max(70, Math.min(140, width * 0.14));
      const toolWidth = Math.max(62, Math.min(110, width * 0.11));
      const labWidth = Math.max(82, Math.min(138, width * 0.14));
      this.layout.mapButton = { x: margin, y: 11, width: mapWidth, height: buttonHeight };
      this.layout.brushButton = { x: this.layout.mapButton.x + mapWidth + gap, y: 11, width: toolWidth, height: buttonHeight };
      this.layout.scoopButton = { x: this.layout.brushButton.x + toolWidth + gap, y: 11, width: toolWidth, height: buttonHeight };
      this.layout.findsLabButton = { x: this.layout.scoopButton.x + toolWidth + gap, y: 11, width: labWidth, height: buttonHeight };
    }
    const buttonText = portrait ? { minimumSize: 8, maximumSize: 11 } : {};
    this.renderer.button(this.layout.mapButton, "Site map", false, portrait, false, buttonText);
    this.renderer.button(this.layout.brushButton, "Brush", this.tool === "brush", portrait, false, { ...buttonText, icon: "brush" });
    this.renderer.button(this.layout.scoopButton, "Shovel", this.tool === "scoop", portrait, false, { ...buttonText, icon: "scoop" });
    this.renderer.button(this.layout.findsLabButton, "Finds lab", false, portrait, false, {
      ...buttonText,
      badgeCount: this.pendingCleaningCount()
    });

    if (this.activeArtefactCoach?.promptVisible && this.activeArtefactCoach.trenchId === trench.id) {
      push();
      noFill();
      stroke("#ffd35a");
      strokeWeight(3);
      rect(
        this.layout.brushButton.x - 3,
        this.layout.brushButton.y - 3,
        this.layout.brushButton.width + 6,
        this.layout.brushButton.height + 6,
        10
      );
      pop();
    }

    const titleSize = Math.max(12, Math.min(18, width * 0.025));
    const guidanceSize = Math.max(9, Math.min(13, width * 0.015));
    const titleY = 16 + buttonHeight + 5;
    const guidanceY = titleY + titleSize * 1.2 + 3;
    const statusY = guidanceY + guidanceSize * 1.45 + 8;
    this.layout.header = { titleY, guidanceY, statusY };

    const inventory = portrait
      ? {
          x: Math.max(width * 0.55, 176),
          y: titleY - 1,
          width: width - Math.max(width * 0.55, 176) - 12,
          height: Math.max(28, statusY - titleY - 2)
        }
      : {
          x: this.layout.findsLabButton.x + this.layout.findsLabButton.width + 8,
          y: 11,
          width: width - (this.layout.findsLabButton.x + this.layout.findsLabButton.width + 20),
          height: buttonHeight
        };
    this.drawInventory(trench, inventory);

    fill("#fff9e9");
    textAlign(LEFT, TOP);
    textStyle(BOLD);
    textSize(titleSize);
    text(`${trench.label} trench`, 16, titleY);
    textStyle(NORMAL);
    fill("#c9d9d8");
    textSize(guidanceSize);
    text(
      this.tool === "brush"
        ? portrait ? "Drag carefully over soil." : "Drag over soil carefully."
        : portrait ? "Drag or flick a shovel-load out." : "Drag a shovel-load out, or flick it aside.",
      16,
      guidanceY,
      portrait ? Math.max(80, inventory.x - 24) : width - 32,
      guidanceSize * 1.4
    );
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
    this.drawArtefactCoachHighlight(trench, grid);
  }

  drawExcavationGridBorder(grid) {
    noFill();
    stroke("#f5e6bb");
    strokeWeight(2);
    rect(grid.x, grid.y, grid.width, grid.height, 3);
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
    const titleHeight = this.layout.isPortrait ? Math.max(14, Math.min(18, profile.height * 0.2)) : Math.max(30, Math.min(42, profile.height * 0.22));
    const keyWidth = Math.max(this.layout.isPortrait ? 82 : 94, profile.width * (this.layout.isPortrait ? 0.3 : 0.38));
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
    textSize(this.layout.isPortrait ? Math.max(8, Math.min(11, titleHeight * 0.64)) : Math.max(12, Math.min(24, titleHeight * 0.64)));
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
      const particleSize = particle.size * (1 - progress * 0.35);
      const particleX = particle.x + particle.vx * (now - particle.startedAt);
      const particleY = particle.y + particle.vy * (now - particle.startedAt) + progress * progress * 7;
      noStroke();
      fill(45, 31, 22, alpha * 0.45);
      circle(
        particleX + Math.max(0.8, particleSize * 0.18),
        particleY + Math.max(0.9, particleSize * 0.22),
        particleSize * 1.08
      );
      const particleColour = color(particle.colour);
      fill(red(particleColour), green(particleColour), blue(particleColour), alpha);
      circle(particleX, particleY, particleSize);
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
      ? (this.config.trench.clumpDecelerationCellsPerSecondSquared || 30) * this.layout.grid.cellSize * weight
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
    this.layout.findInventoryTargets = new Map();
    this.layout.findInventoryOverflowTarget = null;
    if (inventory.width < 48) {
      const fallback = {
        x: inventory.x + Math.max(0, inventory.width) / 2,
        y: inventory.y + inventory.height / 2,
        size: Math.max(8, Math.min(14, inventory.height * 0.42))
      };
      collected.forEach((artefact) => this.layout.findInventoryTargets.set(artefact.id, fallback));
      return;
    }
    fill("#fff9e9");
    textAlign(LEFT, TOP);
    textStyle(BOLD);
    const labelSize = Math.max(8, Math.min(12, inventory.height * 0.29));
    const label = `FINDS ${collected.length}/${trench.artefacts.length}`;
    textSize(labelSize);
    text(label, inventory.x, inventory.y + 2);
    const labelWidth = textWidth(label);
    textStyle(NORMAL);
    if (!collected.length) return;
    const itemSize = Math.max(10, Math.min(17, inventory.height * 0.46));
    const gap = Math.max(3, itemSize * 0.24);
    const startX = inventory.x + labelWidth + gap + itemSize / 2;
    const availableWidth = inventory.x + inventory.width - startX + itemSize / 2;
    const slotCapacity = Math.max(0, Math.floor((availableWidth + gap) / (itemSize + gap)));
    const showOverflow = slotCapacity < collected.length && slotCapacity > 0;
    const iconCapacity = showOverflow ? slotCapacity - 1 : slotCapacity;
    const visible = collected.slice(0, Math.min(6, iconCapacity));
    const itemY = inventory.y + inventory.height / 2 + 1;
    visible.forEach((artefact, index) => {
      const itemX = startX + index * (itemSize + gap);
      this.layout.findInventoryTargets.set(artefact.id, { x: itemX, y: itemY, size: itemSize });
      if (!this.collectionFlightFor(artefact)) {
        this.renderer.artefact(artefact, itemX, itemY, itemSize, { collected: true });
      }
    });
    const hidden = collected.length - visible.length;
    if (hidden > 0 && showOverflow) {
      const overflowX = startX + visible.length * (itemSize + gap);
      this.layout.findInventoryOverflowTarget = { x: overflowX, y: itemY, size: itemSize };
      fill("#c9d9d8");
      textAlign(CENTER, CENTER);
      textStyle(BOLD);
      textSize(Math.max(7, Math.min(10, itemSize * 0.62)));
      text(`+${hidden}`, overflowX, itemY);
      textStyle(NORMAL);
    }
    const fallbackTarget = this.layout.findInventoryOverflowTarget || {
      x: inventory.x + inventory.width - itemSize / 2,
      y: itemY,
      size: itemSize
    };
    collected.forEach((artefact) => {
      if (!this.layout.findInventoryTargets.has(artefact.id)) {
        this.layout.findInventoryTargets.set(artefact.id, fallbackTarget);
      }
    });
  }

  collectionFlightFor(artefact) {
    return (this.collectionFlights || []).find((flight) => flight.artefact === artefact || flight.artefact?.id === artefact?.id) || null;
  }

  startCollectionFlight(artefact) {
    if (!artefact || !this.activeTrench) return;
    this.assignCollectionSequence(artefact);
    this.collectionFlights.push({
      artefact,
      trenchId: this.activeTrench.id,
      startedAt: this.interactionNow(),
      duration: 450
    });
    const limit = Math.max(1, this.activeTrench.artefacts?.length || 6);
    if (this.collectionFlights.length > limit) {
      this.collectionFlights.splice(0, this.collectionFlights.length - limit);
    }
    this.scheduleEffectFrame();
  }

  drawCollectionFlights() {
    if (!this.collectionFlights?.length || !this.activeTrench || !this.layout.grid) return;
    const now = this.interactionNow();
    let active = false;
    let completed = false;
    for (let index = 0; index < this.collectionFlights.length; index += 1) {
      const flight = this.collectionFlights[index];
      if (flight.trenchId !== this.activeTrench.id) continue;
      const target = this.layout.findInventoryTargets?.get(flight.artefact.id)
        || this.layout.findInventoryOverflowTarget;
      if (!target) continue;
      const progress = Math.max(0, Math.min(1, (now - flight.startedAt) / flight.duration));
      const eased = progress * progress * (3 - 2 * progress);
      const sourceX = this.layout.grid.x + (flight.artefact.centerX + 0.5) * this.layout.grid.cellSize;
      const sourceY = this.layout.grid.y + (flight.artefact.centerY + 0.5) * this.layout.grid.cellSize;
      const sourceSize = Math.max(10, this.layout.grid.cellSize * 1.45);
      const x = sourceX + (target.x - sourceX) * eased;
      const y = sourceY + (target.y - sourceY) * eased;
      const size = sourceSize + (target.size - sourceSize) * eased;
      this.renderer.artefact(flight.artefact, x, y, size, { collected: true });
      if (progress < 1) active = true;
      else {
        this.collectionFlights[index] = null;
        completed = true;
      }
    }
    this.compactActive(this.collectionFlights, (flight) => Boolean(flight));
    if (active) this.scheduleEffectFrame();
    else if (completed) this.requestFrame();
  }

  artefactCoachForActiveTrench() {
    const coach = this.activeArtefactCoach;
    if (!coach || !this.activeTrench || coach.trenchId !== this.activeTrench.id) return null;
    return coach;
  }

  updateArtefactCoachCompletion() {
    const coach = this.artefactCoachForActiveTrench();
    if (!coach) return;
    if (["revealed", "collected"].includes(coach.artefact?.exposure)) {
      this.artefactCoaches?.delete(coach.trenchId);
      this.activeArtefactCoach = null;
    }
  }

  recordShovelAttempt(blockingArtefact = null) {
    if (!this.activeTrench) return false;
    this.shovelAttemptHistory ||= new Map();
    this.coachedArtefactIds ||= new Set();
    this.artefactCoaches ||= new Map();
    const trenchKey = this.activeTrench.id || this.activeTrench;
    const eligibleArtefact = blockingArtefact
      && ["hidden", "partial"].includes(blockingArtefact.exposure)
      ? blockingArtefact
      : null;
    const history = this.shovelAttemptHistory.get(trenchKey) || [];
    history.push(eligibleArtefact?.id || null);
    if (history.length > 5) history.splice(0, history.length - 5);
    this.shovelAttemptHistory.set(trenchKey, history);
    if (!eligibleArtefact || this.coachedArtefactIds.has(eligibleArtefact.id)) return false;
    const matches = history.filter((artefactId) => artefactId === eligibleArtefact.id).length;
    if (matches < 3) return false;
    const existing = this.artefactCoaches.get(trenchKey);
    if (existing && !["revealed", "collected"].includes(existing.artefact?.exposure)) return false;
    const coach = {
      trenchId: trenchKey,
      artefactId: eligibleArtefact.id,
      artefact: eligibleArtefact,
      promptVisible: true
    };
    this.coachedArtefactIds.add(eligibleArtefact.id);
    this.artefactCoaches.set(trenchKey, coach);
    this.activeArtefactCoach = coach;
    history.length = 0;
    return true;
  }

  drawArtefactCoachHighlight(trench, grid) {
    const coach = this.artefactCoachForActiveTrench();
    const artefact = coach?.artefact;
    if (!artefact || !["hidden", "partial"].includes(artefact.exposure) || !artefact.footprint?.length) return;
    const minX = Math.min(...artefact.footprint.map((cell) => cell.x));
    const maxX = Math.max(...artefact.footprint.map((cell) => cell.x));
    const minY = Math.min(...artefact.footprint.map((cell) => cell.y));
    const maxY = Math.max(...artefact.footprint.map((cell) => cell.y));
    const x = grid.x + minX * grid.cellSize - 3;
    const y = grid.y + minY * grid.cellSize - 3;
    const highlightWidth = (maxX - minX + 1) * grid.cellSize + 6;
    const highlightHeight = (maxY - minY + 1) * grid.cellSize + 6;
    const bracket = Math.min(11, Math.max(5, grid.cellSize * 0.62));
    push();
    noStroke();
    fill(255, 211, 90, 24);
    rect(x, y, highlightWidth, highlightHeight, 5);
    noFill();
    stroke("#ffd35a");
    strokeWeight(Math.max(2, grid.cellSize * 0.12));
    const corners = [
      [x, y, 1, 1],
      [x + highlightWidth, y, -1, 1],
      [x, y + highlightHeight, 1, -1],
      [x + highlightWidth, y + highlightHeight, -1, -1]
    ];
    corners.forEach(([cornerX, cornerY, directionX, directionY]) => {
      line(cornerX, cornerY, cornerX + directionX * bracket, cornerY);
      line(cornerX, cornerY, cornerX, cornerY + directionY * bracket);
    });
    pop();
  }

  drawArtefactCoachPopup() {
    const coach = this.artefactCoachForActiveTrench();
    if (!coach?.promptVisible || !this.layout.grid) {
      this.layout.artefactCoachPopup = null;
      return;
    }
    const grid = this.layout.grid;
    const artefactY = grid.y + (coach.artefact.centerY + 0.5) * grid.cellSize;
    const popupWidth = Math.max(140, Math.min(340, grid.width - 18));
    const popupHeight = this.layout.isPortrait ? 72 : 66;
    const popupX = grid.x + (grid.width - popupWidth) / 2;
    const popupY = artefactY < grid.y + grid.height / 2
      ? grid.y + grid.height - popupHeight - 10
      : grid.y + 10;
    const popup = { x: popupX, y: popupY, width: popupWidth, height: popupHeight };
    this.layout.artefactCoachPopup = popup;
    this.renderer.panel(popup.x, popup.y, popup.width, popup.height, "#f3dfae");
    fill("#6f3d20");
    noStroke();
    textAlign(LEFT, TOP);
    textStyle(BOLD);
    textSize(this.layout.isPortrait ? 12 : 13);
    text("ARTEFACT FOUND", popup.x + 12, popup.y + 8);
    textStyle(NORMAL);
    fill("#25444a");
    textSize(this.layout.isPortrait ? 10 : 11);
    text(
      "You’ve found an artefact. Select Brush to uncover it safely without damaging it.",
      popup.x + 12,
      popup.y + 27,
      popup.width - 24,
      popup.height - 32
    );
  }

  drawMessage() {
    if (!this.message) return;
    const messageY = this.layout.header?.statusY ?? Math.max(60, this.layout.grid.y - 9);
    fill(this.messageTone === "warning" ? "#ffd889" : "#d9eee2");
    textAlign(LEFT, CENTER);
    const messageSize = Math.max(9, Math.min(13, width * 0.015));
    textSize(messageSize);
    text(this.message, 16, messageY, width - 32, messageSize * 1.5);
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

  revealedArtefactAtCanvas(x, y) {
    if (this.currentScene !== "trench" || !this.activeTrench?.artefacts || !this.layout.grid) return null;
    const cell = this.cellAt(x, y);
    if (!cell) return null;
    return this.activeTrench.artefacts.find((artefact) =>
      artefact.exposure === "revealed"
      && artefact.footprint.some((footprintCell) => footprintCell.x === cell.x && footprintCell.y === cell.y)
    ) || null;
  }

  collectionArtefactAtCanvas(x, y, source = "mouse") {
    if (source !== "touch") return this.revealedArtefactAtCanvas(x, y);
    if (this.currentScene !== "trench" || !this.activeTrench?.artefacts || !this.layout.grid) return null;
    const grid = this.layout.grid;
    if (!this.pointIn(grid, x, y)) return null;
    const candidates = this.activeTrench.artefacts
      .map((artefact, index) => ({ artefact, index }))
      .filter(({ artefact }) => artefact.exposure === "revealed" && artefact.footprint?.length)
      .filter(({ artefact }) => {
        const minX = Math.max(0, Math.min(...artefact.footprint.map((cell) => cell.x)) - 1);
        const maxX = Math.min(this.activeTrench.columns, Math.max(...artefact.footprint.map((cell) => cell.x)) + 2);
        const minY = Math.max(0, Math.min(...artefact.footprint.map((cell) => cell.y)) - 1);
        const maxY = Math.min(this.activeTrench.rows, Math.max(...artefact.footprint.map((cell) => cell.y)) + 2);
        return x >= grid.x + minX * grid.cellSize
          && x <= grid.x + maxX * grid.cellSize
          && y >= grid.y + minY * grid.cellSize
          && y <= grid.y + maxY * grid.cellSize;
      })
      .map((candidate) => {
        const centerX = grid.x + (candidate.artefact.centerX + 0.5) * grid.cellSize;
        const centerY = grid.y + (candidate.artefact.centerY + 0.5) * grid.cellSize;
        return { ...candidate, distance: Math.hypot(x - centerX, y - centerY) };
      })
      .sort((first, second) => first.distance - second.distance || first.index - second.index);
    return candidates[0]?.artefact || null;
  }

  collectResolvedArtefact(artefact) {
    if (!artefact || !this.activeTrench) return null;
    if (typeof this.activeTrench.collectArtefact === "function") {
      const collected = this.activeTrench.collectArtefact(artefact);
      if (collected) return collected;
    }
    const footprintCell = artefact.footprint?.[0];
    if (!footprintCell || typeof this.activeTrench.collectAt !== "function") return null;
    return this.activeTrench.collectAt(footprintCell.x, footprintCell.y);
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
    this.updateArtefactCoachCompletion();
    if (result.changed) {
      result.removedLayers.forEach((removed) => this.spawnBrushParticles(removed, removed.layer));
      this.message = "Careful brushing exposes another part of the profile.";
      this.messageTone = "neutral";
      if (requestDraw) this.requestFrame();
      return true;
    }
    return false;
  }

  trenchPointerStart(x, y, source = "mouse") {
    if (this.pointIn(this.layout.mapButton, x, y)) {
      this.leaveTrenchToSite();
      return;
    }
    if (this.pointIn(this.layout.brushButton, x, y)) {
      this.tool = "brush";
      const coach = this.artefactCoachForActiveTrench();
      if (coach) coach.promptVisible = false;
      this.message = "Drag over soil carefully.";
      this.messageTone = "neutral";
      this.requestFrame();
      return;
    }
    if (this.pointIn(this.layout.scoopButton, x, y)) {
      this.tool = "scoop";
      this.message = "Drag a safe shovel-load outside the trench.";
      this.messageTone = "neutral";
      this.requestFrame();
      return;
    }
    if (this.layout.findsLabButton && this.pointIn(this.layout.findsLabButton, x, y)) {
      this.cleaningScene.enter();
      return;
    }
    if (this.layout.artefactCoachPopup && this.pointIn(this.layout.artefactCoachPopup, x, y)) {
      this.requestFrame();
      return;
    }

    const collectableArtefact = this.collectionArtefactAtCanvas(x, y, source);
    if (collectableArtefact) {
      this.setPointerToolUse("hand", "closed");
      const collected = this.collectResolvedArtefact(collectableArtefact);
      if (collected) {
        this.startCollectionFlight(collected);
        this.updateArtefactCoachCompletion();
        this.message = `${collected.label} carefully collected.`;
        this.messageTone = "neutral";
        this.requestFrame();
      }
      return;
    }

    const cell = this.cellAt(x, y);
    if (!cell) return;
    this.setPointerToolUse(this.tool);
    if (this.tool === "brush") {
      this.pointerAction = { type: "brush", lastPoint: { x, y }, travelRemainder: 0 };
      this.applyBrush(this.toolCenterAt(x, y));
      return;
    }

    const toolCenter = this.toolCenterAt(x, y);
    const scoopCheck = this.activeTrench.canScoop(toolCenter.x, toolCenter.y);
    this.recordShovelAttempt(scoopCheck.artefact || null);
    if (!scoopCheck.allowed) {
      if (scoopCheck.artefact) this.activeTrench.partiallyExpose(scoopCheck.artefact);
      this.message = scoopCheck.reason;
      this.messageTone = scoopCheck.artefact ? "warning" : "neutral";
      this.requestFrame();
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
    this.requestFrame();
  }

  leaveTrenchToSite() {
    this.trenchScene.leave();
    this.currentScene = "site";
    this.message = "Choose a trench to continue exploring.";
    this.messageTone = "neutral";
    this.requestFrame();
  }

  trenchPointerMove(x, y) {
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

  trenchPointerEnd(x, y, source = "mouse") {
    if (!this.pointerAction) {
      if (source === "touch") this.pointer = null;
      this.requestFrame();
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

  trenchPointerCancel(x, y, source = "mouse") {
    this.pointerAction = null;
    this.pointer = source === "touch" ? null : { x, y, source, pressed: false };
    this.messageTone = "neutral";
    this.requestFrame();
  }

  static get legacyMethodNames() {
    const controllerMethods = new Set([
      "constructor", "enter", "leave", "draw", "handleResize",
      "pointerStart", "pointerMove", "pointerEnd", "pointerCancel", "cursorPresentation"
    ]);
    return Object.getOwnPropertyNames(TrenchScene.prototype)
      .filter((name) => !controllerMethods.has(name));
  }
  }

  TrenchScene.installSceneManagerPrototype = function installSceneManagerPrototype(prototype) {
    if (!prototype) throw new Error("A SceneManager prototype is required.");
    TrenchScene.legacyMethodNames.forEach((name) => {
      Object.defineProperty(prototype, name, {
        configurable: true,
        writable: true,
        value: TrenchScene.prototype[name]
      });
    });
    return prototype;
  };

  TrenchScene.ownedState = [...OWNED_STATE];
  root.TrenchScene = TrenchScene;
})(typeof window !== "undefined" ? window : globalThis);
