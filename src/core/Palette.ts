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
  treeLine: 0x2f6b23,

  // --- L'herbe, en CHARTREUSE.
  //
  // La rampe precedente tirait vers l'emeraude (teinte 140 a 150 degres) : un
  // vert bleute, tres sature, qui lisait "radioactif" plutot que "prairie".
  // La reference est jaune-vert — teinte 80 a 95 degres. Le jaune dans le vert
  // est ce qui donne la lumiere du soleil dans l'herbe ; sans lui, une plaine
  // reste froide quelle que soit la saturation qu'on y met.
  grassHorizon: 0xd8f286,
  grassFar: 0xbdea58,
  grassMid: 0x9ed93e,
  grassNear: 0x76c22e,
  grassShadow: 0x519222,
  grassStreak: 0xc6ee62,

  buddyCore: 0x1c9fe4,
  buddyGlass: 0x35e4f9,
  buddyRim: 0x74f3f7,
  buddyHot: 0xbdf1f7,

  discSilver: 0xdaecf4,
  discDriftA: 0x1a94ba,
  discDriftB: 0xc86bff,
  discDriftC: 0xffe066,

  // --- L'eau. Turquoise franc en eau basse, bleu ardoise au large, ecume
  // presque blanche mais jamais grise : un blanc neutre sur du turquoise lit
  // comme de la mousse de savon.
  waterShallow: 0x6fe8e0,
  // Le fond ne doit PAS virer à l'ardoise : un bleu désaturé en eau profonde
  // lit comme un lac de montagne, pas comme du Frutiger Aero. On garde du
  // cyan jusqu'au bout, on ne baisse que la valeur.
  waterDeep: 0x1a86b8,
  waterFoam: 0xf1ffff,

  // --- LE SABLE.
  //
  // Un jaune franc lirait « bac a sable » et casserait la gamme du jeu, qui
  // n'a que du cyan et du chartreuse. Le sable Frutiger Aero est un ocre TRES
  // clair, tirant sur le rose : il tient sa chaleur de sa teinte, pas de sa
  // saturation, et c'est ce qui lui permet de cohabiter avec un turquoise
  // sature sans faire tache.
  //
  // Le sable mouille n'est pas le sable sec assombri : il est plus SATURE et
  // plus froid, parce que le film d'eau lui rend le ciel. Un simple
  // assombrissement donne de la boue.
  //
  // Valeurs volontairement BASSES. Un sable clair est un reflexe de peintre,
  // pas de moteur : dans un pipeline lineaire avec bloom, un beige a 240/255
  // sature immediatement et la greve part en blanc. Le sable doit se tenir a
  // la MEME luminance que l'herbe voisine et ne se distinguer que par sa
  // teinte — c'est le seul moyen d'obtenir du chaud sans obtenir du blanc.
  sandDry: 0xd4bc84,
  sandPale: 0xe8d5a6,
  sandWet: 0x9d8a62,
  sandShell: 0xf6ecd8,

  cityFace: 0x75cedc,
  cityLit: 0xc8e4ec,
  cityDeep: 0x2da7c3,

  aeroDeep: 0x0c57c9,
  aeroBlue: 0x1063d7,
  aeroCyan: 0x26d4eb,
  aeroFrost: 0xcbf1f0,

  warmAccent: 0x9f7b6a,
  violetDeep: 0x233659,

  // --- LES FEUILLES MORTES.
  //
  // Trois tons et pas un de plus : un tapis d'automne n'est pas un nuancier,
  // c'est une seule gamme — de l'orange brule au brun — dans laquelle une
  // rouge se detache de temps en temps. Le doré est le plus clair des trois
  // parce que c'est lui qui s'allume a contre-jour ; les deux autres restent
  // sous la luminance du sol pour que le tapis ne mange pas le paysage.
  //
  // Ces trois-la sont dans la palette canonique bien qu'un seul monde s'en
  // serve : c'est la regle du fichier, aucune couleur n'est inventee ailleurs.
  leafRust: 0xc95a1e,
  leafBlood: 0x9c2f1c,
  leafAmber: 0xd39a34,
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
