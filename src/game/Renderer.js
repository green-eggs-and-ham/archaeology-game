window.GameRenderer = class GameRenderer {
  constructor() {
    this.backgroundLayer = null;
    this.backgroundSize = { width: 0, height: 0 };
    this.artefactRenderer = new window.ArtefactRenderer();
  }

  drawBackground() {
    if (!this.backgroundLayer || this.backgroundSize.width !== width || this.backgroundSize.height !== height) {
      this.buildBackgroundLayer();
    }
    image(this.backgroundLayer, 0, 0, width, height);
  }

  buildBackgroundLayer() {
    if (this.backgroundLayer && typeof this.backgroundLayer.remove === "function") this.backgroundLayer.remove();
    this.backgroundLayer = createGraphics(width, height);
    this.backgroundLayer.pixelDensity(1);
    this.backgroundSize = { width, height };
    const graphic = this.backgroundLayer;
    graphic.noStroke();
    for (let index = 0; index < 8; index += 1) {
      const amount = index / 7;
      graphic.fill(lerpColor(color("#14323d"), color("#0b1f2a"), amount));
      graphic.rect(0, index * height / 8, width, height / 8 + 1);
    }
    graphic.fill(255, 255, 255, 10);
    for (let index = 0; index < 16; index += 1) {
      graphic.circle((index * 97) % width, (index * 53) % height, 2 + (index % 3));
    }
  }

  panel(x, y, panelWidth, panelHeight, fillColour = "#f4ead5") {
    noStroke();
    fill(8, 25, 33, 90);
    rect(x + 3, y + 4, panelWidth, panelHeight, 10);
    fill(fillColour);
    rect(x, y, panelWidth, panelHeight, 10);
  }

  button(bounds, label, selected = false, compact = false, disabled = false, textOptions = {}) {
    const { x, y, width: buttonWidth, height: buttonHeight } = bounds;
    stroke(disabled ? "#38515a" : selected ? "#f4b942" : "#2d5965");
    strokeWeight(selected ? 3 : 1);
    fill(disabled ? "#1b343d" : selected ? "#285d62" : "#183c48");
    rect(x, y, buttonWidth, buttonHeight, 8);
    const icon = textOptions.icon || null;
    const iconOnly = Boolean(icon && textOptions.iconOnly);
    const iconSize = icon
      ? iconOnly
        ? Math.max(12, Math.min(buttonHeight * 0.58, buttonWidth * 0.58, 24))
        : Math.max(12, Math.min(buttonHeight * 0.54, buttonWidth * 0.2, 24))
      : 0;
    const iconGap = icon ? Math.max(3, iconSize * 0.25) : 0;
    const contentWidth = icon && !iconOnly ? Math.max(1, buttonWidth - iconSize - iconGap - 10) : buttonWidth;
    const contentStart = icon && !iconOnly ? x + 6 + iconSize + iconGap : x;
    if (icon) {
      this.drawToolIcon(icon, iconOnly ? x + buttonWidth / 2 : x + 6 + iconSize / 2, y + buttonHeight / 2, iconSize, {
        active: (textOptions.iconActive ?? selected) && !disabled,
        disabled
      });
    }
    if (iconOnly) {
      this.notificationBadge(bounds, textOptions.badgeCount);
      noStroke();
      textStyle(NORMAL);
      return;
    }
    noStroke();
    fill(disabled ? "#829495" : "#fff9e9");
    textAlign(CENTER, CENTER);
    textStyle(BOLD);
    const minimumSize = textOptions.minimumSize ?? (compact ? 7 : 10);
    const maximumSize = textOptions.maximumSize ?? 15;
    const heightLimitedSize = Math.min(maximumSize, buttonHeight * 0.37);
    const widthLimitedSize = compact ? contentWidth / Math.max(7, label.length * 0.62) : heightLimitedSize;
    textSize(Math.max(minimumSize, Math.min(heightLimitedSize, widthLimitedSize)));
    text(label, contentStart + contentWidth / 2, y + buttonHeight / 2 + 1);
    textStyle(NORMAL);
    this.notificationBadge(bounds, textOptions.badgeCount);
  }

  notificationBadge(bounds, count) {
    const amount = Number(count) || 0;
    if (amount <= 0) return;
    const label = String(Math.floor(amount));
    push();
    textStyle(BOLD);
    textAlign(CENTER, CENTER);
    const badgeTextSize = Math.max(8, Math.min(10, bounds.height * 0.28));
    textSize(badgeTextSize);
    const badgeHeight = Math.max(17, Math.min(21, bounds.height * 0.52));
    const badgeWidth = Math.max(badgeHeight, textWidth(label) + 9);
    const badgeX = bounds.x + bounds.width - 2;
    const badgeY = bounds.y + 2;
    stroke("#7b211f");
    strokeWeight(1.5);
    fill("#d94b43");
    rectMode(CENTER);
    rect(badgeX, badgeY, badgeWidth, badgeHeight, badgeHeight / 2);
    noStroke();
    fill("#fff9e9");
    text(label, badgeX, badgeY + 0.5);
    pop();
  }

  drawToolIcon(tool, x, y, size, options = {}) {
    const muted = options.disabled || !options.active;
    const inUse = options.variant === "in-use" || options.pressed;
    const outline = muted ? "#718184" : tool === "hand" ? "#4a3021" : "#f7e8bd";
    const accent = muted ? "#8b9899" : tool === "hand" ? "#b98252" : "#f4b942";
    const gloveGreen = muted ? "#718184" : "#668248";
    const gloveHighlight = muted ? "#9aa5a5" : "#d2a477";
    push();
    translate(x, y);
    stroke(outline);
    strokeWeight(Math.max(1, size * 0.085));
    strokeCap(ROUND);
    strokeJoin(ROUND);
    fill(accent);

    if (tool === "hand") {
      const pose = options.pose || (options.pressed ? "closed" : "open");
      const gloveSegment = (x1, y1, x2, y2, thickness = 0.16) => {
        stroke(outline);
        strokeWeight(Math.max(2, size * thickness));
        line(x1 * size, y1 * size, x2 * size, y2 * size);
        stroke(accent);
        strokeWeight(Math.max(1, size * thickness * 0.62));
        line(x1 * size, y1 * size, x2 * size, y2 * size);
      };
      rectMode(CENTER);
      if (pose === "pointing") {
        // Side-profile pointer based on a classic upper-left cursor hand. The
        // long index fingertip at (-0.52, -0.44) is the cursor hotspot.
        fill(accent);
        beginShape();
        vertex(-size * 0.52, -size * 0.44);
        vertex(-size * 0.55, -size * 0.36);
        vertex(-size * 0.5, -size * 0.26);
        vertex(-size * 0.39, -size * 0.13);
        vertex(-size * 0.12, size * 0.16);
        vertex(-size * 0.3, size * 0.08);
        vertex(-size * 0.45, size * 0.05);
        vertex(-size * 0.52, size * 0.13);
        vertex(-size * 0.5, size * 0.25);
        vertex(-size * 0.36, size * 0.35);
        vertex(-size * 0.17, size * 0.43);
        vertex(size * 0.05, size * 0.49);
        vertex(size * 0.22, size * 0.46);
        vertex(size * 0.35, size * 0.35);
        vertex(size * 0.44, size * 0.21);
        vertex(size * 0.45, size * 0.07);
        vertex(size * 0.39, -size * 0.05);
        vertex(size * 0.29, -size * 0.14);
        vertex(size * 0.18, -size * 0.11);
        vertex(size * 0.11, -size * 0.2);
        vertex(0, -size * 0.23);
        vertex(-size * 0.1, -size * 0.16);
        vertex(-size * 0.16, -size * 0.29);
        vertex(-size * 0.29, -size * 0.36);
        vertex(-size * 0.39, -size * 0.31);
        vertex(-size * 0.46, -size * 0.4);
        endShape(CLOSE);

        fill(gloveGreen);
        beginShape();
        vertex(size * 0.17, size * 0.39);
        vertex(size * 0.29, size * 0.29);
        vertex(size * 0.42, size * 0.28);
        vertex(size * 0.5, size * 0.36);
        vertex(size * 0.47, size * 0.47);
        vertex(size * 0.31, size * 0.55);
        vertex(size * 0.18, size * 0.51);
        vertex(size * 0.14, size * 0.45);
        endShape(CLOSE);
        stroke(gloveHighlight);
        strokeWeight(Math.max(1, size * 0.055));
        noFill();
        arc(size * 0.18, size * 0.04, size * 0.3, size * 0.25, Math.PI * 0.12, Math.PI * 0.75);
      } else {
        fill(accent);
        rect(0, size * 0.12, size * 0.48, size * 0.5, size * 0.13);
        if (pose === "closed") {
          fill(accent);
          arc(0, -size * 0.1, size * 0.55, size * 0.45, Math.PI, Math.PI * 2);
        } else {
          [-0.24, -0.08, 0.08, 0.24].forEach((offset, index) => {
            gloveSegment(offset, -0.08, offset, -(0.37 + (index === 1 || index === 2 ? 0.07 : 0)));
          });
        }
        gloveSegment(-0.22, 0, -0.4, -0.2, 0.17);
        fill(gloveGreen);
        stroke(outline);
        rect(0, size * 0.43, size * 0.5, size * 0.18, size * 0.05);
        stroke(gloveHighlight);
        strokeWeight(Math.max(1, size * 0.045));
        line(-size * 0.17, size * 0.08, size * 0.17, size * 0.08);
      }
    } else if (tool === "brush") {
      line(-size * (inUse ? 0.36 : 0.4), size * (inUse ? 0.39 : 0.34), size * 0.27, -size * 0.33);
      fill(muted ? "#7f898a" : "#c99755");
      quad(
        size * 0.12, -size * 0.2,
        size * 0.3, -size * 0.38,
        size * 0.47, -size * 0.22,
        size * (inUse ? 0.2 : 0.25), size * (inUse ? 0.01 : -0.04)
      );
      line(size * 0.29, -size * 0.34, size * (inUse ? 0.44 : 0.4), -size * (inUse ? 0.14 : 0.2));
      if (inUse) line(size * 0.23, -size * 0.27, size * 0.47, -size * 0.22);
    } else if (tool === "scoop") {
      line(inUse ? -size * 0.18 : 0, -size * 0.44, 0, size * 0.16);
      noFill();
      ellipse(inUse ? -size * 0.16 : 0, -size * 0.38, size * 0.28, size * 0.18);
      fill(accent);
      beginShape();
      vertex(-size * (inUse ? 0.32 : 0.27), size * (inUse ? 0.14 : 0.1));
      vertex(size * (inUse ? 0.22 : 0.27), size * (inUse ? 0.06 : 0.1));
      vertex(size * (inUse ? 0.18 : 0.2), size * 0.42);
      vertex(0, size * 0.51);
      vertex(-size * (inUse ? 0.24 : 0.2), size * 0.42);
      endShape(CLOSE);
      if (inUse) {
        noStroke();
        fill(muted ? "#697576" : "#765134");
        arc(-size * 0.02, size * 0.19, size * 0.4, size * 0.18, Math.PI, Math.PI * 2);
      }
    } else if (tool === "toothbrush") {
      line(-size * 0.43, size * 0.24, size * 0.28, -size * 0.19);
      fill(accent);
      rectMode(CENTER);
      rect(size * 0.31, -size * 0.24, size * 0.34, size * 0.2, size * 0.05);
      for (let index = 0; index < 4; index += 1) {
        const bristleX = (0.2 + index * 0.08) * size;
        line(bristleX, -size * 0.31, bristleX + (inUse ? (index - 1.5) * size * 0.025 : 0), -size * 0.43);
      }
    } else if (tool === "fine-brush") {
      line(-size * (inUse ? 0.38 : 0.43), size * (inUse ? 0.38 : 0.34), size * 0.27, -size * 0.3);
      fill(muted ? "#7f898a" : "#d9b879");
      beginShape();
      vertex(size * 0.18, -size * 0.2);
      vertex(size * 0.3, -size * 0.34);
      vertex(size * 0.48, -size * 0.48);
      vertex(size * (inUse ? 0.4 : 0.37), -size * (inUse ? 0.17 : 0.21));
      endShape(CLOSE);
      if (inUse) {
        line(size * 0.31, -size * 0.29, size * 0.48, -size * 0.48);
        line(size * 0.37, -size * 0.23, size * 0.48, -size * 0.48);
      }
    } else if (tool === "flip") {
      noFill();
      stroke(accent);
      strokeWeight(Math.max(1.3, size * 0.1));
      arc(0, -size * 0.12, size * 0.72, size * 0.28, Math.PI, Math.PI * 2);
      arc(0, size * 0.12, size * 0.72, size * 0.28, 0, Math.PI);
      fill(accent);
      noStroke();
      triangle(size * 0.42, -size * 0.12, size * 0.23, -size * 0.25, size * 0.23, size * 0.01);
      triangle(-size * 0.42, size * 0.12, -size * 0.23, size * 0.25, -size * 0.23, -size * 0.01);
    }
    pop();
  }

  drawToolCursor(tool, x, y, pressed = false, pose = null) {
    const cursorTool = ["brush", "scoop", "toothbrush", "fine-brush"].includes(tool) ? tool : "hand";
    const size = cursorTool === "hand" ? 30 : 23;
    const handPose = pose || (pressed ? "closed" : "open");
    push();
    if (cursorTool === "hand") {
      const offsets = handPose === "pointing"
        ? { x: size * 0.52, y: size * 0.44 }
        : handPose === "closed"
          ? { x: 0, y: size * 0.1 }
          : { x: size * 0.08, y: size * 0.44 };
      this.drawToolIcon("hand", x + offsets.x, y + offsets.y, size, {
        active: true,
        pose: handPose,
        variant: pressed ? "in-use" : "idle"
      });
    } else if (cursorTool === "brush") {
      this.drawToolIcon(cursorTool, x - size * 0.47, y + size * 0.22, size, { active: true, variant: pressed ? "in-use" : "idle" });
    } else if (cursorTool === "scoop") {
      this.drawToolIcon(cursorTool, x, y - size * 0.51, size, { active: true, variant: pressed ? "in-use" : "idle" });
    } else if (cursorTool === "toothbrush") {
      this.drawToolIcon(cursorTool, x - size * 0.32, y + size * 0.43, size, { active: true, variant: pressed ? "in-use" : "idle" });
    } else {
      this.drawToolIcon(cursorTool, x - size * 0.48, y + size * 0.48, size, { active: true, variant: pressed ? "in-use" : "idle" });
    }
    noStroke();
    fill("#fff9e9");
    circle(x, y, 3.2);
    fill("#17333b");
    circle(x, y, 1.4);
    pop();
  }

  traceArtefactPath(artefact, size, context = drawingContext) {
    return this.artefactRenderer.tracePath(artefact, size, context);
  }

  drawArtefactDetails(artefact, size, face = "front", collected = false) {
    return this.artefactRenderer.drawDetails(artefact, size, face, collected);
  }

  drawArtefactDirt(artefact, size, face) {
    return this.artefactRenderer.drawDirt(artefact, size, face);
  }

  drawArtefactDampness(artefact, size) {
    return this.artefactRenderer.drawDampness(artefact, size);
  }

  artefact(artefact, x, y, size, options = {}) {
    return this.artefactRenderer.draw(artefact, x, y, size, options);
  }

  artefactOutline(artefact, x, y, size, options = {}) {
    return this.artefactRenderer.outline(artefact, x, y, size, options);
  }

  artefactShape(shape, x, y, size, colour, collected = false, partial = false) {
    this.artefact({ shape, variantId: shape, colour }, x, y, size, { collected, partial });
  }
};
