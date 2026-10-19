// Computer opponents for Judgement. Bids come from playing the hand out against random
// deals (as Call Bridge's bots do) and scoring each bid the round's way; cards are
// played to win tricks until the bid is made and to dodge them after that, which suits
// an exact bid just as well.
import { trickCounts, chooseCard } from '../callbridge/ai.js';
import { roundPoints, validBid } from './rules.js';

export { chooseCard };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class JudgementAI {
  constructor({ delay = 0 } = {}) {
    this.delay = delay;
  }

  async wait(factor = 1) {
    if (this.delay) await sleep(this.delay * factor);
  }

  async chooseBid(game, me, { forbidden = null } = {}) {
    await this.wait(1);
    return chooseBid(game, me, forbidden);
  }

  async choosePlay(game, me) {
    await this.wait(0.6);
    return chooseCard(game, me).id;
  }
}

// The allowed bid with the best average score. The first trick is led from the
// dealer's left.
export function chooseBid(game, me, forbidden = null, rng = Math.random) {
  const { state } = game;
  const size = me.hand.length;
  const leader = (state.den + 1) % state.players.length;
  const counts = trickCounts(game, me, leader, rng);
  let best = null;
  let bestValue = -Infinity;
  for (let bid = 0; bid <= size; bid++) {
    if (!validBid(bid, size, forbidden)) continue;
    let value = 0;
    counts.forEach((count, won) => (value += count * roundPoints(bid, won, state.scoring)));
    if (value > bestValue) {
      best = bid;
      bestValue = value;
    }
  }
  return best;
}
