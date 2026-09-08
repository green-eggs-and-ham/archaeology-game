const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const sandbox = {
  redraw() {},
  window: {
    GameRenderer: class GameRenderer {},
    TrenchModel: class TrenchModel {}
  }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../data/game-config.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/game/CleaningModel.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../src/game/SceneManager.js"), "utf8"), sandbox);

const CleaningModel = sandbox.window.CleaningModel;
const config = sandbox.window.GameConfig;
const jsonConfig = JSON.parse(fs.readFileSync(path.join(__dirname, "../data/game-config.json"), "utf8"));

function variant(id) {
  return config.artefactCategories.flatMap((category) => category.variants.map((item) => ({ ...item, category: category.id })))
    .find((item) => item.id === id);
}

function artefact(id = "folded-beaker", instanceId = "test-find") {
  const item = variant(id);
  return {
    ...item,
    id: instanceId,
    variantId: item.id,
    cleaning: { status: "dirty", location: "inventory", activeFace: "front", faces: null }
  };
}

function cleanFace(model, item, face) {
  const spots = item.cleaning.faces[face];
  const required = Math.ceil(spots.length * model.completionRatio);
  const passes = item.cleaningTool === "fine-brush" ? 2 : 1;
  for (let pass = 0; pass < passes; pass += 1) {
    spots.slice(0, required).forEach((spot) => {
      model.clearAlongSegment(item, face, spot, spot, item.cleaningTool);
    });
  }
}

test("pottery and coin variants preserve four equally weighted find categories", () => {
  assert.equal(config.artefactCategories.length, 4);
  assert.deepEqual(Array.from(config.artefactCategories, (category) => category.weight), [1, 1, 1, 1]);
  assert.equal(config.artefactCategories.find((category) => category.id === "pottery").variants.length, 6);
  assert.equal(config.artefactCategories.find((category) => category.id === "coin").variants.length, 4);
});

test("the JavaScript and JSON cleaning catalogues stay in sync", () => {
  assert.deepEqual(jsonConfig.cleaning, JSON.parse(JSON.stringify(config.cleaning)));
  assert.deepEqual(jsonConfig.artefactCategories, JSON.parse(JSON.stringify(config.artefactCategories)));
  assert.equal(jsonConfig.trench.artefactCountMultiplier, config.trench.artefactCountMultiplier);
});

test("every cleanable variant has a fixed care profile and two supported faces", () => {
  const cleanable = config.artefactCategories.flatMap((category) => category.variants).filter((item) => item.cleanable);
  assert.equal(cleanable.length, 10);
  cleanable.forEach((item) => {
    assert.ok(["toothbrush", "fine-brush"].includes(item.cleaningTool));
    assert.ok(item.robustness);
    assert.ok(item.material);
    assert.ok(["identification", "specialist-treatment"].includes(item.postCleaningTreatment));
    const model = new CleaningModel(config.cleaning);
    const state = model.ensureState(artefact(item.id, `instance:${item.id}`));
    assert.equal(state.faces.front.length, 48);
    assert.equal(state.faces.back.length, 48);
  });
});

test("dirt placement is deterministic per artefact and independent between faces", () => {
  const model = new CleaningModel(config.cleaning);
  const first = artefact("mortarium", "same-id");
  const second = artefact("mortarium", "same-id");
  model.ensureState(first);
  model.ensureState(second);
  assert.deepEqual(
    JSON.parse(JSON.stringify(first.cleaning.faces.front)),
    JSON.parse(JSON.stringify(second.cleaning.faces.front))
  );
  assert.notDeepEqual(
    JSON.parse(JSON.stringify(first.cleaning.faces.front)),
    JSON.parse(JSON.stringify(first.cleaning.faces.back))
  );
});

test("a find must be wet and on the mat before a safe brush can clean it", () => {
  const model = new CleaningModel(config.cleaning);
  const item = artefact("mortarium");
  model.ensureState(item);
  const spot = item.cleaning.faces.front[0];
  assert.equal(model.clearAlongSegment(item, "front", spot, spot, "toothbrush").changed, false);
  assert.equal(model.immerse(item), true);
  assert.equal(model.placeOnMat(item), true);
  assert.equal(model.clearAlongSegment(item, "front", spot, spot, "fine-brush").changed, true);
  assert.equal(model.clearAlongSegment(item, "front", spot, spot, "toothbrush").changed, true);
});

test("fine brushing is slower per deliberate stroke while robust finds accept either tool", () => {
  const model = new CleaningModel(config.cleaning);
  const robust = artefact("mortarium", "robust-speed");
  model.ensureState(robust);
  model.immerse(robust);
  model.placeOnMat(robust);
  const spot = robust.cleaning.faces.front[0];
  const contacted = new Set();

  assert.equal(model.canUseTool(robust, "toothbrush"), true);
  assert.equal(model.canUseTool(robust, "fine-brush"), true);
  const first = model.clearAlongSegment(robust, "front", spot, spot, "fine-brush", contacted);
  assert.equal(first.affectedSpots[0].amount, 0.5);
  assert.equal(spot.remaining, 0.5);
  assert.equal(model.clearAlongSegment(robust, "front", spot, spot, "fine-brush", contacted).changed, false);
  assert.equal(spot.remaining, 0.5, "one continuous stroke cannot repeatedly clean the same fleck");
  model.clearAlongSegment(robust, "front", spot, spot, "fine-brush", new Set());
  assert.equal(spot.remaining, 0);

  const delicate = artefact("hadrian-denarius", "delicate-safety");
  model.ensureState(delicate);
  assert.equal(model.canUseTool(delicate, "toothbrush"), false);
  assert.equal(model.canUseTool(delicate, "fine-brush"), true);
});

test("immersion records persistent dampness", () => {
  const model = new CleaningModel(config.cleaning);
  const item = artefact("mortarium", "dampened");
  model.ensureState(item);
  assert.equal(item.cleaning.dampened, undefined);
  assert.equal(model.immerse(item), true);
  assert.equal(item.cleaning.dampened, true);
});

test("eight deliberate handwashing dunks clean the visible face and wash the reverse at reduced power", () => {
  const model = new CleaningModel(config.cleaning);
  const item = artefact("decorated-samian", "handwashed");
  model.ensureState(item);
  assert.equal(model.dampen(item), true);

  for (let dunk = 0; dunk < 7; dunk += 1) {
    const result = model.handwashDunk(item, "front");
    assert.equal(result.changed, true);
    assert.equal(result.faceComplete, false);
    assert.equal(result.affectedSpots.length, config.cleaning.dirtSpotsPerFace * 2);
    assert.equal(result.affectedSpots.filter((spot) => spot.face === "front").length, config.cleaning.dirtSpotsPerFace);
    assert.equal(result.affectedSpots.filter((spot) => spot.face === "back").length, config.cleaning.dirtSpotsPerFace);
  }
  assert.equal(model.progress(item, "front"), 0.875);
  assert.equal(model.progress(item, "back"), 0.65625);
  const final = model.handwashDunk(item, "front");
  assert.equal(final.faceComplete, true);
  assert.equal(model.progress(item, "front"), 1);
  assert.equal(model.progress(item, "back"), 0.75);
  assert.equal(item.cleaning.status, "wet");
});

test("handwashing both faces preserves the specialist return workflow", () => {
  const model = new CleaningModel(config.cleaning);
  const item = artefact("victorinus-radiate", "handwashed-specialist");
  model.ensureState(item);
  model.dampen(item);
  for (const face of ["front", "back"]) {
    for (let dunk = 0; dunk < 8; dunk += 1) model.handwashDunk(item, face);
  }
  assert.equal(item.cleaning.status, "ready-to-return");
  assert.equal(model.returnToInventory(item), true);
  assert.equal(item.cleaning.status, "awaiting-specialist");
});

test("beads and arrowheads remain visible inventory finds but cannot enter cleaning state", () => {
  const model = new CleaningModel(config.cleaning);
  for (const id of ["glass-bead", "arrowhead"]) {
    const item = artefact(id, `unsupported:${id}`);
    assert.equal(item.cleanable, false);
    assert.equal(model.ensureState(item), null);
    assert.equal(model.immerse(item), false);
  }
});

test("front and back clean independently and both are required for return", () => {
  const model = new CleaningModel(config.cleaning);
  const item = artefact("decorated-samian");
  model.ensureState(item);
  model.immerse(item);
  model.placeOnMat(item);
  cleanFace(model, item, "front");
  assert.equal(model.faceComplete(item, "front"), true);
  assert.equal(model.faceComplete(item, "back"), false);
  assert.equal(item.cleaning.status, "wet");
  cleanFace(model, item, "back");
  assert.equal(item.cleaning.status, "ready-to-return");
});

test("standard and specialist finds return to their correct inventory states", () => {
  const model = new CleaningModel(config.cleaning);
  const standard = artefact("hadrian-denarius", "standard");
  const specialist = artefact("victorinus-radiate", "specialist");
  for (const item of [standard, specialist]) {
    model.ensureState(item);
    model.immerse(item);
    model.placeOnMat(item);
    cleanFace(model, item, "front");
    cleanFace(model, item, "back");
    assert.equal(model.returnToInventory(item), true);
  }
  assert.equal(standard.cleaning.status, "ready-to-identify");
  assert.equal(specialist.cleaning.status, "awaiting-specialist");
});

test("shared inventory returns collected artefact objects without copying them", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  const first = { id: "first", exposure: "collected" };
  const second = { id: "second", exposure: "revealed" };
  manager.trenches = [{ artefacts: [first, second] }, { artefacts: [] }];
  const inventory = manager.allCollectedArtefacts();
  assert.deepEqual(inventory, [first]);
  assert.equal(inventory[0], first);
});

test("inventory sorting always includes every find and prioritises cleanable types by default", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  manager.cleaningModel = new CleaningModel(config.cleaning);
  manager.pointerAction = null;
  manager.layout = { isPortrait: true };

  const dirty = artefact("mortarium", "dirty-item");
  dirty.label = "Zulu sherd";
  const specialist = artefact("victorinus-radiate", "specialist-item");
  specialist.label = "Bronze coin";
  specialist.cleaning.status = "awaiting-specialist";
  const identify = artefact("hadrian-denarius", "identify-item");
  identify.label = "Alpha coin";
  identify.cleaning.status = "ready-to-identify";
  const unavailable = artefact("glass-bead", "unavailable-item");
  unavailable.label = "Glass bead";
  const intermediate = artefact("decorated-samian", "intermediate-item");
  intermediate.label = "Wet sherd";
  intermediate.cleaning.status = "wet";
  intermediate.cleaning.location = "inventory";
  const active = artefact("storage-jar", "active-item");
  active.label = "Bench find";
  active.cleaning.status = "wet";
  active.cleaning.location = "mat";
  const finds = [dirty, specialist, identify, unavailable, intermediate, active];
  finds.forEach((item) => { item.exposure = "collected"; });
  manager.trenches = [{ artefacts: finds }];
  manager.collectionOrderByArtefactId = new Map(finds.map((item, index) => [item.id, index]));

  manager.cleaningInventorySort = "type";
  assert.deepEqual(
    Array.from(manager.cleaningInventoryArtefacts()),
    [identify, specialist, intermediate, dirty, unavailable]
  );
  manager.cleaningInventorySort = "name";
  assert.deepEqual(
    Array.from(manager.cleaningInventoryArtefacts(), (item) => item.label),
    ["Alpha coin", "Bronze coin", "Glass bead", "Wet sherd", "Zulu sherd"]
  );
  manager.cleaningInventorySort = "status";
  assert.deepEqual(
    Array.from(manager.cleaningInventoryArtefacts()),
    [dirty, intermediate, specialist, identify, unavailable]
  );
  manager.cleaningInventorySort = "collection";
  assert.deepEqual(
    Array.from(manager.cleaningInventoryArtefacts()),
    [dirty, specialist, identify, unavailable, intermediate]
  );
  assert.equal(JSON.stringify(manager.cleaningInventoryGrid(true)), JSON.stringify({ columns: 3, rows: 1 }));
  assert.equal(JSON.stringify(manager.cleaningInventoryGrid(false)), JSON.stringify({ columns: 1, rows: 6 }));
  assert.equal(manager.portraitInventoryLabel("Verulamium flagon sherd").replace("\n", " "), "Verulamium flagon sherd");
});

test("pending cleaning badges count unfinished cleanable workflows only", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  manager.cleaningModel = new CleaningModel(config.cleaning);
  const states = ["dirty", "wet", "ready-to-return", "ready-to-identify", "awaiting-specialist"];
  const finds = states.map((status, index) => {
    const item = artefact("mortarium", `pending-${index}`);
    item.exposure = "collected";
    item.cleaning.status = status;
    return item;
  });
  const unavailable = artefact("glass-bead", "pending-unavailable");
  unavailable.exposure = "collected";
  manager.trenches = [{ artefacts: [...finds, unavailable] }];

  assert.equal(manager.pendingCleaningCount(), 3);
});

test("choosing an inventory sort closes the chooser and resets pagination", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  manager.layout = {
    labBackButton: { x: -100, y: -100, width: 1, height: 1 },
    inventorySortOptions: [{ sort: "status", bounds: { x: 10, y: 10, width: 80, height: 44 } }]
  };
  manager.cleaningInventorySortChooserOpen = true;
  manager.cleaningInventorySort = "type";
  manager.cleaningInventoryPage = 4;
  manager.pointerAction = null;
  manager.cleaningInventorySortLabel = () => "Cleaning status";

  manager.cleaningPointerStart(20, 20);
  assert.equal(manager.cleaningInventorySort, "status");
  assert.equal(manager.cleaningInventoryPage, 0);
  assert.equal(manager.cleaningInventorySortChooserOpen, false);
});

test("portrait mat controls and bucket stay inside their stacked panels", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  for (const [canvasWidth, canvasHeight] of [[320, 427], [390, 520], [560, 747]]) {
    sandbox.width = canvasWidth;
    sandbox.height = canvasHeight;
    const layout = manager.cleaningLayout();
    assert.equal(layout.isPortrait, true);
    assert.ok(layout.mat.height > 0);
    assert.ok(layout.matSurface.height >= 48);
    assert.ok(layout.matSurface.y >= layout.flipButton.y + layout.flipButton.height);
    assert.ok(layout.flipButton.y + layout.flipButton.height <= layout.mat.y + layout.mat.height);
    assert.ok(layout.bucket.y >= layout.mat.y + layout.mat.height);
    assert.ok(layout.bucket.y + layout.bucket.height <= canvasHeight - 9.9);
    const controls = [layout.handButton, layout.toothbrushButton, layout.fineBrushButton, layout.flipButton];
    controls.forEach((button, index) => {
      assert.ok(button.x >= layout.mat.x);
      assert.ok(button.x + button.width <= layout.mat.x + layout.mat.width);
      if (index) assert.ok(button.x >= controls[index - 1].x + controls[index - 1].width);
    });
  }
});

test("landscape uses a readable six-row inventory beside a mat-over-bucket workspace", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  sandbox.width = 960;
  sandbox.height = 540;
  const layout = manager.cleaningLayout();
  assert.equal(layout.isPortrait, false);
  assert.deepEqual(JSON.parse(JSON.stringify(manager.cleaningInventoryGrid(false))), { columns: 1, rows: 6 });
  assert.ok(layout.mat.x >= layout.inventory.x + layout.inventory.width);
  assert.ok(layout.bucket.y >= layout.mat.y + layout.mat.height);
  assert.equal(layout.bucket.x, layout.mat.x);
  assert.equal(layout.bucket.width, layout.mat.width);
});

test("mat and bucket artefacts share one size and a held find never shrinks", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  sandbox.width = 960;
  sandbox.height = 540;
  manager.layout = manager.cleaningLayout();
  const matSize = manager.cleaningItemSize("mat");
  const bucketSize = manager.cleaningItemSize("bucket");
  assert.equal(matSize, bucketSize);
  const action = { type: "cleaning-item", artefact: {}, x: 100, y: 100, displaySize: matSize * 1.08 };
  assert.ok(manager.cleaningDraggedItemBounds(action).size > matSize);
});

test("manual drops enforce inventory to bucket to mat to inventory", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  const model = new CleaningModel(config.cleaning);
  const item = artefact("augustus-as", "manual-sequence");
  model.ensureState(item);
  manager.cleaningModel = model;
  manager.layout = {
    bucketWater: { x: 80, y: 80, width: 40, height: 24 },
    bucketDropTarget: { x: 70, y: 65, width: 60, height: 50 },
    mat: { x: 150, y: 40, width: 120, height: 120 },
    inventory: { x: 0, y: 0, width: 60, height: 160 }
  };

  item.cleaning.location = "dragging";
  manager.pointerAction = { type: "cleaning-item", artefact: item, originLocation: "inventory" };
  manager.cleaningPointerEnd(70, 70);
  assert.equal(item.cleaning.location, "inventory");
  assert.equal(item.cleaning.status, "dirty");

  item.cleaning.location = "dragging";
  manager.pointerAction = { type: "cleaning-item", artefact: item, originLocation: "inventory" };
  manager.spawnCleaningWaterEffects = () => {};
  manager.cleaningPointerEnd(100, 92);
  assert.equal(item.cleaning.location, "bucket");
  assert.equal(item.cleaning.status, "wet");

  item.cleaning.location = "dragging";
  manager.pointerAction = { type: "cleaning-item", artefact: item, originLocation: "bucket" };
  manager.cleaningPointerEnd(200, 100);
  assert.equal(item.cleaning.location, "mat");

  cleanFace(model, item, "front");
  cleanFace(model, item, "back");
  item.cleaning.location = "dragging";
  manager.pointerAction = { type: "cleaning-item", artefact: item, originLocation: "mat" };
  manager.cleaningPointerEnd(30, 80);
  assert.equal(item.cleaning.location, "inventory");
  assert.equal(item.cleaning.status, "ready-to-identify");
});

test("a held wetted find may move directly to the mat and a completed find directly to inventory", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  const model = new CleaningModel(config.cleaning);
  const item = artefact("hadrian-denarius", "direct-held-flow");
  model.ensureState(item);
  model.dampen(item);
  manager.cleaningModel = model;
  manager.layout = {
    bucketWater: { x: 80, y: 160, width: 40, height: 20 },
    bucketDropTarget: { x: 70, y: 150, width: 60, height: 44 },
    mat: { x: 140, y: 30, width: 120, height: 120 },
    matSurface: { x: 150, y: 50, width: 100, height: 90 },
    inventory: { x: 0, y: 0, width: 60, height: 160 }
  };
  manager.spawnCleaningWaterEffects = () => {};

  item.cleaning.location = "dragging";
  manager.pointerAction = {
    type: "cleaning-item",
    artefact: item,
    originLocation: "inventory",
    x: 200,
    y: 90,
    lastPoint: { x: 200, y: 90 },
    dunkPhase: "unarmed"
  };
  manager.cleaningPointerEnd(200, 90);
  assert.equal(item.cleaning.location, "mat");

  for (const face of ["front", "back"]) {
    for (let dunk = 0; dunk < 8; dunk += 1) model.handwashDunk(item, face);
  }
  item.cleaning.location = "dragging";
  manager.pointerAction = {
    type: "cleaning-item",
    artefact: item,
    originLocation: "mat",
    x: 30,
    y: 80,
    lastPoint: { x: 30, y: 80 },
    dunkPhase: "unarmed"
  };
  manager.cleaningPointerEnd(30, 80);
  assert.equal(item.cleaning.location, "inventory");
  assert.equal(item.cleaning.status, "ready-to-identify");
});

test("the expanded bucket target accepts drops outside the visible water ellipse", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  const model = new CleaningModel(config.cleaning);
  const item = artefact("augustus-as", "expanded-bucket");
  model.ensureState(item);
  manager.cleaningModel = model;
  manager.layout = {
    bucketWater: { x: 90, y: 90, width: 20, height: 12 },
    bucketDropTarget: { x: 70, y: 70, width: 60, height: 50 }
  };
  manager.spawnCleaningWaterEffects = () => {};
  item.cleaning.location = "dragging";
  manager.pointerAction = { type: "cleaning-item", artefact: item, originLocation: "inventory" };
  manager.cleaningPointerEnd(78, 95);
  assert.equal(item.cleaning.location, "bucket");
  assert.equal(item.cleaning.dampened, true);
});

test("held down-and-up movement through the exact water aperture completes one dunk", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  const model = new CleaningModel(config.cleaning);
  const item = artefact("mortarium", "held-dunk");
  model.ensureState(item);
  manager.cleaningModel = model;
  manager.layout = {
    bucketDunkAperture: { x: 80, y: 80, width: 40, height: 20 },
    bucketWater: { x: 80, y: 80, width: 40, height: 20 },
    mat: { x: 0, y: 0, width: 120, height: 120 },
    matSurface: { x: 0, y: 0, width: 120, height: 120 }
  };
  let waterEffects = 0;
  let dirtEffects = 0;
  manager.spawnCleaningWaterEffects = () => { waterEffects += 1; };
  manager.spawnCleaningDirtParticles = (spots) => { dirtEffects += spots.length; };
  const action = {
    type: "cleaning-item",
    artefact: item,
    originLocation: "inventory",
    x: 100,
    y: 70,
    lastPoint: { x: 100, y: 70 },
    dunkPhase: "armed"
  };

  manager.advanceCleaningDunk(action, { x: 100, y: 70 }, { x: 100, y: 90 });
  assert.equal(action.dunkPhase, "immersed");
  assert.equal(item.cleaning.dampened, true);
  assert.equal(model.progress(item, "front"), 0);
  manager.advanceCleaningDunk(action, { x: 100, y: 90 }, { x: 100, y: 70 });
  assert.equal(action.dunkPhase, "armed");
  assert.equal(model.progress(item, "front"), config.cleaning.handwashPowerPerDunk);
  assert.equal(
    model.progress(item, "back"),
    config.cleaning.handwashPowerPerDunk * config.cleaning.handwashReversePowerRatio
  );
  assert.equal(waterEffects, 1);
  assert.equal(dirtEffects, config.cleaning.dirtSpotsPerFace * 2);
});

test("overshooting below or into a side wall stays immersed without handwashing", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  const model = new CleaningModel(config.cleaning);
  manager.cleaningModel = model;
  manager.layout = {
    bucketDunkAperture: { x: 80, y: 80, width: 40, height: 20 },
    bucketWater: { x: 80, y: 80, width: 40, height: 20 },
    mat: { x: 0, y: 0, width: 120, height: 120 },
    matSurface: { x: 0, y: 0, width: 120, height: 120 }
  };
  manager.spawnCleaningWaterEffects = () => {};
  manager.spawnCleaningDirtParticles = () => {};

  const through = artefact("mortarium", "through-water");
  model.ensureState(through);
  const throughAction = { type: "cleaning-item", artefact: through, dunkPhase: "armed", x: 100, y: 70 };
  manager.advanceCleaningDunk(throughAction, { x: 100, y: 70 }, { x: 100, y: 110 });
  assert.equal(throughAction.dunkPhase, "immersed");
  assert.equal(model.progress(through, "front"), 0);

  const sideways = artefact("mortarium", "side-water");
  model.ensureState(sideways);
  const sideAction = { type: "cleaning-item", artefact: sideways, dunkPhase: "armed", x: 100, y: 70 };
  manager.advanceCleaningDunk(sideAction, { x: 100, y: 70 }, { x: 100, y: 90 });
  manager.advanceCleaningDunk(sideAction, { x: 100, y: 90 }, { x: 130, y: 85 });
  assert.equal(sideAction.dunkPhase, "immersed");
  assert.equal(model.progress(sideways, "front"), 0);
});

test("the contextual flip appears only for a completed visible face", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  const model = new CleaningModel(config.cleaning);
  const item = artefact("decorated-samian", "context-flip");
  model.ensureState(item);
  model.dampen(item);
  item.cleaning.location = "mat";
  manager.cleaningModel = model;
  manager.activeCleaningArtefact = () => item;

  assert.equal(manager.shouldShowContextFlip(item), false);
  for (let dunk = 0; dunk < 8; dunk += 1) model.handwashDunk(item, "front");
  assert.equal(manager.shouldShowContextFlip(item), true);
  assert.equal(model.flip(item), true);
  assert.equal(manager.shouldShowContextFlip(item), false);
});

test("the contextual flip target follows the artefact and falls back inside the mat", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  const surface = { x: 20, y: 30, width: 260, height: 180 };
  const centredItem = { x: 90, y: 80, width: 80, height: 90 };
  const preferred = manager.contextualFlipBounds(centredItem, surface, 44);
  assert.equal(preferred.x, centredItem.x + centredItem.width + 8);
  assert.ok(preferred.y >= surface.y + 4);

  const edgeItem = { x: 215, y: 35, width: 60, height: 80 };
  const fallback = manager.contextualFlipBounds(edgeItem, surface, 44);
  assert.ok(fallback.x < edgeItem.x);
  assert.ok(fallback.x >= surface.x + 4);
  assert.ok(fallback.x + fallback.width <= surface.x + surface.width - 4);
  assert.ok(fallback.y >= surface.y + 4);
  assert.ok(fallback.y + fallback.height <= surface.y + surface.height - 4);
});

test("completing cleaning automatically returns control to the Hand tool", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  manager.layout = {};
  manager.cleaningTool = "toothbrush";
  manager.spawnCleaningDirtParticles = () => {};
  manager.handleCleaningBrushResult({ changed: true, affectedSpots: [], complete: true });
  assert.equal(manager.cleaningTool, "hand");

  const model = new CleaningModel(config.cleaning);
  const item = artefact("mortarium", "dunk-completion");
  model.ensureState(item);
  model.dampen(item);
  for (const face of ["front", "back"]) {
    item.cleaning.faces[face].forEach((spot) => { spot.remaining = 0.04; });
  }
  manager.cleaningModel = model;
  manager.cleaningTool = "fine-brush";
  manager.layout = {
    bucketDunkAperture: { x: 80, y: 80, width: 40, height: 20 },
    mat: { x: 0, y: 0, width: 120, height: 120 },
    matSurface: { x: 0, y: 0, width: 120, height: 120 }
  };
  manager.spawnCleaningWaterEffects = () => {};
  manager.spawnCleaningDirtParticles = () => {};
  const action = { type: "cleaning-item", artefact: item, dunkPhase: "immersed", displaySize: 100, x: 100, y: 90 };
  manager.advanceCleaningDunk(action, { x: 100, y: 90 }, { x: 100, y: 70 });
  assert.equal(item.cleaning.status, "ready-to-return");
  assert.equal(manager.cleaningTool, "hand");
});

test("bucket occlusion defaults to the realistic obscured presentation", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = new SceneManager({ ...config, trenches: [] });
  assert.equal(manager.bucketOcclusionMode, "obscured");
});

test("holding a cleanable find does not add a highlight over the bucket water", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  manager.layout = {
    isPortrait: false,
    bucket: { x: 0, y: 0, width: 400, height: 160 },
    bucketModeButton: { x: 260, y: 6, width: 132, height: 28 }
  };
  manager.bucketOcclusionMode = "obscured";
  manager.renderer = { panel() {}, button() {} };

  const saved = {};
  const drawingNames = ["fill", "noStroke", "textAlign", "textStyle", "textSize", "text", "quad", "noFill", "stroke", "strokeWeight", "arc", "ellipse"];
  drawingNames.forEach((name) => { saved[name] = sandbox[name]; });
  const constants = ["LEFT", "TOP", "BOLD", "NORMAL"];
  constants.forEach((name) => { saved[name] = sandbox[name]; sandbox[name] = name; });

  let currentFill = null;
  let ellipses = [];
  sandbox.fill = (...args) => { currentFill = args; };
  sandbox.ellipse = (...args) => { ellipses.push({ args, fill: currentFill }); };
  drawingNames.filter((name) => !["fill", "ellipse"].includes(name)).forEach((name) => { sandbox[name] = () => {}; });

  const renderWater = (pointerAction) => {
    manager.pointerAction = pointerAction;
    ellipses = [];
    manager.drawCleaningBucketBack();
    return ellipses.map((entry) => ({ args: entry.args, fill: entry.fill }));
  };

  try {
    const idle = renderWater(null);
    const heldDirty = renderWater({ type: "cleaning-item", artefact: { cleaning: { status: "dirty" } } });
    const heldWet = renderWater({ type: "cleaning-item", artefact: { cleaning: { status: "wet" } } });
    assert.equal(idle.length, 1);
    assert.deepEqual(heldDirty, idle);
    assert.deepEqual(heldWet, idle);
    assert.deepEqual(idle[0].fill, ["#70b7c4"]);
  } finally {
    [...drawingNames, ...constants].forEach((name) => {
      if (saved[name] === undefined) delete sandbox[name];
      else sandbox[name] = saved[name];
    });
  }
});

test("bucket occlusion uses the exact water aperture and toggles independently of workflow", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  const item = artefact("augustus-as", "bucket-mask");
  manager.layout = {
    bucketDunkAperture: { x: 50, y: 60, width: 100, height: 30 }
  };
  manager.bucketOcclusionMode = "obscured";
  manager.cleaningInventorySortChooserOpen = false;
  manager.pointerAction = { type: "cleaning-item", artefact: item, x: 100, y: 75, dunkPhase: "unarmed" };
  manager.cleaningDraggedItemBounds = () => ({ size: 64 });
  assert.equal(manager.immersedCleaningItem(), null, "being inside the ellipse without valid entry does not obscure a dry find");
  manager.pointerAction.dunkPhase = "immersed";
  assert.equal(manager.immersedCleaningItem().artefact, item);
  manager.pointerAction.x = 151;
  assert.equal(manager.immersedCleaningItem().artefact, item, "valid immersion survives a raw overshoot until an upper or side exit");

  manager.pointerAction = null;
  manager.activateDebugOption("water");
  assert.equal(manager.bucketOcclusionMode, "visible");
  manager.activateDebugOption("water");
  assert.equal(manager.bucketOcclusionMode, "obscured");
});

test("immersed drag rendering clamps at the bucket base while retaining raw input", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  const item = artefact("augustus-as", "clamped-bucket-item");
  manager.layout = {
    bucketGeometry: { centerX: 100, waterY: 80, bodyBottom: 180, bucketWidth: 120 },
    mat: { x: 0, y: 0, width: 300, height: 300 },
    matSurface: { x: 0, y: 0, width: 300, height: 300 }
  };
  manager.cleaningItemSize = () => 100;
  const action = { type: "cleaning-item", artefact: item, dunkPhase: "immersed", x: 100, y: 90 };
  manager.updateCleaningDragPosition(action, 110, 260);
  assert.equal(action.rawX, 110);
  assert.equal(action.rawY, 260);
  assert.ok(action.y < 180);
  const bounds = manager.cleaningDraggedItemBounds(action);
  assert.ok(bounds.y + bounds.height <= 180);
  manager.updateCleaningDragPosition(action, 240, 120);
  const inner = manager.bucketInnerBoundsAtY(action.y, action.displaySize);
  assert.ok(action.x <= inner.right, "the displayed artefact slides along the right wall");
});

test("visible and obscured water modes share the same sloping-wall collision geometry", () => {
  const SceneManager = sandbox.window.SceneManager;
  const expected = [];
  for (const mode of ["visible", "obscured"]) {
    const manager = Object.create(SceneManager.prototype);
    manager.bucketOcclusionMode = mode;
    manager.layout = {
      bucketGeometry: { centerX: 160, waterY: 90, bodyBottom: 210, bucketWidth: 220 },
      mat: { x: 0, y: 0, width: 320, height: 300 },
      matSurface: { x: 0, y: 0, width: 320, height: 300 }
    };
    const action = { type: "cleaning-item", artefact: {}, displaySize: 72, dunkPhase: "immersed" };
    manager.updateCleaningDragPosition(action, 300, 165);
    const rightWall = manager.bucketInnerBoundsAtY(action.y, action.displaySize).right;
    assert.equal(action.x, rightWall);
    manager.updateCleaningDragPosition(action, 20, 260);
    const bottomBounds = manager.cleaningDraggedItemBounds(action);
    assert.ok(bottomBounds.y + bottomBounds.height <= manager.layout.bucketGeometry.bodyBottom);
    expected.push({ x: action.x, y: action.y });
  }
  assert.deepEqual(expected[0], expected[1]);
});

test("upward entry from beneath the aperture never wets or obscures a find", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  const model = new CleaningModel(config.cleaning);
  const item = artefact("mortarium", "upward-entry");
  model.ensureState(item);
  manager.cleaningModel = model;
  manager.layout = { bucketDunkAperture: { x: 80, y: 80, width: 40, height: 20 } };
  manager.spawnCleaningWaterEffects = () => { throw new Error("invalid entry spawned water effects"); };
  manager.spawnCleaningDirtParticles = () => {};
  const action = { type: "cleaning-item", artefact: item, dunkPhase: "unarmed", x: 100, y: 110 };
  manager.advanceCleaningDunk(action, { x: 100, y: 110 }, { x: 100, y: 70 });
  assert.equal(action.dunkPhase, "armed");
  assert.equal(item.cleaning.status, "dirty");
  assert.equal(Boolean(item.cleaning.dampened), false);
});

test("releasing after a valid below-base overshoot parks the find in the bucket", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  const model = new CleaningModel(config.cleaning);
  const item = artefact("mortarium", "overshot-release");
  model.ensureState(item);
  model.dampen(item);
  manager.cleaningModel = model;
  manager.layout = {
    inventory: { x: 0, y: 0, width: 50, height: 50 },
    bucketWater: { x: 80, y: 80, width: 40, height: 20 },
    bucketDropTarget: { x: 70, y: 70, width: 60, height: 50 },
    mat: { x: 0, y: 60, width: 60, height: 60 },
    matSurface: { x: 0, y: 60, width: 60, height: 60 }
  };
  manager.pointerAction = {
    type: "cleaning-item",
    artefact: item,
    originLocation: "inventory",
    x: 100,
    y: 100,
    rawX: 100,
    rawY: 250,
    lastRawPoint: { x: 100, y: 250 },
    dunkPhase: "immersed"
  };
  manager.cleaningPointerEnd(100, 250);
  assert.equal(item.cleaning.location, "bucket");
  assert.equal(manager.messageTone, "neutral");
});

test("cleaning feedback effects use configured counts and enforce the dirt-particle cap", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  manager.config = config;
  manager.layout = { bucketWater: { x: 40, y: 50, width: 100, height: 30 } };
  manager.cleaningWaterDrops = [];
  manager.cleaningRipples = [];
  manager.cleaningDirtParticles = [];
  manager.scheduleEffectFrame = () => {};
  sandbox.millis = () => 100;

  manager.spawnCleaningWaterEffects();
  assert.equal(manager.cleaningWaterDrops.length, config.cleaning.effects.waterDroplets);
  assert.equal(manager.cleaningRipples.length, config.cleaning.effects.waterRipples);
  for (let index = 0; index < 10; index += 1) manager.spawnCleaningWaterEffects();
  assert.equal(manager.cleaningWaterDrops.length, config.cleaning.effects.waterDroplets * 4);
  assert.equal(manager.cleaningRipples.length, config.cleaning.effects.waterRipples * 4);

  const spots = Array.from({ length: 48 }, (_, index) => ({
    x: (index % 8) / 10,
    y: Math.floor(index / 8) / 10,
    amount: 0.5
  }));
  const itemBounds = { x: 10, y: 20, width: 120, height: 120, size: 100 };
  for (let index = 0; index < 20; index += 1) manager.spawnCleaningDirtParticles(spots, itemBounds);
  assert.equal(manager.cleaningDirtParticles.length, config.cleaning.effects.dirtParticleLimit);
});
