import type { GameState } from '../core/GameState';

/**
 * Les deux seules jauges de l'ecran : vitesse et boost.
 *
 * DOM + CSS plutot que du rendu dans la scene : c'est net a toute densite de
 * pixels, ca ne coute pas une passe de rendu, et ca ne traverse pas le
 * post-processing (une jauge qui prendrait le flou radial serait illisible).
 *
 * Lecture a 20 Hz : c'est du DOM, et l'oeil ne lit pas un compteur plus vite.
 */
export class Gauges {
  private speedVal: HTMLElement;
  private boostBar: HTMLElement;
  private boostFill: HTMLElement;
  private acc = 0;
  private lastBoost = 0;
  private gainTimer = 0;

  constructor(root: HTMLElement) {
    root.innerHTML = `
      <div class="aero speed">
        <span class="speedVal" data-el="speed">0</span>
        <span class="speedUnit">KM/H</span>
      </div>
      <div class="aero boost" data-el="boost"><i data-el="fill"></i></div>
    `;
    const pick = (n: string): HTMLElement => root.querySelector<HTMLElement>(`[data-el="${n}"]`)!;
    this.speedVal = pick('speed');
    this.boostBar = pick('boost');
    this.boostFill = pick('fill');
  }

  update(s: GameState, dt: number): void {
    if (this.gainTimer > 0) {
      this.gainTimer -= dt;
      if (this.gainTimer <= 0) this.boostBar.classList.remove('gain');
    }

    this.acc += dt;
    if (this.acc < 0.05) return;
    const step = this.acc;
    this.acc = 0;

    // km/h plutot que m/s : 24 m/s se lit mieux comme "86".
    this.speedVal.textContent = String(Math.round(s.speed * 3.6));
    this.boostFill.style.width = `${s.boost * 100}%`;
    this.boostBar.classList.toggle('spending', s.boosting);
    this.boostBar.classList.toggle('empty', s.boost < 0.06);

    // Un gain NET fait flasher le contour. Le seuil tient compte du pas de
    // temps, sinon la recharge passive declencherait le flash en continu.
    const gained = s.boost - this.lastBoost;
    if (gained > 0.02 + step * 0.05 && this.gainTimer <= 0) {
      this.boostBar.classList.remove('gain');
      void this.boostBar.offsetWidth; // force le redemarrage de l'animation
      this.boostBar.classList.add('gain');
      this.gainTimer = 0.34;
    }
    this.lastBoost = s.boost;
  }
}
