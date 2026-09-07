window.CleaningModel = class CleaningModel {
  constructor(config = {}) {
    this.dirtSpotsPerFace = config.dirtSpotsPerFace || 48;
    this.completionRatio = config.completionRatio || 0.9;
    this.handwashPowerPerDunk = config.handwashPowerPerDunk ?? 0.125;
    this.brushRadii = {
      toothbrush: config.brushRadii?.toothbrush || 0.14,
      "fine-brush": config.brushRadii?.["fine-brush"] || 0.09
    };
    this.toolPower = {
      toothbrush: config.toolPower?.toothbrush ?? 1,
      "fine-brush": config.toolPower?.["fine-brush"] ?? 0.5
    };
  }

  hash(value) {
    let result = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      result ^= value.charCodeAt(index);
      result = Math.imul(result, 16777619);
    }
    return result >>> 0;
  }

  randomGenerator(seed) {
    let value = seed >>> 0;
    return () => {
      value += 0x6D2B79F5;
      let result = value;
      result = Math.imul(result ^ (result >>> 15), result | 1);
      result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
      return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
    };
  }

  createDirtSpots(artefact, face) {
    const random = this.randomGenerator(this.hash(`${artefact.id}:${artefact.variantId || artefact.shape}:${face}`));
    const spots = [];
    for (let index = 0; index < this.dirtSpotsPerFace; index += 1) {
      const angle = random() * Math.PI * 2;
      const distance = Math.sqrt(random());
      spots.push({
        x: Math.cos(angle) * distance * 0.39,
        y: Math.sin(angle) * distance * 0.33,
        size: 0.035 + random() * 0.055,
        remaining: 1
      });
    }
    return spots;
  }

  ensureState(artefact) {
    if (!artefact?.cleanable) return null;
    if (!artefact.cleaning) {
      artefact.cleaning = {
        status: "dirty",
        location: "inventory",
        activeFace: "front",
        faces: null
      };
    }
    artefact.cleaning.status ||= "dirty";
    artefact.cleaning.location ||= "inventory";
    artefact.cleaning.activeFace ||= "front";
    if (!artefact.cleaning.faces) {
      artefact.cleaning.faces = {
        front: this.createDirtSpots(artefact, "front"),
        back: this.createDirtSpots(artefact, "back")
      };
    }
    Object.values(artefact.cleaning.faces).forEach((spots) => {
      spots.forEach((spot) => {
        if (!Number.isFinite(spot.remaining)) spot.remaining = spot.removed ? 0 : 1;
        spot.remaining = Math.max(0, Math.min(1, spot.remaining));
        delete spot.removed;
      });
    });
    return artefact.cleaning;
  }

  progress(artefact, face = artefact?.cleaning?.activeFace || "front") {
    const state = this.ensureState(artefact);
    const spots = state?.faces?.[face] || [];
    if (!spots.length) return 0;
    return spots.reduce((total, spot) => total + 1 - spot.remaining, 0) / spots.length;
  }

  faceComplete(artefact, face) {
    return this.progress(artefact, face) >= this.completionRatio;
  }

  allFacesComplete(artefact) {
    return this.faceComplete(artefact, "front") && this.faceComplete(artefact, "back");
  }

  immerse(artefact) {
    if (!this.dampen(artefact)) return false;
    artefact.cleaning.location = "bucket";
    return true;
  }

  dampen(artefact) {
    const state = this.ensureState(artefact);
    if (!state || !["dirty", "wet"].includes(state.status)) return false;
    state.status = "wet";
    state.dampened = true;
    return true;
  }

  placeOnMat(artefact) {
    const state = this.ensureState(artefact);
    if (!state || !["wet", "ready-to-return"].includes(state.status)) return false;
    state.location = "mat";
    return true;
  }

  setFace(artefact, face) {
    const state = this.ensureState(artefact);
    if (!state || !["front", "back"].includes(face)) return false;
    state.activeFace = face;
    return true;
  }

  flip(artefact) {
    const state = this.ensureState(artefact);
    if (!state || state.location !== "mat") return false;
    state.activeFace = state.activeFace === "front" ? "back" : "front";
    return true;
  }

  canUseTool(artefact, tool) {
    if (!artefact?.cleanable || !this.toolPower[tool]) return false;
    if (artefact.cleaningTool === "toothbrush") return tool === "toothbrush" || tool === "fine-brush";
    return tool === "fine-brush";
  }

  pointToSegmentDistance(point, start, end) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    if (!lengthSquared) return Math.hypot(point.x - start.x, point.y - start.y);
    const amount = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared));
    return Math.hypot(point.x - (start.x + dx * amount), point.y - (start.y + dy * amount));
  }

  clearAlongSegment(artefact, face, start, end, tool, contactedSpots = new Set()) {
    const state = this.ensureState(artefact);
    if (!state || state.status !== "wet" || state.location !== "mat") {
      return { changed: false, reason: "Wet the artefact before cleaning it." };
    }
    if (!this.canUseTool(artefact, tool)) {
      return { changed: false, reason: `This ${artefact.robustness.toLowerCase()} find needs the ${artefact.cleaningTool === "toothbrush" ? "toothbrush" : "fine paintbrush"}.` };
    }

    const spots = state.faces[face] || [];
    const radius = this.brushRadii[tool];
    const power = this.toolPower[tool] || 0;
    let changed = false;
    const affectedSpots = [];
    spots.forEach((spot, index) => {
      if (spot.remaining <= 0 || contactedSpots.has(index)) return;
      if (this.pointToSegmentDistance(spot, start, end) > radius + spot.size * 0.35) return;
      contactedSpots.add(index);
      const previous = spot.remaining;
      spot.remaining = Math.max(0, previous - power);
      const amount = previous - spot.remaining;
      if (amount <= 0) return;
      affectedSpots.push({ index, x: spot.x, y: spot.y, amount, remaining: spot.remaining });
      changed = true;
    });

    if (this.progress(artefact, face) >= this.completionRatio) {
      spots.forEach((spot) => { spot.remaining = 0; });
    }
    if (this.allFacesComplete(artefact)) state.status = "ready-to-return";
    return {
      changed,
      affectedSpots,
      faceComplete: this.faceComplete(artefact, face),
      complete: state.status === "ready-to-return"
    };
  }

  handwashDunk(artefact, face = artefact?.cleaning?.activeFace || "front") {
    const state = this.ensureState(artefact);
    if (!state || state.status !== "wet" || !state.dampened || !["front", "back"].includes(face)) {
      return { changed: false, reason: "Wet the artefact before handwashing it." };
    }

    const spots = state.faces[face] || [];
    const affectedSpots = [];
    spots.forEach((spot, index) => {
      if (spot.remaining <= 0) return;
      const previous = spot.remaining;
      spot.remaining = Math.max(0, previous - this.handwashPowerPerDunk);
      const amount = previous - spot.remaining;
      if (amount > 0) affectedSpots.push({ index, x: spot.x, y: spot.y, amount, remaining: spot.remaining });
    });

    if (this.progress(artefact, face) >= this.completionRatio) {
      spots.forEach((spot) => { spot.remaining = 0; });
    }
    if (this.allFacesComplete(artefact)) state.status = "ready-to-return";
    return {
      changed: affectedSpots.length > 0,
      affectedSpots,
      faceComplete: this.faceComplete(artefact, face),
      complete: state.status === "ready-to-return"
    };
  }

  returnToInventory(artefact) {
    const state = this.ensureState(artefact);
    if (!state || state.status !== "ready-to-return") return false;
    const specialist = artefact.postCleaningTreatment === "specialist-treatment" || artefact.requiresSpecialist;
    state.status = specialist ? "awaiting-specialist" : "ready-to-identify";
    state.location = "inventory";
    return true;
  }
};
