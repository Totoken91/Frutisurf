import { GLSL_NOISE } from '../core/Noise';
/**
 * Le relief.
 *
 * Une seule source de verite pour la hauteur du sol : la meme liste de couches
 * sert au CPU (physique) et au GPU (deplacement des sommets). Le chunk GLSL est
 * GENERE depuis ces constantes, jamais recopie a la main — sinon les deux
 * versions derivent au premier ajustement et le surfeur se met a flotter ou a
 * s'enfoncer dans la colline.
 *
 * Des sinus plutot qu'un bruit : reproductibles a l'identique des deux cotes,
 * et surtout DERIVABLES analytiquement. On obtient la pente et la normale sans
 * echantillonner, ce qui rend la detection de crete exacte.
 */

interface Layer {
  /** amplitude en metres */
  a: number;
  /** frequence le long de l'axe de deplacement */
  fz: number;
  /** frequence laterale — casse les cretes en lignes droites */
  fx: number;
  /** phase */
  p: number;
  /**
   * Distance a laquelle la couche s'efface. Les hautes frequences disparaissent
   * les premieres : la grille se detend avec la distance et sans ca elles
   * crenellent. C'est du frequency clamping, pas de la triche visuelle.
   */
  fade: readonly [number, number];
}

/**
 * Amplitudes calees sur la PENTE et la COURBURE, pas a vue.
 *
 *  - pente a*f : ~10 deg typique, 27 deg au pire cas ou tout s'aligne ;
 *  - courbure a*f2 : au-dela de g/v2 la crete ne peut plus retenir le disque
 *    et on decolle tout seul. Les deux couches courtes franchissent ce seuil
 *    vers 30-35 m/s, ce qui fait apparaitre les envols naturels avec la vitesse.
 *
 * Le premier jet visait l'amplitude a l'oeil : 1.15 m sur 80 m de long, soit
 * une pente de 1.4 %, invisible depuis une camera a 10 m de recul.
 */
const LAYERS: readonly Layer[] = [
  // lambda 480 m — la houle de fond, elle donne le grand rythme du paysage.
  { a: 6.0, fz: 0.01309, fx: 0.0049, p: 0.0, fade: [2600, 3600] },
  // lambda 190 m — les vallons.
  { a: 3.6, fz: 0.03307, fx: -0.0124, p: 1.73, fade: [1500, 2400] },
  // lambda 84 m — le relief roulable.
  { a: 2.3, fz: 0.0748, fx: 0.0263, p: 3.91, fade: [800, 1400] },
  // lambda 42 m — LES collines a sauter. Longueur d'onde raccourcie de 61 a
  // 42 m : a 61 m la bosse etait trop etalee pour se VOIR depuis une camera
  // rasante, et on ne peut pas timer ce qu'on ne voit pas.
  { a: 1.05, fz: 0.1496, fx: -0.0524, p: 5.24, fade: [420, 700] },
  // lambda 21 m — trop court pour viser, mais ca anime la glisse et ca lance.
  // Amplitude volontairement basse : cette couche apporte peu de PENTE mais
  // enormement de COURBURE (a*f2), donc beaucoup d'envols subis pour peu de
  // relief visible. A 0.26 elle envoyait en l'air un quart du temps en croisiere.
  { a: 0.16, fz: 0.2992, fx: 0.1024, p: 2.08, fade: [180, 320] },
];

/**
 * Niveau de l'eau, en metres.
 *
 * Il n'y a PAS de lacs places a la main : il y a un niveau, et l'eau remplit
 * tout ce que le relief laisse en dessous. Les rives suivent donc les courbes
 * de niveau du terrain, elles sont organiques et differentes a chaque fois,
 * pour le prix d'une constante.
 *
 * -5,5 m mesure sur le terrain reel : 17,6 % de la course sous l'eau, une
 * etendue tous les 260 m (une toutes les neuf secondes en croisiere), 46 m de
 * large en moyenne — une seconde et demie de glisse. C'est le rythme voulu :
 * assez frequent pour que la mecanique compte, assez court pour que la
 * traversee reste une figure et non un couloir.
 */
export const WATER_LEVEL = -5.5;

/**
 * Largeur de la greve, en hauteur au-dessus de l'eau : une base plus une part
 * variable. Resserrees d'un cinquieme sur retour joueur — la plage mangeait
 * trop de premier plan, et une greve trop large cesse d'etre une transition
 * pour devenir un decor a part entiere.
 */
const SHORE_BASE = 1.55;
const SHORE_VARY = 3.2;

/** Amplitude cumulee : sert a caler la camera et les garde-fous. */
export const TERRAIN_MAX = LAYERS.reduce((s, l) => s + l.a, 0);

/** Hauteur du sol. Pleine resolution : c'est la reference physique. */
export function terrainHeight(x: number, z: number): number {
  let h = 0;
  for (const l of LAYERS) h += l.a * Math.sin(l.fz * z + l.fx * x + l.p);
  return h;
}

/** Vrai si le point est sous le niveau de l'eau. */
export function isWater(x: number, z: number): boolean {
  return terrainHeight(x, z) < WATER_LEVEL;
}

/**
 * Profondeur d'eau au point, en metres. Zero sur la terre ferme.
 * Sert a la physique : au-dela d'une certaine profondeur on ne touche plus le
 * fond, et c'est la vitesse seule qui decide si l'on flotte ou si l'on coule.
 */
export function waterDepth(x: number, z: number): number {
  return Math.max(0, WATER_LEVEL - terrainHeight(x, z));
}

/** Gradient analytique (dh/dx, dh/dz). */
export function terrainGradient(x: number, z: number, out: { dx: number; dz: number }): void {
  let dx = 0;
  let dz = 0;
  for (const l of LAYERS) {
    const c = Math.cos(l.fz * z + l.fx * x + l.p);
    dx += l.a * l.fx * c;
    dz += l.a * l.fz * c;
  }
  out.dx = dx;
  out.dz = dz;
}

/**
 * Chunk GLSL genere depuis LAYERS.
 *
 * `uOrigin` est la position du joueur : le fondu des couches se mesure depuis
 * lui, jamais depuis la camera, pour que le sol sous ses pieds soit toujours a
 * pleine resolution et corresponde exactement a `terrainHeight`.
 */
/**
 * Le masque de GREVE, en un seul endroit.
 *
 * Il etait ecrit trois fois — dans le sol, dans les touffes, dans les palmiers
 * — avec les memes constantes recopiees a la main. C'est exactement le piege
 * que ce fichier existe pour eviter : le jour ou l'on retouche la largeur de
 * plage, deux copies sur trois suivent, et il pousse de l'herbe sur le sable ou
 * des palmiers dans l'eau.
 *
 * Il depend de `fbm2`/`fbm3`, qu'il TIRE lui-meme : une dependance qu'il faut
 * penser a coller a la main juste au-dessus est une dependance qu'on oubliera,
 * et c'est exactement ce qui est arrive au shader de sommet du sol. Les deux
 * chunks portent une garde d'inclusion, donc les inclure tous les deux reste
 * sans effet.
 *
 * @returns `shoreMask(vec2 wp, float above)` -> 0 hors greve, 1 en plein sable,
 *          et `shoreWidth(vec2 wp)` pour ceux qui ont besoin de la largeur.
 */
export function shoreGLSL(): string {
  return /* glsl */ `
${GLSL_NOISE}
#ifndef FS_SHORE
#define FS_SHORE
// Largeur de greve. C'est une HAUTEUR au-dessus de l'eau, pas une distance au
// sol : sur une pente douce elle donne une plage large, sur une pente raide un
// simple ourlet — le comportement d'une vraie cote, gratuitement.
float shoreWidth(vec2 wp){
  return ${SHORE_BASE.toFixed(2)} + fbm2(wp * 0.010) * ${SHORE_VARY.toFixed(2)};
}
// Trois echelles de decoupe : les anses, les langues de sable qui remontent
// dans l'herbe, la dentelure fine. C'est leur superposition qui empeche de lire
// une courbe de niveau.
// La DENTELURE du trait de cote, exposee a part.
//
// Le sol s'en ressert pour poser les laisses de mer et la frange d'ecume : ces
// lignes doivent epouser le contour de la plage au metre pres. Les recalculer
// avec « a peu pres le meme bruit » les ferait glisser en travers du sable, ce
// qui est precisement l'inverse de ce qu'une laisse de mer raconte.
float shoreRagged(vec2 wp){
  return (fbm3(wp * 0.055) - 0.5) * 2.1
       + (fbm2(wp * 0.17) - 0.5) * 0.8
       + (fbm2(wp * 0.62) - 0.5) * 0.24;
}
float shoreMask(vec2 wp, float above){
  float ragged = shoreRagged(wp);
  float m = clamp(1.0 - smoothstep(0.0, shoreWidth(wp), above + ragged), 0.0, 1.0);
  // Le haut de plage se MELANGE a l'herbe : une frontiere nette entre deux
  // aplats se lit comme un masque de decoupe, quelle que soit la finesse du
  // contour.
  return smoothstep(0.02, 0.78, m);
}
#endif
`;
}

export function terrainGLSL(): string {
  const terms = LAYERS.map(
    (l) =>
      `  h += ${l.a.toFixed(4)} * sin(${l.fz.toFixed(6)} * p.y + ${l.fx.toFixed(6)} * p.x + ${l.p.toFixed(4)})` +
      ` * (1.0 - smoothstep(${l.fade[0].toFixed(1)}, ${l.fade[1].toFixed(1)}, d));`,
  ).join('\n');

  const grads = LAYERS.map(
    (l) =>
      `  { float c = cos(${l.fz.toFixed(6)} * p.y + ${l.fx.toFixed(6)} * p.x + ${l.p.toFixed(4)})` +
      ` * (1.0 - smoothstep(${l.fade[0].toFixed(1)}, ${l.fade[1].toFixed(1)}, d));` +
      ` g += vec2(${(l.a * l.fx).toFixed(8)} * c, ${(l.a * l.fz).toFixed(8)} * c); }`,
  ).join('\n');

  return /* glsl */ `
// --- GENERE depuis src/world/Terrain.ts : ne pas editer a la main ---
const float WATER_LEVEL = ${WATER_LEVEL.toFixed(3)};
float terrainHeightAt(vec2 p, float d){
  float h = 0.0;
${terms}
  return h;
}
vec2 terrainGradAt(vec2 p, float d){
  vec2 g = vec2(0.0);
${grads}
  return g;
}
vec3 terrainNormalAt(vec2 p, float d){
  vec2 g = terrainGradAt(p, d);
  return normalize(vec3(-g.x, 1.0, -g.y));
}
`;
}
