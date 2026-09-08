(function registerTerrainGraphics(root) {
  function now() {
    return typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  }

  function createManager(config = {}) {
    if (!root.SceneManager) throw new Error("SceneManager must be loaded before TerrainGraphics.");
    const manager = Object.create(root.SceneManager.prototype);
    manager.config = config;
    manager.ambientBuffer = null;
    manager.effectStats = { allocatedCanvasPixels: 0 };
    manager.terrainStats = { junctionsVisited: 0, junctionsSmoothed: 0, edgeChecks: 0 };
    return manager;
  }

  function buildTrench(request) {
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

  function buildField(manager, request, trench) {
    const field = Array.from({ length: request.rows }, () => Array(request.columns));
    request.cells.forEach((cell) => {
      const layer = trench.layerById.get(cell.layerId);
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
    if (request.pillarRenderMode === "merge") manager.mergeSmallExtrema(field, trench);
    const components = manager.buildCardinalComponents(field, (cell) => cell.signature);
    components.items.forEach((component) => {
      component.cells.forEach((cell) => { field[cell.y][cell.x].componentSize = component.cells.length; });
    });
    return field;
  }

  function render(request, canvas, reusableManager = null) {
    const startedAt = now();
    const manager = reusableManager || createManager(request.config);
    manager.config = request.config;
    manager.terrainSmoothingMode = request.terrainSmoothingMode;
    manager.pillarRenderMode = request.pillarRenderMode;
    manager.ridgeDirectionMode = request.ridgeDirectionMode;
    manager.performanceMode = "full";
    manager.currentTerrainRasterDensity = request.density;
    const trench = buildTrench(request);
    manager.activeTrench = trench;
    const fieldStartedAt = now();
    const field = buildField(manager, request, trench);
    const fieldMs = now() - fieldStartedAt;
    const grid = { x: 0, y: 0, width: request.width, height: request.height, cellSize: request.cellSize };
    const context = canvas.getContext("2d", { alpha: true });
    context.setTransform(request.density, 0, 0, request.density, 0, 0);
    context.clearRect(0, 0, request.width, request.height);
    context.save();
    context.beginPath();
    context.rect(0, 0, request.width, request.height);
    context.clip();
    manager.drawBaseTerrain(field, trench, grid, context);

    const topologyStartedAt = now();
    const junctions = manager.buildLocalJunctionDescriptors(field, trench, grid);
    const patches = manager.collectPixelSnappedSurfacePatches(field, trench, grid, junctions, request.density);
    const regions = manager.collectSurfaceRegionsFromPatches(patches);
    manager.prepareSurfaceRegions(regions, trench);
    const topologyMs = now() - topologyStartedAt;

    const ambientStartedAt = now();
    const ambientBatches = manager.collectAmbientOcclusion(field, trench, grid, junctions);
    const ambient = manager.buildAmbientOcclusionBuffer(ambientBatches, regions, grid);
    const ambientMs = now() - ambientStartedAt;
    const patterns = manager.buildTerrainPatternGroups(field, trench);

    const compositeStartedAt = now();
    manager.drawPixelSnappedSurfacePatches(patches, context);
    manager.drawTerrainPatterns(field, trench, grid, null, patterns, context);
    if (ambient) {
      context.save();
      context.drawImage(ambient.canvas, 0, 0, request.width, request.height);
      context.restore();
    }
    context.restore();
    context.setTransform(1, 0, 0, 1, 0, 0);
    return {
      timings: {
        total: now() - startedAt,
        field: fieldMs,
        topology: topologyMs,
        ambient: ambientMs,
        composite: now() - compositeStartedAt
      },
      stats: {
        junctionsVisited: manager.terrainStats.junctionsVisited,
        junctionsSmoothed: manager.terrainStats.junctionsSmoothed,
        edgeChecks: manager.terrainStats.edgeChecks
      }
    };
  }

  root.TerrainGraphics = { createManager, render };
})(typeof self !== "undefined" ? self : window);
