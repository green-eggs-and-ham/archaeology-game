# Archaeology Game

A lightweight p5.js archaeology game proof of concept, designed to be embedded in a webpage or served locally.

## Structure

- `index.html` — main page shell and p5.js entry
- `styles.css` — page styling for the embedded game
- `src/` — game logic split into modules
  - `main.js` — responsive p5 canvas lifecycle and pointer forwarding
  - `game/` — domain models, catalogue validation, rendering helpers, terrain pipeline, and scene coordination
  - `scenes/` — scene-specific layout, drawing, and pointer behavior
- `assets/` — image and sound assets
- `data/game-config.js` — authoritative gameplay, presentation, and artefact catalogue configuration

See [Architecture](docs/architecture.md) for module responsibilities and [Adding an artefact](docs/adding-an-artefact.md) for the catalogue extension workflow.

## Run locally

Open `index.html` in a browser, or serve the folder with a simple static server such as:

```bash
cd archaeology-game
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Checks

The project has no package dependencies. With Node.js installed, run:

```bash
npm run check
```

Focused `test:models`, `test:scenes`, and `test:terrain` scripts are also available.

## Development notes

- The game uses event-driven redraws (`noLoop`) and placeholder shapes/colours, so it stays lightweight on mobile browsers.
- Mouse and touch input share the same interaction flow: brush soil with cumulative back-and-forth movement, drag shovel-loads outside the trench, or flick a load aside with a quick swipe. Mouse users also get simple glove and tool cursors drawn by the game.
- Each trench has gently varying, mostly continuous sediment bands over unremovable bedrock; the profile only reveals the excavated cross-section and its relative depth levels.
- The profile key reveals visual layer swatches as they are encountered, and narrow portrait screens use a stacked trench-and-profile layout.
- Trenches use a 20×20 logical grid with 2×2 artefact footprints. Deterministic bare, half-covered, and fully grassed surface variants sit over the unchanged geology, while emerging finds reveal the quadrants matching their excavated footprint cells.
- Opaque terrain coverage, shared depth boundaries, and low-side shading keep excavation depth readable without rendering gaps. Reusable terrain/AO canvases and bounded effect collections prevent repeated excavation and cleaning effects from growing memory indefinitely.
- The temporary trench diagnostics include **Depths** plus a **Performance: Full/Lite** switch. Full keeps curved terrain and clipped AO, rendering it in a background worker where supported while the previous compatible terrain remains visible; Lite uses cached rectangular cells and inexpensive cardinal-edge shading for lower-end hardware.
- Game state lasts until a browser refresh; each map trench keeps its progress while navigating the site map.
- The **Finds lab** aggregates collected finds from every trench. Use the Hand tool to move finds, dunk repeatedly for slow brushless washing of both faces, or place a wet find on the mat and scrub it with a safe care-profile tool. Toothbrushes clean robust finds fastest, while fragile and delicate finds require the fine paintbrush; completed cleaning automatically returns control to the Hand.
- The global debug overlay contains temporary visual and performance comparisons, including the water presentation switch. Its default realistic view lets the bucket front hide the submerged portion while a dashed outline keeps the find's position legible.
- The page reserves the final canvas proportions immediately and reports boot progress, avoiding a late layout jump while the drawing library and game scripts load.
- Cleaning progress is session-only and survives scene changes and resizing. Beads and arrowheads remain visible in the lab but are intentionally unavailable for cleaning in this prototype.
- Pottery and coin variants use provisional canvas geometry rather than final artwork. Identification, drying, chemical treatment, polishing, and waxing are outside this prototype; the two specialist-treatment coins are marked for later work after washing.
