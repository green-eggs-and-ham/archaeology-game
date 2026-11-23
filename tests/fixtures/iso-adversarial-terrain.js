(function registerFixtures(root) {
  "use strict";
  const patterns = {
    "deep-checkerboard": (x, y) => (x + y) % 2 ? 14 : 16,
    "deep-mosaic": (x, y) => 12 + (((x * 73856093) ^ (y * 19349663)) >>> 0) % 5,
    "deep-floor": () => 16,
    "cliff-checkerboard": (x, y) => (x + y) % 2 ? 0 : 16,
    "deep-comb": (x, y) => (x + 2 * y) % 3 ? 16 : 13
  };

  function create(Model, config, pattern) {
    if (!patterns[pattern]) throw new Error(`Unknown ISO benchmark pattern: ${pattern}`);
    if (config.trench.rows !== 20 || config.trench.columns !== 20 || config.trench.maxDepth !== 16) {
      throw new Error("ISO benchmark fixtures require the authoritative 20×20, max-depth-16 configuration.");
    }
    const trench = new Model(config.trenches[0], config);
    trench.id = `benchmark-${pattern}`;
    trench.depths.forEach((row, y) => row.forEach((_, x) => { row[x] = patterns[pattern](x, y); }));
    // Keep the catalogue silhouettes, positions and recorded burial depths.
    trench.artefacts.forEach((find) => { find.exposure = "revealed"; });
    return trench;
  }

  function topology(depths) {
    const seen = new Set();
    let regions = 0;
    let boundaries = 0;
    depths.forEach((row, y) => row.forEach((depth, x) => {
      if (x && row[x - 1] !== depth) boundaries += 1;
      if (y && depths[y - 1][x] !== depth) boundaries += 1;
      const key = `${x}:${y}`;
      if (seen.has(key)) return;
      regions += 1;
      const stack = [[x, y]];
      seen.add(key);
      while (stack.length) {
        const [cx, cy] = stack.pop();
        for (const [nx, ny] of [[cx - 1, cy], [cx + 1, cy], [cx, cy - 1], [cx, cy + 1]]) {
          const neighbour = `${nx}:${ny}`;
          if (depths[ny]?.[nx] !== depth || seen.has(neighbour)) continue;
          seen.add(neighbour);
          stack.push([nx, ny]);
        }
      }
    }));
    return { regions, boundaries };
  }

  const fixtures = { patterns, create, topology };
  if (typeof module !== "undefined" && module.exports) module.exports = fixtures;
  else root.IsoAdversarialTerrain = fixtures;
})(typeof window !== "undefined" ? window : globalThis);
