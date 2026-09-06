window.TrenchModel = class TrenchModel {
  constructor(definition, config) {
    this.id = definition.id;
    this.seed = definition.seed;
    this.label = definition.label;
    this.config = config;
    this.columns = config.trench.columns;
    this.rows = config.trench.rows;
    this.maxDepth = config.trench.maxDepth;
    this.depthResolutionScale = config.trench.depthResolutionScale || 1;
    this.artefactFootprintSize = config.trench.artefactFootprintSize;
    this.brushRadius = config.trench.brushRadius;
    this.scoopRadius = config.trench.scoopRadius;
    this.scoopPillarExtraDepth = config.trench.scoopPillarExtraDepth;
    this.layers = this.createLayers(definition.layerVariant);
    this.bedrock = { ...config.bedrock, id: "bedrock" };
    this.depths = Array.from({ length: this.rows }, () => Array(this.columns).fill(0));
    this.stratigraphy = this.createStratigraphy();
    this.discoveredLayerIds = new Set();
    this.visualRevision = 0;
    this.discoverLayer(this.getSurfaceAt(0, 0));
    this.artefacts = this.createArtefacts();
  }

  createLayers(variant) {
    const palette = this.config.layerPalettes[variant % this.config.layerPalettes.length];
    return this.config.layers.map((layer, index) => ({ ...layer, id: `layer-${index}`, colour: palette[index] }));
  }

  randomGenerator(salt = 0) {
    let value = (this.seed ^ salt) >>> 0;
    return () => {
      value += 0x6D2B79F5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }

  createSmoothBoundaryField(random, baseDepth, variation = 1) {
    const spacing = 5;
    const controlColumns = Math.ceil((this.columns - 1) / spacing) + 1;
    const controlRows = Math.ceil((this.rows - 1) / spacing) + 1;
    const controls = Array.from({ length: controlRows }, () =>
      Array.from({ length: controlColumns }, () => random() * 2 - 1)
    );
    const interpolate = (start, end, amount) => start + (end - start) * amount;

    return Array.from({ length: this.rows }, (_, y) =>
      Array.from({ length: this.columns }, (_, x) => {
        const controlX = x / spacing;
        const controlY = y / spacing;
        const left = Math.floor(controlX);
        const top = Math.floor(controlY);
        const right = Math.min(controlColumns - 1, left + 1);
        const bottom = Math.min(controlRows - 1, top + 1);
        const horizontalAmount = controlX - left;
        const verticalAmount = controlY - top;
        const upper = interpolate(controls[top][left], controls[top][right], horizontalAmount);
        const lower = interpolate(controls[bottom][left], controls[bottom][right], horizontalAmount);
        return Math.round(baseDepth + interpolate(upper, lower, verticalAmount) * variation);
      })
    );
  }

  createStratigraphy() {
    const random = this.randomGenerator(0x9E3779B9);
    const referenceMaxDepth = Math.max(4, Math.round(this.maxDepth / this.depthResolutionScale));
    const variation = Math.max(1, Math.round(referenceMaxDepth / 8));
    const firstField = this.createSmoothBoundaryField(random, Math.round(referenceMaxDepth * 0.25), variation);
    const secondField = this.createSmoothBoundaryField(random, Math.round(referenceMaxDepth * 0.5), variation);
    const thirdField = this.createSmoothBoundaryField(random, Math.round(referenceMaxDepth * 0.75), variation);
    const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

    return Array.from({ length: this.rows }, (_, y) =>
      Array.from({ length: this.columns }, (_, x) => {
        const firstBoundary = clamp(firstField[y][x], 1, referenceMaxDepth - 3);
        const secondBoundary = clamp(secondField[y][x], firstBoundary + 1, referenceMaxDepth - 2);
        const thirdBoundary = clamp(thirdField[y][x], secondBoundary + 1, referenceMaxDepth - 1);
        return Array.from({ length: this.maxDepth }, (_, depth) => {
          const referenceDepth = Math.min(referenceMaxDepth - 1, Math.floor(depth / this.depthResolutionScale));
          if (referenceDepth < firstBoundary) return 0;
          if (referenceDepth < secondBoundary) return 1;
          if (referenceDepth < thirdBoundary) return 2;
          return 3;
        });
      })
    );
  }

  createFootprint(x, y, size = this.artefactFootprintSize) {
    const footprint = [];
    for (let offsetY = 0; offsetY < size; offsetY += 1) {
      for (let offsetX = 0; offsetX < size; offsetX += 1) footprint.push({ x: x + offsetX, y: y + offsetY });
    }
    return footprint;
  }

  footprintsOverlap(first, second) {
    return first.some((cell) => second.some((other) => cell.x === other.x && cell.y === other.y));
  }

  createArtefacts() {
    const random = this.randomGenerator(0xA5A5A5A5);
    const artefacts = [];
    const count = 2 + Math.floor(random() * 2);
    const size = this.artefactFootprintSize;
    const maxX = this.columns - size - 1;
    const maxY = this.rows - size - 1;
    const referenceMaxDepth = Math.max(4, Math.round(this.maxDepth / this.depthResolutionScale));

    for (let index = 0; index < count; index += 1) {
      let x = 1;
      let y = 1;
      let footprint = this.createFootprint(x, y, size);
      let attempts = 0;
      do {
        x = 1 + Math.floor(random() * maxX);
        y = 1 + Math.floor(random() * maxY);
        footprint = this.createFootprint(x, y, size);
        attempts += 1;
      } while (attempts < 80 && artefacts.some((artefact) => this.footprintsOverlap(footprint, artefact.footprint)));

      const item = this.config.artefactCatalog[(index + Math.floor(random() * this.config.artefactCatalog.length)) % this.config.artefactCatalog.length];
      const referenceDepth = 2 + Math.floor(random() * (referenceMaxDepth - 3));
      artefacts.push({
        id: `${this.id}-artefact-${index}`,
        label: item.label,
        shape: item.shape,
        colour: item.colour,
        x,
        y,
        centerX: x + (size - 1) / 2,
        centerY: y + (size - 1) / 2,
        footprint,
        depth: referenceDepth * this.depthResolutionScale,
        exposure: "hidden"
      });
    }
    return artefacts;
  }

  getDepth(x, y) {
    return this.depths[y]?.[x] ?? this.maxDepth;
  }

  isInside(x, y) {
    return x >= 0 && x < this.columns && y >= 0 && y < this.rows;
  }

  getStratumAt(x, y, depth) {
    if (!this.isInside(x, y) || depth >= this.maxDepth) return this.bedrock;
    return this.layers[this.stratigraphy[y][x][Math.max(0, depth)]];
  }

  getStratumAtAbsoluteDepth(x, y, depth) {
    const requestedDepth = Number.isFinite(depth) ? Math.floor(depth) : 0;
    const safeDepth = Math.max(0, Math.min(this.maxDepth, requestedDepth));
    return this.getStratumAt(x, y, safeDepth);
  }

  getSurfaceAt(x, y) {
    return this.getStratumAt(x, y, this.getDepth(x, y));
  }

  getSurfaceSignature(x, y) {
    const layer = this.getSurfaceAt(x, y);
    return `${this.getDepth(x, y)}:${layer.id}`;
  }

  bumpVisualRevision() {
    this.visualRevision += 1;
  }

  discoverLayer(layer) {
    if (layer?.id) this.discoveredLayerIds.add(layer.id);
  }

  registerVisibleSurfaces(cells) {
    cells.forEach((cell) => this.discoverLayer(this.getSurfaceAt(cell.x, cell.y)));
  }

  getDiscoveredLayers() {
    return [...this.layers, this.bedrock].filter((layer) => this.discoveredLayerIds.has(layer.id));
  }

  isBedrockAt(x, y) {
    return this.getDepth(x, y) >= this.maxDepth;
  }

  refreshArtefactExposures() {
    this.artefacts.forEach((artefact) => {
      if (artefact.exposure === "collected") return;
      if (artefact.footprint.every((cell) => this.getDepth(cell.x, cell.y) > artefact.depth)) artefact.exposure = "revealed";
    });
  }

  artefactIsRevealed(artefact) {
    return artefact.exposure === "revealed" || artefact.exposure === "collected";
  }

  isComplete() {
    return this.artefacts.every((artefact) => artefact.exposure === "collected");
  }

  remainingArtefacts() {
    return this.artefacts.filter((artefact) => artefact.exposure !== "collected").length;
  }

  circularCells(centerX, centerY, radius) {
    const cells = [];
    const startX = Math.max(0, Math.ceil(centerX - radius));
    const endX = Math.min(this.columns - 1, Math.floor(centerX + radius));
    const startY = Math.max(0, Math.ceil(centerY - radius));
    const endY = Math.min(this.rows - 1, Math.floor(centerY + radius));
    const radiusSquared = radius * radius + 1e-7;
    for (let y = startY; y <= endY; y += 1) {
      for (let x = startX; x <= endX; x += 1) {
        const distanceSquared = (x - centerX) ** 2 + (y - centerY) ** 2;
        if (distanceSquared <= radiusSquared) cells.push({ x, y, distanceSquared });
      }
    }
    return cells;
  }

  brushCells(centerX, centerY) {
    return this.circularCells(centerX, centerY, this.brushRadius);
  }

  highestRemovableCells(cells, depthAt = (cell) => this.getDepth(cell.x, cell.y)) {
    const removable = cells.filter((cell) => depthAt(cell) < this.maxDepth);
    if (!removable.length) return [];
    const highestDepth = Math.min(...removable.map(depthAt));
    return removable.filter((cell) => depthAt(cell) === highestDepth);
  }

  brushAt(centerX, centerY) {
    const cells = this.brushCells(centerX, centerY);
    const changedCells = this.highestRemovableCells(cells);
    if (!changedCells.length) return { changed: false, cells: [] };
    const removedLayers = changedCells.map((cell) => ({ ...cell, layer: this.getSurfaceAt(cell.x, cell.y) }));
    changedCells.forEach((cell) => { this.depths[cell.y][cell.x] += 1; });
    this.registerVisibleSurfaces(changedCells);
    this.refreshArtefactExposures();
    this.bumpVisualRevision();
    return { changed: true, cells: changedCells, removedLayers };
  }

  scoopCells(centerX, centerY) {
    return this.circularCells(centerX, centerY, this.scoopRadius);
  }

  strictRaisedComponents(cells, depthAt) {
    const footprint = new Map(cells.map((cell) => [`${cell.x}:${cell.y}`, cell]));
    const visited = new Set();
    const directions = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    const components = [];

    cells.forEach((start) => {
      const startKey = `${start.x}:${start.y}`;
      if (visited.has(startKey) || depthAt(start) >= this.maxDepth) return;
      const componentDepth = depthAt(start);
      const component = [];
      const queue = [start];
      visited.add(startKey);
      for (let index = 0; index < queue.length; index += 1) {
        const cell = queue[index];
        component.push(cell);
        directions.forEach(([dx, dy]) => {
          const key = `${cell.x + dx}:${cell.y + dy}`;
          const neighbour = footprint.get(key);
          if (!neighbour || visited.has(key) || depthAt(neighbour) !== componentDepth) return;
          visited.add(key);
          queue.push(neighbour);
        });
      }

      const componentKeys = new Set(component.map((cell) => `${cell.x}:${cell.y}`));
      let hasBoundary = false;
      const isStrictlyRaised = component.every((cell) => directions.every(([dx, dy]) => {
        const x = cell.x + dx;
        const y = cell.y + dy;
        if (!this.isInside(x, y)) return true;
        if (componentKeys.has(`${x}:${y}`)) return true;
        hasBoundary = true;
        const neighbour = footprint.get(`${x}:${y}`);
        const neighbourDepth = neighbour ? depthAt(neighbour) : this.getDepth(x, y);
        return neighbourDepth > componentDepth;
      }));
      if (hasBoundary && isStrictlyRaised) components.push(component);
    });
    return components;
  }

  buildScoopPlan(centerX, centerY) {
    const cells = this.scoopCells(centerX, centerY);
    const simulatedDepths = new Map(cells.map((cell) => [`${cell.x}:${cell.y}`, this.getDepth(cell.x, cell.y)]));
    const depthAt = (cell) => simulatedDepths.get(`${cell.x}:${cell.y}`);
    const steps = [];
    const addStep = (cell) => {
      const fromDepth = depthAt(cell);
      if (fromDepth >= this.maxDepth) return;
      const toDepth = fromDepth + 1;
      steps.push({ x: cell.x, y: cell.y, fromDepth, toDepth });
      simulatedDepths.set(`${cell.x}:${cell.y}`, toDepth);
    };

    cells.forEach(addStep);
    for (let pass = 0; pass < this.scoopPillarExtraDepth; pass += 1) {
      const raisedComponents = this.strictRaisedComponents(cells, depthAt);
      if (!raisedComponents.length) break;
      raisedComponents.forEach((component) => component.forEach(addStep));
    }
    return { centerX, centerY, cells, steps };
  }

  protectedArtefactForSteps(steps) {
    return this.artefacts.find((artefact) => {
      if (artefact.exposure === "collected") return false;
      return artefact.footprint.some((artefactCell) =>
        steps.some((step) => step.x === artefactCell.x && step.y === artefactCell.y && step.fromDepth >= artefact.depth)
      );
    });
  }

  canScoop(centerX, centerY) {
    const plan = this.buildScoopPlan(centerX, centerY);
    if (!plan.steps.length) return { allowed: false, reason: "Bedrock has been reached here.", plan };
    const protectedArtefact = this.protectedArtefactForSteps(plan.steps);
    if (protectedArtefact) return { allowed: false, reason: "A find is emerging here, use the brush to carefully expose it.", artefact: protectedArtefact };
    const soilColours = plan.steps.map((step) => this.getStratumAtAbsoluteDepth(step.x, step.y, step.fromDepth).colour);
    return { allowed: true, cells: plan.cells, steps: plan.steps, soilColours, plan };
  }

  partiallyExpose(artefact) {
    if (artefact && artefact.exposure === "hidden") {
      artefact.exposure = "partial";
      this.bumpVisualRevision();
    }
  }

  scoop(centerX, centerY) {
    const result = this.canScoop(centerX, centerY);
    if (!result.allowed) return result;
    result.steps.forEach((step) => {
      this.depths[step.y][step.x] = step.toDepth;
      this.discoverLayer(this.getStratumAtAbsoluteDepth(step.x, step.y, step.toDepth));
    });
    this.refreshArtefactExposures();
    this.bumpVisualRevision();
    return { allowed: true, cells: result.cells, steps: result.steps, soilColours: result.soilColours, reason: "Soil set aside." };
  }

  collectAt(x, y) {
    const artefact = this.artefacts.find(
      (item) => item.exposure === "revealed" && item.footprint.some((cell) => cell.x === x && cell.y === y)
    );
    if (!artefact) return null;
    artefact.exposure = "collected";
    this.bumpVisualRevision();
    return artefact;
  }
};
