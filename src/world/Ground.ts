import { BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector3 } from 'three';
import { GLSL_NOISE } from '../core/Noise';
import { vec3 } from '../core/Palette';
import { SUN_DIR } from './Sky';
import { terrainGLSL } from './Terrain';

/**
 * La plaine, desormais vallonnee.
 *
 * Grille en EVENTAIL ancree sur le joueur : les rangees sont serrees devant lui
 * (1.2 m) puis s'ecartent geometriquement jusqu'a l'horizon, et leur largeur
 * croit avec la distance pour couvrir le champ de vision quel que soit le
 * rapport d'ecran. On concentre les sommets la ou ils comptent au lieu d'etaler
 * une grille reguliere sur des kilometres.
 *
 * La grille ne suit le joueur QUE en Z, et par pas entiers de la maille : sinon
 * les sommets glissent le long des pentes et le relief scintille. En X elle
 * reste fixe — le couloir de jeu fait +/-14 m, la grille est bien plus large.
 *
 * Les stries radiales, le gradient de valeur et le sheen du doc 01 sont
 * conserves tels quels ; seule la normale devient reelle, ce qui allume les
 * versants et rend les cretes LISIBLES — sans quoi on ne peut pas timer un saut.
 */

const SNAP = 1.2;
const Z_START = 45;
const Z_END = -2600;

function buildRows(near: number, growth: number): number[] {
  const rows: number[] = [];
  let z = Z_START;
  let step = near;
  while (z > Z_END) {
    rows.push(z);
    z -= step;
    if (z < -120) step = Math.min(step * growth, 70);
  }
  rows.push(Z_END);
  return rows;
}

function buildGeometry(dense: boolean): BufferGeometry {
  const rows = buildRows(dense ? SNAP : SNAP * 1.9, dense ? 1.045 : 1.07);
  const cols = dense ? 128 : 76;
  const R = rows.length;

  const pos = new Float32Array(R * cols * 3);
  const idx: number[] = [];

  for (let i = 0; i < R; i++) {
    const z = rows[i];
    // Largeur qui s'ouvre avec la distance : couvre aussi le 16:9 large.
    const half = 80 + 1.35 * (Z_START - z);
    for (let j = 0; j < cols; j++) {
      const t = j / (cols - 1);
      const o = (i * cols + j) * 3;
      pos[o] = (t - 0.5) * 2 * half;
      pos[o + 1] = 0;
      pos[o + 2] = z;
    }
  }
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // Enroulement anti-horaire vu du dessus. L'ordre naif (a, c, b) donne
      // des faces tournees vers le BAS : la grille entiere disparait au
      // back-face culling et on voit le ciel a travers le sol.
      idx.push(a, b, c, b, d, c);
    }
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class Ground {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;

  constructor(dense = true) {
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
        uOrigin: { value: new Vector3() },
        uTime: { value: 0 },
        uSpeed: { value: 0 },
      },
      vertexShader: /* glsl */ `
        uniform vec3 uOrigin;
        varying vec3 vWorld;
        varying vec3 vNormal;

        ${terrainGLSL()}

        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float d = length(wp.xz - uOrigin.xz);
          wp.y = terrainHeightAt(wp.xz, d);
          vWorld = wp.xyz;
          vNormal = terrainNormalAt(wp.xz, d);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vWorld;
        varying vec3 vNormal;
        uniform vec3 uNear, uMid, uFar, uHorizon, uShadow, uStreak, uSun, uCam;
        uniform float uTime, uSpeed;

        ${GLSL_NOISE}

        void main(){
          // Coordonnees de texture repliees modulo la periode du bruit : la
          // position monde croit sans borne et finirait par perdre en precision.
          vec2 p = vec2(vWorld.x, mod(vWorld.z, 1000.0));
          float dist = length(vWorld.xz - uCam.xz);
          vec3 N = normalize(vNormal);

          // --- Profondeur normalisee : asymptotique, jamais de coupure franche
          float f = 1.0 - exp(-dist / 95.0);

          // --- Stries radiales : bruit ecrase ~70x le long de Z
          float sway = sin(p.y * 0.006 + uTime * 0.18) * 3.5;
          float s1 = fbm(vec2((p.x + sway) * 0.85, p.y * 0.012));
          float s2 = fbm(vec2((p.x - sway * 0.6) * 3.1, p.y * 0.030));
          float streak = s1 * 0.68 + s2 * 0.32;
          streak = mix(0.5, streak, 1.15 + uSpeed * 0.55);
          streak = clamp(streak, 0.0, 1.0);

          // --- Gradient de valeur : CLAIR au loin, SOMBRE au premier plan
          vec3 c = mix(uNear, uMid, smoothstep(0.00, 0.34, f));
          c = mix(c, uFar, smoothstep(0.30, 0.66, f));
          c = mix(c, uHorizon, smoothstep(0.48, 0.94, f));

          c = mix(mix(c, uShadow, 0.30), mix(c, uStreak, 0.55), streak);

          // --- Micro-detail de brins, uniquement dans le champ proche
          float near = 1.0 - smoothstep(0.0, 0.42, f);
          float blade = fbm(vec2(p.x * 2.2, p.y * 2.2));
          c = mix(c, mix(c, uStreak, 0.30), blade * near * 0.30);
          c *= 1.0 - near * 0.14 * fbm(vec2(p.x * 0.9, p.y * 0.9));

          // --- Bandes de defilement : la lecture de vitesse
          float band = sin(p.y * 0.201) * 0.5 + 0.5;
          c = mix(c, c * 1.16, band * (0.030 + uSpeed * 0.045) * (1.0 - f * 0.55));

          // --- Relief. Sans ces deux termes on ne voit pas ou est le sommet,
          //     donc on ne peut pas le timer : c'est de la lisibilite de jeu,
          //     pas de la decoration.
          vec3 L = normalize(uSun);
          float ndl = dot(N, L);

          // 1. Versants FACE A LA CAMERA plus clairs que les versants de dos.
          //    C'est le terme le plus lisible sur un relief doux : il dessine
          //    le flanc proche de chaque colline. Ancre en espace monde, donc
          //    il ne pulse pas quand le joueur monte ou descend — un tint
          //    d'altitude relatif au joueur ferait respirer tout le paysage.
          c *= 0.86 + 0.26 * clamp(N.z, -1.0, 1.0);

          // 2. Teinte d'altitude absolue, discrete : hauts plus clairs.
          c = mix(c * 0.90, c * 1.08, smoothstep(-7.0, 7.0, vWorld.y));

          // 3. Ombrage directionnel, franc.
          c *= 0.70 + 0.30 * smoothstep(-0.30, 0.90, ndl);
          // Les versants exposes accrochent un lisere clair sur la crete.
          c += uHorizon * 0.16 * smoothstep(0.50, 1.0, ndl) * (1.0 - f * 0.6);

          // --- Sheen laque : il allume la bande d'horizon
          vec3 V = normalize(uCam - vWorld);
          float graze = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.5);
          c += vec3(0.07, 0.22, 0.15) * graze * 0.50;

          vec3 H = normalize(V + L);
          c += vec3(0.20, 0.27, 0.22) * pow(max(dot(N, H), 0.0), 46.0) * 0.48;

          // Contact net avec le ciel.
          c = mix(c, uHorizon, smoothstep(0.93, 1.0, f));

          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new Mesh(buildGeometry(dense), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -900;
  }

  update(camPos: Vector3, origin: Vector3, time: number, speedN: number): void {
    const u = this.mat.uniforms;
    u.uCam.value.copy(camPos);
    u.uOrigin.value.copy(origin);
    u.uTime.value = time;
    u.uSpeed.value = speedN;
    // Ancrage par pas entiers de maille : un suivi continu ferait glisser les
    // sommets le long des pentes et scintiller tout le relief.
    this.mesh.position.z = Math.round(origin.z / SNAP) * SNAP;
  }
}
