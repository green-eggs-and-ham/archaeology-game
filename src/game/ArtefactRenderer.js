(function registerArtefactRenderer(root) {
  const POTTERY_BACK = "pottery-back";

  const VISUALS = Object.freeze({
    "folded-beaker": { silhouette: "folded-beaker", front: "folded-beaker", back: POTTERY_BACK },
    mortarium: { silhouette: "mortarium", front: "mortarium", back: POTTERY_BACK },
    "decorated-samian": { silhouette: "decorated-samian", front: "decorated-samian", back: POTTERY_BACK },
    "storage-jar": { silhouette: "storage-jar", front: "storage-jar", back: POTTERY_BACK },
    "verulamium-flagon": { silhouette: "verulamium-flagon", front: "verulamium-flagon", back: POTTERY_BACK },
    "dark-cooking-pot": { silhouette: "dark-cooking-pot", front: "dark-cooking-pot", back: POTTERY_BACK },
    "augustus-as": { silhouette: "coin", front: "coin-portrait", back: "augustus-as" },
    "hadrian-denarius": { silhouette: "coin", front: "coin-portrait", back: "hadrian-denarius" },
    "victorinus-radiate": { silhouette: "coin", front: "victorinus-front", back: "victorinus-back" },
    "constantine-nummus": { silhouette: "coin", front: "coin-portrait", back: "constantine-nummus" },
    "glass-bead": { silhouette: "bead", front: "bead", back: "bead" },
    arrowhead: { silhouette: "arrowhead", front: "arrowhead", back: "arrowhead" },
    coin: { silhouette: "coin", front: "coin-portrait", back: "constantine-nummus" },
    bead: { silhouette: "bead", front: "bead", back: "bead" },
    pottery: { silhouette: "generic-shard", front: "generic-front", back: POTTERY_BACK },
    "generic-shard": { silhouette: "generic-shard", front: "generic-front", back: POTTERY_BACK }
  });

  const POLYGONS = Object.freeze({
    "folded-beaker": [[-0.54, -0.34], [0.3, -0.5], [0.53, -0.2], [0.44, 0.46], [-0.36, 0.54], [-0.58, 0.08]],
    "decorated-samian": [[-0.5, -0.42], [0.34, -0.54], [0.55, -0.12], [0.4, 0.5], [-0.44, 0.43], [-0.57, -0.02]],
    "storage-jar": [[-0.5, -0.48], [0.45, -0.42], [0.56, 0.08], [0.3, 0.52], [-0.48, 0.4], [-0.58, -0.05]],
    "verulamium-flagon": [[-0.42, -0.54], [0.4, -0.54], [0.3, -0.22], [0.5, 0.46], [-0.43, 0.5], [-0.28, -0.2]],
    "dark-cooking-pot": [[-0.56, -0.4], [0.55, -0.4], [0.46, 0.38], [0.2, 0.52], [-0.46, 0.4]],
    "generic-shard": [[-0.55, -0.36], [0.45, -0.5], [0.58, 0.38], [-0.32, 0.55]]
  });

  class ArtefactRenderer {
    static visualKeys() {
      return Object.keys(VISUALS);
    }

    static visualRegistry() {
      return Object.fromEntries(Object.entries(VISUALS).map(([key, value]) => [key, { ...value }]));
    }

    static hasRenderableFaces(visualKey) {
      const visual = VISUALS[visualKey];
      return Boolean(visual?.silhouette && visual.front && visual.back);
    }

    visualFor(artefact) {
      const requested = artefact?.visualKey || artefact?.variantId || artefact?.shape || "generic-shard";
      if (VISUALS[requested]) return VISUALS[requested];

      if (artefact?.visualKey) {
        throw new Error(`Unknown artefact visual key: ${artefact.visualKey}`);
      }

      // Shape fallback exists only for legacy runtime records and small drawing
      // fixtures. Modern catalogue entries are validated against visualKey.
      if (!artefact?.visualKey && VISUALS[artefact?.shape]) return VISUALS[artefact.shape];
      return VISUALS["generic-shard"];
    }

    tracePath(artefact, size, context = drawingContext) {
      const visual = this.visualFor(artefact);
      const pointAt = (x, y) => [x * size, y * size];
      context.beginPath();
      if (visual.silhouette === "coin" || visual.silhouette === "bead") {
        context.arc(0, 0, size * 0.5, 0, Math.PI * 2);
        context.closePath();
        return;
      }
      if (visual.silhouette === "arrowhead") {
        context.moveTo(...pointAt(0, -0.62));
        context.lineTo(...pointAt(0.5, 0.55));
        context.lineTo(...pointAt(-0.5, 0.55));
        context.closePath();
        return;
      }
      if (visual.silhouette === "mortarium") {
        context.moveTo(...pointAt(-0.58, -0.34));
        context.quadraticCurveTo(...pointAt(-0.05, -0.52), ...pointAt(0.48, -0.34));
        context.lineTo(...pointAt(0.57, -0.12));
        context.quadraticCurveTo(...pointAt(0.3, 0.46), ...pointAt(-0.4, 0.43));
        context.lineTo(...pointAt(-0.56, 0.06));
        context.closePath();
        return;
      }
      const vertices = POLYGONS[visual.silhouette] || POLYGONS["generic-shard"];
      vertices.forEach(([x, y], index) => {
        if (index === 0) context.moveTo(...pointAt(x, y));
        else context.lineTo(...pointAt(x, y));
      });
      context.closePath();
    }

    drawDetails(artefact, size, face = "front", collected = false) {
      const visual = this.visualFor(artefact);
      const detailKey = face === "front" ? visual.front : visual.back;
      const detail = collected ? "#39694b" : "rgba(54, 40, 31, 0.72)";
      stroke(detail);
      strokeWeight(Math.max(0.8, size * 0.045));
      strokeCap(ROUND);
      strokeJoin(ROUND);
      noFill();

      if (detailKey === "bead") {
        fill(collected ? "#39694b" : "#fff2bd");
        noStroke();
        circle(0, 0, size * 0.28);
        return;
      }
      if (detailKey === "arrowhead") {
        line(0, -size * 0.46, 0, size * 0.4);
        return;
      }
      if (detailKey === "coin-portrait" || detailKey === "victorinus-front") {
        circle(0, 0, size * 0.72);
        ellipse(-size * 0.06, -size * 0.08, size * 0.22, size * 0.3);
        line(size * 0.02, size * 0.05, size * 0.18, size * 0.23);
        if (detailKey === "victorinus-front") {
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
        return;
      }
      if (detailKey === "augustus-as") {
        circle(0, 0, size * 0.72);
        noStroke();
        fill(detail);
        textAlign(CENTER, CENTER);
        textStyle(BOLD);
        textSize(Math.max(5, size * 0.2));
        text("SC", 0, 1);
        textStyle(NORMAL);
        return;
      }
      if (detailKey === "hadrian-denarius") {
        circle(0, 0, size * 0.72);
        line(-size * 0.2, size * 0.22, size * 0.22, size * 0.22);
        line(-size * 0.04, -size * 0.22, -size * 0.04, size * 0.18);
        circle(-size * 0.04, -size * 0.25, size * 0.1);
        return;
      }
      if (detailKey === "victorinus-back") {
        circle(0, 0, size * 0.72);
        line(-size * 0.08, -size * 0.25, -size * 0.08, size * 0.22);
        rect(size * 0.08, size * 0.08, size * 0.18, size * 0.16, 1);
        return;
      }
      if (detailKey === "constantine-nummus") {
        circle(0, 0, size * 0.72);
        line(-size * 0.16, size * 0.28, -size * 0.02, -size * 0.26);
        line(-size * 0.02, -size * 0.26, size * 0.16, size * 0.2);
        circle(size * 0.18, -size * 0.02, size * 0.13);
        return;
      }
      if (detailKey === POTTERY_BACK) {
        line(-size * 0.32, -size * 0.16, size * 0.3, -size * 0.04);
        line(-size * 0.28, size * 0.13, size * 0.24, size * 0.22);
        return;
      }
      if (detailKey === "folded-beaker") {
        [-0.2, 0.04, 0.27].forEach((x) => line(x * size, -size * 0.3, (x - 0.07) * size, size * 0.35));
      } else if (detailKey === "mortarium") {
        line(-size * 0.45, -size * 0.25, size * 0.45, -size * 0.25);
        for (let index = 0; index < 7; index += 1) point((-0.3 + index * 0.1) * size, (0.04 + (index % 2) * 0.13) * size);
      } else if (detailKey === "decorated-samian") {
        for (let index = -1; index <= 1; index += 1) arc(index * size * 0.22, 0, size * 0.28, size * 0.34, Math.PI, Math.PI * 2);
        line(-size * 0.38, -size * 0.24, size * 0.36, -size * 0.24);
      } else if (detailKey === "storage-jar") {
        for (let index = -2; index <= 2; index += 1) line(-size * 0.34, index * size * 0.12, size * 0.33, (index + 0.65) * size * 0.12);
      } else if (detailKey === "verulamium-flagon") {
        line(-size * 0.32, -size * 0.37, size * 0.34, -size * 0.37);
        arc(size * 0.25, -size * 0.05, size * 0.25, size * 0.38, -Math.PI / 2, Math.PI / 2);
      } else if (detailKey === "dark-cooking-pot") {
        line(-size * 0.45, -size * 0.28, size * 0.45, -size * 0.28);
        line(-size * 0.34, -size * 0.16, size * 0.37, -size * 0.16);
      }
    }

    drawDirt(artefact, size, face) {
      const spots = artefact.cleaning?.faces?.[face] || [];
      if (!spots.length) return;
      const context = drawingContext;
      context.save();
      this.tracePath(artefact, size, context);
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

    drawDampness(artefact, size) {
      const context = drawingContext;
      context.save();
      this.tracePath(artefact, size, context);
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

    draw(artefact, x, y, size, options = {}) {
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
      this.tracePath(artefact, size, context);
      context.fillStyle = collected ? "#d9e8d1" : artefact.colour;
      context.strokeStyle = collected ? "#39694b" : "#453024";
      context.lineWidth = Math.max(1, size * (collected ? 0.075 : 0.09));
      context.lineJoin = "round";
      context.fill();
      context.stroke();
      this.drawDetails(artefact, size, face, collected);
      if (options.dampened) this.drawDampness(artefact, size);
      if (options.showDirt) this.drawDirt(artefact, size, face);
      if (partial) context.restore();
      pop();
    }

    outline(artefact, x, y, size, options = {}) {
      const context = drawingContext;
      context.save();
      context.translate(x, y);
      this.tracePath(artefact, size, context);
      context.setLineDash(options.dash || [Math.max(3, size * 0.07), Math.max(2, size * 0.045)]);
      context.strokeStyle = options.colour || "rgba(238, 245, 224, 0.82)";
      context.lineWidth = options.lineWidth || Math.max(1.2, size * 0.028);
      context.lineJoin = "round";
      context.stroke();
      context.setLineDash([]);
      context.restore();
    }
  }

  root.ArtefactRenderer = ArtefactRenderer;
})(typeof window !== "undefined" ? window : globalThis);
