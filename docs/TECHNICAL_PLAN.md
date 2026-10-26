# Epochs of Aether — Technical Plan

## 1. Architecture

```
┌──────────────┐   orders    ┌─────────────────────────────┐
│  UI (canvas  │ ──────────▶ │  Simulation engine (pure TS) │◀── national AI (policy)
│  map + DOM   │ ◀────────── │  owns the authoritative      │     proposes orders, never
│  panels)     │  read-only  │  GameState                   │     mutates state directly
└──────────────┘    state    └──────────┬──────────────────┘
                                         │ JSON (versioned, validated)
                                         ▼
                                  persistence layer
```

* **Simulation core** (`src/sim`, `src/world`, `src/data`) is plain TypeScript with no DOM access.
  It runs identically in the browser, in Node tests and in the headless balance simulator.
* **All randomness** goes through one seeded generator whose state lives inside `GameState`,
  so a save + the same orders reproduces the same turn exactly.
* **Orders are validated** by the engine (`src/sim/orders.ts`). The UI and the AI both go
  through the same functions, so the AI cannot recruit without gold, walk into neutral land,
  or use units it lacks. A rejected order returns a reason string instead of mutating state.
* **National AI** (`src/ai`) implements a `StrategicPolicy` interface. Phase 1 ships a
  deterministic policy. A language-model policy (Phase 3) will plug into the same interface
  and its proposals will pass through the same validators.

## 2. Engine and technology

**Browser game, TypeScript, HTML canvas, no framework, no runtime dependencies.**

* Playable on the Galaxy phone and any desktop browser; nothing to install.
* GitHub Actions builds, tests and deploys to GitHub Pages, so the whole loop works from a phone.
* Dev dependencies: only `typescript` (type checking) and `esbuild` (bundling to one HTML file).
* Tests use Node's built-in test runner, which runs `.ts` files directly (Node ≥ 22.18).
* Trade-off: a native engine (Godot, Unity) would give richer rendering, but needs a desktop
  editor. Grand strategy is data- and UI-heavy, not graphics-heavy, so the browser is the better fit.
  An Android APK wrapper (Capacitor/TWA) can be added later without touching the core.

## 3. Core game-state model (`src/core/types.ts`)

* `GameState` — version, seed, rng state, turn, settings, map, provinces, countries, armies,
  recruitment queue, wars, truces, pending peace offers, event log.
* `WorldMap` — tile grid (terrain id + province id per tile).
* `Province` — terrain, deposit, population, owner, fort level, siege progress, neighbours, straits.
* `Country` — civilisation, personality, treasury (gold/food/iron), manpower, war exhaustion, capital.
* `Army` — owner, location, regiment counts per unit type, morale, planned path.
* `War` — participants, start turn, war score per side, battle count.
* `HistoryEvent` — turn, type, participants, text, visibility (`public` or the involved countries).
  This is the seed of the Phase 3 national memory system.

## 4. AI integration strategy

| Layer | Phase 1 | Later |
|---|---|---|
| Routine decisions (recruit, move, siege) | deterministic utility rules | same |
| Major decisions (war, peace) | deterministic scoring with personality + estimates | optional LLM via `StrategicPolicy` |
| Diplomacy dialogue | — | LLM adapter with structured JSON output, deterministic fallback |

* AIs see **estimates**, not truth: enemy strength is exact only where they have visibility
  (own/adjacent provinces), otherwise noisy (±30%, deterministic per observer and period).
* Model adapters (Phase 3) will be configurable (local model, free endpoints, user-supplied key
  kept on-device), with timeouts and automatic fallback to the deterministic policy.
  No API keys are ever stored in the repository.

## 5. Initial playable scope (Phase 1)

One generated continent (seeded, so it is a different map per seed), ~60 provinces,
10 countries (configurable 6–14), six civilisations with real mechanical differences,
four unit types, recruitment, movement, battles, sieges, colonising wild lands, war and
white peace, war exhaustion, fog of war, deterministic AI, save/load/export/import.

## 6. First milestone

“A full campaign can be played on a phone from turn 1 until conquest or elimination,
saved mid-way and restored identically.” Verified by unit tests plus a headless
200-turn simulation that checks state invariants every turn.

## 7. Known technical limitations

* Map is a square tile grid rendered to an offscreen canvas; no rivers or navies yet
  (sea crossings use fixed “straits”).
* Peace is status quo only (occupied provinces are kept); negotiated terms arrive in Phase 2.
* Browser storage can be cleared by the OS; export/import of save files is the durable path.
* Turn processing is synchronous; LLM calls (Phase 3) will need an async turn pipeline.
