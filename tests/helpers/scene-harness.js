const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const { mobileWebKitTerrainFixture } = require("../fixtures/mobile-webkit-terrain.js");

const operations = [];
const drawingContext = {
  beginPath() { operations.push(["beginPath"]); },
  closePath() { operations.push(["closePath"]); },
  clearRect(...values) { operations.push(["clearRect", ...values]); },
  arc(...values) { operations.push(["arc", ...values]); },
  clip(rule) { operations.push(["clip", rule]); },
  drawImage(...values) { operations.push(["drawImage", ...values]); },
  fill(rule) { operations.push(["fill", this.fillStyle, rule, this.globalCompositeOperation]); },
  fillRect(...values) { operations.push(["fillRect", ...values, this.fillStyle]); },
  lineTo(...values) { operations.push(["lineTo", ...values]); },
  moveTo(...values) { operations.push(["moveTo", ...values]); },
  quadraticCurveTo(...values) { operations.push(["quadraticCurveTo", ...values]); },
  rect(...values) { operations.push(["clipRect", ...values]); },
  restore() { operations.push(["restore"]); },
  save() { operations.push(["save"]); },
  setTransform(...values) { operations.push(["setTransform", ...values]); },
  stroke() { operations.push(["contextStroke"]); }
};

const sandbox = {
  window: {
    GameRenderer: class GameRenderer {},
    ArtefactCatalogue: class ArtefactCatalogue {},
    TrenchModel: class TrenchModel {}
  },
  drawingContext,
  fill: () => {},
  line: (...values) => operations.push(["line", ...values]),
  noFill: () => {},
  noStroke: () => {},
  point: (...values) => operations.push(["point", ...values]),
  redraw: () => {},
  rect: () => {},
  stroke: () => {},
  strokeWeight: () => {}
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, "../../src/game/CleaningModel.js"), "utf8"), sandbox);
const sceneManagerSource = fs.readFileSync(path.join(__dirname, "../../src/game/SceneManager.js"), "utf8");
const rendererSource = fs.readFileSync(path.join(__dirname, "../../src/game/Renderer.js"), "utf8");
const terrainGraphicsSource = fs.readFileSync(path.join(__dirname, "../../src/game/TerrainGraphics.js"), "utf8");
const terrainPipelineSource = fs.readFileSync(path.join(__dirname, "../../src/game/TerrainPipeline.js"), "utf8");
const cleaningSceneSource = fs.readFileSync(path.join(__dirname, "../../src/scenes/CleaningScene.js"), "utf8");
const trenchSceneSource = fs.readFileSync(path.join(__dirname, "../../src/scenes/TrenchScene.js"), "utf8");
const terrainWorkerSource = fs.readFileSync(path.join(__dirname, "../../src/game/TerrainWorker.js"), "utf8");
const mainSource = fs.readFileSync(path.join(__dirname, "../../src/main.js"), "utf8");
const indexSource = fs.readFileSync(path.join(__dirname, "../../index.html"), "utf8");
const stylesSource = fs.readFileSync(path.join(__dirname, "../../styles.css"), "utf8");
vm.runInContext(terrainGraphicsSource, sandbox);
vm.runInContext(terrainPipelineSource, sandbox);
vm.runInContext(cleaningSceneSource, sandbox);
vm.runInContext(trenchSceneSource, sandbox);
vm.runInContext(sceneManagerSource, sandbox);
const SceneManager = sandbox.window.SceneManager;

function manager() {
  return new SceneManager({
    trenches: [],
    trench: { maxDepthDarkening: 0.16, brushTravelPerStampCells: 3 }
  });
}

function surface(id, depth, colour, componentSize = 8, pattern = "dots") {
  return {
    signature: `${depth}:${id}`,
    depth,
    componentSize,
    layer: { id, colour, pattern }
  };
}

function trench(rows, columns, layers) {
  return {
    rows,
    columns,
    layers,
    bedrock: { id: "bedrock", colour: "#445566" },
    artefacts: []
  };
}

function grid(cellSize = 10) {
  return { x: 0, y: 0, width: cellSize * 20, height: cellSize * 20, cellSize };
}

function configureBrushScene(scene, stamps) {
  scene.currentScene = "trench";
  scene.tool = "brush";
  scene.layout = {
    grid: { x: 100, y: 100, width: 200, height: 200, cellSize: 10 },
    mapButton: { x: 0, y: 0, width: 40, height: 30 },
    brushButton: { x: 45, y: 0, width: 40, height: 30 },
    scoopButton: { x: 90, y: 0, width: 40, height: 30 },
    depthButton: { x: 0, y: 35, width: 40, height: 30 },
    smoothingButton: { x: 45, y: 35, width: 70, height: 30 },
    pillarButton: { x: 120, y: 35, width: 70, height: 30 },
    ridgeButton: { x: 195, y: 35, width: 80, height: 30 }
  };
  scene.activeTrench = {
    collectAt: () => null,
    brushAt: (x, y) => {
      stamps.push({ x, y });
      return { changed: false, cells: [], removedLayers: [] };
    }
  };
}

module.exports = {
  assert,
  fs,
  path,
  test,
  vm,
  mobileWebKitTerrainFixture,
  operations,
  drawingContext,
  sandbox,
  sceneManagerSource,
  rendererSource,
  terrainGraphicsSource,
  terrainPipelineSource,
  cleaningSceneSource,
  trenchSceneSource,
  terrainWorkerSource,
  mainSource,
  indexSource,
  stylesSource,
  SceneManager,
  manager,
  surface,
  trench,
  grid,
  configureBrushScene
};
