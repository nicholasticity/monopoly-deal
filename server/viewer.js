// One player's view of the authoritative game. Every card is sent under a random
// alias; cards the viewer can't see (the deck, other players' hands) carry no
// details. A card that goes from visible to hidden (the discard reshuffled into
// the deck) gets a fresh alias, so a client can never track a known card into
// someone's hand.
import { randomInt } from 'node:crypto';

export class Viewer {
  constructor(seat) {
    this.seat = seat; // player id, or -1 for spectators
    this.aliasOf = new Map(); // real card id -> alias
    this.realOf = new Map(); // alias -> real card id
    this.shown = new Set(); // real ids this viewer can currently see
  }

  alias(card, visible) {
    let a = this.aliasOf.get(card.id);
    if (a != null && !visible && this.shown.has(card.id)) {
      this.realOf.delete(a);
      a = null;
    }
    if (a == null) {
      do a = randomInt(1, 2 ** 31); while (this.realOf.has(a));
      this.aliasOf.set(card.id, a);
      this.realOf.set(a, card.id);
    }
    if (visible) this.shown.add(card.id);
    else this.shown.delete(card.id);
    return a;
  }

  // Alias of a card the viewer can see right now (used in prompts).
  visible(card) {
    return card ? this.alias(card, true) : null;
  }

  real(alias) {
    return typeof alias === 'number' ? this.realOf.get(alias) ?? null : null;
  }

  // `known` maps alias -> colour for card details this connection already has,
  // so each snapshot only carries details for new or recoloured cards.
  snapshot(game, known) {
    const { state } = game;
    const cards = [];
    const ref = (card, visible) => {
      const a = this.alias(card, visible);
      if (visible) {
        const sig = card.color ?? '';
        if (known.get(a) !== sig) {
          known.set(a, sig);
          cards.push({ ...card, id: a });
        }
      }
      return a;
    };
    const shown = (card) => (card ? ref(card, true) : null);
    if (game.kind === 'wordle') {
      // While a word is on, only your own letters: everyone else's guesses are just
      // their marks. The word and every guess show once it's over.
      const open = state.phase === 'reveal' || state.phase === 'over';
      return {
        players: state.players.map((p) => ({
          id: p.id,
          score: p.score,
          guesses: p.guesses.map((g) => ({ word: open || p.id === this.seat ? g.word : null, mark: g.mark })),
          solved: p.solved,
          done: p.done,
        })),
        round: state.round,
        rounds: state.rounds,
        phase: state.phase,
        answer: open ? state.answer : null,
        remaining: Math.max(0, state.endsAt - Date.now()),
        roundWinner: state.roundWinner?.id ?? null,
        history: state.history,
        winners: state.winners.map((p) => p.id),
        cards,
      };
    }
    if (game.kind === 'leastcount') {
      // Only your own hand, until someone calls Show; then every hand is shown. The
      // thrown cards and the wild card are face up.
      const open = state.phase === 'show' || state.phase === 'scoring' || state.phase === 'over';
      return {
        players: state.players.map((p) => ({
          id: p.id,
          hand: p.hand.map((c) => ref(c, open || p.id === this.seat)),
          score: p.score,
          history: p.history,
          total: open ? p.total : null,
        })),
        deck: state.deck.map((c) => ref(c, false)),
        discard: state.discard.map(shown),
        last: state.last && { playerId: state.last.playerId, cards: state.last.cards.map(shown) },
        wildCard: shown(state.wildCard),
        wild: state.wild,
        round: state.round,
        rounds: state.rounds,
        handSize: state.handSize,
        dealer: state.dealer,
        current: state.current,
        phase: state.phase,
        caller: state.caller,
        caught: state.caught,
        winners: state.winners.map((p) => p.id),
        cards,
      };
    }
    if (game.kind === 'sudoku') {
      // While the race is on, only your own numbers: everyone else's grid shows which
      // cells they've filled (1) but not with what. The answer, and every grid, once it's over.
      const open = state.phase === 'over';
      return {
        players: state.players.map((p) => {
          const own = open || p.id === this.seat;
          return {
            id: p.id,
            grid: own ? p.grid : null,
            mask: own ? null : p.grid.map((d) => (d ? 1 : 0)).join(''),
            filled: p.filled,
            mistakes: p.mistakes,
            solved: p.solved,
            done: p.done,
            time: p.time,
            wrong: p.id === this.seat ? p.wrong : null,
          };
        }),
        level: state.level,
        puzzle: state.puzzle,
        empty: state.empty,
        limited: state.limited,
        phase: state.phase,
        elapsed: state.startedAt ? (state.endedAt || Date.now()) - state.startedAt : 0,
        solution: open ? state.solution : null,
        winners: state.winners.map((p) => p.id),
        cards,
      };
    }
    if (game.kind === 'pool') {
      // Nothing is hidden at the pool table. The last shot goes along so every browser
      // can replay it.
      return {
        balls: state.balls,
        groups: state.groups,
        current: state.current,
        phase: state.phase,
        ballInHand: state.ballInHand,
        shots: state.shots,
        shot: state.shot,
        last: state.last,
        winners: state.winners.map((p) => p.id),
        cards,
      };
    }
    if (game.kind === 'bingo') {
      // Only your own grid, until the game is over; everyone sees how many lines.
      const open = state.phase === 'over';
      return {
        players: state.players.map((p) => ({
          id: p.id,
          grid: open || p.id === this.seat ? p.grid : null,
          ready: p.ready,
          lines: p.lines,
        })),
        called: state.called,
        callers: state.callers,
        first: state.first,
        current: state.current,
        phase: state.phase,
        winners: state.winners.map((p) => p.id),
        cards,
      };
    }
    if (game.kind === 'callbridge' || game.kind === 'judgement') {
      // Call Bridge and Judgement. Only your own hand is private; cards played to a
      // trick stay face up.
      return {
        players: state.players.map((p) => ({
          id: p.id,
          hand: p.hand.map((c) => ref(c, p.id === this.seat)),
          tricks: p.tricks.map(shown),
          bid: p.bid,
          won: p.won,
          score: p.score,
          history: p.history,
        })),
        deck: state.deck.map((c) => ref(c, false)),
        trick: state.trick.map((t) => ({ playerId: t.playerId, card: shown(t.card) })),
        trump: state.trump,
        den: state.den,
        round: state.round,
        rounds: state.rounds,
        handSize: state.handSize,
        current: state.current,
        leader: state.leader,
        phase: state.phase,
        winners: state.winners.map((p) => p.id),
        // Judgement only: how it's scored, and the hand size each round.
        ...(game.kind === 'judgement' && { scoring: state.scoring, sizes: state.sizes }),
        cards,
      };
    }
    return {
      players: state.players.map((p) => ({
        id: p.id,
        hand: p.hand.map((c) => ref(c, p.id === this.seat)),
        bank: p.bank.map(shown),
        piles: p.piles.map((pile) => ({
          id: pile.id,
          color: pile.color,
          cards: pile.cards.map(shown),
          house: shown(pile.house),
          hotel: shown(pile.hotel),
        })),
      })),
      deck: state.deck.map((c) => ref(c, false)),
      discard: state.discard.map(shown),
      showcase: state.showcase.map(shown),
      current: state.current,
      playsLeft: state.playsLeft,
      play: state.play,
      turn: state.turn,
      phase: state.phase,
      winner: state.winner ? state.winner.id : null,
      cards,
    };
  }
}
