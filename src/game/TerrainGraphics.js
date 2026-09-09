(function registerTerrainGraphics(root) {
  "use strict";

  const sharedMethodNames = [
    "defaultDrawingContext",
    "terrainTimingNow",
    "recordTerrainTimings",
    "buildVisibleSurfaceField",
    "terrainLayers",
    "buildCardinalComponents",
    "mergeSmallExtrema",
    "drawBaseTerrain",
    "terrainSeamOverlap",
    "depthTintColour",
    "buildTerrainPatternGroups",
    "drawTerrainPatterns",
    "colourChannels",
    "preblendedShadowColour",
    "drawLiteAmbientOcclusion",
    "junctionGroups",
    "chooseJunctionOwner",
    "shouldSmoothJunction",
    "appendCornerLobePath",
    "terrainRasterDensity",
    "snapTerrainCoordinate",
    "terrainPatchBounds",
    "drawLocalJunctions",
    "buildLocalJunctionDescriptors",
    "surfaceRegionFor",
    "addSurfaceRectangle",
    "collectPixelSnappedSurfacePatches",
    "drawPixelSnappedSurfacePatches",
    "collectSurfaceRegionsFromPatches",
    "collectCompleteSurfaceRegions",
    "appendSurfaceRegionPath",
    "orderedSurfaceRegions",
    "prepareSurfaceRegions",
    "cornerBoundary",
    "aoStyle",
    "ambientBatchFor",
    "straightAORibbon",
    "quadraticPoint",
    "quadraticDerivative",
    "curvedAORibbon",
    "normalisePolygonWinding",
    "collectAmbientOcclusion",
    "appendAmbientPolygonPath",
    "drawAmbientBatch",
    "drawAmbientOcclusionBatches",
    "drawLocalAmbientOcclusion",
    "ensureAmbientBuffer",
    "buildAmbientOcclusionBuffer",
    "drawDepthCompositedTerrain"
  ];

  class TerrainEngine {
    constructor(config = {}, options = {}) {
      this.config = config;
      this.canvasFactory = options.canvasFactory || null;
      this.statsSink = options.statsSink || null;
      this.activeTrench = null;
      this.ambientBuffer = null;
      this.currentTerrainRasterDensity = 1;
      this.terrainSmoothingMode = "focus";
      this.pillarRenderMode = "round";
      this.ridgeDirectionMode = "current";
      this.performanceMode = "full";
      this.effectStats = { allocatedCanvasPixels: 0 };
      this.terrainStats = {
        junctionsVisited: 0,
        junctionsSmoothed: 0,
        edgeChecks: 0,
        lastTimings: {},
        averageTimings: {},
        timingSamples: 0
      };
      this._drawingContext = null;
    }

    defaultDrawingContext() {
      if (this._drawingContext) return this._drawingContext;
      throw new Error("Terrain drawing requires an explicit CanvasRenderingContext2D.");
    }

    releaseCanvasBuffer(record) {
      const canvas = record?.canvas;
      if (!canvas) return;
      try {
        canvas.width = 1;
        canvas.height = 1;
      } catch (_error) {
        // Canvas cleanup is best-effort across browser implementations.
      }
    }

    updateCanvasPixelStats() {
      const pixels = (this.ambientBuffer?.pixelWidth || 0) * (this.ambientBuffer?.pixelHeight || 0);
      this.effectStats.allocatedCanvasPixels = pixels;
      if (this.statsSink) this.statsSink({ allocatedCanvasPixels: pixels });
    }

    createTerrainCanvas(pixelWidth, pixelHeight) {
      if (this.canvasFactory) return this.canvasFactory(pixelWidth, pixelHeight);
      if (typeof OffscreenCanvas === "function") return new OffscreenCanvas(pixelWidth, pixelHeight);
      if (typeof document !== "undefined") return document.createElement("canvas");
      return null;
    }

    buildTrenchFromRequest(request) {
      const layers = request.layers.map((layer) => ({ ...layer }));
      const layerById = new Map(layers.map((layer) => [layer.id, layer]));
      const grassLayer = layerById.get("grass") || null;
      const bedrock = layerById.get("bedrock") || layers[layers.length - 1];
      return {
        rows: request.rows,
        columns: request.columns,
        maxDepth: request.maxDepth,
        depthResolutionScale: request.depthResolutionScale,
        grassLayer,
        bedrock,
        layers: layers.filter((layer) => layer !== grassLayer && layer !== bedrock),
        layerById
      };
    }

    buildFieldFromRequest(request, trench) {
      const field = Array.from({ length: request.rows }, () => Array(request.columns));
      request.cells.forEach((cell) => {
        const layer = trench.layerById.get(cell.layerId);
        if (!layer) throw new Error(`Unknown terrain layer: ${cell.layerId}`);
        field[cell.y][cell.x] = {
          x: cell.x,
          y: cell.y,
          actualDepth: cell.depth,
          depth: cell.depth,
          actualLayer: layer,
          layer,
          renderColour: cell.renderColour || layer.colour,
          signature: `${cell.depth}:${cell.layerId}`,
          componentSize: 1,
          merged: false
        };
      });
      if (this.performanceMode !== "lite") {
        if (request.pillarRenderMode === "merge") this.mergeSmallExtrema(field, trench);
        const components = this.buildCardinalComponents(field, (cell) => cell.signature);
        components.items.forEach((component) => {
          component.cells.forEach((cell) => {
            field[cell.y][cell.x].componentSize = component.cells.length;
          });
        });
      }
      return field;
    }

    render(request, canvas) {
      const startedAt = this.terrainTimingNow();
      this.config = request.config || this.config || {};
      this.terrainSmoothingMode = request.terrainSmoothingMode;
      this.pillarRenderMode = request.pillarRenderMode;
      this.ridgeDirectionMode = request.ridgeDirectionMode;
      this.performanceMode = request.performanceMode || "full";
      this.currentTerrainRasterDensity = request.density || 1;
      const trench = this.buildTrenchFromRequest(request);
      this.activeTrench = trench;

      const fieldStartedAt = this.terrainTimingNow();
      const field = this.buildFieldFromRequest(request, trench);
      const fieldMs = this.terrainTimingNow() - fieldStartedAt;
      const grid = { x: 0, y: 0, width: request.width, height: request.height, cellSize: request.cellSize };
      const context = canvas.getContext("2d", { alpha: true });
      this._drawingContext = context;
      context.setTransform(request.density, 0, 0, request.density, 0, 0);
      context.clearRect(0, 0, request.width, request.height);
      context.save();
      context.beginPath();
      context.rect(0, 0, request.width, request.height);
      context.clip();
      this.drawBaseTerrain(field, trench, grid, context);

      if (this.performanceMode === "lite") {
        const compositeStartedAt = this.terrainTimingNow();
        const patterns = this.buildTerrainPatternGroups(field, trench);
        this.drawTerrainPatterns(field, trench, grid, null, patterns, context);
        this.drawLiteAmbientOcclusion(field, trench, grid, context);
        context.restore();
        context.setTransform(1, 0, 0, 1, 0, 0);
        this._drawingContext = null;
        return {
          timings: {
            total: this.terrainTimingNow() - startedAt,
            field: fieldMs,
            topology: 0,
            ambient: 0,
            composite: this.terrainTimingNow() - compositeStartedAt
          },
          stats: {
            junctionsVisited: 0,
            junctionsSmoothed: 0,
            edgeChecks: this.terrainStats.edgeChecks
          }
        };
      }

      const topologyStartedAt = this.terrainTimingNow();
      const junctions = this.buildLocalJunctionDescriptors(field, trench, grid);
      const patches = this.collectPixelSnappedSurfacePatches(field, trench, grid, junctions, request.density);
      const regions = this.collectSurfaceRegionsFromPatches(patches);
      this.prepareSurfaceRegions(regions, trench);
      const topologyMs = this.terrainTimingNow() - topologyStartedAt;

      const ambientStartedAt = this.terrainTimingNow();
      const ambientBatches = this.collectAmbientOcclusion(field, trench, grid, junctions);
      const ambient = this.buildAmbientOcclusionBuffer(ambientBatches, regions, grid);
      const ambientMs = this.terrainTimingNow() - ambientStartedAt;
      const patterns = this.buildTerrainPatternGroups(field, trench);

      const compositeStartedAt = this.terrainTimingNow();
      this.drawPixelSnappedSurfacePatches(patches, context);
      this.drawTerrainPatterns(field, trench, grid, null, patterns, context);
      if (ambient) {
        context.save();
        context.drawImage(ambient.canvas, 0, 0, request.width, request.height);
        context.restore();
      }
      context.restore();
      context.setTransform(1, 0, 0, 1, 0, 0);
      this._drawingContext = null;

      const timings = {
        total: this.terrainTimingNow() - startedAt,
        field: fieldMs,
        topology: topologyMs,
        ambient: ambientMs,
        composite: this.terrainTimingNow() - compositeStartedAt
      };
      return {
        timings,
        stats: {
          junctionsVisited: this.terrainStats.junctionsVisited,
          junctionsSmoothed: this.terrainStats.junctionsSmoothed,
          edgeChecks: this.terrainStats.edgeChecks
        }
      };
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

  drawBaseTerrain(field, trench, grid, context = this.defaultDrawingContext()) {
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

  drawTerrainPatterns(field, trench, grid, depth = null, patternGroups = null, context = this.defaultDrawingContext()) {
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

  drawLiteAmbientOcclusion(field, trench, grid, context = this.defaultDrawingContext()) {
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

  terrainRasterDensity() {
    if (this.currentTerrainRasterDensity) return this.currentTerrainRasterDensity;
    return typeof pixelDensity === "function" ? Math.max(1, pixelDensity()) : 1;
  }

  snapTerrainCoordinate(value, density = this.terrainRasterDensity()) {
    return Math.round(value * density) / density;
  }

  terrainPatchBounds(vertexX, vertexY, trench, grid, density = this.terrainRasterDensity()) {
    const snap = (value) => this.snapTerrainCoordinate(value, density);
    const gridLeft = Math.floor(grid.x * density) / density;
    const gridTop = Math.floor(grid.y * density) / density;
    const gridRight = Math.ceil((grid.x + grid.width) * density) / density;
    const gridBottom = Math.ceil((grid.y + grid.height) * density) / density;
    const centerX = vertexX === 0
      ? gridLeft
      : vertexX === trench.columns
        ? gridRight
        : snap(grid.x + vertexX * grid.cellSize);
    const centerY = vertexY === 0
      ? gridTop
      : vertexY === trench.rows
        ? gridBottom
        : snap(grid.y + vertexY * grid.cellSize);
    return {
      left: vertexX === 0 ? gridLeft : snap(grid.x + (vertexX - 0.5) * grid.cellSize),
      top: vertexY === 0 ? gridTop : snap(grid.y + (vertexY - 0.5) * grid.cellSize),
      right: vertexX === trench.columns ? gridRight : snap(grid.x + (vertexX + 0.5) * grid.cellSize),
      bottom: vertexY === trench.rows ? gridBottom : snap(grid.y + (vertexY + 0.5) * grid.cellSize),
      centerX,
      centerY
    };
  }

  drawLocalJunctions(field, trench, grid) {
    const descriptors = this.buildLocalJunctionDescriptors(field, trench, grid);
    const patches = this.collectPixelSnappedSurfacePatches(field, trench, grid, descriptors);
    this.drawPixelSnappedSurfacePatches(patches);
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
        const bounds = this.terrainPatchBounds(x, y, trench, grid);
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

  collectPixelSnappedSurfacePatches(field, trench, grid, junctions, density = this.terrainRasterDensity()) {
    const patches = [];
    const descriptors = new Map(junctions.map((junction) => [`${junction.x}:${junction.y}`, junction]));
    const addPiece = (pieces, surface, left, top, right, bottom) => {
      if (!surface || right - left <= 0.001 || bottom - top <= 0.001) return;
      pieces.push({ surface, bounds: { left, top, right, bottom } });
    };

    for (let vertexY = 0; vertexY <= trench.rows; vertexY += 1) {
      for (let vertexX = 0; vertexX <= trench.columns; vertexX += 1) {
        const bounds = this.terrainPatchBounds(vertexX, vertexY, trench, grid, density);
        const descriptor = descriptors.get(`${vertexX}:${vertexY}`);
        if (descriptor) {
          patches.push({
            x: vertexX,
            y: vertexY,
            bounds,
            owner: descriptor.owner,
            lobes: descriptor.lobes,
            pieces: null,
            smoothed: true
          });
          continue;
        }

        const pieces = [];
        if (vertexX > 0 && vertexY > 0) {
          addPiece(pieces, field[vertexY - 1][vertexX - 1], bounds.left, bounds.top, bounds.centerX, bounds.centerY);
        }
        if (vertexX < trench.columns && vertexY > 0) {
          addPiece(pieces, field[vertexY - 1][vertexX], bounds.centerX, bounds.top, bounds.right, bounds.centerY);
        }
        if (vertexX < trench.columns && vertexY < trench.rows) {
          addPiece(pieces, field[vertexY][vertexX], bounds.centerX, bounds.centerY, bounds.right, bounds.bottom);
        }
        if (vertexX > 0 && vertexY < trench.rows) {
          addPiece(pieces, field[vertexY][vertexX - 1], bounds.left, bounds.centerY, bounds.centerX, bounds.bottom);
        }
        patches.push({ x: vertexX, y: vertexY, bounds, pieces, smoothed: false });
      }
    }
    return patches;
  }

  drawPixelSnappedSurfacePatches(patches, context = this.defaultDrawingContext()) {
    context.save();
    patches.forEach((patch) => {
      if (patch.smoothed) {
        context.fillStyle = patch.owner.renderColour || patch.owner.layer.colour;
        context.fillRect(
          patch.bounds.left,
          patch.bounds.top,
          patch.bounds.right - patch.bounds.left,
          patch.bounds.bottom - patch.bounds.top
        );
        patch.lobes.forEach((lobe) => {
          context.beginPath();
          this.appendCornerLobePath(context, lobe.corner, patch.bounds);
          context.fillStyle = lobe.surface.renderColour || lobe.surface.layer.colour;
          context.fill();
        });
        return;
      }
      patch.pieces.forEach((piece) => {
        const bounds = piece.bounds;
        context.fillStyle = piece.surface.renderColour || piece.surface.layer.colour;
        context.fillRect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
      });
    });
    context.restore();
  }

  collectSurfaceRegionsFromPatches(patches) {
    const regions = new Map();
    patches.forEach((patch) => {
      if (patch.smoothed) {
        this.surfaceRegionFor(regions, patch.owner).ownerPatches.push({ bounds: patch.bounds, holes: patch.lobes });
        patch.lobes.forEach((lobe) => {
          this.surfaceRegionFor(regions, lobe.surface).positiveLobes.push({ bounds: patch.bounds, corner: lobe.corner });
        });
        return;
      }
      patch.pieces.forEach((piece) => {
        const bounds = piece.bounds;
        this.addSurfaceRectangle(regions, piece.surface, bounds.left, bounds.top, bounds.right, bounds.bottom);
      });
    });
    return regions;
  }

  collectCompleteSurfaceRegions(field, trench, grid, junctions) {
    return this.collectSurfaceRegionsFromPatches(
      this.collectPixelSnappedSurfacePatches(field, trench, grid, junctions)
    );
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

  drawAmbientBatch(batch, context = this.defaultDrawingContext(), replaceOverlaps = false) {
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

  drawAmbientOcclusionBatches(batches, context = this.defaultDrawingContext()) {
    context.save();
    batches.forEach((batch) => this.drawAmbientBatch(batch, context));
    context.restore();
  }

  drawLocalAmbientOcclusion(field, trench, grid, junctions) {
    this.drawAmbientOcclusionBatches(this.collectAmbientOcclusion(field, trench, grid, junctions));
  }

  ensureAmbientBuffer(grid) {
    const density = this.terrainRasterDensity();
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

  drawDepthCompositedTerrain(
    field,
    trench,
    grid,
    regions,
    ambientBuffer,
    preparedRegions = null,
    patternGroups = null,
    patches = null
  ) {
    const context = arguments.length > 8 && arguments[8] ? arguments[8] : this.defaultDrawingContext();
    const patterns = patternGroups || this.buildTerrainPatternGroups(field, trench);
    const surfacePatches = patches || this.collectPixelSnappedSurfacePatches(
      field,
      trench,
      grid,
      this.buildLocalJunctionDescriptors(field, trench, grid)
    );
    this.drawPixelSnappedSurfacePatches(surfacePatches, context);
    this.drawTerrainPatterns(field, trench, grid, null, patterns, context);
    if (ambientBuffer) {
      context.save();
      context.drawImage(ambientBuffer.canvas, grid.x, grid.y, grid.width, grid.height);
      context.restore();
    }
  }

  }

  function createEngine(config = {}, options = {}) {
    return new TerrainEngine(config, options);
  }

  function render(request, canvas, reusableEngine = null) {
    const engine = reusableEngine || createEngine(request.config);
    return engine.render(request, canvas);
  }

  root.TerrainGraphics = {
    TerrainEngine,
    sharedMethodNames: [...sharedMethodNames],
    createEngine,
    createManager: createEngine,
    render
  };
})(typeof self !== "undefined" ? self : window);
