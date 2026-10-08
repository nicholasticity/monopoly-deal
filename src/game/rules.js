// Pure rule helpers that operate on player/game state. No rendering or async here.
import { COLORS, COLOR_ORDER } from './cards.js';

export const HAND_LIMIT = 7;
export const PLAYS_PER_TURN = 3;
// Which of the turn's plays the current player is choosing or making (1-3), or 0.
export const playNumber = (state) => (state.phase === 'play' ? state.play || 0 : 0);
export const SETS_TO_WIN = 3;
export const HOUSE_BONUS = 3;
export const HOTEL_BONUS = 4;

let pileSeq = 1;
function newPile(color) {
  return { id: pileSeq++, color, cards: [], house: null, hotel: null };
}

export const isMultiWild = (c) => c.type === 'wild' && c.anyColor;
export const isPropertyCard = (c) => c.type === 'property' || c.type === 'wild';
export const sum = (cards) => cards.reduce((s, c) => s + c.value, 0);

export function setSize(color) {
  return COLORS[color].size;
}

// A pile needs at least one card that isn't the 10-colour wild to count for anything.
function hasAnchor(pile) {
  return pile.cards.some((c) => !isMultiWild(c));
}

export function isComplete(pile) {
  return pile.cards.length >= setSize(pile.color) && hasAnchor(pile);
}

export function pileRent(pile) {
  if (!hasAnchor(pile)) return 0;
  const info = COLORS[pile.color];
  const n = Math.min(pile.cards.length, info.size);
  let rent = info.rent[n - 1];
  if (isComplete(pile)) {
    if (pile.house) rent += HOUSE_BONUS;
    if (pile.hotel) rent += HOTEL_BONUS;
  }
  return rent;
}

export function rentFor(player, color) {
  let best = 0;
  for (const pile of player.piles) if (pile.color === color) best = Math.max(best, pileRent(pile));
  return best;
}

export function completeColors(player) {
  return new Set(player.piles.filter(isComplete).map((p) => p.color));
}

export function hasWon(player) {
  return completeColors(player).size >= SETS_TO_WIN;
}

export function colorsForCard(card) {
  if (card.type === 'property') return [card.color];
  if (card.type === 'wild' || card.type === 'rent') return card.anyColor ? COLOR_ORDER.slice() : card.colors.slice();
  return [];
}

export function findPile(player, cardId) {
  return player.piles.find((p) => p.cards.some((c) => c.id === cardId) || p.house?.id === cardId || p.hotel?.id === cardId) || null;
}

export function pileOf(game, cardId) {
  for (const player of game.state.players) {
    const pile = findPile(player, cardId);
    if (pile) return { player, pile };
  }
  return null;
}

// Cards the player can use to pay a debt: bank, properties with value, buildings.
export function payableCards(player) {
  const out = [...player.bank];
  for (const pile of player.piles) {
    for (const c of pile.cards) if (c.value > 0) out.push(c);
    if (pile.house) out.push(pile.house);
    if (pile.hotel) out.push(pile.hotel);
  }
  return out;
}

export function totalAssets(player) {
  return sum(payableCards(player));
}

export function bankTotal(player) {
  return sum(player.bank);
}

export function propertyCards(player) {
  return player.piles.flatMap((p) => p.cards);
}

// Remove a card from wherever it lives in the player's area. Returns the card or null.
export function takeCard(player, cardId) {
  for (const zone of ['hand', 'bank']) {
    const i = player[zone].findIndex((c) => c.id === cardId);
    if (i >= 0) return player[zone].splice(i, 1)[0];
  }
  for (const pile of player.piles) {
    const i = pile.cards.findIndex((c) => c.id === cardId);
    if (i >= 0) {
      const card = pile.cards.splice(i, 1)[0];
      normalize(player);
      return card;
    }
    for (const slot of ['house', 'hotel']) {
      if (pile[slot]?.id === cardId) {
        const card = pile[slot];
        pile[slot] = null;
        normalize(player);
        return card;
      }
    }
  }
  return null;
}

export function addProperty(player, card, color) {
  if (!colorsForCard(card).includes(color)) throw new Error(`${card.name} cannot be ${color}`);
  card.color = color;
  let pile = player.piles.find((p) => p.color === color && p.cards.length < setSize(color));
  if (!pile) {
    pile = newPile(color);
    player.piles.push(pile);
  }
  pile.cards.push(card);
  normalize(player);
}

// Re-pack each colour into as many complete sets as possible, keep buildings on
// complete sets, and send orphaned buildings to the bank.
export function normalize(player) {
  const out = [];
  for (const color of COLOR_ORDER) {
    const old = player.piles.filter((p) => p.color === color);
    if (old.length === 0) continue;
    const size = setSize(color);
    const cards = old.flatMap((p) => p.cards);
    const anchors = cards.filter((c) => !isMultiWild(c));
    const multis = cards.filter(isMultiWild);
    const buildings = old.filter((p) => p.house || p.hotel).map((p) => ({ house: p.house, hotel: p.hotel }));
    const ids = old.map((p) => p.id);

    const piles = [];
    while (anchors.length || multis.length) {
      const pile = newPile(color);
      if (ids.length) pile.id = ids.shift();
      while (pile.cards.length < size && anchors.length) pile.cards.push(anchors.shift());
      while (pile.cards.length < size && multis.length) pile.cards.push(multis.shift());
      piles.push(pile);
    }
    for (const b of buildings) {
      const target = piles.find((p) => isComplete(p) && !p.house && !p.hotel);
      if (target && b.house) {
        target.house = b.house;
        target.hotel = b.hotel;
      } else {
        if (b.house) player.bank.push(b.house);
        if (b.hotel) player.bank.push(b.hotel);
      }
    }
    out.push(...piles);
  }
  player.piles = out;
}

export function buildingTargets(player, kind) {
  return player.piles.filter((p) => {
    if (!isComplete(p) || !COLORS[p.color].buildable) return false;
    return kind === 'house' ? !p.house : !!p.house && !p.hotel;
  });
}

// Properties that can be taken by Sly Deal / Forced Deal (not part of a full set).
export function stealableCards(player) {
  return player.piles.filter((p) => !isComplete(p)).flatMap((p) => p.cards);
}

export function rentColors(player, card) {
  return colorsForCard(card).filter((color) => rentFor(player, color) > 0);
}

export function others(game, player) {
  return game.state.players.filter((p) => p !== player);
}

// Returns an error string if the action is illegal, otherwise null.
export function validateAction(game, player, action) {
  const { state } = game;
  if (action.kind === 'end') return null;
  if (action.kind === 'moveWild') {
    const pile = findPile(player, action.cardId);
    const card = pile?.cards.find((c) => c.id === action.cardId);
    if (!card || card.type !== 'wild') return 'Not a wild card on your table';
    if (!colorsForCard(card).includes(action.color)) return 'Wild cannot be that colour';
    if (card.color === action.color) return 'Already that colour';
    return null;
  }
  const card = player.hand.find((c) => c.id === action.cardId);
  if (!card) return 'Card not in hand';
  if (state.playsLeft <= 0) return 'No plays left';
  const opponent = (id) => others(game, player).find((p) => p.id === id);

  switch (action.kind) {
    case 'bank':
      return isPropertyCard(card) ? 'Properties cannot be banked' : null;
    case 'property':
      if (!isPropertyCard(card)) return 'Not a property';
      return colorsForCard(card).includes(action.color) ? null : 'Invalid colour';
    case 'rent': {
      if (card.type !== 'rent') return 'Not a rent card';
      if (!rentColors(player, card).includes(action.color)) return 'You have no properties of that colour';
      if (card.anyColor && !opponent(action.targetId)) return 'Choose a player';
      const doubles = action.doubles || [];
      if (1 + doubles.length > state.playsLeft) return 'Not enough plays for Double The Rent';
      for (const id of doubles) {
        const d = player.hand.find((c) => c.id === id);
        if (!d || d.action !== 'doublerent') return 'Invalid Double The Rent';
      }
      return null;
    }
    case 'action':
      break;
    default:
      return 'Unknown action';
  }

  if (card.type !== 'action') return 'Not an action card';
  switch (card.action) {
    case 'passgo':
    case 'birthday':
      return null;
    case 'debtcollector':
      return opponent(action.targetId) ? null : 'Choose a player';
    case 'slydeal': {
      const target = opponent(action.targetId);
      if (!target || !stealableCards(target).some((c) => c.id === action.targetCardId)) return 'Choose a property not in a full set';
      return null;
    }
    case 'forceddeal': {
      const target = opponent(action.targetId);
      if (!target || !stealableCards(target).some((c) => c.id === action.targetCardId)) return 'Choose a property not in a full set';
      if (!propertyCards(player).some((c) => c.id === action.myCardId)) return 'Choose one of your properties to give';
      return null;
    }
    case 'dealbreaker': {
      const target = opponent(action.targetId);
      const pile = target?.piles.find((p) => p.id === action.pileId);
      return pile && isComplete(pile) ? null : 'Choose a complete set';
    }
    case 'house':
    case 'hotel':
      return buildingTargets(player, card.action).some((p) => p.id === action.pileId) ? null : 'No valid set for that building';
    case 'justsayno':
      return 'Just Say No can only be played in response to an action';
    case 'doublerent':
      return 'Double The Rent must be played with a rent card';
    default:
      return 'Unknown action';
  }
}
