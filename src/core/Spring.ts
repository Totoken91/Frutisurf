/**
 * Ressorts amortis — le socle de tout le game feel.
 * docs/03-GAME-FEEL.md §2 : le decalage entre deux ressorts de raideurs
 * differentes est ce qui rend le personnage vivant.
 */

/** Ressort scalaire pulsation/amortissement, integre en semi-implicite. */
export class Spring {
  value: number;
  velocity = 0;
  target: number;

  constructor(
    initial = 0,
    /** pulsation propre, rad/s — plus haut = plus reactif */
    public omega = 10,
    /** ratio d'amortissement — <1 depasse (le "mordant"), 1 = critique */
    public zeta = 1,
  ) {
    this.value = initial;
    this.target = initial;
  }

  step(dt: number): number {
    const f = this.omega * this.omega * (this.target - this.value);
    const d = 2 * this.zeta * this.omega * this.velocity;
    this.velocity += (f - d) * dt;
    this.value += this.velocity * dt;
    return this.value;
  }

  /** Repositionne sans transitoire. */
  snap(v: number): void {
    this.value = v;
    this.target = v;
    this.velocity = 0;
  }

  /** Coup de fouet instantane (impact, pop de carve). */
  impulse(v: number): void {
    this.velocity += v;
  }
}

/** Lissage exponentiel, independant du framerate. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}

export const clamp = (v: number, lo: number, hi: number): number =>
  v < lo ? lo : v > hi ? hi : v;

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Amortisseur d'impulsions : secousses de camera, punch de FOV. */
export class Decay {
  value = 0;
  constructor(public lambda = 6) {}
  step(dt: number): number {
    this.value *= Math.exp(-this.lambda * dt);
    if (this.value < 1e-4) this.value = 0;
    return this.value;
  }
  add(v: number): void {
    this.value += v;
  }
}
