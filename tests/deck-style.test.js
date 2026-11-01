import test from 'node:test';
import assert from 'node:assert/strict';
import { setDeckStyle, restyle, rankText, suitLook, deckStyle } from '../src/render/deck-style.js';

test('the colours deck keeps rank order and names suits by colour', () => {
  setDeckStyle('colours');
  try {
    assert.equal(deckStyle(), 'colours');
    assert.equal(rankText(10), '10');
    assert.equal(rankText(11), 'D');
    assert.equal(rankText(12), 'C');
    assert.equal(rankText(13), 'B');
    assert.equal(rankText(14), 'A');
    assert.equal(suitLook('spades').one, 'Black');
    assert.equal(suitLook('hearts').one, 'Red');
    assert.equal(suitLook('clubs').one, 'Green');
    assert.equal(suitLook('diamonds').one, 'Blue');
    assert.equal(restyle('Q♥'), 'C Red');
    assert.equal(restyle('called ♥ Hearts as trumps.'), 'called Reds as trumps.');
    assert.equal(restyle('You win 40 with Ace high.'), 'You win 40 with A high.');
    assert.equal(restyle('a pair of Kings'), 'a pair of Bs');
    assert.equal(restyle('Flop: A♠ K♥ 10♦.'), 'Flop: A Black B Red 10 Blue.');
  } finally {
    setDeckStyle('classic');
  }
});

test('classic and fantasy text stay as they were', () => {
  setDeckStyle('fantasy');
  try {
    assert.equal(restyle('Q♥'), 'W☀');
    assert.equal(restyle('called ♥ Hearts as trumps.'), 'called ☀ Suns as trumps.');
    assert.equal(restyle('Ace high'), 'Ace high');
    assert.equal(rankText(14), 'P');
  } finally {
    setDeckStyle('classic');
  }
  assert.equal(restyle('Q♥'), 'Q♥');
  assert.equal(restyle('Ace high'), 'Ace high');
  assert.equal(rankText(14), 'A');
  assert.equal(suitLook('hearts').symbol, '♥');
});
