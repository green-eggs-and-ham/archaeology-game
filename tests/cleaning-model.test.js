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

test("inventory views sort by name and filter every requested status group", () => {
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

  manager.cleaningInventoryView = "name";
  assert.deepEqual(
    Array.from(manager.cleaningInventoryArtefacts(), (item) => item.label),
    ["Alpha coin", "Bronze coin", "Glass bead", "Wet sherd", "Zulu sherd"]
  );
  for (const [view, expected] of [
    ["dirty", [dirty]],
    ["specialist", [specialist]],
    ["identify", [identify]],
    ["other", [unavailable, intermediate]]
  ]) {
    manager.cleaningInventoryView = view;
    assert.deepEqual(Array.from(manager.cleaningInventoryArtefacts()), expected);
  }
  assert.equal(JSON.stringify(manager.cleaningInventoryGrid(true)), JSON.stringify({ columns: 3, rows: 1 }));
  assert.equal(JSON.stringify(manager.cleaningInventoryGrid(false)), JSON.stringify({ columns: 2, rows: 4 }));
  assert.equal(manager.portraitInventoryLabel("Verulamium flagon sherd").replace("\n", " "), "Verulamium flagon sherd");
});

test("choosing an inventory view closes the chooser and resets pagination", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  manager.layout = {
    labBackButton: { x: -100, y: -100, width: 1, height: 1 },
    inventoryViewOptions: [{ view: "specialist", bounds: { x: 10, y: 10, width: 80, height: 44 } }]
  };
  manager.cleaningInventoryChooserOpen = true;
  manager.cleaningInventoryView = "all";
  manager.cleaningInventoryPage = 4;
  manager.pointerAction = null;

  manager.cleaningPointerStart(20, 20);
  assert.equal(manager.cleaningInventoryView, "specialist");
  assert.equal(manager.cleaningInventoryPage, 0);
  assert.equal(manager.cleaningInventoryChooserOpen, false);
});

test("portrait care controls stay inside their panel at mobile canvas sizes", () => {
  const SceneManager = sandbox.window.SceneManager;
  const manager = Object.create(SceneManager.prototype);
  for (const [canvasWidth, canvasHeight] of [[320, 427], [390, 520], [560, 747]]) {
    sandbox.width = canvasWidth;
    sandbox.height = canvasHeight;
    const layout = manager.cleaningLayout();
    assert.equal(layout.isPortrait, true);
    assert.ok(layout.mat.height > 0);
    assert.ok(layout.flipButton.y + layout.flipButton.height <= layout.controls.y + layout.controls.height - 7.9);
    assert.ok(layout.care.y + layout.care.height < layout.toothbrushButton.y);
  }
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

  const spots = Array.from({ length: 48 }, (_, index) => ({
    x: (index % 8) / 10,
    y: Math.floor(index / 8) / 10,
    amount: 0.5
  }));
  const itemBounds = { x: 10, y: 20, width: 120, height: 120, size: 100 };
  for (let index = 0; index < 20; index += 1) manager.spawnCleaningDirtParticles(spots, itemBounds);
  assert.equal(manager.cleaningDirtParticles.length, config.cleaning.effects.dirtParticleLimit);
});
