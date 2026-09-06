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
    noStroke();
    fill(disabled ? "#829495" : "#fff9e9");
    textAlign(CENTER, CENTER);
    textStyle(BOLD);
    const minimumSize = textOptions.minimumSize ?? (compact ? 7 : 10);
    const maximumSize = textOptions.maximumSize ?? 15;
    const heightLimitedSize = Math.min(maximumSize, buttonHeight * 0.37);
    const widthLimitedSize = compact ? buttonWidth / Math.max(7, label.length * 0.62) : heightLimitedSize;
    textSize(Math.max(minimumSize, Math.min(heightLimitedSize, widthLimitedSize)));
    text(label, x + buttonWidth / 2, y + buttonHeight / 2 + 1);
    textStyle(NORMAL);
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
      context.save();
      context.beginPath();
      context.rect(-size * 0.52, -size * 0.62, size * 0.5, size * 1.24);
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

  artefactShape(shape, x, y, size, colour, collected = false, partial = false) {
    this.artefact({ shape, variantId: shape, colour }, x, y, size, { collected, partial });
  }
};
