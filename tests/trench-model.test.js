const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/game/TrenchModel.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../data/game-config.js"), "utf8"), sandbox);
const TrenchModel = sandbox.window.TrenchModel;
const gameConfig = sandbox.window.GameConfig;

function configFor(maxDepth = 16, depthResolutionScale = 2, artefactCountMultiplier = 1) {
  return {
    trench: {
      columns: 20,
      rows: 20,
      maxDepth,
      depthResolutionScale,
      maxDepthDarkening: 0.16,
      artefactFootprintSize: 2,
      artefactCountMultiplier,
      brushRadius: 1,
      brushTravelPerStampCells: 3,
      scoopRadius: 3,
      scoopPillarExtraDepth: 1
    },
    layers: [
      { name: "Topsoil", pattern: "dots" },
      { name: "Sandy silt", pattern: "lines" },
      { name: "Clay", pattern: "specks" },
      { name: "Gravel", pattern: "dots" }
    ],
    layerPalettes: [["#8b603b", "#c79a5d", "#a65e48", "#6f6b62"]],
    bedrock: { name: "Bedrock", colour: "#5c6873", pattern: "cracks" },
    artefactCatalog: [{ label: "Test find", shape: "coin", colour: "#d5ae45" }]
  };
}

function model() {
  const config = configFor();
  const trench = new TrenchModel({ id: "test", seed: 173, label: "Test", layerVariant: 0 }, config);
  trench.artefacts = [];
  return trench;
}

test("sixteen-level trenches duplicate seeded reference strata and artefact depths proportionally", () => {
  const definition = { id: "scaled", seed: 173, label: "Scaled", layerVariant: 0 };
  const reference = new TrenchModel(definition, configFor(8, 1));
  const detailed = new TrenchModel(definition, configFor(16, 2));

  assert.equal(detailed.maxDepth, 16);
  for (let y = 0; y < detailed.rows; y += 1) {
    for (let x = 0; x < detailed.columns; x += 1) {
      for (let depth = 0; depth < reference.maxDepth; depth += 1) {
        assert.equal(detailed.stratigraphy[y][x][depth * 2], reference.stratigraphy[y][x][depth]);
        assert.equal(detailed.stratigraphy[y][x][depth * 2 + 1], reference.stratigraphy[y][x][depth]);
      }
    }
  }

  assert.equal(detailed.artefacts.length, reference.artefacts.length);
  detailed.artefacts.forEach((artefact, index) => {
    const original = reference.artefacts[index];
    assert.equal(artefact.x, original.x);
    assert.equal(artefact.y, original.y);
    assert.equal(artefact.label, original.label);
    assert.equal(artefact.depth, original.depth * 2);
  });
});

test("the testing multiplier doubles the seeded artefact set without overlapping footprints", () => {
  const definition = { id: "doubled", seed: 173, label: "Doubled", layerVariant: 0 };
  const reference = new TrenchModel(definition, configFor(16, 2, 1));
  const doubled = new TrenchModel(definition, configFor(16, 2, 2));

  assert.ok(reference.artefacts.length >= 2 && reference.artefacts.length <= 3);
  assert.equal(doubled.artefacts.length, reference.artefacts.length * 2);
  assert.ok(doubled.artefacts.length >= 4 && doubled.artefacts.length <= 6);
  reference.artefacts.forEach((artefact, index) => {
    const duplicateSequence = doubled.artefacts[index];
    assert.equal(duplicateSequence.label, artefact.label);
    assert.equal(duplicateSequence.depth, artefact.depth);
    assert.deepEqual(JSON.parse(JSON.stringify(duplicateSequence.footprint)), JSON.parse(JSON.stringify(artefact.footprint)));
  });
  doubled.artefacts.forEach((artefact, index) => {
    doubled.artefacts.slice(index + 1).forEach((other) => {
      assert.equal(doubled.footprintsOverlap(artefact.footprint, other.footprint), false);
    });
  });
});

test("every configured trench creates four to six non-overlapping artefacts", () => {
  gameConfig.trenches.forEach((definition) => {
    const trench = new TrenchModel(definition, gameConfig);
    assert.ok(trench.artefacts.length >= 4 && trench.artefacts.length <= 6);
    trench.artefacts.forEach((artefact, index) => {
      trench.artefacts.slice(index + 1).forEach((other) => {
        assert.equal(trench.footprintsOverlap(artefact.footprint, other.footprint), false);
      });
    });
  });
});

test("sediment boundaries form contiguous bands with only gentle neighbouring variation", () => {
  const trench = new TrenchModel(
    { id: "bands", seed: 173, label: "Bands", layerVariant: 0 },
    configFor(16, 2)
  );
  const directions = [[1, 0], [0, 1]];
  let matchingSamples = 0;
  let totalSamples = 0;

  const transitionDepth = (x, y, layerIndex) => trench.stratigraphy[y][x].findIndex(
    (visibleLayer) => visibleLayer === layerIndex
  );

  for (let y = 0; y < trench.rows; y += 1) {
    for (let x = 0; x < trench.columns; x += 1) {
      directions.forEach(([dx, dy]) => {
        const neighbourX = x + dx;
        const neighbourY = y + dy;
        if (neighbourX >= trench.columns || neighbourY >= trench.rows) return;
        for (let depth = 0; depth < trench.maxDepth; depth += 1) {
          matchingSamples += trench.stratigraphy[y][x][depth] === trench.stratigraphy[neighbourY][neighbourX][depth];
          totalSamples += 1;
        }
        for (let layerIndex = 1; layerIndex < trench.layers.length; layerIndex += 1) {
          assert.ok(
            Math.abs(transitionDepth(x, y, layerIndex) - transitionDepth(neighbourX, neighbourY, layerIndex)) <=
              trench.depthResolutionScale,
            "a boundary may vary by no more than one reference depth between neighbours"
          );
        }
      });
    }
  }

  assert.ok(matchingSamples / totalSamples > 0.9, "most adjacent sediment samples should remain in the same band");
});

function key(cell) {
  return `${cell.x}:${cell.y}`;
}

test("circular tool footprints are centred, symmetric, and edge-clipped", () => {
  const trench = model();
  const brush = new Set(trench.brushCells(10, 10).map(key));
  const scoop = new Set(trench.scoopCells(10, 10).map(key));

  assert.equal(brush.size, 5);
  ["10:10", "9:10", "11:10", "10:9", "10:11"].forEach((cell) => assert.ok(brush.has(cell)));
  assert.equal(scoop.size, 29);
  assert.ok(scoop.has("12:12"), "Euclidean diagonal omitted by the old Manhattan diamond is included");
  assert.equal(scoop.has("13:11"), false, "a cell outside radius three is excluded");
  assert.ok(trench.scoopCells(0, 0).every((cell) => cell.x >= 0 && cell.y >= 0));
});

test("brush strokes level the highest cells before digging a flat area deeper", () => {
  const trench = model();
  const footprint = trench.brushCells(10, 10);
  footprint.forEach((cell) => { trench.depths[cell.y][cell.x] = 0; });
  trench.depths[10][10] = 1;

  const first = trench.brushAt(10, 10);
  assert.equal(first.cells.length, 4);
  assert.ok(footprint.every((cell) => trench.getDepth(cell.x, cell.y) === 1));

  const second = trench.brushAt(10, 10);
  assert.equal(second.cells.length, 5);
  assert.ok(footprint.every((cell) => trench.getDepth(cell.x, cell.y) === 2));
});

test("terrain revisions advance only for successful depth mutations", () => {
  const trench = model();
  assert.equal(trench.terrainRevision, 0);
  assert.equal(trench.visualRevision, 0);

  const brushed = trench.brushAt(10, 10);
  assert.equal(brushed.changed, true);
  assert.equal(trench.terrainRevision, 1);
  assert.equal(trench.visualRevision, 1);

  const artefact = {
    id: "revision-find",
    depth: 0,
    exposure: "hidden",
    footprint: [{ x: 0, y: 0 }]
  };
  trench.artefacts = [artefact];
  trench.partiallyExpose(artefact);
  assert.equal(trench.terrainRevision, 1, "partial exposure changes overlays, not terrain");
  assert.equal(trench.visualRevision, 2);

  artefact.exposure = "revealed";
  assert.equal(trench.collectAt(0, 0), artefact);
  assert.equal(trench.terrainRevision, 1, "collection changes overlays, not terrain");
  assert.equal(trench.visualRevision, 3);

  const shovelled = trench.scoop(15, 15);
  assert.equal(shovelled.allowed, true);
  assert.equal(trench.terrainRevision, 2);
  assert.equal(trench.visualRevision, 4);
});

test("blocked excavation does not advance either revision", () => {
  const brushedTrench = model();
  brushedTrench.brushCells(10, 10).forEach((cell) => {
    brushedTrench.depths[cell.y][cell.x] = brushedTrench.maxDepth;
  });
  assert.equal(brushedTrench.brushAt(10, 10).changed, false);
  assert.equal(brushedTrench.terrainRevision, 0);
  assert.equal(brushedTrench.visualRevision, 0);

  const shovelledTrench = model();
  shovelledTrench.artefacts = [{
    id: "protected-revision-find",
    depth: 0,
    exposure: "hidden",
    footprint: [{ x: 10, y: 10 }]
  }];
  assert.equal(shovelledTrench.scoop(10, 10).allowed, false);
  assert.equal(shovelledTrench.terrainRevision, 0);
  assert.equal(shovelledTrench.visualRevision, 0);
});

test("a flat scoop removes one complete circular level at standard throughput", () => {
  const trench = model();
  const plan = trench.buildScoopPlan(10, 10);
  const outer = trench.scoopCells(10, 10);

  assert.equal(outer.length, 29);
  assert.equal(plan.steps.length, 29);
  const result = trench.scoop(10, 10);
  assert.equal(result.allowed, true);
  assert.ok(outer.every((cell) => trench.getDepth(cell.x, cell.y) === 1));
});

test("a scoop removes its full layer and gives an isolated raised cell one cleanup step", () => {
  const trench = model();
  const outer = trench.scoopCells(10, 10);
  outer.forEach((cell) => { trench.depths[cell.y][cell.x] = 2; });
  trench.depths[10][10] = 0;

  const plan = trench.buildScoopPlan(10, 10);
  assert.equal(plan.steps.length, 30);
  assert.equal(plan.steps.filter((step) => step.x === 10 && step.y === 10).length, 2);
  trench.scoop(10, 10);
  assert.equal(trench.getDepth(10, 10), 2);
  assert.ok(outer.filter((cell) => cell.x !== 10 || cell.y !== 10).every((cell) => trench.getDepth(cell.x, cell.y) === 3));
});

test("large fully contained raised components receive the cleanup pass", () => {
  const trench = model();
  const outer = trench.scoopCells(10, 10);
  outer.forEach((cell) => { trench.depths[cell.y][cell.x] = 4; });
  const plateau = [{ x: 9, y: 9 }, { x: 10, y: 9 }, { x: 11, y: 9 }, { x: 9, y: 10 }, { x: 10, y: 10 }, { x: 11, y: 10 }];
  plateau.forEach((cell) => { trench.depths[cell.y][cell.x] = 1; });

  const plan = trench.buildScoopPlan(10, 10);
  assert.equal(plan.steps.length, 29 + plateau.length);
  plateau.forEach((cell) => {
    assert.equal(plan.steps.filter((step) => step.x === cell.x && step.y === cell.y).length, 2);
  });
});

test("a raised component connected outside the scoop receives no partial cleanup", () => {
  const trench = model();
  const outer = trench.scoopCells(10, 10);
  outer.forEach((cell) => { trench.depths[cell.y][cell.x] = 4; });
  for (let x = 10; x <= 14; x += 1) trench.depths[10][x] = 1;

  const plan = trench.buildScoopPlan(10, 10);
  assert.equal(plan.steps.length, 29);
  assert.equal(plan.steps.filter((step) => step.y === 10 && step.x >= 10 && step.x <= 13).length, 4);
});

test("artefact contact in the pillar cleanup rejects the complete atomic plan", () => {
  const trench = model();
  trench.scoopCells(10, 10).forEach((cell) => { trench.depths[cell.y][cell.x] = 2; });
  trench.depths[10][10] = 0;
  trench.artefacts = [{
    id: "protected",
    depth: 1,
    exposure: "hidden",
    footprint: [{ x: 10, y: 10 }]
  }];
  const before = trench.depths.map((row) => [...row]);

  const check = trench.canScoop(10, 10);
  assert.equal(check.allowed, false);
  assert.equal(check.artefact.id, "protected");
  const result = trench.scoop(10, 10);
  assert.equal(result.allowed, false);
  assert.equal(JSON.stringify(trench.depths), JSON.stringify(before));
});

test("artefact contact in the primary scoop pass also rejects the complete plan", () => {
  const trench = model();
  trench.artefacts = [{
    id: "surface-find",
    depth: 0,
    exposure: "hidden",
    footprint: [{ x: 10, y: 10 }]
  }];
  const before = JSON.stringify(trench.depths);

  const result = trench.scoop(10, 10);
  assert.equal(result.allowed, false);
  assert.equal(result.artefact.id, "surface-find");
  assert.equal(JSON.stringify(trench.depths), before);
});

test("grass cover uses deterministic exact coverage and remains one connected patch", () => {
  const expectedCounts = new Map([[0, 0], [0.5, 200], [1, 400]]);
  for (const coverage of [0, 0.5, 1]) {
    const definition = { id: `grass-${coverage}`, seed: 719, label: "Grass", layerVariant: 0, grassCoverage: coverage };
    const first = new TrenchModel(definition, configFor());
    const second = new TrenchModel(definition, configFor());
    const covered = [];
    first.grassMask.forEach((row, y) => row.forEach((value, x) => {
      if (value) covered.push({ x, y });
    }));
    assert.equal(covered.length, expectedCounts.get(coverage));
    assert.equal(JSON.stringify(first.grassMask), JSON.stringify(second.grassMask));

    if (covered.length) {
      const queued = [covered[0]];
      const visited = new Set([`${covered[0].x}:${covered[0].y}`]);
      while (queued.length) {
        const current = queued.shift();
        [[1, 0], [0, 1], [-1, 0], [0, -1]].forEach(([dx, dy]) => {
          const x = current.x + dx;
          const y = current.y + dy;
          const key = `${x}:${y}`;
          if (!first.grassMask[y]?.[x] || visited.has(key)) return;
          visited.add(key);
          queued.push({ x, y });
        });
      }
      assert.equal(visited.size, covered.length);
    }
  }
});

test("grass is render-only and disappears after the first excavation increment", () => {
  const trench = new TrenchModel(
    { id: "turf", seed: 173, label: "Turf", layerVariant: 0, grassCoverage: 1 },
    configFor()
  );
  trench.artefacts = [];
  const geologicalSurface = trench.getSurfaceAt(10, 10);
  assert.equal(geologicalSurface.id, "layer-0");
  assert.equal(trench.getRenderableSurfaceAt(10, 10).id, "grass");
  trench.depths[10][10] = 1;
  assert.equal(trench.getRenderableSurfaceAt(10, 10).id, trench.getSurfaceAt(10, 10).id);
  assert.equal(trench.maxDepth, 16, "the cover does not add an excavation level");
});

test("emerging artefacts expose their matching footprint quadrants before full reveal", () => {
  const trench = model();
  const footprint = trench.createFootprint(6, 7, 2);
  const artefact = { id: "quadrants", depth: 4, exposure: "hidden", footprint };
  trench.artefacts = [artefact];
  footprint.forEach((cell) => { trench.depths[cell.y][cell.x] = 3; });

  const combinations = [[0], [1, 2], [0, 1, 2], [0, 1, 2, 3]];
  combinations.forEach((visible) => {
    footprint.forEach((cell, index) => { trench.depths[cell.y][cell.x] = visible.includes(index) ? 4 : 3; });
    artefact.exposure = "hidden";
    trench.refreshArtefactExposures();
    assert.deepEqual(Array.from(trench.artefactVisibleQuadrants(artefact)), visible);
    assert.equal(artefact.exposure, "partial");
  });

  footprint.forEach((cell) => { trench.depths[cell.y][cell.x] = 5; });
  trench.refreshArtefactExposures();
  assert.equal(artefact.exposure, "revealed");
  assert.deepEqual(Array.from(trench.artefactVisibleQuadrants(artefact)), [0, 1, 2, 3]);
});

test("legacy partial artefacts receive one deterministic visible quadrant", () => {
  const trench = model();
  const artefact = { id: "legacy-partial", depth: 8, exposure: "partial", footprint: trench.createFootprint(4, 4, 2) };
  artefact.footprint.forEach((cell) => { trench.depths[cell.y][cell.x] = 0; });
  const first = Array.from(trench.artefactVisibleQuadrants(artefact));
  assert.equal(first.length, 1);
  assert.deepEqual(first, Array.from(trench.artefactVisibleQuadrants(artefact)));
});

test("shovel plans report removed materials and their average clump weight", () => {
  const settings = configFor();
  settings.trench.materialClumpWeights = {
    "layer-0": 0.8,
    "layer-1": 1,
    "layer-2": 1.35,
    "layer-3": 1.6
  };
  const trench = new TrenchModel({ id: "weighted", seed: 173, label: "Weighted", layerVariant: 0 }, settings);
  trench.artefacts = [];
  trench.scoopCells(10, 10).forEach((cell, index) => {
    trench.depths[cell.y][cell.x] = index % 2 ? 0 : 8;
  });

  const check = trench.canScoop(10, 10);
  assert.equal(check.allowed, true);
  assert.equal(check.materialIds.length, check.steps.length);
  const weights = new Map(trench.layers.map((layer) => [layer.id, layer.clumpWeight]));
  const expected = check.materialIds.reduce((sum, id) => sum + weights.get(id), 0) / check.materialIds.length;
  assert.ok(Math.abs(check.clumpWeight - expected) < 1e-12);
});
