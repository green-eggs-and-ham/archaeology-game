window.GameRenderer = class GameRenderer {
  constructor() {
    this.backgroundLayer = null;
    this.backgroundSize = { width: 0, height: 0 };
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
    const iconSize = icon ? Math.max(12, Math.min(buttonHeight * 0.54, buttonWidth * 0.2, 24)) : 0;
    const iconGap = icon ? Math.max(3, iconSize * 0.25) : 0;
    const contentWidth = icon ? Math.max(1, buttonWidth - iconSize - iconGap - 10) : buttonWidth;
    const contentStart = icon ? x + 6 + iconSize + iconGap : x;
    if (icon) {
      this.drawToolIcon(icon, x + 6 + iconSize / 2, y + buttonHeight / 2, iconSize, {
        active: (textOptions.iconActive ?? selected) && !disabled,
        disabled
      });
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
  }

  drawToolIcon(tool, x, y, size, options = {}) {
    const muted = options.disabled || !options.active;
    const outline = muted ? "#718184" : "#f7e8bd";
    const accent = muted ? "#8b9899" : tool === "hand" ? "#82a55b" : "#f4b942";
    push();
    translate(x, y);
    stroke(outline);
    strokeWeight(Math.max(1, size * 0.085));
    strokeCap(ROUND);
    strokeJoin(ROUND);
    fill(accent);

    if (tool === "hand") {
      const pose = options.pose || (options.pressed ? "closed" : "open");
      rectMode(CENTER);
      if (pose === "pointing") {
        // A side-profile glove with a single, unmistakably extended index
        // finger. The rounded fingertip is the cursor hotspot.
        rect(-size * 0.11, size * 0.2, size * 0.52, size * 0.42, size * 0.15);
        rect(-size * 0.27, size * 0.45, size * 0.36, size * 0.2, size * 0.055);
        strokeWeight(Math.max(2.4, size * 0.24));
        line(-size * 0.01, -size * 0.04, size * 0.49, -size * 0.35);
        stroke(accent);
        strokeWeight(Math.max(1.2, size * 0.135));
        line(-size * 0.01, -size * 0.04, size * 0.49, -size * 0.35);
        stroke(outline);
        // Three compact curled fingers remain visibly separate beneath the
        // pointing finger instead of reading as another rake-like fan.
        [-0.24, -0.07, 0.1].forEach((offset, index) => {
          strokeWeight(Math.max(2, size * 0.17));
          line(offset * size, -size * (0.015 + index * 0.008), (offset + 0.08) * size, size * (0.095 + index * 0.018));
          stroke(accent);
          strokeWeight(Math.max(1, size * 0.08));
          line(offset * size, -size * (0.015 + index * 0.008), (offset + 0.08) * size, size * (0.095 + index * 0.018));
          stroke(outline);
        });
        strokeWeight(Math.max(1.2, size * 0.09));
        line(-size * 0.29, size * 0.08, -size * 0.43, -size * 0.03);
        line(-size * 0.43, -size * 0.03, -size * 0.33, -size * 0.15);
        line(-size * 0.42, size * 0.4, -size * 0.11, size * 0.4);
      } else {
        rect(0, size * 0.12, size * 0.48, size * 0.5, size * 0.13);
      }
      if (pose === "closed") {
        arc(0, -size * 0.1, size * 0.55, size * 0.45, Math.PI, Math.PI * 2);
      } else if (pose === "open") {
        [-0.24, -0.08, 0.08, 0.24].forEach((offset, index) => {
          line(offset * size, -size * 0.08, offset * size, -size * (0.37 + (index === 1 || index === 2 ? 0.07 : 0)));
        });
      }
      if (pose !== "pointing") {
        line(-size * 0.22, 0, -size * 0.43, -size * 0.18);
        line(-size * 0.43, -size * 0.18, -size * 0.33, -size * 0.28);
      }
    } else if (tool === "brush") {
      line(-size * 0.4, size * 0.34, size * 0.27, -size * 0.33);
      fill(muted ? "#7f898a" : "#c99755");
      quad(size * 0.12, -size * 0.2, size * 0.3, -size * 0.38, size * 0.47, -size * 0.22, size * 0.25, -size * 0.04);
      line(size * 0.29, -size * 0.34, size * 0.4, -size * 0.2);
    } else if (tool === "scoop") {
      line(0, -size * 0.44, 0, size * 0.16);
      noFill();
      ellipse(0, -size * 0.38, size * 0.28, size * 0.18);
      fill(accent);
      beginShape();
      vertex(-size * 0.27, size * 0.1);
      vertex(size * 0.27, size * 0.1);
      vertex(size * 0.2, size * 0.42);
      vertex(0, size * 0.51);
      vertex(-size * 0.2, size * 0.42);
      endShape(CLOSE);
    } else if (tool === "toothbrush") {
      line(-size * 0.43, size * 0.24, size * 0.28, -size * 0.19);
      fill(accent);
      rectMode(CENTER);
      rect(size * 0.31, -size * 0.24, size * 0.34, size * 0.2, size * 0.05);
      for (let index = 0; index < 4; index += 1) {
        line((0.2 + index * 0.08) * size, -size * 0.31, (0.2 + index * 0.08) * size, -size * 0.43);
      }
    } else if (tool === "fine-brush") {
      line(-size * 0.43, size * 0.34, size * 0.27, -size * 0.3);
      fill(muted ? "#7f898a" : "#d9b879");
      beginShape();
      vertex(size * 0.18, -size * 0.2);
      vertex(size * 0.3, -size * 0.34);
      vertex(size * 0.48, -size * 0.48);
      vertex(size * 0.37, -size * 0.21);
      endShape(CLOSE);
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
        ? { x: -size * 0.49, y: size * 0.35 }
        : handPose === "closed"
          ? { x: 0, y: size * 0.1 }
          : { x: size * 0.08, y: size * 0.44 };
      this.drawToolIcon("hand", x + offsets.x, y + offsets.y, size, { active: true, pose: handPose });
    } else if (cursorTool === "brush") {
      this.drawToolIcon(cursorTool, x - size * 0.4, y + size * 0.25, size, { active: true });
    } else if (cursorTool === "scoop") {
      this.drawToolIcon(cursorTool, x, y - size * 0.51, size, { active: true });
    } else if (cursorTool === "toothbrush") {
      this.drawToolIcon(cursorTool, x - size * 0.31, y + size * 0.43, size, { active: true });
    } else {
      this.drawToolIcon(cursorTool, x - size * 0.48, y + size * 0.48, size, { active: true });
    }
    noStroke();
    fill("#fff9e9");
    circle(x, y, 3.2);
    fill("#17333b");
    circle(x, y, 1.4);
    pop();
  }

  traceArtefactPath(artefact, size, context = drawingContext) {
    const variant = artefact.variantId || artefact.shape;
    const point = (x, y) => [x * size, y * size];
    context.beginPath();
    if (artefact.shape === "coin") {
      context.arc(0, 0, size * 0.5, 0, Math.PI * 2);
      context.closePath();
      return;
    }
    if (artefact.shape === "bead") {
      context.arc(0, 0, size * 0.5, 0, Math.PI * 2);
      context.closePath();
      return;
    }
    if (artefact.shape === "arrowhead") {
      context.moveTo(...point(0, -0.62));
      context.lineTo(...point(0.5, 0.55));
      context.lineTo(...point(-0.5, 0.55));
      context.closePath();
      return;
    }

    const polygons = {
      "folded-beaker": [[-0.54, -0.34], [0.3, -0.5], [0.53, -0.2], [0.44, 0.46], [-0.36, 0.54], [-0.58, 0.08]],
      "decorated-samian": [[-0.5, -0.42], [0.34, -0.54], [0.55, -0.12], [0.4, 0.5], [-0.44, 0.43], [-0.57, -0.02]],
      "storage-jar": [[-0.5, -0.48], [0.45, -0.42], [0.56, 0.08], [0.3, 0.52], [-0.48, 0.4], [-0.58, -0.05]],
      "verulamium-flagon": [[-0.42, -0.54], [0.4, -0.54], [0.3, -0.22], [0.5, 0.46], [-0.43, 0.5], [-0.28, -0.2]],
      "dark-cooking-pot": [[-0.56, -0.4], [0.55, -0.4], [0.46, 0.38], [0.2, 0.52], [-0.46, 0.4]],
      shard: [[-0.55, -0.36], [0.45, -0.5], [0.58, 0.38], [-0.32, 0.55]]
    };
    if (variant === "mortarium") {
      context.moveTo(...point(-0.58, -0.34));
      context.quadraticCurveTo(...point(-0.05, -0.52), ...point(0.48, -0.34));
      context.lineTo(...point(0.57, -0.12));
      context.quadraticCurveTo(...point(0.3, 0.46), ...point(-0.4, 0.43));
      context.lineTo(...point(-0.56, 0.06));
      context.closePath();
      return;
    }
    const vertices = polygons[variant] || polygons.shard;
    vertices.forEach(([x, y], index) => {
      if (index === 0) context.moveTo(...point(x, y));
      else context.lineTo(...point(x, y));
    });
    context.closePath();
  }

  drawArtefactDetails(artefact, size, face = "front", collected = false) {
    const variant = artefact.variantId || artefact.shape;
    const detail = collected ? "#39694b" : "rgba(54, 40, 31, 0.72)";
    stroke(detail);
    strokeWeight(Math.max(0.8, size * 0.045));
    strokeCap(ROUND);
    strokeJoin(ROUND);
    noFill();

    if (artefact.shape === "bead") {
      fill(collected ? "#39694b" : "#fff2bd");
      noStroke();
      circle(0, 0, size * 0.28);
      return;
    }
    if (artefact.shape === "arrowhead") {
      line(0, -size * 0.46, 0, size * 0.4);
      return;
    }
    if (artefact.shape === "coin") {
      circle(0, 0, size * 0.72);
      if (face === "front") {
        ellipse(-size * 0.06, -size * 0.08, size * 0.22, size * 0.3);
        line(size * 0.02, size * 0.05, size * 0.18, size * 0.23);
        if (variant === "victorinus-radiate") {
          for (let index = 0; index < 5; index += 1) {
            const angle = -Math.PI * 0.85 + index * Math.PI * 0.2;
            line(
              -size * 0.08 + Math.cos(angle) * size * 0.16,
              -size * 0.18 + Math.sin(angle) * size * 0.16,
              -size * 0.08 + Math.cos(angle) * size * 0.26,
              -size * 0.18 + Math.sin(angle) * size * 0.26
            );
          }
        }
      } else if (variant === "augustus-as") {
        noStroke();
        fill(detail);
        textAlign(CENTER, CENTER);
        textStyle(BOLD);
        textSize(Math.max(5, size * 0.2));
        text("SC", 0, 1);
        textStyle(NORMAL);
      } else if (variant === "hadrian-denarius") {
        line(-size * 0.2, size * 0.22, size * 0.22, size * 0.22);
        line(-size * 0.04, -size * 0.22, -size * 0.04, size * 0.18);
        circle(-size * 0.04, -size * 0.25, size * 0.1);
      } else if (variant === "victorinus-radiate") {
        line(-size * 0.08, -size * 0.25, -size * 0.08, size * 0.22);
        rect(size * 0.08, size * 0.08, size * 0.18, size * 0.16, 1);
      } else {
        line(-size * 0.16, size * 0.28, -size * 0.02, -size * 0.26);
        line(-size * 0.02, -size * 0.26, size * 0.16, size * 0.2);
        circle(size * 0.18, -size * 0.02, size * 0.13);
      }
      return;
    }

    if (face === "back") {
      line(-size * 0.32, -size * 0.16, size * 0.3, -size * 0.04);
      line(-size * 0.28, size * 0.13, size * 0.24, size * 0.22);
      return;
    }
    if (variant === "folded-beaker") {
      [-0.2, 0.04, 0.27].forEach((x) => line(x * size, -size * 0.3, (x - 0.07) * size, size * 0.35));
    } else if (variant === "mortarium") {
      line(-size * 0.45, -size * 0.25, size * 0.45, -size * 0.25);
      for (let index = 0; index < 7; index += 1) point((-0.3 + index * 0.1) * size, (0.04 + (index % 2) * 0.13) * size);
    } else if (variant === "decorated-samian") {
      for (let index = -1; index <= 1; index += 1) arc(index * size * 0.22, 0, size * 0.28, size * 0.34, Math.PI, Math.PI * 2);
      line(-size * 0.38, -size * 0.24, size * 0.36, -size * 0.24);
    } else if (variant === "storage-jar") {
      for (let index = -2; index <= 2; index += 1) line(-size * 0.34, index * size * 0.12, size * 0.33, (index + 0.65) * size * 0.12);
    } else if (variant === "verulamium-flagon") {
      line(-size * 0.32, -size * 0.37, size * 0.34, -size * 0.37);
      arc(size * 0.25, -size * 0.05, size * 0.25, size * 0.38, -Math.PI / 2, Math.PI / 2);
    } else if (variant === "dark-cooking-pot") {
      line(-size * 0.45, -size * 0.28, size * 0.45, -size * 0.28);
      line(-size * 0.34, -size * 0.16, size * 0.37, -size * 0.16);
    }
  }

  drawArtefactDirt(artefact, size, face) {
    const spots = artefact.cleaning?.faces?.[face] || [];
    if (!spots.length) return;
    const context = drawingContext;
    context.save();
    this.traceArtefactPath(artefact, size, context);
    context.clip();
    spots.forEach((spot, index) => {
      const remaining = Number.isFinite(spot.remaining) ? spot.remaining : (spot.removed ? 0 : 1);
      if (remaining <= 0) return;
      const baseAlpha = index % 3 === 0 ? 0.86 : 0.78;
      const channels = index % 3 === 0 ? "72, 52, 34" : "108, 78, 48";
      context.fillStyle = `rgba(${channels}, ${baseAlpha * (0.3 + remaining * 0.7)})`;
      context.beginPath();
      context.arc(spot.x * size, spot.y * size, Math.max(1.2, spot.size * size * (0.65 + remaining * 0.35)), 0, Math.PI * 2);
      context.fill();
    });
    context.restore();
  }

  drawArtefactDampness(artefact, size) {
    const context = drawingContext;
    context.save();
    this.traceArtefactPath(artefact, size, context);
    context.clip();
    context.fillStyle = "rgba(69, 151, 176, 0.18)";
    context.fillRect(-size * 0.65, -size * 0.65, size * 1.3, size * 1.3);
    context.strokeStyle = "rgba(229, 249, 250, 0.58)";
    context.lineWidth = Math.max(1, size * 0.025);
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(-size * 0.28, -size * 0.3);
    context.quadraticCurveTo(-size * 0.03, -size * 0.43, size * 0.22, -size * 0.24);
    context.stroke();
    context.beginPath();
    context.moveTo(size * 0.12, -size * 0.09);
    context.quadraticCurveTo(size * 0.28, -size * 0.02, size * 0.31, size * 0.13);
    context.stroke();
    context.restore();
  }

  artefact(artefact, x, y, size, options = {}) {
    const collected = Boolean(options.collected);
    const partial = Boolean(options.partial);
    const face = options.face || artefact.cleaning?.activeFace || "front";
    push();
    translate(x, y);
    const context = drawingContext;
    if (partial) {
      const requested = Array.isArray(options.visibleQuadrants) ? options.visibleQuadrants : [0];
      const visibleQuadrants = requested.length ? requested : [0];
      const extent = size * 0.64;
      const overlap = Math.max(0.7, size * 0.012);
      context.save();
      context.beginPath();
      visibleQuadrants.forEach((quadrant) => {
        const column = quadrant % 2;
        const row = Math.floor(quadrant / 2);
        context.rect(
          -extent + column * extent - overlap,
          -extent + row * extent - overlap,
          extent + overlap * 2,
          extent + overlap * 2
        );
      });
      context.clip();
    }
    this.traceArtefactPath(artefact, size, context);
    context.fillStyle = collected ? "#d9e8d1" : artefact.colour;
    context.strokeStyle = collected ? "#39694b" : "#453024";
    context.lineWidth = Math.max(1, size * (collected ? 0.075 : 0.09));
    context.lineJoin = "round";
    context.fill();
    context.stroke();
    this.drawArtefactDetails(artefact, size, face, collected);
    if (options.dampened) this.drawArtefactDampness(artefact, size);
    if (options.showDirt) this.drawArtefactDirt(artefact, size, face);
    if (partial) context.restore();
    pop();
  }

  artefactOutline(artefact, x, y, size, options = {}) {
    const context = drawingContext;
    context.save();
    context.translate(x, y);
    this.traceArtefactPath(artefact, size, context);
    context.setLineDash(options.dash || [Math.max(3, size * 0.07), Math.max(2, size * 0.045)]);
    context.strokeStyle = options.colour || "rgba(238, 245, 224, 0.82)";
    context.lineWidth = options.lineWidth || Math.max(1.2, size * 0.028);
    context.lineJoin = "round";
    context.stroke();
    context.setLineDash([]);
    context.restore();
  }

  artefactShape(shape, x, y, size, colour, collected = false, partial = false) {
    this.artefact({ shape, variantId: shape, colour }, x, y, size, { collected, partial });
  }
};
