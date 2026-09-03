import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Group,
  LatheGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector2,
} from 'three';
import { GLSL_SAFE, GLSL_NOISE } from '../core/Noise';
import { vec3 } from '../core/Palette';

/**
 * Le CD.
 *
 * Regle du doc 01 : ce n'est PAS un miroir, c'est un reseau de diffraction.
 * La teinte depend de l'angle azimutal autour du centre ET de l'angle de vue.
 * Un simple envMap donnerait un frisbee chrome, pas un disque optique.
 *
 * L'environnement est fake : on reflechit une fonction analytique ciel/sol.
 * C'est gratuit, et ca fait exactement ce que fait la reference — le CD
 * capte le vert de la plaine par en dessous et le cyan par au-dessus.
 */
/**
 * Rapport releve sur la reference : le CD fait 1.34 fois le demi-buste.
 * Le premier jet etait a 1.94 et transformait le disque en soucoupe.
 */
export const DISC_RADIUS = 1.34 * 0.80;
/** Proportions d'un vrai disque optique : trou 12.5 %, moyeu clair 20 %. */
const HOLE = DISC_RADIUS * 0.125;
const THICK = 0.028;

/**
 * La CARTOUCHE : une plaque carree, pour le MiniDisc et la disquette.
 *
 * C'est la seule chose qui change vraiment une monture a distance de jeu. Six
 * disques ronds de couleurs differentes se ressemblent tous des qu'ils font
 * quarante pixels ; un carre au milieu de ronds se reconnait sans le regarder,
 * et c'est exactement le reproche qu'il fallait traiter — « ils sont pas assez
 * differents ».
 *
 * Les coins sont RABOTES a 12 % : un carre parfait accroche l'oeil sur ses
 * pointes et lit comme une erreur de modelisation, alors qu'un carre a coins
 * casses lit comme un objet moule. Toutes les cartouches de l'epoque le sont.
 */
function slabGeometry(): BufferGeometry {
  const R = DISC_RADIUS * 0.94;
  const T = THICK * 2.6;
  const c = R * 0.12;
  // Contour octogonal : carre a coins rabotes.
  const ring: Array<[number, number]> = [
    [-R + c, -R], [R - c, -R], [R, -R + c], [R, R - c],
    [R - c, R], [-R + c, R], [-R, R - c], [-R, -R + c],
  ];
  const pos: number[] = [];
  const idx: number[] = [];
  const push = (x: number, y: number, z: number): number => {
    pos.push(x, y, z);
    return pos.length / 3 - 1;
  };
  const top: number[] = [];
  const bot: number[] = [];
  for (const [x, z] of ring) {
    top.push(push(x, T * 0.5, z));
    bot.push(push(x, -T * 0.5, z));
  }
  const ct = push(0, T * 0.5, 0);
  const cb = push(0, -T * 0.5, 0);
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(ct, top[i], top[j]);
    idx.push(cb, bot[j], bot[i]);
    idx.push(top[i], bot[i], bot[j]);
    idx.push(top[i], bot[j], top[j]);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function discGeometry(): LatheGeometry {
  const pts = [
    new Vector2(HOLE, THICK * 0.5),
    new Vector2(DISC_RADIUS, THICK * 0.5),
    new Vector2(DISC_RADIUS, -THICK * 0.5),
    new Vector2(HOLE, -THICK * 0.5),
    new Vector2(HOLE, THICK * 0.5),
  ];
  return new LatheGeometry(pts, 96);
}

/**
 * LES SIX MONTURES.
 *
 * Une table explicite plutot qu'un espace de parametres : chaque ligne est un
 * OBJET qu'on reconnait, et l'ecrire en clair est ce qui permet de verifier
 * d'un coup d'oeil qu'aucune ne ressemble a sa voisine.
 *
 * Deux leviers font 90 % de la distinction a distance de jeu, et la couleur
 * n'en fait pas partie : la FORME (ronde ou carree) et la TAILLE. A quarante
 * pixels, six disques ronds de teintes differentes se ressemblent tous.
 */
interface MountLook {
  body: [number, number, number];
  label: [number, number, number];
  emit: [number, number, number];
  iri: number;
  groove: number;
  grain: number;
  labelR: number;
  shutter: number;
  opaque: number;
  scale: number;
  square: boolean;
}

const MOUNT_LOOK: Record<string, MountLook> = {
  // Le disque optique d'origine : argent, irise, translucide au moyeu.
  cd: {
    body: [0.86, 0.93, 0.96], label: [0.9, 0.6, 0.1], emit: [0, 0, 0],
    iri: 1, groove: 620, grain: 0, labelR: 0, shutter: 0, opaque: 0.25,
    scale: 1, square: false,
  },
  // Le 33 tours : le plus GRAND, noir mat, sillons larges, etiquette orange.
  vinyle: {
    body: [0.17, 0.19, 0.23], label: [0.95, 0.58, 0.10], emit: [0, 0, 0],
    iri: 0.08, groove: 210, grain: 0.6, labelR: 0.34, shutter: 0, opaque: 1,
    scale: 1.16, square: false,
  },
  // La cartouche bleue : CARREE, petite, avec son volet metallique.
  minidisc: {
    body: [0.30, 0.62, 0.92], label: [0.06, 0.28, 0.52], emit: [0, 0, 0],
    iri: 0.22, groove: 900, grain: 0.08, labelR: 0.3, shutter: 1, opaque: 1,
    scale: 0.84, square: true,
  },
  // La disquette : CARREE aussi, mais noire, plus grande, etiquette blanche.
  // Deux cartouches se distinguent alors par la taille et la valeur, pas par
  // un detail qu'il faudrait aller chercher.
  disquette: {
    body: [0.13, 0.14, 0.17], label: [0.93, 0.92, 0.86], emit: [0, 0, 0],
    iri: 0.05, groove: 40, grain: 0.22, labelR: 0.4, shutter: 1, opaque: 1,
    scale: 1.05, square: true,
  },
  // Le CD gravable : face doree, irisation verte. Le seul dore du jeu.
  cdr: {
    body: [0.92, 0.72, 0.28], label: [0.2, 0.5, 0.25], emit: [0.05, 0.03, 0],
    iri: 0.85, groove: 700, grain: 0, labelR: 0, shutter: 0, opaque: 0.7,
    scale: 0.98, square: false,
  },
  // Le disque de pure lumiere : pas de matiere, juste de l'emission. Le seul
  // qui soit une SOURCE, et donc le seul visible de nuit a lui tout seul.
  // Le corps est descendu de [0,45 0,85 1,0] a [0,24 0,66 0,92], et l'emission
  // a suivi : presque blanc, HOLO ne se voyait plus des que l'aura s'allumait —
  // du blanc pale sur du blanc sature. Il reste la monture la plus claire du
  // jeu, mais il a maintenant une TEINTE, et une teinte survit a un fond
  // brulant la ou une valeur ne survit pas.
  holo: {
    body: [0.24, 0.66, 0.92], label: [0, 0, 0], emit: [0.10, 0.36, 0.58],
    iri: 0.72, groove: 1400, grain: 0, labelR: 0, shutter: 0, opaque: 0,
    scale: 1.08, square: false,
  },
};

export class Disc {
  readonly group = new Group();
  private readonly round = discGeometry();
  private readonly slab = slabGeometry();
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  private haloMat: ShaderMaterial;

  constructor() {
    this.mat = new ShaderMaterial({
      side: DoubleSide,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uSilver: { value: vec3('discSilver') },
        uSkyMid: { value: vec3('skyMid') },
        uSkyHor: { value: vec3('skyHorizon') },
        uGrassNear: { value: vec3('grassNear') },
        uGrassHor: { value: vec3('grassHorizon') },
        uRadius: { value: DISC_RADIUS },
        uHole: { value: HOLE },
        uCharge: { value: 0 },
        // --- Identite de la monture. Un seul shader pour les trois : ce sont
        //     les memes sillons, le meme environnement analytique et le meme
        //     liseré exterieur — un disque presse reste un disque presse. Seuls
        //     changent la matiere, la finesse des sillons et ce qu'il y a au
        //     centre. Trois shaders auraient triple la surface a maintenir
        //     pour dire la meme chose.
        uIri: { value: 1 },
        uGroove: { value: 620 },
        uGrain: { value: 0 },
        uLabel: { value: [0.9, 0.6, 0.1] },
        uLabelR: { value: 0 },
        uShutter: { value: 0 },
        uOpaque: { value: 0 },
        /** 0 = disque, 1 = cartouche carree. Change la GEOMETRIE et le motif. */
        uShape: { value: 0 },
        /** Emission propre : une monture peut etre une source de lumiere. */
        uEmit: { value: [0, 0, 0] },
      },
      vertexShader: /* glsl */ `
${GLSL_SAFE}
        varying vec3 vN, vV, vLocal;
        void main(){
          vLocal = position;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = nsafe(cameraPosition - wp.xyz, vec3(0.0, 0.0, 1.0));
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime, uRadius, uHole, uCharge;
        uniform float uIri, uGroove, uGrain, uLabelR, uShutter, uOpaque, uShape;
        uniform vec3 uSilver, uSkyMid, uSkyHor, uGrassNear, uGrassHor, uLabel, uEmit;
        varying vec3 vN, vV, vLocal;

        ${GLSL_NOISE}

        const float TAU = 6.28318530718;

        void main(){
          vec3 N = normalize(vN);
          vec3 V = normalize(vV);
          if (!gl_FrontFacing) N = -N;
          float ndv = clamp(dot(N, V), 0.0, 1.0);

          // --- COORDONNEE RADIALE, ou son equivalent carre.
          //
          //     Une cartouche n'a pas de centre au sens ou un disque en a un :
          //     ses motifs sont des RECTANGLES, alignes sur ses bords. On
          //     remplace donc la distance euclidienne par la distance de
          //     Tchebychev — le plus grand des deux ecarts — qui fait des
          //     carres concentriques la ou l'autre fait des cercles. Tout le
          //     reste du shader continue de fonctionner sans y penser.
          float rDisc = length(vLocal.xz);
          float rSlab = max(abs(vLocal.x), abs(vLocal.z));
          float r = mix(rDisc, rSlab, uShape);
          float ang = atan(vLocal.z, vLocal.x);
          float rn = clamp((r - uHole) / (uRadius - uHole), 0.0, 1.0);

          // Environnement analytique : cyan au-dessus, vert en dessous.
          vec3 Rv = reflect(-V, N);
          vec3 env = Rv.y > 0.0
            ? mix(uSkyHor, uSkyMid, clamp(Rv.y * 1.6, 0.0, 1.0))
            : mix(uGrassHor, uGrassNear, clamp(-Rv.y * 1.6, 0.0, 1.0));

          // Sillons concentriques : ils modulent la nettete du reflet. Sur un
          // microsillon ils sont dix fois plus larges et se VOIENT, au lieu de
          // se contenter de moduler un reflet — d'ou uGroove et uGrain.
          float grooves = sin(r * uGroove) * 0.5 + 0.5;

          // Diffraction. Sur la reference elle est PASTEL, pas saturee : le
          // disque balaie teal -> argent -> lavande, il ne fait pas l'arc-en-
          // ciel de fete foraine du premier jet.
          float hue = fract(ang / TAU * 1.15 + ndv * 1.25 + rn * 0.30 + uTime * 0.04);
          vec3 iri = mix(vec3(1.0), hue2rgb(hue), 0.42 * uIri);

          // Moyeu plastique transparent, puis zone donnees.
          float hub = smoothstep(0.05, 0.17, rn);

          // Base argent : un CD reste clair, c'est un miroir pique de couleur.
          vec3 c = mix(uSilver * 0.62, uSilver * 1.12, ndv);
          c = mix(c, env, 0.34);
          c *= mix(vec3(1.0), iri, hub * (0.55 + 0.45 * grooves));

          // Anneau de moyeu clair et trou central sombre. La cartouche n'a ni
          // moyeu ni trou : elle est pleine, et uShape les efface.
          c = mix(mix(uSilver * 1.28, c, hub), c, uShape);
          float hole = mix(smoothstep(0.0, 0.03, rn), 1.0, uShape);
          c = mix(uGrassNear * 0.30, c, hole);
          // Le relief des sillons, quand la monture en a de vrais.
          c *= 1.0 - uGrain * grooves * 0.55;

          // Etiquette centrale. Rayon nul = pas d'etiquette : c'est ce qui
          // distingue un 45 tours d'un disque optique en un coup d'oeil.
          float lab = smoothstep(uLabelR, uLabelR - 0.10, rn) * step(0.001, uLabelR) * hole;
          c = mix(c, uLabel * (0.75 + ndv * 0.55), lab);

          // Le volet du MiniDisc : une bande droite, decentree, qui casse la
          // symetrie radiale. C'est la seule chose qui empeche la cartouche de
          // se lire comme un CD blanc.
          // Le VOLET metallique de la cartouche : une bande droite, decentree,
          // qui casse la symetrie. C'est elle, plus que la couleur, qui fait
          // lire un MiniDisc ou une disquette plutot qu'une plaque carree.
          float shut = uShutter
            * smoothstep(0.34, 0.25, abs(vLocal.z))
            * smoothstep(0.10, 0.26, vLocal.x);
          c = mix(c, vec3(0.88, 0.94, 0.99) * (0.62 + ndv * 0.7), shut);

          // L'ETIQUETTE de la disquette : un rectangle mat en haut a gauche,
          // le seul endroit d'une monture ou la lumiere ne joue pas.
          float tag = uShape
            * step(0.001, uLabelR)
            * smoothstep(0.62, 0.55, abs(vLocal.z + uRadius * 0.34))
            * smoothstep(0.72, 0.66, abs(vLocal.x));
          c = mix(c, uLabel * (0.86 + ndv * 0.2), tag * 0.9);

          // Arete exterieure incandescente : le liseré blanc de la reference.
          c += vec3(1.0) * smoothstep(0.90, 1.0, rn) * 0.30;
          // Eclat speculaire rasant.
          c += vec3(1.0) * pow(1.0 - abs(ndv), 7.0) * 0.28;

          // Sur la reference la grande zone teal sombre est sur un COTE, pas
          // au centre : c'est un reflet d'environnement, pas une ombre. Le
          // moyeu, lui, reste clair.
          float sector = 0.5 + 0.5 * cos(ang + 2.4);
          c *= 1.0 - 0.40 * smoothstep(0.25, 1.0, sector) * hub;

          // Le disque blanchit quand le carve se charge.
          c = mix(c, vec3(1.0), uCharge * 0.35);

          // Emission propre. Une monture peut etre une SOURCE : c'est ce qui
          // separe un plastique colore d'un objet qui brille.
          c += uEmit * (0.55 + 0.45 * pow(1.0 - abs(ndv), 2.0));

          float a = mix(0.42, 0.97, hub) * mix(0.35, 1.0, hole);
          // Un microsillon n'est pas translucide, un CD si.
          a = mix(a, max(a, hole), uOpaque);
          gl_FragColor = vec4(c, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new Mesh(this.round, this.mat);
    // --- LA MONTURE PASSE APRES L'AURA, ET C'EST UNE CORRECTION DE BUG.
    //
    //     L'aura est additive, blanche a coeur, et son panache est couche de
    //     quarante degres vers l'arriere : vu d'une camera de poursuite, une
    //     bonne moitie de ses langues passe DEVANT le disque. Rendue apres lui
    //     (renderOrder 40 contre 0), elle s'ajoutait par-dessus jusqu'a le
    //     saturer — au boost, la monture disparaissait, et le joueur l'a
    //     signale comme tel. La geometrie de l'aura a ete resserree pour ne
    //     plus border le disque, mais ca ne suffit pas : une langue qui passe
    //     devant passera toujours devant.
    //
    //     Le disque repasse donc en DERNIER. Il ne s'ajoute pas, il recouvre —
    //     ce qui est la seule lecture juste : une flamme nait autour d'un
    //     objet solide, elle ne le traverse pas. Le buddy, lui, garde l'ordre
    //     d'origine : que l'aura le baigne est exactement l'effet voulu.
    this.mesh.renderOrder = 60;
    this.group.add(this.mesh);

    // Halo de contact : la reference n'a AUCUNE ombre portee. Le contact au
    // sol se lit par un halo vert additif, pas par une ombre.
    this.haloMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uColor: { value: vec3('grassHorizon') },
        uGain: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main(){
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uGain;
        varying vec2 vUv;
        void main(){
          float d = length(vUv - 0.5) * 2.0;
          float a = pow(clamp(1.0 - d, 0.0, 1.0), 2.4);
          gl_FragColor = vec4(uColor * a * uGain, a * uGain * 0.9);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    // Pas de rotation figee : le halo s'aligne chaque frame sur la normale du
    // terrain (cf. Surfer.update). A plat sur une pente, il traverserait le sol.
    const halo = new Mesh(new PlaneGeometry(DISC_RADIUS * 4.4, DISC_RADIUS * 4.4), this.haloMat);
    halo.renderOrder = -50;
    this.halo = halo;
  }

  readonly halo: Mesh;
  /**
   * Echelle de la monture. Elle n'est pas cosmetique : elle DIT la statistique.
   * Le vinyle est plus grand parce qu'il est plus lourd et plus rapide, le
   * MiniDisc plus petit parce qu'il vole. Un joueur qui n'a pas lu l'ecran
   * d'equipement voit quand meme qu'il ne pilote pas la meme chose.
   */
  private mountScale = 1;

  /**
   * Applique une monture. `id` vient de core/Loadout.
   *
   * Six montures, deux formes. La table est explicite plutot que calculee :
   * chaque ligne est un OBJET reel qu'on reconnait, pas un point dans un espace
   * de parametres, et l'ecrire en clair est ce qui permet de verifier d'un coup
   * d'oeil qu'aucune ne ressemble a sa voisine.
   */
  setMount(id: string): void {
    const u = this.mat.uniforms;
    const p = MOUNT_LOOK[id] ?? MOUNT_LOOK.cd;
    u.uSilver.value = p.body;
    u.uIri.value = p.iri;
    u.uGroove.value = p.groove;
    u.uGrain.value = p.grain;
    u.uLabel.value = p.label;
    u.uLabelR.value = p.labelR;
    u.uShutter.value = p.shutter;
    u.uOpaque.value = p.opaque;
    u.uShape.value = p.square ? 1 : 0;
    u.uEmit.value = p.emit;
    this.mountScale = p.scale;
    this.mesh.scale.setScalar(this.mountScale);
    // La GEOMETRIE change aussi : c'est la silhouette qui distingue une
    // monture a distance de jeu, jamais sa texture.
    const want = p.square ? this.slab : this.round;
    if (this.mesh.geometry !== want) this.mesh.geometry = want;
  }



  update(time: number, charge: number, speedN: number, airT: number): void {
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uCharge.value = charge;
    // Le halo se resserre et s'eteint quand on decolle.
    const air = 1 - Math.min(1, airT * 1.4);
    this.haloMat.uniforms.uGain.value = (0.55 + speedN * 0.5 + charge * 0.6) * air;
    const s = 1 + speedN * 0.22 + charge * 0.18;
    this.halo.scale.setScalar(s * (0.6 + air * 0.4) * this.mountScale);
  }
}
