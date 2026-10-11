// Computer opponents for Bingo. Any arrangement is as good as another (nobody else
// sees it), so bots keep the grid they're dealt; each call is the open number that
// does most for their own lines: finishing one first, then filling the fullest.
import { LINES, openNumbers, randomGrid, validGrid } from './rules.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class BingoAI {
  constructor({ delay = 0, rng = Math.random } = {}) {
    this.delay = delay;
    this.rng = rng;
  }

  async wait(factor = 1) {
    if (this.delay) await sleep(this.delay * factor);
  }

  async arrangeGrid(game, me, { grid }) {
    await this.wait(2 + this.rng() * 2);
    return validGrid(grid) ? grid : randomGrid(this.rng);
  }

  async chooseCall(game, me) {
    await this.wait(0.9);
    return chooseCall(me.grid, game.state.called, this.rng);
  }
}

// How good a grid looks: complete lines count most, then lines nearly there.
export function gridValue(grid, crossed) {
  let value = 0;
  for (const line of LINES) {
    const marked = line.filter((pos) => crossed.has(grid[pos])).length;
    value += marked === line.length ? 1000 : marked ** 3;
  }
  return value;
}

export function chooseCall(grid, called, rng = Math.random) {
  const crossed = new Set(called);
  let best = null;
  let bestValue = -Infinity;
  for (const n of openNumbers(called)) {
    crossed.add(n);
    // A little noise breaks ties between equally good numbers.
    const value = gridValue(grid, crossed) + rng();
    crossed.delete(n);
    if (value > bestValue) {
      bestValue = value;
      best = n;
    }
  }
  return best;
}
