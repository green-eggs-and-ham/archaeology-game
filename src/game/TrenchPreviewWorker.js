self.window = self;
importScripts("./TerrainGraphics.js", "./ArtefactRenderer.js", "./TrenchPreviewGraphics.js");

const previewEngine = new self.TrenchPreviewGraphics.PreviewEngine();
const previewCanvas = new OffscreenCanvas(1, 1);
const continuation = new MessageChannel();
let activePreview = null;
let continuationPending = false;

function schedulePreview() {
  if (!activePreview || continuationPending) return;
  continuationPending = true;
  continuation.port2.postMessage(null);
}

function cancelPreview(jobId) {
  if (activePreview?.request.jobId !== jobId) return;
  const job = activePreview;
  activePreview = null;
  job.iterator.return();
  previewCanvas.width = previewCanvas.height = 1;
  self.postMessage({
    type: "preview-cancelled", jobId, computeMs: job.computeMs,
    elapsedMs: self.TrenchPreviewGraphics.now() - job.startedAt,
    retainedBytes: previewEngine.retainedBytes()
  });
}

continuation.port1.onmessage = () => {
  continuationPending = false;
  const job = activePreview;
  if (!job) return;
  const began = self.TrenchPreviewGraphics.now();
  try {
    let step;
    do { step = job.iterator.next(); } while (!step.done && self.TrenchPreviewGraphics.now() - began < 8);
    const duration = self.TrenchPreviewGraphics.now() - began;
    job.computeMs += duration;
    job.maxChunkMs = Math.max(job.maxChunkMs, duration);
    if (!step.done) {
      schedulePreview();
      return;
    }
    const { levels, fitted, ...result } = step.value;
    const images = [];
    try {
      images.push(previewCanvas.transferToImageBitmap());
      if (fitted) images.push(fitted.transferToImageBitmap());
      activePreview = null;
      const transferTime = self.TrenchPreviewGraphics.now() - began;
      self.postMessage({
        type: "preview-result", jobId: job.request.jobId, trenchId: job.request.trenchId,
        key: job.request.key, bitmap: images[0], levels, fitted: images[1], ...result,
        computeMs: job.computeMs + transferTime - duration, maxChunkMs: Math.max(job.maxChunkMs, transferTime),
        elapsedMs: self.TrenchPreviewGraphics.now() - job.startedAt
      }, [...images, ...levels.map((level) => level.data.buffer)]);
    } catch (error) {
      self.TrenchPreviewGraphics.releaseLevels(images);
      throw error;
    } finally {
      self.TrenchPreviewGraphics.releaseImage(fitted);
    }
  } catch (error) {
    activePreview = null;
    job.iterator.return();
    self.postMessage({ type: "preview-error", jobId: job.request.jobId, message: String(error) });
  }
};

self.onmessage = (event) => {
  const request = event.data;
  if (request.type === "cancel-preview") {
    cancelPreview(request.jobId);
    return;
  }
  // Historical untyped requests remain usable by browser diagnostics.
  if (request.type && request.type !== "render-preview") return;
  if (activePreview) cancelPreview(activePreview.request.jobId);
  activePreview = {
    request, iterator: previewEngine.render(request, previewCanvas),
    startedAt: self.TrenchPreviewGraphics.now(), computeMs: 0, maxChunkMs: 0
  };
  schedulePreview();
};
