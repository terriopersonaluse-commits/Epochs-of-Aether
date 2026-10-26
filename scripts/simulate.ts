// Headless AI-vs-AI simulation. Checks invariants every turn and prints a summary.
// Usage: node scripts/simulate.ts --turns 200 --seeds 5
import { deterministicPolicy } from '../src/ai/deterministic.ts';
import { parseSave, serializeSave, validateState } from '../src/persistence/save.ts';
import { processTurn } from '../src/sim/turn.ts';
import { ownedProvinces, regimentsOf } from '../src/sim/queries.ts';
import { generateWorld } from '../src/world/generate.ts';

const arg = (name: string, def: number) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? Number(process.argv[i + 1]) : def;
};
const turns = arg('turns', 200);
const seeds = arg('seeds', 3);
let failures = 0;

for (let k = 0; k < seeds; k++) {
  const seed = 1000 + k * 7919;
  const state = generateWorld(seed);
  const t0 = performance.now();
  let wars = 0, battles = 0, captures = 0;
  for (let t = 0; t < turns && state.winner === null; t++) {
    processTurn(state, deterministicPolicy);
    const errors = validateState(state);
    if (errors.length) {
      console.error(`seed ${seed} turn ${state.turn}: ${errors.slice(0, 5).join('; ')}`);
      failures++;
      break;
    }
  }
  for (const e of state.log) {
    if (e.type === 'war') wars++;
    if (e.type === 'battle') battles++;
    if (e.type === 'capture') captures++;
  }
  const ms = (performance.now() - t0) / Math.max(1, state.turn - 1);
  const roundTrip = parseSave(serializeSave(state));
  if (!roundTrip.ok) { console.error(`seed ${seed}: save round-trip failed`, roundTrip.errors); failures++; }
  const alive = state.countries.filter((c) => c.alive);
  console.log(`seed ${seed}: turn ${state.turn}, ${alive.length}/${state.countries.length} alive, ${wars} wars, ${battles} battles, ${captures} captures, ${ms.toFixed(1)} ms/turn${state.winner !== null ? `, winner ${state.countries[state.winner].name}` : ''}`);
  for (const c of alive) {
    console.log(`   ${c.name.padEnd(32)} ${c.civ.padEnd(9)} prov ${String(ownedProvinces(state, c.id).length).padStart(2)}  regts ${String(regimentsOf(state, c.id)).padStart(3)}  gold ${c.treasury.gold.toFixed(0).padStart(4)}  WE ${c.warExhaustion.toFixed(0)}`);
  }
}
if (failures) {
  console.error(`${failures} failure(s)`);
  process.exit(1);
}
