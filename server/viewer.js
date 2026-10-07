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
      turn: state.turn,
      phase: state.phase,
      winner: state.winner ? state.winner.id : null,
      cards,
    };
  }
}
