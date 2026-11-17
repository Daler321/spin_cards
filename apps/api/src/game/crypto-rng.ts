import { randomInt } from 'node:crypto';
import type { Rng } from '@spincards/game-core';

/** Production randomness for game-core (CLAUDE.md: only crypto randomness on the server). */
export const cryptoRng: Rng = { int: (min, max) => randomInt(min, max) };
