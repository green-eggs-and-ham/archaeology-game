(function registerTrenchPreviewGraphics(root) {
  "use strict";

  const VERSION = 2;
  const now = () => typeof performance !== "undefined" ? performance.now() : Date.now();
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function snapshot(trench) {
    return {
      id: trench.id, seed: trench.seed, rows: trench.rows, columns: trench.columns,
      maxDepth: trench.maxDepth, depthResolutionScale: trench.depthResolutionScale,
      depths: trench.depths.map((row) => [...row]),
      stratigraphy: trench.stratigraphy.map((row) => row.map((column) => [...column])),
      grassMask: trench.grassMask.map((row) => [...row]),
      layers: trench.layers.map((layer) => ({ ...layer })),
      grassLayer: { ...trench.grassLayer }, bedrock: { ...trench.bedrock },
      artefacts: trench.artefacts.filter((find) => ["partial", "revealed"].includes(find.exposure)).map((find) => ({
        id: find.id, visualKey: find.visualKey, shape: find.shape, colour: find.colour,
        centerX: find.centerX, centerY: find.centerY, depth: find.depth,
        footprintSize: trench.artefactFootprintSize || 2,
        visibleQuadrants: [...trench.artefactVisibleQuadrants(find)]
      }))
    };
  }

  function keys(trench, quality = "full") {
    const terrain = [VERSION, trench.id, trench.terrainRevision || 0, quality].join(":");
    return { terrain, preview: `${terrain}:${trench.visualRevision || 0}` };
  }

  function colour(hex) {
    const value = parseInt(hex.slice(1), 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  function releaseImage(image) {
    if (!image) return;
    if (typeof image.close === "function") image.close();
    else if (image.data) image.data = null;
    else image.width = image.height = 1;
  }

  function releaseLevels(levels) {
    if (levels) levels.forEach(releaseImage);
  }

  function filterSource(original, levels, target) {
    let source = original;
    for (const level of levels) {
      // Leave a little detail above the final pixel grid for fractional edges.
      if (level.width < target.width * 4 / target.filterX ||
          level.height < target.height * 4 / target.filterY) break;
      source = level;
    }
    return source;
  }

  function sampleSpans(count, sourceSize, extent, phase, footprint) {
    const scale = sourceSize / extent;
    return Array.from({ length: count }, (_, pixel) => {
      const centre = (pixel + 0.5 - phase) * scale;
      const radius = 0.5 * scale * footprint;
      return [Math.max(0, centre - radius), Math.min(sourceSize, centre + radius)];
    });
  }

  function scaledBounds(rect, scale) {
    return { left: Math.floor(rect.left * scale), right: Math.ceil(rect.right * scale),
      top: Math.floor(rect.top * scale), bottom: Math.ceil(rect.bottom * scale) };
  }

  function changedBounds(previous, current) {
    const rect = { left: Infinity, top: Infinity, right: 0, bottom: 0 };
    const include = (stamp) => {
      rect.left = Math.min(rect.left, stamp.left);
      rect.right = Math.max(rect.right, stamp.right);
      rect.top = Math.min(rect.top, stamp.top);
      rect.bottom = Math.max(rect.bottom, stamp.bottom);
    };
    const old = new Map(previous.map((stamp, index) => [stamp.id, { stamp, index }]));
    let lastIndex = -1;
    for (const stamp of current) {
      const entry = old.get(stamp.id);
      if (entry && entry.index < lastIndex) {
        // Reordered silhouettes can overlap and must be composited in the new order.
        previous.forEach(include);
        current.forEach(include);
        break;
      }
      if (entry) {
        lastIndex = entry.index;
        old.delete(stamp.id);
        if (entry.stamp.key === stamp.key) continue;
        include(entry.stamp);
      }
      include(stamp);
    }
    old.forEach(({ stamp }) => include(stamp));
    return rect.left === Infinity ? { left: 0, top: 0, right: 0, bottom: 0 } : rect;
  }

  // Resolve to integer backing pixels. Some Canvas implementations round the
  // fractional destination of drawImage even with high-quality filtering.
  function* fitPreview(source, target, canvas, previous, dirty) {
    const w = canvas.width = Math.ceil(target.width + target.phaseX);
    const h = canvas.height = Math.ceil(target.height + target.phaseY);
    const context = canvas.getContext("2d");
    if (previous && dirty.left === dirty.right) {
      context.putImageData(previous, 0, 0);
      return previous;
    }
    const image = context.createImageData(w, h);
    let leftPixel = 0, rightPixel = w, topPixel = 0, bottomPixel = h;
    if (previous) {
      image.data.set(previous.data);
      const sx = target.width / source.width, sy = target.height / source.height;
      leftPixel = Math.max(0, Math.floor(target.phaseX + dirty.left * sx - target.filterX / 2));
      rightPixel = Math.min(w, Math.ceil(target.phaseX + dirty.right * sx + target.filterX / 2));
      topPixel = Math.max(0, Math.floor(target.phaseY + dirty.top * sy - target.filterY / 2));
      bottomPixel = Math.min(h, Math.ceil(target.phaseY + dirty.bottom * sy + target.filterY / 2));
    }
    const xs = sampleSpans(w, source.width, target.width, target.phaseX, target.filterX);
    const ys = sampleSpans(h, source.height, target.height, target.phaseY, target.filterY);
    const area = source.width / target.width * source.height / target.height * target.filterX * target.filterY;
    const horizontal = new Float64Array(4 * (rightPixel - leftPixel)), sums = new Float64Array(horizontal.length);
    let lastRow = -1;
    for (let y = topPixel; y < bottomPixel; y++) {
      sums.fill(0);
      const [top, bottom] = ys[y];
      for (let sy = Math.floor(top); sy < bottom; sy++) {
        if (sy !== lastRow) {
          lastRow = sy;
          horizontal.fill(0);
          for (let x = leftPixel; x < rightPixel; x++) {
            const [left, right] = xs[x];
            const i = (x - leftPixel) * 4;
            for (let sx = Math.floor(left); sx < right; sx++) {
              const index = (sy * source.width + sx) * 4;
              const mass = (Math.min(right, sx + 1) - Math.max(left, sx)) * source.data[index + 3];
              horizontal[i] += mass * source.data[index];
              horizontal[i + 1] += mass * source.data[index + 1];
              horizontal[i + 2] += mass * source.data[index + 2];
              horizontal[i + 3] += mass;
            }
          }
        }
        const weight = Math.min(bottom, sy + 1) - Math.max(top, sy);
        for (let i = 0; i < sums.length; i++) sums[i] += horizontal[i] * weight;
      }
      for (let x = leftPixel; x < rightPixel; x++) {
        const i = (x - leftPixel) * 4, offset = (y * w + x) * 4;
        const mass = sums[i + 3];
        if (!mass) continue;
        image.data[offset] = sums[i] / mass;
        image.data[offset + 1] = sums[i + 1] / mass;
        image.data[offset + 2] = sums[i + 2] / mass;
        image.data[offset + 3] = mass / area;
      }
      if (y % 4 === 3) yield;
    }
    context.putImageData(image, 0, 0);
    return image;
  }

  class PreviewEngine {
    constructor(canvasFactory) {
      this.canvasFactory = canvasFactory || ((width, height) => new OffscreenCanvas(width, height));
      this.terrains = new Map();
      this.glyphs = new Map();
      this.artefactRenderer = new root.ArtefactRenderer();
    }

    *buildTerrain(request) {
      const source = request.snapshot;
      const full = request.quality !== "lite";
      const width = full ? 512 : 256;
      const height = width / 2;
      const samples = full ? 8 : 4;
      const atlasWidth = source.columns * samples;
      const atlasHeight = source.rows * samples;
      const palette = [...source.layers, source.bedrock, source.grassLayer];
      const materialById = new Map(palette.map((layer, index) => [layer.id, index]));
      const facade = {
        ...source,
        getDepth: (x, y) => source.depths[y][x],
        getRenderableSurfaceAt: (x, y) => source.depths[y][x] === 0 && source.grassMask[y][x]
          ? source.grassLayer : source.depths[y][x] >= source.maxDepth
            ? source.bedrock : source.layers[source.stratigraphy[y][x][source.depths[y][x]]]
      };
      const engine = root.TerrainGraphics.createEngine({ trench: { maxDepthDarkening: 0.16 } });
      const field = engine.buildVisibleSurfaceField(facade);
      const descriptors = engine.buildLocalJunctionDescriptors(field, facade, {
        x: 0, y: 0, width: source.columns * samples, height: source.rows * samples, cellSize: samples
      });
      const terrain = {
        key: request.terrainKey, source, width, height, atlasWidth, atlasHeight,
        heights: new Uint8Array(atlasWidth * atlasHeight),
        materials: new Uint8Array(atlasWidth * atlasHeight),
        colours: palette.map((layer) => colour(layer.colour)),
        pixels: new Uint8ClampedArray(width * height * 4),
        visibility: new Float32Array(width * height),
        full
      };
      terrain.visibility.fill(Infinity);
      // Fill cell interiors in runs. Each smoothed junction only changes the
      // centre of its quadratic corner lobes to the owner surface.
      for (let row = 0; row < source.rows; row += 1) {
        for (let col = 0; col < source.columns; col += 1) {
          const surface = field[row][col];
          const material = materialById.get(surface.layer.id);
          let start = row * samples * atlasWidth + col * samples;
          for (let dy = 0; dy < samples; dy += 1, start += atlasWidth) {
            terrain.heights.fill(surface.depth, start, start + samples);
            terrain.materials.fill(material, start, start + samples);
          }
        }
        yield;
      }
      const ownerOffsets = [];
      for (let y = 0; y < samples; y += 1) {
        for (let x = 0; x < samples; x += 1) {
          const a = Math.abs(1 - 2 * (x + 0.5) / samples);
          const b = Math.abs(1 - 2 * (y + 0.5) / samples);
          if (Math.sqrt(a) + Math.sqrt(b) < 1) ownerOffsets.push(y * atlasWidth + x);
        }
      }
      for (const { x, y, owner } of descriptors) {
        const start = (y - 0.5) * samples * atlasWidth + (x - 0.5) * samples;
        const material = materialById.get(owner.layer.id);
        for (const offset of ownerOffsets) {
          terrain.heights[start + offset] = owner.depth;
          terrain.materials[start + offset] = material;
        }
      }
      const untouched = source.depths.every((row) => row.every((depth) => depth === 0));
      for (let x = 0; x < width; x += 1) {
        this.drawColumn(terrain, x, untouched);
        yield;
      }
      return terrain;
    }

    // Each pixel in a column has u = t + k and v = t - k. Walk those atlas
    // cells once from near to far. Only rows above the last visible span can
    // still see farther terrain; the near rim is the initial horizon.
    drawColumn(terrain, x, untouched) {
      const { width, height, atlasWidth, atlasHeight, heights } = terrain;
      const k = (x + 0.5) / width - 0.5;
      const far = Math.abs(k);
      let near = 1 - far;
      let row = Math.ceil(near * height - 0.5) - 1;
      const topRow = Math.ceil(far * height - 0.5);
      if (untouched) {
        for (; row >= topRow; row -= 1) {
          const t = (row + 0.5) / height;
          const index = Math.floor((t - k) * atlasHeight) * atlasWidth + Math.floor((t + k) * atlasWidth);
          this.shadeFloor(terrain, index, t + k, t - k, row * width + x);
        }
        return;
      }

      const speed = 0.3 / terrain.source.maxDepth;
      let colU = Math.ceil((near + k) * atlasWidth) - 1;
      let colV = Math.ceil((near - k) * atlasHeight) - 1;
      let nearDepth = 0;
      let axis = 0;
      while (colU >= 0 && colV >= 0 && row >= topRow) {
        const index = colV * atlasWidth + colU;
        const depth = heights[index];
        const crossU = colU / atlasWidth - k;
        const crossV = colV / atlasHeight + k;
        const next = Math.max(crossU, crossV);
        if (depth < nearDepth) {
          row = this.drawWall(terrain, x, row, topRow, near, k, axis, depth, nearDepth, speed);
        }
        const shift = depth * speed;
        const firstFloorRow = Math.max(topRow, Math.ceil((next + shift) * height - 0.5 - 1e-8));
        for (; row >= firstFloorRow; row -= 1) {
          const t = (row + 0.5) / height - shift;
          this.shadeFloor(terrain, index, t + k, t - k, row * width + x);
        }
        // At a shared vertex enter the diagonal cell, with the same face
        // convention as the reference ray at an exact corner.
        axis = crossU > crossV ? 1 : 2;
        if (crossU >= crossV - 1e-12) colU -= 1;
        if (crossV >= crossU - 1e-12) colV -= 1;
        near = next;
        nearDepth = depth;
      }
      if (row >= topRow) this.drawWall(terrain, x, row, topRow, far, k, axis, 0, nearDepth, speed);
    }

    grain(terrain, u, v) {
      const gx = Math.floor(u * terrain.source.columns * 18);
      const gy = Math.floor(v * terrain.source.rows * 18);
      return ((gx * 73856093) ^ (gy * 19349663) ^ terrain.source.seed) >>> 0;
    }

    shadeFloor(terrain, index, u, v, pixel) {
      const { source, heights, materials, atlasWidth } = terrain;
      const depth = heights[index];
      const material = materials[index];
      let light = 1.03 * (1 - depth / source.maxDepth * 0.16);
      const hash = terrain.full ? this.grain(terrain, u, v) : 0;
      if (terrain.full) light += ((hash % 19) - 9) * 0.005;
      if (depth) {
        const left = index - Math.min(2, index % atlasWidth);
        const up = index - Math.min(2, Math.floor(index / atlasWidth)) * atlasWidth;
        if (heights[left] < depth || heights[up] < depth) light *= 0.83;
      }
      if (terrain.full && material === source.layers.length + 1 && hash % 9 === 0) light *= 0.78;
      terrain.visibility[pixel] = depth;
      const base = terrain.colours[material];
      const offset = pixel * 4;
      terrain.pixels[offset] = base[0] * light;
      terrain.pixels[offset + 1] = base[1] * light;
      terrain.pixels[offset + 2] = base[2] * light;
      terrain.pixels[offset + 3] = 255;
    }

    drawWall(terrain, x, row, topRow, t, k, axis, shallow, deep, speed) {
      const { height, width, source, colours, pixels } = terrain;
      const first = Math.max(topRow, Math.ceil((t + shallow * speed) * height - 0.5 - 1e-8));
      if (row < first) return row;
      // Sample just inside the far cell, including the two exterior faces.
      const u = clamp(t + k - speed * 1e-7, 0, 1);
      const v = clamp(t - k - speed * 1e-7, 0, 1);
      const strata = source.stratigraphy[Math.min(source.rows - 1, Math.floor(v * source.rows))]
        [Math.min(source.columns - 1, Math.floor(u * source.columns))];
      const grain = terrain.full ? ((this.grain(terrain, u, v) % 19) - 9) * 0.005 : 0;
      const direction = axis === 1 ? 0.7 : 0.82;
      const halfPixel = 0.5 / (height * speed);
      for (; row >= first; row -= 1) {
        const depth = clamp(((row + 0.5) / height - t) / speed, shallow, deep);
        const light = direction * (1 - depth / source.maxDepth * 0.16) + grain;
        // Integrate both the strata and the 0.06-depth pencil line over this
        // pixel's visible wall. A subpixel line keeps its fractional contrast.
        const low = Math.max(shallow, depth - halfPixel);
        const high = Math.min(deep, depth + halfPixel);
        let r = 0, g = 0, b = 0;
        for (let layer = Math.floor(low); layer < high; layer += 1) {
          const start = Math.max(low, layer);
          const end = Math.min(high, layer + 1);
          const ink = terrain.full ? Math.max(0, Math.min(end, layer + 0.06) - start) : 0;
          const weight = end - start - 0.06 * ink;
          const base = colours[strata[layer]];
          r += base[0] * weight;
          g += base[1] * weight;
          b += base[2] * weight;
        }
        const pixel = row * width + x;
        terrain.visibility[pixel] = depth;
        const scale = light / (high - low);
        pixels[pixel * 4] = r * scale;
        pixels[pixel * 4 + 1] = g * scale;
        pixels[pixel * 4 + 2] = b * scale;
        pixels[pixel * 4 + 3] = 255;
      }
      return row;
    }

    glyph(find) {
      const key = `${find.visualKey || find.shape}:${find.colour}`;
      if (this.glyphs.has(key)) return this.glyphs.get(key);
      const canvas = this.canvasFactory(64, 64);
      canvas.width = canvas.height = 64;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      context.translate(32, 32);
      this.artefactRenderer.tracePath(find, 48, context);
      context.fillStyle = find.colour;
      context.strokeStyle = "#453024";
      context.lineWidth = 2;
      context.fill();
      context.stroke();
      if (["coin", "bead"].includes(this.artefactRenderer.visualFor(find).silhouette)) {
        context.beginPath();
        context.arc(0, 0, find.shape === "bead" ? 5 : 17, 0, Math.PI * 2);
        context.stroke();
      }
      const pixels = context.getImageData(0, 0, 64, 64).data;
      this.glyphs.set(key, pixels);
      canvas.width = canvas.height = 1;
      return pixels;
    }

    findStamp({ width, height, source }, find) {
      const size = find.footprintSize || 2;
      const u = (find.centerX + 0.5) / source.columns, v = (find.centerY + 0.5) / source.rows;
      const x = width * (0.5 + (u - v) / 2), y = height * ((u + v) / 2 + 0.3 * find.depth / source.maxDepth);
      const radius = size / 4 * (1 / source.columns + 1 / source.rows);
      return {
        id: find.id,
        key: JSON.stringify([find.id, find.visualKey, find.shape, find.colour, u, v, size, find.depth, find.visibleQuadrants]),
        left: clamp(Math.floor(x - width * radius), 0, width), right: clamp(Math.ceil(x + width * radius), 0, width),
        top: clamp(Math.floor(y - height * radius), 0, height), bottom: clamp(Math.ceil(y + height * radius), 0, height)
      };
    }

    *compose(terrain, finds, pixels, stamps) {
      const { width, height, visibility, source } = terrain;
      for (let i = 0; i < finds.length; i++) {
        const find = finds[i], bounds = stamps[i];
        const glyph = this.glyph(find);
        const size = find.footprintSize || 2;
        for (let y = bounds.top; y < bounds.bottom; y += 1) {
          for (let x = bounds.left; x < bounds.right; x += 1) {
            const index = y * width + x;
            if (!Number.isFinite(visibility[index]) || find.depth > visibility[index] + 0.02) continue;
            const u = (x + 0.5) / width + (y + 0.5) / height - 0.5 - 0.3 * find.depth / source.maxDepth;
            const v = (y + 0.5) / height - (x + 0.5) / width + 0.5 - 0.3 * find.depth / source.maxDepth;
            const tx = (u * source.columns - find.centerX - 0.5) / size + 0.5;
            const ty = (v * source.rows - find.centerY - 0.5) / size + 0.5;
            if (tx < 0 || ty < 0 || tx >= 1 || ty >= 1) continue;
            const quadrant = (ty >= 0.5 ? 2 : 0) + (tx >= 0.5 ? 1 : 0);
            if (!find.visibleQuadrants.includes(quadrant)) continue;
            const sample = (Math.floor(ty * 64) * 64 + Math.floor(tx * 64)) * 4;
            const alpha = glyph[sample + 3] / 255;
            if (!alpha) continue;
            for (let channel = 0; channel < 3; channel += 1) {
              pixels[index * 4 + channel] = glyph[sample + channel] * alpha + pixels[index * 4 + channel] * (1 - alpha);
            }
          }
          yield;
        }
      }
    }

    *buildLevels(image, width, height, levels, previous, dirty) {
      // Average 2×2 texels in premultiplied alpha. Transparent texels outside
      // the rim contribute coverage without introducing a dark fringe.
      while (width > 16) {
        const source = image.data;
        const stride = width * 4;
        width /= 2;
        height /= 2;
        const cached = previous?.[levels.length];
        image = { width, height, data: cached ? cached.data.slice() : new Uint8ClampedArray(width * height * 4) };
        levels.push(image);
        const target = image.data;
        if (dirty) dirty = scaledBounds(dirty, 0.5);
        const bounds = dirty || { left: 0, top: 0, right: width, bottom: height };
        for (let y = bounds.top; y < bounds.bottom; y += 1) {
          let input = y * 2 * stride + bounds.left * 8;
          let output = (y * width + bounds.left) * 4;
          for (let x = bounds.left; x < bounds.right; x += 1, input += 8, output += 4) {
            const lower = input + stride;
            const a = source[input + 3], b = source[input + 7];
            const c = source[lower + 3], d = source[lower + 7];
            const coverage = a + b + c + d;
            if (!coverage) continue;
            target[output + 3] = coverage * 0.25;
            for (let channel = 0; channel < 3; channel += 1) {
              const upper = input + channel;
              const bottom = lower + channel;
              target[output + channel] = coverage === 1020
                ? (source[upper] + source[upper + 4] + source[bottom] + source[bottom + 4]) * 0.25
                : (a * source[upper] + b * source[upper + 4] + c * source[bottom] + d * source[bottom + 4]) / coverage;
            }
          }
          if (y % 8 === 7) yield;
        }
        yield;
      }
    }

    *render(request, canvas) {
      const started = now();
      let terrain = this.terrains.get(request.trenchId);
      const rebuilt = terrain?.key !== request.terrainKey;
      if (rebuilt) terrain = yield* this.buildTerrain(request);
      canvas.width = terrain.width;
      canvas.height = terrain.height;
      const context = canvas.getContext("2d");
      const image = context.createImageData(terrain.width, terrain.height);
      image.data.set(terrain.pixels);
      const finds = request.snapshot.artefacts;
      const stamps = finds.map((find) => this.findStamp(terrain, find));
      const previous = terrain.composition;
      const dirty = previous && changedBounds(previous.stamps, stamps);
      yield* this.compose(terrain, finds, image.data, stamps);
      context.putImageData(image, 0, 0);
      const levels = [];
      let fitted = null;
      let fitPixels = null;
      let completed = false;
      try {
        yield* this.buildLevels(image, terrain.width, terrain.height, levels, previous?.levels, dirty);
        if (request.display) {
          const original = { width: terrain.width, height: terrain.height, data: image.data };
          const source = filterSource(original, levels, request.display);
          const oldFit = previous?.fitPixels && previous.fitKey === request.display.key ? previous.fitPixels : null;
          fitted = this.canvasFactory(1, 1);
          fitPixels = yield* fitPreview(source, request.display, fitted, oldFit,
            oldFit ? scaledBounds(dirty, source.width / terrain.width) : null);
        }
        // Transfer independent buffers. A later edit can reuse all pixels
        // outside the old and new find footprints, even after collection.
        terrain.composition = stamps.length ? {
          stamps, levels: levels.map((level) => ({ ...level, data: level.data.slice() })),
          fitKey: request.display?.key, fitPixels
        } : null;
        if (rebuilt) this.terrains.set(request.trenchId, terrain);
        completed = true;
        return {
          rebuilt, width: terrain.width, height: terrain.height, levels, fitted, fitKey: request.display?.key,
          renderMs: now() - started, retainedBytes: this.retainedBytes()
        };
      } finally {
        if (!completed) { releaseLevels(levels); releaseImage(fitted); }
      }
    }

    retainedBytes() {
      let bytes = 0;
      this.terrains.forEach((terrain) => {
        bytes += terrain.pixels.byteLength + terrain.visibility.byteLength + terrain.heights.byteLength + terrain.materials.byteLength;
        for (const level of terrain.composition?.levels || []) bytes += level.data.byteLength;
        bytes += terrain.composition?.fitPixels?.data.byteLength || 0;
      });
      this.glyphs.forEach((glyph) => { bytes += glyph.byteLength; });
      return bytes;
    }

    dispose() {
      this.terrains.clear();
      this.glyphs.clear();
    }
  }

  root.TrenchPreviewGraphics = { VERSION, snapshot, keys, PreviewEngine, now, releaseImage, releaseLevels, filterSource, fitPreview };
})(typeof self !== "undefined" ? self : window);
