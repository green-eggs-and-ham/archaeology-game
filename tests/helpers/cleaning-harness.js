const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const noop = () => {};
const sandbox = {
  drawingContext: {
    beginPath: noop,
    closePath: noop,
    arc: noop,
    clip: noop,
    fill: noop,
    fillRect: noop,
    lineTo: noop,
    moveTo: noop,
    quadraticCurveTo: noop,
    rect: noop,
    restore: noop,
    save: noop,
    setLineDash: noop,
    stroke: noop,
    translate: noop
  },
  arc: noop,
  circle: noop,
  ellipse: noop,
  fill: noop,
  line: noop,
  noFill: noop,
  noStroke: noop,
  point: noop,
  pop: noop,
  push: noop,
  rect: noop,
  redraw() {},
  stroke: noop,
  strokeCap: noop,
  strokeJoin: noop,
  strokeWeight: noop,
  text: noop,
  textAlign: noop,
  textSize: noop,
  textStyle: noop,
  translate: noop,
  BOLD: "bold",
  CENTER: "center",
  NORMAL: "normal",
  ROUND: "round",
  window: {
    GameRenderer: class GameRenderer {},
    TrenchModel: class TrenchModel {}
  }
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../../data/game-config.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../../src/game/GameConfigValidator.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../../src/game/ArtefactCatalogue.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../../src/game/ArtefactRenderer.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../../src/game/CleaningModel.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../../src/game/TerrainPipeline.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../../src/scenes/CleaningScene.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../../src/scenes/TrenchScene.js"), "utf8"), sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../../src/game/SceneManager.js"), "utf8"), sandbox);

const CleaningModel = sandbox.window.CleaningModel;
const config = sandbox.window.GameConfig;
const catalogue = new sandbox.window.ArtefactCatalogue(config);

function variant(id) {
  return catalogue.variantById(id);
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

module.exports = {
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
};
