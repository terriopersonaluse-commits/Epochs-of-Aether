# Epochs of Aether

Grand strategy game where you have AI intelligent enemies and allies.

A turn-based fantasy grand strategy game where every nation is run by its own AI that
plans, fights, settles land and sues for peace based on what it can actually see.

**Status:** Phase 1 (playable foundation). See [STATUS.md](STATUS.md) and
[docs/TECHNICAL_PLAN.md](docs/TECHNICAL_PLAN.md).

## Play

Open `dist/index.html` in any browser, or enable GitHub Pages (below) and play from
your phone. It is a single file with no server.

* **Tap** a province to inspect it. **Drag** to pan, **pinch** or scroll to zoom.
* **Tap your army banner**, then tap any province to march there.
* Recruit in the Province tab of a province you own. Regiments muster at the end of the turn.
* Declare war or propose peace from the Nations tab.
* Press **End turn**. The game autosaves every turn; the ☰ menu has save slots and save codes.

## Develop from a phone (GitHub only)

1. Create a repository and upload this folder (or push it with git).
2. In the repo: **Settings → Pages → Source: GitHub Actions**.
3. Every push to `main` type-checks, runs the tests, runs a 150-turn AI simulation on three
   worlds, builds the game and deploys it to `https://<you>.github.io/<repo>/`.
4. Edit files in the GitHub web editor (press `.` on the repo page for the full editor) or
   ask an AI assistant to make changes; the Actions tab shows whether everything still passes.

## Develop on a computer

Requires Node 22.18 or newer (runs TypeScript tests directly).

```bash
npm install
npm run check      # typecheck + tests + build
npm run sim -- --turns 200 --seeds 5   # headless AI-only campaigns with invariant checks
npm run build      # writes dist/index.html
```

## Layout

```
src/core        state types, seeded rng
src/data        terrain, units, civilisations, names
src/world       noise + world generator
src/sim         queries, validated orders, combat, diplomacy, turn processing
src/ai          StrategicPolicy interface + deterministic national AI
src/persistence versioned save format + browser storage
src/ui          canvas map, panels, input
tests           node:test suites (world, rules, saves)
scripts         build + headless simulator
```

Rules of the codebase: the simulation never touches the DOM; all randomness comes from
the rng stored in the game state; every player or AI action goes through `src/sim/orders.ts`,
which validates it against the real state.
