const {
  assert,
  fs,
  path,
  test,
  vm,
  noop,
  sandbox,
  CleaningModel,
  config,
  catalogue,
  variant,
  artefact,
  cleanFace
} = require("./helpers/cleaning-harness.js");

test("pottery and coin variants preserve four equally weighted find categories", () => {
  assert.equal(config.artefactCategories.length, 4);
  assert.deepEqual(Array.from(config.artefactCategories, (category) => category.weight), [1, 1, 1, 1]);
  assert.equal(config.artefactCategories.find((category) => category.id === "pottery").variants.length, 6);
  assert.equal(config.artefactCategories.find((category) => category.id === "coin").variants.length, 4);
});

test("the canonical JavaScript catalogue validates against the artefact visual registry", () => {
  assert.doesNotThrow(() => sandbox.window.GameConfigValidator.validate(config, {
    visualRegistry: sandbox.window.ArtefactRenderer.visualRegistry()
  }));
});

test("configuration validation rejects duplicate ids, invalid care, and incomplete artwork", () => {
  const duplicate = JSON.parse(JSON.stringify(config));
  duplicate.artefactCategories[1].variants[0].id = duplicate.artefactCategories[0].variants[0].id;
  assert.throws(
    () => sandbox.window.GameConfigValidator.validate(duplicate, {
      visualRegistry: sandbox.window.ArtefactRenderer.visualRegistry()
    }),
    /duplicated/
  );

  const invalidCare = JSON.parse(JSON.stringify(config));
  invalidCare.careProfiles["fragile-standard"].allowedTools = [];
  assert.throws(
    () => sandbox.window.GameConfigValidator.validate(invalidCare, {
      visualRegistry: sandbox.window.ArtefactRenderer.visualRegistry()
    }),
    /at least one allowed tool/
  );

  const nonArrayCare = JSON.parse(JSON.stringify(config));
  nonArrayCare.careProfiles["fragile-standard"].allowedTools = "fine-brush";
  assert.throws(
    () => sandbox.window.GameConfigValidator.validate(nonArrayCare, {
      visualRegistry: sandbox.window.ArtefactRenderer.visualRegistry()
    }),
    /at least one allowed tool/
  );

  const incompleteRegistry = sandbox.window.ArtefactRenderer.visualRegistry();
  incompleteRegistry[config.artefactCategories[0].variants[0].visualKey].back = null;
  assert.throws(
    () => sandbox.window.GameConfigValidator.validate(config, { visualRegistry: incompleteRegistry }),
    /front, and reverse geometry/
  );
});

test("every configured visual key is registered and renders front and reverse faces", () => {
  const renderer = new sandbox.window.ArtefactRenderer();
  const registered = new Set(sandbox.window.ArtefactRenderer.visualKeys());
  const variants = config.artefactCategories.flatMap((category) => category.variants);

  variants.forEach((configured) => {
    assert.ok(registered.has(configured.visualKey), `${configured.visualKey} is registered`);
    const resolved = catalogue.resolveVariant(configured);
    const visual = renderer.visualFor(resolved);
    assert.ok(visual.front, `${configured.visualKey} has front geometry`);
    assert.ok(visual.back, `${configured.visualKey} has reverse geometry`);
    for (const face of ["front", "back"]) {
      assert.doesNotThrow(
        () => renderer.draw(resolved, 0, 0, 40, { face }),
        `${configured.visualKey} ${face} renders`
      );
    }
  });
  assert.throws(
    () => renderer.visualFor({ visualKey: "misspelled-visual" }),
    /Unknown artefact visual key/
  );
});

test("zero-weight artefact categories are never selected", () => {
  const weightedConfig = JSON.parse(JSON.stringify(config));
  weightedConfig.artefactCategories.forEach((category) => { category.weight = 0; });
  const enabledCategory = weightedConfig.artefactCategories.find((category) => category.id === "arrowhead");
  enabledCategory.weight = 1;
  const weightedCatalogue = new sandbox.window.ArtefactCatalogue(weightedConfig);

  assert.equal(
    weightedCatalogue.categoryWeight(weightedConfig.artefactCategories.find((category) => category.id === "pottery")),
    0
  );
  for (const randomValue of [0, 0.01, 0.4, 0.999999]) {
    const selection = weightedCatalogue.chooseVariant(() => randomValue);
    assert.equal(selection.category.id, "arrowhead");
    assert.equal(selection.item.id, "arrowhead");
  }
});

test("cleaning constants and workflow predicates define the state machine contract", () => {
  const model = new CleaningModel(config.cleaning);
  const constants = CleaningModel.Constants;
  assert.equal(constants, sandbox.window.CleaningConstants);
  assert.equal(Object.isFrozen(constants), true);
  assert.equal(constants.STATUS.DIRTY, "dirty");
  assert.equal(constants.STATUS.WET, "wet");
  assert.equal(constants.STATUS.READY_TO_RETURN, "ready-to-return");
  assert.equal(constants.STATUS.READY_TO_IDENTIFY, "ready-to-identify");
  assert.equal(constants.STATUS.AWAITING_SPECIALIST, "awaiting-specialist");
  assert.equal(constants.LOCATION.INVENTORY, "inventory");
  assert.equal(constants.LOCATION.BUCKET, "bucket");
  assert.equal(constants.LOCATION.MAT, "mat");
  assert.equal(constants.TOOL.HAND, "hand");
  assert.equal(constants.TOOL.TOOTHBRUSH, "toothbrush");
  assert.equal(constants.TOOL.FINE_BRUSH, "fine-brush");
  assert.equal(constants.TREATMENT.IDENTIFICATION, "identification");
  assert.equal(constants.TREATMENT.SPECIALIST, "specialist-treatment");
  assert.equal(constants.FACE.FRONT, "front");
  assert.equal(constants.FACE.BACK, "back");

  const item = artefact("mortarium", "predicate-contract");
  model.ensureState(item);
  const expectations = [
    [constants.STATUS.DIRTY, true, false, false, true, true, false],
    [constants.STATUS.WET, true, false, false, true, true, true],
    [constants.STATUS.READY_TO_RETURN, true, false, true, false, false, true],
    [constants.STATUS.READY_TO_IDENTIFY, false, true, false, false, false, false],
    [constants.STATUS.AWAITING_SPECIALIST, false, true, false, false, false, false]
  ];
  expectations.forEach(([status, pending, final, returnable, dirtVisible, dampenable, matEligible]) => {
    item.cleaning.status = status;
    assert.equal(model.isPending(item), pending, `${status} pending`);
    assert.equal(model.isFinal(item), final, `${status} final`);
    assert.equal(model.isReturnable(item), returnable, `${status} returnable`);
    assert.equal(model.canReturnToInventory(item), returnable, `${status} may return`);
    assert.equal(model.isDirtVisible(item), dirtVisible, `${status} dirt visibility`);
    assert.equal(model.canDampen(item), dampenable, `${status} dampening`);
    assert.equal(model.canPlaceOnMat(item), matEligible, `${status} mat eligibility`);
  });

  assert.equal(model.requiresSpecialistTreatment(artefact("victorinus-radiate", "specialist-predicate")), true);
  assert.equal(model.requiresSpecialistTreatment(artefact("mortarium", "standard-predicate")), false);
  assert.equal(model.workflowStatus({ cleanable: false }), null);
  assert.equal(model.workflowLocation({ cleanable: false }), null);
});

test("every cleanable variant has a fixed care profile and two supported faces", () => {
  const cleanable = config.artefactCategories
    .flatMap((category) => category.variants.map((item) => catalogue.resolveVariant(item, category)))
    .filter((item) => item.cleanable);
  assert.equal(cleanable.length, 10);
  cleanable.forEach((item) => {
    assert.ok(["toothbrush", "fine-brush"].includes(item.cleaningTool));
    assert.ok(item.robustness);
    assert.ok(item.material);
    assert.ok(["identification", "specialist-treatment"].includes(item.postCleaningTreatment));
    assert.equal(Object.hasOwn(item, "requiresSpecialist"), false);
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

test("legacy dirt flecks are normalised once when cleaning state is restored", () => {
  const model = new CleaningModel(config.cleaning);
  const item = artefact("mortarium", "legacy-dirt");
  item.cleaning.faces = {
    front: [{ x: 0, y: 0, size: 0.05, removed: true }],
    back: [{ x: 0, y: 0, size: 0.05, removed: false }]
  };

  const state = model.ensureState(item);
  assert.equal(state.faces.front[0].remaining, 0);
  assert.equal(state.faces.back[0].remaining, 1);
  assert.equal(Object.hasOwn(state.faces.front[0], "removed"), false);
  const restoredFaces = state.faces;
  model.progress(item, "front");
  model.ensureState(item);
  assert.equal(item.cleaning.faces, restoredFaces);
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
