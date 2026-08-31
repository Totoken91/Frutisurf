import { Color, Vector3 } from 'three';

/**
 * LE CYCLE. Source unique de la lumiere, comme Terrain.ts l'est du relief.
 *
 * Tout ce qui a une couleur dans ce jeu la tient d'ici : le dome de ciel, le
 * sol, l'eau, les brins, les nuages, la ville, le pollen, et les deux lampes de
 * la scene. Un seul endroit ou lire l'heure, sinon la nuit tombe sur le ciel
 * pendant que l'herbe reste en plein midi — et rien n'est plus destructeur pour
 * une ambiance qu'une couche qui n'a pas recu le memo.
 *
 * ---
 *
 * PERIODE. Trois minutes pour un tour complet, et le cycle NE SE REMET PAS A
 * ZERO entre deux parties. Une course de quarante secondes en traverse donc un
 * gros cinquieme : on part en fin de matinee, on finit au soleil rasant. C'est
 * le meilleur des deux mondes — assez lent pour qu'une partie ait une lumiere
 * COHERENTE, assez rapide pour que la partie suivante n'ait pas la meme.
 *
 * Remettre l'heure a zero a chaque relance aurait fige le jeu a une seule
 * lumiere, celle du depart, et tout ce travail n'aurait servi qu'aux captures.
 *
 * ---
 *
 * LES QUATRE MOMENTS, et pourquoi ces quatre-la.
 *
 * On interpole entre quatre palettes cles plutot que de calculer une diffusion
 * atmospherique : le rendu physique donne des ciels justes et ternes, alors
 * qu'on cherche des ciels de CARTE POSTALE. Les quatre moments sont choisis
 * pour leur contraste mutuel :
 *
 *   AUBE      le ciel est encore froid en haut et deja chaud en bas — c'est ce
 *             GRAND ECART vertical qui fait un lever de soleil, pas l'orange ;
 *   MIDI      la palette Frutiger Aero d'origine, celle de la reference ;
 *   CREPUSCULE  l'inverse de l'aube : violet profond au zenith, braise a
 *             l'horizon, et le contraste le plus fort des quatre ;
 *   NUIT      bleu de minuit, mais JAMAIS noir. Un jeu qui vire au noir la
 *             nuit devient injouable et perd son identite ; ici la nuit reste
 *             une nuit claire, de pleine lune.
 */

/** Duree d'un tour complet, en secondes. */
export const CYCLE = 180;

interface Keyframe {
  /** Position dans le cycle, 0 = lever. */
  at: number;
  zenith: number;
  high: number;
  mid: number;
  horizon: number;
  /** Couleur de la lumiere directe. */
  light: number;
  /** Intensite de la lumiere directe. */
  power: number;
  /** Couleur du ciel qui remplit les ombres. */
  fill: number;
  /** 0 = plein jour, 1 = nuit noire. Pilote les etoiles et l'assombrissement. */
  night: number;
  /** 0 = lumiere neutre, 1 = soleil rasant. Pilote la chaleur des rasants. */
  warm: number;
}

const KEYS: Keyframe[] = [
  {
    // --- AUBE. Le haut est encore la nuit, le bas est deja le jour.
    at: 0.0,
    zenith: 0x1e4a8c, high: 0x5a7fb8, mid: 0xd99a7a, horizon: 0xffd3a0,
    light: 0xffb373, power: 0.72, fill: 0x6d86bd, night: 0.30, warm: 1.0,
  },
  {
    // --- MIDI. La palette d'origine, celle de la reference Frutiger Aero.
    at: 0.25,
    zenith: 0x0d6fe0, high: 0x1c9ce9, mid: 0x4cc4f2, horizon: 0xc6ecfa,
    light: 0xfff6e2, power: 1.0, fill: 0x8fc4e8, night: 0.0, warm: 0.0,
  },
  {
    // --- CREPUSCULE. Le contraste le plus fort des quatre : violet au zenith,
    //     braise a l'horizon. C'est LE moment que le joueur voudra capturer.
    at: 0.5,
    zenith: 0x24306e, high: 0x6a4f9c, mid: 0xe0673f, horizon: 0xffb072,
    light: 0xff7a3c, power: 0.78, fill: 0x6a5a9e, night: 0.34, warm: 1.0,
  },
  {
    // --- NUIT. Bleu de minuit, jamais noir : un jeu de vitesse qui s'eteint
    //     devient injouable, et la nuit doit rester une nuit CLAIRE.
    at: 0.75,
    zenith: 0x081436, high: 0x102354, mid: 0x1d3a72, horizon: 0x3b6094,
    light: 0x8aa6e0, power: 0.34, fill: 0x33508c, night: 1.0, warm: 0.15,
  },
];

/** Etat courant, relu par tout le monde. Jamais recree : on ecrit dedans. */
export class Daylight {
  /** Position dans le cycle, 0..1. */
  phase = 0.16;

  readonly sun = new Vector3();
  readonly zenith = new Color();
  readonly high = new Color();
  readonly mid = new Color();
  readonly horizon = new Color();
  readonly light = new Color();
  readonly fill = new Color();
  power = 1;
  night = 0;
  warm = 0;
  /** Hauteur du soleil, -1..1. Negative = sous l'horizon. */
  elevation = 0;

  private tmpA = new Color();
  private tmpB = new Color();

  constructor(startPhase = 0.16) {
    this.phase = startPhase;
    this.step(0);
  }

  step(dt: number): void {
    this.phase = (this.phase + dt / CYCLE) % 1;
    const p = this.phase;

    // --- Trouve les deux cles qui encadrent, en refermant la boucle.
    let i = 0;
    for (let k = 0; k < KEYS.length; k++) if (KEYS[k].at <= p) i = k;
    const a = KEYS[i];
    const b = KEYS[(i + 1) % KEYS.length];
    const span = (b.at > a.at ? b.at : b.at + 1) - a.at;
    const raw = (p - a.at) / span;
    // Lissage aux jonctions : une interpolation lineaire entre deux palettes
    // fait un COUDE visible au passage de chaque cle, et l'oeil accroche
    // dessus. Le smoothstep rend la derivee continue.
    const u = raw * raw * (3 - 2 * raw);

    const lerp = (out: Color, ca: number, cb: number): void => {
      this.tmpA.setHex(ca);
      this.tmpB.setHex(cb);
      out.copy(this.tmpA).lerp(this.tmpB, u);
    };
    lerp(this.zenith, a.zenith, b.zenith);
    lerp(this.high, a.high, b.high);
    lerp(this.mid, a.mid, b.mid);
    lerp(this.horizon, a.horizon, b.horizon);
    lerp(this.light, a.light, b.light);
    lerp(this.fill, a.fill, b.fill);
    this.power = a.power + (b.power - a.power) * u;
    this.night = a.night + (b.night - a.night) * u;
    this.warm = a.warm + (b.warm - a.warm) * u;

    // --- La course du soleil.
    //
    // L'AZIMUT RESTE PRESQUE FIXE, et c'est un choix de mise en scene, pas une
    // approximation : en portrait le champ horizontal ne fait que 37 degres.
    // Un soleil qui traverserait vraiment le ciel d'est en ouest passerait
    // l'essentiel de la journee hors cadre, et tout le travail sur les rasants
    // et le contre-jour ne se verrait jamais. Il reste donc devant, un peu a
    // droite, et c'est son ELEVATION qui raconte l'heure.
    //
    // Le lever et le coucher sont ce qu'on vient voir : la courbe est aplatie
    // pres de l'horizon (puissance 0,7 sur le sinus) pour que le soleil y
    // TRAINE au lieu de le franchir en trois secondes.
    const theta = p * Math.PI * 2;
    const s = Math.sin(theta);
    const el = Math.sign(s) * Math.pow(Math.abs(s), 0.7);
    this.elevation = el;
    const height = el * 0.62;
    const azim = 0.23 + Math.cos(theta) * 0.06;
    this.sun.set(azim, height, -0.92).normalize();
  }
}

/**
 * Le chunk que TOUT shader eclaire doit inclure, et la fonction qu'il doit
 * appeler sur sa couleur finale.
 *
 * Le point important est dans `daylight()` : la lumiere directe se COLORE
 * pendant que l'ombre prend le CIEL. C'est la seule facon d'obtenir une nuit
 * qui ne soit pas du jour assombri — a minuit, la lumiere directe est faible et
 * bleutee, mais le remplissage du ciel devient proportionnellement dominant, et
 * c'est lui qui donne cette clarte laiteuse des nuits degagees.
 *
 * Un simple `c *= 0.3` la nuit donnerait une image sale, parce qu'il
 * assombrirait aussi les zones que le ciel eclaire encore.
 */
export const GLSL_DAY = /* glsl */ `
uniform vec3 uDayLight, uDayFill;
uniform float uDayNight, uDayWarm;

vec3 daylight(vec3 c, float shade){
  vec3 lit = c * uDayLight;
  vec3 sky = c * uDayFill;
  return mix(lit, sky, clamp(shade, 0.0, 1.0));
}
`;

/** Uniformes a fusionner dans tout materiau qui inclut GLSL_DAY. */
export function dayUniforms(): Record<string, { value: unknown }> {
  return {
    uDayLight: { value: new Color(1, 1, 1) },
    uDayFill: { value: new Color(0.56, 0.77, 0.91) },
    uDayNight: { value: 0 },
    uDayWarm: { value: 0 },
  };
}

/** Pousse l'heure courante dans un materiau. Ignore ce qu'il n'a pas. */
export function pushDay(
  uniforms: Record<string, { value: unknown } | undefined>,
  d: Daylight,
): void {
  const set = (name: string, v: unknown): void => {
    const u = uniforms[name];
    if (!u) return;
    if (v instanceof Color && u.value instanceof Color) (u.value as Color).copy(v);
    else if (v instanceof Vector3 && u.value instanceof Vector3) (u.value as Vector3).copy(v);
    else u.value = v;
  };
  set('uSun', d.sun);
  set('uDayLight', d.light);
  set('uDayFill', d.fill);
  set('uDayNight', d.night);
  set('uDayWarm', d.warm);
}
