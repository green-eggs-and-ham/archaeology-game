self.window = self;
importScripts("./TerrainGraphics.js");

const terrainEngine = self.TerrainGraphics.createEngine();
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
    const result = self.TerrainGraphics.render(request, canvas, terrainEngine);
    const bitmap = canvas.transferToImageBitmap();
    self.postMessage({
      type: "terrain-result",
      jobId: request.jobId,
      key: request.key,
      bitmap,
      sourcePixelWidth: request.pixelWidth,
      sourcePixelHeight: request.pixelHeight,
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
