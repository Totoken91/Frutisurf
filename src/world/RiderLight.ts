/**
 * LA LAMPE DU SURFEUR.
 *
 * Un personnage « qui brille » et qui n'eclaire rien n'est pas lumineux : c'est
 * un autocollant fluorescent. La difference se joue entierement sur le SOL —
 * une flaque de couleur qui voyage avec lui, qui passe sur l'herbe, qui monte
 * sur le sable, qui se reflete dans l'eau. Sans elle, un buddy vert reste un
 * buddy peint en vert.
 *
 * ---
 *
 * POURQUOI PAS UNE PointLight.
 *
 * three.js sait faire une lampe ponctuelle, et elle serait juste. Mais le sol,
 * les brins, l'eau et les palmiers de ce jeu sont des ShaderMaterial ecrits a
 * la main : ils n'utilisent PAS le systeme d'eclairage de three, et le seul
 * materiau qui l'utilise est le verre du buddy. Une PointLight eclairerait donc
 * exactement l'objet qui brille deja, et rien d'autre — c'est-a-dire l'inverse
 * de ce qu'on veut.
 *
 * On passe donc la lampe a la main, en trois uniformes, aux quatre surfaces qui
 * comptent. C'est moins general et beaucoup plus direct : une addition et un
 * carre par pixel.
 *
 * ---
 *
 * Les deux tableaux sont MUTES EN PLACE et branches tels quels comme valeurs
 * d'uniformes, exactement comme les amplitudes de relief : ecrire dedans met a
 * jour toutes les surfaces d'un coup, sans qu'aucune ait a etre prevenue.
 */

/** Position monde de la lampe : x, y, z. */
export const RIDER_POS: number[] = [0, 0, 0];
/**
 * Couleur DEJA multipliee par la puissance. Zero = pas de lampe.
 *
 * Prémultipliée pour que le shader n'ait qu'une addition a faire, et surtout
 * pour qu'une puissance nulle coute exactement zero : `uRiderCol` a zero rend
 * le terme entier nul sans aucun branchement.
 */
export const RIDER_COL: number[] = [0, 0, 0];
/** Rayon de la flaque, en metres. */
export const RIDER_RAD: number[] = [9];

export function riderUniforms(): Record<string, { value: unknown }> {
  return {
    uRiderPos: { value: RIDER_POS },
    uRiderCol: { value: RIDER_COL },
    uRiderRad: { value: RIDER_RAD },
  };
}

/**
 * @param power 0..1. Deja combine : teinte du perso, aura de vitesse, nuit.
 */
export function setRiderLight(
  x: number,
  y: number,
  z: number,
  r: number,
  g: number,
  b: number,
  power: number,
  radius: number,
): void {
  RIDER_POS[0] = x;
  RIDER_POS[1] = y;
  RIDER_POS[2] = z;
  RIDER_COL[0] = r * power;
  RIDER_COL[1] = g * power;
  RIDER_COL[2] = b * power;
  RIDER_RAD[0] = radius;
}

/**
 * Le chunk a inclure dans toute surface que la lampe doit atteindre.
 *
 * L'attenuation est en (1 - d/r)^2 et non en 1/d^2 : la loi physique n'a pas de
 * portee finie, donc elle teinterait faiblement tout l'ecran et il faudrait la
 * couper quelque part de toute facon. Une courbe a support borne s'eteint
 * exactement ou on le decide, ce qui est la seule chose qui compte pour une
 * flaque de lumiere qu'on veut LIRE.
 */
export const RIDER_GLSL = /* glsl */ `
#ifndef FS_RIDER
#define FS_RIDER
uniform vec3 uRiderPos;
uniform vec3 uRiderCol;
uniform float uRiderRad[1];
vec3 riderLight(vec3 wp){
  // Distance HORIZONTALE d'abord, ecart vertical seulement en appoint.
  //
  // La distance euclidienne semblait evidemment juste et elle rate la cible :
  // la lampe voyage a deux metres au-dessus du sol, donc le point exactement
  // sous le surfeur est deja a deux metres d'elle, et la flaque perd la moitie
  // de sa force la ou elle devrait etre la plus forte. Pire, une nappe d'eau
  // huit metres plus bas sortait entierement de portee.
  //
  // Une lampe rasante n'eclaire pas une sphere, elle eclaire une SURFACE : la
  // grandeur qui compte est la distance dans le plan du sol. L'ecart vertical
  // ne sert plus qu'a eteindre la lueur quand on saute vraiment haut.
  float dh = length(wp.xz - uRiderPos.xz);
  float dv = abs(wp.y - uRiderPos.y);
  float d = dh + dv * 0.45;
  float f = 1.0 - clamp(d / uRiderRad[0], 0.0, 1.0);
  // CUBE et non carre. Au carre, la moitie du rayon gardait encore un quart de
  // la puissance : la flaque n'avait pas de bord, elle teintait tout le premier
  // plan d'un aplat uniforme et le sol du monde disparaissait dessous. Le cube
  // resserre le coeur et laisse la matiere revenir des quelques metres.
  return uRiderCol * f * f * f;
}
#endif
`;
