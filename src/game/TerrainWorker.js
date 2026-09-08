self.window = self;
importScripts("./SceneManager.js", "./TerrainGraphics.js");

const terrainManager = self.TerrainGraphics.createManager();
let terrainCanvas = null;

function terrainSurface(width, height) {
  if (!terrainCanvas) terrainCanvas = new OffscreenCanvas(width, height);
  if (terrainCanvas.width !== width) terrainCanvas.width = width;
  if (terrainCanvas.height !== height) terrainCanvas.height = height;
  return terrainCanvas;
}

self.onmessage = (event) => {
  const request = event.data;
  try {
    const canvas = terrainSurface(request.pixelWidth, request.pixelHeight);
    const result = self.TerrainGraphics.render(request, canvas, terrainManager);
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({
      type: "terrain-result",
      jobId: request.jobId,
      key: request.key,
      bitmap,
      sourcePixelWidth: request.width * request.density,
      sourcePixelHeight: request.height * request.density,
      timings: result.timings,
      stats: result.stats
    }, [bitmap]);
  } catch (error) {
    self.postMessage({
      type: "terrain-error",
      jobId: request.jobId,
      key: request.key,
      message: error instanceof Error ? error.message : String(error)
    });
  }
};
