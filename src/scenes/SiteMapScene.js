(function registerSiteMapScene(root) {
  "use strict";

  class SiteMapScene {
    constructor(host) {
      this.host = host;
      this.pipeline = new root.TrenchPreviewPipeline(host);
      this.ground = null;
    }

    prepare() { this.pipeline.prepareSite(); }
    isReady() { return this.pipeline.isReady(); }
    changed(trench) { this.pipeline.changed(trench); }
    gestureEnded() { this.pipeline.gestureEnded(); }
    excavationStarted() { this.pipeline.excavationStarted(); }
    sceneChanged() { this.pipeline.sceneChanged(); }

    enter() {
      const host = this.host;
      if (host.currentScene === "trench") host.trenchScene.leave();
      if (host.currentScene === "cleaning") host.cleaningScene.leave();
      host.pointerAction = null;
      host.debugMenuOpen = false;
      host.currentScene = "site";
      host.message = "Choose a trench to continue exploring.";
      host.messageTone = "neutral";
      this.prepare();
      host.requestFrame();
    }

    handleResize() {
      if (this.ground) this.ground.width = this.ground.height = 1;
      this.ground = null;
      this.layout = null;
    }

    computeLayout(canvasWidth, canvasHeight) {
      const map = this.host.config.map || { rows: 0, columns: 0 };
      const walkway = 1 / (this.host.config.trench.columns || 20);
      const spanU = map.columns + (map.columns + 1) * walkway;
      const spanV = map.rows + (map.rows + 1) * walkway;
      const top = 98; // Space above the ground plane for the grid references.
      const bottom = canvasHeight - 65;
      const tileWidth = Math.max(1, Math.min((canvasWidth - 36) * 2 / Math.max(1, spanU + spanV),
        (bottom - top - 14) * 4 / Math.max(1, spanU + spanV)));
      const tileHeight = tileWidth / 2;
      const siteHeight = (spanU + spanV) * tileHeight / 2;
      const originX = canvasWidth / 2 - (spanU - spanV) * tileWidth / 4;
      const originY = top + Math.max(0, (bottom - top - siteHeight - 14) / 2);
      const project = (u, v) => ({ x: originX + (u - v) * tileWidth / 2, y: originY + (u + v) * tileHeight / 2 });
      const tiles = [];
      for (let row = 0; row < map.rows; row += 1) {
        for (let column = 0; column < map.columns; column += 1) {
          const trench = this.host.trenches[row * map.columns + column];
          if (!trench) continue;
          const u = walkway + column * (1 + walkway);
          const v = walkway + row * (1 + walkway);
          const center = project(u + 0.5, v + 0.5);
          tiles.push({ ...center, width: tileWidth, height: tileHeight, u, v, trench });
        }
      }
      const axisLabels = [];
      const addLabel = (alongRows, index, label) => {
        const middle = walkway + index * (1 + walkway) + 0.5;
        const edge = alongRows ? project(0, middle) : project(middle, 0);
        axisLabels.push({ label, x: edge.x + (alongRows ? -7 : 7), y: edge.y - 14 });
      };
      for (let row = 0; row < map.rows; row++) addLabel(true, row, String.fromCharCode(65 + row));
      for (let column = 0; column < map.columns; column++) addLabel(false, column, String(column + 1));
      return { spanU, spanV, originX, originY, tileWidth, tileHeight, project, tiles, axisLabels };
    }

    path(context, points) {
      context.beginPath();
      points.forEach((point, index) => index ? context.lineTo(point.x, point.y) : context.moveTo(point.x, point.y));
      context.closePath();
    }

    buildGround(layout) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      const corners = [[0, 0], [layout.spanU, 0], [layout.spanU, layout.spanV], [0, layout.spanV]].map(([u, v]) => layout.project(u, v));
      const lowered = (point) => ({ x: point.x, y: point.y + 11 });
      this.path(context, [corners[1], corners[2], lowered(corners[2]), lowered(corners[1])]);
      context.fillStyle = "#5b4735";
      context.fill();
      this.path(context, [corners[2], corners[3], lowered(corners[3]), lowered(corners[2])]);
      context.fillStyle = "#463b2d";
      context.fill();
      this.path(context, corners);
      context.fillStyle = "#b49c70";
      context.fill();
      context.save();
      context.clip();
      for (let index = 0; index < 550; index += 1) {
        const u = ((index * 137) % 557) / 557 * layout.spanU;
        const v = ((index * 211) % 563) / 563 * layout.spanV;
        const point = layout.project(u, v);
        context.fillStyle = index % 3 ? "rgba(73,58,35,.12)" : "rgba(255,244,205,.22)";
        context.fillRect(point.x, point.y, 1.5, 1);
      }
      context.restore();
      this.ground = canvas;
      this.host.updateCanvasPixelStats?.();
    }

    draw() {
      const host = this.host;
      if (!this.isReady()) {
        host.mapTiles = [];
        // A real preparation gate: no old preview is shown as current progress.
        fill("#fff9e9");
        noStroke();
        textAlign(CENTER, CENTER);
        textSize(Math.max(14, Math.min(20, width * 0.035)));
        text("Preparing dig site…", width / 2, height / 2);
        return;
      }
      host.drawHeading("Dig Site", width < 640 ? "Choose a trench." : "Choose a trench to start digging.");
      const labWidth = Math.max(104, Math.min(160, width * 0.24));
      const labHeight = Math.max(30, Math.min(38, height * 0.09));
      host.layout.labButton = { x: width - labWidth - 14, y: 12, width: labWidth, height: labHeight };
      host.renderer.button(host.layout.labButton, "Finds lab", false, true, false, {
        badgeCount: host.pendingCleaningCount(), minimumSize: 9, maximumSize: 13
      });
      const layout = this.layout ||= this.computeLayout(width, height);
      host.mapTiles = layout.tiles;
      if (layout.tiles.length) {
        if (host.mapRenderMode === "flat") layout.tiles.forEach((tile) => host.drawMapTile(tile));
        else {
          if (!this.ground) this.buildGround(layout);
          drawingContext.drawImage(this.ground, 0, 0);
          const scale = this.displayScale();
          const hovered = host.pointer && host.hitMapTile(host.pointer.x, host.pointer.y);
          drawingContext.save();
          drawingContext.imageSmoothingEnabled = true;
          drawingContext.imageSmoothingQuality = "high";
          for (const tile of layout.tiles) {
            this.pipeline.stats.cacheHits += 1;
            this.drawPreview(drawingContext, this.pipeline.cache.get(tile.trench.id), tile, scale);
          }
          layout.tiles.forEach((tile) => this.drawRim(tile, tile === hovered));
          drawingContext.restore();
        }
        const context = drawingContext;
        context.save();
        const size = Math.max(13 / Math.max(0.6, Math.min(1, this.displayScale()?.css || 1)), Math.min(19, layout.tileWidth * 0.1));
        context.textAlign = "center";
        context.textBaseline = "middle";
        context.font = `bold ${size}px sans-serif`;
        context.fillStyle = "#fff4d8";
        for (const ref of layout.axisLabels) context.fillText(ref.label, ref.x, ref.y);
        for (const tile of layout.tiles) this.drawProgress(tile, size);
        context.restore();
      }
      this.drawHint();
    }

    displayScale() {
      const canvas = typeof drawingContext !== "undefined" && drawingContext.canvas;
      if (!canvas?.getBoundingClientRect) return null;
      const bounds = canvas.getBoundingClientRect();
      const dpr = root.devicePixelRatio || 1;
      const transform = drawingContext.getTransform();
      return { x: transform.a, y: transform.d, offsetX: transform.e, offsetY: transform.f,
        css: Math.min(bounds.width / width, bounds.height / height),
        filterX: Math.max(1, canvas.width / Math.max(1, bounds.width * dpr)),
        filterY: Math.max(1, canvas.height / Math.max(1, bounds.height * dpr)) };
    }

    tileTarget(tile, scale, sourceWidth) {
      const w = tile.width * scale.x, h = tile.height * scale.y;
      if (w / scale.filterX >= sourceWidth && h / scale.filterY >= sourceWidth / 2) return null;
      const left = (tile.x - tile.width / 2) * scale.x + (scale.offsetX || 0);
      const top = (tile.y - tile.height / 2) * scale.y + (scale.offsetY || 0);
      const x = Math.floor(left), y = Math.floor(top);
      const target = { x, y, width: w, height: h, phaseX: left - x, phaseY: top - y,
        filterX: scale.filterX, filterY: scale.filterY };
      target.key = [w, h, target.phaseX, target.phaseY, scale.filterX, scale.filterY].map((v) => v.toFixed(6)).join(":");
      return target;
    }

    previewTarget(trenchId) {
      const scale = this.displayScale();
      if (!scale) return null;
      const layout = this.layout ||= this.computeLayout(width, height);
      const tile = layout.tiles.find((item) => item.trench.id === trenchId);
      return tile && this.tileTarget(tile, scale, this.host.performanceMode === "lite" ? 256 : 512);
    }

    drawPreview(context, record, tile, scale) {
      const target = this.tileTarget(tile, scale, record.width);
      if (!target) {
        if (record.fitted) {
          root.TrenchPreviewGraphics.releaseImage(record.fitted);
          record.fitted = null;
          record.fitKey = null;
          if (this.pipeline.cache.get(record.trenchId) === record) this.pipeline.updateBitmapBytes();
        }
        context.drawImage(record.bitmap, tile.x - tile.width / 2, tile.y - tile.height / 2, tile.width, tile.height);
        return;
      }
      if (record.fitKey !== target.key || !record.fitted) {
        // The background job usually supplies this exact fit. A resize only
        // filters cached colours; it never submits another terrain job.
        const graphics = root.TrenchPreviewGraphics;
        let source = graphics.filterSource(record.bitmap, record.levels || [], target);
        if (source === record.bitmap) {
          const readback = document.createElement("canvas");
          readback.width = source.width;
          readback.height = source.height;
          const reader = readback.getContext("2d", { willReadFrequently: true });
          reader.drawImage(source, 0, 0);
          source = reader.getImageData(0, 0, readback.width, readback.height);
          graphics.releaseImage(readback);
        }
        const canvas = document.createElement("canvas");
        const fit = graphics.fitPreview(source, target, canvas);
        while (!fit.next().done) { /* layout-only resampling */ }
        graphics.releaseImage(record.fitted);
        record.fitted = canvas;
        record.fitKey = target.key;
        if (this.pipeline.cache.get(record.trenchId) === record) this.pipeline.updateBitmapBytes();
      }
      context.save();
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.drawImage(record.fitted, target.x, target.y);
      context.restore();
    }

    drawRim(tile, hovered) {
      const context = drawingContext;
      this.path(context, [
        { x: tile.x, y: tile.y - tile.height / 2 }, { x: tile.x + tile.width / 2, y: tile.y },
        { x: tile.x, y: tile.y + tile.height / 2 }, { x: tile.x - tile.width / 2, y: tile.y }
      ]);
      context.strokeStyle = hovered ? "#ffe4a0" : "rgba(56,43,29,.65)";
      context.lineWidth = hovered ? 2 : 1;
      context.stroke();
    }

    drawProgress(tile, fontSize) {
      const count = tile.trench.artefacts.filter((find) => find.exposure === "collected").length;
      if (!count) return;
      const context = drawingContext;
      const x = tile.x + tile.width * 0.23, y = tile.y + tile.height * 0.23;
      const radius = Math.max(6, fontSize * 0.55);
      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fillStyle = tile.trench.isComplete() ? "#4c9d67" : "#f4b942";
      context.fill();
      context.fillStyle = "#17333b";
      context.font = `bold ${radius * 1.45}px sans-serif`;
      context.fillText(String(count), x, y);
    }

    drawFlatTile(tile) {
      const { x, y, width: tileWidth, height: tileHeight, trench } = tile;
      const soil = trench.getRenderableSurfaceAt(Math.floor(trench.columns / 2), Math.floor(trench.rows / 2));
      const topY = y;
      const bottomY = y + tileHeight * 0.25;

      noStroke();
      fill("#102d34");
      quad(x, bottomY + tileHeight * 0.16, x + tileWidth / 2, bottomY, x, bottomY - tileHeight * 0.16, x - tileWidth / 2, bottomY);
      fill(soil.colour);
      quad(x, topY - tileHeight / 2, x + tileWidth / 2, topY, x, topY + tileHeight / 2, x - tileWidth / 2, topY);
      stroke("#ecd9ab");
      strokeWeight(1.5);
      noFill();
      quad(x, topY - tileHeight / 2, x + tileWidth / 2, topY, x, topY + tileHeight / 2, x - tileWidth / 2, topY);
      noStroke();

    }


    drawHint() {
      const host = this.host;
      const hint = "Tap a diamond to inspect a trench from above.";
      const hintMaxWidth = Math.max(120, width - 36);
      let hintSize = Math.max(9, Math.min(14, width * 0.017));
      textSize(hintSize);
      while (hintSize > 9 && textWidth(hint) > hintMaxWidth - 24) textSize(hintSize -= 0.5);
      const hintWidth = Math.min(hintMaxWidth, Math.max(210, textWidth(hint) + 24));
      host.renderer.panel(18, height - 45, hintWidth, 30, "#e6d3a9");
      fill("#25444a");
      textAlign(LEFT, CENTER);
      textSize(hintSize);
      text(hint, 30, height - 30);
    }

    dispose() { this.handleResize(); this.pipeline.dispose(); }
  }

  root.SiteMapScene = SiteMapScene;
})(typeof window !== "undefined" ? window : globalThis);
