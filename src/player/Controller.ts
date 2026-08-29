import { clamp, Decay, lerp, Spring, smoothstep } from '../core/Spring';
import { terrainHeight } from '../world/Terrain';
import type { GameState } from '../core/GameState';
import type { Input } from '../core/Input';

/**
 * La physique de glisse. C'est le fichier le plus important du projet :
 * si les ressorts d'ici sont mauvais, aucun effet visuel ne sauvera le jeu.
 *
 * Principe (docs/03 §1) : la sensation ne vient pas de la vitesse, elle vient
 * du contraste entre RESISTANCE et LIBERATION. Deux cycles s'entrelacent
 * desormais : le carve (charge laterale) et le relief (montee puis envol).
 */

export interface SurfEvents {
  onPop?: (charge: number, combo: number) => void;
  onJump?: (timed: number) => void;
  onLand?: (impact: number, quality: number) => void;
  onCarveFull?: () => void;
  onGlideStart?: () => void;
}

const CORRIDOR = 14;
const GRAVITY = -22;
const JUMP_V = 7.4;
/** Marge d'adherence du disque avant qu'une crete ne le decolle. */
const GRIP = 1.8;

/**
 * Portee du gabarit qui detecte les cretes. A +/-7 m il mesure les collines
 * roulables (80 m et 39 m de longueur d'onde) et filtre la texture de 20 m :
 * on veut timer un sommet, pas chaque caillou.
 */
const LIP_SPAN = 7;

export class Controller {
  // --- Etat cinematique
  x = 0;
  z = 0;
  y = 0;
  vy = 0;
  airborne = false;

  // --- Relief sous les pieds
  groundY = 0;
  /** Pente le long de l'axe de deplacement. Positif = ca monte devant. */
  slopeTravel = 0;
  /** Courbure le long du deplacement. Negatif = bombe (crete). */
  curvature = 0;
  /** 0..1, maximal pile au sommet d'une crete roulable. */
  lipFactor = 0;

  // --- Vol
  gliding = false;
  glideTime = 0;
  airTime = 0;

  // --- Les deux ressorts qui font tout le feeling.
  readonly steer = new Spring(0, 14, 0.72);
  readonly lean = new Spring(0, 9, 0.55);

  speed = 18;
  carveCharge = 0;
  combo = 0;
  comboTimer = 0;
  score = 0;
  distance = 0;

  hitstop = 0;
  private bonus = new Decay(0.45);
  private carveSign = 0;
  private wasCarving = false;
  private peakY = 0;

  constructor(private events: SurfEvents = {}) {
    this.y = terrainHeight(0, 0);
    this.groundY = this.y;
  }

  private cruise(): number {
    return 22 + Math.min(12, this.distance / 260);
  }

  get speedNorm(): number {
    return smoothstep(20, 52, this.speed);
  }

  /** Releve le relief autour du surfeur : hauteur, pente, courbure, crete. */
  private probeTerrain(): void {
    // L'avant est en -Z.
    const h0 = terrainHeight(this.x, this.z);
    const hf = terrainHeight(this.x, this.z - LIP_SPAN);
    const hb = terrainHeight(this.x, this.z + LIP_SPAN);

    this.groundY = h0;
    this.slopeTravel = (hf - hb) / (2 * LIP_SPAN);
    this.curvature = (hf - 2 * h0 + hb) / (LIP_SPAN * LIP_SPAN);

    // Une crete, c'est bombe ET a peu pres plat : les deux conditions, sinon
    // on recompenserait aussi le milieu d'une pente.
    const convex = clamp(-this.curvature / 0.012, 0, 1);
    const flat = 1 - smoothstep(0.06, 0.22, Math.abs(this.slopeTravel));
    this.lipFactor = convex * flat;
  }

  step(dt: number, input: Input, boostAllowed = true): void {
    this.probeTerrain();

    // --- Direction
    this.steer.target = input.steer;
    this.steer.step(dt);
    const st = clamp(this.steer.value, -1.4, 1.4);

    this.lean.target = st * (this.airborne ? 0.26 : 0.62);
    this.lean.step(dt);

    // --- Charge de carve : uniquement au sol
    const carving = !this.airborne && Math.abs(st) > 0.55;
    if (carving) {
      const sign = Math.sign(st);
      if (this.carveSign !== 0 && sign !== this.carveSign) this.carveCharge *= 0.35;
      this.carveSign = sign;
      const before = this.carveCharge;
      this.carveCharge = Math.min(1, this.carveCharge + dt * 0.55);
      if (before < 1 && this.carveCharge >= 1) this.events.onCarveFull?.();
    } else {
      this.carveCharge = Math.max(0, this.carveCharge - dt * 1.4);
    }

    if (this.wasCarving && !carving && this.carveCharge > 0.18) this.pop();
    this.wasCarving = carving;

    // --- Vitesse
    const boosting = boostAllowed && input.boostHeld;
    const target = this.cruise() + (boosting ? 13 : 0);
    this.speed += (target - this.speed) * (1 - Math.exp(-2.4 * dt));

    // La pente tire ou retient. Coefficient sous la gravite reelle : on veut
    // que le relief se SENTE, pas qu'il dicte la course.
    if (!this.airborne) this.speed = Math.max(9, this.speed - this.slopeTravel * 16 * dt);

    this.bonus.step(dt);
    const effective = Math.min(60, this.speed + this.bonus.value);

    // --- Saut, envol, plane
    const jumped = input.consumeJump();

    if (!this.airborne) {
      if (jumped) {
        this.launch(effective, this.lipFactor);
      } else {
        // Decollage naturel : au-dela d'une certaine vitesse, une crete bombee
        // ne peut plus retenir le disque. C'est de la physique, pas un scenario.
        //
        // Le facteur d'adherence represente la prise du disque sur l'herbe.
        // A 1.0 (physique pure) le boost envoyait en l'air 46 % du temps : on
        // ne glissait plus, on rebondissait.
        const needed = -this.curvature * effective * effective;
        if (needed > -GRAVITY * GRIP) {
          this.airborne = true;
          this.vy = this.slopeTravel * effective;
          this.airTime = 0;
          this.peakY = this.y;
          this.events.onJump?.(0);
        }
      }
    }

    if (this.airborne) {
      this.airTime += dt;

      // Plane : uniquement a partir de l'apex. Declenche des la montee, ca
      // donnerait un saut mou au lieu d'un envol suivi d'un vol.
      const wantGlide = input.jumpHeld && this.vy < 1.0;
      if (wantGlide && !this.gliding) this.events.onGlideStart?.();
      this.gliding = wantGlide;
      this.glideTime = wantGlide ? this.glideTime + dt : Math.max(0, this.glideTime - dt * 2);

      // Le plane s'essouffle : la gravite revient a pleine valeur en ~2 s.
      const g = this.gliding ? lerp(0.30, 1.0, smoothstep(1.1, 2.3, this.glideTime)) : 1;
      this.vy += GRAVITY * g * dt;
      this.y += this.vy * dt;
      this.peakY = Math.max(this.peakY, this.y);

      // Planer maintient la vitesse : c'est ce qui rend la ligne aerienne
      // competitive face au carve au sol.
      if (this.gliding) this.bonus.add(2.6 * dt);

      if (this.y <= this.groundY) {
        this.y = this.groundY;
        this.airborne = false;
        this.gliding = false;
        this.glideTime = 0;
        this.land(effective);
      }
    } else {
      this.y = this.groundY;
      this.vy = 0;
      this.glideTime = 0;
    }

    // --- Deplacement
    const lateral = st * effective * 0.42;
    this.x += lateral * dt;
    this.z -= effective * dt;
    this.distance += effective * dt;

    if (Math.abs(this.x) > CORRIDOR) {
      const over = Math.abs(this.x) - CORRIDOR;
      this.x -= Math.sign(this.x) * Math.min(over, over * dt * 6);
    }

    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.combo = 0;
    }

    this.score += effective * dt * (1 + this.combo * 0.35);
  }

  /** Saut. La recompense est maximale pile sur la crete. */
  private launch(speed: number, timed: number): void {
    this.airborne = true;
    this.airTime = 0;
    this.peakY = this.y;
    // On herite de la vitesse verticale que la montee donnait deja : sauter
    // juste avant le sommet paie donc aussi, la fenetre reste indulgente.
    const inherited = Math.max(0, this.slopeTravel * speed);
    this.vy = JUMP_V * (1 + 1.15 * timed) + inherited;
    if (timed > 0.75) {
      this.combo += 1;
      this.comboTimer = 2.6;
      this.bonus.add(5 * timed);
      this.hitstop = Math.max(this.hitstop, 0.035);
      this.score += 90 * timed;
    }
    this.events.onJump?.(timed);
  }

  private land(speed: number): void {
    const impact = clamp(-this.vy / 14, 0, 1.6);
    // Atterrir dans la pente descendante amortit et relance ; a plat ou en
    // montee, ca casse. C'est ce qui pousse a choisir OU retomber.
    const downhill = clamp(-this.slopeTravel * 4.5, 0, 1);
    const quality = downhill * (1 - clamp(impact - 1, 0, 1) * 0.5);

    this.bonus.add(downhill * 7 - impact * 2.5 * (1 - downhill));
    if (quality > 0.55) {
      this.combo += 1;
      this.comboTimer = 2.6;
      this.score += 110 * quality;
    }
    if (this.peakY - this.groundY > 1.8) {
      this.hitstop = Math.max(this.hitstop, 0.03);
    }
    this.vy = 0;
    void speed;
    this.events.onLand?.(impact, quality);
  }

  private pop(): void {
    const c = this.carveCharge;
    this.combo += 1;
    this.comboTimer = 2.6;
    this.bonus.add(9 * c);
    this.hitstop = Math.max(this.hitstop, 0.045);
    this.score += 120 * c * (1 + this.combo * 0.5);
    this.carveCharge = 0;
    this.carveSign = 0;
    this.events.onPop?.(c, this.combo);
  }

  writeState(s: GameState): void {
    s.speed = Math.min(60, this.speed + this.bonus.value);
    s.steer = this.steer.value;
    s.lean = this.lean.value;
    s.carveCharge = this.carveCharge;
    s.combo = this.combo;
    s.comboTimer = this.comboTimer;
    s.score = this.score;
    s.distance = this.distance;
    s.airborne = this.airborne;
    s.popFlash = lerp(s.popFlash, 0, 0.12);
  }
}
