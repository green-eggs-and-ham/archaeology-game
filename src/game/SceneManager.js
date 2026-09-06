window.SceneManager = class SceneManager {
  constructor(config) {
    this.config = config;
    this.renderer = new window.GameRenderer();
    this.currentScene = "site";
    this.tool = "brush";
    this.activeTrench = null;
    this.pointerAction = null;
    this.message = "Choose a trench to begin your dig.";
    this.messageTone = "neutral";
    this.pointer = null;
    this.showDepthDebug = false;
    this.terrainSmoothingMode = "all";
    this.pillarRenderMode = "round";
    this.ridgeDirectionMode = "high-cut";
    this.gridCache = null;
    this.ambientBuffer = null;
    this.terrainStats = { junctionsVisited: 0, junctionsSmoothed: 0, edgeChecks: 0, cacheHits: 0, cacheMisses: 0 };
    this.brushParticles = [];
    this.depositedClumps = [];
    this.effectFrameRequested = false;
    this.mapTiles = [];
    this.layout = {};
    this.trenches = config.trenches.map((definition) => new window.TrenchModel(definition, config));
  }

  handleResize() {
    this.mapTiles = [];
    this.layout = {};
    this.gridCache = null;
    this.ambientBuffer = null;
  }

  draw() {
    this.renderer.drawBackground();
    if (this.currentScene === "site") {
      this.drawSiteMap();
    } else {
      this.drawTrench();
    }
  }

  drawHeading(title, subtitle) {
    fill("#fff9e9");
    noStroke();
    textAlign(LEFT, TOP);
    textStyle(BOLD);
    textSize(Math.max(17, width * 0.035));
    text(title, 18, 14);
    textStyle(NORMAL);
    fill("#c9d9d8");
    textSize(Math.max(10, width * 0.016));
    text(subtitle, 18, 40);
  }

  drawSiteMap() {
    this.drawHeading("Dig Site", "Choose a trench to start digging.");
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
    const soil = trench.getSurfaceAt(Math.floor(trench.columns / 2), Math.floor(trench.rows / 2));
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
    this.drawProfile(trench, this.layout.profile);
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
    this.renderer.button(this.layout.brushButton, "Brush", this.tool === "brush");
    this.renderer.button(this.layout.scoopButton, "Shovel", this.tool === "scoop");

    const diagnosticY = 17 + buttonHeight;
    const diagnosticGap = 6;
    const diagnosticButtons = this.diagnosticButtonLayout(width, diagnosticY, diagnosticHeight, diagnosticGap);
    this.layout.depthButton = diagnosticButtons.depth;
    this.layout.smoothingButton = diagnosticButtons.smoothing;
    this.layout.pillarButton = diagnosticButtons.pillar;
    this.layout.ridgeButton = diagnosticButtons.ridge;
    this.renderer.button(this.layout.depthButton, "Depths", this.showDepthDebug, true);
    this.renderer.button(
      this.layout.smoothingButton,
      this.terrainSmoothingMode === "all" ? "Smooth A: All" : "Smooth B: Focus",
      this.terrainSmoothingMode === "focus",
      true
    );
    this.renderer.button(
      this.layout.pillarButton,
      this.pillarRenderMode === "round" ? "Pillars A: Round" : "Pillars B: Merge",
      this.pillarRenderMode === "merge",
      true
    );
    this.renderer.button(
      this.layout.ridgeButton,
      this.ridgeDirectionMode === "current" ? "Ridges A: Current" : "Ridges B: High cut",
      this.ridgeDirectionMode === "high-cut",
      true
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
    text(this.tool === "brush" ? "Drag over soil carefully." : "Drag a shovel-load outside the trench.", 16, guidanceY);
  }

  drawExcavationGrid(trench, grid) {
    const cacheBounds = this.gridCacheBounds(grid);
    const cacheKey = this.gridCacheKey(trench, grid);
    if (this.gridCache?.key === cacheKey && this.gridCache.image) {
      image(this.gridCache.image, cacheBounds.x, cacheBounds.y, cacheBounds.width, cacheBounds.height);
      this.terrainStats.cacheHits += 1;
      return;
    }

    this.terrainStats.cacheMisses += 1;
    this.renderExcavationGrid(trench, grid);
    if (typeof get === "function") {
      this.gridCache = {
        key: cacheKey,
        image: get(cacheBounds.x, cacheBounds.y, cacheBounds.width, cacheBounds.height)
      };
    }
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
      trench.visualRevision,
      this.terrainSmoothingMode,
      this.pillarRenderMode,
      this.ridgeDirectionMode,
      this.showDepthDebug ? 1 : 0,
      grid.x.toFixed(2),
      grid.y.toFixed(2),
      grid.width.toFixed(2),
      grid.height.toFixed(2)
    ].join(":");
  }

  renderExcavationGrid(trench, grid) {
    this.renderer.panel(grid.x - 5, grid.y - 5, grid.width + 10, grid.height + 10, "#3b2f25");
    noStroke();
    fill("#665e50");
    rect(grid.x, grid.y, grid.width, grid.height, 4);
    const surfaceField = this.buildVisibleSurfaceField(trench);
    const terrainContext = drawingContext;
    terrainContext.save();
    terrainContext.beginPath();
    terrainContext.rect(grid.x, grid.y, grid.width, grid.height);
    terrainContext.clip();
    this.drawBaseTerrain(surfaceField, trench, grid);
    const junctions = this.buildLocalJunctionDescriptors(surfaceField, trench, grid);
    const regions = this.collectCompleteSurfaceRegions(surfaceField, trench, grid, junctions);
    const ambientBatches = this.collectAmbientOcclusion(surfaceField, trench, grid, junctions);
    const ambientBuffer = this.buildAmbientOcclusionBuffer(ambientBatches, regions, grid);
    this.drawDepthCompositedTerrain(surfaceField, trench, grid, regions, ambientBuffer);
    terrainContext.restore();
    if (this.showDepthDebug) this.drawDepthDebug(trench, grid);

    trench.artefacts.forEach((artefact) => {
      if (artefact.exposure === "partial" || artefact.exposure === "revealed") {
        this.renderer.artefactShape(
          artefact.shape,
          grid.x + (artefact.centerX + 0.5) * grid.cellSize,
          grid.y + (artefact.centerY + 0.5) * grid.cellSize,
          Math.max(10, grid.cellSize * 1.45),
          artefact.colour,
          false,
          artefact.exposure === "partial"
        );
      }
    });

    noFill();
    stroke("#f5e6bb");
    strokeWeight(2);
    rect(grid.x, grid.y, grid.width, grid.height, 3);
  }

  buildVisibleSurfaceField(trench) {
    const field = Array.from({ length: trench.rows }, (_, y) =>
      Array.from({ length: trench.columns }, (_, x) => {
        const depth = trench.getDepth(x, y);
        const layer = trench.getSurfaceAt(x, y);
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

    if (this.pillarRenderMode === "merge") this.mergeSmallExtrema(field, trench);
    const components = this.buildCardinalComponents(field, (cell) => cell.signature);
    components.items.forEach((component) => {
      component.cells.forEach((cell) => { field[cell.y][cell.x].componentSize = component.cells.length; });
    });
    return field;
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
    const layerOrder = new Map([...trench.layers, trench.bedrock].map((layer, index) => [layer.id, index]));
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

  drawBaseTerrain(field, trench, grid) {
    const context = drawingContext;
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

  drawTerrainPatterns(field, trench, grid, depth = null) {
    stroke(255, 255, 255, 38);
    strokeWeight(Math.max(0.7, grid.cellSize * 0.035));
    for (let y = 0; y < trench.rows; y += 1) {
      for (let x = 0; x < trench.columns; x += 1) {
        if (depth !== null && field[y][x].depth !== depth) continue;
        if ((x * 7 + y * 11) % 3 !== 0) continue;
        const layer = field[y][x].layer;
        const left = grid.x + x * grid.cellSize;
        const top = grid.y + y * grid.cellSize;
        if (layer.pattern === "dots" || layer.pattern === "specks") {
          point(left + grid.cellSize * 0.5, top + grid.cellSize * 0.5);
        } else if (layer.pattern === "lines") {
          line(left + grid.cellSize * 0.4, top + grid.cellSize * 0.6, left + grid.cellSize * 0.6, top + grid.cellSize * 0.4);
        } else if (layer.pattern === "cracks") {
          line(left + grid.cellSize * 0.4, top + grid.cellSize * 0.4, left + grid.cellSize * 0.51, top + grid.cellSize * 0.51);
          line(left + grid.cellSize * 0.51, top + grid.cellSize * 0.51, left + grid.cellSize * 0.6, top + grid.cellSize * 0.44);
        }
      }
    }
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
    const layerOrder = new Map([...trench.layers, trench.bedrock].map((layer, index) => [layer.id, index]));
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
    const layerOrder = new Map([...trench.layers, trench.bedrock].map((layer, index) => [layer.id, index]));
    return [...regions.values()].sort((first, second) =>
      second.surface.depth - first.surface.depth ||
      (layerOrder.get(first.surface.layer.id) ?? 99) - (layerOrder.get(second.surface.layer.id) ?? 99) ||
      first.signature.localeCompare(second.signature)
    );
  }

  drawSurfaceRegion(region, context = drawingContext) {
    context.beginPath();
    this.appendSurfaceRegionPath(context, region);
    context.fillStyle = region.surface.renderColour || region.surface.layer.colour;
    context.fill("evenodd");
  }

  drawBatchedJunctionSurfaces(regions, trench, context = drawingContext) {
    const layerOrder = new Map([...trench.layers, trench.bedrock].map((layer, index) => [layer.id, index]));
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
      context.beginPath();
      this.appendSurfaceRegionPath(context, region);
      context.clip("evenodd");
      this.drawAmbientBatch(batch, context, true);
      context.restore();
    });
    context.setTransform(1, 0, 0, 1, 0, 0);
    return buffer;
  }

  drawDepthCompositedTerrain(field, trench, grid, regions, ambientBuffer) {
    const context = drawingContext;
    const orderedRegions = this.orderedSurfaceRegions(regions, trench);
    const depths = [...new Set(orderedRegions.map((region) => region.surface.depth))].sort((first, second) => second - first);
    depths.forEach((depth) => {
      const depthRegions = orderedRegions.filter((region) => region.surface.depth === depth);
      depthRegions.forEach((region) => this.drawSurfaceRegion(region, context));
      this.drawTerrainPatterns(field, trench, grid, depth);
      if (!ambientBuffer) return;
      context.save();
      context.beginPath();
      depthRegions.forEach((region) => this.appendSurfaceRegionPath(context, region));
      context.clip("evenodd");
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
    const usableWidth = totalWidth - 24 - gap * 3;
    const depthWidth = usableWidth * 0.16;
    const comparisonWidth = (usableWidth - depthWidth) / 3;
    const depth = { x: 12, y, width: depthWidth, height: buttonHeight };
    const smoothing = { x: depth.x + depth.width + gap, y, width: comparisonWidth, height: buttonHeight };
    const pillar = { x: smoothing.x + smoothing.width + gap, y, width: comparisonWidth, height: buttonHeight };
    const ridge = { x: pillar.x + pillar.width + gap, y, width: comparisonWidth, height: buttonHeight };
    return { depth, smoothing, pillar, ridge };
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
        this.renderer.artefactShape(
          artefact.shape,
          x + markerOffset,
          y,
          Math.max(7, Math.min(columnWidth * 1.45, levelHeight * (trench.depthResolutionScale || 1) * 1.45)),
          artefact.colour,
          artefact.exposure === "collected",
          artefact.exposure === "partial"
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
    this.brushParticles = this.brushParticles.filter((particle) => now - particle.startedAt < particle.duration);
    this.depositedClumps = this.depositedClumps.filter((clump) => now - clump.startedAt < clump.holdDuration + clump.fadeDuration);

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
      const fadeProgress = elapsed <= clump.holdDuration ? 0 : (elapsed - clump.holdDuration) / clump.fadeDuration;
      this.drawSoilClump(clump.x, clump.y, clump.soilColours, clump.size, 255 * (1 - fadeProgress));
    });

    if (this.brushParticles.length || this.depositedClumps.length) this.scheduleEffectFrame();
  }

  scheduleEffectFrame() {
    if (this.effectFrameRequested) return;
    this.effectFrameRequested = true;
    const redrawEffectFrame = () => {
      this.effectFrameRequested = false;
      redraw();
    };
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(redrawEffectFrame);
    } else {
      setTimeout(redrawEffectFrame, 16);
    }
  }

  spawnBrushParticles(cell, layer) {
    const centerX = this.layout.grid.x + (cell.x + 0.5) * this.layout.grid.cellSize;
    const centerY = this.layout.grid.y + (cell.y + 0.5) * this.layout.grid.cellSize;
    const startedAt = millis();
    const particleCount = 4 + Math.floor(Math.random() * 3);
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
    this.scheduleEffectFrame();
  }

  spawnDepositedClump(x, y, soilColours) {
    this.depositedClumps.push({
      x,
      y,
      soilColours,
      size: this.scoopClumpSize(),
      startedAt: millis(),
      holdDuration: 900,
      fadeDuration: 350
    });
    this.scheduleEffectFrame();
  }

  drawToolPreview() {
    if (!this.pointer || (this.pointer.source === "touch" && !this.pointer.pressed)) return;
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
      this.renderer.artefactShape(artefact.shape, itemX, itemY, itemSize, artefact.colour, true);
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

  selectTrench(trench) {
    this.activeTrench = trench;
    this.currentScene = "trench";
    this.tool = "brush";
    this.message = "Brush slowly to reveal what is beneath the soil.";
    this.messageTone = "neutral";
    redraw();
  }

  pointerHover(x, y) {
    this.pointer = { x, y, source: "mouse", pressed: false };
    if (this.currentScene === "trench") redraw();
  }

  pointerStart(x, y, source = "mouse") {
    this.pointer = { x, y, source, pressed: true };
    if (this.currentScene === "site") {
      const tile = this.hitMapTile(x, y);
      if (tile) this.selectTrench(tile.trench);
      return;
    }

    if (this.pointIn(this.layout.mapButton, x, y)) {
      this.currentScene = "site";
      this.pointerAction = null;
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
      this.gridCache = null;
      this.message = this.showDepthDebug ? "Depth debug enabled." : "Depth debug hidden.";
      this.messageTone = "neutral";
      redraw();
      return;
    }
    if (this.pointIn(this.layout.smoothingButton, x, y)) {
      this.terrainSmoothingMode = this.terrainSmoothingMode === "all" ? "focus" : "all";
      this.gridCache = null;
      this.message = this.terrainSmoothingMode === "all"
        ? "Smoothing A applies to every terrain junction."
        : "Smoothing B focuses on diagonals and small features.";
      this.messageTone = "neutral";
      redraw();
      return;
    }
    if (this.pointIn(this.layout.pillarButton, x, y)) {
      this.pillarRenderMode = this.pillarRenderMode === "round" ? "merge" : "round";
      this.gridCache = null;
      this.message = this.pillarRenderMode === "round"
        ? "Pillars A keeps small features as rounded islands."
        : "Pillars B visually merges isolated height extrema.";
      this.messageTone = "neutral";
      redraw();
      return;
    }
    if (this.pointIn(this.layout.ridgeButton, x, y)) {
      this.ridgeDirectionMode = this.ridgeDirectionMode === "current" ? "high-cut" : "current";
      this.gridCache = null;
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
      this.pointerAction = { type: "brush", lastPoint: { x, y }, travelRemainder: 0 };
      this.applyBrush(this.toolCenterAt(x, y));
    } else {
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
        soilColours: scoopCheck.soilColours
      };
      this.message = "Carry the shovel-load outside the trench to set it aside.";
      this.messageTone = "neutral";
      redraw();
    }
  }

  pointerMove(x, y, source = "mouse") {
    this.pointer = { x, y, source, pressed: true };
    if (!this.pointerAction) {
      if (this.currentScene === "trench") redraw();
      return;
    }
    if (this.pointerAction.type === "brush") {
      this.advanceBrushPath(x, y);
    } else if (this.pointerAction.type === "scoop") {
      this.pointerAction.x = x;
      this.pointerAction.y = y;
      redraw();
    }
  }

  pointerEnd(x, y, source = "mouse") {
    this.pointer = { x, y, source, pressed: false };
    if (!this.pointerAction) {
      if (source === "touch") this.pointer = null;
      if (this.currentScene === "trench") redraw();
      return;
    }
    if (this.pointerAction.type === "scoop") {
      if (!this.pointIn(this.layout.grid, x, y)) {
        const result = this.activeTrench.scoop(this.pointerAction.center.x, this.pointerAction.center.y);
        this.message = result.reason;
        this.messageTone = result.allowed ? "neutral" : "warning";
        if (result.allowed) this.spawnDepositedClump(x, y, result.soilColours || this.pointerAction.soilColours);
      } else {
        this.message = "Move the shovel-load outside the trench before releasing it.";
        this.messageTone = "warning";
      }
    }
    this.pointerAction = null;
    if (source === "touch") this.pointer = null;
    redraw();
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
      redraw();
      return;
    }
    if (!action.lastPoint) {
      action.lastPoint = { x, y };
      redraw();
      return;
    }
    this.consumeBrushSegment(action.lastPoint, { x, y });
    action.lastPoint = { x, y };
    redraw();
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
      if (requestDraw) redraw();
      return true;
    }
    return false;
  }
};
