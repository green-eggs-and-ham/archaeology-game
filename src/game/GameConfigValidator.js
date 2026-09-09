window.GameConfigValidator = class GameConfigValidator {
  static resolveCareProfile(config, variant) {
    const profile = variant?.careProfile ? config?.careProfiles?.[variant.careProfile] : null;
    const recommendedTool = variant?.recommendedTool
      || variant?.cleaningTool
      || profile?.recommendedTool
      || profile?.cleaningTool
      || null;
    const configuredAllowedTools = variant?.allowedTools ?? profile?.allowedTools;
    const allowedTools = Array.isArray(configuredAllowedTools)
      ? configuredAllowedTools
      : configuredAllowedTools == null
        ? (recommendedTool === "toothbrush" ? ["toothbrush", "fine-brush"] : recommendedTool ? [recommendedTool] : [])
        : [];
    const postCleaningTreatment = variant?.postCleaningTreatment
      || profile?.postCleaningTreatment
      || null;

    return {
      robustness: variant?.robustness || profile?.robustness || null,
      recommendedTool,
      allowedTools: [...allowedTools],
      postCleaningTreatment
    };
  }

  static validate(config, options = {}) {
    const errors = [];
    const categories = config?.artefactCategories;
    const profiles = config?.careProfiles || {};
    const visualRegistry = options.visualRegistry || null;
    const knownVisualKeys = options.knownVisualKeys == null
      ? visualRegistry ? new Set(Object.keys(visualRegistry)) : null
      : new Set(options.knownVisualKeys);

    if (!config || typeof config !== "object") {
      throw new Error("Invalid game configuration:\n- Configuration must be an object.");
    }

    const trenchIds = new Set();
    (config.trenches || []).forEach((trench, index) => {
      const prefix = `Trench ${index + 1}`;
      if (!trench?.id) errors.push(`${prefix} requires an id.`);
      else if (trenchIds.has(trench.id)) errors.push(`Trench id "${trench.id}" is duplicated.`);
      else trenchIds.add(trench.id);
    });

    Object.entries(profiles).forEach(([profileId, profile]) => {
      const prefix = `Care profile \"${profileId}\"`;
      if (!profile || typeof profile !== "object") {
        errors.push(`${prefix} must be an object.`);
        return;
      }
      if (!profile.robustness) errors.push(`${prefix} requires robustness.`);
      if (!this.knownCleaningTools.has(profile.recommendedTool)) {
        errors.push(`${prefix} has an unknown recommended tool.`);
      }
      if (!Array.isArray(profile.allowedTools) || !profile.allowedTools.length) {
        errors.push(`${prefix} requires at least one allowed tool.`);
      } else {
        profile.allowedTools.forEach((tool) => {
          if (!this.knownCleaningTools.has(tool)) errors.push(`${prefix} allows unknown tool \"${tool}\".`);
        });
        if (profile.recommendedTool && !profile.allowedTools.includes(profile.recommendedTool)) {
          errors.push(`${prefix} must allow its recommended tool.`);
        }
      }
      if (!this.knownTreatments.has(profile.postCleaningTreatment)) {
        errors.push(`${prefix} has an unknown post-cleaning treatment.`);
      }
    });

    if (!Array.isArray(categories) || !categories.length) {
      if (!Array.isArray(config.artefactCatalog) || !config.artefactCatalog.length) {
        errors.push("At least one artefact category is required.");
      }
    } else {
      const categoryIds = new Set();
      const variantIds = new Set();
      let totalWeight = 0;

      categories.forEach((category, categoryIndex) => {
        const prefix = `Artefact category ${categoryIndex + 1}`;
        if (!category?.id) errors.push(`${prefix} requires an id.`);
        else if (categoryIds.has(category.id)) errors.push(`Artefact category id \"${category.id}\" is duplicated.`);
        else categoryIds.add(category.id);

        const weight = category?.weight == null ? 1 : Number(category.weight);
        if (!Number.isFinite(weight) || weight < 0) errors.push(`${prefix} must have a non-negative finite weight.`);
        else totalWeight += weight;

        if (!Array.isArray(category?.variants) || !category.variants.length) {
          errors.push(`${prefix} requires a non-empty variants array.`);
          return;
        }

        category.variants.forEach((variant, variantIndex) => {
          const variantPrefix = `Variant ${variantIndex + 1} in category \"${category.id || categoryIndex}\"`;
          if (!variant?.id) errors.push(`${variantPrefix} requires an id.`);
          else if (variantIds.has(variant.id)) errors.push(`Artefact variant id \"${variant.id}\" is duplicated.`);
          else variantIds.add(variant.id);

          ["label", "shape", "colour", "material", "visualKey"].forEach((field) => {
            if (!variant?.[field]) errors.push(`${variantPrefix} requires ${field}.`);
          });
          if (variant?.visualKey && knownVisualKeys && !knownVisualKeys.has(variant.visualKey)) {
            errors.push(`${variantPrefix} references unknown visual key \"${variant.visualKey}\".`);
          } else if (variant?.visualKey && visualRegistry) {
            const visual = visualRegistry[variant.visualKey];
            if (!visual?.silhouette || !visual.front || !visual.back) {
              errors.push(`${variantPrefix} requires renderable silhouette, front, and reverse geometry.`);
            }
          }

          if (!variant?.cleanable) return;
          if (variant.careProfile && !profiles[variant.careProfile]) {
            errors.push(`${variantPrefix} references unknown care profile \"${variant.careProfile}\".`);
          }
          const care = this.resolveCareProfile(config, variant);
          if (!care.robustness) errors.push(`${variantPrefix} requires a robustness value.`);
          if (!this.knownCleaningTools.has(care.recommendedTool)) {
            errors.push(`${variantPrefix} has an unknown recommended cleaning tool.`);
          }
          if (!care.allowedTools.length) errors.push(`${variantPrefix} requires at least one allowed cleaning tool.`);
          care.allowedTools.forEach((tool) => {
            if (!this.knownCleaningTools.has(tool)) errors.push(`${variantPrefix} allows unknown tool \"${tool}\".`);
          });
          if (care.recommendedTool && !care.allowedTools.includes(care.recommendedTool)) {
            errors.push(`${variantPrefix} must allow its recommended cleaning tool.`);
          }
          if (!this.knownTreatments.has(care.postCleaningTreatment)) {
            errors.push(`${variantPrefix} has an unknown post-cleaning treatment.`);
          }
        });
      });

      if (!(totalWeight > 0)) errors.push("Artefact category weights must contain at least one positive value.");
    }

    if (errors.length) throw new Error(`Invalid game configuration:\n- ${errors.join("\n- ")}`);
    return config;
  }
};

// Assign these after the class declaration to retain compatibility with older
// classic-script WebKit releases that predate public static class fields.
window.GameConfigValidator.knownCleaningTools = new Set(["toothbrush", "fine-brush"]);
window.GameConfigValidator.knownTreatments = new Set(["identification", "specialist-treatment"]);
