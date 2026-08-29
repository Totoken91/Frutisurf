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
import { GLSL_NOISE } from '../core/Noise';
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
export const DISC_RADIUS = 1.55;
const HOLE = 0.19;
const THICK = 0.035;

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
      },
      vertexShader: /* glsl */ `
        varying vec3 vN, vV, vLocal;
        void main(){
          vLocal = position;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vN = normalize(mat3(modelMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime, uRadius, uHole, uCharge;
        uniform vec3 uSilver, uSkyMid, uSkyHor, uGrassNear, uGrassHor;
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

          // Sillons concentriques : ils modulent la nettete du reflet.
          float grooves = sin(r * 780.0) * 0.5 + 0.5;

          // Diffraction : 1.6 cycle azimutal donne de larges arcs de CD ; 3 cycles
          // faisaient un anneau de fete foraine.
          // Le terme en ndv est ce qui fait glisser l'arc-en-ciel
          // quand la camera bouge — sans lui, l'iris serait peint sur le disque.
          float hue = fract(ang / TAU * 1.6 + ndv * 1.7 + rn * 0.55 + uTime * 0.05);
          vec3 iri = hue2rgb(hue);

          // Zone donnees vs moyeu plastique transparent.
          float hub = smoothstep(0.10, 0.20, rn);

          // Base sombre : un CD n'est brillant que la ou il diffracte. Une
          // base pale noierait l'arc-en-ciel dans du blanc.
          vec3 base = env * 0.42 + uSilver * 0.16;
          vec3 rainbow = iri * (0.45 + 0.95 * grooves) * hub;
          vec3 c = base + rainbow * (0.75 + 0.75 * (1.0 - ndv));

          // Eclat speculaire franc : le point blanc qui vend le disque optique.
          c += vec3(1.0) * pow(1.0 - abs(ndv), 7.0) * 0.55;

          // Moyeu plastique clair, comme sur un vrai disque.
          c = mix(uSilver * 0.9, c, hub);

          // Le disque blanchit quand le carve se charge.
          c = mix(c, vec3(1.0), uCharge * 0.35);

          float a = mix(0.55, 0.96, hub);
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
    const halo = new Mesh(new PlaneGeometry(DISC_RADIUS * 4.4, DISC_RADIUS * 4.4), this.haloMat);
    halo.rotation.x = -Math.PI / 2;
    halo.renderOrder = -50;
    this.halo = halo;
  }

  readonly halo: Mesh;

  update(time: number, charge: number, speedN: number, airT: number): void {
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uCharge.value = charge;
    // Le halo se resserre et s'eteint quand on decolle.
    const air = 1 - Math.min(1, airT * 1.4);
    this.haloMat.uniforms.uGain.value = (0.55 + speedN * 0.5 + charge * 0.6) * air;
    const s = 1 + speedN * 0.22 + charge * 0.18;
    this.halo.scale.setScalar(s * (0.6 + air * 0.4));
  }
}
