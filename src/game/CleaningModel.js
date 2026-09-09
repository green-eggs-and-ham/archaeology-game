(() => {
  const STATUS = Object.freeze({
    DIRTY: "dirty",
    WET: "wet",
    READY_TO_RETURN: "ready-to-return",
    READY_TO_IDENTIFY: "ready-to-identify",
    AWAITING_SPECIALIST: "awaiting-specialist"
  });
  const LOCATION = Object.freeze({
    INVENTORY: "inventory",
    BUCKET: "bucket",
    MAT: "mat"
  });
  const TOOL = Object.freeze({
    HAND: "hand",
    TOOTHBRUSH: "toothbrush",
    FINE_BRUSH: "fine-brush"
  });
  const TREATMENT = Object.freeze({
    IDENTIFICATION: "identification",
    SPECIALIST: "specialist-treatment"
  });
  const FACE = Object.freeze({ FRONT: "front", BACK: "back" });
  const PENDING_STATUSES = new Set([STATUS.DIRTY, STATUS.WET, STATUS.READY_TO_RETURN]);
  const FINAL_STATUSES = new Set([STATUS.READY_TO_IDENTIFY, STATUS.AWAITING_SPECIALIST]);
  const DIRT_VISIBLE_STATUSES = new Set([STATUS.DIRTY, STATUS.WET]);
  const MAT_ELIGIBLE_STATUSES = new Set([STATUS.WET, STATUS.READY_TO_RETURN]);
  const DAMPENABLE_STATUSES = new Set([STATUS.DIRTY, STATUS.WET]);

  const CleaningConstants = Object.freeze({ STATUS, LOCATION, TOOL, TREATMENT, FACE });
  window.CleaningConstants = CleaningConstants;

  window.CleaningModel = class CleaningModel {
    constructor(config = {}) {
      this.dirtSpotsPerFace = config.dirtSpotsPerFace || 48;
      this.completionRatio = config.completionRatio || 0.9;
      this.handwashPowerPerDunk = config.handwashPowerPerDunk ?? 0.125;
      this.handwashReversePowerRatio = config.handwashReversePowerRatio ?? 0.75;
      this.brushRadii = {
        [TOOL.TOOTHBRUSH]: config.brushRadii?.[TOOL.TOOTHBRUSH] || 0.14,
        [TOOL.FINE_BRUSH]: config.brushRadii?.[TOOL.FINE_BRUSH] || 0.09
      };
      this.toolPower = {
        [TOOL.TOOTHBRUSH]: config.toolPower?.[TOOL.TOOTHBRUSH] ?? 1,
        [TOOL.FINE_BRUSH]: config.toolPower?.[TOOL.FINE_BRUSH] ?? 0.5
      };
      this.normalizedDirtFaces = new WeakSet();
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

    normalizeDirtFaces(faces) {
      if (!faces || typeof faces !== "object" || this.normalizedDirtFaces.has(faces)) return faces;
      Object.values(faces).forEach((spots) => {
        if (!Array.isArray(spots)) return;
        spots.forEach((spot) => {
          if (!spot || typeof spot !== "object") return;
          const remaining = Number.isFinite(spot.remaining) ? spot.remaining : (spot.removed ? 0 : 1);
          spot.remaining = Math.max(0, Math.min(1, remaining));
          delete spot.removed;
        });
      });
      this.normalizedDirtFaces.add(faces);
      return faces;
    }

    ensureState(artefact) {
      if (!artefact?.cleanable) return null;
      if (!artefact.cleaning) {
        artefact.cleaning = {
          status: STATUS.DIRTY,
          location: LOCATION.INVENTORY,
          activeFace: FACE.FRONT,
          faces: null
        };
      }
      const state = artefact.cleaning;
      state.status ||= STATUS.DIRTY;
      state.location ||= LOCATION.INVENTORY;
      state.activeFace ||= FACE.FRONT;
      if (!state.faces || typeof state.faces !== "object") {
        state.faces = {
          [FACE.FRONT]: this.createDirtSpots(artefact, FACE.FRONT),
          [FACE.BACK]: this.createDirtSpots(artefact, FACE.BACK)
        };
      }
      this.normalizeDirtFaces(state.faces);
      return state;
    }

    workflowStatus(artefact) {
      if (!artefact?.cleanable) return null;
      return artefact.cleaning?.status || STATUS.DIRTY;
    }

    workflowLocation(artefact) {
      if (!artefact?.cleanable) return null;
      return artefact.cleaning?.location || LOCATION.INVENTORY;
    }

    isPending(artefact) {
      return PENDING_STATUSES.has(this.workflowStatus(artefact));
    }

    isFinal(artefact) {
      return FINAL_STATUSES.has(this.workflowStatus(artefact));
    }

    isReturnable(artefact) {
      return this.workflowStatus(artefact) === STATUS.READY_TO_RETURN;
    }

    isDirtVisible(artefact) {
      return DIRT_VISIBLE_STATUSES.has(this.workflowStatus(artefact));
    }

    canDampen(artefact) {
      return DAMPENABLE_STATUSES.has(this.workflowStatus(artefact));
    }

    canPlaceOnMat(artefact) {
      return MAT_ELIGIBLE_STATUSES.has(this.workflowStatus(artefact));
    }

    canReturnToInventory(artefact) {
      return this.isReturnable(artefact);
    }

    requiresSpecialistTreatment(artefact) {
      return artefact?.postCleaningTreatment === TREATMENT.SPECIALIST;
    }

    remainingCoverage(spot) {
      if (Number.isFinite(spot?.remaining)) return Math.max(0, Math.min(1, spot.remaining));
      return spot?.removed ? 0 : 1;
    }

    progress(artefact, face = artefact?.cleaning?.activeFace || FACE.FRONT) {
      const spots = artefact?.cleaning?.faces?.[face] || [];
      if (!spots.length) return 0;
      return spots.reduce((total, spot) => total + 1 - this.remainingCoverage(spot), 0) / spots.length;
    }

    faceComplete(artefact, face) {
      return this.progress(artefact, face) >= this.completionRatio;
    }

    allFacesComplete(artefact) {
      return this.faceComplete(artefact, FACE.FRONT) && this.faceComplete(artefact, FACE.BACK);
    }

    immerse(artefact) {
      if (!this.dampen(artefact)) return false;
      artefact.cleaning.location = LOCATION.BUCKET;
      return true;
    }

    dampen(artefact) {
      const state = this.ensureState(artefact);
      if (!state || !this.canDampen(artefact)) return false;
      state.status = STATUS.WET;
      state.dampened = true;
      return true;
    }

    placeOnMat(artefact) {
      const state = this.ensureState(artefact);
      if (!state || !this.canPlaceOnMat(artefact)) return false;
      state.location = LOCATION.MAT;
      return true;
    }

    setFace(artefact, face) {
      const state = this.ensureState(artefact);
      if (!state || ![FACE.FRONT, FACE.BACK].includes(face)) return false;
      state.activeFace = face;
      return true;
    }

    flip(artefact) {
      const state = this.ensureState(artefact);
      if (!state || state.location !== LOCATION.MAT) return false;
      state.activeFace = state.activeFace === FACE.FRONT ? FACE.BACK : FACE.FRONT;
      return true;
    }

    canUseTool(artefact, tool) {
      if (!artefact?.cleanable || !this.toolPower[tool]) return false;
      if (Array.isArray(artefact.allowedTools)) return artefact.allowedTools.includes(tool);
      if (artefact.cleaningTool === TOOL.TOOTHBRUSH) {
        return tool === TOOL.TOOTHBRUSH || tool === TOOL.FINE_BRUSH;
      }
      return tool === TOOL.FINE_BRUSH;
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
      if (!state || state.status !== STATUS.WET || state.location !== LOCATION.MAT) {
        return { changed: false, reason: "Wet the artefact before cleaning it." };
      }
      if (!this.canUseTool(artefact, tool)) {
        const robustness = String(artefact.robustness || "delicate").toLowerCase();
        const recommendedTool = artefact.cleaningTool === TOOL.TOOTHBRUSH ? "toothbrush" : "fine paintbrush";
        return { changed: false, reason: `This ${robustness} find needs the ${recommendedTool}.` };
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
      if (this.allFacesComplete(artefact)) state.status = STATUS.READY_TO_RETURN;
      return {
        changed,
        affectedSpots,
        faceComplete: this.faceComplete(artefact, face),
        complete: this.isReturnable(artefact)
      };
    }

    handwashDunk(artefact, face = artefact?.cleaning?.activeFace || FACE.FRONT) {
      const state = this.ensureState(artefact);
      if (!state || state.status !== STATUS.WET || !state.dampened || ![FACE.FRONT, FACE.BACK].includes(face)) {
        return { changed: false, reason: "Wet the artefact before handwashing it." };
      }

      const reverseFace = face === FACE.FRONT ? FACE.BACK : FACE.FRONT;
      const affectedSpots = [];
      const applyPower = (targetFace, power) => {
        const spots = state.faces[targetFace] || [];
        spots.forEach((spot, index) => {
          if (spot.remaining <= 0) return;
          const previous = spot.remaining;
          spot.remaining = Math.max(0, previous - power);
          const amount = previous - spot.remaining;
          if (amount > 0) {
            affectedSpots.push({ index, face: targetFace, x: spot.x, y: spot.y, amount, remaining: spot.remaining });
          }
        });
        if (this.progress(artefact, targetFace) >= this.completionRatio) {
          spots.forEach((spot) => { spot.remaining = 0; });
        }
      };

      applyPower(face, this.handwashPowerPerDunk);
      applyPower(reverseFace, this.handwashPowerPerDunk * this.handwashReversePowerRatio);
      if (this.allFacesComplete(artefact)) state.status = STATUS.READY_TO_RETURN;
      return {
        changed: affectedSpots.length > 0,
        affectedSpots,
        faceComplete: this.faceComplete(artefact, face),
        reverseFaceComplete: this.faceComplete(artefact, reverseFace),
        complete: this.isReturnable(artefact)
      };
    }

    returnToInventory(artefact) {
      const state = this.ensureState(artefact);
      if (!state || !this.canReturnToInventory(artefact)) return false;
      state.status = this.requiresSpecialistTreatment(artefact)
        ? STATUS.AWAITING_SPECIALIST
        : STATUS.READY_TO_IDENTIFY;
      state.location = LOCATION.INVENTORY;
      return true;
    }
  };

  window.CleaningModel.Constants = CleaningConstants;
})();
