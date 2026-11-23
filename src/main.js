let sceneManager;
let firstFramePresented = false;
let activeCanvasDensity = 1;
let canvasResizeObserver = null;
let densityQuery = null;

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

function getCanvasPixelDensity(size) {
  const canvasConfig = window.GameConfig.canvas;
  const deviceDensity = Math.max(1, window.devicePixelRatio || 1);
  const compactDensity = Math.min(deviceDensity, canvasConfig.compactPixelDensity || 2);
  const isCompactViewport = window.innerWidth <= canvasConfig.compactBreakpoint;
  const pixelBudget = canvasConfig.maxCompactCanvasPixels || 1300000;
  return isCompactViewport && size.width * size.height * compactDensity * compactDensity <= pixelBudget
    ? compactDensity
    : 1;
}

function watchDisplayDensity() {
  densityQuery?.removeEventListener("change", displayDensityChanged);
  densityQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
  densityQuery?.addEventListener("change", displayDensityChanged);
}

function displayDensityChanged() {
  watchDisplayDensity();
  windowResized();
}

function setup() {
  try {
    window.GameConfigValidator.validate(window.GameConfig, {
      visualRegistry: window.ArtefactRenderer.visualRegistry()
    });
  } catch (error) {
    window.GameBoot?.resourceFailed("Game configuration");
    throw error;
  }

  const size = getCanvasSize();
  activeCanvasDensity = getCanvasPixelDensity(size);
  const canvas = createCanvas(size.width, size.height);
  // p5 creates a new renderer using the display DPR. Apply the budget to that
  // renderer so a cold launch gets the same backing store as a later resize.
  if (pixelDensity() !== activeCanvasDensity) pixelDensity(activeCanvasDensity);
  canvas.parent("game-shell");
  canvas.elt.setAttribute("aria-label", "Archaeology excavation and artefact cleaning game");
  noLoop();

  sceneManager = new window.SceneManager(window.GameConfig);
  window.sceneManager = sceneManager;
  sceneManager.previewBootTracking = true;
  window.GameBoot?.addResources(sceneManager.trenches.length);
  sceneManager.siteScene.prepare();
  // Removing the boot overlay can change the flex shell's measured width.
  // Follow the actual host size as well as browser-window resize events.
  if (typeof ResizeObserver === "function") {
    canvasResizeObserver = new ResizeObserver(() => {
      const next = getCanvasSize();
      if (next.width !== width || next.height !== height || getCanvasPixelDensity(next) !== activeCanvasDensity) windowResized();
      else if (sceneManager.currentScene === "site") sceneManager.requestFrame();
    });
    canvasResizeObserver.observe(document.getElementById("game-shell"));
  }
  watchDisplayDensity();
  window.addEventListener("pagehide", (event) => {
    if (event.persisted) return;
    canvasResizeObserver?.disconnect();
    densityQuery?.removeEventListener("change", displayDensityChanged);
    sceneManager.releaseInventory();
    sceneManager.releaseProfile();
    sceneManager.siteScene.dispose();
    sceneManager.terrainPipeline.dispose();
  });
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
  if (!firstFramePresented && sceneManager.siteScene.isReady()) {
    firstFramePresented = true;
    window.GameBoot?.markReady();
  }
}

function windowResized() {
  const size = getCanvasSize();
  const nextDensity = getCanvasPixelDensity(size);
  activeCanvasDensity = nextDensity;
  if (pixelDensity() !== nextDensity) pixelDensity(nextDensity);
  if (width !== size.width || height !== size.height) resizeCanvas(size.width, size.height, true);
  sceneManager.handleResize();
  redraw();
}
