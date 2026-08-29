import { Color } from 'three';

/**
 * Palette canonique — extraite au k-means de l'image de reference.
 * Source unique de verite : voir docs/01-ART-DIRECTION.md §1.
 * Ne pas inventer de couleur ailleurs dans le projet.
 */
export const HEX = {
  skyZenith: 0x0fb8de,
  skyMid: 0x15cee8,
  skyHorizon: 0x7fe6f2,
  cloudCore: 0xffffff,
  cloudShadow: 0xb2d2eb,

  grassHorizon: 0x8cff84,
  grassFar: 0x75fc85,
  grassMid: 0x48fd76,
  grassNear: 0x19e25f,
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

/** Vec3 lineaire pretes a envoyer en uniform. */
export function vec3(key: PaletteKey): [number, number, number] {
  const c = colClone(key).convertSRGBToLinear();
  return [c.r, c.g, c.b];
}
