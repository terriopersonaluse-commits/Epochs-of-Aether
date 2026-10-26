// Phase 1 diplomacy: war and white peace, evaluated from the evaluator's own (imperfect) knowledge.
import { clamp } from '../core/rng.ts';
import type { GameState } from '../core/types.ts';
import { MIN_WAR_TURNS_FOR_PEACE, log, makePeace, type OrderResult } from './orders.ts';
import { estimateStrength, findWar, trueMilitaryStrength } from './queries.ts';

export interface PeaceAssessment {
  accept: boolean;
  desire: number;
  reasons: string[];
}

/** How much `evaluator` wants peace with `other`, with human-readable reasons. */
export function assessPeace(state: GameState, evaluator: number, other: number): PeaceAssessment {
  const war = findWar(state, evaluator, other);
  if (!war) return { accept: false, desire: 0, reasons: ['We are not at war.'] };
  const me = state.countries[evaluator];
  const reasons: string[] = [];
  const duration = state.turn - war.startTurn;
  if (duration < MIN_WAR_TURNS_FOR_PEACE) {
    return { accept: false, desire: -1, reasons: ['The war has barely begun; our honour demands we fight on.'] };
  }
  const myScore = war.a === evaluator ? war.scoreA : war.scoreB;
  const theirScore = war.a === evaluator ? war.scoreB : war.scoreA;
  const net = myScore - theirScore;
  const mine = Math.max(1, trueMilitaryStrength(state, evaluator));
  const theirs = Math.max(1, estimateStrength(state, evaluator, other));
  const ratio = mine / theirs;

  let desire = 0;
  desire += me.warExhaustion / 50;
  if (me.warExhaustion > 30) reasons.push('Our people are weary of war.');
  desire += clamp(-net, -30, 30) / 30;
  if (net < -5) reasons.push('The war is going badly for us.');
  if (net > 5) reasons.push('We are winning this war.');
  desire += clamp(1 / ratio - 1, -1, 2) * 0.5;
  if (ratio < 0.7) reasons.push('Their armies outmatch ours.');
  if (ratio > 1.5) reasons.push('Our armies are stronger.');
  if (duration > 20) { desire += 0.3; reasons.push('The war has dragged on too long.'); }
  desire += me.personality.caution * 0.3 - me.personality.aggression * 0.3;

  const accept = desire > 0.35;
  if (!reasons.length) reasons.push(accept ? 'Neither side can win outright.' : 'We see no reason to stop now.');
  return { accept, desire, reasons };
}

export function proposePeace(state: GameState, from: number, to: number): OrderResult & { reasons?: string[] } {
  if (!findWar(state, from, to)) return { ok: false, reason: 'Not at war.' };
  const verdict = assessPeace(state, to, from);
  if (!verdict.accept) {
    log(state, {
      type: 'info', participants: [from, to], visibility: 'participants',
      text: `${state.countries[to].name} rejects peace with ${state.countries[from].name}. ${verdict.reasons.join(' ')}`,
    });
    return { ok: false, reason: `${state.countries[to].name} refuses: ${verdict.reasons.join(' ')}`, reasons: verdict.reasons };
  }
  return { ...makePeace(state, from, to), reasons: verdict.reasons };
}

/** Accept a pending AI peace offer addressed to `to`. The offer is re-validated first. */
export function acceptPeaceOffer(state: GameState, to: number, from: number): OrderResult {
  const offer = state.peaceOffers.find((o) => o.from === from && o.to === to);
  if (!offer) return { ok: false, reason: 'That offer is no longer on the table.' };
  if (!findWar(state, from, to)) {
    state.peaceOffers = state.peaceOffers.filter((o) => o !== offer);
    return { ok: false, reason: 'You are no longer at war.' };
  }
  return makePeace(state, from, to);
}

export function declinePeaceOffer(state: GameState, to: number, from: number): void {
  state.peaceOffers = state.peaceOffers.filter((o) => !(o.from === from && o.to === to));
}
