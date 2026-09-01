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
import { GLSL_SAFE, Rng } from '../core/Noise';
import { GLSL_DAY, dayUniforms } from './Daylight';
import { terrainGLSL, terrainUniforms } from './Terrain';

/**
 * Les eoliennes de l'horizon.
 *
 * L'element le plus litteralement Frutiger Aero qui soit : l'esthetique entiere
 * est batie sur l'imagerie de la technologie propre du milieu des annees 2000,
 * et l'eolienne blanche sur ciel bleu en est l'embleme, au meme titre que la
 * goutte d'eau et le brin d'herbe.
 *
 * Elles vivent LOIN — a plusieurs centaines de metres, devant la ville. C'est
 * une decision de mise en scene : posees pres du joueur, elles deviendraient
 * des obstacles visuels qui balaient l'ecran, et il faudrait gerer leur
 * collision. Au loin, elles ne font que ce qu'on leur demande — donner une
 * ECHELLE au paysage et un mouvement lent qui contredit la vitesse du premier
 * plan.
 *
 * Ce contraste est tout leur interet : a 150 km/h, une chose qui tourne
 * lentement au fond du cadre rend la course plus rapide, pas moins.
 */

const COUNT = 14;
/** Distance devant le joueur. Devant la ville, derriere le relief jouable. */
const FAR = 620;
const SPREAD = 900;

/**
 * Mat + nacelle + trois pales. Les pales portent `aBlade` = 1 et leur angle
 * propre, pour que le vertex shader puisse les faire tourner sans que le mat
 * ne suive.
 */
function buildGeometry(): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const blade: number[] = [];
  const along: number[] = [];

  const push = (x: number, y: number, z: number, b: number, a: number): number => {
    pos.push(x, y, z);
    blade.push(b);
    along.push(a);
    return pos.length / 3 - 1;
  };

  // --- Mat : tronc de cone effile, sept faces suffisent a cette distance.
  const H = 46;
  const SEG = 4;
  const SIDES = 7;
  const rows: number[][] = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    const r = 1.55 * (1 - t * 0.55);
    const row: number[] = [];
    for (let j = 0; j < SIDES; j++) {
      const a = (j / SIDES) * Math.PI * 2;
      row.push(push(Math.cos(a) * r, t * H, Math.sin(a) * r, 0, t));
    }
    rows.push(row);
  }
  for (let i = 0; i < SEG; i++) {
    for (let j = 0; j < SIDES; j++) {
      const k = (j + 1) % SIDES;
      idx.push(rows[i][j], rows[i][k], rows[i + 1][j]);
      idx.push(rows[i][k], rows[i + 1][k], rows[i + 1][j]);
    }
  }

  // --- Nacelle : une simple boite allongee au sommet.
  const nz = 2.6;
  const ny = 1.5;
  const n: number[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
    n.push(push(sx * 1.4, H + sy * ny * 0.5 + 0.4, sz * nz, 0, 1));
  }
  const box = [
    [0,1,3,2],[4,6,7,5],[0,4,5,1],[2,3,7,6],[0,2,6,4],[1,5,7,3],
  ];
  for (const f of box) {
    idx.push(n[f[0]], n[f[1]], n[f[2]]);
    idx.push(n[f[0]], n[f[2]], n[f[3]]);
  }

  // --- Trois pales, dans le plan XY, tournant autour de Z. Chacune est un
  //     triangle effile : a cette distance, une pale profilee ne se distingue
  //     pas d'une pale plate, et coute trois fois plus cher.
  const HUB = new Vector3(0, H + 0.4, nz + 0.4);
  for (let b = 0; b < 3; b++) {
    const a0 = (b / 3) * Math.PI * 2;
    const L = 21;
    const root = 0.9;
    const c = Math.cos(a0);
    const s = Math.sin(a0);
    // Perpendiculaire, pour donner sa largeur au pied de la pale.
    const px = -s * root;
    const py = c * root;
    const t0 = push(HUB.x + px, HUB.y + py, HUB.z, 1, 0);
    const t1 = push(HUB.x - px, HUB.y - py, HUB.z, 1, 0);
    const t2 = push(HUB.x + c * L, HUB.y + s * L, HUB.z, 1, 1);
    idx.push(t0, t1, t2);
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aBlade', new BufferAttribute(new Float32Array(blade), 1));
  g.setAttribute('aAlong', new BufferAttribute(new Float32Array(along), 1));
  g.setIndex(idx);
  return g;
}

export class Turbines {
  readonly mesh: InstancedMesh;
  readonly mat: ShaderMaterial;
  private m = new Matrix4();

  constructor(count = COUNT) {
    const rng = new Rng(9931);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) seed[i] = rng.next();

    this.mat = new ShaderMaterial({
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
      uniforms: {
        // Le relief est pilote par uniformes : changer de monde ne recompile
        // aucun shader (cf. Terrain.terrainGLSL).
        ...terrainUniforms(),
        uTime: { value: 0 },
        uOrigin: { value: new Vector3() },
        uBody: { value: [0.97, 0.99, 1.0] },
        /** Presence, 0..1. Un monde sans eoliennes les met a zero. */
        uDensity: { value: 1 },
        ...dayUniforms(),
      },
      vertexShader: /* glsl */ `
${GLSL_SAFE}
        attribute float aBlade, aAlong;
        attribute float iSeed;
        uniform float uTime;
        uniform vec3 uOrigin;
        varying float vBlade, vAlong, vFade;

        ${terrainGLSL()}

        void main(){
          vBlade = aBlade; vAlong = aAlong;
          vec3 p = position;

          // --- Rotation des pales, autour du moyeu et dans le plan XY.
          //
          //     La vitesse et la PHASE different par instance. Sans decalage de
          //     phase, quatorze eoliennes tournent au meme instant dans la meme
          //     position, ce qui ne s'observe jamais dans la nature et se
          //     remarque immediatement : le paysage se met a battre.
          if (aBlade > 0.5) {
            float hubY = 46.4;
            float speed = 0.42 + iSeed * 0.26;
            float ang = uTime * speed + iSeed * 6.283;
            float ca = cos(ang), sa = sin(ang);
            vec2 rel = vec2(p.x, p.y - hubY);
            p.x = rel.x * ca - rel.y * sa;
            p.y = rel.x * sa + rel.y * ca + hubY;
          }

          // Position monde : loin devant, etalees lateralement, ancrees au sol.
          vec3 off = vec3(instanceMatrix[3][0], 0.0, instanceMatrix[3][2]);
          vec2 wp = vec2(uOrigin.x * 0.15 + off.x, uOrigin.z + off.z);
          float gh = terrainHeightAt(wp, 400.0);
          vec3 world = vec3(wp.x, gh - 2.0, wp.y) + p * (0.85 + iSeed * 0.35);

          // Elles se FONDENT dans l'horizon plutot que de s'y decouper : une
          // silhouette nette a six cents metres trahit le manque d'atmosphere.
          float d = length(world.xz - uOrigin.xz);
          vFade = 1.0 - smoothstep(420.0, 1150.0, d);

          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
${GLSL_SAFE}
        uniform vec3 uBody;
        uniform float uDensity;
${GLSL_DAY}
        varying float vBlade, vAlong, vFade;

        void main(){
          if (vFade * uDensity < 0.01) discard;
          // La pale s'affine vers la pointe, donc elle y devient translucide.
          float a = vFade * (vBlade > 0.5 ? 0.86 - vAlong * 0.30 : 0.92);
          vec3 c = daylight(uBody, 0.18 + uDayNight * 0.35);
          gl_FragColor = vec4(c, a * 0.88 * uDensity);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new InstancedMesh(buildGeometry(), this.mat, count);
    this.mesh.frustumCulled = false;
    // Devant la ville, derriere tout le reste du decor.
    this.mesh.renderOrder = -900;

    for (let i = 0; i < count; i++) {
      this.m.identity();
      const t = (i + 0.5) / count;
      const x = (t - 0.5) * SPREAD + (rng.next() - 0.5) * 60;
      const z = -FAR - rng.next() * 260;
      this.m.setPosition(x, 0, z);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.geometry.setAttribute('iSeed', new InstancedBufferAttribute(seed, 1));
  }

  update(origin: Vector3, time: number): void {
    this.mat.uniforms.uOrigin.value.copy(origin);
    this.mat.uniforms.uTime.value = time;
  }
}
