import type { GameState } from '../core/GameState';

/**
 * Le HUD. DOM + CSS, pas de framework : React couterait des frames pour
 * zero benefice ici (docs/02 §1).
 *
 * Lecture a 20 Hz et non a 120 : c'est du DOM, et l'oeil ne lit pas un
 * compteur plus vite que ca (docs/02 §6).
 */

const ICONS = {
  person:
    '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="7.6" r="4.1"/><path d="M3.4 21.5c0-4.6 3.9-7.6 8.6-7.6s8.6 3 8.6 7.6z"/></svg>',
  mail:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2.4"/><path d="M3 7l9 6 9-6"/></svg>',
  globe:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3.2 9h17.6M3.2 15h17.6"/></svg>',
  power:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 3v9"/><path d="M6.8 6.6a8 8 0 1 0 10.4 0"/></svg>',
  pc:
    '<svg viewBox="0 0 24 24" fill="#fff8e6" stroke="#8a5410" stroke-width="1.3" stroke-linejoin="round"><rect x="2.6" y="4" width="18.8" height="12.4" rx="1.5"/><rect x="4.6" y="6" width="14.8" height="8.4" rx="0.7" fill="#2f9fd8"/><path d="M8 20h8l-1-3.6H9z"/></svg>',
};

const DAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const XP_PER_LEVEL = 5000;

export class Hud {
  private el: Record<string, HTMLElement> = {};
  private acc = 0;
  private lastCombo = 0;
  private started = false;

  onStart: (() => void) | null = null;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <div class="top">
        <div class="stack">
          <div class="aero player row">
            <div class="avatar">${ICONS.person}</div>
            <div class="stack" style="flex:1">
              <div class="row" style="justify-content:space-between">
                <span class="label">Aero Player</span>
                <span class="badge" data-el="level">1</span>
              </div>
              <div class="bar xp"><i data-el="xpFill"></i></div>
              <span class="barText" data-el="xpText">XP 0 / ${XP_PER_LEVEL.toLocaleString('en-US')}</span>
            </div>
          </div>
          <div class="bar slim" style="margin-left:.4em;width:min(46vw,15em)"><i data-el="chargeFill"></i></div>
        </div>

        <div class="stack" style="align-items:flex-end">
          <div class="aero weather row">
            <div class="sun"></div>
            <div>
              <div class="wTime" data-el="time">--:--</div>
              <div class="wDate" data-el="date"></div>
              <div class="wTemp">24&deg;C</div>
            </div>
          </div>
          <div class="aero speed">
            <div class="speedVal" data-el="speed">0</div>
            <div class="speedUnit">km/h</div>
          </div>
          <div class="aero combo" data-el="combo">COMBO x2</div>
        </div>
      </div>

      <div class="bottom">
        <div class="stack">
          <span class="barText" data-el="stats">0 m &middot; 0 bulles</span>
          <span class="caption"><b>Frutiger</b> Surfer &hellip;</span>
        </div>
        <div class="stack" style="align-items:flex-end">
          <div class="aero dock row">
            <button type="button" tabindex="-1" aria-hidden="true">${ICONS.person}</button>
            <button type="button" tabindex="-1" aria-hidden="true">${ICONS.mail}</button>
            <button type="button" tabindex="-1" aria-hidden="true">${ICONS.globe}</button>
            <button type="button" tabindex="-1" aria-hidden="true">${ICONS.power}</button>
          </div>
          <div class="xpIcon">${ICONS.pc}</div>
        </div>
      </div>

      <div id="start">
        <div class="aero startCard">
          <h1>Frutiger Surfer</h1>
          <p>Un bonhomme MSN en verre surfe sur un CD a travers des plaines
             d'herbe electrique, vers une ville de cristal.</p>
          <p><b>Tiens un virage</b> pour charger la carre, <b>relache</b> pour
             liberer la poussee. Enchaine pour monter le combo.</p>
          <div class="keys">
            <span class="key">&larr; &rarr; diriger</span>
            <span class="key">Espace sauter</span>
            <span class="key">Maj boost</span>
          </div>
          <p class="pulse" style="margin-top:1.1em"><b>Clique ou appuie pour glisser</b></p>
        </div>
      </div>
    `;

    root.querySelectorAll<HTMLElement>('[data-el]').forEach((n) => {
      this.el[n.dataset.el!] = n;
    });

    const start = root.querySelector<HTMLElement>('#start')!;
    this.el.start = start;
    const go = (): void => {
      if (this.started) return;
      this.started = true;
      start.classList.add('hidden');
      this.onStart?.();
    };
    start.addEventListener('pointerdown', go);
    addEventListener('keydown', go, { once: true });
  }

  update(s: GameState, dt: number): void {
    this.acc += dt;
    if (this.acc < 0.05) return;
    this.acc = 0;

    // Vitesse affichee en km/h : 24 m/s se lit mieux comme "86" que comme "24".
    this.el.speed.textContent = String(Math.round(s.speed * 3.6));

    const xp = Math.floor(s.score);
    const level = Math.floor(xp / XP_PER_LEVEL) + 1;
    const into = xp % XP_PER_LEVEL;
    this.el.level.textContent = String(level);
    this.el.xpFill.style.width = `${(into / XP_PER_LEVEL) * 100}%`;
    this.el.xpText.textContent = `XP ${into.toLocaleString('en-US')} / ${XP_PER_LEVEL.toLocaleString('en-US')}`;

    this.el.chargeFill.style.width = `${s.carveCharge * 100}%`;

    this.el.stats.innerHTML = `${Math.floor(s.distance).toLocaleString('en-US')} m &middot; ${s.bubbles} bulles`;

    const combo = this.el.combo;
    if (s.combo >= 2) {
      combo.textContent = `COMBO x${s.combo}`;
      combo.classList.add('on');
      if (s.combo !== this.lastCombo) {
        combo.classList.remove('pop');
        void combo.offsetWidth; // force le redemarrage de l'animation
        combo.classList.add('pop');
      }
    } else {
      combo.classList.remove('on');
    }
    this.lastCombo = s.combo;

    const now = new Date();
    let h = now.getHours();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12 || 12;
    this.el.time.textContent = `${h}:${String(now.getMinutes()).padStart(2, '0')} ${ampm}`;
    this.el.date.textContent = `${DAYS[now.getDay()]}, ${MONTHS[now.getMonth()]} ${now.getDate()}`;
  }
}
