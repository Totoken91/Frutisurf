import { clamp, Decay, lerp, Spring, smoothstep } from '../core/Spring';
import type { GameState } from '../core/GameState';
import type { Input } from '../core/Input';

/**
 * La physique de glisse. C'est le fichier le plus important du projet :
 * si les ressorts d'ici sont mauvais, aucun effet visuel ne sauvera le jeu.
 *
 * Principe (docs/03 §1) : la sensation ne vient pas de la vitesse, elle vient
 * du contraste entre RESISTANCE et LIBERATION. Tout est construit autour du
 * cycle charge -> tension -> decharge.
 */

export interface SurfEvents {
  onPop?: (charge: number, combo: number) => void;
  onJump?: () => void;
  onLand?: (impact: number) => void;
  onCarveFull?: () => void;
}

const CORRIDOR = 14;
const GRAVITY = -22;
const JUMP_V = 7.4;

export class Controller {
  // --- Etat cinematique
  x = 0;
  z = 0;
  y = 0;
  vy = 0;
  airborne = false;

  // --- Les deux ressorts qui font tout le feeling.
  // steer est PLUS RAIDE que lean : le disque tourne avant le corps, et le
  // buddy se rattrape. Deux ressorts identiques donneraient un perso en carton.
  readonly steer = new Spring(0, 14, 0.72);
  readonly lean = new Spring(0, 9, 0.55);

  speed = 18;
  carveCharge = 0;
  combo = 0;
  comboTimer = 0;
  score = 0;
  bubbles = 0;
  distance = 0;

  /** Gel de la simulation apres un impact. Le rendu, lui, continue. */
  hitstop = 0;
  /** Impulsions de vitesse issues des pops, amorties independamment. */
  private bonus = new Decay(0.45);
  private carveSign = 0;
  private wasCarving = false;
  private lastLandY = 0;

  constructor(private events: SurfEvents = {}) {}

  private cruise(): number {
    // Progression douce : on ne veut pas d'un mur de difficulte, juste une
    // montee en regime sur les premieres minutes.
    return 22 + Math.min(12, this.distance / 260);
  }

  get speedNorm(): number {
    return smoothstep(20, 52, this.speed);
  }

  step(dt: number, input: Input, boostAllowed = true): void {
    // --- Direction
    this.steer.target = input.steer;
    this.steer.step(dt);
    const st = clamp(this.steer.value, -1.4, 1.4);

    // --- Inclinaison : cible plus molle, et bien plus faible en l'air.
    this.lean.target = st * (this.airborne ? 0.26 : 0.62);
    this.lean.step(dt);

    // --- Charge de carve : uniquement au sol, uniquement en virage franc.
    const carving = !this.airborne && Math.abs(st) > 0.55;
    if (carving) {
      const sign = Math.sign(st);
      // Changer de cote en pleine charge repart de zero : on ne triche pas.
      if (this.carveSign !== 0 && sign !== this.carveSign) this.carveCharge *= 0.35;
      this.carveSign = sign;
      const before = this.carveCharge;
      this.carveCharge = Math.min(1, this.carveCharge + dt * 0.55);
      if (before < 1 && this.carveCharge >= 1) this.events.onCarveFull?.();
    } else {
      this.carveCharge = Math.max(0, this.carveCharge - dt * 1.4);
    }

    // --- LE POP : relachement d'un carve charge.
    if (this.wasCarving && !carving && this.carveCharge > 0.18) {
      this.pop();
    }
    this.wasCarving = carving;

    // --- Vitesse
    const boosting = boostAllowed && input.boostHeld;
    const target = this.cruise() + (boosting ? 13 : 0);
    this.speed += (target - this.speed) * (1 - Math.exp(-2.4 * dt));
    this.bonus.step(dt);
    const effective = Math.min(60, this.speed + this.bonus.value);

    // --- Saut
    if (!this.airborne && input.consumeJump()) {
      this.vy = JUMP_V;
      this.airborne = true;
      this.lastLandY = 0;
      this.events.onJump?.();
    } else if (this.airborne) {
      input.consumeJump(); // pas de double saut : on consomme sans effet
    }

    if (this.airborne) {
      this.vy += GRAVITY * dt;
      this.y += this.vy * dt;
      this.lastLandY = Math.max(this.lastLandY, this.y);
      if (this.y <= 0) {
        this.y = 0;
        this.airborne = false;
        const impact = clamp(-this.vy / JUMP_V, 0, 1.6);
        this.vy = 0;
        // Hitstop uniquement sur les vraies chutes : sinon ca bégaye.
        if (this.lastLandY > 1.8) this.hitstop = Math.max(this.hitstop, 0.03);
        this.events.onLand?.(impact);
      }
    }

    // --- Deplacement
    // Convention three.js : avant = -Z, droite ecran = +X. Steer positif
    // deplace donc vers +X et l'avance se fait en -Z.
    const lateral = st * effective * 0.42;
    this.x += lateral * dt;
    this.z -= effective * dt;
    this.distance += effective * dt;

    // Rappel doux aux bords : on ne bloque jamais net, on repousse.
    if (Math.abs(this.x) > CORRIDOR) {
      const over = Math.abs(this.x) - CORRIDOR;
      this.x -= Math.sign(this.x) * Math.min(over, over * dt * 6);
    }

    // --- Combo : il faut enchainer, sinon il retombe.
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    this.score += effective * dt * (1 + this.combo * 0.35);
  }

  private pop(): void {
    const c = this.carveCharge;
    this.combo += 1;
    this.comboTimer = 2.6;
    this.bonus.add(9 * c);
    // 45 ms : la duree que le cerveau lit comme un impact (Smash, Hollow Knight).
    this.hitstop = Math.max(this.hitstop, 0.045);
    this.score += 120 * c * (1 + this.combo * 0.5);
    this.carveCharge = 0;
    this.carveSign = 0;
    this.events.onPop?.(c, this.combo);
  }

  collectBubble(): void {
    this.bubbles += 1;
    this.comboTimer = Math.max(this.comboTimer, 1.6);
    this.score += 60 * (1 + this.combo * 0.5);
    this.bonus.add(1.8);
  }

  /** Ecriture de l'etat partage — seul le controleur y touche. */
  writeState(s: GameState): void {
    s.speed = Math.min(60, this.speed + this.bonus.value);
    s.steer = this.steer.value;
    s.lean = this.lean.value;
    s.carveCharge = this.carveCharge;
    s.combo = this.combo;
    s.comboTimer = this.comboTimer;
    s.score = this.score;
    s.distance = this.distance;
    s.bubbles = this.bubbles;
    s.airborne = this.airborne;
    s.popFlash = lerp(s.popFlash, 0, 0.12);
  }
}
