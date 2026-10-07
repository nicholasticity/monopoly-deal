// Bridges the engine's controller interface to the HUD for the human player.
import * as R from '../game/rules.js';
import { COLORS, ACTIONS, describeCard } from '../game/cards.js';
import { autoPayment } from '../game/ai.js';

const money = (n) => `${n}M`;
const CLICK = matchMedia('(pointer: coarse)').matches ? 'Tap' : 'Click';

export class HumanController {
  constructor(hud) {
    this.hud = hud;
    this.pending = null;
    this.busy = false;
  }

  // ---------- turn input ----------

  chooseTurnAction(game, me) {
    return new Promise((resolve) => {
      this.pending = { game, me, resolve };
      this.hud.setTurnControls(true, game.state.playsLeft, `${CLICK} a card in your hand to play it.`);
    });
  }

  finish(action) {
    const p = this.pending;
    this.pending = null;
    this.hud.setTurnControls(false);
    p.resolve(action);
  }

  endTurn() {
    if (this.pending && !this.busy) this.finish({ kind: 'end' });
  }

  async onCardClick(card, zone, x, y) {
    if (!this.pending || this.busy) return;
    const { game, me } = this.pending;
    let build = null;
    if (zone.zone === 'hand' && zone.playerId === me.id) build = () => this.handCardAction(game, me, card, x, y);
    else if (zone.zone === 'pile' && zone.playerId === me.id && card.type === 'wild') build = () => this.moveWildAction(me, card, x, y);
    if (!build) return;
    this.busy = true;
    try {
      const action = await build();
      if (action && this.pending) {
        const err = R.validateAction(game, me, action);
        if (err) this.hud.toast(err, 'warn');
        else this.finish(action);
      }
    } finally {
      this.busy = false;
    }
  }

  async moveWildAction(me, card, x, y) {
    const options = R.colorsForCard(card)
      .filter((c) => c !== card.color)
      .map((c) => ({ label: `Move to ${COLORS[c].name}`, value: c, swatch: COLORS[c].hex }));
    const color = await this.hud.menu(x, y, 'Rearrange wild (free)', options);
    return color ? { kind: 'moveWild', cardId: card.id, color } : null;
  }

  availability(game, me, card) {
    const opps = R.others(game, me);
    switch (card.action) {
      case 'slydeal':
        return opps.some((o) => R.stealableCards(o).length) ? null : 'No properties available to steal';
      case 'forceddeal':
        if (!R.propertyCards(me).length) return 'You need a property to swap';
        return opps.some((o) => R.stealableCards(o).length) ? null : 'No properties available to swap';
      case 'dealbreaker':
        return opps.some((o) => o.piles.some(R.isComplete)) ? null : 'Nobody has a complete set';
      case 'house':
      case 'hotel':
        return R.buildingTargets(me, card.action).length ? null : card.action === 'house' ? 'Needs a complete set (not railroad/utility)' : 'Needs a complete set with a house';
      default:
        return null;
    }
  }

  async handCardAction(game, me, card, x, y) {
    const opts = [];
    const bank = { label: `Bank as ${money(card.value)}`, value: 'bank' };
    switch (card.type) {
      case 'money':
        opts.push({ label: `Bank ${money(card.value)}`, value: 'bank' });
        break;
      case 'property':
        opts.push({ label: `Play to ${COLORS[card.color].name}`, value: `prop:${card.color}`, swatch: COLORS[card.color].hex });
        break;
      case 'wild':
        for (const c of R.colorsForCard(card)) opts.push({ label: `Play as ${COLORS[c].name}`, value: `prop:${c}`, swatch: COLORS[c].hex });
        break;
      case 'rent': {
        const colors = R.rentColors(me, card);
        opts.push({ label: 'Charge rent', value: 'rent', disabled: !colors.length, hint: colors.length ? null : 'You own no matching properties' });
        opts.push(bank);
        break;
      }
      case 'action': {
        if (card.action === 'justsayno') opts.push({ label: 'Held for when an action targets you', value: null, disabled: true });
        else if (card.action === 'doublerent') opts.push({ label: 'Played together with a rent card', value: null, disabled: true });
        else {
          const why = this.availability(game, me, card);
          opts.push({ label: `Play ${ACTIONS[card.action].name}`, value: 'play', disabled: !!why, hint: why });
        }
        opts.push(bank);
        break;
      }
    }
    const choice = await this.hud.menu(x, y, describeCard(card), opts);
    if (!choice) return null;
    if (choice === 'bank') return { kind: 'bank', cardId: card.id };
    if (choice.startsWith('prop:')) return { kind: 'property', cardId: card.id, color: choice.slice(5) };
    if (choice === 'rent') return this.rentAction(game, me, card);
    if (choice === 'play') return this.playAction(game, me, card);
    return null;
  }

  choosePlayer(game, me, title, body) {
    return this.hud.choose({
      title,
      body,
      options: R.others(game, me).map((o) => ({
        label: o.name,
        value: o.id,
        hint: `Bank ${money(R.bankTotal(o))} · Total ${money(R.totalAssets(o))} · ${R.completeColors(o).size} sets`,
      })),
    });
  }

  async rentAction(game, me, card) {
    const colors = R.rentColors(me, card);
    let color = colors[0];
    if (colors.length > 1) {
      color = await this.hud.choose({
        title: 'Charge rent',
        body: 'Which colour do you want to collect rent for?',
        cards: [card],
        options: colors.map((c) => ({ label: `${COLORS[c].name} — ${money(R.rentFor(me, c))}`, value: c, swatch: COLORS[c].hex })),
      });
      if (!color) return null;
    }
    const base = R.rentFor(me, color);
    let targetId;
    if (card.anyColor) {
      targetId = await this.choosePlayer(game, me, `Who pays ${money(base)} rent?`, 'Wild rent charges a single player.');
      if (targetId == null) return null;
    }
    const doubles = me.hand.filter((c) => c.action === 'doublerent');
    const maxDoubles = Math.min(doubles.length, game.state.playsLeft - 1);
    let d = 0;
    if (maxDoubles > 0) {
      const options = [{ label: `No — charge ${money(base)}`, value: '0' }];
      for (let i = 1; i <= maxDoubles; i++) {
        options.push({ label: `${i === 1 ? 'Double it' : 'Double it twice'} — charge ${money(base * 2 ** i)}`, value: String(i), hint: `Uses ${i + 1} plays`, primary: i === 1 });
      }
      const pick = await this.hud.choose({ title: 'Double The Rent?', body: `You hold ${doubles.length} Double The Rent card${doubles.length > 1 ? 's' : ''}.`, cards: [doubles[0]], options });
      if (pick == null) return null;
      d = Number(pick);
    }
    return { kind: 'rent', cardId: card.id, color, targetId, doubles: doubles.slice(0, d).map((c) => c.id) };
  }

  propertyGroups(players, selectable) {
    const groups = [];
    for (const p of players) {
      for (const pile of p.piles) {
        const complete = R.isComplete(pile);
        groups.push({
          label: `${p.name} · ${COLORS[pile.color].name}${complete ? ' (full set)' : ''}`,
          items: pile.cards.map((c) => ({ card: c, value: c.id, selectable: selectable(c, pile), meta: { player: p, pile } })),
        });
      }
    }
    return groups;
  }

  async playAction(game, me, card) {
    const base = { kind: 'action', cardId: card.id };
    const opps = R.others(game, me);
    switch (card.action) {
      case 'passgo':
      case 'birthday':
        return base;
      case 'debtcollector': {
        const targetId = await this.choosePlayer(game, me, 'Debt Collector', 'Choose a player to pay you $5M.');
        return targetId == null ? null : { ...base, targetId };
      }
      case 'slydeal': {
        const groups = this.propertyGroups(opps, (c, pile) => !R.isComplete(pile));
        const id = await this.hud.pickCards({ title: 'Sly Deal', body: 'Pick a property to steal. Cards in full sets are locked.', groups });
        if (id == null) return null;
        const owner = opps.find((o) => R.findPile(o, id));
        return { ...base, targetId: owner.id, targetCardId: id };
      }
      case 'forceddeal': {
        const theirs = await this.hud.pickCards({
          title: 'Forced Deal — take',
          body: 'Pick the property you want. Cards in full sets are locked.',
          groups: this.propertyGroups(opps, (c, pile) => !R.isComplete(pile)),
        });
        if (theirs == null) return null;
        const mine = await this.hud.pickCards({
          title: 'Forced Deal — give',
          body: 'Pick one of your properties to give in exchange.',
          groups: this.propertyGroups([me], () => true),
        });
        if (mine == null) return null;
        const owner = opps.find((o) => R.findPile(o, theirs));
        return { ...base, targetId: owner.id, targetCardId: theirs, myCardId: mine };
      }
      case 'dealbreaker': {
        const groups = [];
        for (const o of opps) {
          for (const pile of o.piles.filter(R.isComplete)) {
            const items = [...pile.cards, pile.house, pile.hotel].filter(Boolean).map((c) => ({ card: c, value: `${o.id}:${pile.id}` }));
            groups.push({ label: `${o.name} · ${COLORS[pile.color].name} set · rent ${money(R.pileRent(pile))}`, items });
          }
        }
        const pick = await this.hud.pickCards({ title: 'Deal Breaker', body: `${CLICK} a complete set to take it — buildings included.`, groups });
        if (pick == null) return null;
        const [targetId, pileId] = pick.split(':').map(Number);
        return { ...base, targetId, pileId };
      }
      case 'house':
      case 'hotel': {
        const targets = R.buildingTargets(me, card.action);
        if (targets.length === 1) return { ...base, pileId: targets[0].id };
        const pileId = await this.hud.choose({
          title: `Build a ${card.action}`,
          body: 'Choose a complete set.',
          options: targets.map((p) => ({ label: `${COLORS[p.color].name} — rent ${money(R.pileRent(p))}`, value: p.id, swatch: COLORS[p.color].hex })),
        });
        return pileId == null ? null : { ...base, pileId };
      }
    }
    return null;
  }

  // ---------- responses during any turn ----------

  async choosePayment(game, me, amount, creditor, reason) {
    const groups = [{ label: 'Bank', items: me.bank.map((c) => ({ card: c, value: c.id })) }];
    for (const pile of me.piles) {
      const items = [...pile.cards, pile.house, pile.hotel]
        .filter(Boolean)
        .map((c) => ({ card: c, value: c.id, selectable: c.value > 0, note: c.value > 0 ? null : 'no value' }));
      groups.push({ label: `${COLORS[pile.color].name}${R.isComplete(pile) ? ' (full set)' : ''}`, items });
    }
    const payable = R.payableCards(me);
    const ids = await this.hud.pickCards({
      title: `Pay ${creditor.name} ${money(amount)}`,
      body: `For ${reason}. Choose cards from your bank and/or table. No change is given.`,
      groups,
      mode: 'multi',
      cancel: false,
      confirmLabel: 'Pay',
      suggest: () => autoPayment(me, amount).map((c) => c.id),
      validate: (sel) => {
        const total = R.sum(payable.filter((c) => sel.includes(c.id)));
        return { ok: total >= amount, text: `Selected ${money(total)} of ${money(amount)}${total > amount ? ` (overpaying ${money(total - amount)})` : ''}` };
      },
    });
    return ids;
  }

  describeThreat(ctx) {
    const a = ctx.actor.name;
    switch (ctx.kind) {
      case 'rent': return `${a} charges you ${money(ctx.amount)} ${COLORS[ctx.color].name} rent.`;
      case 'birthday': return `${a} wants ${money(2)} for their birthday.`;
      case 'debtcollector': return `${a} is collecting a ${money(5)} debt from you.`;
      case 'slydeal': return `${a} wants to steal your ${describeCard(ctx.targetCard)}.`;
      case 'forceddeal': return `${a} wants to swap their ${describeCard(ctx.giveCard)} for your ${describeCard(ctx.targetCard)}.`;
      case 'dealbreaker': return `${a} wants to take your entire ${COLORS[ctx.pile.color].name} set!`;
      default: return `${a} played an action against you.`;
    }
  }

  async chooseJustSayNo(game, me, ctx) {
    const cards = [ctx.card];
    if (ctx.targetCard) cards.push(ctx.targetCard);
    const body = ctx.blocking
      ? `${this.describeThreat(ctx)} Do you want to play Just Say No?`
      : `${ctx.target.name} said "Just Say No!" to your ${ctx.card.name}. Play your own Just Say No to push it through?`;
    const v = await this.hud.choose({
      title: ctx.blocking ? 'Just Say No?' : 'Counter their Just Say No?',
      body,
      cards,
      cancel: false,
      peek: true,
      options: [
        { label: '✋ Just Say No!', value: 'yes', primary: true },
        { label: ctx.blocking ? 'Accept' : 'Let it go', value: 'no' },
      ],
    });
    return v === 'yes';
  }

  async chooseDiscards(game, me, count) {
    return this.hud.pickCards({
      title: `Discard ${count} card${count > 1 ? 's' : ''}`,
      body: `You can hold at most ${R.HAND_LIMIT} cards at the end of your turn.`,
      groups: [{ label: 'Your hand', items: me.hand.map((c) => ({ card: c, value: c.id, flipped: false })) }],
      mode: 'multi',
      cancel: false,
      confirmLabel: 'Discard',
      validate: (sel) => ({ ok: sel.length === count, text: `Selected ${sel.length} of ${count}` }),
    });
  }
}
