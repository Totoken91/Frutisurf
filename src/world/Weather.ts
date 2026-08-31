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
 */
export const WEATHER_GLSL = /* glsl */ `
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
`;
