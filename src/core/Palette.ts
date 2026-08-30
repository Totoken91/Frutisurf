import { Color } from 'three';

/**
 * Palette canonique — extraite au k-means de l'image de reference.
 * Source unique de verite : voir docs/01-ART-DIRECTION.md §1.
 * Ne pas inventer de couleur ailleurs dans le projet.
 */
export const HEX = {
  // Le ciel a ete REPRIS sur les references Frutiger Aero apportees par la
  // suite : elles ont toutes la meme signature, un azur profond et sature au
  // zenith qui blanchit franchement vers l'horizon. La version d'avant etait
  // cyan de haut en bas, donc plate : sans ecart de valeur entre le haut et le
  // bas du cadre, le ciel ne fait pas de profondeur et les nuages n'ont rien
  // sur quoi se detacher.
  skyZenith: 0x0d6fe0,
  skyHigh: 0x1c9ce9,
  skyMid: 0x4cc4f2,
  skyHorizon: 0xc6ecfa,
  cloudCore: 0xffffff,
  /** Sous-face des lobes : bleu franc, pas gris. Un cumulus n'a pas d'ombre neutre. */
  cloudShadow: 0x7db0dc,
  /** Lisere argente sur les bords fins, la ou la lumiere traverse le nuage. */
  cloudRim: 0xeaf8ff,

  /** Ligne d'arbres a la base de la ville : le vert le plus sombre du projet. */
  treeLine: 0x1f7a49,
  grassHorizon: 0x8cff84,
  grassFar: 0x75fc85,
  grassMid: 0x48fd76,
  grassNear: 0x14d955,
  grassShadow: 0x12a84e,
  grassStreak: 0x6bff92,

  buddyCore: 0x1c9fe4,
  buddyGlass: 0x35e4f9,
  buddyRim: 0x74f3f7,
  buddyHot: 0xbdf1f7,

  discSilver: 0xdaecf4,
  discDriftA: 0x1a94ba,
  discDriftB: 0xc86bff,
  discDriftC: 0xffe066,

  cityFace: 0x75cedc,
  cityLit: 0xc8e4ec,
  cityDeep: 0x2da7c3,

  aeroDeep: 0x0c57c9,
  aeroBlue: 0x1063d7,
  aeroCyan: 0x26d4eb,
  aeroFrost: 0xcbf1f0,

  warmAccent: 0x9f7b6a,
  violetDeep: 0x233659,
} as const;

type PaletteKey = keyof typeof HEX;

const cache = new Map<PaletteKey, Color>();

/** Couleur Three.js memoisee. Ne jamais muter le retour. */
export function col(key: PaletteKey): Color {
  let c = cache.get(key);
  if (!c) {
    c = new Color(HEX[key]);
    cache.set(key, c);
  }
  return c;
}

/** Copie mutable, pour les cas ou on doit ajuster. */
export function colClone(key: PaletteKey): Color {
  return new Color(HEX[key]);
}

/**
 * Triplet lineaire pret a envoyer en uniform.
 *
 * ColorManagement etant actif, `new Color(hex)` convertit DEJA du sRGB vers
 * l'espace de travail lineaire. Rappeler convertSRGBToLinear ici convertirait
 * une seconde fois : image sombre et virant au bleu. Ne pas le rajouter.
 */
export function vec3(key: PaletteKey): [number, number, number] {
  const c = colClone(key);
  return [c.r, c.g, c.b];
}
