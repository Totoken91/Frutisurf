import { GLSL_NOISE } from '../core/Noise';
import { smoothstep } from '../core/Spring';

/**
 * Le temps qu'il fait, en une fonction partagee.
 *
 * Deux phenomenes, tous deux ancres en MONDE et non a l'ecran, tous deux lus
 * a l'identique par le sol et par les touffes : sans ca les brins resteraient
 * en plein soleil pendant que l'herbe autour d'eux passe a l'ombre, et le
 * decor se dissocierait en deux couches.
 *
 * L'ombre de nuage est le detail qui donne son ECHELLE a un paysage ouvert.
 * Une plaine uniformement eclairee n'a pas de taille : on ne sait pas si elle
 * fait cent metres ou dix kilometres. Des plages d'ombre de deux cents metres
 * qui la traversent lentement repondent a la question sans un mot.
 *
 * La rafale, elle, donne son EPAISSEUR a l'air. Un vent constant se lit comme
 * une inclinaison figee ; une vague qui traverse le champ se lit comme du vent.
 *
 * ---
 *
 * ET DEPUIS OCTOBRE, LA RAFALE EST AUSSI UNE FORCE.
 *
 * Elle etait purement decorative : les brins se couchaient, les palmes
 * pliaient, et le joueur ne sentait rien. Le monde d'automne s'en sert comme
 * mecanique — le vent DEPORTE le disque — et ca impose la meme discipline que
 * la houle : une seule fonction, un jumeau TS et un jumeau GLSL cote a cote
 * dans ce fichier, jamais deux formules « a peu pres pareilles ».
 *
 * C'est tout l'interet de la chose : la rafale qu'on VOIT traverser le champ,
 * coucher l'herbe et emporter les feuilles est exactement celle qu'on SENT
 * pousser le disque. Un vent qu'on subirait sans le voir arriver ne serait
 * qu'un bruit ajoute aux commandes.
 */

/**
 * FORCE DU VENT DU MONDE COURANT, en m/s au pic de rafale.
 *
 * Meme protocole que `AMP` dans Terrain.ts : un tableau MUTE EN PLACE, jamais
 * remplace, pour qu'une seule ecriture serve la physique et les shaders. Zero
 * dans tous les mondes sauf OCTOBRE.
 */
export const WIND: number[] = [0];

export function setWind(v: number): void {
  WIND[0] = v;
}

/**
 * La rafale, cote TS. JUMEAU EXACT de `gustAt` en GLSL, quelques lignes plus
 * bas. 0 = accalmie, 1 = plein dans la bourrasque.
 */
export function gustAt(x: number, z: number, t: number): number {
  const w = (x * 0.82 + z * 0.57) * 0.055 - t * 1.35;
  return smoothstep(0.15, 0.95, Math.sin(w) * 0.5 + 0.5);
}

/**
 * La poussee laterale, en m/s. SIGNEE, et c'est le point.
 *
 * Une rafale toujours orientee dans le meme sens serait une taxe : il
 * suffirait de tenir la direction opposee une fois pour toutes et le vent
 * cesserait d'exister. Centree, elle BALANCE — le disque part a droite quand
 * la crete de rafale passe, revient a gauche dans le creux — et il faut la
 * lire en continu comme on lit le relief.
 *
 * Le champ etant ancre en monde, la periode ressentie depend de la vitesse :
 * on subit la meme bourrasque toutes les 2,7 s en croisiere, plus vite quand
 * on accelere. Le vent se durcit donc exactement quand on a le moins de temps
 * pour le corriger, sans une ligne de code de plus.
 */
export function windAt(x: number, z: number, t: number): number {
  if (WIND[0] <= 0) return 0;
  return (gustAt(x, z, t) * 2 - 1) * WIND[0];
}

/**
 * Le chunk partage. Il TIRE le bruit lui-meme et porte une garde d'inclusion,
 * pour la meme raison que le masque de greve : une dependance qu'il faut
 * penser a coller a la main juste au-dessus est une dependance qu'on oubliera.
 */
export const WEATHER_GLSL = /* glsl */ `
${GLSL_NOISE}
#ifndef FS_WEATHER
#define FS_WEATHER
// --- Ombre portee des nuages. 0 = plein soleil, 1 = a l'ombre.
//
// Le contour est FRANC (smoothstep serre) : une ombre de nuage a un bord.
// Etalee, elle se confond avec une variation d'albedo et ne se lit plus comme
// une ombre. Elle ne s'attenue PAS avec la distance — c'est justement au loin
// qu'elle raconte l'echelle du paysage.
float cloudShade(vec2 p, float t){
  vec2 q = p * 0.0052 + vec2(t * 0.0165, t * 0.0098);
  // Deux octaves suffisent : le champ tourne a 0,005, et le smoothstep serre
  // qui suit durcit le bord de toute facon — les octaves hautes n'y survivent
  // pas. Ce chunk est lu par le sol, les brins ET l'eau : dix octaves par pixel
  // y etaient payees trois fois.
  float m = fbm2(q) * 0.68 + fbm2(q * 2.7 + 11.3) * 0.32;
  return smoothstep(0.44, 0.62, m);
}

// --- Rafale : une vague qui traverse le champ dans l'axe du vent.
float gustAt(vec2 p, float t){
  float w = dot(p, vec2(0.82, 0.57)) * 0.055 - t * 1.35;
  return smoothstep(0.15, 0.95, sin(w) * 0.5 + 0.5);
}

// --- La MEME rafale, centree. C'est elle que la physique applique au disque
// (cf. windAt en TS juste au-dessus) et elle que les feuilles et la pluie
// suivent : ce qui pousse le joueur et ce qui emporte le decor doivent etre
// le meme nombre, sinon on voit la triche.
float gustPush(vec2 p, float t){
  return gustAt(p, t) * 2.0 - 1.0;
}

// --- IMPACTS DE PLUIE.
//
// Une cellule d'un demi-metre, un impact par cellule, et un instant propre a
// chaque cellule : le champ est un semis d'anneaux qui naissent et meurent
// sans jamais se synchroniser. Un seul sinus global donnerait une respiration
// collective, ce qu'aucune pluie ne fait.
//
// Le centre de l'impact est lui aussi decale par cellule, sinon les anneaux
// se rangent en grille — et une grille, l'oeil la voit immediatement.
float rainRings(vec2 p, float t){
  vec2 g = p * 2.2;
  vec2 cell = floor(g);
  vec2 f = fract(g) - 0.5;
  float h = hash21(cell);
  f -= (vec2(hash21(cell + 3.7), hash21(cell + 8.1)) - 0.5) * 0.55;
  float ph = fract(t * 1.35 + h * 7.0);
  float r = length(f);
  // L'anneau s'ELARGIT et s'eteint : un anneau d'amplitude constante lit comme
  // une texture qui clignote, pas comme une goutte qui tombe.
  return sin((r - ph * 0.42) * 46.0) * exp(-r * 11.0) * (1.0 - ph);
}
#endif
`;
