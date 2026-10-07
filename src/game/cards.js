// Card definitions for the standard 106-card Monopoly Deal deck.

export const COLORS = {
  brown:     { name: 'Brown',      hex: '#8a5634', text: '#ffffff', size: 2, rent: [1, 2],       buildable: true },
  lightblue: { name: 'Light Blue', hex: '#9fd8f2', text: '#10324a', size: 3, rent: [1, 2, 3],    buildable: true },
  pink:      { name: 'Pink',       hex: '#d8408c', text: '#ffffff', size: 3, rent: [1, 2, 4],    buildable: true },
  orange:    { name: 'Orange',     hex: '#f08c1e', text: '#ffffff', size: 3, rent: [1, 3, 5],    buildable: true },
  red:       { name: 'Red',        hex: '#e1262c', text: '#ffffff', size: 3, rent: [2, 3, 6],    buildable: true },
  yellow:    { name: 'Yellow',     hex: '#fbdc35', text: '#3a2f00', size: 3, rent: [2, 4, 6],    buildable: true },
  green:     { name: 'Green',      hex: '#1e9b4b', text: '#ffffff', size: 3, rent: [2, 4, 7],    buildable: true },
  darkblue:  { name: 'Dark Blue',  hex: '#1f4fa5', text: '#ffffff', size: 2, rent: [3, 8],       buildable: true },
  railroad:  { name: 'Railroad',   hex: '#262626', text: '#ffffff', size: 4, rent: [1, 2, 3, 4], buildable: false },
  utility:   { name: 'Utility',    hex: '#bcdc94', text: '#24380e', size: 2, rent: [1, 2],       buildable: false },
};

export const COLOR_ORDER = Object.keys(COLORS);

const PROPERTIES = {
  brown:     { value: 1, names: ['Mediterranean Avenue', 'Baltic Avenue'] },
  lightblue: { value: 1, names: ['Oriental Avenue', 'Vermont Avenue', 'Connecticut Avenue'] },
  pink:      { value: 2, names: ['St. Charles Place', 'States Avenue', 'Virginia Avenue'] },
  orange:    { value: 2, names: ['St. James Place', 'Tennessee Avenue', 'New York Avenue'] },
  red:       { value: 3, names: ['Kentucky Avenue', 'Indiana Avenue', 'Illinois Avenue'] },
  yellow:    { value: 3, names: ['Atlantic Avenue', 'Ventnor Avenue', 'Marvin Gardens'] },
  green:     { value: 4, names: ['Pacific Avenue', 'North Carolina Avenue', 'Pennsylvania Avenue'] },
  darkblue:  { value: 4, names: ['Park Place', 'Boardwalk'] },
  railroad:  { value: 2, names: ['Reading Railroad', 'Pennsylvania Railroad', 'B. & O. Railroad', 'Short Line'] },
  utility:   { value: 2, names: ['Electric Company', 'Water Works'] },
};

// [colorA, colorB, value, count]; colors === null means the 10-colour wild.
const WILDS = [
  ['darkblue', 'green', 4, 1],
  ['lightblue', 'brown', 1, 1],
  ['pink', 'orange', 2, 2],
  ['green', 'railroad', 4, 1],
  ['lightblue', 'railroad', 4, 1],
  ['utility', 'railroad', 2, 1],
  ['red', 'yellow', 3, 2],
  [null, null, 0, 2],
];

export const ACTIONS = {
  dealbreaker:   { name: 'Deal Breaker',     value: 5, count: 2,  icon: '💥', color: '#6d2bb3', desc: 'Steal a complete set of properties from any player. (Includes any buildings.)' },
  justsayno:     { name: 'Just Say No!',     value: 4, count: 3,  icon: '✋', color: '#0094c4', desc: 'Use any time when an action is played against you.' },
  slydeal:       { name: 'Sly Deal',         value: 3, count: 3,  icon: '🦊', color: '#e0702a', desc: 'Steal a property from the player of your choice. Cannot be part of a full set.' },
  forceddeal:    { name: 'Forced Deal',      value: 3, count: 3,  icon: '🔄', color: '#2f8f4e', desc: 'Swap any property with another player. Cannot be part of a full set.' },
  debtcollector: { name: 'Debt Collector',   value: 3, count: 3,  icon: '💼', color: '#4b5563', desc: 'Force any player to pay you $5M.' },
  birthday:      { name: "It's My Birthday", value: 2, count: 3,  icon: '🎂', color: '#d9437a', desc: 'All players give you $2M as a "gift".' },
  passgo:        { name: 'Pass Go',          value: 1, count: 10, icon: '🏁', color: '#d32f2f', desc: 'Draw 2 extra cards.' },
  house:         { name: 'House',            value: 3, count: 3,  icon: '🏠', color: '#2e9e44', desc: 'Add onto any full set you own to add $3M to the rent value. (Except railroads and utilities.)' },
  hotel:         { name: 'Hotel',            value: 4, count: 2,  icon: '🏨', color: '#c62828', desc: 'Add onto any full set you own that has a house to add $4M to the rent value. (Except railroads and utilities.)' },
  doublerent:    { name: 'Double The Rent',  value: 1, count: 2,  icon: '✖️', color: '#c9a000', desc: 'Needs to be played with a rent card. Both cards count as plays.' },
};

// [colorA, colorB, value, count]; null colours = wild rent (one player, any colour).
const RENTS = [
  ['darkblue', 'green', 1, 2],
  ['red', 'yellow', 1, 2],
  ['pink', 'orange', 1, 2],
  ['lightblue', 'brown', 1, 2],
  ['railroad', 'utility', 1, 2],
  [null, null, 3, 3],
];

const MONEY = [[1, 6], [2, 5], [3, 3], [4, 3], [5, 2], [10, 1]];

export function buildDeck() {
  const cards = [];
  let id = 1;
  const add = (card) => cards.push({ id: id++, ...card });

  for (const [value, count] of MONEY) {
    for (let i = 0; i < count; i++) add({ type: 'money', key: `money-${value}`, name: `$${value}M`, value });
  }
  for (const [color, { value, names }] of Object.entries(PROPERTIES)) {
    for (const name of names) add({ type: 'property', key: `prop-${name}`, name, color, value });
  }
  for (const [a, b, value, count] of WILDS) {
    for (let i = 0; i < count; i++) {
      if (a === null) {
        add({ type: 'wild', key: 'wild-any', name: 'Property Wild Card', anyColor: true, colors: COLOR_ORDER.slice(), color: null, value });
      } else {
        add({ type: 'wild', key: `wild-${a}-${b}`, name: `${COLORS[a].name}/${COLORS[b].name} Wild`, anyColor: false, colors: [a, b], color: a, value });
      }
    }
  }
  for (const [action, def] of Object.entries(ACTIONS)) {
    for (let i = 0; i < def.count; i++) add({ type: 'action', key: `action-${action}`, name: def.name, action, value: def.value });
  }
  for (const [a, b, value, count] of RENTS) {
    for (let i = 0; i < count; i++) {
      if (a === null) {
        add({ type: 'rent', key: 'rent-any', name: 'Wild Rent', anyColor: true, colors: COLOR_ORDER.slice(), value });
      } else {
        add({ type: 'rent', key: `rent-${a}-${b}`, name: `${COLORS[a].name}/${COLORS[b].name} Rent`, anyColor: false, colors: [a, b], value });
      }
    }
  }
  return cards;
}

export function describeCard(card) {
  if (card.type === 'money') return card.name;
  if (card.type === 'property') return card.name;
  if (card.type === 'wild') return card.anyColor ? 'Multi-colour Wild' : card.name;
  return card.name;
}
