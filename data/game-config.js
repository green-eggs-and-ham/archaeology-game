window.GameConfig = {
  canvas: {
    aspectRatio: 16 / 9,
    compactAspectRatio: 4 / 3,
    portraitAspectRatio: 3 / 4,
    compactBreakpoint: 640,
    maxWidth: 1280
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
    artefactCountMultiplier: 2,
    brushRadius: 1,
    brushTravelPerStampCells: 3,
    scoopRadius: 3,
    scoopPillarExtraDepth: 1,
    shovelSwipeMinSpeedCellsPerSecond: 8,
    shovelSwipeMaxSpeedCellsPerSecond: 28,
    shovelSwipeSampleWindowMs: 120,
    clumpDecelerationCellsPerSecondSquared: 20,
    materialClumpWeights: {
      "layer-0": 0.8,
      "layer-1": 1,
      "layer-2": 1.35,
      "layer-3": 1.6
    },
    grassCover: {
      colour: "#54733f",
      pattern: "grass"
    },
    grassCoverageVariants: [0, 0.5, 1],
    effects: {
      brushParticleLimitFull: 256,
      brushParticleLimitLite: 96,
      clumpLimitFull: 16,
      clumpLimitLite: 8
    }
  },
  cleaning: {
    dirtSpotsPerFace: 48,
    completionRatio: 0.9,
    handwashPowerPerDunk: 0.125,
    handwashReversePowerRatio: 0.75,
    brushRadii: { toothbrush: 0.14, "fine-brush": 0.09 },
    toolPower: { toothbrush: 1, "fine-brush": 0.5 },
    effects: {
      waterDroplets: 10,
      waterRipples: 2,
      waterDuration: 500,
      dirtParticlesPerEvent: 8,
      dirtParticleLimit: 80,
      dirtDuration: 320,
      liteDirtParticleLimit: 40,
      liteWaterDropletLimit: 20,
      liteWaterRippleLimit: 4,
      liteSpawnScale: 0.5
    }
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
  artefactCategories: [
    {
      id: "pottery",
      weight: 1,
      variants: [
        { id: "folded-beaker", label: "Folded beaker sherd", shape: "pottery", colour: "#49392f", material: "Roman pottery", robustness: "Fragile", cleaningTool: "fine-brush", postCleaningTreatment: "identification", cleanable: true },
        { id: "mortarium", label: "Mortarium rim", shape: "pottery", colour: "#c5a477", material: "Roman pottery", robustness: "Robust", cleaningTool: "toothbrush", postCleaningTreatment: "identification", cleanable: true },
        { id: "decorated-samian", label: "Decorated Samian sherd", shape: "pottery", colour: "#a84f38", material: "Fine Roman pottery", robustness: "Fragile", cleaningTool: "fine-brush", postCleaningTreatment: "identification", cleanable: true },
        { id: "storage-jar", label: "Storage-jar sherd", shape: "pottery", colour: "#80664d", material: "Coarse Roman pottery", robustness: "Robust", cleaningTool: "toothbrush", postCleaningTreatment: "identification", cleanable: true },
        { id: "verulamium-flagon", label: "Verulamium flagon sherd", shape: "pottery", colour: "#c7b48e", material: "Roman pottery", robustness: "Fragile", cleaningTool: "fine-brush", postCleaningTreatment: "identification", cleanable: true },
        { id: "dark-cooking-pot", label: "Dark cooking-pot rim", shape: "pottery", colour: "#4a4742", material: "Roman pottery", robustness: "Robust", cleaningTool: "toothbrush", postCleaningTreatment: "identification", cleanable: true }
      ]
    },
    {
      id: "bead",
      weight: 1,
      variants: [{ id: "glass-bead", label: "Glass bead", shape: "bead", colour: "#3f9eb1", material: "Glass", cleanable: false }]
    },
    {
      id: "arrowhead",
      weight: 1,
      variants: [{ id: "arrowhead", label: "Arrowhead", shape: "arrowhead", colour: "#a9a6a0", material: "Stone", cleanable: false }]
    },
    {
      id: "coin",
      weight: 1,
      variants: [
        { id: "augustus-as", label: "Augustus copper As", shape: "coin", colour: "#a66b43", material: "Copper alloy", robustness: "Robust", cleaningTool: "toothbrush", postCleaningTreatment: "identification", cleanable: true },
        { id: "hadrian-denarius", label: "Hadrian silver denarius", shape: "coin", colour: "#aaaeb1", material: "Silver", robustness: "Delicate", cleaningTool: "fine-brush", postCleaningTreatment: "identification", cleanable: true },
        { id: "victorinus-radiate", label: "Victorinus bronze radiate", shape: "coin", colour: "#817049", material: "Bronze", robustness: "Delicate", cleaningTool: "fine-brush", postCleaningTreatment: "specialist-treatment", cleanable: true, requiresSpecialist: true },
        { id: "constantine-nummus", label: "Constantine I bronze nummus", shape: "coin", colour: "#756342", material: "Bronze", robustness: "Delicate", cleaningTool: "fine-brush", postCleaningTreatment: "specialist-treatment", cleanable: true, requiresSpecialist: true }
      ]
    }
  ],
  trenches: [
    { id: "a1", label: "A1", seed: 173, layerVariant: 0, grassCoverage: 0 },
    { id: "a2", label: "A2", seed: 947, layerVariant: 1, grassCoverage: 0.5 },
    { id: "a3", label: "A3", seed: 642, layerVariant: 2, grassCoverage: 1 },
    { id: "b1", label: "B1", seed: 331, layerVariant: 1, grassCoverage: 0.5 },
    { id: "b2", label: "B2", seed: 802, layerVariant: 2, grassCoverage: 1 },
    { id: "b3", label: "B3", seed: 284, layerVariant: 0, grassCoverage: 0 },
    { id: "c1", label: "C1", seed: 719, layerVariant: 2, grassCoverage: 1 },
    { id: "c2", label: "C2", seed: 456, layerVariant: 0, grassCoverage: 0 },
    { id: "c3", label: "C3", seed: 991, layerVariant: 1, grassCoverage: 0.5 }
  ]
};
