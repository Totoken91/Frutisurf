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

export interface Keyframe {
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

/**
 * Un echantillon du ciel a un instant donne. Deux exemplaires suffisent : on
 * evalue le ciel du monde qu'on quitte et celui du monde qu'on rejoint, puis on
 * fond entre les deux.
 *
 * Fondre les RESULTATS et non les cles est la seule facon correcte de faire :
 * deux mondes n'ont pas leurs moments cles aux memes couleurs, et interpoler
 * des tables de cles donnerait des teintes qui n'existent dans aucun des deux.
 */
class Sample {
  readonly zenith = new Color();
  readonly high = new Color();
  readonly mid = new Color();
  readonly horizon = new Color();
  readonly light = new Color();
  readonly fill = new Color();
  power = 1;
  night = 0;
  warm = 0;
}

const tmpA = new Color();
const tmpB = new Color();

/** Evalue un jeu de cles a une position du cycle. */
function sample(keys: readonly Keyframe[], p: number, out: Sample): void {
  let i = 0;
  for (let k = 0; k < keys.length; k++) if (keys[k].at <= p) i = k;
  const a = keys[i];
  const b = keys[(i + 1) % keys.length];
  const span = (b.at > a.at ? b.at : b.at + 1) - a.at;
  const raw = (p - a.at) / span;
  // Lissage aux jonctions : une interpolation lineaire entre deux palettes
  // fait un COUDE visible au passage de chaque cle, et l'oeil accroche dessus.
  const u = raw * raw * (3 - 2 * raw);
  const lerp = (o: Color, ca: number, cb: number): void => {
    tmpA.setHex(ca);
    tmpB.setHex(cb);
    o.copy(tmpA).lerp(tmpB, u);
  };
  lerp(out.zenith, a.zenith, b.zenith);
  lerp(out.high, a.high, b.high);
  lerp(out.mid, a.mid, b.mid);
  lerp(out.horizon, a.horizon, b.horizon);
  lerp(out.light, a.light, b.light);
  lerp(out.fill, a.fill, b.fill);
  out.power = a.power + (b.power - a.power) * u;
  out.night = a.night + (b.night - a.night) * u;
  out.warm = a.warm + (b.warm - a.warm) * u;
}

/** Etat courant, relu par tout le monde. Jamais recree : on ecrit dedans. */
export class Daylight {
  /** Position dans le cycle, 0..1. */
  phase = 0.16;

  /**
   * Le ciel du monde qu'on quitte, celui du monde qu'on rejoint, et le fondu.
   * En regime etabli `mix` vaut 1 et `from` egale `to` : on paie alors une
   * evaluation de trop par image, ce qui est le prix — parfaitement negligeable —
   * de n'avoir aucun cas particulier a maintenir entre « en transition » et
   * « pas en transition ».
   */
  from: readonly Keyframe[] = [];
  to: readonly Keyframe[] = [];
  mix = 1;

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

  private sa = new Sample();
  private sb = new Sample();

  constructor(keys: readonly Keyframe[], startPhase = 0.16) {
    this.from = keys;
    this.to = keys;
    this.phase = startPhase;
    this.step(0);
  }

  step(dt: number): void {
    this.phase = (this.phase + dt / CYCLE) % 1;
    const p = this.phase;

    sample(this.from, p, this.sa);
    sample(this.to, p, this.sb);
    const m = this.mix;
    const pick = (out: Color, key: 'zenith' | 'high' | 'mid' | 'horizon' | 'light' | 'fill'): void => {
      out.copy(this.sa[key]).lerp(this.sb[key], m);
    };
    pick(this.zenith, 'zenith');
    pick(this.high, 'high');
    pick(this.mid, 'mid');
    pick(this.horizon, 'horizon');
    pick(this.light, 'light');
    pick(this.fill, 'fill');
    this.power = this.sa.power + (this.sb.power - this.sa.power) * m;
    this.night = this.sa.night + (this.sb.night - this.sa.night) * m;
    this.warm = this.sa.warm + (this.sb.warm - this.sa.warm) * m;

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
