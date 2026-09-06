let sceneManager;

function getCanvasSize() {
  const shell = document.getElementById("game-shell");
  const maxWidth = window.GameConfig.canvas.maxWidth;
  const availableWidth = Math.max(280, shell.clientWidth || maxWidth);
  const canvasWidth = Math.min(maxWidth, availableWidth);
  const isNarrowPortrait = canvasWidth < window.GameConfig.canvas.compactBreakpoint && window.innerHeight > window.innerWidth;
  const aspectRatio = isNarrowPortrait
    ? window.GameConfig.canvas.portraitAspectRatio
    : canvasWidth < window.GameConfig.canvas.compactBreakpoint
      ? window.GameConfig.canvas.compactAspectRatio
      : window.GameConfig.canvas.aspectRatio;

  return {
    width: Math.round(canvasWidth),
    height: Math.round(canvasWidth / aspectRatio)
  };
}

function setup() {
  const size = getCanvasSize();
  const canvas = createCanvas(size.width, size.height);
  canvas.parent("game-shell");
  canvas.elt.setAttribute("aria-label", "Archaeology excavation and artefact cleaning game");
  pixelDensity(1);
  noLoop();

  sceneManager = new window.SceneManager(window.GameConfig);
  redraw();
}

function draw() {
  sceneManager.draw();
}

function windowResized() {
  const size = getCanvasSize();
  resizeCanvas(size.width, size.height);
  sceneManager.handleResize();
  redraw();
}

function mousePressed() {
  sceneManager.pointerStart(mouseX, mouseY, "mouse");
  return false;
}

function mouseDragged() {
  sceneManager.pointerMove(mouseX, mouseY, "mouse");
  return false;
}

function mouseReleased() {
  sceneManager.pointerEnd(mouseX, mouseY, "mouse");
  return false;
}

function mouseMoved() {
  sceneManager.pointerHover(mouseX, mouseY);
  return false;
}

function touchStarted() {
  sceneManager.pointerStart(mouseX, mouseY, "touch");
  return false;
}

function touchMoved() {
  sceneManager.pointerMove(mouseX, mouseY, "touch");
  return false;
}

function touchEnded() {
  sceneManager.pointerEnd(mouseX, mouseY, "touch");
  return false;
}
