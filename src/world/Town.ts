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

/** Espacement des rangees, en metres. */
const STEP = 20;
/** Nombre de rangees suivies autour du joueur. */
const ROWS = 24;
/** Decalage de la premiere rangee : une rangee et demie derriere le joueur. */
const AHEAD = 36;
/**
 * Cinq emplacements par rangee : deux maisons au bord de la route, une au
 * second rang, une au fond, et un lampadaire.
 *
 * TROIS RANGS ET PAS UN, et c'est une contrainte de CADRAGE avant d'etre un
 * choix esthetique. En portrait le champ horizontal ne fait que trente-sept
 * degres : a cinquante metres de la route, une maison n'entre dans l'image
 * qu'a partir de cent cinquante metres devant. Un seul rang donne donc une
 * frise lointaine, jamais une rue. Il faut du decor a plusieurs profondeurs
 * pour que les maisons se recouvrent et fassent un quartier.
 */
const SLOTS = 6;

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

// xz d'un lampadaire pour une rangee donnee. org est la position du joueur.
// (Et pas d'accent grave dans ces commentaires : ils vivent dans un gabarit
//  JS, un seul backtick termine la chaine.)
// Un mat par rangee, EN ALTERNANCE d'un cote et de l'autre : deux rangees de
// mats en vis-a-vis font une avenue, et une avenue n'est pas un lotissement.
vec2 lampXZ(float row, vec2 org){
  float z = floor(org.y / TOWN_STEP) * TOWN_STEP + TOWN_AHEAD - row * TOWN_STEP;
  float side = mod(row, 2.0) < 0.5 ? 1.0 : -1.0;
  float h = hash21(vec2(z * 0.041, side * 9.13));
  // AU BORD DE L'ASPHALTE, et c'est tout le sujet. Le premier jet plantait les
  // mats a trente-sept metres, avec les maisons : ils etaient trop loin pour
  // eclairer quoi que ce soit, et une flaque de lumiere a trente-sept metres du
  // bitume n'atteint jamais la route. Un lampadaire qui n'eclaire pas la route
  // est un poteau, quelle que soit la beaute de son halo.
  return vec2(side * (15.0 + h * 2.5), z);
}

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
float townRoad(vec2 wp, float above, float town){
  if (town <= 0.004) return 0.0;
  // Le bord n'est pas droit : un bas-cote ronge et un peu d'enrobe qui deborde.
  float edge = 8.5 + (fbm2(vec2(wp.y * 0.035, 3.1)) - 0.5) * 3.0;
  return (1.0 - smoothstep(edge, edge + 4.5, abs(wp.x))) * town
       * smoothstep(-0.3, 0.5, above);
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
      // slot 2   : une maison de second rang, alternee.
      // slot 3   : le lampadaire.
      const side = slot === 0 ? -1 : slot === 1 ? 1 : row % 2 === 0 ? 1 : -1;
      spec[i * 4] = row;
      spec[i * 4 + 1] = side;
      spec[i * 4 + 2] = slot === 2 ? 1 : slot === 3 ? 2 : 0;
      // kind : 0 maison, 1 lampadaire, 2 arbre.
      spec[i * 4 + 3] = slot === 4 ? 1 : slot === 5 ? 2 : 0;
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
        uWall: { value: vec3('townWall') },
        uTree: { value: vec3('treeLine') },
        uRoof: { value: vec3('townRoof') },
        uWindow: { value: vec3('townWindow') },
        uHaze: { value: vec3('skyHorizon') },
      },
      vertexShader: /* glsl */ `
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
          float side = iSpec.y;
          float rank = iSpec.z;
          float lamp = iSpec.w;

          // Chaque instance replie les parties qui ne la concernent pas. Le
          // triangle degenere ne produit aucun fragment : c'est le moyen le
          // moins cher de faire cohabiter deux objets dans un seul appel.
          bool wantLamp = lamp > 0.5 && lamp < 1.5;
          bool wantTree = lamp > 1.5;
          bool isLampPart = aPart > 1.5 && aPart < 3.5;
          bool isTreePart = aPart > 3.5;
          bool isHousePart = aPart < 1.5;
          bool keepPart = wantLamp ? isLampPart : wantTree ? isTreePart : isHousePart;
          if (!keepPart) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

          vec2 wp;
          vec3 p = position;
          float seed;

          if (wantTree) {
            float z = floor(uOrigin.z / TOWN_STEP) * TOWN_STEP + TOWN_AHEAD - row * TOWN_STEP;
            float t1 = hash21(vec2(z * 0.029 + 9.1, side * 5.7));
            float t2 = hash21(vec2(z * 0.061 + 2.3, side * 8.9));
            float t3 = hash21(vec2(z * 0.017 + 6.6, side * 1.9));
            seed = t3;
            wp = vec2(side * (24.0 + t1 * 78.0), z + (t2 - 0.5) * TOWN_STEP * 1.6);
            if (t3 > uDensity * 1.05) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
            float rr = 1.3 + t2 * 1.5;
            float th = 5.5 + t3 * 6.5;
            vDim = vec3(rr, th, rr);
            p = vec3(position.x * rr, position.y * th, position.z * rr);
          } else if (wantLamp) {
            wp = lampXZ(row, uOrigin.xz);
            // La potence regarde la route : on retourne le mat selon le cote.
            p.x *= (wp.x > 0.0 ? 1.0 : -1.0);
            seed = fract(row * 0.317 + 0.21);
            vDim = vec3(1.0, TOWN_LAMP_H, 1.0);
          } else {
            float z = floor(uOrigin.z / TOWN_STEP) * TOWN_STEP + TOWN_AHEAD - row * TOWN_STEP;
            float h1 = hash21(vec2(z * 0.037, side * 3.11 + rank * 11.7));
            float h2 = hash21(vec2(z * 0.019 + 5.3, side * 7.71 + rank * 2.31));
            float h3 = hash21(vec2(z * 0.053 + 1.7, side * 4.33 + rank * 6.11));
            seed = h3;

            // Trois rangs. Le premier borde la route d'assez pres pour qu'on
            // le DOUBLE — c'est la seule facon d'exister dans un champ de
            // vision de trente-sept degres — les deux autres donnent la
            // profondeur du quartier. Un seul rang aligne au cordeau lit comme
            // un decor de train electrique.
            float bx = rank < 0.5 ? 30.0 + h1 * 13.0
                     : rank < 1.5 ? 58.0 + h1 * 26.0
                                  : 108.0 + h1 * 74.0;
            // Jitter GENEREUX le long de la route : a un demi-pas les maisons
            // restaient rangees comme des dominos, et vingt dominos font une
            // bande. A un pas et demi elles se chevauchent en profondeur, et
            // c'est ce chevauchement qui fait un quartier.
            wp = vec2(side * bx, z + (h2 - 0.5) * TOWN_STEP * 1.5);

            // La densite DECIME le semis, elle ne le rend pas transparent :
            // meme regle que les palmiers.
            // Le premier rang est plus clairsseme que les autres : une haie de
            // maisons collee a la route boucherait la vue du relief, et le
            // relief est ce qu'on doit lire pour sauter.
            float keep = rank < 0.5 ? uDensity * 0.58 : uDensity * 1.05;
            if (h3 > keep) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

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
      `,
      fragmentShader: /* glsl */ `
${GLSL_SAFE}
        uniform vec3 uWall, uRoof, uWindow, uHaze, uCam, uTree;
        uniform float uWet;
${GLSL_DAY}
${RIDER_GLSL}
        varying float vPart, vSeed;
        varying vec3 vLocal, vNrm, vWorld, vDim;
        ${GLSL_NOISE}

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
            // Une face sur deux prend ce qui reste de jour.
            c *= 0.80 + 0.30 * abs(vNrm.x);

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
              // LE DEBORDEMENT. C'est lui qui fait la lumiere : une fenetre
              // allumee qui s'arrete net au bord de son cadre lit comme un
              // autocollant colle sur un mur.
              float b = smoothstep(0.50, 0.28, max(d2.x, d2.y));
              c += uWindow * b * lit * 0.62;
              glow = b * lit * 0.6;
            }
          } else if (vPart < 1.5) {
            // --- LE TOIT. Plus sombre que les murs, et MOUILLE : c'est la
            //     seule surface du quartier qui regarde le ciel, donc la seule
            //     qui puisse le renvoyer.
            c = uRoof * (0.62 + hash21(vec2(vSeed * 19.0, 4.1)) * 0.34);
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
            gl_FragColor = vec4(uWindow * 3.4, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
            return;
          }

          c = daylight(c, 0.34 + uDayNight * 0.30);
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
        varying float vFade;

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

          // Le halo ENFLE sous la pluie : c'est l'eau en suspension qui diffuse
          // la lumiere, et c'est le detail qui fait qu'un lampadaire sous
          // l'averse ne ressemble pas a un lampadaire par temps sec.
          float s = 2.6 + uWet * 2.4;
          vec3 world = p + right * position.x * s + up * position.y * s;

          vFade = uDensity * smoothstep(230.0, 90.0, dist) * smoothstep(2.0, 6.0, dist);
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uWindow;
        uniform float uWet;
        varying vec2 vUv;
        varying float vFade;
        void main(){
          if (vFade < 0.004) discard;
          float r = length(vUv - 0.5) * 2.0;
          if (r > 1.0) discard;
          // Coeur dur, halo long. Un seul lobe donne une pastille ; c'est
          // l'ECART entre les deux exposants qui fait une lampe.
          float a = pow(max(1.0 - r, 1e-4), 5.0) * 0.9
                  + pow(max(1.0 - r, 1e-4), 1.6) * (0.16 + uWet * 0.22);
          a *= vFade;
          // Additif : l'alpha de sortie vaut 1 et toute la modulation vit dans
          // le RVB, sinon elle est comptee deux fois et la lueur sort terne.
          gl_FragColor = vec4(uWindow * a * 2.6, 1.0);
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
