import type { GameState } from '../core/types.ts';

/**
 * A national decision-maker. It reads the state and issues orders through src/sim/orders.ts
 * (and src/sim/diplomacy.ts), which validate everything. A policy must never edit state directly.
 *
 * Phase 1 ships `deterministicPolicy`. A language-model policy (Phase 3) will implement the same
 * interface for major decisions and fall back to the deterministic one on timeout or error.
 */
export interface StrategicPolicy {
  readonly name: string;
  planTurn(state: GameState, country: number): void;
}
