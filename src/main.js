let sceneManager;
let firstFramePresented = false;

function getCanvasSize() {
  const shell = document.getElementById("game-shell");
  const maxWidth = window.GameConfig.canvas.maxWidth;
  const availableWidth = Math.max(280, shell.clientWidth || maxWidth);
  const canvasWidth = Math.min(maxWidth, availableWidth);
  const isCompactViewport = window.innerWidth <= window.GameConfig.canvas.compactBreakpoint;
  const isNarrowPortrait = isCompactViewport && window.innerHeight > window.innerWidth;
  const aspectRatio = isNarrowPortrait
    ? window.GameConfig.canvas.portraitAspectRatio
    : isCompactViewport
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
  window.sceneManager = sceneManager;
  installCanvasPointerEvents(canvas.elt);
  redraw();
}

function canvasPointFromEvent(canvas, event) {
  const bounds = canvas.getBoundingClientRect();
  return {
    x: (event.clientX - bounds.left) * width / Math.max(1, bounds.width),
    y: (event.clientY - bounds.top) * height / Math.max(1, bounds.height)
  };
}

function installCanvasPointerEvents(canvas) {
  let capturedPointerId = null;
  const sourceFor = (event) => event.pointerType === "mouse" ? "mouse" : "touch";

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== undefined && event.button !== 0) return;
    const point = canvasPointFromEvent(canvas, event);
    capturedPointerId = event.pointerId;
    canvas.setPointerCapture?.(event.pointerId);
    sceneManager.pointerStart(point.x, point.y, sourceFor(event));
    event.preventDefault();
  });

  canvas.addEventListener("pointermove", (event) => {
    const point = canvasPointFromEvent(canvas, event);
    if (capturedPointerId === event.pointerId) {
      sceneManager.pointerMove(point.x, point.y, sourceFor(event));
    } else if (event.pointerType === "mouse") {
      sceneManager.pointerHover(point.x, point.y);
    }
    event.preventDefault();
  });

  const finishPointer = (event, cancelled = false) => {
    if (capturedPointerId !== event.pointerId) return;
    const point = canvasPointFromEvent(canvas, event);
    if (cancelled) sceneManager.pointerCancel(point.x, point.y, sourceFor(event));
    else sceneManager.pointerEnd(point.x, point.y, sourceFor(event));
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    capturedPointerId = null;
    event.preventDefault();
  };

  canvas.addEventListener("pointerup", (event) => finishPointer(event));
  canvas.addEventListener("pointercancel", (event) => finishPointer(event, true));
  canvas.addEventListener("pointerleave", () => {
    if (capturedPointerId === null) sceneManager.pointerLeave();
  });
}

function draw() {
  sceneManager.draw();
  if (!firstFramePresented) {
    firstFramePresented = true;
    window.GameBoot?.markReady();
  }
}

function windowResized() {
  const size = getCanvasSize();
  resizeCanvas(size.width, size.height);
  sceneManager.handleResize();
  redraw();
}
