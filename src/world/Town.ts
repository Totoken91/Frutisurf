import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  InstancedMesh,
  Matrix4,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { GLSL_NOISE, GLSL_SAFE } from '../core/Noise';
import { vec3 } from '../core/Palette';
import { GLSL_DAY, dayUniforms } from './Daylight';
import { RIDER_GLSL, riderUniforms } from './RiderLight';
import { terrainGLSL, terrainUniforms } from './Terrain';

/**
 * LE QUARTIER.
 *
 * ---
 *
 * POURQUOI PAS LA VILLE DE CRISTAL.
 *
 * Les tours de verre a un kilometre sont une PROMESSE : quelque chose de grand
 * qu'on n'atteindra jamais, posee tout au fond pour donner de l'echelle a la
 * plaine. C'est juste pour la plaine, et c'est faux pour octobre. Un mois
 * d'octobre melancolique ne se joue pas devant une skyline : il se joue en
 * BORDURE DE VILLE, dans un lotissement, a l'heure ou les fenetres s'allument
 * une par une et ou personne n'est dehors.
 *
 * D'ou un decor qui n'est plus au fond mais SUR LES COTES, qu'on croise et
 * qu'on double, et dont chaque element passe assez pres pour avoir un toit,
 * des fenetres et une lumiere.
 *
 * ---
 *
 * TROIS ELEMENTS, ET CHACUN FAIT UNE CHOSE QUE LES AUTRES NE FONT PAS.
 *
 *   1. LES MAISONS. Un pignon a deux pentes tourne vers la route. C'est la
 *      SILHOUETTE qui identifie une maison a cinquante metres, pas la texture :
 *      une boite a toit plat lit comme un hangar quel que soit le soin mis a
 *      ses murs.
 *   2. LES FENETRES ALLUMEES. Le sujet emotionnel, et de loin le detail le plus
 *      rentable du monde entier. Elles ne sont pas des rectangles jaunes : elles
 *      DEBORDENT sur le mur autour d'elles. Une fenetre allumee sans halo lit
 *      comme un autocollant.
 *   3. LES LAMPADAIRES. Ils ne se contentent pas d'exister : ils POSENT UNE
 *      FLAQUE DE LUMIERE sur la route mouillee (cf. TOWN_GLSL, relu par
 *      Ground.ts). Un lampadaire qui n'eclaire rien est un poteau.
 *
 * La lampe et sa flaque partagent la MEME fonction de placement, exportee
 * ci-dessous. C'est la meme discipline que la houle et la rafale : deux
 * formules « a peu pres pareilles » se decaleraient d'un metre et la flaque
 * serait a cote du lampadaire — le genre de faute qu'on voit sans savoir la
 * nommer.
 */

/**
 * Espacement des rangees, en metres.
 *
 * Exporte parce que le banc de stabilite (scripts/town-check.mjs) doit savoir
 * OU tomberont les franchissements de grille : c'est la, et nulle part
 * ailleurs, que le decor peut sauter. Un banc qui chercherait le defaut au
 * hasard le manquerait neuf fois sur dix.
 */
export const TOWN_STEP = 20;
const STEP = TOWN_STEP;
/** Nombre de rangees suivies autour du joueur. */
const ROWS = 24;
/** Decalage de la premiere rangee : une rangee et demie derriere le joueur. */
const AHEAD = 36;
/**
 * Sept emplacements par rangee : deux maisons de premier rang (une par cote),
 * une en fond de parcelle, DEUX sur les deux bords de la rue transversale, un
 * lampadaire et un arbre.
 *
 * TROIS RANGS ET PAS UN, et c'est une contrainte de CADRAGE avant d'etre un
 * choix esthetique. En portrait le champ horizontal ne fait que trente-sept
 * degres : a cinquante metres de la route, une maison n'entre dans l'image
 * qu'a partir de cent cinquante metres devant. Un seul rang donne donc une
 * frise lointaine, jamais une rue. Il faut du decor a plusieurs profondeurs
 * pour que les maisons se recouvrent et fassent un quartier.
 */
const SLOTS = 7;

/**
 * Le placement des lampadaires, en GLSL, partage.
 *
 * Relu par le halo, par le mat lui-meme et par le SOL, qui s'en sert pour
 * poser la flaque de lumiere sur l'asphalte mouille.
 */
export const TOWN_GLSL = /* glsl */ `
${GLSL_NOISE}
#ifndef FS_TOWN
#define FS_TOWN
#define TOWN_STEP ${STEP.toFixed(1)}
#define TOWN_AHEAD ${AHEAD.toFixed(1)}
#define TOWN_LAMP_H 5.6
// Pas des rues transversales. Un multiple non entier du pas des rangees, pour
// qu'une rue ne tombe jamais deux fois sur la meme maison.
#define TOWN_CROSS 112.0

// LE Z D'UNE RANGEE. C'est la SEULE chose que l'index d'instance a le droit
// de decider. org est la position du joueur.
// (Et pas d'accent grave dans ces commentaires : ils vivent dans un gabarit
//  JS, un seul backtick termine la chaine.)
float townZ(float row, vec2 org){
  return floor(org.y / TOWN_STEP) * TOWN_STEP + TOWN_AHEAD - row * TOWN_STEP;
}

// ---------------------------------------------------------------------------
// L'INVARIANT DU DECOR ANCRE AU MONDE, et il n'a rien d'evident.
//
// LE CONTENU D'UNE RANGEE NE DEPEND QUE DE SON Z, JAMAIS DE SON INDEX.
//
// Quand le joueur franchit un pas de grille, l'ancre recule d'un cran et CHAQUE
// instance herite du z de sa voisine. C'est voulu : c'est ce qui fait defiler
// le decor sans jamais en allouer un seul. Mais si le contenu d'une instance
// depend de son INDEX, il ne suit pas le z — et tout le quartier change de
// place a la fois.
//
// C'est exactement ce qui est arrive, et le joueur l'a decrit comme un niveau
// qui se teleporte : le cote du lampadaire se lisait sur mod(row, 2). Tous les
// mats sautaient d'un bord a l'autre de la route tous les vingt metres, soit
// une fois par demi-seconde en croisiere, avec leurs halos et leurs flaques.
// Les maisons de second rang et les arbres faisaient de meme.
//
// La correction n'est pas un reglage, c'est une SIGNATURE : ces fonctions ne
// prennent plus que le z. Il devient structurellement impossible d'y faire
// entrer un index. Le banc check:town mesure l'invariant sur l'image rendue.
// ---------------------------------------------------------------------------

// Un mat par rangee, EN ALTERNANCE d'un cote et de l'autre : deux rangees de
// mats en vis-a-vis font une avenue, et une avenue n'est pas un lotissement.
// L'alternance se lit sur le rang de la grille MONDE, pas sur l'instance.
vec2 lampAt(float z){
  float side = mod(floor(z / TOWN_STEP), 2.0) < 0.5 ? 1.0 : -1.0;
  float h = hash21(vec2(z * 0.041, side * 9.13));
  // SUR LE TROTTOIR, a deux metres de la rive. Le premier jet plantait les
  // mats a trente-sept metres, avec les maisons : ils etaient trop loin pour
  // eclairer quoi que ce soit, et une flaque de lumiere a trente-sept metres du
  // bitume n'atteint jamais la route. Un lampadaire qui n'eclaire pas la route
  // est un poteau, quelle que soit la beaute de son halo. Quinze metres etait
  // encore trop : la flaque tombait derriere l'accotement, et la chaussee
  // restait noire entre deux mats.
  return vec2(side * (9.2 + h * 1.0), z);
}

// De quel cote de la route se trouve l'element d'une rangee. Tire du Z, donc
// stable quand la grille glisse.
float townSide(float z, float slot){
  return hash21(vec2(z * 0.013 + slot * 4.71, 21.3)) < 0.5 ? -1.0 : 1.0;
}

vec2 lampXZ(float row, vec2 org){ return lampAt(townZ(row, org)); }

// Le numero de rangee le plus proche d'un point du monde. Sert au sol, qui
// part du pixel et doit retrouver les mats, alors que le decor part du mat.
float townRowAt(float worldZ, vec2 org){
  return (floor(org.y / TOWN_STEP) * TOWN_STEP + TOWN_AHEAD - worldZ) / TOWN_STEP;
}

// LA ROUTE. Partagee par le sol, qui la peint, et par les touffes d'herbe, qui
// doivent s'ecarter devant elle.
//
// C'est la meme lecon que le masque de plage : la premiere version ne vivait
// que dans le shader du sol, et l'herbe a continue de pousser au milieu de
// l'asphalte. Une route sous un champ de brins n'est plus une route.

// La demi-largeur de la chaussee. Exposee parce que le sol doit peindre sa
// RIVE exactement dessus : une ligne de rive posee a peu pres au bon endroit
// serait pire que pas de ligne du tout.
float townEdge(vec2 wp){
  // Six metres et demi de demi-chaussee, pas huit et demi : a la distance ou
  // vit la camera, une route de vingt metres de large remplit tout le bas du
  // cadre et le paysage se reduit a un aplat sombre. Une rue de lotissement
  // fait treize metres, bas-cotes compris — et il faut que l'herbe et les
  // feuilles ENCADRENT l'asphalte pour qu'on le lise comme une route.
  return 6.6 + (fbm2(vec2(wp.y * 0.035, 3.1)) - 0.5) * 2.2;
}

// --- LES RUES TRANSVERSALES.
//
// Une seule route droite qui file vers l'horizon ne fait pas un quartier : elle
// fait un couloir. Il n'y a rien a MI-DISTANCE — le regard saute du bitume sous
// les pieds a la frise de maisons au fond, et les cent metres entre les deux
// restent une bande vide.
//
// Une rue perpendiculaire tous les cent douze metres remplit exactement ce
// trou. Elle donne au sol une trame lisible, elle passe SOUS le joueur (donc
// elle se lit comme de la vitesse, ce qu'une route parallele ne fait jamais),
// et elle justifie les maisons : elles bordent enfin quelque chose des deux
// cotes au lieu de s'aligner le long d'un ruban.
//
// Le pas ne s'ancre sur rien : c'est un modulo de la position monde. Il ne peut
// donc structurellement pas glisser (cf. l'invariant plus haut).
float townCrossBand(vec2 wp){
  float d = abs(mod(wp.y + TOWN_CROSS * 0.5, TOWN_CROSS) - TOWN_CROSS * 0.5);
  // Elle DESSERT le quartier, elle ne traverse pas la campagne : au-dela des
  // maisons elle s'arrete. Une rue qui part a l'infini de chaque cote
  // ressemble a une piste d'aeroport.
  float reach = 1.0 - smoothstep(88.0, 128.0, abs(wp.x));
  float w = 4.4 + (fbm2(vec2(wp.x * 0.028, 7.7)) - 0.5) * 1.3;
  return (1.0 - smoothstep(w, w + 1.2, d)) * reach;
}

float townMainBand(vec2 wp){
  float e = townEdge(wp);
  return 1.0 - smoothstep(e, e + 1.3, abs(wp.x));
}

// L'enrobe s'arrete NET, en un peu plus d'un metre. Le premier reglage
// l'etalait sur quatre metres et demi : la route se diluait dans l'herbe, on ne
// savait plus ou elle finissait, et une route sans bord n'est pas une route,
// c'est une tache sombre. Ce qui adoucit la transition, c'est l'accotement.
float townRoad(vec2 wp, float above, float town){
  if (town <= 0.004) return 0.0;
  return max(townMainBand(wp), townCrossBand(wp)) * town
       * smoothstep(-0.3, 0.5, above);
}

// L'ACCOTEMENT : gravier et terre battue, juste au-dela de l'enrobe. C'est lui
// qui fait le passage entre le noir de la chaussee et le champ, et il n'est pas
// decoratif — sans lui l'herbe pousse contre le bitume, ce qui n'arrive nulle
// part sur une route entretenue.
float townShoulder(vec2 wp, float above, float town){
  if (town <= 0.004) return 0.0;
  float d = abs(wp.x) - townEdge(wp);
  float along = smoothstep(-0.7, 0.4, d) * (1.0 - smoothstep(1.0, 3.2, d));
  // Le meme ourlet le long des rues transversales.
  float dz = abs(mod(wp.y + TOWN_CROSS * 0.5, TOWN_CROSS) - TOWN_CROSS * 0.5) - 4.4;
  float across = smoothstep(-0.7, 0.4, dz) * (1.0 - smoothstep(1.0, 3.0, dz))
               * (1.0 - smoothstep(88.0, 128.0, abs(wp.x)));
  return max(along, across) * town * smoothstep(-0.3, 0.5, above);
}

// --- OU SE TROUVE UNE MAISON, et si elle existe.
//
// Partagee par le DECOR, qui la dessine, et par le SOL, qui doit poser la
// lumiere de ses fenetres sur l'herbe devant elle. Deux formules « a peu pres
// pareilles » mettraient la flaque de lumiere a cote de la maison — c'est
// exactement la faute qu'on a deja payee avec les lampadaires.
//
// Renvoie (x, z, presence). La presence vaut zero quand la maison est decimee
// par la densite ou quand elle tomberait sur une rue.
// --- OU SE POSE UNE MAISON, et c'est la question qui decidait de tout.
//
// La premiere version tirait une distance a la route entre trente et cent
// quatre-vingts metres et un decalage en z d'une demi-rangee. Vu du sol ca
// passait pour du desordre ; vu de dessus c'etait un SEMIS — des boites noires
// eparpillees dans un champ, sans rapport les unes avec les autres ni avec le
// bitume. Un lotissement n'est pas une densite de maisons, c'est un
// ALIGNEMENT : ce qui fait la rue, c'est que les facades soient a la meme
// distance du trottoir.
//
// D'ou trois alignements et pas un semis :
//
//   rang 0 — LE PREMIER RANG, a vingt metres de l'axe, sur la rue principale.
//            C'est celui qu'on double, le seul dont on lise les fenetres.
//   rang 1 — LE FOND DE PARCELLE, quarante metres derriere. Il ne borde rien :
//            il sert a ce que le premier rang ait quelque chose derriere lui,
//            sinon la rue est une frise posee sur le vide.
//   rang 2 et 3 — LES DEUX BORDS DE LA RUE TRANSVERSALE. Leur z ne vient plus
//            de la rangee mais de la rue elle-meme : ils se rangent sur elle,
//            un rang de chaque cote. C'est ce qui fait qu'une rue laterale se
//            lit comme une rue et pas comme une trainee claire dans un pre.
vec3 houseAt(float z, float side, float rank, float density){
  float h1 = hash21(vec2(z * 0.037, side * 3.11 + rank * 11.7));
  float h2 = hash21(vec2(z * 0.019 + 5.3, side * 7.71 + rank * 2.31));
  float h3 = hash21(vec2(z * 0.053 + 1.7, side * 4.33 + rank * 6.11));
  vec2 wp;
  if (rank < 1.5) {
    // Le recul est FAIBLEMENT tire : deux metres d'ecart entre voisines
    // donnent une rue vivante, dix donnent un semis. C'est le meme reglage
    // que le desordre d'une haie — il doit se voir sans se lire.
    float bx = rank < 0.5 ? 22.5 + h1 * 3.6 : 41.0 + h1 * 9.0;
    wp = vec2(side * bx, z + (h2 - 0.5) * TOWN_STEP * 0.40);
  } else {
    // Le centre de la rue transversale la plus proche. Un modulo de la
    // position monde : il ne peut pas glisser quand la grille avance.
    float cz = floor(z / TOWN_CROSS + 0.5) * TOWN_CROSS;
    float far = rank < 2.5 ? 1.0 : -1.0;
    wp = vec2(side * (28.0 + h1 * 96.0), cz + far * (14.0 + h2 * 3.5));
  }
  float keep = rank < 0.5 ? density * 0.72 : density * 1.05;
  float ok = step(h3, keep) * step(townCrossBand(wp), 0.12);
  return vec3(wp, ok);
}
#endif
`;

/**
 * Un batiment : murs, toit a deux pentes, mat et sa lanterne.
 *
 * Les quatre parties vivent dans la MEME geometrie et chaque instance replie
 * celles dont elle n'a pas besoin. Deux maillages auraient double le nombre
 * d'appels de dessin pour economiser quelques dizaines de sommets degeneres.
 *
 * Attention aux conventions, qui different d'une partie a l'autre et c'est
 * volontaire : les murs et le toit sont en unites (le shader les met a
 * l'echelle de chaque maison), le mat est deja EN METRES (tous les lampadaires
 * d'une rue ont la meme taille — c'est ce qui fait une rue).
 */
function buildingGeometry(): BufferGeometry {
  const pos: number[] = [];
  const nrm: number[] = [];
  const part: number[] = [];
  const idx: number[] = [];

  const tri = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    p: number,
  ): void => {
    const ux = b[0] - a[0];
    const uy = b[1] - a[1];
    const uz = b[2] - a[2];
    const vx = c[0] - a[0];
    const vy = c[1] - a[1];
    const vz = c[2] - a[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    const base = pos.length / 3;
    for (const v of [a, b, c]) {
      pos.push(v[0], v[1], v[2]);
      nrm.push(nx, ny, nz);
      part.push(p);
    }
    idx.push(base, base + 1, base + 2);
  };

  const quad = (
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number],
    p: number,
  ): void => {
    tri(a, b, c, p);
    tri(a, c, d, p);
  };

  // --- 0 : LES MURS. Une boite en unites, base a y = 0.
  //     Pas de toit ni de plancher : le toit couvre le dessus et on ne voit
  //     jamais le dessous.
  const W = 0.5;
  quad([W, 0, W], [W, 0, -W], [W, 1, -W], [W, 1, W], 0);
  quad([-W, 0, -W], [-W, 0, W], [-W, 1, W], [-W, 1, -W], 0);
  quad([-W, 0, W], [W, 0, W], [W, 1, W], [-W, 1, W], 0);
  quad([W, 0, -W], [-W, 0, -W], [-W, 1, -W], [W, 1, -W], 0);

  // --- 1 : LE TOIT. Faitiere le long de Z, donc les deux pentes regardent la
  //     route. Un pignon de face, c'est ca qui dit « maison » et pas « cube ».
  //     Debord de 8 cm en unites : sans avancee de toit, la maison ressemble a
  //     une maquette de carton.
  const RO = 0.58;
  const RZ = 0.56;
  quad([0, 1, -RZ], [0, 1, RZ], [RO, 0, RZ], [RO, 0, -RZ], 1);
  quad([0, 1, RZ], [0, 1, -RZ], [-RO, 0, -RZ], [-RO, 0, RZ], 1);
  tri([-RO, 0, RZ], [RO, 0, RZ], [0, 1, RZ], 1);
  tri([RO, 0, -RZ], [-RO, 0, -RZ], [0, 1, -RZ], 1);

  // --- 1.2 : LA CHEMINEE.
  //
  //     Un indice non entier, et ce n'est pas un bricolage : toutes les
  //     comparaisons de partie sont des seuils (aPart < 1.5 = maison,
  //     aPart < 0.5 = murs). Une cheminee a 1.2 est donc AUTOMATIQUEMENT mise a
  //     l'echelle du toit et coloree comme lui, sans toucher a une seule des
  //     conditions existantes. Elle garde quand meme son identite propre, ce
  //     qui permet de la replier maison par maison — une cheminee sur toutes
  //     les maisons ferait un lotissement de catalogue.
  //
  //     Elle vaut son cout a elle seule : c'est la seule chose qui casse la
  //     symetrie d'un pignon, et une silhouette de maison sans rien qui
  //     depasse lit comme une icone.
  const cx = 0.19;
  const cw = 0.075;
  const cz = 0.11;
  const CT = 1.55;
  quad([cx + cw, 0.30, cz], [cx + cw, 0.30, -cz], [cx + cw, CT, -cz], [cx + cw, CT, cz], 1.2);
  quad([cx - cw, 0.30, -cz], [cx - cw, 0.30, cz], [cx - cw, CT, cz], [cx - cw, CT, -cz], 1.2);
  quad([cx - cw, 0.30, cz], [cx + cw, 0.30, cz], [cx + cw, CT, cz], [cx - cw, CT, cz], 1.2);
  quad([cx + cw, 0.30, -cz], [cx - cw, 0.30, -cz], [cx - cw, CT, -cz], [cx + cw, CT, -cz], 1.2);
  quad([cx - cw, CT, -cz], [cx - cw, CT, cz], [cx + cw, CT, cz], [cx + cw, CT, -cz], 1.2);

  // --- 2 : LE MAT, en metres. Un poteau, une potence, une lanterne.
  const PH = 5.6;
  const r = 0.075;
  quad([r, 0, r], [r, 0, -r], [r, PH, -r], [r, PH, r], 2);
  quad([-r, 0, -r], [-r, 0, r], [-r, PH, r], [-r, PH, -r], 2);
  quad([-r, 0, r], [r, 0, r], [r, PH, r], [-r, PH, r], 2);
  quad([r, 0, -r], [-r, 0, -r], [-r, PH, -r], [r, PH, -r], 2);
  // La potence : elle penche vers la route, comme tous les lampadaires du
  // monde. Un mat parfaitement droit lit comme un poteau telephonique.
  const AL = 1.15;
  quad([0, PH, 0.05], [0, PH, -0.05], [-AL, PH - 0.28, -0.05], [-AL, PH - 0.28, 0.05], 2);
  // La lanterne, un petit tronc de pyramide sous la potence.
  const lx = -AL;
  const ly = PH - 0.34;
  quad([lx - 0.26, ly, 0.16], [lx + 0.26, ly, 0.16], [lx + 0.16, ly - 0.30, 0.10], [lx - 0.16, ly - 0.30, 0.10], 2);
  quad([lx + 0.26, ly, -0.16], [lx - 0.26, ly, -0.16], [lx - 0.16, ly - 0.30, -0.10], [lx + 0.16, ly - 0.30, -0.10], 2);
  quad([lx + 0.26, ly, 0.16], [lx + 0.26, ly, -0.16], [lx + 0.16, ly - 0.30, -0.10], [lx + 0.16, ly - 0.30, 0.10], 2);
  quad([lx - 0.26, ly, -0.16], [lx - 0.26, ly, 0.16], [lx - 0.16, ly - 0.30, 0.10], [lx - 0.16, ly - 0.30, -0.10], 2);
  // Le dessous de la lanterne : c'est LUI qui brille.
  quad([lx - 0.16, ly - 0.30, -0.10], [lx - 0.16, ly - 0.30, 0.10], [lx + 0.16, ly - 0.30, 0.10], [lx + 0.16, ly - 0.30, -0.10], 3);

  // --- 4 : L'ARBRE. Un cone, en unites.
  //
  //     C'est lui qui empeche le quartier de lire comme un centre commercial.
  //     Vingt maisons alignees a cent cinquante metres fusionnent en une bande
  //     de fenetres allumees, quelle que soit la variete de leurs toits ; il
  //     faut quelque chose de VERTICAL et de NOIR entre elles pour que l'oeil
  //     les separe. Une silhouette d'arbre coute six triangles et fait ce
  //     travail a elle seule.
  const SEG = 6;
  for (let i = 0; i < SEG; i++) {
    const a0 = (i / SEG) * Math.PI * 2;
    const a1 = ((i + 1) / SEG) * Math.PI * 2;
    tri(
      [Math.cos(a0), 0, Math.sin(a0)],
      [Math.cos(a1), 0, Math.sin(a1)],
      [0, 1, 0],
      4,
    );
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nrm), 3));
  g.setAttribute('aPart', new BufferAttribute(new Float32Array(part), 1));
  g.setIndex(idx);
  return g;
}

/**
 * LE SHADER DE SOMMET DU QUARTIER, sorti de la classe.
 *
 * Il vit ici pour que le banc d invariant (scripts/town-check.ts) puisse le
 * lire. Verifier une regle sur du code enferme dans un constructeur voudrait
 * dire le relire au disque et le decouper au hasard ; expose, il se verifie
 * pour ce qu il est — une chaine.
 */
export const TOWN_VERTEX = /* glsl */ `
${GLSL_SAFE}
        attribute float aPart;
        attribute vec4 iSpec;
        uniform vec3 uOrigin;
        uniform float uDensity;
        varying float vPart, vSeed;
        varying vec3 vLocal, vNrm, vWorld, vDim;

${TOWN_GLSL}
        ${terrainGLSL()}

        void main(){
          if (uDensity < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

          float row = iSpec.x;
          float slot = iSpec.y;
          // Le Z de la rangee : la seule chose que l'index decide.
          float z = townZ(row, uOrigin.xz);
          // Le ROLE est constant pour une instance donnee ; le COTE se lit
          // dans le z (cf. l'invariant en tete de TOWN_GLSL).
          // slots 0,1 : premier rang, un de chaque cote de la rue principale.
          // slot  2    : fond de parcelle.
          // slots 3,6  : les deux bords de la rue transversale.
          // slot  4    : le lampadaire.   slot 5 : l'arbre.
          float rank = slot < 1.5 ? 0.0
                     : slot < 2.5 ? 1.0
                     : slot < 3.5 ? 2.0
                     : 3.0;
          float side = slot < 0.5 ? -1.0 : slot < 1.5 ? 1.0 : townSide(z, slot);
          float lamp = slot > 5.5 ? 0.0 : slot > 4.5 ? 2.0 : slot > 3.5 ? 1.0 : 0.0;

          // Chaque instance replie les parties qui ne la concernent pas. Le
          // triangle degenere ne produit aucun fragment : c'est le moyen le
          // moins cher de faire cohabiter deux objets dans un seul appel.
          bool wantLamp = lamp > 0.5 && lamp < 1.5;
          bool wantTree = lamp > 1.5;
          bool isLampPart = aPart > 1.5 && aPart < 3.5;
          bool isTreePart = aPart > 3.5;
          bool isHousePart = aPart < 1.5;
          // Une maison sur deux a une cheminee. Le tirage se lit dans le z,
          // comme tout le reste (cf. l'invariant en tete de TOWN_GLSL).
          bool chimney = aPart > 1.1 && aPart < 1.3;
          bool keepPart = wantLamp ? isLampPart : wantTree ? isTreePart : isHousePart;
          if (!keepPart) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          if (chimney && hash21(vec2(z * 0.071, side * 12.7 + rank)) < 0.45) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return;
          }

          vec2 wp;
          vec3 p = position;
          float seed;

          if (wantTree) {
            float t1 = hash21(vec2(z * 0.029 + 9.1, side * 5.7));
            float t2 = hash21(vec2(z * 0.061 + 2.3, side * 8.9));
            float t3 = hash21(vec2(z * 0.017 + 6.6, side * 1.9));
            float t4 = hash21(vec2(z * 0.043 + 3.9, side * 2.71));
            seed = t3;
            // UN ARBRE SUR DEUX EST UN ARBRE D'ALIGNEMENT, entre le trottoir
            // et les facades. C'est lui qui donne son epaisseur au bord de la
            // rue : sans rien entre l'asphalte et les maisons, la chaussee a
            // l'air posee sur un pre. L'autre moitie pousse dans les jardins
            // et brise la frise du fond.
            float align = step(t4, 0.55);
            wp = align > 0.5
               ? vec2(side * (12.6 + t1 * 1.8), z + (t2 - 0.5) * TOWN_STEP * 0.45)
               : vec2(side * (26.0 + t1 * 84.0), z + (t2 - 0.5) * TOWN_STEP * 1.6);
            // Ni au-dela du quota, ni au milieu d'une rue.
            if (t3 > uDensity * 1.05 || townCrossBand(wp) > 0.12) {
              gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return;
            }
            // L'arbre d'alignement est plus ETROIT et plus haut : il est
            //     taille, il vit entre un trottoir et une facade. Garder la
            //     silhouette large de l'arbre de plein champ le faisait
            //     avaler le lampadaire d'a cote.
            float rr = align > 0.5 ? 1.0 + t2 * 0.7 : 1.3 + t2 * 1.5;
            float th = align > 0.5 ? 7.0 + t3 * 4.0 : 5.5 + t3 * 6.5;
            vDim = vec3(rr, th, rr);
            p = vec3(position.x * rr, position.y * th, position.z * rr);
          } else if (wantLamp) {
            wp = lampAt(z);
            // La potence regarde la route : on retourne le mat selon le cote.
            p.x *= (wp.x > 0.0 ? 1.0 : -1.0);
            seed = fract(z * 0.017 + 0.21);
            vDim = vec3(1.0, TOWN_LAMP_H, 1.0);
          } else {
            // LE PLACEMENT VIENT DE houseAt, partage avec le sol : c'est lui
            // qui doit poser la lumiere des fenetres sur l'herbe devant chaque
            // maison. Deux formules qui se ressemblent mettraient la flaque a
            // cote de la maison — la faute deja payee avec les lampadaires.
            vec3 hp = houseAt(z, side, rank, uDensity);
            if (hp.z < 0.5) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
            wp = hp.xy;
            float h1 = hash21(vec2(z * 0.037, side * 3.11 + rank * 11.7));
            float h2 = hash21(vec2(z * 0.019 + 5.3, side * 7.71 + rank * 2.31));
            float h3 = hash21(vec2(z * 0.053 + 1.7, side * 4.33 + rank * 6.11));
            seed = h3;

            // Volontairement GENEREUSES. Une maison de sept metres de large,
            // vue a cent cinquante metres dans un champ de trente-sept degres,
            // fait quinze pixels : c'est juste, et c'est illisible. On triche
            // sur la taille pour rendre la silhouette, exactement comme les
            // tours de la ville de cristal qui font cent metres de haut.
            float w = 8.5 + h1 * 5.5;
            float d = 8.5 + h2 * 5.0;
            float bh = 4.4 + h3 * 3.0;
            float rh = 2.1 + h1 * 2.0;
            vDim = vec3(w, bh, d);

            if (aPart < 0.5) {
              p = vec3(position.x * w, position.y * bh, position.z * d);
            } else {
              p = vec3(position.x * w, bh + position.y * rh, position.z * d);
            }
            // UNE MAISON SUR DEUX PRESENTE SON PIGNON, l'autre son long pan.
            //
            // C'est le trait qui separe une rue d'un lotissement de catalogue.
            // Toutes orientees pareil, elles font une frise identique et l'oeil
            // lit un centre commercial ; alternees, chaque toit dessine une
            // silhouette differente sur le ciel.
            float a = (h2 - 0.5) * 0.24 + (h3 > 0.52 ? 1.5708 : 0.0);
            float cs = cos(a), sn = sin(a);
            p = vec3(p.x * cs - p.z * sn, p.y, p.x * sn + p.z * cs);
          }

          float gh = terrainHeightAt(wp, 0.0);
          // Rien ne se construit dans un champ inonde. C'est ce qui fait que le
          // village se serre spontanement sur les bandes seches d'octobre.
          if (gh < WATER_LEVEL + 0.7) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

          vec3 world = vec3(wp.x, gh - 0.35, wp.y) + p;
          vPart = aPart;
          vSeed = seed;
          vLocal = p;
          vNrm = normal;
          vWorld = world;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
`;

export class Town {
  readonly buildings: InstancedMesh;
  readonly halos: Mesh;
  /** Les deux materiaux, pour que le monde y pousse ses couleurs. */
  readonly mats: ShaderMaterial[] = [];
  private mat: ShaderMaterial;
  private haloMat: ShaderMaterial;

  constructor() {
    const count = ROWS * SLOTS;
    const spec = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / SLOTS);
      const slot = i % SLOTS;
      // slot 0/1 : les deux maisons de front, une de chaque cote.
      // slot 2   : une maison de fond de parcelle, alternee.
      // slot 3/6 : les deux bords de la rue transversale.
      // slot 4   : le lampadaire.   slot 5 : l'arbre.
      // L'instance ne porte que sa RANGEE et son ROLE. Tout le reste — le
      // cote de la route, la taille, l'orientation, jusqu'a l'existence de
      // l'element — se lit dans le shader depuis le Z de la rangee. Une
      // instance qui porterait son cote le garderait en heritant du z de sa
      // voisine, et le quartier changerait de place a chaque pas de grille.
      spec[i * 4] = row;
      spec[i * 4 + 1] = slot;
      spec[i * 4 + 2] = 0;
      spec[i * 4 + 3] = 0;
    }

    this.mat = new ShaderMaterial({
      transparent: true,
      depthWrite: true,
      uniforms: {
        ...riderUniforms(),
        ...terrainUniforms(),
        ...dayUniforms(),
        uOrigin: { value: new Vector3() },
        uCam: { value: new Vector3() },
        /** Presence du quartier, 0..1. Zero partout sauf en octobre. */
        uDensity: { value: 0 },
        /** Averse : elle voile les maisons comme elle voile le sol. */
        uWet: { value: 0 },
        /** Couverture nuageuse, 0..1 : elle remplace la source par la coupole. */
        uOvercast: { value: 0 },
        uWall: { value: vec3('townWall') },
        uTree: { value: vec3('treeLine') },
        uRoof: { value: vec3('townRoof') },
        uWindow: { value: vec3('townWindow') },
        uHaze: { value: vec3('skyHorizon') },
      },
      vertexShader: TOWN_VERTEX,
      fragmentShader: /* glsl */ `
${GLSL_SAFE}
        uniform vec3 uWall, uRoof, uWindow, uHaze, uCam, uTree;
        uniform float uWet, uOvercast;
${GLSL_DAY}
${RIDER_GLSL}
        varying float vPart, vSeed;
        varying vec3 vLocal, vNrm, vWorld, vDim;
        ${GLSL_NOISE}

        // --- CE QU'UNE FACE RECOIT, et c'est deux modeles et non un.
        //
        //     Par beau temps la lumiere vient d'un POINT : ce qui separe deux
        //     faces est leur angle au soleil, et un mur oriente a l'est est
        //     sombre a midi. Sous une averse il n'y a plus de point : la
        //     lumiere vient de la COUPOLE entiere, et ce qui separe deux faces
        //     est la PART DE CIEL qu'elles voient — un toit la voit toute, un
        //     mur vertical la moitie, une face vers le bas presque rien.
        //
        //     Garder le modele ensoleille sous l'averse donne exactement ce
        //     qu'on avait : des boites noires dont une face est un peu moins
        //     noire. Les deux modeles cohabitent, la couverture arbitre.
        float faceLight(vec3 n){
          vec3 N = normalize(n);
          float sunny = 0.80 + 0.30 * abs(N.x);
          float dome  = 0.56 + 0.52 * clamp(N.y, 0.0, 1.0)
                      + 0.10 * abs(N.x);
          return mix(sunny, dome, uOvercast);
        }

        void main(){
          float dist = length(vWorld.xz - uCam.xz);
          vec3 c;
          float glow = 0.0;

          if (vPart < 0.5) {
            // --- LES MURS, et LES FENETRES.
            //
            //     La grille est en METRES et non en fraction du mur : une
            //     fenetre doit avoir la meme taille sur une grande maison que
            //     sur une petite, sinon ce ne sont plus des ouvertures mais un
            //     motif imprime sur la facade.
            c = uWall * (0.70 + hash21(vec2(vSeed * 37.0, 1.3)) * 0.40);
            c *= faceLight(vNrm);

            vec2 fuv = abs(vNrm.x) > 0.5 ? vec2(vLocal.z, vLocal.y) : vec2(vLocal.x, vLocal.y);
            float face = abs(vNrm.x) > 0.5 ? 0.0 : 1.0;
            // Grille LARGE : une maison a deux ou trois fenetres par facade,
            // pas huit. Serree, elle donnait un mur-rideau, et huit maisons
            // cote a cote faisaient un aeroport.
            vec2 g = vec2(fuv.x / 2.85, (fuv.y - 1.0) / 2.05);
            vec2 cell = floor(g);
            vec2 f = fract(g);
            float rnd = hash21(cell * 1.71 + vec2(vSeed * 53.0, face * 17.0));
            // Un peu plus d'une fenetre sur deux est allumee. Toutes allumees,
            // c'est un immeuble de bureaux ; une sur dix, c'est un village
            // abandonne.
            float lit = step(0.50, rnd);
            bool band = fuv.y > 1.0 && fuv.y < vDim.y - 0.75;
            vec2 d2 = abs(f - 0.5);

            if (band && d2.x < 0.21 && d2.y < 0.27) {
              c = lit > 0.5
                ? uWindow * (1.9 + rnd * 1.7)
                : uWall * 0.26;
              glow = lit;
            } else if (band) {
              // LE DEBORDEMENT, et il doit rester PRES de sa fenetre.
              //
              // C'est lui qui fait la lumiere — une fenetre allumee qui s'arrete
              // net au bord de son cadre lit comme un autocollant — mais dose
              // trop large il couvre la cellule entiere. Toutes les cellules
              // d'une rangee s'allument alors ensemble, et la facade devient un
              // RECTANGLE lumineux a bords francs : la bande de fenetres a
              // exactement la forme d'une enseigne.
              //
              // ET IL FAUT LE SERRER BEAUCOUP PLUS QU'IL N'Y PARAIT. max(d2)
              // vit entre 0,25 et 0,50 : une rampe qui commence a 0,40 est
              // donc allumee sur plus de la moitie de la cellule, et deux
              // cellules voisines allumees se rejoignent. Sur une maison
              // qu'on double a vingt metres, ca ne faisait pas des fenetres,
              // ca faisait une FACADE ENTIERE en peche pale posee sur le
              // ciel — la premiere chose qu'on voyait dans le cadre.
              float b = smoothstep(0.33, 0.235, max(d2.x, d2.y));
              c += uWindow * b * lit * 0.15;
              glow = b * lit * 0.15;
            }
          } else if (vPart < 1.5) {
            // --- LE TOIT. Plus sombre que les murs, et MOUILLE : c'est la
            //     seule surface du quartier qui regarde le ciel, donc la seule
            //     qui puisse le renvoyer.
            c = uRoof * (0.78 + hash21(vec2(vSeed * 19.0, 4.1)) * 0.38);
            c *= faceLight(vNrm);
            //     ET IL RENVOIE LE CIEL. Sous un ciel couvert le toit est la
            //     face la plus CLAIRE d'une maison, pas la plus sombre : c'est
            //     la seule qui voie la coupole entiere. Sans ce terme les
            //     maisons lisaient comme des boites noires — vu de dessus, un
            //     semis de cubes d'encre dans un champ roux.
            c += uDayFill * uOvercast * clamp(normalize(vNrm).y, 0.0, 1.0)
               * (0.16 + uWet * 0.22);
            vec3 V = nsafe(uCam - vWorld, vec3(0.0, 1.0, 0.0));
            float graze = pow(max(1.0 - clamp(dot(normalize(vNrm), V), 0.0, 1.0), 1e-4), 2.6);
            c += uDayFill * graze * (0.18 + uWet * 0.65);
          } else if (vPart < 2.5) {
            // --- LE MAT. Presque une silhouette : un lampadaire qu'on detaille
            //     vole la vedette a la lumiere qu'il porte.
            c = uRoof * 0.35;
          } else if (vPart > 3.5) {
            // --- L'ARBRE. Une silhouette, et rien d'autre. Le degrade vertical
            //     suffit a lui donner du volume a la distance ou on le voit.
            c = uTree * (0.42 + clamp(vLocal.y / max(vDim.y, 0.001), 0.0, 1.0) * 0.62);
            c *= 0.80 + hash21(vec2(vSeed * 23.0, 8.7)) * 0.40;
          } else {
            // --- LE DESSOUS DE LA LANTERNE. Il ne recoit pas l'heure : c'est
            //     une SOURCE. Une lampe qui s'assombrit la nuit est un
            //     contresens, et c'est exactement la faute qu'on a deja
            //     corrigee sur la lampe du personnage.
            gl_FragColor = vec4(uWindow * 2.3, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            return;
          }

          //     LA PART DE CIEL DANS L'ECLAIRAGE MONTE AVEC LA COUVERTURE.
          //     daylight() melange la couleur de la SOURCE et celle du CIEL ;
          //     sous l'averse il n'y a plus de source, et lui laisser la main
          //     donnait a tout le quartier la teinte cuivree du couchant —
          //     exactement le defaut deja corrige sur le sol.
          c = daylight(c, clamp(0.34 + uDayNight * 0.30 + uOvercast * 0.28, 0.0, 1.0));
          //     Et un peu de lumiere du ciel qui ne passe par aucune face :
          //     l'ambiante d'un jour gris ne vient de nulle part en
          //     particulier. Sans elle, les faces detournees du ciel tombent
          //     au noir pur et la maison redevient une decoupe.
          c += uDayFill * uOvercast * 0.055;
          // La fenetre allumee repasse PAR-DESSUS l'heure : c'est une source.
          c += uWindow * glow * (0.55 + uDayNight * 1.25);
          c += riderLight(vWorld) * 0.6;

          // Brume et voile d'averse, exactement comme le sol — mais SUR UNE
          // ECHELLE PLUS LONGUE. Cale sur celle du sol, la brume delavait les
          // maisons du premier rang, qui sont a trente metres : elles
          // devenaient des fantomes pales alors que ce sont des silhouettes.
          // Ce qui doit se dissoudre dans l'horizon, c'est le fond, pas ce
          // qu'on double.
          float f2 = 1.0 - exp(-dist / 330.0);
          c = mix(c, uHaze, smoothstep(0.20, 0.95, f2) * 0.42);
          c = mix(c, uDayFill * 1.04, smoothstep(0.10, 0.85, f2) * uWet * 0.30);

          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    const geo = buildingGeometry();
    this.buildings = new InstancedMesh(geo, this.mat, count);
    this.buildings.frustumCulled = false;
    this.buildings.renderOrder = -820;
    geo.setAttribute('iSpec', new InstancedBufferAttribute(spec, 4));
    // L'InstancedMesh exige une matrice d'instance, meme si le placement se
    // fait entierement dans le shader : sans elle, l'attribut reste a zero et
    // toutes les instances se superposent a l'origine.
    const m = new Matrix4();
    for (let i = 0; i < count; i++) this.buildings.setMatrixAt(i, m);
    this.buildings.instanceMatrix.needsUpdate = true;

    // --- LES HALOS.
    //
    //     Un maillage a part, en ADDITIF : une lueur qui se melange normalement
    //     avec le ciel derriere elle l'assombrit au lieu de l'eclairer. Et il
    //     n'ecrit pas la profondeur — la pluie doit passer devant.
    this.haloMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uOrigin: { value: new Vector3() },
        uDensity: { value: 0 },
        uWet: { value: 0 },
        uWindow: { value: vec3('townWindow') },
        ...terrainUniforms(),
      },
      vertexShader: /* glsl */ `
${GLSL_SAFE}
        attribute float iRow;
        uniform vec3 uOrigin;
        uniform float uDensity, uWet;
        varying vec2 vUv;
        varying float vFade, vNear;

${TOWN_GLSL}
        ${terrainGLSL()}

        void main(){
          if (uDensity < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
          vec2 wp = lampXZ(iRow, uOrigin.xz);
          float gh = terrainHeightAt(wp, 0.0);
          if (gh < WATER_LEVEL + 0.7) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

          // La lanterne est au bout de la potence, qui penche vers la route.
          vec3 p = vec3(wp.x - sign(wp.x) * 1.15, gh - 0.35 + TOWN_LAMP_H - 0.5, wp.y);

          vec3 toCam = cameraPosition - p;
          float dist = length(toCam);
          vec3 fwd = toCam / max(dist, 0.001);
          vec3 right = nsafe(cross(vec3(0.0, 1.0, 0.0), fwd), vec3(1.0, 0.0, 0.0));
          vec3 up = cross(fwd, right);

          // Le quad n'est plus centre sur la lanterne : il PEND sous elle.
          //
          // C'est ce qui permet d'y loger le FAISCEAU en plus du halo. Un
          // lampadaire sous l'averse ne fait pas une pastille lumineuse, il
          // plante un cone de lumiere dans la pluie — et ce cone est la moitie
          // de ce qu'on vient chercher dans une rue mouillee le soir.
          //
          // Sa base passe SOUS le sol : le test de profondeur la coupe donc
          // pile a la chaussee, gratuitement, et le faisceau semble s'y poser.
          float W = 5.0 + uWet * 2.4;
          float H = 7.4;
          // LA LANTERNE AUX QUATRE CINQUIEMES, PAS AU RAS DU BORD.
          //
          // A 0,42 elle tombait a v = 0,92 : le bulbe, qui deborde de trois
          // dixiemes au-dessus d'elle, etait COUPE NET par le haut du quad, et
          // la coupe se lisait comme un trait horizontal en travers du halo.
          // Un demi-metre de marge suffit, et il ne coute rien.
          vec3 world = p + right * position.x * W + up * (position.y - 0.30) * H;

          vFade = uDensity * smoothstep(230.0, 90.0, dist) * smoothstep(2.0, 6.0, dist);
          // LE FAISCEAU MEURT BIEN AVANT LE BULBE.
          //
          // Ce qu'on voit d'un cone de lumiere, c'est la pluie qu'il traverse,
          // et il faut la voir : a cent metres les gouttes passent sous le
          // pixel et il ne reste qu'un TRIANGLE PALE plante dans le champ,
          // sans lampe visible au-dessus. Sur une capture au loin, la rue
          // ressemblait a un alignement de projecteurs de chantier.
          vNear = smoothstep(150.0, 60.0, dist);
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uWindow;
        uniform float uWet;
        varying vec2 vUv;
        varying float vFade, vNear;
        void main(){
          if (vFade < 0.004) discard;
          float u = (vUv.x - 0.5) * 2.0;
          float v = vUv.y;

          // --- LE BULBE. Coeur dur, halo long : un seul lobe donne une
          //     pastille, c'est l'ECART entre les deux exposants qui fait une
          //     lampe. Il est centre sur la lanterne, aux neuf dixiemes du quad.
          // v = 0,80 : la lanterne (cf. le decalage du quad dans le sommet).
          float lz = 0.80;
          float r = length(vec2(u * 1.25, (v - lz) * 3.4));
          // Le SECOND lobe est celui qui trahissait le quad. A 0,52 il portait
          // jusqu'a r = 1,9, c'est-a-dire jusqu'aux COINS du plan : quelques
          // centiemes de lumiere chaude sur toute sa surface, et l'oeil lisait
          // un rectangle. Il doit mourir a mi-chemin du bord, pas au-dela.
          float bulb = pow(max(1.0 - clamp(r, 0.0, 1.0), 1e-4), 5.0) * 0.48
                     + pow(max(1.0 - clamp(r * 1.15, 0.0, 1.0), 1e-4), 1.7)
                       * (0.10 + uWet * 0.14);

          // --- LE FAISCEAU, et il n'existe QUE parce qu'il pleut.
          //
          //     Ce qu'on voit d'un cone de lumiere, ce n'est jamais la lumiere :
          //     c'est ce qu'elle TRAVERSE. Par temps sec il n'y a rien dans
          //     l'air et le faisceau est invisible ; sous l'averse il se dessine
          //     en entier. Il est donc multiplie par la pluie, sans exception.
          // La hauteur, RAMENEE A LA LANTERNE : le cone naquit sous elle et
          // s'evase vers le sol, quel que soit l'endroit du quad ou elle est.
          float vc = clamp(v / lz, 0.0, 1.0);
          float halfW = mix(0.92, 0.07, vc);
          float cone = 1.0 - smoothstep(halfW * 0.42, halfW, abs(u));
          cone *= smoothstep(0.0, 0.26, vc);         // il meurt en bas
          cone *= 1.0 - smoothstep(0.86, 0.99, vc);  // et s'arrete sous la lanterne
          cone *= mix(0.28, 1.0, vc);                // plus dense pres de la source

          cone *= 1.0 - smoothstep(0.78, 1.0, abs(u));
          // Le faisceau est un VOILE, pas une lampe : dose a 0,34 il remplit
          // un quart du cadre quand on passe dessous, la floraison le reprend
          // et il ne reste qu'un coin de l'image en blanc.
          float a = (bulb + cone * uWet * vNear * 0.18) * vFade;

          // --- LE QUAD NE DOIT JAMAIS SE VOIR, ET UN SEUIL NE SUFFIT PAS.
          //
          //     En additif, quelques millemes de lumiere chaude etales sur sept
          //     metres carres ne se lisent pas comme une lueur faible : ils se
          //     lisent comme un RECTANGLE PALE. L'oeil detecte un BORD DROIT
          //     bien avant de detecter une luminance, et il n'y a rien de droit
          //     dans une rue. C'etait, sur les captures, le plus gros defaut du
          //     monde entier : une plaque beige de deux cents pixels posee sur
          //     le champ a cote de chaque lampadaire.
          //
          //     Deux precautions, et il faut les deux. Une extinction FRANCHE
          //     sur les quatre bords du quad — assez large pour que le bord
          //     tombe la ou il ne reste rien a eteindre — et un rejet assez
          //     haut pour que ce qui survit soit invisible, et non « presque
          //     invisible ». Les marges sont calees sur le bulbe : a |u| = 0,62
          //     son coeur vaut six dix-millemes, l'extinction ne lui coute rien.
          a *= (1.0 - smoothstep(0.62, 1.0, abs(u)))
             * (1.0 - smoothstep(0.96, 1.0, v))
             * smoothstep(0.0, 0.045, v);
          //     Et le seuil se RETRANCHE, il ne se teste pas. Teste, il laisse
          //     un bord : le pixel juste au-dessus vaut encore deux centiemes,
          //     celui d'a cote vaut zero, et l'ellipse du lobe large se
          //     redessine — on a remplace un rectangle par un oeuf. Retranche,
          //     la lueur atteint zero d'elle-meme et il n'y a plus de bord.
          a = max(a - 0.022, 0.0) * 1.06;
          if (a <= 0.0) discard;
          // Additif : l'alpha de sortie vaut 1 et toute la modulation vit dans
          // le RVB, sinon elle est comptee deux fois et la lueur sort terne.
          // ET PAS PLUS DE DEUX FOIS LA COULEUR DE LA LAMPE.
          //
          // Pousse a 2,6 le coeur sortait du tonemap, la floraison le
          // reprenait par-dessus, et il ne restait qu'une TACHE BLANCHE de
          // deux cents pixels : la lampe avait perdu sa couleur, donc tout ce
          // qu'elle apportait a une rue d'octobre. Ce qui doit briller dans
          // une rue mouillee, ce n'est pas l'ampoule — c'est la flaque qu'elle
          // pose sur l'asphalte, et celle-la vit dans le sol.
          gl_FragColor = vec4(uWindow * a * 1.55, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    const base = new PlaneGeometry(1, 1);
    const hgeo = new InstancedBufferGeometry();
    hgeo.index = base.index;
    hgeo.attributes.position = base.attributes.position as BufferAttribute;
    hgeo.attributes.uv = base.attributes.uv as BufferAttribute;
    hgeo.instanceCount = ROWS;
    const rows = new Float32Array(ROWS);
    for (let i = 0; i < ROWS; i++) rows[i] = i;
    hgeo.setAttribute('iRow', new InstancedBufferAttribute(rows, 1));
    this.halos = new Mesh(hgeo, this.haloMat);
    this.halos.frustumCulled = false;
    this.halos.renderOrder = 7;

    this.mats.push(this.mat, this.haloMat);
  }

  update(origin: Vector3, camPos: Vector3): void {
    this.mat.uniforms.uOrigin.value.copy(origin);
    this.mat.uniforms.uCam.value.copy(camPos);
    this.haloMat.uniforms.uOrigin.value.copy(origin);
  }
}
