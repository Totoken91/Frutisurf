import { Color } from 'three';
import { HEX } from '../core/Palette';
import { NO_MODS, type Mods } from '../core/Loadout';
import type { Keyframe } from './Daylight';

/**
 * LES MONDES.
 *
 * ---
 *
 * CE QU'EST UN MONDE ICI, ET CE QU'IL N'EST PAS.
 *
 * Ce n'est pas une scene chargee a la place d'une autre. C'est un JEU DE
 * PARAMETRES applique a la seule et meme scene : cinq amplitudes de relief, un
 * niveau d'eau, une largeur de greve, une vingtaine de couleurs, quatre
 * densites de decor et quatre palettes de ciel.
 *
 * Ce choix n'est pas une economie, c'est ce qui rend le changement de monde
 * INSTANTANE et CONTINU. Rien n'est detruit, rien n'est reconstruit, aucun
 * shader n'est recompile — donc aucun a-coup, aucune fuite, et surtout : on
 * peut FONDRE d'un monde a l'autre. La plaine s'inonde et devient l'archipel
 * sous les yeux du joueur pendant qu'il lit l'ecran de selection. Un monde
 * charge a la place d'un autre n'aurait jamais pu faire ca.
 *
 * La contrainte que ca impose est reelle et assumee : tous les mondes
 * partagent les memes FREQUENCES de relief (cf. Terrain.ts). Deux mondes ne
 * peuvent donc pas differer par la taille de leurs collines, seulement par leur
 * hauteur. En pratique c'est suffisant — une plaine et un archipel se
 * distinguent par ce qui depasse de l'eau, pas par leur spectre.
 *
 * ---
 *
 * REGLE : chaque monde doit rester JOUABLE, et ca se mesure.
 *
 * Le piege d'un monde aquatique est connu et il est mortel : une nappe assez
 * large pour qu'on ne puisse pas la traverser d'un trait. Couler au milieu de
 * trois cents metres d'eau, c'est ressortir au pas trois cents metres plus
 * loin, donc perdre la partie sans avoir rien fait de mal. `check:worlds`
 * mesure la largeur maximale de nappe et la longueur des bandes de terre de
 * chaque monde avant d'accepter ses chiffres.
 */

/** Les couleurs qu'un monde a le droit de redefinir. Le reste est canonique. */
export type WorldColorKey =
  | 'grassHorizon' | 'grassFar' | 'grassMid' | 'grassNear' | 'grassShadow' | 'grassStreak'
  | 'sandDry' | 'sandPale' | 'sandWet' | 'sandShell'
  | 'waterShallow' | 'waterDeep' | 'waterFoam'
  | 'cityFace' | 'cityLit' | 'cityDeep' | 'treeLine'
  | 'warmAccent' | 'cloudCore' | 'cloudShadow' | 'cloudRim';

export const WORLD_COLOR_KEYS: WorldColorKey[] = [
  'grassHorizon', 'grassFar', 'grassMid', 'grassNear', 'grassShadow', 'grassStreak',
  'sandDry', 'sandPale', 'sandWet', 'sandShell',
  'waterShallow', 'waterDeep', 'waterFoam',
  'cityFace', 'cityLit', 'cityDeep', 'treeLine',
  'warmAccent', 'cloudCore', 'cloudShadow', 'cloudRim',
];

export interface WorldDef {
  id: string;
  name: string;
  /** Une ligne, affichee sous les cartes. Ce qu'on va ressentir, pas un decor. */
  blurb: string;
  /** Amplitude des cinq couches de relief, en metres. */
  amp: readonly [number, number, number, number, number];
  /** Niveau de l'eau. Tres bas = monde sans eau. */
  water: number;
  /** Greve : [base, part variable], en hauteur au-dessus de l'eau. */
  shore: readonly [number, number];
  /** Surcharges de palette. Les cles absentes gardent la couleur canonique. */
  colors: Partial<Record<WorldColorKey, number>>;
  /** Densites de decor, 0..1. Zero = absent. */
  city: number;
  turbines: number;
  palms: number;
  blades: number;
  /** 0 = herbe, 1 = grille Y2K. Bascule la matiere du sol. */
  tech: number;
  /**
   * Les regles du monde, multipliees a celles du buddy et de la monture.
   *
   * Elles ne sont pas la pour differencier : elles sont la pour que chaque
   * monde reste JOUABLE avec la meme physique. Un monde a moitie sous l'eau a
   * besoin d'un seuil de dejaugeage bas, sinon on y coule des la premiere
   * seconde ; un monde sans eau perd toute une source de points et doit la
   * recuperer ailleurs. Chaque monde tient son propre record (cf. Run.ts), donc
   * ces ecarts ne mettent aucun monde en concurrence avec un autre.
   */
  mods: Mods;
  /** Les quatre palettes de ciel. Le ciel EST le monde. */
  sky: readonly Keyframe[];
  /** Ou l'on entre dans le cycle en arrivant. */
  dayStart: number;
  /**
   * Vignette de l'ecran de selection : ciel, sol, eau, et la HAUTEUR de la
   * bande d'eau en pourcentage.
   *
   * La hauteur n'est pas un detail : sans elle, la plaine, l'archipel et le
   * monde sans eau donnaient trois vignettes quasi identiques — un ciel bleu,
   * du vert, un liseré turquoise. Or c'est exactement la part d'eau qui les
   * distingue en jeu. La vignette doit montrer ce qui change, pas ce qui est
   * commun.
   */
  swatch: readonly [string, string, string, number];
}

// ---------------------------------------------------------------------------
// LES CIELS
// ---------------------------------------------------------------------------

/** La plaine d'origine : la reference Frutiger Aero, quatre moments. */
const SKY_PLAIN: Keyframe[] = [
  { at: 0.0, zenith: 0x1e4a8c, high: 0x5a7fb8, mid: 0xd99a7a, horizon: 0xffd3a0,
    light: 0xffb373, power: 0.72, fill: 0x6d86bd, night: 0.30, warm: 1.0 },
  { at: 0.25, zenith: 0x0d6fe0, high: 0x1c9ce9, mid: 0x4cc4f2, horizon: 0xc6ecfa,
    light: 0xfff6e2, power: 1.0, fill: 0x8fc4e8, night: 0.0, warm: 0.0 },
  { at: 0.5, zenith: 0x24306e, high: 0x6a4f9c, mid: 0xe0673f, horizon: 0xffb072,
    light: 0xff7a3c, power: 0.78, fill: 0x6a5a9e, night: 0.34, warm: 1.0 },
  { at: 0.75, zenith: 0x081436, high: 0x102354, mid: 0x1d3a72, horizon: 0x3b6094,
    light: 0x8aa6e0, power: 0.34, fill: 0x33508c, night: 1.0, warm: 0.15 },
];

/**
 * OKINAWA. Le meme soleil, mais l'air d'un lagon : plus de blanc a l'horizon,
 * un zenith plus pur, et une lumiere legerement SURPUISSANTE a midi. Sous les
 * tropiques la lumiere ne se contente pas d'etre forte, elle est VERTICALE, et
 * ce qu'on lit d'une photo de plage n'est pas la couleur du ciel mais
 * l'ecrasement des ombres.
 */
const SKY_OKINAWA: Keyframe[] = [
  { at: 0.0, zenith: 0x2a5fa8, high: 0x6e93c4, mid: 0xf0b48c, horizon: 0xffe6c8,
    light: 0xffc79a, power: 0.80, fill: 0x8aa8d8, night: 0.24, warm: 1.0 },
  { at: 0.25, zenith: 0x0a86e8, high: 0x22b4ef, mid: 0x6ee0f6, horizon: 0xe8fcff,
    light: 0xfffaf0, power: 1.08, fill: 0xa8ddf2, night: 0.0, warm: 0.0 },
  { at: 0.5, zenith: 0x2c2f78, high: 0x7a52a8, mid: 0xf07a48, horizon: 0xffcf96,
    light: 0xff8a4a, power: 0.82, fill: 0x7a68ac, night: 0.30, warm: 1.0 },
  { at: 0.75, zenith: 0x061a44, high: 0x0d2c62, mid: 0x1c4a80, horizon: 0x4f83b0,
    light: 0x9ec0ec, power: 0.38, fill: 0x3f64a0, night: 1.0, warm: 0.15 },
];

/**
 * BLISS. Le ciel le plus SATURE des quatre, et le plus contraste verticalement.
 * C'est la signature du fond d'ecran : un bleu presque violet au zenith qui
 * tombe sur un blanc franc a l'horizon, sans passer par du cyan. Le cyan est
 * partout ailleurs dans ce jeu ; ici il est volontairement absent, et c'est ce
 * qui rend le monde reconnaissable en une image.
 */
const SKY_BLISS: Keyframe[] = [
  { at: 0.0, zenith: 0x1c3f8e, high: 0x5878bc, mid: 0xdda482, horizon: 0xffdcb0,
    light: 0xffbd82, power: 0.74, fill: 0x7089c0, night: 0.28, warm: 1.0 },
  { at: 0.25, zenith: 0x1f5fd8, high: 0x3f8fe8, mid: 0x84c8f2, horizon: 0xf6fdff,
    light: 0xfff8ec, power: 1.02, fill: 0x9ccbec, night: 0.0, warm: 0.0 },
  { at: 0.5, zenith: 0x2a2c74, high: 0x6b4b9e, mid: 0xe8804c, horizon: 0xffc98e,
    light: 0xff8f4e, power: 0.80, fill: 0x6f5ea4, night: 0.32, warm: 1.0 },
  { at: 0.75, zenith: 0x0a1740, high: 0x142a60, mid: 0x22427e, horizon: 0x466ca0,
    light: 0x94aee6, power: 0.36, fill: 0x385594, night: 1.0, warm: 0.15 },
];

/**
 * CHROME. Le monde Y2K, et le seul qui ne connaisse pas le plein jour.
 *
 * Son « midi » est un crepuscule violet : c'est deliberé. Toute l'imagerie de
 * l'epoque — visualiseurs de lecteur multimedia, ecrans de veille en fil de
 * fer, chrome liquide sur fond noir — repose sur des NEONS, et un neon a
 * besoin de nuit. Un Chrome en plein soleil serait juste une plaine violette.
 *
 * Le cycle continue de tourner : il donne ici une aube magenta et un
 * crepuscule rose vif, deux moments que les trois autres mondes n'ont pas.
 */
const SKY_CHROME: Keyframe[] = [
  { at: 0.0, zenith: 0x180d3c, high: 0x481e72, mid: 0xc23a7e, horizon: 0xffa8d4,
    light: 0xff86c0, power: 0.62, fill: 0x5a3080, night: 0.52, warm: 0.9 },
  { at: 0.25, zenith: 0x140d40, high: 0x2a2478, mid: 0x4f52c8, horizon: 0xa894ff,
    light: 0xcfd8ff, power: 0.74, fill: 0x4a4aa0, night: 0.40, warm: 0.0 },
  { at: 0.5, zenith: 0x1a0838, high: 0x5c1a6e, mid: 0xf02f7a, horizon: 0xffbe70,
    light: 0xff5aa0, power: 0.68, fill: 0x66287e, night: 0.54, warm: 1.0 },
  { at: 0.75, zenith: 0x03040f, high: 0x0a0a26, mid: 0x1a1048, horizon: 0x4a2078,
    light: 0xb890ff, power: 0.30, fill: 0x2a1a5c, night: 1.0, warm: 0.2 },
];

// ---------------------------------------------------------------------------
// LES MONDES
// ---------------------------------------------------------------------------

export const WORLDS: WorldDef[] = [
  {
    id: 'plaine',
    name: 'PLAINE',
    blurb: 'collines, lacs, ville de cristal',
    // Mesure : 17 % d'eau, une nappe tous les 214 m, 44 m de large en moyenne.
    amp: [6.0, 3.6, 2.3, 1.05, 0.16],
    water: -5.5,
    shore: [1.55, 3.2],
    colors: {},
    mods: NO_MODS,
    city: 1,
    turbines: 1,
    palms: 1,
    blades: 1,
    tech: 0,
    sky: SKY_PLAIN,
    dayStart: 0.16,
    swatch: ['#1c9ce9', '#9ed93e', '#6fe8e0', 26],
  },
  {
    id: 'okinawa',
    name: 'OKINAWA',
    blurb: 'lagon turquoise, îles à palmiers',
    // Mesure : 50 % d'eau, nappes de 42 m en moyenne et 120 m au pire, terre
    // tous les 42 m. La grande couche de fond est ecrasee (6.0 -> 2.0) et la
    // couche de 84 m relevee (2.3 -> 4.0) : c'est ce rapport qui fait un
    // ARCHIPEL au lieu d'un ocean. Une houle de fond forte donnerait deux
    // continents separes par un bras de mer infranchissable.
    amp: [2.0, 2.4, 4.0, 1.7, 0.20],
    water: 0.0,
    // Greve large : sur un atoll, la plage EST l'ile. La resserrer donnerait
    // des rochers verts au milieu de l'eau.
    // Greve large — sur un atoll la plage EST l'ile — mais pas au point de
    // manger le premier plan : a [2.6, 5.0] le sable occupait la moitie de
    // l'ecran et le lagon devenait un liseré au fond.
    shore: [2.0, 3.8],
    colors: {
      // Le lagon : turquoise franc en eau basse, bleu profond mais toujours
      // cyan au large. Jamais d'ardoise — c'est ce qui separe un lagon d'un lac.
      waterShallow: 0x8bf5e4,
      waterDeep: 0x0f9fd0,
      waterFoam: 0xffffff,
      // Le sable des Ryukyu est un sable CORALLIEN : presque blanc, tres
      // legerement rose. Il monte donc nettement plus haut que celui de la
      // plaine, qui est cale sur la luminance de l'herbe.
      sandDry: 0xe8d8b4,
      sandPale: 0xf6ead0,
      sandWet: 0xb09a74,
      sandShell: 0xfffaf0,
      // La vegetation d'ile est plus SOMBRE et plus bleue que la prairie : ce
      // sont des feuillages epais, pas de l'herbe rase au soleil.
      grassNear: 0x4fa83c,
      grassMid: 0x6dbd44,
      grassFar: 0x92d059,
      grassHorizon: 0xbde48c,
      grassShadow: 0x2f7028,
      grassStreak: 0x9fdc68,
      warmAccent: 0x8a6a52,
    },
    // On DEJAUGE a 16 m/s au lieu de 25 : le lagon est peu profond, on y skie
    // des le depart. Sans ca le monde n'existe pas (cf. Loadout.Mods). Le prix
    // est la derive : sur l'eau le disque ne mord pas.
    mods: { cruise: 1, grip: 0.92, lift: 1, plane: 1.55, boost: 1 },
    city: 0,
    turbines: 0.35,
    palms: 1,
    blades: 0.7,
    tech: 0,
    sky: SKY_OKINAWA,
    dayStart: 0.22,
    swatch: ['#22b4ef', '#e8d8b4', '#8bf5e4', 56],
  },
  {
    id: 'bliss',
    name: 'BLISS',
    blurb: 'que des collines, et le ciel',
    // Zero eau, et c'est la moitie du propos : le seul monde ou l'on ne peut
    // pas couler, donc le seul ou la vitesse ne se paie jamais. Mesure :
    // pente moyenne 7,2 deg, maximum 24 deg — le plus DOUX des quatre.
    amp: [7.5, 4.2, 1.5, 0.5, 0.06],
    water: -60,
    shore: [1.0, 1.0],
    colors: {
      // Le vert de Bliss n'est pas le chartreuse de la plaine : il est plus
      // franc, plus dense, et il tire au bleu dans l'ombre. C'est de l'herbe
      // grasse de printemps, pas de la prairie seche.
      grassNear: 0x63bd28,
      grassMid: 0x8ad438,
      grassFar: 0xb2e556,
      grassHorizon: 0xd6f28e,
      grassShadow: 0x3d7c1c,
      grassStreak: 0xbfe968,
      // Les cumulus les plus blancs et les plus contrastes du jeu : ici ils
      // sont le seul sujet, il n'y a rien d'autre a regarder.
      cloudCore: 0xffffff,
      cloudShadow: 0x88b8e4,
      cloudRim: 0xf4fbff,
    },
    // Pas une goutte d'eau, donc pas un seul point de traversee : c'est toute
    // une source de score et de secondes qui disparait. Le monde la rend en
    // portance et en boost — on y joue les figures, faute de lacs.
    mods: { cruise: 1, grip: 0.94, lift: 1.08, plane: 1, boost: 1.10 },
    city: 0,
    turbines: 0,
    palms: 0,
    blades: 1,
    tech: 0,
    sky: SKY_BLISS,
    dayStart: 0.19,
    swatch: ['#1f5fd8', '#8ad438', '#b2e556', 0],
  },
  {
    id: 'chrome',
    name: 'CHROME',
    blurb: 'grille néon, mercure, tours',
    // Relief anguleux et RAPIDE : la couche de 190 m domine, celle de 42 m est
    // relevee. On saute beaucoup, on lit peu — c'est le monde nerveux.
    amp: [4.2, 5.0, 1.4, 1.6, 0.10],
    water: -3.0,
    shore: [0.9, 1.6],
    colors: {
      // Le « sol » n'est plus de l'herbe mais une dalle sombre : la grille
      // lumineuse par-dessus fait tout le travail (cf. uTech dans Ground).
      grassNear: 0x1b1846,
      grassMid: 0x241f5c,
      grassFar: 0x312a78,
      grassHorizon: 0x4a3f9c,
      grassShadow: 0x0e0c28,
      grassStreak: 0x7a5cff,
      // Le mercure : presque noir en profondeur, violet electrique en surface.
      waterShallow: 0x9a7cff,
      waterDeep: 0x120a38,
      waterFoam: 0xe8dcff,
      sandDry: 0x3a2f70,
      sandPale: 0x5a4a9e,
      sandWet: 0x1e1848,
      sandShell: 0xc8b0ff,
      // Les tours passent au neon : c'est la seule source chaude du monde.
      cityFace: 0x5a3fd0,
      cityLit: 0xff6cd0,
      cityDeep: 0x1a1050,
      treeLine: 0x150e3c,
      cloudCore: 0xc6b4ff,
      cloudShadow: 0x3a2a78,
      cloudRim: 0xffb0e8,
      warmAccent: 0x4a3a80,
    },
    // Le monde nerveux : plus vite, et le mercure est glissant. On y lit moins
    // le relief, donc on y mord moins.
    mods: { cruise: 1.08, grip: 0.94, lift: 0.96, plane: 1.15, boost: 1 },
    city: 1,
    turbines: 0.6,
    palms: 0,
    blades: 0,
    tech: 1,
    sky: SKY_CHROME,
    dayStart: 0.62,
    swatch: ['#2a2478', '#241f5c', '#9a7cff', 30],
  },
];

const KEY = 'frutisurf.world';

export function worldById(id: string | null | undefined): WorldDef {
  return WORLDS.find((w) => w.id === id) ?? WORLDS[0];
}

export function loadWorld(): WorldDef {
  try {
    return worldById(localStorage.getItem(KEY));
  } catch {
    return WORLDS[0];
  }
}

export function saveWorld(w: WorldDef): void {
  try {
    localStorage.setItem(KEY, w.id);
  } catch {
    // Sans persistance le jeu reste jouable : on repartira sur la plaine.
  }
}

/**
 * Palette resolue d'un monde : la palette canonique, ecrasee par ses
 * surcharges. Calculee une fois et memoisee — c'est la source du fondu.
 */
const resolved = new Map<string, Map<WorldColorKey, Color>>();

export function worldPalette(w: WorldDef): Map<WorldColorKey, Color> {
  let m = resolved.get(w.id);
  if (m) return m;
  m = new Map();
  for (const k of WORLD_COLOR_KEYS) m.set(k, new Color(w.colors[k] ?? HEX[k]));
  resolved.set(w.id, m);
  return m;
}
