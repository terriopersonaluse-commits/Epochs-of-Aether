# Implementation status

Legend: ✅ implemented and covered by tests or the headless simulator · 🟡 partial · ⬜ planned

## Phase 1 — Playable foundation (current milestone)

| Feature | State | Notes |
|---|---|---|
| Seeded procedural continent | ✅ | Terrain (7 types), islands joined by straits, ~55–65 provinces, deposits |
| ~10 countries, borders, wilds | ✅ | 6–14 realms, majors and minors, ~20% untamed wilds |
| Six civilisations with real modifiers | ✅ | Production, unit attack/cost, terrain bonuses, AI army mix |
| Country selection | ✅ | Tap on map or pick from list |
| Resources | ✅ | Gold, food, iron, manpower; upkeep; shortages hurt morale / cause desertion |
| Turn advancement | ✅ | Fixed phase order (see `src/sim/turn.ts`) |
| Units | ✅ | Infantry, archers, cavalry, siege engines |
| Recruitment | ✅ | Validated costs, queued, musters at end of turn, cancel with refund |
| Movement | ✅ | Pathfinding, speed, halting at enemies and fortresses, no entry to neutral nations |
| Battles | ✅ | 3 rounds, terrain, civ bonuses, morale, opening volleys, retreat or surrender |
| Sieges and capture | ✅ | Fort levels, siege engines, capital relocation |
| Settling wild provinces | ✅ | Two uncontested turns |
| War and white peace | ✅ | Declaration, truces (12 turns), AI peace offers to the player |
| War exhaustion | ✅ | Cuts gold income, drives peace decisions |
| Fog of war | ✅ | Foreign armies hidden outside sight; strength estimates are noisy |
| Deterministic national AI | ✅ | War/peace decisions, recruitment, defence, offensives, colonisation |
| Save / load | ✅ | Versioned + validated; 3 slots + autosave; save codes and save files |
| Victory / defeat | ✅ | Hegemony at 60% of provinces; elimination |
| Mobile-first UI | ✅ | Pan, pinch zoom, tap; bottom sheet on phones, side panel on desktop |

## Phase 2 — Core grand strategy
| Feature | State |
|---|---|
| Construction (farms, mines, markets, forts, roads) | ⬜ |
| Taxation slider and trade between nations | ⬜ |
| Alliances, defensive pacts, call to arms | ⬜ |
| Negotiated peace terms (provinces, reparations, vassals) | ⬜ |
| Basic research tree | ⬜ |
| Generals and army experience | ⬜ |
| Navies and naval transport | ⬜ |

## Phase 3 — AI diplomacy and memory
| Feature | State |
|---|---|
| Structured history events with visibility | 🟡 | Event log exists, already filtered by what each realm knows |
| Multi-factor relations (trust, fear, grievances) | ⬜ |
| National memory influencing decisions | ⬜ |
| Natural-language diplomacy via model adapter | ⬜ | `StrategicPolicy` interface ready for it |
| Deterministic fallback when no model is available | 🟡 | The whole Phase 1 AI is that fallback |

## Phases 4–7
Government and ideology, espionage, magic and artifacts, ten map archetypes,
history generation, and optimisation are all ⬜ planned. See `docs/TECHNICAL_PLAN.md`.

## Known limitations
* Square-tile map; no rivers yet.
* Peace is status quo only.
* AI hoards gold in long peacetimes (nothing to build until Phase 2); it converts large
  surpluses into extra regiments as a stopgap.
