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
import { vec3 } from '../core/Palette';
import { GLSL_DAY, dayUniforms } from './Daylight';
import { SUN_DIR } from './Sky';
import { shoreGLSL, terrainGLSL, terrainUniforms } from './Terrain';
import { WEATHER_GLSL } from './Weather';

/**
 * Les palmiers de la greve.
 *
 * Le point critique n'est pas leur forme, c'est leur PLACEMENT. Ils doivent
 * pousser exactement la ou le sol dessine du sable — pas a peu pres. Un palmier
 * planté au milieu de l'herbe, ou pire, les pieds dans l'eau, dit immediatement
 * que deux couches du jeu ne se parlent pas.
 *
 * Or le masque de plage vit dans le shader du sol, en GLSL, et il est fait de
 * bruits fractals que la version TypeScript de `fbm2D` ne reproduit PAS a
 * l'identique — ce sont deux implementations differentes. Placer les palmiers
 * depuis le CPU, meme avec le meme algorithme apparent, donnerait une derive.
 *
 * Ils sont donc places DANS LE VERTEX SHADER, avec le meme chunk de bruit, les
 * memes frequences et les memes constantes que `Ground.ts`. Un palmier hors
 * greve est replie sur un point degenere : il ne coute alors plus rien, et il
 * ne peut structurellement pas apparaitre au mauvais endroit.
 *
 * C'est la meme discipline que pour les touffes d'herbe, et pour la meme
 * raison : une seule source de verite par grandeur.
 */

const GRID = 9;
const CELL = 26;
const COUNT = GRID * GRID;

/**
 * Un palmier : tronc en tronc de cone incline, et sept palmes.
 *
 * Chaque palme est un losange TRES allonge, plie vers le bas en son milieu.
 * Le pli est ce qui fait la palme : un quad plat lit comme une pale de
 * ventilateur, quel que soit le soin mis a la texture.
 */
function buildGeometry(): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  /** part: 0 = tronc, 1 = palme. u : le long de la palme, pour l'agitation. */
  const part: number[] = [];
  const uu: number[] = [];

  const push = (x: number, y: number, z: number, p: number, u: number): number => {
    pos.push(x, y, z);
    part.push(p);
    uu.push(u);
    return pos.length / 3 - 1;
  };

  // --- Tronc. Six segments, courbe legere : un palmier parfaitement droit est
  //     un poteau. La courbure vient toujours du vent dominant, donc toujours
  //     dans le meme sens — c'est ce qui rend une palmeraie coherente.
  const SEG = 6;
  const H = 7.2;
  const ring: number[][] = [];
  for (let i = 0; i <= SEG; i++) {
    const t = i / SEG;
    const y = t * H;
    const lean = t * t * 1.15;
    const r = 0.30 * (1 - t * 0.62);
    const row: number[] = [];
    for (let j = 0; j < 5; j++) {
      const a = (j / 5) * Math.PI * 2;
      row.push(push(Math.cos(a) * r + lean, y, Math.sin(a) * r, 0, t));
    }
    ring.push(row);
  }
  for (let i = 0; i < SEG; i++) {
    for (let j = 0; j < 5; j++) {
      const k = (j + 1) % 5;
      idx.push(ring[i][j], ring[i][k], ring[i + 1][j]);
      idx.push(ring[i][k], ring[i + 1][k], ring[i + 1][j]);
    }
  }

  // --- Palmes. Sept, en couronne, chacune pliee vers le bas.
  const FRONDS = 7;
  const topX = 1.15;
  for (let f = 0; f < FRONDS; f++) {
    const a = (f / FRONDS) * Math.PI * 2 + 0.3;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const LEN = 3.5;
    const STEPS = 4;
    let prevL = -1;
    let prevR = -1;
    for (let s = 0; s <= STEPS; s++) {
      const t = s / STEPS;
      // Le pli : la palme part vers le haut puis retombe. Une parabole suffit.
      const droop = 0.55 - Math.pow(t * 2 - 0.55, 2) * 0.62;
      const w = Math.sin(t * Math.PI) * 0.42 * (1 - t * 0.45);
      const cx = topX + dx * LEN * t;
      const cy = H + droop;
      const cz = dz * LEN * t;
      const px = -dz * w;
      const pz = dx * w;
      const l = push(cx + px, cy, cz + pz, 1, t);
      const r = push(cx - px, cy, cz - pz, 1, t);
      if (s > 0) {
        idx.push(prevL, prevR, l);
        idx.push(prevR, r, l);
      }
      prevL = l;
      prevR = r;
    }
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aPart', new BufferAttribute(new Float32Array(part), 1));
  g.setAttribute('aU', new BufferAttribute(new Float32Array(uu), 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export class Palms {
  readonly mesh: InstancedMesh;
  readonly mat: ShaderMaterial;
  private m = new Matrix4();

  constructor() {
    const rng = new Rng(60421);
    const seed = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) seed[i] = rng.next();

    this.mat = new ShaderMaterial({
      side: DoubleSide,
      uniforms: {
        // Le relief est pilote par uniformes : changer de monde ne recompile
        // aucun shader (cf. Terrain.terrainGLSL).
        ...terrainUniforms(),
        uTime: { value: 0 },
        uOrigin: { value: new Vector3() },
        uSun: { value: SUN_DIR.clone() },
        uTrunk: { value: vec3('warmAccent') },
        uFrond: { value: vec3('grassNear') },
        uFrondTip: { value: vec3('grassFar') },
        /** Presence, 0..1. Elle DECIME le semis au lieu de le rendre pale :
            un palmier a moitie transparent est un bug, un bosquet plus clair
            est un paysage. */
        uDensity: { value: 1 },
        ...dayUniforms(),
      },
      vertexShader: /* glsl */ `
${GLSL_SAFE}
${GLSL_NOISE}
        attribute float aPart, aU;
        attribute float iSeed;
        uniform float uTime;
        uniform float uDensity;
        uniform vec3 uOrigin;
        varying float vPart, vU, vShade, vSeed;

        ${terrainGLSL()}
${shoreGLSL()}
        ${WEATHER_GLSL}

        void main(){
          vPart = aPart; vU = aU; vSeed = iSeed;

          // Cellule monde : le semis suit le joueur sans jamais glisser, comme
          // pour les touffes. Le modulo est calcule sur la position ANCRee,
          // pas sur l'instance, sinon les palmiers derivent avec la camera.
          vec2 base = vec2(
            floor(uOrigin.x / ${CELL}.0 + instanceMatrix[3][0]) * ${CELL}.0,
            floor(uOrigin.z / ${CELL}.0 + instanceMatrix[3][2]) * ${CELL}.0);
          float h1 = hash21(base * 0.031);
          float h2 = hash21(base * 0.017 + 7.3);
          vec2 wp = base + vec2(h1, h2) * ${CELL}.0 * 0.8;

          float gh = terrainHeightAt(wp, 0.0);
          float above = gh - WATER_LEVEL;

          // --- LE MEME masque de plage que Ground.ts. Memes frequences, memes
          //     constantes. Toute divergence ici planterait des palmiers dans
          //     l'herbe ou dans l'eau.
          float sand = shoreMask(wp, above);

          // On ne garde que le HAUT de plage : un palmier les pieds dans l'eau
          // est un cliche de carte postale, mais pas une plante.
          // Le seuil de tirage MONTE quand la densite baisse : le semis se
          // vide de ses individus les moins bien places, il ne palit pas.
          float ok = sand * smoothstep(0.15, 1.1, above)
                   * step(mix(1.2, 0.42, uDensity), h2);

          if (ok < 0.35) {
            // Hors greve : on replie l'instance sur un point degenere. Elle ne
            // coute alors plus un seul fragment.
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }

          float scale = 0.82 + h1 * 0.42;
          vec3 p = position * scale;

          // --- La RAFALE. Le tronc plie a peine, les palmes beaucoup, et la
          //     pointe plus que la base. C'est ce DEGRADE le long de la palme
          //     qui rend le vent credible : une palme rigide qui pivote lit
          //     comme un essuie-glace.
          float gust = gustAt(wp, uTime);
          float sway = sin(uTime * 1.15 + iSeed * 31.0) * 0.5 + 0.5;
          float amp = (0.25 + gust * 0.75) * (0.4 + sway * 0.6);
          float bend = aPart > 0.5 ? aU * aU * 0.85 : aU * aU * 0.16;
          p.x += bend * amp * 1.25;
          p.z += bend * amp * 0.5;
          p.y -= bend * amp * 0.30;

          vec3 world = vec3(wp.x, gh, wp.y) + p;

          // Ombrage vertical simple : le pied est a l'ombre, la couronne au
          // soleil. Suffisant sur une silhouette, et gratuit.
          vShade = 1.0 - clamp(p.y / 7.5, 0.0, 1.0);

          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
${GLSL_SAFE}
        uniform vec3 uTrunk, uFrond, uFrondTip, uSun;
${GLSL_DAY}
        varying float vPart, vU, vShade, vSeed;

        void main(){
          vec3 c;
          if (vPart > 0.5) {
            // La palme s'eclaircit vers la pointe : elle y est plus fine, donc
            // plus traversee par la lumiere.
            c = mix(uFrond, uFrondTip, vU * 0.85 + vSeed * 0.15);
            c *= 0.86 + vU * 0.28;
          } else {
            c = uTrunk * (0.78 + vShade * 0.34);
          }
          c = daylight(c, vShade * 0.42 + uDayNight * 0.28);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new InstancedMesh(buildGeometry(), this.mat, COUNT);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -840;

    // La matrice d'instance ne porte QUE l'indice de cellule : tout le reste du
    // placement est calcule dans le shader, pour rester d'accord avec le sol.
    const half = (GRID - 1) / 2;
    let i = 0;
    for (let gz = 0; gz < GRID; gz++) {
      for (let gx = 0; gx < GRID; gx++) {
        this.m.identity();
        this.m.setPosition(gx - half, 0, gz - half - GRID * 0.32);
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
