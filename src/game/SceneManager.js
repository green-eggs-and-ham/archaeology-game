window.SceneManager = class SceneManager {
  constructor(config) {
    this.config = config;
    this.renderer = new window.GameRenderer();
    this.currentScene = "site";
    this.pointerAction = null;
    this.tapFeedback = null;
    this.collectionOrderByArtefactId = new Map();
    this.nextCollectionSequence = 0;
    this.message = "Choose a trench to begin your dig.";
    this.messageTone = "neutral";
    this.pointer = null;
    this.showDepthDebug = false;
    this.terrainSmoothingMode = "focus";
    this.pillarRenderMode = "round";
    this.ridgeDirectionMode = "current";
    this.performanceMode = "full";
    this.debugMenuOpen = false;
    this.debugMessage = "Temporary visual and performance controls.";
    this.frameRequestPending = false;
    this.frameRequestHandle = null;
    this.frameRequestKind = null;
    this.frameRequestGeneration = 0;
    this.frameStats = {
      requests: 0,
      coalesced: 0,
      presented: 0,
      profileCacheHits: 0,
      profileRebuilds: 0
    };
    this.mapTiles = [];
    this.layout = {};
    this.cleaningModel = new window.CleaningModel(config.cleaning || {});
    this.cleaningScene = new window.CleaningScene(this);
    this.trenchScene = new window.TrenchScene(this);
    this.effectStats = {
      brushParticleActive: 0,
      brushParticleHighWater: 0,
      clumpActive: 0,
      clumpHighWater: 0,
      cleaningEffectActive: 0,
      cleaningParticleHighWater: 0,
      allocatedCanvasPixels: 0
    };
    this.artefactCatalogue = new window.ArtefactCatalogue(config);
    this.trenches = config.trenches.map((definition) => new window.TrenchModel(definition, config, this.artefactCatalogue));
    this.allCollectedArtefacts().forEach((artefact) => {
      this.cleaningModel.ensureState(artefact);
      this.assignCollectionSequence(artefact);
    });
  }

  handleResize() {
    this.cancelFrameRequest();
    this.tapFeedback = null;
    this.debugMenuOpen = false;
    this.mapTiles = [];
    this.layout = {};
    this.invalidateTerrainCache({ releaseGrid: true, releaseAmbient: true });
    this.trenchScene.handleResize();
    this.cleaningScene.handleResize();
    this.updateCanvasPixelStats();
  }

  draw() {
    // A direct p5 redraw (for example after a discrete button press or resize)
    // satisfies any queued pointer/effect frame. Consume it here so the old
    // callback cannot repaint the whole scene again on the following frame.
    this.cancelFrameRequest();
    this.renderer.drawBackground();
    if (this.currentScene === "site") this.drawSiteMap();
    else if (this.currentScene === "cleaning") this.cleaningScene.draw();
    else this.trenchScene.draw();
    this.drawDebugMenu();
    this.drawCustomPointer();
  }

  requestFrame() {
    this.frameStats ||= {
      requests: 0,
      coalesced: 0,
      presented: 0,
      profileCacheHits: 0,
      profileRebuilds: 0
    };
    this.frameStats.requests += 1;
    if (this.frameRequestPending) {
      this.frameStats.coalesced += 1;
      return;
    }
    this.frameRequestPending = true;
    const generation = ++this.frameRequestGeneration;
    const present = () => {
      if (!this.frameRequestPending || generation !== this.frameRequestGeneration) return;
      this.frameRequestPending = false;
      this.frameRequestHandle = null;
      this.frameRequestKind = null;
      this.frameStats.presented += 1;
      if (typeof redraw === "function") redraw();
    };
    if (typeof requestAnimationFrame === "function") {
      this.frameRequestKind = "animation-frame";
      this.frameRequestHandle = requestAnimationFrame(present);
    } else if (typeof setTimeout === "function") {
      this.frameRequestKind = "timeout";
      this.frameRequestHandle = setTimeout(present, 16);
    } else present();
  }

  cancelFrameRequest() {
    if (!this.frameRequestPending) return false;
    const handle = this.frameRequestHandle;
    if (handle !== null && this.frameRequestKind === "animation-frame" && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(handle);
    } else if (handle !== null && this.frameRequestKind === "timeout" && typeof clearTimeout === "function") {
      clearTimeout(handle);
    }
    this.frameRequestPending = false;
    this.frameRequestHandle = null;
    this.frameRequestKind = null;
    this.frameRequestGeneration += 1;
    return true;
  }

  compactActive(items, keep) {
    let writeIndex = 0;
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      if (!keep(item)) continue;
      items[writeIndex] = item;
      writeIndex += 1;
    }
    items.length = writeIndex;
    return items;
  }

  trenchEffectLimits() {
    const effects = this.config.trench.effects || {};
    return this.performanceMode === "lite"
      ? {
          brushParticles: effects.brushParticleLimitLite || 128,
          clumps: effects.clumpLimitLite || 8
        }
      : {
          brushParticles: effects.brushParticleLimitFull || 384,
          clumps: effects.clumpLimitFull || 16
        };
  }

  recordEffectHighWater() {
    if (!this.effectStats) return;
    this.effectStats.brushParticleActive = this.brushParticles.length;
    this.effectStats.clumpActive = this.depositedClumps.length;
    this.effectStats.cleaningEffectActive =
      this.cleaningWaterDrops.length + this.cleaningRipples.length + this.cleaningDirtParticles.length;
    this.effectStats.brushParticleHighWater = Math.max(this.effectStats.brushParticleHighWater, this.brushParticles.length);
    this.effectStats.clumpHighWater = Math.max(this.effectStats.clumpHighWater, this.depositedClumps.length);
    this.effectStats.cleaningParticleHighWater = Math.max(
      this.effectStats.cleaningParticleHighWater,
      this.cleaningWaterDrops.length + this.cleaningRipples.length + this.cleaningDirtParticles.length
    );
  }

  trimEffectsForMode() {
    const trenchLimits = this.trenchEffectLimits();
    if (this.brushParticles.length > trenchLimits.brushParticles) {
      this.brushParticles.splice(0, this.brushParticles.length - trenchLimits.brushParticles);
    }
    if (this.depositedClumps.length > trenchLimits.clumps) {
      this.depositedClumps.splice(0, this.depositedClumps.length - trenchLimits.clumps);
    }
    const cleaning = this.cleaningEffectsConfig();
    if (this.cleaningDirtParticles.length > cleaning.dirtParticleLimit) {
      this.cleaningDirtParticles.splice(0, this.cleaningDirtParticles.length - cleaning.dirtParticleLimit);
    }
    if (this.cleaningWaterDrops.length > cleaning.waterDropletLimit) {
      this.cleaningWaterDrops.splice(0, this.cleaningWaterDrops.length - cleaning.waterDropletLimit);
    }
    if (this.cleaningRipples.length > cleaning.waterRippleLimit) {
      this.cleaningRipples.splice(0, this.cleaningRipples.length - cleaning.waterRippleLimit);
    }
    this.recordEffectHighWater();
  }

  drawHeading(title, subtitle) {
    const titleSize = Math.max(17, Math.min(28, width * 0.035));
    const subtitleSize = Math.max(10, Math.min(14, width * 0.016));
    fill("#fff9e9");
    noStroke();
    textAlign(LEFT, TOP);
    textStyle(BOLD);
    textSize(titleSize);
    text(title, 18, 14);
    textStyle(NORMAL);
    fill("#c9d9d8");
    textSize(subtitleSize);
    text(subtitle, 18, 17 + titleSize);
  }

  allCollectedArtefacts() {
    return this.trenches.flatMap((trench) => trench.artefacts.filter((artefact) => artefact.exposure === "collected"));
  }

  assignCollectionSequence(artefact) {
    if (!artefact?.id) return Number.MAX_SAFE_INTEGER;
    if (!this.collectionOrderByArtefactId.has(artefact.id)) {
      this.collectionOrderByArtefactId.set(artefact.id, this.nextCollectionSequence);
      this.nextCollectionSequence += 1;
    }
    return this.collectionOrderByArtefactId.get(artefact.id);
  }

  collectionSequence(artefact) {
    if (this.collectionOrderByArtefactId?.has(artefact?.id)) return this.collectionOrderByArtefactId.get(artefact.id);
    let sourceIndex = 0;
    for (const trench of this.trenches || []) {
      for (const item of trench.artefacts || []) {
        if (item === artefact || item.id === artefact?.id) return Number.MAX_SAFE_INTEGER / 2 + sourceIndex;
        sourceIndex += 1;
      }
    }
    return Number.MAX_SAFE_INTEGER;
  }

  cleanableCollectedArtefacts() {
    return this.allCollectedArtefacts().filter((artefact) => artefact.cleanable);
  }

  pendingCleaningCount() {
    return this.cleanableCollectedArtefacts().filter((artefact) => this.cleaningModel.isPending(artefact)).length;
  }

  activeCleaningArtefact() {
    if (this.pointerAction?.type === "cleaning-item") return this.pointerAction.artefact;
    const inventory = window.CleaningConstants.LOCATION.INVENTORY;
    return this.cleanableCollectedArtefacts().find((artefact) => this.cleaningModel.workflowLocation(artefact) !== inventory) || null;
  }

  drawSiteMap() {
    this.drawHeading("Dig Site", "Choose a trench to start digging.");
    const labWidth = Math.max(104, Math.min(160, width * 0.24));
    const labHeight = Math.max(30, Math.min(38, height * 0.09));
    this.layout.labButton = { x: width - labWidth - 14, y: 12, width: labWidth, height: labHeight };
    this.renderer.button(this.layout.labButton, "Finds lab", false, true, false, {
      badgeCount: this.pendingCleaningCount(),
      minimumSize: 9,
      maximumSize: 13
    });
    const tileWidth = Math.min(width * 0.27, height * 0.55);
    const tileHeight = tileWidth * 0.5;
    const originX = width / 2;
    const originY = height * 0.3;
    this.mapTiles = [];

    for (let row = 0; row < this.config.map.rows; row += 1) {
      for (let column = 0; column < this.config.map.columns; column += 1) {
        const trench = this.trenches[row * this.config.map.columns + column];
        const x = originX + (column - row) * tileWidth * 0.48;
        const y = originY + (column + row) * tileHeight * 0.48;
        const tile = { x, y, width: tileWidth, height: tileHeight, trench };
        this.mapTiles.push(tile);
        this.drawMapTile(tile, row, column);
      }
    }

    const hint = "Tap a diamond to inspect a trench from above.";
    const hintMaxWidth = Math.max(120, width - 36);
    let hintSize = Math.max(9, Math.min(14, width * 0.017));
    textSize(hintSize);
    while (hintSize > 9 && textWidth(hint) > hintMaxWidth - 24) {
      hintSize -= 0.5;
      textSize(hintSize);
    }
    const hintWidth = Math.min(hintMaxWidth, Math.max(210, textWidth(hint) + 24));
    this.renderer.panel(18, height - 45, hintWidth, 30, "#e6d3a9");
    fill("#25444a");
    textAlign(LEFT, CENTER);
    textSize(hintSize);
    text(hint, 30, height - 30);
  }

  drawMapTile(tile, row, column) {
    const { x, y, width: tileWidth, height: tileHeight, trench } = tile;
    const progress = trench.artefacts.filter((artefact) => artefact.exposure === "collected").length;
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
    fill("#263f37");
    textAlign(CENTER, CENTER);
    textStyle(BOLD);
    textSize(Math.max(10, tileWidth * 0.16));
    text(trench.label, x, y - 2);
    textStyle(NORMAL);

    if (progress > 0 || trench.isComplete()) {
      fill(trench.isComplete() ? "#4c9d67" : "#f4b942");
      circle(x + tileWidth * 0.3, y - tileHeight * 0.06, Math.max(10, tileWidth * 0.17));
      fill("#17333b");
      textSize(Math.max(8, tileWidth * 0.11));
      text(progress, x + tileWidth * 0.3, y - tileHeight * 0.055);
    }
  }


  debugMenuLayout() {
    const buttonSize = 44;
    const margin = 6;
    const button = {
      x: width - buttonSize - margin,
      y: height - buttonSize - margin,
      width: buttonSize,
      height: buttonSize
    };
    if (!this.debugMenuOpen) return { button, panel: null, options: [] };
    const panelWidth = Math.min(340, width - 24);
    const panelHeight = Math.min(236, height - 68);
    const panel = {
      x: Math.max(12, width - panelWidth - 12),
      y: Math.max(12, button.y - panelHeight - 6),
      width: panelWidth,
      height: panelHeight
    };
    const definitions = [
      { id: "depth", label: this.showDepthDebug ? "Depths: On" : "Depths: Off" },
      { id: "performance", label: this.performanceMode === "full" ? "Performance: Full" : "Performance: Lite" },
      { id: "smoothing", label: this.terrainSmoothingMode === "all" ? "Smooth A: All" : "Smooth B: Focus", disabled: this.performanceMode === "lite" },
      { id: "pillar", label: this.pillarRenderMode === "round" ? "Pillars A: Round" : "Pillars B: Merge", disabled: this.performanceMode === "lite" },
      { id: "ridge", label: this.ridgeDirectionMode === "current" ? "Ridges A: Current" : "Ridges B: High cut", disabled: this.performanceMode === "lite" },
      { id: "water", label: this.bucketOcclusionMode === "obscured" ? "Water B: Obscured" : "Water A: Visible" }
    ];
    const inset = 10;
    const gap = 6;
    const top = panel.y + 34;
    const footerHeight = 28;
    const rowHeight = Math.max(34, (panel.height - 34 - footerHeight - inset - gap * 2) / 3);
    const columnWidth = (panel.width - inset * 2 - gap) / 2;
    const options = definitions.map((entry, index) => ({
      ...entry,
      bounds: {
        x: panel.x + inset + (index % 2) * (columnWidth + gap),
        y: top + Math.floor(index / 2) * (rowHeight + gap),
        width: columnWidth,
        height: rowHeight
      }
    }));
    return { button, panel, options };
  }

  drawDebugMenu() {
    const debug = this.debugMenuLayout();
    this.layout.debugButton = debug.button;
    this.layout.debugPanel = debug.panel;
    this.layout.debugOptions = debug.options;
    if (debug.panel) {
      this.renderer.panel(debug.panel.x, debug.panel.y, debug.panel.width, debug.panel.height, "#d9cdb1");
      fill("#25444a");
      noStroke();
      textAlign(LEFT, TOP);
      textStyle(BOLD);
      textSize(Math.max(11, Math.min(15, debug.panel.width * 0.045)));
      text("DEBUG CONTROLS", debug.panel.x + 11, debug.panel.y + 9);
      textStyle(NORMAL);
      debug.options.forEach((option) => {
        this.renderer.button(
          option.bounds,
          option.label,
          ["depth", "performance", "smoothing", "pillar", "ridge", "water"].some((id) => id === option.id && (
            (id === "depth" && this.showDepthDebug) ||
            (id === "performance" && this.performanceMode === "lite") ||
            (id === "smoothing" && this.terrainSmoothingMode === "focus") ||
            (id === "pillar" && this.pillarRenderMode === "merge") ||
            (id === "ridge" && this.ridgeDirectionMode === "high-cut") ||
            (id === "water" && this.bucketOcclusionMode === "obscured")
          )),
          true,
          option.disabled,
          { minimumSize: 7.5, maximumSize: 11 }
        );
      });
      fill("#40585c");
      textAlign(LEFT, BOTTOM);
      textSize(Math.max(7.5, Math.min(10, debug.panel.width * 0.03)));
      text(this.debugMessage, debug.panel.x + 11, debug.panel.y + debug.panel.height - 7, debug.panel.width - 22, 22);
    }

    const centerX = debug.button.x + debug.button.width / 2;
    const centerY = debug.button.y + debug.button.height / 2;
    stroke(this.debugMenuOpen ? "#f4b942" : "#8fa6a5");
    strokeWeight(this.debugMenuOpen ? 2.5 : 1.5);
    fill("#173843");
    circle(centerX, centerY, 26);
    noStroke();
    fill(this.debugMenuOpen ? "#f4b942" : "#d5dfdc");
    textAlign(CENTER, CENTER);
    textStyle(BOLD);
    textSize(17);
    text(this.debugMenuOpen ? "×" : "•••", centerX, centerY - (this.debugMenuOpen ? 1 : 3));
    textStyle(NORMAL);
  }

  activateDebugOption(id) {
    if (id === "depth") {
      this.showDepthDebug = !this.showDepthDebug;
      this.debugMessage = this.showDepthDebug ? "Depth labels enabled." : "Depth labels hidden.";
    } else if (id === "performance") {
      this.performanceMode = this.performanceMode === "full" ? "lite" : "full";
      this.invalidateTerrainCache({ releaseAmbient: true });
      this.trimEffectsForMode();
      this.debugMessage = this.performanceMode === "lite"
        ? "Lite uses simple cells and edge shading."
        : "Full restores smoothed terrain and curved shadows.";
    } else if (id === "smoothing") {
      this.terrainSmoothingMode = this.terrainSmoothingMode === "all" ? "focus" : "all";
      this.invalidateTerrainCache();
      this.debugMessage = this.terrainSmoothingMode === "all" ? "All junctions are smoothed." : "Only focused features are smoothed.";
    } else if (id === "pillar") {
      this.pillarRenderMode = this.pillarRenderMode === "round" ? "merge" : "round";
      this.invalidateTerrainCache();
      this.debugMessage = this.pillarRenderMode === "round" ? "Small features remain rounded." : "Isolated extrema merge visually.";
    } else if (id === "ridge") {
      this.ridgeDirectionMode = this.ridgeDirectionMode === "current" ? "high-cut" : "current";
      this.invalidateTerrainCache();
      this.debugMessage = this.ridgeDirectionMode === "high-cut" ? "Shallower ridges are cut inward." : "Original ridge ownership restored.";
    } else if (id === "water") {
      this.bucketOcclusionMode = this.bucketOcclusionMode === "obscured" ? "visible" : "obscured";
      this.debugMessage = this.bucketOcclusionMode === "obscured" ? "Bucket foreground obscures immersed finds." : "Immersed finds remain visible.";
    }
  }

  handleDebugPointerStart(x, y) {
    if (this.layout.debugButton && this.pointIn(this.layout.debugButton, x, y)) {
      this.debugMenuOpen = !this.debugMenuOpen;
      this.requestFrame();
      return true;
    }
    if (!this.debugMenuOpen) return false;
    const option = (this.layout.debugOptions || []).find((entry) => this.pointIn(entry.bounds, x, y));
    if (option) {
      if (option.disabled) this.debugMessage = "Switch Performance to Full before changing this terrain option.";
      else this.activateDebugOption(option.id);
      this.requestFrame();
      return true;
    }
    this.debugMenuOpen = false;
    this.requestFrame();
    return true;
  }

  hitMapTile(x, y) {
    return this.mapTiles.find((tile) =>
      Math.abs((x - tile.x) / (tile.width / 2)) + Math.abs((y - tile.y) / (tile.height / 2)) <= 1
    );
  }

  pointIn(bounds, x, y) {
    return x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height;
  }

  pointInEllipse(bounds, x, y) {
    const radiusX = bounds.width / 2;
    const radiusY = bounds.height / 2;
    if (radiusX <= 0 || radiusY <= 0) return false;
    const centerX = bounds.x + radiusX;
    const centerY = bounds.y + radiusY;
    return ((x - centerX) / radiusX) ** 2 + ((y - centerY) / radiusY) ** 2 <= 1;
  }


  interactionNow() {
    if (typeof performance !== "undefined" && typeof performance.now === "function") return performance.now();
    if (typeof millis === "function") return millis();
    return Date.now();
  }

  selectTrench(trench) {
    if (this.currentScene === "cleaning") this.cleaningScene.leave();
    if (this.currentScene === "trench" && this.activeTrench !== trench) this.trenchScene.leave();
    this.activeTrench = trench;
    this.currentScene = "trench";
    this.tool = "scoop";
    this.activeArtefactCoach = this.artefactCoaches?.get(trench.id || trench) || null;
    this.collectionFlights.length = 0;
    this.message = "Drag a safe shovel-load outside the trench, or flick it aside.";
    this.messageTone = "neutral";
    this.requestFrame();
  }


  pointerHover(x, y) {
    this.pointer = { x, y, source: "mouse", pressed: false };
    this.requestFrame();
  }

  pointerLeave() {
    if (this.pointer?.source !== "mouse" || this.pointer?.pressed) return;
    this.pointer = null;
    this.requestFrame();
  }

  customPointerTool() {
    return this.customPointerPresentation().tool;
  }

  setPointerToolUse(tool, pose = null) {
    if (!this.pointer) return;
    this.pointer.interactionTool = tool;
    this.pointer.interactionVariant = "in-use";
    this.pointer.interactionPose = pose;
    if (this.pointer.source === "touch") this.tapFeedback = null;
  }

  customPointerPresentation() {
    if (this.pointerAction?.type === "brush") return { tool: "brush", variant: "in-use", pose: null };
    if (this.pointerAction?.type === "scoop") return { tool: "scoop", variant: "in-use", pose: null };
    if (this.pointerAction?.type === "cleaning-brush") {
      return { tool: this.pointerAction.tool, variant: "in-use", pose: null };
    }
    if (this.pointerAction?.type === "cleaning-item") return { tool: "hand", variant: "in-use", pose: "closed" };
    if (this.pointer?.interactionTool) {
      return {
        tool: this.pointer.interactionTool,
        variant: this.pointer.interactionVariant || "idle",
        pose: this.pointer.interactionPose || null
      };
    }
    if (this.currentScene === "trench") return this.trenchScene.cursorPresentation(this.pointer);
    if (this.currentScene === "cleaning") return this.cleaningScene.cursorPresentation(this.pointer);
    return { tool: "hand", variant: "idle", pose: "open" };
  }

  drawCustomPointer() {
    const now = this.interactionNow();
    const tapFeedbackActive = this.tapFeedback
      && now - this.tapFeedback.startedAt < this.tapFeedback.duration;
    if (this.tapFeedback && !tapFeedbackActive) this.tapFeedback = null;
    const activeTouch = this.pointer?.source === "touch" && this.pointer.pressed;
    if (activeTouch) {
      const presentation = this.customPointerPresentation();
      if (presentation.variant === "in-use") {
        this.renderer.drawToolCursor(
          presentation.tool,
          this.pointer.x,
          this.pointer.y,
          true,
          presentation.pose
        );
      } else if (tapFeedbackActive) {
        this.renderer.drawToolCursor("hand", this.pointer.x, this.pointer.y, false, "pointing");
        this.scheduleEffectFrame();
      }
      return;
    }
    if (tapFeedbackActive) {
      this.renderer.drawToolCursor("hand", this.tapFeedback.x, this.tapFeedback.y, false, "pointing");
      this.scheduleEffectFrame();
    }
    if (!this.pointer || this.pointer.source !== "mouse") return;
    if (this.pointer.x < 0 || this.pointer.x > width || this.pointer.y < 0 || this.pointer.y > height) return;
    const presentation = this.customPointerPresentation();
    this.renderer.drawToolCursor(
      presentation.tool,
      this.pointer.x,
      this.pointer.y,
      presentation.variant === "in-use",
      presentation.pose
    );
  }

  pointerStart(x, y, source = "mouse") {
    this.pointer = {
      x,
      y,
      source,
      pressed: true,
      interactionTool: "hand",
      interactionVariant: "pointing",
      interactionPose: "pointing"
    };
    if (source === "touch") {
      this.tapFeedback = { x, y, startedAt: this.interactionNow(), duration: 180 };
      this.scheduleEffectFrame();
    }
    if (this.handleDebugPointerStart(x, y)) return;
    if (this.currentScene === "site") {
      if (this.layout.labButton && this.pointIn(this.layout.labButton, x, y)) {
        this.cleaningScene.enter();
        return;
      }
      const tile = this.hitMapTile(x, y);
      if (tile) this.trenchScene.enter(tile.trench);
      return;
    }
    if (this.currentScene === "cleaning") {
      this.cleaningScene.pointerStart(x, y);
      return;
    }

    this.trenchScene.pointerStart(x, y, source);
  }

  pointerMove(x, y, source = "mouse") {
    const previousPointer = this.pointer;
    this.pointer = {
      x,
      y,
      source,
      pressed: true,
      interactionTool: previousPointer?.interactionTool,
      interactionVariant: previousPointer?.interactionVariant,
      interactionPose: previousPointer?.interactionPose
    };
    if (this.currentScene === "cleaning") {
      this.cleaningScene.pointerMove(x, y);
      return;
    }
    if (this.currentScene === "trench") this.trenchScene.pointerMove(x, y, source);
    else this.requestFrame();
  }

  pointerEnd(x, y, source = "mouse") {
    this.pointer = { x, y, source, pressed: false };
    if (this.currentScene === "cleaning") {
      this.cleaningScene.pointerEnd(x, y);
      if (source === "touch") this.pointer = null;
      return;
    }
    if (this.currentScene === "trench") this.trenchScene.pointerEnd(x, y, source);
    else {
      if (source === "touch") this.pointer = null;
      this.requestFrame();
    }
  }

  pointerCancel(x, y, source = "mouse") {
    if (this.currentScene === "cleaning") {
      this.cleaningScene.pointerCancel();
      this.pointer = source === "touch" ? null : { x, y, source, pressed: false };
      return;
    }
    if (this.currentScene === "trench") this.trenchScene.pointerCancel(x, y, source);
    else {
      this.pointerAction = null;
      this.pointer = source === "touch" ? null : { x, y, source, pressed: false };
      this.messageTone = "neutral";
      this.requestFrame();
    }
  }

};

// Compatibility shims preserve the historical browser API while the extracted
// modules remain the sole implementation owners.
window.TerrainGraphics?.sharedMethodNames.forEach((name) => {
  Object.defineProperty(window.SceneManager.prototype, name, {
    configurable: true,
    writable: true,
    value: name === "defaultDrawingContext"
      ? function sceneDrawingContext() { return drawingContext; }
      : window.TerrainGraphics.TerrainEngine.prototype[name]
  });
});
window.TerrainPipeline?.installSceneManagerCompatibility(window.SceneManager.prototype);
window.CleaningScene?.installSceneManagerPrototype(window.SceneManager.prototype);
window.TrenchScene?.installSceneManagerPrototype(window.SceneManager.prototype);
