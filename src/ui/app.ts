import { checkout } from '../payments';
import { composeBill, GOLD_FILTER, PORTRAIT } from '../scene/billTexture';
import { formatWait } from '../quota';
import { PACKS, store, type PackId, type State } from '../state';
import { esc, icons } from './icons';

export interface UiActions {
  /** First click anywhere: audio may start. */
  unlock(): void;
  print(): void;
  /** Large flow finished: remember the owner and print the first bill. */
  finishLarge(): void;
  setSfx(v: number): void;
  setMusic(v: number): void;
}

type Art = CanvasImageSource & { width: number; height: number };

/** Plain DOM over the 3D room: HUD + one modal at a time. */
export class Ui {
  private readonly hud: HTMLDivElement;
  private readonly overlay: HTMLDivElement;
  private readonly countEl: HTMLElement;
  private readonly inkBtn: HTMLButtonElement;
  private readonly soundPanel: HTMLDivElement;

  constructor(root: HTMLElement, private readonly actions: UiActions, private readonly art: Art) {
    this.hud = document.createElement('div');
    this.hud.className = 'hud';
    this.hud.innerHTML = `
      <p class="counter"><strong data-count></strong> bills printed</p>
      <button class="chip ink" data-action="shop">${icons.wallet}<span data-ink></span></button>
      <div class="print">
        <button class="round fast" aria-label="Print twice as fast" aria-pressed="false" data-action="fast">2x</button>
        <button class="primary" data-action="print">Print money</button>
      </div>
      <button class="round sound" aria-label="Sound settings" aria-expanded="false" data-action="sound">${icons.sound}</button>
      <div class="panel sound-panel" hidden>
        <label>${icons.soundSmall}<span>Sound effects</span><output data-sfx></output></label>
        <input type="range" min="0" max="100" data-range="sfx" aria-label="Sound effects volume">
        <label>${icons.music}<span>Music</span><output data-music></output></label>
        <input type="range" min="0" max="100" data-range="music" aria-label="Music volume">
      </div>`;
    root.appendChild(this.hud);
    this.countEl = this.hud.querySelector('[data-count]')!;
    this.inkBtn = this.hud.querySelector('.ink')!;
    this.soundPanel = this.hud.querySelector('.sound-panel')!;

    this.overlay = document.createElement('div');
    this.overlay.className = 'overlay';
    this.overlay.hidden = true;
    root.appendChild(this.overlay);

    root.addEventListener('click', (e) => this.onClick(e), true);
    root.addEventListener('input', (e) => this.onInput(e));
    root.addEventListener('change', (e) => this.onChange(e));
    // Drag a photo onto the drop zone.
    this.overlay.addEventListener('dragover', (e) => {
      const zone = (e.target as HTMLElement).closest('.drop');
      if (!zone) return;
      e.preventDefault();
      zone.classList.add('dragging');
    });
    this.overlay.addEventListener('dragleave', (e) => (e.target as HTMLElement).closest('.drop')?.classList.remove('dragging'));
    this.overlay.addEventListener('drop', (e) => {
      const file = e.dataTransfer?.files[0];
      if (!(e.target as HTMLElement).closest('.drop') || !file) return;
      e.preventDefault();
      this.loadPhoto(file);
    });
    // Drag the photo inside the circle of the preview bill.
    let dragFrom: { x: number; y: number } | null = null;
    this.overlay.addEventListener('pointerdown', (e) => {
      const c = e.target as HTMLElement;
      if (!c.matches('[data-preview]') || !store.state.photo) return;
      c.setPointerCapture(e.pointerId);
      dragFrom = { x: e.clientX, y: e.clientY };
    });
    this.overlay.addEventListener('pointermove', (e) => {
      const s = store.state;
      if (!dragFrom || !s.photo) return;
      const r = (e.target as HTMLElement).getBoundingClientRect();
      // Circle size on screen, and how far the zoomed photo overhangs it.
      const cw = r.width * PORTRAIT.rx * 2, ch = r.height * PORTRAIT.ry * 2;
      const k = Math.max(cw / s.photo.width, ch / s.photo.height) * s.zoom;
      const roomX = (s.photo.width * k - cw) / 2, roomY = (s.photo.height * k - ch) / 2;
      const clamp = (v: number): number => Math.max(-1, Math.min(1, v));
      store.set({
        panX: roomX > 0.5 ? clamp(s.panX + (e.clientX - dragFrom.x) / roomX) : 0,
        panY: roomY > 0.5 ? clamp(s.panY + (e.clientY - dragFrom.y) / roomY) : 0,
      });
      dragFrom = { x: e.clientX, y: e.clientY };
      this.drawPreview();
    });
    const endDrag = (): void => { dragFrom = null; };
    this.overlay.addEventListener('pointerup', endDrag);
    this.overlay.addEventListener('pointercancel', endDrag);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && store.state.screen !== 'room') store.set({ screen: 'room', shared: false });
    });

    store.subscribe((s, prev) => this.sync(s, prev));
    this.sync(store.state, null);
  }

  private sync(s: State, prev: State | null): void {
    this.countEl.textContent = s.count.toLocaleString('en-US');
    this.hud.querySelector('.fast')!.setAttribute('aria-pressed', String(s.fast));
    const ink = s.free + s.paid;
    this.inkBtn.querySelector('[data-ink]')!.textContent = String(ink);
    this.inkBtn.setAttribute('aria-label', `Ink shop, ${ink} prints left`);
    this.soundPanel.hidden = !s.soundOpen;
    this.hud.querySelector('.sound')!.setAttribute('aria-expanded', String(s.soundOpen));
    (this.hud.querySelector('[data-sfx]') as HTMLOutputElement).value = `${s.sfx}%`;
    (this.hud.querySelector('[data-music]') as HTMLOutputElement).value = `${s.music}%`;
    (this.hud.querySelector('[data-range="sfx"]') as HTMLInputElement).value = String(s.sfx);
    (this.hud.querySelector('[data-range="music"]') as HTMLInputElement).value = String(s.music);

    const changed = !prev || s.screen !== prev.screen || s.pack !== prev.pack || s.shared !== prev.shared
      || s.photo !== prev.photo || s.openBill !== prev.openBill;
    if (changed) this.renderOverlay(s);
  }

  // ---------------------------------------------------------------- events

  private onClick(e: Event): void {
    this.actions.unlock();
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!el) return;
    const s = store.state;
    switch (el.dataset.action) {
      case 'print': this.actions.print(); break;
      case 'fast': store.set({ fast: !store.state.fast }); break;
      case 'shop': store.set({ screen: 'shop', soundOpen: false }); break;
      case 'sound': store.set({ soundOpen: !s.soundOpen }); break;
      case 'close': store.set({ screen: 'room', shared: false }); break;
      case 'pack': store.set({ pack: el.dataset.pack as PackId }); break;
      case 'to-pay': store.set({ screen: 'pay' }); break;
      case 'back-shop': store.set({ screen: 'shop' }); break;
      case 'pay': void this.pay(el as HTMLButtonElement); break;
      case 'choose-photo': (this.overlay.querySelector('[data-file]') as HTMLInputElement).click(); break;
      case 'use-camera': (this.overlay.querySelector('[data-camera]') as HTMLInputElement).click(); break;
      case 'skip-photo': store.set({ photo: null, screen: 'preview' }); break;
      case 'to-photo': store.set({ screen: 'photo' }); break;
      case 'finish': this.actions.finishLarge(); break;
      case 'share': void this.share(); break;
      case 'get-large': store.set({ pack: 'large', screen: 'shop', shared: false }); break;
    }
  }

  private onInput(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (t.dataset.range === 'sfx') { store.set({ sfx: +t.value }); this.actions.setSfx(+t.value / 100); }
    if (t.dataset.range === 'music') { store.set({ music: +t.value }); this.actions.setMusic(+t.value / 100); }
    if (t.dataset.range === 'zoom') { store.set({ zoom: +t.value / 100 }); this.drawPreview(); }
    if (t.dataset.field === 'name') store.set({ name: t.value });
    if (t.dataset.field === 'link') store.set({ link: t.value });
    if (t.dataset.field === 'text') {
      store.set({ text: t.value });
      this.overlay.querySelector('[data-text-count]')!.textContent = `${t.value.length} / 140`;
    }
  }

  private onChange(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (!(t.dataset.file !== undefined || t.dataset.camera !== undefined) || !t.files?.[0]) return;
    this.loadPhoto(t.files[0]);
  }

  private loadPhoto(file: File): void {
    if (!file.type.startsWith('image/')) { alert('Choose an image file.'); return; }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => store.set({ photo: img, zoom: 1.4, panX: 0, panY: 0, screen: 'preview' });
    img.onerror = () => alert('That file could not be read. Try a JPG or PNG.');
    img.src = url;
  }

  private async pay(btn: HTMLButtonElement): Promise<void> {
    const pack = PACKS[store.state.pack];
    btn.disabled = true;
    btn.textContent = 'Opening checkout…';
    const r = await checkout(pack);
    if (r === 'redirect') return; // the page is leaving for Stripe
    if (r === 'failed') { btn.disabled = false; btn.textContent = `Pay ${pack.price}`; return; }
    this.afterPurchase(pack.id);
  }

  /** Ink is in the wallet: Large goes on to the photo step, the others back to the room. */
  afterPurchase(id: PackId): void {
    const photo = !!PACKS[id].photo;
    store.set({ pack: id, mine: photo ? store.state.mine : null, screen: photo ? 'photo' : 'room' });
  }

  private async share(): Promise<void> {
    const b = store.state.openBill;
    const url = `${location.origin}${location.pathname}?bill=${b?.id ?? ''}`;
    try {
      if (navigator.share) await navigator.share({ title: 'My bill on The Money Printer', url });
      else await navigator.clipboard.writeText(url);
      store.set({ shared: true });
    } catch { /* user cancelled */ }
  }

  // --------------------------------------------------------------- screens

  private renderOverlay(s: State): void {
    this.overlay.hidden = s.screen === 'room';
    if (s.screen === 'room') { this.overlay.innerHTML = ''; return; }
    const body = {
      shop: () => this.shop(s),
      pay: () => this.payScreen(s),
      photo: () => this.photo(),
      preview: () => this.preview(s),
      bill: () => this.bill(s),
    }[s.screen]();
    const wide = s.screen === 'preview' ? ' wide' : '';
    this.overlay.innerHTML = `
      <div class="card${wide}" role="dialog" aria-modal="true" aria-labelledby="dlg-title">
        <button class="round close" aria-label="Close" data-action="close">${icons.close}</button>
        ${body}
      </div>`;
    if (s.screen === 'preview') this.drawPreview();
    if (s.screen === 'bill') this.drawBill(s);
    (this.overlay.querySelector('h1, [data-autofocus]') as HTMLElement | null)?.focus?.();
  }

  private steps(s: State): string {
    const large = s.pack === 'large';
    const names = large ? ['Ink', 'Pay', 'Photo', 'Print'] : ['Ink', 'Pay'];
    const current = { shop: 0, pay: 1, photo: 2, preview: 3 }[s.screen as 'shop'] ?? -1;
    return `<ol class="steps" aria-label="Purchase steps">${names
      .map((n, i) => `${i ? `<li aria-hidden="true">${icons.chevron}</li>` : ''}<li ${i === current ? 'aria-current="step" class="on"' : ''}>${i + 1} ${n}</li>`)
      .join('')}</ol>`;
  }

  private shop(s: State): string {
    const ink = s.free + s.paid;
    const pack = PACKS[s.pack];
    const cards = (Object.keys(PACKS) as PackId[]).map((id) => {
      const p = PACKS[id];
      const tag = p.popular
        ? '<span class="tag dark">Most popular</span>'
        : p.photo ? `<span class="tag blue">${icons.camera(12)}Your photo</span>` : '';
      return `<button class="pack${s.pack === id ? ' on' : ''}" aria-pressed="${s.pack === id}" data-action="pack" data-pack="${id}">
        <span class="pack-head"><span>${p.label}</span>${tag}</span>
        <span class="pack-n">${p.prints}</span><span class="muted">prints</span>
        <span class="pack-price">${p.price}</span><span class="small">${p.per}</span>
      </button>`;
    }).join('');
    return `${this.steps(s)}
      <h1 id="dlg-title" tabindex="-1">${ink > 0 ? 'More ink.' : 'Out of ink.'}</h1>
      <p class="lead">The printer needs a new cartridge. With the Large cartridge, your photo goes on the bills.</p>
      ${ink > 0 ? `<div class="balance" aria-label="Your ink balance">${icons.wallet}<span class="muted">Your ink</span><strong>${ink} ${ink === 1 ? 'print' : 'prints'}</strong><span class="grow"></span><span class="muted">${s.free} free · ${s.paid} paid</span></div>` : ''}
      <div class="packs">${cards}</div>
      <div class="actions">
        <button class="primary" data-action="to-pay">Refill for ${pack.price}</button>
        <button class="text" data-action="close">Not now</button>
      </div>
      ${s.free <= 0 && s.freeResetAt ? `<p class="muted center">Free ink refills in ${formatWait(s.freeResetAt - performance.now())}.</p>` : ''}
      <p class="small center">Toy money. Ink only buys prints.</p>`;
  }

  private payScreen(s: State): string {
    const p = PACKS[s.pack];
    return `${this.steps(s)}
      <h1 id="dlg-title" tabindex="-1">Checkout</h1>
      <p class="lead">You pay on Stripe's secure page, then come back here.</p>
      <div class="box summary">
        <div><span>${p.label} ink · ${p.prints} prints</span><strong>${p.price}</strong></div>
        <hr><div class="muted"><span>Total</span><strong>${p.price}</strong></div>
      </div>
      <button class="primary" data-action="pay">Pay ${p.price}</button>
      <button class="text" data-action="back-shop">Back</button>
      <p class="small center">Toy money. Ink only buys prints.</p>`;
  }

  private photo(): string {
    return `${this.steps(store.state)}
      <h1 id="dlg-title" tabindex="-1">Add your photo.</h1>
      <p class="lead">It comes with your Large cartridge. Your photo is printed into the bill, in the same ink as the bill.</p>
      <div class="box drop">
        ${icons.camera(40)}
        <p class="strong">Drop a photo here</p>
        <p class="muted">JPG, PNG or HEIC. A clear face works best.</p>
        <div class="row">
          <button class="primary small-btn" data-action="choose-photo">Choose a photo</button>
          <button class="secondary" data-action="use-camera">Use camera</button>
        </div>
        <input type="file" accept="image/*" data-file hidden>
        <input type="file" accept="image/*" capture="user" data-camera hidden>
      </div>
      <button class="text" data-action="skip-photo">Skip. Print without a photo</button>
      <p class="small center">Everyone can see your bill on the pile. Photos are checked before they appear.</p>`;
  }

  private preview(s: State): string {
    const has = !!s.photo;
    return `${this.steps(s)}
      <h1 id="dlg-title" tabindex="-1">Your bill.</h1>
      <p class="lead">People can tap your bill anywhere in the room. This is what they see.</p>
      <div class="preview">
        <div class="preview-bill">
          <canvas data-preview width="880" height="454" role="img" class="${has ? 'movable' : ''}" aria-label="${has ? 'Gold banknote with your photo. Drag to move the photo.' : 'Gold banknote'}"></canvas>
          ${has ? '<p class="small hint">Drag the photo to move it.</p>' : ''}
          ${has ? `<label class="zoom">Zoom <input type="range" min="100" max="300" value="${Math.round(s.zoom * 100)}" data-range="zoom"></label>` : ''}
          <button class="text" data-action="to-photo">${has ? 'Change photo' : 'Add a photo'}</button>
        </div>
        <div class="fields">
          <label for="f-name">Name</label>
          <input id="f-name" type="text" maxlength="30" autocomplete="name" data-field="name" value="${esc(s.name)}">
          <div class="label-row"><label for="f-text">Short text</label><span class="small" data-text-count>${s.text.length} / 140</span></div>
          <textarea id="f-text" maxlength="140" rows="3" data-field="text">${esc(s.text)}</textarea>
          <label for="f-link">Link</label>
          <input id="f-link" type="url" inputmode="url" placeholder="https://" data-field="link" value="${esc(s.link)}">
          <p class="small">All three are optional. Text and links are checked before they appear.</p>
        </div>
      </div>
      <button class="primary" data-action="finish">Print my ${PACKS.large.prints} bills</button>`;
  }

  private bill(s: State): string {
    const b = s.openBill;
    if (!b) return '';
    const o = b.owner;
    const link = o?.link ? (/^https?:\/\//.test(o.link) ? o.link : `https://${o.link}`) : '';
    return `
      <div class="bill-pop">
        <canvas data-bill width="560" height="236" class="${b.gold ? 'gold' : ''}" role="img" aria-label="${b.gold ? 'Gold' : 'Green'} banknote"></canvas>
        <div>
          <p class="muted">Bill ${b.id.toLocaleString('en-US')} · ${b.gold ? 'gold, paid ink' : 'green, free ink'}</p>
          <h1 id="dlg-title" tabindex="-1">${esc(o?.name || 'Anonymous')}</h1>
          ${o?.text ? `<p class="lead left">${esc(o.text)}</p>` : ''}
          <div class="row">
            ${link ? `<a class="primary small-btn" href="${esc(link)}" target="_blank" rel="noopener noreferrer nofollow">Visit ${esc(link.replace(/^https?:\/\//, '').replace(/\/$/, ''))}</a>` : ''}
            <button class="secondary" data-action="share">${s.shared ? 'Link copied' : 'Share this bill'}</button>
          </div>
        </div>
      </div>
      <div class="foot">
        <button class="text small-text" data-action="get-large">Want your photo on the money? Get the Large ink.</button>
        <button class="text small-text">Report</button>
      </div>`;
  }

  private drawPreview(): void {
    const c = this.overlay.querySelector<HTMLCanvasElement>('[data-preview]');
    if (!c) return;
    const s = store.state;
    const bill = composeBill(this.art, s.photo ? { image: s.photo, zoom: s.zoom, panX: s.panX, panY: s.panY } : undefined);
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.filter = GOLD_FILTER;
    g.drawImage(bill, 0, 0, c.width, c.height);
    g.filter = 'none';
  }

  private drawBill(s: State): void {
    const c = this.overlay.querySelector<HTMLCanvasElement>('[data-bill]');
    const b = s.openBill;
    if (!c || !b) return;
    // The face this very bill was printed with: plain, an animal, or its owner's photo.
    c.getContext('2d')!.drawImage(b.batch.face, 0, 0, c.width, c.height);
  }
}
