window.ArtefactCatalogue = class ArtefactCatalogue {
  constructor(config, options = {}) {
    this.config = config;
    window.GameConfigValidator?.validate(config, options);
  }

  categories() {
    if (Array.isArray(this.config.artefactCategories) && this.config.artefactCategories.length) {
      return this.config.artefactCategories;
    }
    return (this.config.artefactCatalog || []).map((item, index) => ({
      id: item.category || item.shape || `category-${index}`,
      weight: 1,
      variants: [item]
    }));
  }

  categoryWeight(category) {
    if (category?.weight == null) return 1;
    const weight = Number(category.weight);
    return Number.isFinite(weight) ? Math.max(0, weight) : 0;
  }

  chooseVariant(random) {
    const categories = this.categories().filter((category) =>
      this.categoryWeight(category) > 0 && Array.isArray(category.variants) && category.variants.length
    );
    const totalWeight = categories.reduce((sum, category) => sum + this.categoryWeight(category), 0);
    if (!categories.length || !(totalWeight > 0)) return { category: null, item: null };

    let choice = random() * totalWeight;
    let selectedCategory = categories[categories.length - 1];
    for (const category of categories) {
      choice -= this.categoryWeight(category);
      if (choice <= 0) {
        selectedCategory = category;
        break;
      }
    }

    const variants = selectedCategory.variants;
    const item = variants[Math.min(variants.length - 1, Math.floor(random() * variants.length))];
    return { category: selectedCategory, item };
  }

  resolveVariant(item, category = null) {
    if (!item) return null;
    const care = window.GameConfigValidator?.resolveCareProfile(this.config, item) || {
      robustness: item.robustness || null,
      recommendedTool: item.cleaningTool || item.recommendedTool || null,
      allowedTools: item.allowedTools || [],
      postCleaningTreatment: item.postCleaningTreatment || null
    };
    const variantId = item.id || item.variantId || item.shape;
    const postCleaningTreatment = care.postCleaningTreatment || null;
    return {
      label: item.label,
      shape: item.shape,
      colour: item.colour,
      category: item.category || category?.id || item.shape,
      variantId,
      visualKey: item.visualKey || variantId,
      material: item.material || item.label,
      robustness: care.robustness || null,
      cleaningTool: care.recommendedTool || null,
      allowedTools: [...(care.allowedTools || [])],
      postCleaningTreatment,
      cleanable: Boolean(item.cleanable)
    };
  }

  variantById(id) {
    for (const category of this.categories()) {
      const item = category.variants?.find((variant) => variant.id === id || variant.variantId === id);
      if (item) return this.resolveVariant(item, category);
    }
    return null;
  }

  createFootprint(x, y, size) {
    const footprint = [];
    for (let offsetY = 0; offsetY < size; offsetY += 1) {
      for (let offsetX = 0; offsetX < size; offsetX += 1) footprint.push({ x: x + offsetX, y: y + offsetY });
    }
    return footprint;
  }

  footprintsOverlap(first, second) {
    return first.some((cell) => second.some((other) => cell.x === other.x && cell.y === other.y));
  }

  createForTrench(options) {
    const {
      trenchId,
      columns,
      rows,
      maxDepth,
      depthResolutionScale,
      footprintSize,
      countMultiplier,
      random
    } = options;
    const artefacts = [];
    const baseCount = 2 + Math.floor(random() * 2);
    const count = baseCount * countMultiplier;
    const maxX = columns - footprintSize - 1;
    const maxY = rows - footprintSize - 1;
    const referenceMaxDepth = Math.max(4, Math.round(maxDepth / depthResolutionScale));
    const placementAttempts = Math.max(80, columns * rows);

    for (let index = 0; index < count; index += 1) {
      let x = 1;
      let y = 1;
      let footprint = this.createFootprint(x, y, footprintSize);
      let attempts = 0;
      let placementFound = false;
      do {
        x = 1 + Math.floor(random() * maxX);
        y = 1 + Math.floor(random() * maxY);
        footprint = this.createFootprint(x, y, footprintSize);
        attempts += 1;
        placementFound = !artefacts.some((artefact) => this.footprintsOverlap(footprint, artefact.footprint));
      } while (attempts < placementAttempts && !placementFound);

      if (!placementFound) {
        for (let candidateY = 1; candidateY <= maxY && !placementFound; candidateY += 1) {
          for (let candidateX = 1; candidateX <= maxX; candidateX += 1) {
            const candidate = this.createFootprint(candidateX, candidateY, footprintSize);
            if (artefacts.some((artefact) => this.footprintsOverlap(candidate, artefact.footprint))) continue;
            x = candidateX;
            y = candidateY;
            footprint = candidate;
            placementFound = true;
            break;
          }
        }
      }
      if (!placementFound) break;

      const selection = this.chooseVariant(random);
      const variant = this.resolveVariant(selection.item, selection.category);
      if (!variant) continue;
      const referenceDepth = 2 + Math.floor(random() * (referenceMaxDepth - 3));
      artefacts.push({
        id: `${trenchId}-artefact-${index}`,
        ...variant,
        cleaning: variant.cleanable ? {
          status: "dirty",
          location: "inventory",
          activeFace: "front",
          faces: null
        } : null,
        x,
        y,
        centerX: x + (footprintSize - 1) / 2,
        centerY: y + (footprintSize - 1) / 2,
        footprint,
        depth: referenceDepth * depthResolutionScale,
        exposure: "hidden"
      });
    }
    return artefacts;
  }
};
