import {
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  ShaderMaterial,
  Vector3,
} from 'three';
import { GLSL_NOISE, GLSL_SAFE, Rng } from '../core/Noise';
import { RIDER_GLSL, riderUniforms } from './RiderLight';
import { vec3 } from '../core/Palette';
import { GLSL_DAY, dayUniforms } from './Daylight';
import { SUN_DIR } from './Sky';
import { shoreGLSL, terrainGLSL, terrainUniforms } from './Terrain';
import { WEATHER_GLSL } from './Weather';
import { TOWN_GLSL } from './Town';

/**
 * LE BOSQUET, ou ce qui manquait a tous les mondes a la fois.
 *
 * Le defaut se voit sur n'importe quelle capture, et il ne se nomme pas
 * facilement : entre les vingt metres de premier plan que couvrent les touffes
 * et les trois cents metres ou commence la ligne d'horizon, il n'y avait
 * RIEN. Une nappe d'herbe, un degrade, et le regard qui glisse jusqu'au fond
 * sans rencontrer un seul objet dont il puisse estimer la taille.
 *
 * Or c'est exactement comme ca qu'on lit une distance : par comparaison avec
 * un objet dont on connait la taille. Un paysage sans mobilier n'a pas
 * d'echelle — il a une couleur de sol et une couleur de ciel, et il peut aussi
 * bien mesurer trente metres que trois kilometres. Toute la brume atmospherique
 * du monde ne rattrape pas ca : la brume separe des PLANS, encore faut-il qu'il
 * y ait quelque chose dedans a separer.
 *
 * Trois archetypes, choisis pour ce qu'ils font a la SILHOUETTE :
 *
 *   L'ARBRE    couronne haute sur un tronc fin. C'est le seul qui coupe la
 *              ligne d'horizon locale, donc le seul qui donne une hauteur.
 *   LE ROCHER  dome bas et large. Il ne coupe rien, il POSE : une pierre sur
 *              une pente dit la pente mieux qu'un degre de plus d'ombrage.
 *   LE BUISSON trois masses au ras du sol. Il remplit l'intervalle entre les
 *              deux autres — sans lui, un semis d'arbres et de rochers se lit
 *              comme deux semis distincts poses l'un sur l'autre.
 *
 * ---
 *
 * MEME DISCIPLINE QUE LES PALMIERS ET LES TOUFFES, et pour la meme raison : le
 * placement vit DANS LE SHADER, avec le meme chunk de relief, le meme masque de
 * greve et la meme route. Un arbre pousse sur le sable, ou au milieu de
 * l'asphalte, dit immediatement que deux couches du jeu ne se parlent pas — et
 * c'est le genre de faute qu'on ne rattrape jamais en deplacant des chiffres,
 * parce qu'elle vient d'avoir deux sources de verite.
 *
 * Le contenu d'une cellule ne depend QUE de sa position monde, jamais de
 * l'indice d'instance. C'est l'invariant du decor ancre (cf. Town.ts) : quand
 * le joueur franchit un pas de grille, chaque instance herite de la cellule de
 * sa voisine, et tout ce qui se lisait sur l'indice se teleporte.
 */

/**
 * 21 x 21 cellules de 15 m : le semis couvre 157 m dans chaque direction.
 *
 * Le rayon est le premier reglage : a 120 m le bosquet s'arretait visiblement
 * avant la brume et le paysage avait un BORD — une ligne au-dela de laquelle
 * plus rien ne pousse, ce qu'aucun terrain n'a jamais eu. Le dernier rang doit
 * mourir dans la brume, pas dans le vide.
 *
 * L'ESPACEMENT est le second, et c'est celui que j'ai rate d'abord. A 26 m de
 * cellule, six captures prises au hasard dans la plaine montraient zero, un ou
 * deux arbres : le semis existait, il ne PEUPLAIT pas. Un objet tous les vingt
 * metres est ce qu'il faut pour que le regard en rencontre toujours un, et
 * c'est la seule chose qui transforme une nappe d'herbe en distance.
 */
const GRID = 21;
const CELL = 15;
const COUNT = GRID * GRID;

/** 0 = arbre, 1 = rocher, 2 = buisson. */
const KIND_TREE = 0;
const KIND_ROCK = 1;
const KIND_BUSH = 2;

/**
 * Les trois archetypes dans UNE SEULE geometrie.
 *
 * Trois maillages auraient donne trois appels de rendu, trois materiaux a tenir
 * d'accord et trois endroits ou oublier une couleur de monde. Ici le sommet
 * porte son archetype ; le shader replie ceux dont l'instance n'a pas besoin.
 * On paie donc trois fois le cout SOMMET d'une instance — quelques centaines de
 * sommets, soit rien — et une seule fois tout le reste.
 */
function buildGeometry(): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  /** L'archetype auquel ce sommet appartient. */
  const kind: number[] = [];
  /** 0 au pied, 1 au sommet. Sert au vent ET au degrade de couleur. */
  const up: number[] = [];
  /** 0 = tronc / coeur, 1 = feuillage. Deux matieres, une geometrie. */
  const leaf: number[] = [];
  /** Normale approchee, en repere objet. */
  const nrm: number[] = [];

  const push = (
    x: number, y: number, z: number,
    k: number, u: number, l: number,
    nx: number, ny: number, nz: number,
  ): number => {
    pos.push(x, y, z);
    kind.push(k);
    up.push(u);
    leaf.push(l);
    const n = Math.hypot(nx, ny, nz) || 1;
    nrm.push(nx / n, ny / n, nz / n);
    return pos.length / 3 - 1;
  };

  /**
   * Un dome de revolution, bosselé par une somme de sinus sur l'azimut.
   *
   * Le bosselage n'est pas un detail : une sphere lisse a douze faces se lit
   * comme une sphere lisse a douze faces, quelle que soit la couleur qu'on lui
   * donne. Deux harmoniques suffisent a casser la revolution, et elles sont
   * BAKEES dans les sommets — un bruit calcule par pixel couterait plus cher et
   * ne changerait pas la silhouette, qui est la seule chose qu'on voit a cent
   * metres.
   */
  const dome = (
    k: number, l: number,
    cx: number, cy: number, cz: number,
    rx: number, ry: number,
    lat: number, lon: number,
    /** 0 = boule, 1 = cone. Le meme maillage sert l'arbre rond et le sapin. */
    spire: number,
    /** Decalage de phase, pour que deux masses voisines ne soient pas jumelles. */
    ph: number,
  ): void => {
    const rows: number[][] = [];
    for (let i = 0; i <= lat; i++) {
      const v = i / lat;
      // Profil : sin donne la boule, (1 - v) donne le cone. On interpole.
      const prof = (1 - spire) * Math.sin(v * Math.PI * 0.92 + 0.14) + spire * (1 - v * 0.94);
      const y = cy + v * ry;
      const row: number[] = [];
      for (let j = 0; j < lon; j++) {
        const a = (j / lon) * Math.PI * 2;
        // Trois harmoniques, pas deux, et plus amples : a 0,17 la couronne
        // restait une boule a facettes, et une boule a facettes ne devient
        // jamais un arbre, quelle que soit la couleur qu'on lui donne. Ce
        // qu'on regarde a cent metres est une SILHOUETTE, et une silhouette
        // se casse au sommet ou nulle part.
        const bump =
          1 + 0.26 * Math.sin(a * 3 + ph)
            + 0.17 * Math.sin(a * 5 - ph * 1.7 + v * 4.1)
            + 0.09 * Math.sin(a * 8 + ph * 2.3 - v * 6.0);
        const r = rx * prof * bump;
        row.push(push(
          cx + Math.cos(a) * r, y, cz + Math.sin(a) * r,
          k, v, l,
          Math.cos(a) * 0.82, 0.42 + v * 0.5, Math.sin(a) * 0.82,
        ));
      }
      rows.push(row);
    }
    for (let i = 0; i < lat; i++) {
      for (let j = 0; j < lon; j++) {
        const n = (j + 1) % lon;
        idx.push(rows[i][j], rows[i][n], rows[i + 1][j]);
        idx.push(rows[i][n], rows[i + 1][n], rows[i + 1][j]);
      }
    }
  };

  // -------------------------------------------------------------------------
  // L'ARBRE. Tronc de 2,6 m, couronne de 4,4 m. Les proportions comptent plus
  // que la forme : un tronc trop court donne un buisson sur pied, un tronc trop
  // long donne un parasol. Le rapport 1 pour 1,7 est celui d'un arbre de bord
  // de champ, qui est exactement ce qu'on veut ici.
  {
    // 2,15 m de tronc et 4,4 m de haut en tout, pas 7.
    //
    // Le premier jet visait l'arbre de bord de champ, et il etait JUSTE — pour
    // un plan large. A la distance ou vit cette camera, un arbre de sept metres
    // remplit la moitie du cadre des qu'on en frole un, et le paysage disparait
    // derriere son propre mobilier. On descend a la taille d'un jeune arbre :
    // assez haut pour couper la ligne d'horizon locale, ce qui est tout son
    // travail, assez bas pour qu'en croiser un soit un evenement d'une
    // demi-seconde et non un mur.
    const H = 1.92;
    const SEG = 5;
    const ring: number[][] = [];
    for (let i = 0; i <= 2; i++) {
      const t = i / 2;
      const r = 0.155 * (1 - t * 0.45);
      const row: number[] = [];
      for (let j = 0; j < SEG; j++) {
        const a = (j / SEG) * Math.PI * 2;
        row.push(push(
          Math.cos(a) * r, t * H, Math.sin(a) * r,
          KIND_TREE, t * 0.3, 0,
          Math.cos(a), 0.1, Math.sin(a),
        ));
      }
      ring.push(row);
    }
    for (let i = 0; i < 2; i++) {
      for (let j = 0; j < SEG; j++) {
        const n = (j + 1) % SEG;
        idx.push(ring[i][j], ring[i][n], ring[i + 1][j]);
        idx.push(ring[i][n], ring[i + 1][n], ring[i + 1][j]);
      }
    }
    // Deux masses decalees plutot qu'une seule : une couronne unique est une
    // boule, deux qui se chevauchent font une frondaison.
    dome(KIND_TREE, 1, 0, H - 0.38, 0, 1.20, 2.20, 5, 11, 0, 0.0);
    dome(KIND_TREE, 1, 0.44, H + 0.26, -0.24, 0.80, 1.38, 3, 8, 0, 2.4);
    dome(KIND_TREE, 1, -0.38, H - 0.02, 0.40, 0.62, 1.00, 3, 7, 0, 5.1);
  }

  // -------------------------------------------------------------------------
  // LE ROCHER. Large et bas : c'est ce qui le distingue du buisson a cent
  // metres, ou la couleur ne suffit plus.
  {
    dome(KIND_ROCK, 0, 0, -0.30, 0, 1.18, 1.02, 3, 9, 0, 1.1);
    dome(KIND_ROCK, 0, 0.72, -0.26, 0.48, 0.58, 0.62, 2, 7, 0, 3.7);
  }

  // -------------------------------------------------------------------------
  // LE BUISSON. Trois masses au ras du sol, pour la meme raison que les quatre
  // brins d'une touffe : groupees a l'origine elles font un objet isole, et le
  // semis se lit comme un champ d'objets et non comme une vegetation.
  {
    dome(KIND_BUSH, 1, 0, -0.18, 0, 0.78, 1.00, 3, 8, 0, 0.6);
    dome(KIND_BUSH, 1, 0.78, -0.22, 0.32, 0.55, 0.72, 2, 7, 0, 2.9);
    dome(KIND_BUSH, 1, -0.46, -0.20, 0.62, 0.45, 0.58, 2, 6, 0, 5.2);
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aKind', new BufferAttribute(new Float32Array(kind), 1));
  g.setAttribute('aUp', new BufferAttribute(new Float32Array(up), 1));
  g.setAttribute('aLeaf', new BufferAttribute(new Float32Array(leaf), 1));
  g.setAttribute('aNrm', new BufferAttribute(new Float32Array(nrm), 3));
  g.setIndex(idx);
  return g;
}

export class Grove {
  readonly mesh: InstancedMesh;
  readonly mat: ShaderMaterial;
  private m = new Matrix4();

  constructor() {
    const rng = new Rng(910337);
    const seed = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) seed[i] = rng.next();

    this.mat = new ShaderMaterial({
      side: DoubleSide,
      uniforms: {
        ...riderUniforms(),
        ...terrainUniforms(),
        ...dayUniforms(),
        uTime: { value: 0 },
        uOrigin: { value: new Vector3() },
        uSun: { value: SUN_DIR.clone() },
        /** Presence, 0..1. Elle DECIME le semis, elle ne le rend pas pale. */
        uDensity: { value: 1 },
        /** 0 = couronne ronde, 1 = fleche. Un monde d'automne veut des cimes. */
        uSpire: { value: 0 },
        /** Part des cellules qui portent un rocher plutot qu'une plante. */
        uStone: { value: 0.24 },
        uTrunk: { value: vec3('warmAccent') },
        uLeafLow: { value: vec3('grassMid') },
        uLeafHigh: { value: vec3('grassNear') },
        uRock: { value: vec3('grassShadow') },
        /** La brume dans laquelle meurt le dernier rang. */
        uHaze: { value: vec3('grassHorizon') },
        uTown: { value: 0 },
      },
      vertexShader: /* glsl */ `
${GLSL_SAFE}
${GLSL_NOISE}
        attribute float aKind, aUp, aLeaf;
        attribute vec3 aNrm;
        attribute float iSeed;
        uniform float uTime, uDensity, uSpire, uStone, uTown;
        uniform vec3 uOrigin;
        varying float vUp, vLeaf, vSeed, vKind, vFog, vLight;
        varying vec3 vWorldPos;

        ${terrainGLSL()}
${shoreGLSL()}
        ${WEATHER_GLSL}
${TOWN_GLSL}

        void main(){
          // --- LA CELLULE MONDE. Comme les palmiers : on ancre sur la position
          //     du joueur arrondie au pas de grille, jamais sur l'instance.
          vec2 base = vec2(
            floor(uOrigin.x / ${CELL}.0 + instanceMatrix[3][0]) * ${CELL}.0,
            floor(uOrigin.z / ${CELL}.0 + instanceMatrix[3][2]) * ${CELL}.0);
          float h1 = hash21(base * 0.0271 + 1.7);
          float h2 = hash21(base * 0.0193 + 11.3);
          float h3 = hash21(base * 0.0417 + 43.1);
          float h4 = hash21(base * 0.0089 + 77.9);

          // --- L'ARCHETYPE EST TESTE EN PREMIER, ET C'EST UNE OPTIMISATION
          //     QUI VAUT UN FACTEUR TROIS.
          //
          //     Les trois archetypes vivent dans la meme geometrie : chaque
          //     instance traite les sommets des trois et n'en garde qu'un. Si
          //     le rejet arrive APRES le placement, les deux tiers des sommets
          //     paient un relief, un gradient et un fbm de greve pour etre
          //     jetes ensuite. Teste d'abord, ce meme rejet ne coute que deux
          //     hachages — et c'est ce qui autorise a passer de 225 a 441
          //     cellules sans rien payer de plus qu'avant.
          //
          //     Le prix a payer est reel et il est assume : l'archetype ne peut
          //     plus dependre de la PENTE, qui demanderait le gradient. Les
          //     rochers ne cherchent plus les flancs. C'etait une jolie regle
          //     d'ecologie, elle coutait une seconde evaluation complete du
          //     relief par sommet, et personne ne la lit sur l'image.
          float stone = clamp(uStone, 0.0, 0.95);
          float kind = h4 < stone ? ${KIND_ROCK}.0
                     : (h4 < stone + (1.0 - stone) * 0.42 ? ${KIND_BUSH}.0 : ${KIND_TREE}.0);
          if (abs(aKind - kind) > 0.5) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }

          // Dispersion dans la cellule. Sans elle le semis est une GRILLE, et
          // une grille de quinze metres se lit du premier coup d'oeil.
          vec2 wp = base + vec2(h1, h2) * ${CELL}.0 * 0.94;

          float gh = terrainHeightAt(wp, 0.0);
          float above = gh - WATER_LEVEL;

          // --- LES QUATRE REFUS, dans l'ordre ou ils coutent le moins cher.
          //
          //     1. l'eau. Un arbre les pieds dans un lac est le defaut qu'on
          //        remarque de plus loin.
          float ok = smoothstep(0.4, 2.2, above);
          //     2. le sable. Meme masque que le sol et que les palmiers.
          ok *= 1.0 - smoothstep(0.25, 0.75, shoreMask(wp, above));
          //     3. la route et ses accotements. Le quartier a deja ses arbres,
          //        alignes le long du bitume ; un bosquet sauvage au milieu de
          //        la chaussee dirait que personne ne se parle.
          ok *= 1.0 - uTown * (1.0 - smoothstep(0.0, 9.0, abs(wp.x) - townEdge(wp)));
          //     4. LE TIRAGE. Le seuil MONTE quand la densite baisse : le semis
          //        se vide de ses individus, il ne palit pas. Un decor a moitie
          //        transparent est un bug, un bosquet plus clair est un paysage.
          ok *= step(mix(1.15, 0.42, uDensity), h3);

          if (ok < 0.35) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }

          float scale = 0.72 + h1 * 0.52 + (kind == ${KIND_TREE}.0 ? h2 * 0.30 : 0.0);

          // --- LA CLAIRIERE, ET C'EST LE PRIX DE LA DENSITE.
          //
          //     Un objet tous les vingt metres et une course a trente metres
          //     par seconde : le surfeur TRAVERSE des couronnes, et une
          //     couronne opaque traversee efface l'ecran pendant deux images.
          //     Aucune regle de placement ancree au monde ne peut l'eviter,
          //     puisqu'il n'y a pas de route a border — le joueur va ou il
          //     veut.
          //
          //     Ce qui reste est de faire mourir l'objet AVANT le contact.
          //     Neuf metres, soit trois dixiemes de seconde en croisiere,
          //     pendant lesquelles l'objet est deja au bord du cadre. Le defaut
          //     residuel est une petite clairiere qui suit le joueur ; il est
          //     tres largement preferable a un ecran qui clignote.
          scale *= smoothstep(3.5, 9.5, length(wp - uOrigin.xz));
          if (scale < 0.02) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }

          vec3 p = position * scale;

          // Rotation autour de l'axe : deux arbres voisins ne doivent pas
          // presenter la meme bosse au meme endroit.
          float a = h2 * 6.2831;
          p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * p.xz;

          // --- LA RAFALE. Elle ne fait plier que ce qui est HAUT : un rocher
          //     qui ondule au vent est le genre de detail qui detruit une
          //     scene entiere sans qu'on sache dire pourquoi.
          float bendable = aLeaf * step(kind, ${KIND_BUSH}.0 - 0.5) + aLeaf * 0.35;
          float gust = gustAt(wp, uTime);
          float sway = sin(uTime * 0.95 + iSeed * 27.0 + wp.x * 0.03);
          p.x += aUp * aUp * bendable * (0.16 + gust * 0.62) * (0.55 + sway * 0.45) * scale;
          p.z += aUp * aUp * bendable * (0.09 + gust * 0.28) * sway * 0.6 * scale;

          vec3 world = vec3(wp.x, gh, wp.y) + p;

          // --- L'ECLAIRAGE, calcule au SOMMET et interpole.
          //
          //     La normale d'un dome de revolution est deja fausse a douze
          //     faces ; la calculer par pixel ne la rendrait pas vraie, ca
          //     couterait seulement plus cher. Ce qu'on veut d'elle est qu'un
          //     cote soit au soleil et l'autre a l'ombre — une interpolation
          //     lineaire le rend parfaitement.
          vec3 n = normalize(vec3(
            aNrm.x * cos(a) - aNrm.z * sin(a),
            aNrm.y,
            aNrm.x * sin(a) + aNrm.z * cos(a)));
          vLight = 0.5 + 0.5 * dot(n, normalize(vec3(0.42, 0.72, 0.55)));

          vUp = aUp; vLeaf = aLeaf; vSeed = iSeed; vKind = kind;
          vWorldPos = world;

          // La brume : elle est calculee sur la distance HORIZONTALE au joueur,
          // pas sur la profondeur ecran. Un arbre au ras du cadre et un arbre au
          // centre, a la meme distance, doivent avoir la meme brume.
          vFog = smoothstep(60.0, 235.0, length(wp - uOrigin.xz));

          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
${GLSL_SAFE}
        uniform vec3 uTrunk, uLeafLow, uLeafHigh, uRock, uHaze, uSun;
        uniform float uSpire;
${RIDER_GLSL}
${GLSL_DAY}
        varying float vUp, vLeaf, vSeed, vKind, vFog, vLight;
        varying vec3 vWorldPos;

        void main(){
          vec3 c;
          if (vKind > ${KIND_ROCK}.0 - 0.5 && vKind < ${KIND_ROCK}.0 + 0.5) {
            // LA PIERRE. Sa valeur varie d'un bloc a l'autre, sa TEINTE non :
            // deux gris differents dans un meme champ lisent comme deux
            // materiaux, ce qu'un eboulis n'a jamais.
            c = uRock * (0.72 + vSeed * 0.34) * (0.62 + vLight * 0.72);
          } else if (vLeaf > 0.5) {
            // LE FEUILLAGE. Clair au sommet, sombre au coeur : c'est la seule
            // chose qui distingue une frondaison d'une boule peinte, et elle
            // vaut plus que n'importe quel detail de feuille.
            c = mix(uLeafLow, uLeafHigh, vUp * 0.82 + vSeed * 0.18);
            c *= 0.66 + vLight * 0.60;
            // Le liseré de translucidite : les feuilles du bord sont traversees
            // par le soleil. C'est ce qui fait qu'un arbre a contre-jour brille
            // au lieu de faire un trou noir dans le ciel.
            c += uLeafHigh * pow(max(1.0 - vLight, 0.0), 2.4) * (0.22 + uSpire * 0.10);
            // --- LE CIEL SUR LA CIME, et il ne coute qu'une ligne.
            //
            //     Un feuillage eclaire par le seul soleil est trop sature :
            //     dans la nature, le haut d'un arbre recoit une demi-sphere de
            //     ciel et en prend la couleur, ce qui le DESATURE et le
            //     refroidit. Sans ce terme, un vert d'herbe monte en vert
            //     plastique des qu'on l'eclaircit, et c'est exactement ce qui
            //     rendait le premier bosquet criard au milieu d'une palette
            //     pastel.
            c = mix(c, uHaze, vUp * vUp * 0.20);
          } else {
            c = uTrunk * (0.52 + vLight * 0.52) * (0.86 + vSeed * 0.22);
          }

          c = daylight(c, (1.0 - vUp) * 0.40 + uDayNight * 0.30);
          c += riderLight(vWorldPos) * (0.28 + uDayNight * 0.75);

          // --- LA BRUME, ET ELLE EST LA RAISON D'ETRE DE TOUT LE SEMIS.
          //
          //     Un bosquet dont tous les rangs ont la meme valeur donne une
          //     foret plate : on voit des arbres, on ne voit pas de distance.
          //     Le dernier rang doit se fondre EXACTEMENT dans la bande
          //     d'horizon du sol, sinon le semis s'arrete sur une ligne.
          c = mix(c, uHaze, vFog * 0.88);

          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new InstancedMesh(buildGeometry(), this.mat, COUNT);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -835;

    const half = (GRID - 1) / 2;
    let i = 0;
    for (let gz = 0; gz < GRID; gz++) {
      for (let gx = 0; gx < GRID; gx++) {
        this.m.identity();
        // Le semis est decale VERS L'AVANT : la camera regarde vers les z
        // negatifs, et un anneau centre sur le joueur depense la moitie de ses
        // instances derriere lui, ou personne ne les verra jamais.
        this.m.setPosition(gx - half, 0, gz - half - GRID * 0.34);
        this.mesh.setMatrixAt(i++, this.m);
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.setAttribute('iSeed', new InstancedBufferAttribute(seed, 1));
  }

  update(origin: Vector3, time: number): void {
    this.mat.uniforms.uOrigin.value.copy(origin);
    this.mat.uniforms.uTime.value = time;
  }
}
