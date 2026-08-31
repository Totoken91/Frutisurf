import type { GameState } from '../core/GameState';
import { MAX_TIME, type Run } from '../core/Run';

/**
 * Toute l'interface, en DOM.
 *
 * DOM plutot que du rendu dans la scene : c'est net a toute densite de pixels,
 * ca ne coute pas une passe, et surtout ca ne traverse PAS le post-traitement.
 * Un chiffre qui prendrait le flou radial et l'aberration chromatique serait
 * illisible exactement quand on en a le plus besoin, a pleine vitesse.
 *
 * Regle de lecture : trois zones fixes, et rien d'autre ne bouge.
 *  - a gauche, l'etat de la machine (vitesse, boost) ;
 *  - au centre, l'ENJEU (le chrono) ;
 *  - a droite, la recompense (score, record).
 * Tout le reste est transitoire et disparait : popups, banniere, multiplicateur.
 */

const NBSP = ' ';

function money(v: number): string {
  return Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

export class Hud {
  private speedVal: HTMLElement;
  private boostBar: HTMLElement;
  private boostFill: HTMLElement;
  private scoreEl: HTMLElement;
  private bestEl: HTMLElement;
  private clockEl: HTMLElement;
  private clockBox: HTMLElement;
  private multEl: HTMLElement;
  private bannerEl: HTMLElement;
  private popRoot: HTMLElement;
  private overEl: HTMLElement;
  private hintEl: HTMLElement;
  private clockFill: HTMLElement;
  private multVal: HTMLElement;

  private acc = 0;
  private lastBoost = 0;
  private gainTimer = 0;
  private bannerTimer = 0;
  private lastScoreShown = -1;
  private lastClock = '';
  /**
   * Pool RESIDENT de points volants.
   *
   * L'ancienne version creait puis retirait un noeud a chaque gain. Au-dessus
   * d'un canvas WebGL plein ecran, insérer et supprimer des elements dans une
   * couche superposee force le navigateur a recomposer l'arbre de couches — et
   * sur telephone chaque recomposition peut coûter une image. Les noeuds sont
   * desormais crees une fois et recycles ; seule leur animation change.
   */
  private popPool: HTMLElement[] = [];
  private popNext = 0;
  private now = 0;

  constructor(private root: HTMLElement) {
    root.innerHTML = `
      <div class="bubbles" aria-hidden="true"><i></i><i></i><i></i></div>

      <div class="topband">
        <div class="cell">
          <div class="pod speedpod">
            <div class="in">
              <span class="speedVal" data-el="speed">0</span>
              <span class="speedUnit">KM/H</span>
            </div>
          </div>
          <div class="gauge" data-el="boost">
            <div class="in"><i class="fill" data-el="fill"><u class="stripes"></u></i></div>
            <div class="gloss"></div>
          </div>
        </div>

        <div class="pod clockpod" data-el="clockBox">
          <div class="in">
            <span class="clockVal" data-el="clock">30.0</span>
          </div>
          <div class="clockbar"><i data-el="clockfill"></i></div>
        </div>

        <div class="scorestack">
          <div class="score" data-el="score">0</div>
          <div class="best" data-el="best"></div>
        </div>
      </div>

      <div class="mult" data-el="mult"><b data-el="multVal"></b></div>
      <div class="banner" data-el="banner"></div>
      <div class="pops" data-el="pops"></div>
      <div class="hint" data-el="hint">
        maintiens pour armer · relâche au sommet · 2 doigts = boost
      </div>
      <div class="over" data-el="over"></div>
    `;
    const pick = (n: string): HTMLElement => root.querySelector<HTMLElement>(`[data-el="${n}"]`)!;
    this.speedVal = pick('speed');
    this.boostBar = pick('boost');
    this.boostFill = pick('fill');
    this.scoreEl = pick('score');
    this.bestEl = pick('best');
    this.clockEl = pick('clock');
    this.clockBox = pick('clockBox');
    this.multEl = pick('mult');
    this.bannerEl = pick('banner');
    this.popRoot = pick('pops');
    this.overEl = pick('over');
    this.hintEl = pick('hint');
    this.clockFill = pick('clockfill');
    this.multVal = pick('multVal');

    for (let i = 0; i < 14; i++) {
      const el = document.createElement('div');
      el.className = 'pop';
      el.style.opacity = '0';
      this.popRoot.appendChild(el);
      this.popPool.push(el);
    }
  }

  /** Le rappel de commandes s'efface des que le joueur a saute une fois. */
  dismissHint(): void {
    this.hintEl.classList.add('gone');
  }

  /**
   * Points qui montent depuis le point du monde ou ils ont ete gagnes.
   * La recompense doit apparaitre LA ou l'action a eu lieu, pas dans un coin :
   * c'est ce qui relie le geste au gain sans que l'oeil quitte le jeu.
   */
  pop(text: string, x: number, y: number, kind = ''): void {
    const el = this.popPool[this.popNext];
    this.popNext = (this.popNext + 1) % this.popPool.length;
    el.className = `pop ${kind}`;
    el.textContent = text;

    // La POSITION passe par le transform, pas par left/top : ainsi toute
    // l'animation reste sur le compositeur, sans une seule mise en page.
    const at = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    const frames: Keyframe[] = [
      { opacity: 0, transform: `${at} translate(-50%, -30%) scale(0.7)`, offset: 0 },
      { opacity: 1, transform: `${at} translate(-50%, -55%) scale(1.12)`, offset: 0.18 },
      { opacity: 0, transform: `${at} translate(-50%, -150%) scale(0.95)`, offset: 1 },
    ];
    if (typeof el.animate !== 'function') {
      // Navigateur sans API Web Animations : le point ne s'anime pas, mais il
      // ne doit surtout pas rester colle a l'ecran.
      el.style.opacity = '0';
      return;
    }
    for (const a of el.getAnimations?.() ?? []) a.cancel();
    el.animate(frames, {
      duration: 950,
      easing: 'cubic-bezier(0.15, 0.75, 0.3, 1)',
      fill: 'forwards',
    });
  }

  /** Banniere centrale : figures et anneaux hauts. Rare, donc lisible. */
  banner(title: string, sub = '', kind = ''): void {
    this.bannerEl.className = `banner show ${kind}`;
    this.bannerEl.innerHTML = `<b>${title}</b>${sub ? `<i>${sub}</i>` : ''}`;
    this.bannerTimer = 1.15;
  }

  showOver(run: Run, distance: number): void {
    const record = run.recordBeaten;
    this.overEl.innerHTML = `
      <div class="panel">
        <div class="in">
          ${record ? '<div class="record">nouveau record</div>' : ''}
          <div class="final">${money(run.finalScore)}</div>
          <div class="stats">
            <span>${money(distance)} m</span>
            <span>${run.rings} anneaux</span>
            <span>×${run.bestCombo}</span>
          </div>
          <div class="bestline">record ${money(run.best)}</div>
          <div class="again"><u>rejouer</u></div>
        </div>
      </div>
    `;
    this.overEl.classList.add('show');
    // On eteint tout le transitoire : le chrono a zero, le multiplicateur et le
    // rappel de commandes n'ont plus rien a dire, et ils tirent l'oeil loin du
    // seul chiffre qui compte a cet instant.
    this.root.classList.add('ended');
  }

  hideOver(): void {
    this.overEl.classList.remove('show');
    this.root.classList.remove('ended');
    this.bannerEl.className = 'banner';
    this.lastScoreShown = -1;
    this.multVal.textContent = '';
  }

  update(s: GameState, run: Run, dt: number): void {
    this.now += dt;

    if (this.gainTimer > 0) {
      this.gainTimer -= dt;
      if (this.gainTimer <= 0) this.boostBar.classList.remove('gain');
    }
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.classList.remove('show');
    }

    // Le chrono est le seul element lu en continu : il se met a jour a chaque
    // frame. Tout le reste passe par l'echantillonnage a 20 Hz plus bas.
    const t = run.timeLeft;
    const txt = t >= 10 ? t.toFixed(1) : t.toFixed(2);
    if (txt !== this.lastClock) {
      this.lastClock = txt;
      this.clockEl.textContent = txt;
    }
    this.clockBox.classList.toggle('warn', t < 8 && run.phase === 'running');
    this.clockBox.classList.toggle('crit', t < 4 && run.phase === 'running');
    this.clockBox.classList.toggle('gain', run.gainFlash > 0.02);

    // La jauge est ecrite a chaque image, pas a 20 Hz : `transform` ne coute
    // qu'une composition, et ca evite d'avoir a lisser avec une transition CSS.
    this.boostFill.style.transform = `scaleX(${s.boost.toFixed(3)})`;
    // La barre du chrono donne la PROPORTION restante, que le nombre seul ne
    // donne jamais : « il m'en reste un tiers » se lit d'un coup d'oeil, « 14,2 »
    // demande de savoir sur combien.
    this.clockFill.style.transform = `scaleX(${Math.min(1, t / MAX_TIME).toFixed(3)})`;

    this.acc += dt;
    if (this.acc < 0.05) return;
    const step = this.acc;
    this.acc = 0;

    // km/h plutot que m/s : 24 m/s se lit mieux comme "86".
    this.speedVal.textContent = String(Math.round(s.speed * 3.6));
    this.boostBar.classList.toggle('spending', s.boosting);
    this.boostBar.classList.toggle('empty', s.boost < 0.06);

    const shown = Math.round(s.score);
    if (shown !== this.lastScoreShown) {
      this.lastScoreShown = shown;
      this.scoreEl.textContent = money(shown);
    }
    this.scoreEl.classList.toggle('record', run.recordBeaten);
    this.bestEl.textContent = run.best > 0 ? `record ${money(run.best)}` : '';

    // Le multiplicateur n'apparait qu'a partir de x1,4 : affiche a x1 en
    // permanence, il devient du decor et on cesse de le voir monter.
    const m = s.mult;
    if (m >= 1.35) {
      const label = `×${m.toFixed(1)}`;
      if (label !== this.multVal.textContent) {
        this.multVal.textContent = label;
        this.multEl.classList.remove('bump');
        void this.multEl.offsetWidth;
        this.multEl.classList.add('bump');
      }
      this.multEl.classList.add('on');
    } else {
      this.multEl.classList.remove('on');
    }

    // La vrille en cours se lit en l'air : sans compteur, on ne sait pas si le
    // tour est boucle et on atterrit toujours a un cheveu du compte.
    if (s.airborne && s.spinTurns > 0.25) {
      this.bannerEl.className = 'banner show spin';
      this.bannerEl.innerHTML = `<b>${Math.floor(s.spinTurns * 360 / 90) * 90}°</b>`;
      this.bannerTimer = Math.max(this.bannerTimer, 0.2);
    }

    const gained = s.boost - this.lastBoost;
    if (gained > 0.02 + step * 0.05 && this.gainTimer <= 0) {
      this.boostBar.classList.remove('gain');
      void this.boostBar.offsetWidth;
      this.boostBar.classList.add('gain');
      this.gainTimer = 0.34;
    }
    this.lastBoost = s.boost;
  }
}
