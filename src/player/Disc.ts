import {
  AdditiveBlending,
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

export class Disc {
  readonly group = new Group();
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
        uniform float uIri, uGroove, uGrain, uLabelR, uShutter, uOpaque;
        uniform vec3 uSilver, uSkyMid, uSkyHor, uGrassNear, uGrassHor, uLabel;
        varying vec3 vN, vV, vLocal;

        ${GLSL_NOISE}

        const float TAU = 6.28318530718;

        void main(){
          vec3 N = normalize(vN);
          vec3 V = normalize(vV);
          if (!gl_FrontFacing) N = -N;
          float ndv = clamp(dot(N, V), 0.0, 1.0);

          float r = length(vLocal.xz);
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

          // Anneau de moyeu clair et trou central sombre.
          c = mix(uSilver * 1.28, c, hub);
          float hole = smoothstep(0.0, 0.03, rn);
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
          float shut = uShutter
            * smoothstep(0.34, 0.25, abs(vLocal.z))
            * smoothstep(0.10, 0.26, vLocal.x);
          c = mix(c, vec3(0.88, 0.94, 0.99) * (0.62 + ndv * 0.7), shut);

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

          float a = mix(0.42, 0.97, hub) * mix(0.35, 1.0, hole);
          // Un microsillon n'est pas translucide, un CD si.
          a = mix(a, max(a, hole), uOpaque);
          gl_FragColor = vec4(c, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new Mesh(discGeometry(), this.mat);
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

  /** Applique une monture. `id` vient de core/Loadout. */
  setMount(id: string): void {
    const u = this.mat.uniforms;
    if (id === 'vinyle') {
      u.uSilver.value = [0.20, 0.22, 0.26];
      u.uIri.value = 0.10;
      u.uGroove.value = 210;
      u.uGrain.value = 0.55;
      u.uLabel.value = [0.95, 0.58, 0.10];
      u.uLabelR.value = 0.34;
      u.uShutter.value = 0;
      u.uOpaque.value = 1;
      this.mountScale = 1.15;
    } else if (id === 'minidisc') {
      // Plus BLEU que blanc, et volontairement : sous GIVRE, un plastique
      // pale se confondait avec le buddy et la monture disparaissait.
      u.uSilver.value = [0.42, 0.70, 0.94];
      u.uIri.value = 0.30;
      u.uGroove.value = 900;
      u.uGrain.value = 0.10;
      u.uLabel.value = [0.08, 0.34, 0.58];
      u.uLabelR.value = 0.22;
      u.uShutter.value = 1;
      u.uOpaque.value = 0.9;
      this.mountScale = 0.82;
    } else {
      u.uSilver.value = vec3('discSilver');
      u.uIri.value = 1;
      u.uGroove.value = 620;
      u.uGrain.value = 0;
      u.uLabelR.value = 0;
      u.uShutter.value = 0;
      u.uOpaque.value = 0;
      this.mountScale = 1;
    }
    this.mesh.scale.setScalar(this.mountScale);
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
