# Archaeology Game

A lightweight p5.js archaeology game proof of concept, designed to be embedded in a webpage or served locally.

## Structure

- `index.html` — main page shell and p5.js entry
- `styles.css` — page styling for the embedded game
- `src/` — game logic split into modules
  - `main.js` — responsive p5 canvas lifecycle and pointer forwarding
  - `game/` — trench and cleaning models, rendering helpers, and scene management
- `assets/` — image and sound assets
- `data/` — JSON or other game data files

## Run locally

Open `index.html` in a browser, or serve the folder with a simple static server such as:

```bash
cd archaeology-game
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Development notes

- The game uses event-driven redraws (`noLoop`) and placeholder shapes/colours, so it stays lightweight on mobile browsers.
- Mouse and touch input share the same interaction flow: brush soil with cumulative back-and-forth movement or drag shovel-loads anywhere outside the trench.
- Each trench has gently varying, mostly continuous sediment bands over unremovable bedrock; the profile only reveals the excavated cross-section and its relative depth levels.
- The profile key reveals visual layer swatches as they are encountered, and narrow portrait screens use a stacked trench-and-profile layout.
- Trenches use a 20×20 logical grid with 2×2 artefact footprints; opaque terrain coverage, shared depth boundaries, and low-side shading keep excavation depth readable without rendering gaps.
- The temporary trench diagnostics include **Depths** plus a **Performance: Full/Lite** switch. Full keeps curved terrain and clipped AO; Lite uses cached rectangular cells and inexpensive cardinal-edge shading for lower-end hardware.
- Game state lasts until a browser refresh; each map trench keeps its progress while navigating the site map.
- The **Finds lab** aggregates collected finds from every trench. Use the Hand tool to move finds, dunk either face repeatedly for slow brushless washing, or place a wet find on the mat and scrub it with a safe care-profile tool. Toothbrushes clean robust finds fastest, while fragile and delicate finds require the fine paintbrush; both faces must be clean before a find returns to inventory.
- Cleaning progress is session-only and survives scene changes and resizing. Beads and arrowheads remain visible in the lab but are intentionally unavailable for cleaning in this prototype.
- Pottery and coin variants use provisional canvas geometry rather than final artwork. Identification, drying, chemical treatment, polishing, and waxing are outside this prototype; the two specialist-treatment coins are marked for later work after washing.
