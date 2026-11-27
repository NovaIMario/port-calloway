// The shop counter: a list of what is for sale. Works with the mouse, the keyboard (arrow keys,
// Enter, Escape), touch and a gamepad (d-pad, A to buy, B to leave).
import { SHOP_INFO } from './shops.js';

const $ = (id) => document.getElementById(id);
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const money = (n) => '$' + Math.round(n).toLocaleString('en-GB');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export class ShopUI {
  // game: { shopRows(), buy(id), closeShop(), world }
  constructor(game) {
    this.game = game;
    this.el = $('shop');
    this.list = $('shop-list');
    this.shop = null;
    this.focus = 0;
    $('shop-close').onclick = () => this.close();
    this.el.addEventListener('click', (e) => { if (e.target === this.el) this.close(); }); // a click outside the counter
    this.list.addEventListener('click', (e) => {
      const b = e.target.closest('.shop-row');
      if (!b) return;
      this.focus = [...this.list.children].indexOf(b);
      this.buy(b.dataset.id);
    });
    // keys pressed in the shop stay in the shop (Escape here must not pause the game). Key-ups
    // still reach the game, so a key held on the way in is not stuck down on the way out.
    this.el.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.move(e.key === 'ArrowDown' ? 1 : -1); }
    });
  }

  get open() { return !!this.shop; }

  show(shop) {
    this.shop = shop;
    const info = SHOP_INFO[shop.kind] || { title: shop.name, tag: '' };
    $('shop-title').textContent = shop.name || info.title;
    $('shop-tag').textContent = info.tag;
    $('shop-msg').textContent = '';
    this.el.hidden = false;
    this.focus = 0;
    this.render();
    document.exitPointerLock?.();
  }

  close() {
    if (!this.shop) return;
    this.shop = null;
    this.el.hidden = true;
    this.game.closeShop();
  }

  render() {
    const p = this.game.world.player;
    $('shop-cash').textContent = money(p.cash);
    const rows = this.game.shopRows();
    this.list.innerHTML = rows.map((r) => {
      const sw = r.swatch ? `<span class="shop-swatch" style="background:${hex(r.swatch.shirt)}"></span>` : '<span class="shop-swatch none"></span>';
      const stats = r.stats ? `<div class="shop-stats">${['speed', 'accel', 'grip'].map((k) => `<span>${k === 'accel' ? 'Acceleration' : k[0].toUpperCase() + k.slice(1)}<b role="meter" aria-valuemin="0" aria-valuemax="10" aria-valuenow="${r.stats[k]}" style="--v:${r.stats[k]}"></b></span>`).join('')}</div>` : '';
      const price = r.price ? `<div class="shop-price">${money(r.price)}</div>` : '';
      return `<button class="shop-row${r.danger ? ' danger' : ''}" data-id="${esc(r.id)}" aria-disabled="${!!r.disabled}">
        ${sw}<div><div class="shop-name">${esc(r.name)}</div><div class="shop-desc">${esc(r.desc)}</div>${stats}</div>
        <div class="shop-buy">${price}<div class="shop-label">${esc(r.label)}</div>${r.note ? `<div class="shop-note">${esc(r.note)}</div>` : ''}</div>
      </button>`;
    }).join('');
    this.move(0);
  }

  move(d) {
    const rows = [...this.list.querySelectorAll('.shop-row')];
    if (!rows.length) { $('shop-close').focus(); return; }
    this.focus = (this.focus + d + rows.length) % rows.length;
    rows[this.focus].focus();
    rows[this.focus].scrollIntoView({ block: 'nearest' });
  }

  buy(id) {
    if (!this.shop) return;
    const r = this.game.buy(id);
    if (!this.shop) return; // a hold-up ends the visit
    $('shop-msg').textContent = r.msg || '';
    this.render();
  }

  // The gamepad, polled once a frame while the shop is open.
  pad(ui) {
    if (!this.shop || !ui) return;
    if (ui.up) this.move(-1);
    if (ui.down) this.move(1);
    if (ui.ok) { const b = this.list.querySelectorAll('.shop-row')[this.focus]; if (b) this.buy(b.dataset.id); }
    if (ui.back) this.close();
  }
}
