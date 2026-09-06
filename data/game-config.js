window.GameConfig = {
  canvas: {
    aspectRatio: 16 / 9,
    compactAspectRatio: 4 / 3,
    portraitAspectRatio: 3 / 4,
    compactBreakpoint: 560,
    maxWidth: 960
  },
  map: {
    columns: 3,
    rows: 3
  },
  trench: {
    columns: 20,
    rows: 20,
    maxDepth: 16,
    depthResolutionScale: 2,
    maxDepthDarkening: 0.16,
    artefactFootprintSize: 2,
    brushRadius: 1,
    brushTravelPerStampCells: 3,
    scoopRadius: 3,
    scoopPillarExtraDepth: 1
  },
  layers: [
    { name: "Topsoil", pattern: "dots" },
    { name: "Sandy silt", pattern: "lines" },
    { name: "Clay", pattern: "specks" },
    { name: "Gravel", pattern: "dots" }
  ],
  layerPalettes: [
    ["#8b603b", "#c79a5d", "#a65e48", "#6f6b62"],
    ["#765a38", "#d0aa6e", "#a96b4d", "#666d6b"],
    ["#875f43", "#c9a875", "#965c51", "#70706a"]
  ],
  bedrock: { name: "Bedrock", colour: "#5c6873", pattern: "cracks" },
  artefactCatalog: [
    { label: "Pottery sherd", shape: "shard", colour: "#cf7a45" },
    { label: "Glass bead", shape: "bead", colour: "#3f9eb1" },
    { label: "Arrowhead", shape: "arrowhead", colour: "#a9a6a0" },
    { label: "Coin", shape: "coin", colour: "#d5ae45" }
  ],
  trenches: [
    { id: "a1", label: "A1", seed: 173, layerVariant: 0 },
    { id: "a2", label: "A2", seed: 947, layerVariant: 1 },
    { id: "a3", label: "A3", seed: 642, layerVariant: 2 },
    { id: "b1", label: "B1", seed: 331, layerVariant: 1 },
    { id: "b2", label: "B2", seed: 802, layerVariant: 2 },
    { id: "b3", label: "B3", seed: 284, layerVariant: 0 },
    { id: "c1", label: "C1", seed: 719, layerVariant: 2 },
    { id: "c2", label: "C2", seed: 456, layerVariant: 0 },
    { id: "c3", label: "C3", seed: 991, layerVariant: 1 }
  ]
};
