import {
  AdditiveBlending,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
} from 'three';
import { Rng } from '../core/Noise';
import { vec3 } from '../core/Palette';

/**
 * Bulles de savon. Elles n'ont PAS de couleur propre : uniquement une frange
 * irisee de film mince sur le contour. Une bulle teintee en plein casse l'effet.
 *
 * Deux populations :
 *  - decoratives, hautes et grosses, comme dans la reference ;
 *  - jouables, a hauteur de glisse, ramassables.
 *
 * Faux verre en shader plutot que `transmission` : un seul objet transmissif
 * est autorise dans la scene (le buddy), cf. docs/02 §5.
 */
export interface BubbleHit {
  index: number;
  position: Vector3;
}

interface Bub {
  pos: Vector3;
  radius: number;
  drift: Vector3;
  phase: number;
  playable: boolean;
  alive: boolean;
  respawnAt: number;
}

export class Bubbles {
  readonly mesh: InstancedMesh;
  private bubs: Bub[] = [];
  private mat: ShaderMaterial;
  private m = new Matrix4();
  private q = new Quaternion();
  private s = new Vector3();
  private rng = new Rng(5150);
  private readonly range = 620;
  private alphaAttr: InstancedBufferAttribute;

  constructor(count = 44) {
    const geo = new SphereGeometry(1, 24, 16);

    const seed = new Float32Array(count);
    const alpha = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      seed[i] = this.rng.range(0, 20);
      alpha[i] = 1;
      const playable = i % 3 !== 0;
      this.bubs.push({
        pos: new Vector3(),
        radius: playable ? this.rng.range(0.7, 1.15) : this.rng.range(3.5, 11),
        drift: new Vector3(),
        phase: this.rng.range(0, 10),
        playable,
        alive: true,
        respawnAt: 0,
      });
    }
    this.alphaAttr = new InstancedBufferAttribute(alpha, 1);
    geo.setAttribute('iSeed', new InstancedBufferAttribute(seed, 1));
    geo.setAttribute('iAlpha', this.alphaAttr);

    this.mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uTint: { value: vec3('cloudCore') },
      },
      vertexShader: /* glsl */ `
        attribute float iSeed, iAlpha;
        uniform float uTime;
        varying vec3 vN, vV;
        varying float vSeed, vAlpha;
        void main(){
          // Deformation lente : une bulle de savon n'est jamais une sphere parfaite.
          vec3 p = position;
          p *= 1.0 + 0.045 * sin(position.y * 3.0 + uTime * 1.3 + iSeed)
                   + 0.035 * sin(position.x * 2.4 - uTime * 0.9 + iSeed * 1.7);
          vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
          vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          vV = normalize(cameraPosition - wp.xyz);
          vSeed = iSeed;
          vAlpha = iAlpha;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTint;
        uniform float uTime;
        varying vec3 vN, vV;
        varying float vSeed, vAlpha;

        void main(){
          vec3 N = normalize(vN);
          vec3 V = normalize(vV);
          float ndv = abs(dot(N, V));

          // Fresnel : tout se joue sur le contour, le centre reste vide.
          float fres = pow(1.0 - ndv, 2.8);

          // Interference de film mince : le chemin optique s'allonge aux
          // angles rasants, d'ou la derive d'arc-en-ciel sur le bord.
          float d = (0.85 + 0.35 * sin(vSeed + uTime * 0.25)) / max(ndv, 0.12);
          vec3 iri = 0.5 + 0.5 * cos(6.2831 * d * vec3(1.0, 0.86, 0.72)
                                     + vec3(0.0, 2.09, 4.19));

          vec3 c = iri * fres * 1.35 + uTint * pow(fres, 3.0) * 0.5;

          // Point speculaire net : la petite fenetre blanche des bulles.
          float spec = pow(max(dot(N, normalize(vec3(0.4, 0.8, -0.45))), 0.0), 64.0);
          c += vec3(1.0) * spec * 0.9;

          gl_FragColor = vec4(c, (fres * 0.85 + spec) * vAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new InstancedMesh(geo, this.mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.bubs.forEach((b) => this.respawn(b, true));
  }

  private respawn(b: Bub, initial: boolean): void {
    const r = this.rng;
    if (b.playable) {
      // Dans le couloir de jeu, a hauteur d'epaule.
      b.pos.set(r.range(-13, 13), r.range(1.4, 4.2), -(initial ? r.range(20, this.range) : this.range));
      b.drift.set(r.range(-0.2, 0.2), r.range(0.1, 0.4), 0);
    } else {
      b.pos.set(r.range(-90, 90), r.range(8, 70), -(initial ? r.range(-40, this.range) : this.range));
      b.drift.set(r.range(-0.5, 0.5), r.range(0.3, 1.1), 0);
    }
    b.alive = true;
    b.respawnAt = 0;
  }

  /** Fait eclater une bulle ; elle repartira plus loin. */
  pop(index: number, now: number): void {
    const b = this.bubs[index];
    if (!b?.alive) return;
    b.alive = false;
    b.respawnAt = now + 0.6;
    this.alphaAttr.setX(index, 0);
    this.alphaAttr.needsUpdate = true;
  }

  /** Bulles jouables proches d'un point — pour la collecte. */
  query(center: Vector3, radius: number, out: BubbleHit[]): BubbleHit[] {
    out.length = 0;
    for (let i = 0; i < this.bubs.length; i++) {
      const b = this.bubs[i];
      if (!b.alive || !b.playable) continue;
      const dx = b.pos.x - center.x;
      const dy = b.pos.y - center.y;
      const dz = b.pos.z - center.z;
      const rr = radius + b.radius;
      if (dx * dx + dy * dy + dz * dz < rr * rr) out.push({ index: i, position: b.pos });
    }
    return out;
  }

  update(origin: Vector3, dt: number, time: number): void {
    this.mat.uniforms.uTime.value = time;

    for (let i = 0; i < this.bubs.length; i++) {
      const b = this.bubs[i];

      if (!b.alive) {
        if (time >= b.respawnAt) {
          this.respawn(b, false);
          b.pos.z = origin.z - this.range;
          this.alphaAttr.setX(i, 1);
          this.alphaAttr.needsUpdate = true;
        } else {
          continue;
        }
      }

      b.pos.addScaledVector(b.drift, dt);
      b.pos.x += Math.sin(time * 0.7 + b.phase) * dt * 0.35;

      // Passee derriere la camera ou montee trop haut : on recycle devant.
      const ahead = origin.z - b.pos.z;
      if (ahead < -30 || b.pos.y > 190) {
        this.respawn(b, false);
        b.pos.z = origin.z - this.range;
      }

      this.s.setScalar(b.radius);
      this.m.compose(b.pos, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
