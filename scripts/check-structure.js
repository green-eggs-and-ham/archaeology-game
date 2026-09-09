const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");
const lineCount = (relativePath) => read(relativePath).split(/\r?\n/).length;

const scriptOrder = [
  "data/game-config.js",
  "src/utils/assetLoader.js",
  "src/game/GameConfigValidator.js",
  "src/game/ArtefactCatalogue.js",
  "src/game/CleaningModel.js",
  "src/game/TrenchModel.js",
  "src/game/ArtefactRenderer.js",
  "src/game/Renderer.js",
  "src/game/TerrainGraphics.js",
  "src/game/TerrainPipeline.js",
  "src/scenes/CleaningScene.js",
  "src/scenes/TrenchScene.js",
  "src/game/SceneManager.js",
  "src/main.js"
];

scriptOrder.forEach((relativePath) => {
  assert.ok(fs.existsSync(path.join(root, relativePath)), `Missing runtime script: ${relativePath}`);
});
assert.equal(fs.existsSync(path.join(root, "data/game-config.json")), false, "game-config.js must remain the sole config source");

const index = read("index.html");
let previousOffset = -1;
scriptOrder.forEach((relativePath) => {
  const offset = index.indexOf(relativePath);
  assert.ok(offset > previousOffset, `${relativePath} is missing or out of dependency order in index.html`);
  previousOffset = offset;
});
assert.doesNotMatch(index, /<script[^>]+type=["']module["']/i, "The zero-build runtime must use classic scripts");

const worker = read("src/game/TerrainWorker.js");
assert.match(worker, /importScripts\(["']\.\/TerrainGraphics\.js["']\)/);
assert.doesNotMatch(worker, /SceneManager|TrenchScene|CleaningScene/);

const validator = read("src/game/GameConfigValidator.js");
assert.doesNotMatch(
  validator,
  /static\s+[A-Za-z_$][\w$]*\s*=/,
  "Classic-script validation must avoid public static fields for older WebKit"
);

assert.ok(lineCount("src/game/SceneManager.js") <= 1200, "SceneManager has regrown beyond its coordination boundary");
assert.ok(lineCount("src/scenes/TrenchScene.js") <= 1500, "TrenchScene needs another cohesive extraction");
assert.ok(lineCount("src/scenes/CleaningScene.js") <= 1500, "CleaningScene needs another cohesive extraction");

for (const relativePath of ["src/scenes/TrenchScene.js", "src/scenes/CleaningScene.js"]) {
  assert.doesNotMatch(read(relativePath), /\bredraw\s*\(/, `${relativePath} must use the injected frame scheduler`);
}

console.log("Structural checks passed.");
