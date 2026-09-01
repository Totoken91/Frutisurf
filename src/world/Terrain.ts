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

/**
 * UNE BASE, PLUSIEURS MONDES.
 *
 * Les frequences, les phases et les fondus sont communs a TOUS les mondes ;
 * seules les cinq amplitudes changent. Ce n'est pas une economie de code, c'est
 * ce qui rend les mondes interpolables : une combinaison lineaire des memes
 * fonctions de base reste une fonction de la meme famille, donc on peut passer
 * de la plaine a l'archipel en fondu continu, sans recompiler un shader et sans
 * que le sol ne glisse sous les pieds du surfeur.
 *
 * Faire varier les FREQUENCES aurait donne des mondes plus differents et un
 * changement de monde inregardable : le relief se serait mis a defiler
 * lateralement pendant toute la transition.
 */
interface Layer {
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
  { fz: 0.01309, fx: 0.0049, p: 0.0, fade: [2600, 3600] },
  // lambda 190 m — les vallons.
  { fz: 0.03307, fx: -0.0124, p: 1.73, fade: [1500, 2400] },
  // lambda 84 m — le relief roulable.
  { fz: 0.0748, fx: 0.0263, p: 3.91, fade: [800, 1400] },
  // lambda 42 m — LES collines a sauter. Longueur d'onde raccourcie de 61 a
  // 42 m : a 61 m la bosse etait trop etalee pour se VOIR depuis une camera
  // rasante, et on ne peut pas timer ce qu'on ne voit pas.
  { fz: 0.1496, fx: -0.0524, p: 5.24, fade: [420, 700] },
  // lambda 21 m — trop court pour viser, mais ca anime la glisse et ca lance.
  // Amplitude volontairement basse : cette couche apporte peu de PENTE mais
  // enormement de COURBURE (a*f2), donc beaucoup d'envols subis pour peu de
  // relief visible. A 0.26 elle envoyait en l'air un quart du temps en croisiere.
  { fz: 0.2992, fx: 0.1024, p: 2.08, fade: [180, 320] },
];

/**
 * LES AMPLITUDES COURANTES, en metres. L'etat du monde, et le seul.
 *
 * Le tableau est MUTE EN PLACE et jamais remplace : il est branche tel quel
 * comme valeur de l'uniforme `uAmp` dans chaque materiau qui deplace des
 * sommets. Ecrire dedans suffit donc a changer le relief partout a la fois —
 * CPU et GPU — sans une seule recompilation et sans avoir a se souvenir de qui
 * doit etre prevenu. Le remplacer par un nouveau tableau casserait ce lien, et
 * le sol du GPU se figerait sur l'ancien monde pendant que la physique suivrait
 * le nouveau : le surfeur volerait au-dessus du decor.
 */
export const AMP: number[] = [6.0, 3.6, 2.3, 1.05, 0.16];

/** Idem pour la greve : [base, part variable], partage avec les shaders. */
export const SHORE: number[] = [1.55, 3.2];

/**
 * LA HOULE : [amplitude en metres, longueur d'onde, vitesse].
 *
 * Amplitude nulle = surface plate, et c'est le cas de tous les mondes sauf
 * l'ocean. Ce n'est pas un effet visuel : le Controller lit exactement la meme
 * fonction, donc la houle porte une PENTE et une COURBURE, et tout ce que le
 * jeu sait deja faire du relief — detecter une crete, la timer, decoller
 * dessus — fonctionne sur l'eau sans une ligne de plus.
 *
 * C'est la seule facon honnete de rendre un ocean jouable. Une etendue plate de
 * trois cents metres est un couloir ou l'on tient la direction ; la meme
 * etendue avec de la houle est une suite de vagues qu'on lit, qu'on anticipe et
 * dont on saute.
 */
export const SWELL: number[] = [0, 60, 1];

/** Niveau de l'eau. Scalaire, donc pousse explicitement (cf. pushTerrain). */
let water = -5.5;

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
export function waterLevel(): number {
  return water;
}

/**
 * Installe un relief. Appele par le fondu de monde, a chaque image pendant la
 * transition — c'est donc volontairement une ecriture en place et rien d'autre.
 */
export function setTerrain(
  amp: readonly number[],
  w: number,
  shoreBase: number,
  shoreVary: number,
  swell: readonly number[] = [0, 60, 1],
): void {
  for (let i = 0; i < AMP.length; i++) AMP[i] = amp[i] ?? 0;
  water = w;
  SHORE[0] = shoreBase;
  SHORE[1] = shoreVary;
  SWELL[0] = swell[0] ?? 0;
  SWELL[1] = swell[1] ?? 60;
  SWELL[2] = swell[2] ?? 1;
}

/**
 * Hauteur de la houle au-dessus du niveau moyen, en metres.
 *
 * Deux trains croises, jamais un seul : une houle a une direction unique
 * defile en bloc et se lit comme une texture qu'on translate, exactement comme
 * les rides de surface avant qu'on ne leur donne deux couches. Le second train
 * est plus court, plus rapide, oblique, et d'amplitude 42 % — assez pour casser
 * la regularite, pas assez pour effacer la vague principale.
 *
 * Le facteur 1/1.42 renormalise la somme : sans lui, l'amplitude demandee et
 * l'amplitude obtenue different de 42 %, et tout reglage fait a l'oeil sur la
 * premiere se retrouve faux sur la seconde.
 */
export function swellAt(x: number, z: number, t: number): number {
  const a = SWELL[0];
  if (a <= 0) return 0;
  const k = (Math.PI * 2) / SWELL[1];
  const w = SWELL[2];
  return (
    (a / 1.42) *
    (Math.sin(k * (z + x * 0.35) - w * t) +
      0.42 * Math.sin(k * 1.63 * (z * 0.85 - x * 0.55) - w * 1.31 * t + 1.7))
  );
}

/**
 * Attenuation de la houle en eau peu profonde.
 *
 * Physique et indispensable : une vague de 1,2 m qui garderait son amplitude
 * jusqu'a la rive ferait monter la surface AU-DESSUS du sable. Les vagues
 * reelles s'aplatissent en arrivant sur le haut-fond ; ici la meme courbe
 * resout le probleme graphique et raconte la bonne chose.
 */
export function swellShoal(depth: number): number {
  const t = Math.min(Math.max((depth - 0.4) / 3.6, 0), 1);
  return t * t * (3 - 2 * t);
}

/** Surface de l'eau au point : niveau moyen plus houle attenuee. */
export function waterSurface(x: number, z: number, t: number): number {
  if (SWELL[0] <= 0) return water;
  return water + swellAt(x, z, t) * swellShoal(water - terrainHeight(x, z));
}

/** Amplitude cumulee courante : sert a caler la camera et les garde-fous. */
export function terrainMax(): number {
  return AMP.reduce((s, a) => s + a, 0);
}

/** Hauteur du sol. Pleine resolution : c'est la reference physique. */
export function terrainHeight(x: number, z: number): number {
  let h = 0;
  for (let i = 0; i < LAYERS.length; i++) {
    const l = LAYERS[i];
    h += AMP[i] * Math.sin(l.fz * z + l.fx * x + l.p);
  }
  return h;
}

/** Vrai si le point est sous le niveau de l'eau. */
export function isWater(x: number, z: number): boolean {
  return terrainHeight(x, z) < water;
}

/**
 * Profondeur d'eau au point, en metres. Zero sur la terre ferme.
 * Sert a la physique : au-dela d'une certaine profondeur on ne touche plus le
 * fond, et c'est la vitesse seule qui decide si l'on flotte ou si l'on coule.
 */
export function waterDepth(x: number, z: number): number {
  return Math.max(0, water - terrainHeight(x, z));
}

/** Gradient analytique (dh/dx, dh/dz). */
export function terrainGradient(x: number, z: number, out: { dx: number; dz: number }): void {
  let dx = 0;
  let dz = 0;
  for (let i = 0; i < LAYERS.length; i++) {
    const l = LAYERS[i];
    const c = Math.cos(l.fz * z + l.fx * x + l.p);
    dx += AMP[i] * l.fx * c;
    dz += AMP[i] * l.fz * c;
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
uniform vec2 uShore;
float shoreWidth(vec2 wp){
  return uShore.x + fbm2(wp * 0.010) * uShore.y;
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
    (l, i) =>
      `  h += uAmp[${i}] * sin(${l.fz.toFixed(6)} * p.y + ${l.fx.toFixed(6)} * p.x + ${l.p.toFixed(4)})` +
      ` * (1.0 - smoothstep(${l.fade[0].toFixed(1)}, ${l.fade[1].toFixed(1)}, d));`,
  ).join('\n');

  const grads = LAYERS.map(
    (l, i) =>
      `  { float c = cos(${l.fz.toFixed(6)} * p.y + ${l.fx.toFixed(6)} * p.x + ${l.p.toFixed(4)})` +
      ` * (1.0 - smoothstep(${l.fade[0].toFixed(1)}, ${l.fade[1].toFixed(1)}, d));` +
      ` g += uAmp[${i}] * vec2(${l.fx.toFixed(8)} * c, ${l.fz.toFixed(8)} * c); }`,
  ).join('\n');

  return /* glsl */ `
// --- GENERE depuis src/world/Terrain.ts : ne pas editer a la main ---
// Seules les AMPLITUDES sont des uniformes : frequences, phases et fondus sont
// communs a tous les mondes et restent des litteraux, donc le compilateur les
// replie. Changer de monde ne recompile rien.
#ifndef FS_TERRAIN
#define FS_TERRAIN
uniform float uAmp[${LAYERS.length}];
uniform float WATER_LEVEL;
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
#endif
`;
}

/**
 * Les uniformes que DOIT fusionner tout materiau incluant `terrainGLSL()` ou
 * `shoreGLSL()`. En oublier un donne un sol plat au niveau zero — visible, mais
 * seulement si on regarde ce materiau-la. `npm run check:world` verifie
 * statiquement que les deux vont toujours ensemble.
 *
 * `uAmp` et `uShore` pointent sur les tableaux PARTAGES : ils se mettent a jour
 * tout seuls. Seul le niveau de l'eau, qui est un scalaire, doit etre pousse.
 */
export function terrainUniforms(): Record<string, { value: unknown }> {
  return {
    uAmp: { value: AMP },
    uShore: { value: SHORE },
    uSwell: { value: SWELL },
    WATER_LEVEL: { value: water },
  };
}

/**
 * La houle en GLSL. Le JUMEAU EXACT de `swellAt` et `swellShoal` ci-dessus.
 *
 * C'est le point critique de toute la mecanique : le surfeur plane a la hauteur
 * que calcule le CPU, la vague est dessinee a la hauteur que calcule le GPU.
 * Un ecart de quelques centimetres et le disque flotte au-dessus de l'eau ou
 * s'y enfonce — et un ecart de signe le ferait surfer dans les creux. Les deux
 * versions vivent donc cote a cote, dans le meme fichier, et se relisent d'un
 * coup d'oeil.
 */
export function swellGLSL(): string {
  return /* glsl */ `
#ifndef FS_SWELL
#define FS_SWELL
uniform vec3 uSwell;
float swellAt(vec2 p, float t){
  if (uSwell.x <= 0.0) return 0.0;
  float k = 6.28318530718 / uSwell.y;
  float w = uSwell.z;
  return (uSwell.x / 1.42)
    * (sin(k * (p.y + p.x * 0.35) - w * t)
     + 0.42 * sin(k * 1.63 * (p.y * 0.85 - p.x * 0.55) - w * 1.31 * t + 1.7));
}
float swellShoal(float depth){
  return smoothstep(0.4, 4.0, depth);
}
#endif
`;
}

/** Pousse le scalaire du niveau d'eau. Ignore les materiaux qui n'en ont pas. */
export function pushTerrain(uniforms: Record<string, { value: unknown } | undefined>): void {
  const u = uniforms.WATER_LEVEL;
  if (u) u.value = water;
}
