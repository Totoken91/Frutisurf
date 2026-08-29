import {
  Color,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { Rng } from '../core/Noise';
import { vec3 } from '../core/Palette';
import { makeFishGeometry } from './FishGeometry';
import { SUN_DIR } from './Sky';

/**
 * Le banc de poissons volants — le marqueur signature du Frutiger Aero.
 * Regle tiree de la reference : ils sont DESYNCHRONISES en taille, profondeur
 * et cap. Un banc aligne ferait motif, pas ecosysteme.
 */
const SPECIES: ReadonlyArray<{ a: number; b: number; scale: [number, number] }> = [
  { a: 0x7b62cf, b: 0xd9b8e8, scale: [2.6, 5.0] }, // ange violet raye
  { a: 0xc46a2e, b: 0xf0c078, scale: [2.2, 4.2] }, // allonge brun-orange (accent chaud)
  { a: 0x5b4aa8, b: 0xa48fe0, scale: [4.5, 9.0] }, // grande raie / poisson-lune
  { a: 0x4f93c4, b: 0xa8d8ee, scale: [3.4, 6.5] }, // baleine bleu-gris
  { a: 0x2f3d70, b: 0x7488c8, scale: [1.6, 3.0] }, // petit sombre, echelle atmospherique
];

interface Fish {
  pos: Vector3;
  yaw: number;
  bobPhase: number;
  bobAmp: number;
  speed: number;
  scale: number;
}

export class FishSchool {
  readonly mesh: InstancedMesh;
  private fish: Fish[] = [];
  private mat: ShaderMaterial;
  private m = new Matrix4();
  private q = new Quaternion();
  private up = new Vector3(0, 1, 0);
  private scaleV = new Vector3();
  private rng = new Rng(9182);
  private readonly range = 900;

  constructor(count = 26) {
    const geo = makeFishGeometry();

    const phase = new Float32Array(count);
    const swim = new Float32Array(count);
    const cA = new Float32Array(count * 3);
    const cB = new Float32Array(count * 3);
    const stripe = new Float32Array(count);

    const tmp = new Color();
    for (let i = 0; i < count; i++) {
      const sp = SPECIES[i % SPECIES.length];
      phase[i] = this.rng.range(0, Math.PI * 2);
      swim[i] = this.rng.range(2.2, 4.6);
      stripe[i] = this.rng.next() < 0.45 ? this.rng.range(3, 7) : 0;
      tmp.setHex(sp.a);
      cA.set([tmp.r, tmp.g, tmp.b], i * 3);
      tmp.setHex(sp.b);
      cB.set([tmp.r, tmp.g, tmp.b], i * 3);

      this.fish.push({
        pos: new Vector3(),
        yaw: 0,
        bobPhase: this.rng.range(0, 10),
        bobAmp: this.rng.range(0.5, 2.2),
        speed: this.rng.range(1.4, 4.2),
        scale: this.rng.range(sp.scale[0], sp.scale[1]),
      });
    }

    geo.setAttribute('iPhase', new InstancedBufferAttribute(phase, 1));
    geo.setAttribute('iSwim', new InstancedBufferAttribute(swim, 1));
    geo.setAttribute('iColA', new InstancedBufferAttribute(cA, 3));
    geo.setAttribute('iColB', new InstancedBufferAttribute(cB, 3));
    geo.setAttribute('iStripe', new InstancedBufferAttribute(stripe, 1));

    this.mat = new ShaderMaterial({
      side: DoubleSide,
      transparent: true,
      uniforms: {
        uTime: { value: 0 },
        uSun: { value: SUN_DIR.clone() },
        uHaze: { value: vec3('skyMid') },
        uRim: { value: vec3('cloudCore') },
      },
      vertexShader: /* glsl */ `
        attribute float aSpine;
        attribute float iPhase, iSwim, iStripe;
        attribute vec3 iColA, iColB;
        uniform float uTime;
        varying vec3 vN, vV, vColA, vColB;
        varying float vSpine, vStripe, vFogT, vBody;

        void main(){
          // Ondulation de nage : amplitude croissante vers la queue.
          float tail = pow(1.0 - aSpine, 1.6);
          float wave = sin(aSpine * 5.4 - uTime * iSwim + iPhase) * 0.30 * tail;
          vec3 p = position;
          p.x += wave;

          // Hauteur dans le corps, pas la normale : un poisson est plat sur les
          // flancs, donc N.y y vaut ~0 et delaverait tout le corps en ventre.
          vBody = clamp(p.y * 2.6, -1.0, 1.0);

          vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
          vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          vSpine = aSpine;
          vStripe = iStripe;
          vColA = iColA;
          vColB = iColB;
          vFogT = clamp(length(wp.xyz - cameraPosition) / 1000.0, 0.0, 1.0);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uSun, uHaze, uRim;
        varying vec3 vN, vV, vColA, vColB;
        varying float vSpine, vStripe, vFogT, vBody;

        void main(){
          vec3 N = normalize(vN);
          vec3 V = normalize(vV);
          if (!gl_FrontFacing) N = -N;

          // Contre-ombrage : dos sature, ventre clair. Pilote par la position
          // dans le corps pour que les flancs gardent la couleur de l'espece.
          float belly = smoothstep(-0.85, 0.95, vBody);
          vec3 base = mix(vColB, vColA, belly);

          // Bandes verticales, quand l'espece en porte.
          if (vStripe > 0.5) {
            float s = sin(vSpine * vStripe * 6.2831);
            base = mix(base, vColB, smoothstep(0.15, 0.75, s) * 0.55);
          }

          // Cle + rebond du ciel : donne du volume a un corps quasi plat.
          vec3 L = normalize(uSun);
          float lam = 0.52 + 0.48 * max(dot(N, L), 0.0);
          float bounce = 0.14 * max(-N.y, 0.0);
          vec3 c = base * (lam + bounce);

          // Speculaire net : les poissons de la reference sont vernis.
          vec3 H = normalize(L + V);
          c += vec3(1.0) * pow(max(dot(N, H), 0.0), 42.0) * 0.55;

          // Rim froid : detache les poissons du ciel cyan.
          float fres = pow(1.0 - max(dot(N, V), 0.0), 3.2);
          c += uRim * fres * 0.22;

          // Perspective atmospherique : les lointains fondent dans le ciel.
          c = mix(c, uHaze, vFogT * 0.55);
          float a = 1.0 - vFogT * 0.35;

          gl_FragColor = vec4(c, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new InstancedMesh(geo, this.mat, count);
    this.mesh.frustumCulled = false;
    this.fish.forEach((f) => this.respawn(f, true));
  }

  private respawn(f: Fish, initial: boolean): void {
    const r = this.rng;

    // 45 % du banc reste proche : c'est ce qui donne l'echelle et la presence.
    // Un banc entierement lointain se lit comme des taches sur le ciel.
    const close = r.next() < 0.45;
    const z = close ? r.range(55, 260) : r.range(300, this.range);

    f.pos.set(
      close ? r.range(-70, 70) : r.range(-420, 420),
      close ? r.range(10, 52) : r.range(16, 165),
      initial ? z - 40 : z,
    );

    // Cap majoritairement transversal : ils traversent le champ de vision.
    f.yaw = r.next() < 0.5 ? r.range(1.1, 2.0) : r.range(-2.0, -1.1);
    f.speed = r.range(1.4, 4.2);
    f.bobAmp = r.range(0.5, 2.2);
  }

  update(origin: Vector3, dt: number, time: number): void {
    this.mat.uniforms.uTime.value = time;

    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i];
      f.pos.x += Math.sin(f.yaw) * f.speed * dt;
      f.pos.z += Math.cos(f.yaw) * f.speed * dt;
      const bob = Math.sin(time * 0.6 + f.bobPhase) * f.bobAmp;

      // Recyclage : hors de la zone utile, on renvoie devant.
      const dz = f.pos.z - origin.z;
      if (dz < -140 || dz > this.range + 200 || Math.abs(f.pos.x - origin.x) > 700) {
        this.respawn(f, false);
        f.pos.z = origin.z + this.rng.range(this.range * 0.5, this.range);
      }

      // Roulis leger dans le sens du virage : ils planent, ils ne roulent pas a plat.
      this.q.setFromAxisAngle(this.up, f.yaw);
      const bank = new Quaternion().setFromAxisAngle(
        new Vector3(0, 0, 1),
        Math.sin(time * 0.4 + f.bobPhase) * 0.22,
      );
      this.q.multiply(bank);

      this.scaleV.setScalar(f.scale);
      this.m.compose(
        new Vector3(f.pos.x, f.pos.y + bob, f.pos.z),
        this.q,
        this.scaleV,
      );
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
