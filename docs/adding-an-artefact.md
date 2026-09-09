# Adding an artefact variant

Artefacts are data-driven, but every configured visual key must also have renderable geometry.

1. Add the variant to the appropriate category in `data/game-config.js`. Give it a unique `id` and `visualKey`, plus a player-facing `label`, `shape`, `colour`, `material`, and `cleanable` flag.
2. For a cleanable find, reference an existing `careProfile`. Add a profile only when the robustness, allowed tools, recommended tool, or post-cleaning treatment is genuinely different. `postCleaningTreatment` is the canonical specialist-work indicator; do not add a parallel boolean flag.
3. Register the `visualKey` in `src/game/ArtefactRenderer.js`. Reuse an existing silhouette where possible and provide distinct front and reverse detail keys. Add simple geometry for any new silhouette or face detail. If generic geometry is intentional, configure the existing generic visual key explicitly rather than relying on an unknown-key fallback.
4. Run `npm run check`. Configuration validation will reject duplicate identifiers, missing care metadata, unsupported tools or treatments, and visual keys with no registered renderer.
5. Check the variant in the trench, inventory, bucket, cleaning mat, and both face orientations at landscape and portrait sizes.

Category weights control how often a type of find appears. Variants within a category are selected uniformly, so adding one changes only that category's internal mix. Keep the provisional artwork as simple canvas geometry until final assets are in scope.
