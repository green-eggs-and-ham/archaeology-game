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

  button(bounds, label, selected = false, compact = false) {
    const { x, y, width: buttonWidth, height: buttonHeight } = bounds;
    stroke(selected ? "#f4b942" : "#2d5965");
    strokeWeight(selected ? 3 : 1);
    fill(selected ? "#285d62" : "#183c48");
    rect(x, y, buttonWidth, buttonHeight, 8);
    noStroke();
    fill("#fff9e9");
    textAlign(CENTER, CENTER);
    textStyle(BOLD);
    const heightLimitedSize = Math.min(15, buttonHeight * 0.37);
    const widthLimitedSize = compact ? buttonWidth / Math.max(7, label.length * 0.62) : heightLimitedSize;
    textSize(Math.max(compact ? 7 : 10, Math.min(heightLimitedSize, widthLimitedSize)));
    text(label, x + buttonWidth / 2, y + buttonHeight / 2 + 1);
    textStyle(NORMAL);
  }

  artefactShape(shape, x, y, size, colour, collected = false, partial = false) {
    push();
    translate(x, y);
    if (partial) {
      drawingContext.save();
      drawingContext.beginPath();
      drawingContext.rect(-size * 0.52, -size * 0.56, size * 0.48, size * 1.12);
      drawingContext.clip();
    }
    stroke("#453024");
    strokeWeight(Math.max(1, size * 0.1));
    fill(colour);
    if (collected) {
      fill("#d9e8d1");
      stroke("#39694b");
    }
    if (shape === "bead") {
      circle(0, 0, size);
      fill(collected ? "#39694b" : "#fff2bd");
      noStroke();
      circle(0, 0, size * 0.28);
    } else if (shape === "arrowhead") {
      triangle(0, -size * 0.62, size * 0.5, size * 0.55, -size * 0.5, size * 0.55);
    } else if (shape === "coin") {
      circle(0, 0, size);
      noFill();
      stroke(collected ? "#39694b" : "#7b5a21");
      circle(0, 0, size * 0.55);
    } else {
      beginShape();
      vertex(-size * 0.55, -size * 0.36);
      vertex(size * 0.45, -size * 0.5);
      vertex(size * 0.58, size * 0.38);
      vertex(-size * 0.32, size * 0.55);
      endShape(CLOSE);
    }
    if (partial) drawingContext.restore();
    pop();
  }
};
