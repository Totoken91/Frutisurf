import { Mesh, PlaneGeometry, ShaderMaterial, Vector2, Vector3 } from 'three';
import { GLSL_NOISE } from '../core/Noise';
import { vec3 } from '../core/Palette';
import { SUN_DIR } from './Sky';

/**
 * La plaine. Aucune geometrie : tout est dans le fragment shader.
 *
 * Les deux points non negociables (docs/00 §4) :
 *  1. le sol est PLUS CLAIR a l'horizon qu'au premier plan ;
 *  2. les stries convergent au point de fuite — obtenu en etirant le bruit
 *     d'un facteur ~70 le long de Z : des rayures paralleles a l'axe de
 *     deplacement convergent naturellement en perspective.
 *
 * Les frequences en Z sont toutes des multiples entiers de 1/1000 pour que
 * le repli du scroll (modulo 1000) soit invisible.
 */
export const GROUND_WRAP = 1000;

export class Ground {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;

  constructor() {
    this.mat = new ShaderMaterial({
      fog: false,
      uniforms: {
        uNear: { value: vec3('grassNear') },
        uMid: { value: vec3('grassMid') },
        uFar: { value: vec3('grassFar') },
        uHorizon: { value: vec3('grassHorizon') },
        uShadow: { value: vec3('grassShadow') },
        uStreak: { value: vec3('grassStreak') },
        uSun: { value: SUN_DIR.clone() },
        uCam: { value: new Vector3() },
        uScroll: { value: new Vector2() },
        uTime: { value: 0 },
        uSpeed: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorld;
        uniform vec3 uNear, uMid, uFar, uHorizon, uShadow, uStreak, uSun, uCam;
        uniform vec2 uScroll;
        uniform float uTime, uSpeed;

        ${GLSL_NOISE}

        void main(){
          vec2 p = vWorld.xz + uScroll;
          float dist = length(vWorld.xz - uCam.xz);

          // --- Profondeur normalisee : asymptotique, jamais de coupure franche
          float f = 1.0 - exp(-dist / 150.0);

          // --- Stries radiales : bruit ecrase ~70x le long de Z
          //     Une derive laterale lente en fonction de Z fait "respirer" le champ.
          float sway = sin(p.y * 0.006 + uTime * 0.18) * 3.5;
          float s1 = fbm(vec2((p.x + sway) * 0.85, p.y * 0.012));
          float s2 = fbm(vec2((p.x - sway * 0.6) * 3.1, p.y * 0.030));
          float streak = s1 * 0.68 + s2 * 0.32;
          // Le contraste des stries monte avec la vitesse : on lit mieux la glisse.
          streak = mix(0.5, streak, 1.15 + uSpeed * 0.55);
          streak = clamp(streak, 0.0, 1.0);

          // --- Gradient de valeur : CLAIR au loin, SOMBRE au premier plan
          vec3 c = mix(uNear, uMid, smoothstep(0.00, 0.34, f));
          c = mix(c, uFar, smoothstep(0.30, 0.66, f));
          c = mix(c, uHorizon, smoothstep(0.62, 0.97, f));

          // Les stries teintent sans repeindre : on reste dans la famille verte.
          c = mix(mix(c, uShadow, 0.30), mix(c, uStreak, 0.55), streak);

          // --- Micro-detail de brins, uniquement dans le champ proche
          float near = 1.0 - smoothstep(0.0, 0.42, f);
          float blade = fbm(vec2(p.x * 2.2, p.y * 2.2));
          c = mix(c, mix(c, uStreak, 0.34), blade * near * 0.50);
          c *= 1.0 - near * 0.10 * fbm(vec2(p.x * 0.9, p.y * 0.9));

          // --- Bandes de defilement : la lecture de vitesse. Alpha faible,
          //     sinon l'effet tapis roulant tue l'illusion de plaine.
          float band = sin(p.y * 0.201) * 0.5 + 0.5;
          c = mix(c, c * 1.16, band * (0.030 + uSpeed * 0.045) * (1.0 - f * 0.55));

          // --- Sheen laque : c'est lui qui allume la bande d'horizon
          vec3 V = normalize(uCam - vWorld);
          float graze = pow(1.0 - clamp(V.y, 0.0, 1.0), 4.5);
          c += vec3(0.10, 0.30, 0.20) * graze * 0.55;

          // Lobe speculaire large, blanc : la plaine reagit comme une surface vernie.
          vec3 H = normalize(V + normalize(uSun));
          c += vec3(0.26, 0.34, 0.28) * pow(max(H.y, 0.0), 46.0) * 0.55;

          // Contact net avec le ciel, sans lisere detache.
          c = mix(c, uHorizon, smoothstep(0.93, 1.0, f));

          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new Mesh(new PlaneGeometry(6000, 6000, 2, 2), this.mat);
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -900;
  }

  update(camPos: Vector3, scrollX: number, scrollZ: number, time: number, speedN: number): void {
    const u = this.mat.uniforms;
    u.uCam.value.copy(camPos);
    // Repli modulo la periode du bruit : evite la derive de precision float32.
    u.uScroll.value.set(scrollX, ((scrollZ % GROUND_WRAP) + GROUND_WRAP) % GROUND_WRAP);
    u.uTime.value = time;
    u.uSpeed.value = speedN;
  }
}
