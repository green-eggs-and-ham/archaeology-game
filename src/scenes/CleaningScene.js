(function registerCleaningScene(root) {
  "use strict";

  const { STATUS, LOCATION, TOOL, FACE } = root.CleaningConstants;

  const OWNED_STATE = [
    "cleaningTool",
    "cleaningInventoryPage",
    "cleaningInventorySort",
    "cleaningInventorySortChooserOpen",
    "bucketOcclusionMode",
    "cleaningWaterDrops",
    "cleaningRipples",
    "cleaningDirtParticles"
  ];

  const STATE_DEFAULTS = {
    cleaningTool: () => TOOL.HAND,
    cleaningInventoryPage: () => 0,
    cleaningInventorySort: () => "type",
    cleaningInventorySortChooserOpen: () => false,
    bucketOcclusionMode: () => "obscured",
    cleaningWaterDrops: () => [],
    cleaningRipples: () => [],
    cleaningDirtParticles: () => []
  };

  class CleaningScene {
    constructor(context) {
      if (!context) throw new Error("CleaningScene requires an application context.");
      this.context = context;
      this.state = {};
      OWNED_STATE.forEach((name) => {
        this.state[name] = context[name] === undefined ? STATE_DEFAULTS[name]() : context[name];
        Object.defineProperty(this, name, {
          configurable: false,
          get: () => this.state[name],
          set: (value) => { this.state[name] = value; }
        });
        Object.defineProperty(context, name, {
          configurable: true,
          get: () => this.state[name],
          set: (value) => { this.state[name] = value; }
        });
      });
    }

    enter() {
      return this.context.enterCleaningLab();
    }

    leave() {
      if (this.context.pointerAction?.type === "cleaning-item") this.context.restoreCleaningDrag();
      this.context.pointerAction = null;
      this.cleaningInventorySortChooserOpen = false;
      this.cleaningWaterDrops.length = 0;
      this.cleaningRipples.length = 0;
      this.cleaningDirtParticles.length = 0;
    }

    handleResize() {
      if (this.context.pointerAction?.type === "cleaning-item") this.context.restoreCleaningDrag();
      if (this.context.currentScene === "cleaning") this.context.pointerAction = null;
      this.cleaningInventorySortChooserOpen = false;
      this.cleaningWaterDrops.length = 0;
      this.cleaningRipples.length = 0;
      this.cleaningDirtParticles.length = 0;
    }

    draw() {
      return this.context.drawCleaning();
    }

    pointerStart(x, y) {
      return this.context.cleaningPointerStart(x, y);
    }

    pointerMove(x, y) {
      return this.context.cleaningPointerMove(x, y);
    }

    pointerEnd(x, y) {
      return this.context.cleaningPointerEnd(x, y);
    }

    pointerCancel() {
      if (this.context.pointerAction?.type === "cleaning-item") this.context.restoreCleaningDrag();
      this.context.pointerAction = null;
      this.context.requestFrame();
    }

    cursorPresentation() {
      return {
        tool: this.cleaningTool,
        variant: "idle",
        pose: this.cleaningTool === TOOL.HAND ? "open" : null
      };
    }

  cleaningLayout() {
    const margin = Math.max(10, width * 0.018);
    const gap = Math.max(7, width * 0.012);
    const isPortrait = height > width;
    const headerHeight = isPortrait
      ? Math.max(54, Math.min(62, height * 0.12))
      : Math.max(58, Math.min(68, height * 0.13));
    const backWidth = Math.max(82, Math.min(118, width * 0.22));
    const layout = {
      isPortrait,
      headerHeight,
      labBackButton: { x: margin, y: 10, width: backWidth, height: 34 }
    };

    if (isPortrait) {
      const inventoryHeight = Math.max(112, Math.min(145, width * 0.34));
      const bucketHeight = Math.max(88, Math.min(132, width * 0.25));
      const inventoryY = headerHeight;
      const matY = inventoryY + inventoryHeight + gap;
      const bucketY = height - margin - bucketHeight;
      const lowerWidth = width - margin * 2;
      layout.inventory = { x: margin, y: inventoryY, width: lowerWidth, height: inventoryHeight };
      layout.mat = { x: margin, y: matY, width: lowerWidth, height: Math.max(1, bucketY - matY - gap) };
      layout.bucket = { x: margin, y: bucketY, width: lowerWidth, height: bucketHeight };
    } else {
      const contentY = headerHeight;
      const contentHeight = height - contentY - margin;
      const inventoryWidth = Math.max(145, Math.min(215, width * 0.23));
      layout.inventory = { x: margin, y: contentY, width: inventoryWidth, height: contentHeight };
      const workspaceX = margin + inventoryWidth + gap;
      const workspaceWidth = width - workspaceX - margin;
      const bucketHeight = Math.max(120, Math.min(190, contentHeight * 0.36));
      layout.mat = {
        x: workspaceX,
        y: contentY,
        width: workspaceWidth,
        height: Math.max(1, contentHeight - bucketHeight - gap)
      };
      layout.bucket = {
        x: workspaceX,
        y: layout.mat.y + layout.mat.height + gap,
        width: workspaceWidth,
        height: bucketHeight
      };
    }

    const matInset = isPortrait ? 7 : 9;
    const titleHeight = isPortrait ? 18 : 22;
    const careHeight = isPortrait ? 14 : 18;
    const toolbarGap = isPortrait ? 3 : 5;
    const toolbarHeight = isPortrait ? 28 : 32;
    const toolbarY = layout.mat.y + matInset + titleHeight + careHeight;
    const toolbarWidth = layout.mat.width - matInset * 2;
    const buttonWidth = (toolbarWidth - toolbarGap * 3) / 4;
    const buttonNames = ["handButton", "toothbrushButton", "fineBrushButton", "flipButton"];
    buttonNames.forEach((name, index) => {
      layout[name] = {
        x: layout.mat.x + matInset + index * (buttonWidth + toolbarGap),
        y: toolbarY,
        width: buttonWidth,
        height: toolbarHeight
      };
    });
    const surfaceY = toolbarY + toolbarHeight + (isPortrait ? 3 : 7);
    layout.matHeader = {
      x: layout.mat.x + matInset,
      y: layout.mat.y + matInset,
      width: toolbarWidth,
      height: surfaceY - layout.mat.y - matInset
    };
    layout.matSurface = {
      x: layout.mat.x + matInset,
      y: surfaceY,
      width: toolbarWidth,
      height: Math.max(1, layout.mat.y + layout.mat.height - surfaceY - matInset)
    };
    return layout;
  }

  drawCleaning() {
    this.layout = this.cleaningLayout();
    this.drawCleaningHeader();
    this.drawCleaningInventory();
    this.drawCleaningMat();
    this.drawCleaningBucketBack();
    if (this.bucketOcclusionMode === "obscured") {
      this.drawCleaningBucketArtefact();
      const action = this.pointerAction;
      const draggedImmersed = action?.type === "cleaning-item"
        && action.dunkPhase === "immersed";
      if (draggedImmersed) {
        this.drawDraggedCleaningArtefact();
        this.drawCleaningBucketForeground(true);
      } else {
        this.drawCleaningBucketForeground(true);
        this.drawDraggedCleaningArtefact();
      }
    } else {
      this.drawCleaningBucketForeground(false);
      this.drawCleaningBucketArtefact();
      this.drawDraggedCleaningArtefact();
    }
    this.drawCleaningEffects();
    this.drawCleaningBrushCursor();
    this.drawCleaningInventoryChooser();
  }

  drawCleaningHeader() {
    const portrait = this.layout.isPortrait;
    this.renderer.button(
      this.layout.labBackButton,
      "Site map",
      false,
      false,
      false,
      portrait ? { minimumSize: 11, maximumSize: 15 } : {}
    );
    const titleX = this.layout.labBackButton.x + this.layout.labBackButton.width + 10;
    fill("#fff9e9");
    noStroke();
    textAlign(LEFT, TOP);
    textStyle(BOLD);
    textSize(portrait
      ? Math.max(20, Math.min(26, width * 0.055))
      : Math.max(16, Math.min(25, width * 0.032)));
    text("Finds lab", titleX, 9);
    textStyle(NORMAL);
    fill(this.messageTone === "warning" ? "#ffd889" : "#c9d9d8");
    textSize(portrait
      ? Math.max(10, Math.min(14, width * 0.026))
      : Math.max(8, Math.min(12, width * 0.014)));
    const messageX = portrait ? this.layout.labBackButton.x : titleX;
    const messageY = portrait ? 45 : 37;
    text(
      this.message || "Choose a collected find to clean.",
      messageX,
      messageY,
      width - messageX - (portrait ? this.layout.labBackButton.x : 10),
      this.layout.headerHeight - messageY
    );
  }

  inventoryStatusLabel(artefact) {
    if (!artefact.cleanable) return "Not available";
    const status = this.cleaningModel.ensureState(artefact).status;
    if (status === STATUS.READY_TO_IDENTIFY) return "Ready to identify";
    if (status === STATUS.AWAITING_SPECIALIST) return "Needs specialist";
    if (status === STATUS.READY_TO_RETURN) return "Clean";
    if (status === STATUS.WET) return "In progress";
    return "Dirty";
  }

  cleaningInventorySortOptions() {
    return [
      { id: "type", label: "Type" },
      { id: "status", label: "Cleaning status" },
      { id: "name", label: "Name A-Z" },
      { id: "collection", label: "Collection order" }
    ];
  }

  cleaningInventorySortLabel(sort = this.cleaningInventorySort) {
    return this.cleaningInventorySortOptions().find((option) => option.id === sort)?.label || "Type";
  }

  cleaningInventoryStatusRank(artefact) {
    if (!artefact.cleanable) return 5;
    const status = this.cleaningModel.ensureState(artefact)?.status;
    if (status === STATUS.DIRTY) return 0;
    if (status === STATUS.WET) return 1;
    if (status === STATUS.READY_TO_RETURN) return 2;
    if (status === STATUS.AWAITING_SPECIALIST) return 3;
    if (status === STATUS.READY_TO_IDENTIFY) return 4;
    return 5;
  }

  cleaningInventoryGrid(isPortrait = this.layout.isPortrait) {
    return isPortrait ? { columns: 3, rows: 1 } : { columns: 1, rows: 6 };
  }

  portraitInventoryLabel(label) {
    const words = String(label || "").trim().split(/\s+/).filter(Boolean);
    if (words.length < 3) return words.join(" ");
    let bestIndex = 1;
    let bestDifference = Infinity;
    for (let index = 1; index < words.length; index += 1) {
      const firstLength = words.slice(0, index).join(" ").length;
      const secondLength = words.slice(index).join(" ").length;
      const difference = Math.abs(firstLength - secondLength);
      if (difference < bestDifference) {
        bestDifference = difference;
        bestIndex = index;
      }
    }
    return `${words.slice(0, bestIndex).join(" ")}\n${words.slice(bestIndex).join(" ")}`;
  }

  cleaningInventoryArtefacts() {
    const active = this.activeCleaningArtefact();
    const collected = this.allCollectedArtefacts().filter(
      (artefact) => artefact !== active || this.cleaningModel.workflowLocation(artefact) === LOCATION.INVENTORY
    );
    const sort = this.cleaningInventorySort || "type";
    const byName = (first, second) => {
      const nameComparison = String(first.label || "").localeCompare(String(second.label || ""), undefined, { sensitivity: "base" });
      if (nameComparison !== 0) return nameComparison;
      const byCollection = this.collectionSequence(first) - this.collectionSequence(second);
      if (byCollection !== 0) return byCollection;
      return String(first.id || "").localeCompare(String(second.id || ""));
    };
    return [...collected].sort((first, second) => {
      if (sort === "collection") {
        const byCollection = this.collectionSequence(first) - this.collectionSequence(second);
        return byCollection || byName(first, second);
      }
      if (sort === "status") {
        const byStatus = this.cleaningInventoryStatusRank(first) - this.cleaningInventoryStatusRank(second);
        return byStatus || byName(first, second);
      }
      if (sort === "name") return byName(first, second);
      const byAvailability = Number(!first.cleanable) - Number(!second.cleanable);
      if (byAvailability) return byAvailability;
      const byCategory = String(first.category || first.shape || "other").localeCompare(
        String(second.category || second.shape || "other"),
        undefined,
        { sensitivity: "base" }
      );
      return byCategory || byName(first, second);
    });
  }

  drawCleaningInventory() {
    const bounds = this.layout.inventory;
    const portrait = this.layout.isPortrait;
    this.renderer.panel(bounds.x, bounds.y, bounds.width, bounds.height, "#ead9b9");
    fill("#25444a");
    noStroke();
    textAlign(LEFT, TOP);
    textStyle(BOLD);
    textSize(portrait
      ? Math.max(12, Math.min(16, bounds.height * 0.105))
      : Math.max(10, Math.min(14, bounds.height * 0.12)));
    text("COLLECTED FINDS", bounds.x + 9, bounds.y + 7);
    textStyle(NORMAL);

    const sortButtonHeight = portrait ? 30 : 24;
    this.layout.inventorySortButton = {
      x: bounds.x + 8,
      y: bounds.y + (portrait ? 25 : 26),
      width: bounds.width - 16,
      height: sortButtonHeight
    };
    this.renderer.button(
      this.layout.inventorySortButton,
      `Sort: ${this.cleaningInventorySortLabel()}`,
      this.cleaningInventorySort !== "type",
      true,
      false,
      portrait ? { minimumSize: 10, maximumSize: 12 } : { minimumSize: 8, maximumSize: 11 }
    );

    const active = this.activeCleaningArtefact();
    const artefacts = this.cleaningInventoryArtefacts();
    const { columns, rows } = this.cleaningInventoryGrid(portrait);
    const pageSize = columns * rows;
    const pages = Math.max(1, Math.ceil(artefacts.length / pageSize));
    this.cleaningInventoryPage = Math.max(0, Math.min(pages - 1, this.cleaningInventoryPage));
    const footerHeight = pages > 1 ? (portrait ? 22 : 25) : 5;
    const contentTop = this.layout.inventorySortButton.y + this.layout.inventorySortButton.height + 4;
    const contentHeight = Math.max(1, bounds.y + bounds.height - contentTop - footerHeight);
    const cellWidth = (bounds.width - 12) / columns;
    const cellHeight = contentHeight / rows;
    const visible = artefacts.slice(this.cleaningInventoryPage * pageSize, (this.cleaningInventoryPage + 1) * pageSize);
    this.layout.inventorySlots = [];

    if (!artefacts.length) {
      fill("#5c665e");
      textAlign(CENTER, CENTER);
      textSize(portrait ? Math.max(10, Math.min(13, bounds.width * 0.04)) : Math.max(9, Math.min(12, bounds.width * 0.055)));
      text(
        active
            ? "The current find is on the cleaning bench."
            : "Collect a find at the dig site to place it here.",
        bounds.x + 12,
        contentTop,
        bounds.width - 24,
        contentHeight
      );
    }

    visible.forEach((artefact, index) => {
      if (artefact.cleanable) this.cleaningModel.ensureState(artefact);
      const column = index % columns;
      const row = Math.floor(index / columns);
      const slot = {
        x: bounds.x + 6 + column * cellWidth + 2,
        y: contentTop + row * cellHeight + 2,
        width: cellWidth - 4,
        height: cellHeight - 4
      };
      this.layout.inventorySlots.push({ artefact, bounds: slot });
      noStroke();
      fill(artefact.cleanable ? "#d9c7a5" : "#b9ad96");
      rect(slot.x, slot.y, slot.width, slot.height, 6);
      const itemSize = portrait
        ? Math.max(13, Math.min(slot.width * 0.28, slot.height * 0.3))
        : Math.max(24, Math.min(slot.width * 0.27, slot.height * 0.68));
      const portraitLabelLines = portrait ? this.portraitInventoryLabel(artefact.label).split("\n") : [];
      const portraitGroupHeight = itemSize + portraitLabelLines.length * 9.5 + 12;
      const portraitGroupTop = Math.max(2, (slot.height - portraitGroupHeight) / 2);
      const itemX = portrait ? slot.x + slot.width / 2 : slot.x + 8 + itemSize / 2;
      const itemY = portrait
        ? slot.y + portraitGroupTop + itemSize / 2
        : slot.y + slot.height / 2;
      const status = artefact.cleaning?.status;
      this.renderer.artefact(artefact, itemX, itemY, itemSize, {
        face: FACE.FRONT,
        showDirt: artefact.cleanable && this.cleaningModel.isDirtVisible(artefact)
      });
      fill("#25444a");
      noStroke();
      textAlign(portrait ? CENTER : LEFT, TOP);
      textStyle(BOLD);
      textSize(portrait ? Math.max(9, Math.min(11, slot.width / 11)) : Math.max(10, Math.min(12, slot.width / 16)));
      if (portrait) {
        portraitLabelLines.forEach((labelLine, lineIndex) => {
          text(labelLine, slot.x + slot.width / 2, slot.y + portraitGroupTop + itemSize + 1 + lineIndex * 9.5);
        });
      } else {
        const textX = slot.x + itemSize + 15;
        const textWidth = Math.max(1, slot.x + slot.width - textX - 6);
        text(
          artefact.label,
          textX,
          slot.y + 7,
          textWidth,
          Math.max(18, slot.height - 30)
        );
        this.layout.inventorySlots[this.layout.inventorySlots.length - 1].thumbnailBounds = {
          x: itemX - itemSize / 2,
          y: itemY - itemSize / 2,
          width: itemSize,
          height: itemSize
        };
        this.layout.inventorySlots[this.layout.inventorySlots.length - 1].nameBounds = {
          x: textX,
          y: slot.y + 7,
          width: textWidth,
          height: Math.max(18, slot.height - 30)
        };
      }
      textStyle(NORMAL);
      fill(status === STATUS.READY_TO_IDENTIFY ? "#39734e" : status === STATUS.AWAITING_SPECIALIST ? "#8d5c20" : "#5b625d");
      textSize(portrait ? Math.max(8, Math.min(9.5, slot.width / 13)) : Math.max(9, Math.min(10, slot.width / 18)));
      if (portrait) {
        text(
          this.inventoryStatusLabel(artefact),
          slot.x + slot.width / 2,
          slot.y + portraitGroupTop + itemSize + portraitLabelLines.length * 9.5 + 2
        );
      } else {
        const textX = slot.x + itemSize + 15;
        const textWidth = Math.max(1, slot.x + slot.width - textX - 6);
        text(this.inventoryStatusLabel(artefact), textX, slot.y + slot.height - 18, textWidth, 14);
        this.layout.inventorySlots[this.layout.inventorySlots.length - 1].statusBounds = {
          x: textX,
          y: slot.y + slot.height - 18,
          width: textWidth,
          height: 14
        };
      }
    });

    this.layout.inventoryPreviousButton = null;
    this.layout.inventoryNextButton = null;
    if (pages > 1) {
      const buttonHeight = portrait ? 19 : 18;
      const buttonWidth = Math.min(portrait ? 76 : 62, (bounds.width - 34) / 2);
      this.layout.inventoryPreviousButton = { x: bounds.x + 8, y: bounds.y + bounds.height - buttonHeight - 4, width: buttonWidth, height: buttonHeight };
      this.layout.inventoryNextButton = { x: bounds.x + bounds.width - buttonWidth - 8, y: bounds.y + bounds.height - buttonHeight - 4, width: buttonWidth, height: buttonHeight };
      const pagingText = portrait ? { minimumSize: 8, maximumSize: 10 } : {};
      this.renderer.button(this.layout.inventoryPreviousButton, "Previous", false, true, false, pagingText);
      this.renderer.button(this.layout.inventoryNextButton, "Next", false, true, false, pagingText);
      fill("#25444a");
      noStroke();
      textAlign(CENTER, CENTER);
      textSize(portrait ? 9 : 7);
      text(`${this.cleaningInventoryPage + 1}/${pages}`, bounds.x + bounds.width / 2, bounds.y + bounds.height - buttonHeight / 2 - 4);
    }
  }

  drawCleaningInventoryChooser() {
    this.layout.inventorySortOptions = [];
    if (!this.cleaningInventorySortChooserOpen) return;

    const options = this.cleaningInventorySortOptions();
    const portrait = this.layout.isPortrait;
    const margin = Math.max(10, width * 0.018);
    const menuWidth = Math.min(420, width - margin * 2);
    const columns = 2;
    const rows = Math.ceil(options.length / columns);
    const gap = 6;
    const optionHeight = portrait ? 44 : 38;
    const titleHeight = portrait ? 34 : 30;
    const menuHeight = titleHeight + rows * optionHeight + (rows + 1) * gap;
    const preferredY = this.layout.mat.y + (this.layout.mat.height - menuHeight) / 2;
    const menuY = Math.max(this.layout.headerHeight + 4, Math.min(height - menuHeight - margin, preferredY));
    const menuX = (width - menuWidth) / 2;

    noStroke();
    fill(6, 20, 27, 150);
    rect(0, this.layout.headerHeight, width, height - this.layout.headerHeight);
    this.renderer.panel(menuX, menuY, menuWidth, menuHeight, "#ead9b9");
    fill("#25444a");
    textAlign(CENTER, CENTER);
    textStyle(BOLD);
    textSize(portrait ? 13 : 11);
    text("CHOOSE SORT ORDER", menuX + menuWidth / 2, menuY + titleHeight / 2 + 1);
    textStyle(NORMAL);

    const optionWidth = (menuWidth - gap * 3) / columns;
    options.forEach((option, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const bounds = {
        x: menuX + gap + column * (optionWidth + gap),
        y: menuY + titleHeight + gap + row * (optionHeight + gap),
        width: optionWidth,
        height: optionHeight
      };
      this.layout.inventorySortOptions.push({ sort: option.id, bounds });
      this.renderer.button(
        bounds,
        option.label,
        this.cleaningInventorySort === option.id,
        true,
        false,
        portrait ? { minimumSize: 10, maximumSize: 12 } : { minimumSize: 9, maximumSize: 11 }
      );
    });
  }

  cleaningItemBaseSize() {
    const mat = this.layout.matSurface || this.layout.mat;
    const bucket = this.layout.bucket;
    if (!mat || !bucket) return 52;
    const matCapacity = Math.min(mat.width * 0.32, mat.height * 0.48);
    const bucketHeader = this.layout.isPortrait ? 38 : 42;
    const bucketInteriorDepth = Math.max(36, (bucket.height - bucketHeader) * 0.82);
    const bucketCapacity = Math.min(bucket.width * 0.3, bucketInteriorDepth / (1.24 * 1.08));
    return Math.max(38, Math.min(125, matCapacity, bucketCapacity));
  }

  cleaningItemSize(_location = LOCATION.MAT) {
    return this.cleaningItemBaseSize();
  }

  drawCleaningArtefactAt(artefact, centerX, centerY, size, location) {
    const state = this.cleaningModel.ensureState(artefact);
    this.renderer.artefact(artefact, centerX, centerY, size, {
      face: state.activeFace,
      showDirt: this.cleaningModel.isDirtVisible(artefact),
      dampened: Boolean(state.dampened && location !== LOCATION.INVENTORY)
    });
    this.layout.cleaningItemBounds = { x: centerX - size * 0.58, y: centerY - size * 0.62, width: size * 1.16, height: size * 1.24, size, location, artefact };
  }

  shouldShowContextFlip(artefact = this.activeCleaningArtefact()) {
    if (!artefact || this.cleaningModel.workflowLocation(artefact) !== LOCATION.MAT) return false;
    const currentFace = artefact.cleaning.activeFace;
    const otherFace = currentFace === FACE.FRONT ? FACE.BACK : FACE.FRONT;
    return this.cleaningModel.faceComplete(artefact, currentFace)
      && !this.cleaningModel.faceComplete(artefact, otherFace);
  }

  contextualFlipBounds(item, surface, targetSize) {
    const preferredRight = item.x + item.width + 8;
    const fallbackLeft = item.x - targetSize - 8;
    const targetX = preferredRight + targetSize <= surface.x + surface.width - 4
      ? preferredRight
      : Math.max(surface.x + 4, fallbackLeft);
    return {
      x: Math.min(surface.x + surface.width - targetSize - 4, targetX),
      y: Math.max(surface.y + 4, Math.min(surface.y + surface.height - targetSize - 4, item.y - 8)),
      width: targetSize,
      height: targetSize
    };
  }

  drawCleaningMat() {
    const bounds = this.layout.mat;
    const surface = this.layout.matSurface;
    const portrait = this.layout.isPortrait;
    this.renderer.panel(bounds.x, bounds.y, bounds.width, bounds.height, "#d6c9aa");
    fill("#25444a");
    noStroke();
    textAlign(LEFT, TOP);
    textStyle(BOLD);
    textSize(portrait ? 12 : Math.max(12, Math.min(16, bounds.height * 0.06)));
    text("CLEANING MAT", this.layout.matHeader.x, this.layout.matHeader.y);
    textStyle(NORMAL);
    const artefact = this.activeCleaningArtefact();
    fill("#5b625d");
    textSize(portrait ? 8.5 : 10);
    const care = artefact
      ? portrait
        ? `${artefact.material} • ${artefact.robustness} • ${artefact.cleaningTool === TOOL.TOOTHBRUSH ? "Toothbrush fastest" : "Hand/fine brush"}`
        : `${artefact.material} • ${artefact.robustness} • ${artefact.cleaningTool === TOOL.TOOTHBRUSH ? "Toothbrush fastest; handwashing and fine brush safe" : "Handwash or use fine paintbrush"}`
      : "Choose a find, then use Hand to move it through clean water.";
    text(care, this.layout.matHeader.x, this.layout.matHeader.y + (portrait ? 16 : 20), this.layout.matHeader.width, portrait ? 13 : 16);

    const buttonText = portrait ? { minimumSize: 8, maximumSize: 10 } : { minimumSize: 9, maximumSize: 12 };
    this.renderer.button(this.layout.handButton, "Hand", this.cleaningTool === TOOL.HAND, true, false, { ...buttonText, icon: "hand" });
    this.renderer.button(this.layout.toothbrushButton, "Toothbrush", this.cleaningTool === TOOL.TOOTHBRUSH, true, false, { ...buttonText, icon: "toothbrush" });
    this.renderer.button(this.layout.fineBrushButton, portrait ? "Fine brush" : "Fine paintbrush", this.cleaningTool === TOOL.FINE_BRUSH, true, false, { ...buttonText, icon: "fine-brush" });
    const face = artefact?.cleaning?.activeFace === FACE.BACK ? "Back" : "Front";
    this.renderer.button(this.layout.flipButton, `Flip: ${face}`, false, true, false, {
      ...buttonText,
      icon: "flip",
      iconActive: true
    });

    fill("#857a65");
    rect(surface.x, surface.y, surface.width, surface.height, 12);
    stroke(255, 255, 255, 28);
    strokeWeight(1);
    for (let index = 1; index < 5; index += 1) {
      line(surface.x + 2, surface.y + surface.height * index / 5, surface.x + surface.width - 2, surface.y + surface.height * index / 5);
    }
    noStroke();
    this.layout.cleaningItemBounds = null;
    this.layout.contextFlipButton = null;
    if (this.cleaningModel.workflowLocation(artefact) === LOCATION.MAT && this.pointerAction?.type !== "cleaning-item") {
      const size = this.cleaningItemSize(LOCATION.MAT);
      const centerX = surface.x + surface.width / 2;
      const centerY = surface.y + surface.height * 0.48;
      this.drawCleaningArtefactAt(artefact, centerX, centerY, size, LOCATION.MAT);
      fill("#efe4c8");
      noStroke();
      textAlign(CENTER, BOTTOM);
      textSize(portrait ? Math.max(10, Math.min(14, bounds.width * 0.03)) : Math.max(8, Math.min(12, bounds.width * 0.027)));
      const front = Math.round(this.cleaningModel.progress(artefact, FACE.FRONT) * 100);
      const back = Math.round(this.cleaningModel.progress(artefact, FACE.BACK) * 100);
      text(`Front ${front}%  •  Back ${back}%`, surface.x + surface.width / 2, surface.y + surface.height - 7);

      if (this.shouldShowContextFlip(artefact)) {
        const targetSize = Math.min(
          Math.max(44, Math.min(52, Math.min(surface.width, surface.height) * 0.24)),
          surface.width - 12,
          surface.height - 12
        );
        const item = this.layout.cleaningItemBounds;
        this.layout.contextFlipButton = this.contextualFlipBounds(item, surface, targetSize);
        this.renderer.button(this.layout.contextFlipButton, "", false, true, false, {
          icon: "flip",
          iconActive: true,
          iconOnly: true
        });
      }
    } else if (!artefact) {
      fill("#d8cfb6");
      textAlign(CENTER, CENTER);
      textStyle(BOLD);
      textSize(portrait ? Math.max(13, Math.min(17, bounds.width * 0.036)) : Math.max(12, Math.min(16, bounds.width * 0.03)));
      text("Wet a dirty find, then drag it here.", surface.x + 12, surface.y, surface.width - 24, surface.height);
      textStyle(NORMAL);
    }
  }

  drawCleaningBucketBack() {
    const bounds = this.layout.bucket;
    const portrait = this.layout.isPortrait;
    this.renderer.panel(bounds.x, bounds.y, bounds.width, bounds.height, "#d9cdb1");
    fill("#25444a");
    noStroke();
    textAlign(LEFT, TOP);
    textStyle(BOLD);
    textSize(portrait ? Math.max(11, Math.min(14, bounds.height * 0.15)) : Math.max(10, Math.min(14, bounds.height * 0.1)));
    text("CLEAN WATER", bounds.x + 9, bounds.y + 8);
    textStyle(NORMAL);
    const bucketWidth = Math.min(bounds.width * 0.94, 600);
    const headerBottom = bounds.y + (portrait ? 28 : 31);
    const availableHeight = Math.max(28, bounds.y + bounds.height - headerBottom - 5);
    const bucketHeight = Math.max(28, availableHeight * 0.98);
    const centerX = bounds.x + bounds.width / 2;
    const waterY = headerBottom + bucketHeight * 0.09;
    const waterHeight = Math.max(18, bucketHeight * 0.36);
    const bodyBottom = Math.min(bounds.y + bounds.height - 5, waterY + bucketHeight * 0.82);
    this.layout.bucketGeometry = { bounds, centerX, waterY, bodyBottom, bucketWidth, bucketHeight, waterHeight };
    noStroke();
    fill("#56676b");
    quad(
      centerX - bucketWidth * 0.46, waterY,
      centerX + bucketWidth * 0.46, waterY,
      centerX + bucketWidth * 0.37, bodyBottom,
      centerX - bucketWidth * 0.37, bodyBottom
    );
    noFill();
    stroke("#344b50");
    strokeWeight(Math.max(2.5, bucketWidth * 0.027));
    arc(centerX, waterY, bucketWidth, waterHeight, Math.PI, Math.PI * 2);
    fill("#70b7c4");
    ellipse(centerX, waterY, bucketWidth, waterHeight);
    this.layout.bucketWater = { x: centerX - bucketWidth / 2, y: waterY - waterHeight / 2, width: bucketWidth, height: waterHeight };
    this.layout.bucketDunkAperture = { ...this.layout.bucketWater };
    const dropWidth = Math.min(bounds.width - 12, bucketWidth * 1.15);
    const dropHeight = Math.min(bounds.height - 12, Math.max(44, bucketHeight * 0.58));
    this.layout.bucketDropTarget = {
      x: centerX - dropWidth / 2,
      y: waterY - dropHeight / 2,
      width: dropWidth,
      height: dropHeight
    };
  }

  drawCleaningBucketArtefact() {
    const geometry = this.layout.bucketGeometry;
    if (!geometry) return;
    const artefact = this.activeCleaningArtefact();
    if (this.cleaningModel.workflowLocation(artefact) === LOCATION.BUCKET && this.pointerAction?.type !== "cleaning-item") {
      const size = this.cleaningItemSize(LOCATION.BUCKET);
      this.drawCleaningArtefactAt(artefact, geometry.centerX, geometry.waterY + size * 0.08, size, LOCATION.BUCKET);
    }
  }

  traceBucketFrontPath(context = drawingContext) {
    const geometry = this.layout.bucketGeometry;
    if (!geometry) return;
    const { centerX, waterY, bodyBottom, bucketWidth, waterHeight } = geometry;
    context.beginPath();
    context.moveTo(centerX - bucketWidth * 0.46, waterY);
    context.ellipse(
      centerX,
      waterY,
      bucketWidth * 0.46,
      waterHeight * 0.5,
      0,
      Math.PI,
      0,
      true
    );
    context.lineTo(centerX + bucketWidth * 0.37, bodyBottom);
    context.quadraticCurveTo(centerX, bodyBottom + 3, centerX - bucketWidth * 0.37, bodyBottom);
    context.closePath();
  }

  immersedCleaningItem() {
    const aperture = this.layout.bucketDunkAperture;
    if (!aperture) return null;
    const parked = this.layout.cleaningItemBounds;
    if (parked?.location === LOCATION.BUCKET) {
      return {
        artefact: parked.artefact,
        x: parked.x + parked.width / 2,
        y: parked.y + parked.height / 2,
        size: parked.size
      };
    }
    const action = this.pointerAction;
    if (action?.type !== "cleaning-item" || action.dunkPhase !== "immersed") return null;
    return { artefact: action.artefact, x: action.x, y: action.y, size: this.cleaningDraggedItemBounds(action).size };
  }

  drawCleaningBucketForeground(obscured = false) {
    const geometry = this.layout.bucketGeometry;
    if (!geometry) return;
    const context = drawingContext;
    const immersed = obscured ? this.immersedCleaningItem() : null;
    if (obscured) {
      context.save();
      this.traceBucketFrontPath(context);
      context.fillStyle = "#6d7b7d";
      context.fill();
      context.restore();
    } else {
      this.traceBucketFrontPath(context);
      context.fillStyle = "#6d7b7d";
      context.fill();
    }
    noFill();
    stroke("#f2e2bd");
    strokeWeight(Math.max(2, geometry.bucketWidth * 0.022));
    arc(geometry.centerX, geometry.waterY, geometry.bucketWidth, this.layout.bucketWater.height, 0, Math.PI);
    if (immersed) {
      context.save();
      this.traceBucketFrontPath(context);
      context.clip();
      this.renderer.artefactOutline(immersed.artefact, immersed.x, immersed.y, immersed.size);
      context.restore();
    }
  }

  drawDraggedCleaningArtefact() {
    if (this.pointerAction?.type !== "cleaning-item") return;
    const { artefact, x, y } = this.pointerAction;
    const size = this.pointerAction.displaySize || this.cleaningItemBaseSize() * 1.08;
    this.renderer.artefact(artefact, x, y, size, {
      face: artefact.cleaning.activeFace,
      showDirt: this.cleaningModel.isDirtVisible(artefact),
      dampened: Boolean(artefact.cleaning.dampened)
    });
  }

  drawCleaningBrushCursor() {
    const item = this.layout.cleaningItemBounds;
    const artefact = item?.artefact;
    if (this.cleaningTool === TOOL.HAND || !this.pointer || !artefact || item.location !== LOCATION.MAT || this.pointerAction?.type === "cleaning-item") return;
    if (!this.pointIn(item, this.pointer.x, this.pointer.y)) return;
    const radius = item.size * this.cleaningModel.brushRadii[this.cleaningTool];
    noFill();
    stroke(this.cleaningModel.canUseTool(artefact, this.cleaningTool) ? "#e8f4e9" : "#ffd889");
    strokeWeight(1.4);
    circle(this.pointer.x, this.pointer.y, radius * 2);
  }

  cleaningEffectsConfig() {
    const settings = {
      waterDroplets: 10,
      waterRipples: 2,
      waterDuration: 500,
      dirtParticlesPerEvent: 8,
      dirtParticleLimit: 80,
      dirtDuration: 320,
      ...(this.config.cleaning?.effects || {})
    };
    if (this.performanceMode === "lite") {
      const scale = settings.liteSpawnScale ?? 0.5;
      settings.waterDroplets = Math.max(1, Math.round(settings.waterDroplets * scale));
      settings.waterRipples = Math.max(1, Math.round(settings.waterRipples * scale));
      settings.dirtParticlesPerEvent = Math.max(1, Math.round(settings.dirtParticlesPerEvent * scale));
      settings.dirtParticleLimit = settings.liteDirtParticleLimit || 40;
      settings.waterDropletLimit = settings.liteWaterDropletLimit || 20;
      settings.waterRippleLimit = settings.liteWaterRippleLimit || 4;
    } else {
      settings.waterDropletLimit = Math.max(settings.waterDroplets, settings.waterDroplets * 4);
      settings.waterRippleLimit = Math.max(settings.waterRipples, settings.waterRipples * 4);
    }
    return settings;
  }

  spawnCleaningWaterEffects() {
    const water = this.layout.bucketWater;
    if (!water || typeof millis !== "function") return;
    const settings = this.cleaningEffectsConfig();
    const startedAt = millis();
    const centerX = water.x + water.width / 2;
    const centerY = water.y + water.height / 2;
    for (let index = 0; index < settings.waterDroplets; index += 1) {
      this.cleaningWaterDrops.push({
        x: centerX + (Math.random() - 0.5) * water.width * 0.58,
        y: centerY + (Math.random() - 0.5) * water.height * 0.2,
        vx: (Math.random() - 0.5) * 0.07,
        vy: -0.05 - Math.random() * 0.08,
        size: 1.8 + Math.random() * 2.7,
        startedAt,
        duration: settings.waterDuration * (0.72 + Math.random() * 0.28)
      });
    }
    for (let index = 0; index < settings.waterRipples; index += 1) {
      this.cleaningRipples.push({
        x: centerX,
        y: centerY,
        startWidth: water.width * (0.18 + index * 0.12),
        endWidth: water.width * (0.72 + index * 0.13),
        ratio: water.height / Math.max(1, water.width),
        startedAt: startedAt + index * 55,
        duration: settings.waterDuration
      });
    }
    const dropletLimit = settings.waterDropletLimit;
    const rippleLimit = settings.waterRippleLimit;
    if (this.cleaningWaterDrops.length > dropletLimit) {
      this.cleaningWaterDrops.splice(0, this.cleaningWaterDrops.length - dropletLimit);
    }
    if (this.cleaningRipples.length > rippleLimit) {
      this.cleaningRipples.splice(0, this.cleaningRipples.length - rippleLimit);
    }
    this.recordEffectHighWater();
    this.scheduleEffectFrame();
  }

  spawnCleaningDirtParticles(affectedSpots, item = this.layout.cleaningItemBounds) {
    if (!affectedSpots?.length || !item || typeof millis !== "function") return;
    const settings = this.cleaningEffectsConfig();
    const available = Math.max(0, settings.dirtParticleLimit - this.cleaningDirtParticles.length);
    const count = Math.min(settings.dirtParticlesPerEvent, available, affectedSpots.length);
    if (!count) return;
    const startedAt = millis();
    const centerX = item.x + item.width / 2;
    const centerY = item.y + item.height / 2;
    for (let index = 0; index < count; index += 1) {
      const spot = affectedSpots[Math.floor(index * affectedSpots.length / count)];
      this.cleaningDirtParticles.push({
        x: centerX + spot.x * item.size,
        y: centerY + spot.y * item.size,
        vx: (Math.random() - 0.5) * 0.055,
        vy: -0.025 - Math.random() * 0.035,
        size: Math.max(1.4, item.size * (0.012 + Math.random() * 0.014)),
        amount: spot.amount,
        startedAt,
        duration: settings.dirtDuration * (0.8 + Math.random() * 0.25)
      });
    }
    this.recordEffectHighWater();
    this.scheduleEffectFrame();
  }

  drawCleaningEffects() {
    if (typeof millis !== "function") return;
    const now = millis();
    this.compactActive(this.cleaningWaterDrops, (particle) => now - particle.startedAt < particle.duration);
    this.compactActive(this.cleaningRipples, (ripple) => now - ripple.startedAt < ripple.duration);
    this.compactActive(this.cleaningDirtParticles, (particle) => now - particle.startedAt < particle.duration);
    this.recordEffectHighWater();

    this.cleaningRipples.forEach((ripple) => {
      const progress = Math.max(0, (now - ripple.startedAt) / ripple.duration);
      const rippleWidth = ripple.startWidth + (ripple.endWidth - ripple.startWidth) * progress;
      noFill();
      stroke(221, 250, 252, 150 * (1 - progress));
      strokeWeight(1.4);
      ellipse(ripple.x, ripple.y, rippleWidth, rippleWidth * ripple.ratio);
    });
    this.cleaningWaterDrops.forEach((particle) => {
      const elapsed = now - particle.startedAt;
      const progress = elapsed / particle.duration;
      noStroke();
      fill(148, 222, 235, 220 * (1 - progress));
      circle(
        particle.x + particle.vx * elapsed,
        particle.y + particle.vy * elapsed + progress * progress * 18,
        particle.size * (1 - progress * 0.25)
      );
    });
    this.cleaningDirtParticles.forEach((particle, index) => {
      const elapsed = now - particle.startedAt;
      const progress = elapsed / particle.duration;
      noStroke();
      const alpha = (120 + particle.amount * 100) * (1 - progress);
      fill(index % 2 ? 105 : 76, index % 2 ? 76 : 54, index % 2 ? 46 : 35, alpha);
      circle(
        particle.x + particle.vx * elapsed,
        particle.y + particle.vy * elapsed + progress * progress * 6,
        particle.size * (1 - progress * 0.35)
      );
    });

    if (this.cleaningWaterDrops.length || this.cleaningRipples.length || this.cleaningDirtParticles.length) {
      this.scheduleEffectFrame();
    }
  }

  handleCleaningBrushResult(result, item = this.layout.cleaningItemBounds) {
    if (!result) return;
    if (result.affectedSpots?.length) this.spawnCleaningDirtParticles(result.affectedSpots, item);
    if (result.complete) {
      this.cleaningTool = TOOL.HAND;
      this.message = "Both faces are clean. Drag the find back to the inventory tray.";
    } else if (result.faceComplete) {
      this.message = "This face is clean. Use Flip to clean the other side.";
    } else if (result.changed) {
      this.message = "Keep brushing gently across the dirty areas.";
    }
    if (result.changed) this.messageTone = "neutral";
  }

  cleaningNormalisedPoint(x, y, itemBounds = this.layout.cleaningItemBounds) {
    if (!itemBounds) return null;
    return {
      x: (x - (itemBounds.x + itemBounds.width / 2)) / itemBounds.size,
      y: (y - (itemBounds.y + itemBounds.height / 2)) / itemBounds.size
    };
  }

  enterCleaningLab() {
    if (this.currentScene === "trench") this.trenchScene.leave();
    this.currentScene = "cleaning";
    this.pointerAction = null;
    this.cleaningTool = TOOL.HAND;
    this.cleaningInventorySortChooserOpen = false;
    this.collectionFlights.length = 0;
    this.message = this.allCollectedArtefacts().length
      ? "Move a dirty pottery sherd or coin into the clean water."
      : "Collect a find at the dig site to begin cleaning.";
    this.messageTone = "neutral";
    this.requestFrame();
  }

  restoreCleaningDrag(action = this.pointerAction) {
    if (action?.type === "cleaning-item") action.artefact.cleaning.location = action.originLocation;
  }

  startCleaningItemDrag(artefact, originLocation, x, y) {
    this.setPointerToolUse(TOOL.HAND, "closed");
    const aperture = this.layout.bucketDunkAperture || this.layout.bucketWater;
    const apertureCenterY = aperture ? aperture.y + aperture.height / 2 : Infinity;
    const dunkPhase = originLocation === LOCATION.BUCKET
      ? "immersed"
      : aperture && !this.pointInEllipse(aperture, x, y) && y < apertureCenterY
        ? "armed"
        : "unarmed";
    this.pointerAction = {
      type: "cleaning-item",
      artefact,
      originLocation,
      x,
      y,
      rawX: x,
      rawY: y,
      lastRawPoint: { x, y },
      dunkPhase,
      displaySize: this.cleaningItemBaseSize() * 1.08
    };
    this.updateCleaningDragPosition(this.pointerAction, x, y);
    this.message = originLocation === LOCATION.INVENTORY
      ? "Hold the find and dunk it through the water, or release it into the bucket."
      : originLocation === LOCATION.BUCKET
        ? "Use Hand to dunk the find again or place it on the cleaning mat."
        : "Use Hand to move the find between the mat, water, and inventory.";
    this.messageTone = "neutral";
    this.requestFrame();
  }

  flipActiveCleaningArtefact() {
    const artefact = this.activeCleaningArtefact();
    if (artefact && this.cleaningModel.flip(artefact)) {
      this.message = `${artefact.cleaning.activeFace === FACE.FRONT ? "Front" : "Back"} face turned upwards.`;
      this.messageTone = "neutral";
      return true;
    }
    this.message = "Place a wet find on the mat before flipping it.";
    this.messageTone = "warning";
    return false;
  }

  cleaningDraggedItemBounds(action = this.pointerAction) {
    if (action?.type !== "cleaning-item") return null;
    const size = action.displaySize || this.cleaningItemBaseSize() * 1.08;
    return {
      x: action.x - size * 0.58,
      y: action.y - size * 0.62,
      width: size * 1.16,
      height: size * 1.24,
      size,
      location: "dragging",
      artefact: action.artefact
    };
  }

  bucketInnerBoundsAtY(y, itemSize = 0) {
    const geometry = this.layout.bucketGeometry;
    if (!geometry) return null;
    const travel = Math.max(1, geometry.bodyBottom - geometry.waterY);
    const amount = Math.max(0, Math.min(1, (y - geometry.waterY) / travel));
    const wallHalfWidth = geometry.bucketWidth * (0.46 + (0.37 - 0.46) * amount);
    const wallInset = Math.max(3, geometry.bucketWidth * 0.025);
    const artefactHalfWidth = itemSize * 0.58;
    const horizontalRoom = Math.max(0, wallHalfWidth - wallInset - artefactHalfWidth);
    return {
      left: geometry.centerX - horizontalRoom,
      right: geometry.centerX + horizontalRoom,
      maximumY: geometry.bodyBottom - itemSize * 0.62 - Math.max(3, itemSize * 0.03)
    };
  }

  constrainCleaningImmersionPoint(action, rawX, rawY) {
    if (action?.type !== "cleaning-item" || !this.layout.bucketGeometry) return { x: rawX, y: rawY };
    const size = action.displaySize || this.cleaningItemBaseSize() * 1.08;
    const initialBounds = this.bucketInnerBoundsAtY(rawY, size);
    const y = Math.min(rawY, initialBounds.maximumY);
    const bounds = this.bucketInnerBoundsAtY(y, size);
    return {
      x: Math.max(bounds.left, Math.min(bounds.right, rawX)),
      y
    };
  }

  updateCleaningDragPosition(action, rawX, rawY) {
    if (action?.type !== "cleaning-item") return;
    action.rawX = rawX;
    action.rawY = rawY;
    action.x = rawX;
    action.y = rawY;
    if (action.dunkPhase !== "immersed" || !this.layout.bucketGeometry) return;
    const constrained = this.constrainCleaningImmersionPoint(action, rawX, rawY);
    action.x = constrained.x;
    action.y = constrained.y;
  }

  segmentEllipseCrossings(bounds, start, end) {
    if (!bounds || !start || !end) return [];
    const radiusX = bounds.width / 2;
    const radiusY = bounds.height / 2;
    if (radiusX <= 0 || radiusY <= 0) return [];
    const centerX = bounds.x + radiusX;
    const centerY = bounds.y + radiusY;
    const startX = (start.x - centerX) / radiusX;
    const startY = (start.y - centerY) / radiusY;
    const deltaX = (end.x - start.x) / radiusX;
    const deltaY = (end.y - start.y) / radiusY;
    const a = deltaX * deltaX + deltaY * deltaY;
    if (a <= 1e-10) return [];
    const b = 2 * (startX * deltaX + startY * deltaY);
    const c = startX * startX + startY * startY - 1;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return [];
    const root = Math.sqrt(discriminant);
    const candidates = [(-b - root) / (2 * a), (-b + root) / (2 * a)]
      .filter((value, index, values) => value > 1e-7 && value <= 1 && (index === 0 || Math.abs(value - values[0]) > 1e-7))
      .sort((first, second) => first - second);
    return candidates.map((amount) => {
      const before = Math.max(0, amount - 1e-5);
      const after = Math.min(1, amount + 1e-5);
      const beforePoint = {
        x: start.x + (end.x - start.x) * before,
        y: start.y + (end.y - start.y) * before
      };
      const afterPoint = {
        x: start.x + (end.x - start.x) * after,
        y: start.y + (end.y - start.y) * after
      };
      return {
        amount,
        x: start.x + (end.x - start.x) * amount,
        y: start.y + (end.y - start.y) * amount,
        entering: !this.pointInEllipse(bounds, beforePoint.x, beforePoint.y)
          && this.pointInEllipse(bounds, afterPoint.x, afterPoint.y)
      };
    });
  }

  handleHandwashResult(result, action) {
    if (!result) return;
    if (result.affectedSpots?.length) {
      this.spawnCleaningDirtParticles(result.affectedSpots, this.cleaningDraggedItemBounds(action));
    }
    if (result.complete) {
      this.cleaningTool = TOOL.HAND;
      this.message = "Both faces are clean. Return the find to the inventory tray.";
    } else if (result.faceComplete) {
      this.message = "This face is clean. Place the find on the mat and flip it.";
    } else if (result.changed) {
      this.message = "Keep dunking this face through the water to handwash it.";
    }
    if (result.changed) this.messageTone = "neutral";
  }

  advanceCleaningDunk(action, start, end) {
    const aperture = this.layout.bucketDunkAperture || this.layout.bucketWater;
    if (!aperture || this.cleaningModel.isReturnable(action.artefact)) return;
    const wasImmersed = action.dunkPhase === "immersed";
    const gestureStart = wasImmersed ? this.constrainCleaningImmersionPoint(action, start.x, start.y) : start;
    const gestureEnd = wasImmersed ? this.constrainCleaningImmersionPoint(action, end.x, end.y) : end;
    const centerY = aperture.y + aperture.height / 2;
    const movingDown = gestureEnd.y > gestureStart.y;
    const verticalMotion = Math.abs((gestureEnd.y - gestureStart.y) / Math.max(1, aperture.height))
      >= Math.abs((gestureEnd.x - gestureStart.x) / Math.max(1, aperture.width));
    const crossings = this.segmentEllipseCrossings(aperture, gestureStart, gestureEnd);

    crossings.forEach((crossing) => {
      const upperBoundary = crossing.y <= centerY + 1e-5;
      if (crossing.entering) {
        if (upperBoundary && movingDown && verticalMotion && action.dunkPhase === "armed") {
          action.dunkPhase = "immersed";
          if (this.cleaningModel.dampen(action.artefact)) {
            this.spawnCleaningWaterEffects();
            this.message = "The find is wet. Lift it back through the opening to complete a handwash dunk.";
            this.messageTone = "neutral";
          }
        } else if (action.dunkPhase !== "immersed") {
          action.dunkPhase = "unarmed";
        }
      } else if (action.dunkPhase === "immersed" && upperBoundary && !movingDown && verticalMotion) {
        action.dunkPhase = "armed";
        const result = this.cleaningModel.handwashDunk(action.artefact, action.artefact.cleaning.activeFace);
        this.handleHandwashResult(result, action);
      } else if (action.dunkPhase === "immersed") {
        // The solid bucket wall retains a valid immersion during lower or
        // sideways overshoot. Only an upward upper-rim crossing completes it.
      } else {
        action.dunkPhase = "unarmed";
      }
    });

    const endsInside = this.pointInEllipse(aperture, gestureEnd.x, gestureEnd.y);
    if (action.dunkPhase !== "immersed" && !endsInside && gestureEnd.y < centerY) action.dunkPhase = "armed";
  }

  cleaningPointerStart(x, y) {
    if (this.pointIn(this.layout.labBackButton, x, y)) {
      this.cleaningScene.leave();
      this.currentScene = "site";
      this.message = "Choose a trench or return to the finds lab.";
      this.messageTone = "neutral";
      this.requestFrame();
      return;
    }
    if (this.cleaningInventorySortChooserOpen) {
      const option = (this.layout.inventorySortOptions || []).find((entry) => this.pointIn(entry.bounds, x, y));
      if (option) {
        this.cleaningInventorySort = option.sort;
        this.cleaningInventoryPage = 0;
        this.message = `${this.cleaningInventorySortLabel()} sorting selected.`;
        this.messageTone = "neutral";
      }
      this.cleaningInventorySortChooserOpen = false;
      this.requestFrame();
      return;
    }
    if (this.layout.inventorySortButton && this.pointIn(this.layout.inventorySortButton, x, y)) {
      this.cleaningInventorySortChooserOpen = true;
      this.requestFrame();
      return;
    }
    if (this.layout.inventoryPreviousButton && this.pointIn(this.layout.inventoryPreviousButton, x, y)) {
      this.cleaningInventoryPage = Math.max(0, this.cleaningInventoryPage - 1);
      this.requestFrame();
      return;
    }
    if (this.layout.inventoryNextButton && this.pointIn(this.layout.inventoryNextButton, x, y)) {
      this.cleaningInventoryPage += 1;
      this.requestFrame();
      return;
    }
    if (this.layout.handButton && this.pointIn(this.layout.handButton, x, y)) {
      this.cleaningTool = TOOL.HAND;
      this.message = "Hand selected. Move or dunk the artefact without scrubbing it.";
      this.messageTone = "neutral";
      this.requestFrame();
      return;
    }
    if (this.pointIn(this.layout.toothbrushButton, x, y)) {
      this.cleaningTool = TOOL.TOOTHBRUSH;
      this.message = "Toothbrush selected for robust finds.";
      this.messageTone = "neutral";
      this.requestFrame();
      return;
    }
    if (this.pointIn(this.layout.fineBrushButton, x, y)) {
      this.cleaningTool = TOOL.FINE_BRUSH;
      this.message = "Fine paintbrush selected for fragile or delicate finds.";
      this.messageTone = "neutral";
      this.requestFrame();
      return;
    }
    if (this.pointIn(this.layout.flipButton, x, y)
      || (this.layout.contextFlipButton && this.pointIn(this.layout.contextFlipButton, x, y))) {
      this.flipActiveCleaningArtefact();
      this.requestFrame();
      return;
    }

    const cleaningSurfacePressed = (this.layout.matSurface && this.pointIn(this.layout.matSurface, x, y))
      || (this.layout.bucketDropTarget && this.pointIn(this.layout.bucketDropTarget, x, y));
    if (cleaningSurfacePressed) {
      this.setPointerToolUse(this.cleaningTool, this.cleaningTool === TOOL.HAND ? "open" : null);
    }

    const slot = (this.layout.inventorySlots || []).find((entry) => this.pointIn(entry.bounds, x, y));
    if (slot) {
      const artefact = slot.artefact;
      if (!artefact.cleanable) {
        this.message = "Cleaning is not yet available for this type of find.";
        this.messageTone = "warning";
        this.requestFrame();
        return;
      }
      const state = this.cleaningModel.ensureState(artefact);
      if (this.cleaningModel.isFinal(artefact)) {
        this.message = state.status === STATUS.AWAITING_SPECIALIST
          ? "This coin is waiting for specialist treatment."
          : "This find is clean and ready for identification.";
        this.messageTone = "neutral";
        this.requestFrame();
        return;
      }
      const active = this.activeCleaningArtefact();
      if (active && active !== artefact) {
        this.message = "Finish or return the find already on the cleaning bench first.";
        this.messageTone = "warning";
        this.requestFrame();
        return;
      }
      this.cleaningTool = TOOL.HAND;
      this.startCleaningItemDrag(artefact, LOCATION.INVENTORY, x, y);
      return;
    }

    const item = this.layout.cleaningItemBounds;
    if (!item || !this.pointIn(item, x, y)) return;
    const artefact = item.artefact;
    if (item.location === LOCATION.BUCKET) {
      this.setPointerToolUse(this.cleaningTool, this.cleaningTool === TOOL.HAND ? "closed" : null);
      if (this.cleaningTool !== TOOL.HAND) {
        this.message = "Select Hand to lift the find from the bucket.";
        this.messageTone = "warning";
        this.requestFrame();
        return;
      }
      this.startCleaningItemDrag(artefact, LOCATION.BUCKET, x, y);
      return;
    }
    if (item.location !== LOCATION.MAT) return;
    this.setPointerToolUse(this.cleaningTool, this.cleaningTool === TOOL.HAND ? "closed" : null);
    if (this.cleaningTool === TOOL.HAND) {
      this.startCleaningItemDrag(artefact, LOCATION.MAT, x, y);
      return;
    }
    if (!this.cleaningModel.canUseTool(artefact, this.cleaningTool)) {
      const brushName = artefact.cleaningTool === TOOL.TOOTHBRUSH ? "toothbrush" : "fine paintbrush";
      this.message = `${artefact.label} is ${artefact.robustness.toLowerCase()}; use the ${brushName}.`;
      this.messageTone = "warning";
      this.requestFrame();
      return;
    }
    const point = this.cleaningNormalisedPoint(x, y, item);
    const contactedSpots = new Set();
    this.pointerAction = {
      type: "cleaning-brush",
      artefact,
      face: artefact.cleaning.activeFace,
      tool: this.cleaningTool,
      lastPoint: point,
      contactedSpots
    };
    const result = this.cleaningModel.clearAlongSegment(
      artefact,
      artefact.cleaning.activeFace,
      point,
      point,
      this.cleaningTool,
      contactedSpots
    );
    this.handleCleaningBrushResult(result, item);
    this.requestFrame();
  }

  cleaningPointerMove(x, y) {
    const action = this.pointerAction;
    if (!action) {
      this.requestFrame();
      return;
    }
    if (action.type === "cleaning-item") {
      const previous = action.lastRawPoint || { x: action.rawX ?? action.x, y: action.rawY ?? action.y };
      this.advanceCleaningDunk(action, previous, { x, y });
      this.updateCleaningDragPosition(action, x, y);
      action.lastRawPoint = { x, y };
      this.requestFrame();
      return;
    }
    if (action.type !== "cleaning-brush") return;
    const current = this.cleaningNormalisedPoint(x, y, this.layout.cleaningItemBounds);
    if (!current) return;
    const result = this.cleaningModel.clearAlongSegment(
      action.artefact,
      action.face,
      action.lastPoint,
      current,
      action.tool,
      action.contactedSpots
    );
    action.lastPoint = current;
    this.handleCleaningBrushResult(result, this.layout.cleaningItemBounds);
    this.requestFrame();
  }

  cleaningPointerEnd(x, y) {
    const action = this.pointerAction;
    if (!action) {
      this.requestFrame();
      return;
    }
    if (action.type === "cleaning-brush") {
      this.pointerAction = null;
      this.requestFrame();
      return;
    }
    if (action.type !== "cleaning-item") return;
    const artefact = action.artefact;
    if (!action.lastRawPoint || action.lastRawPoint.x !== x || action.lastRawPoint.y !== y) {
      const previous = action.lastRawPoint || { x: action.rawX ?? action.x, y: action.rawY ?? action.y };
      this.advanceCleaningDunk(action, previous, { x, y });
      this.updateCleaningDragPosition(action, x, y);
      action.lastRawPoint = { x, y };
    }
    let accepted = false;
    if (this.cleaningModel.isReturnable(artefact) && this.pointIn(this.layout.inventory, x, y)) {
      accepted = this.cleaningModel.returnToInventory(artefact);
      if (accepted) {
        this.message = artefact.cleaning.status === STATUS.AWAITING_SPECIALIST
          ? `${artefact.label} has completed washing and now needs specialist treatment.`
          : `${artefact.label} is clean and ready for identification.`;
      }
    } else if (this.cleaningModel.canDampen(artefact)
      && action.dunkPhase === "immersed") {
      accepted = this.cleaningModel.immerse(artefact);
      this.message = accepted ? "The find is parked safely in the clean water." : "This find cannot be submerged right now.";
    } else if (this.cleaningModel.canDampen(artefact)
      && this.pointInEllipse(this.layout.bucketDropTarget || this.layout.bucketWater, x, y)) {
      accepted = this.cleaningModel.immerse(artefact);
      if (accepted) this.spawnCleaningWaterEffects();
      this.message = accepted ? "The find is wet. Move it onto the cleaning mat." : "This find cannot be submerged right now.";
    } else if (this.cleaningModel.canPlaceOnMat(artefact)
      && this.pointIn(this.layout.matSurface || this.layout.mat, x, y)) {
      accepted = this.cleaningModel.placeOnMat(artefact);
      this.message = accepted
        ? "Select Hand, Toothbrush, or Fine paintbrush for the next step."
        : "Wet the find before placing it on the mat.";
    }

    if (!accepted) {
      artefact.cleaning.location = action.originLocation;
      this.message = "Release the find over the bucket, cleaning surface, or inventory when it is ready.";
      this.messageTone = "warning";
    } else {
      this.messageTone = "neutral";
    }
    this.pointerAction = null;
    this.requestFrame();
  }

  static get legacyMethodNames() {
    const controllerMethods = new Set([
      "constructor", "enter", "leave", "handleResize", "draw",
      "pointerStart", "pointerMove", "pointerEnd", "pointerCancel", "cursorPresentation"
    ]);
    return Object.getOwnPropertyNames(CleaningScene.prototype)
      .filter((name) => !controllerMethods.has(name));
  }
  }

  CleaningScene.installSceneManagerPrototype = function installSceneManagerPrototype(prototype) {
    if (!prototype) throw new Error("A SceneManager prototype is required.");
    CleaningScene.legacyMethodNames.forEach((name) => {
      Object.defineProperty(prototype, name, {
        configurable: true,
        writable: true,
        value: CleaningScene.prototype[name]
      });
    });
    return prototype;
  };

  root.CleaningScene = CleaningScene;
  CleaningScene.ownedState = [...OWNED_STATE];
})(typeof window !== "undefined" ? window : globalThis);
