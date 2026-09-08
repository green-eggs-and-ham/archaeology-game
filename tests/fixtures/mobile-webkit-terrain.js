const layers = {
  grass: { id: "grass", colour: "#537f43", pattern: "grass" },
  topsoil: { id: "topsoil", colour: "#8f6547", pattern: "specks" },
  sandy: { id: "sandy-silt", colour: "#cfad70", pattern: "lines" },
  clay: { id: "clay", colour: "#a65f59", pattern: "dots" },
  gravel: { id: "gravel", colour: "#68706d", pattern: "specks" }
};

function mobileWebKitTerrainFixture() {
  const rows = 20;
  const columns = 20;
  const field = Array.from({ length: rows }, (_, y) => Array.from({ length: columns }, (_, x) => {
    const radial = Math.hypot(x - 9.5, (y - 9.5) * 0.92);
    const ripple = Math.sin(x * 1.73 + y * 0.61) + Math.cos(y * 1.37 - x * 0.42);
    const depth = Math.max(0, Math.min(15, Math.round(13 - radial * 1.2 + ripple * 1.25)));
    const grassPatch = depth === 0 && Math.sin(x * 0.43) + Math.cos(y * 0.37) > 0.15;
    const layer = grassPatch
      ? layers.grass
      : depth < 4
        ? layers.topsoil
        : depth < 8
          ? layers.sandy
          : depth < 12
            ? layers.clay
            : layers.gravel;
    return {
      x,
      y,
      actualDepth: depth,
      depth,
      layer,
      actualLayer: layer,
      renderColour: layer.colour,
      signature: `${depth}:${layer.id}`,
      componentSize: (x + y) % 5 === 0 ? 3 : 8,
      merged: false
    };
  }));
  return {
    field,
    trench: {
      id: "mobile-webkit-heavy",
      rows,
      columns,
      maxDepth: 16,
      layers: [layers.topsoil, layers.sandy, layers.clay, layers.gravel],
      grassLayer: layers.grass,
      bedrock: { id: "bedrock", colour: "#40505b", pattern: "cracks" },
      artefacts: []
    }
  };
}

module.exports = { mobileWebKitTerrainFixture };
