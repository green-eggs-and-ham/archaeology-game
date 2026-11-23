// Original per-pixel visibility calculation, retained as an independent test oracle.
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function cast(terrain, startU, startV) {
  const { atlasWidth, atlasHeight, source, heights } = terrain;
  const speed = 0.3 / source.maxDepth;
  let depth = 0;
  let axis = 0;
  for (let step = 0; step <= atlasWidth + atlasHeight + 2; step += 1) {
    const u = startU - speed * depth;
    const v = startV - speed * depth;
    if (u < 0 || v < 0) return { u: clamp(u, 0, 1), v: clamp(v, 0, 1), depth, wall: true, axis };
    const x = Math.min(atlasWidth - 1, Math.floor(u * atlasWidth));
    const y = Math.min(atlasHeight - 1, Math.floor(v * atlasHeight));
    const index = y * atlasWidth + x;
    const floor = heights[index];
    if (floor <= depth + 1e-6) return { u, v, depth, wall: axis !== 0, axis, index };
    const nextU = depth + (u - x / atlasWidth) / speed;
    const nextV = depth + (v - y / atlasHeight) / speed;
    const next = Math.min(nextU, nextV);
    if (floor <= next + 1e-6) {
      return { u: startU - speed * floor, v: startV - speed * floor, depth: floor, wall: false, axis: 0, index };
    }
    axis = nextU < nextV ? 1 : 2;
    depth = next + 1e-7;
  }
  throw new Error("Preview ray exceeded its bounded terrain traversal.");
}

module.exports = cast;
