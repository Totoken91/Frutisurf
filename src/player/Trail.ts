import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import { vec3 } from '../core/Palette';

/**
 * Le ruban laisse par le disque.
 *
 * Tampon circulaire de positions echantillonnees a intervalle FIXE en
 * distance, pas en temps : a l'arret le ruban ne s'effondre pas sur lui-meme,
 * et a haute vitesse il ne devient pas anguleux.
 */
const SEGMENTS = 72;
const SAMPLE_DIST = 0.42;

export class Trail {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  private geo = new BufferGeometry();
  private pts: Vector3[] = [];
  private ages: number[] = [];
  private width: number[] = [];
  private posAttr: BufferAttribute;
  private ageAttr: BufferAttribute;
  private sideAttr: BufferAttribute;
  private last = new Vector3(0, -999, 0);
  private up = new Vector3(0, 1, 0);
  private dir = new Vector3();
  private side = new Vector3();

  constructor() {
    for (let i = 0; i < SEGMENTS; i++) {
      this.pts.push(new Vector3(0, -999, 0));
      this.ages.push(1);
      this.width.push(0);
    }

    const verts = new Float32Array(SEGMENTS * 2 * 3);
    const ages = new Float32Array(SEGMENTS * 2);
    const sides = new Float32Array(SEGMENTS * 2);
    const idx: number[] = [];
    for (let i = 0; i < SEGMENTS - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    for (let i = 0; i < SEGMENTS; i++) {
      sides[i * 2] = -1;
      sides[i * 2 + 1] = 1;
    }

    this.posAttr = new BufferAttribute(verts, 3);
    this.ageAttr = new BufferAttribute(ages, 1);
    this.sideAttr = new BufferAttribute(sides, 1);
    this.posAttr.setUsage(35048);
    this.ageAttr.setUsage(35048);
    this.geo.setAttribute('position', this.posAttr);
    this.geo.setAttribute('aAge', this.ageAttr);
    this.geo.setAttribute('aSide', this.sideAttr);
    this.geo.setIndex(idx);

    this.mat = new ShaderMaterial({
      // Le ruban est un plan horizontal dont l'enroulement pointe vers le BAS :
      // en FrontSide il etait entierement elimine par le back-face culling.
      side: DoubleSide,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uColA: { value: vec3('buddyRim') },
        uColB: { value: vec3('discDriftB') },
        uColC: { value: vec3('grassHorizon') },
        uCharge: { value: 0 },
      },
      vertexShader: /* glsl */ `
        attribute float aAge, aSide;
        varying float vAge, vSide;
        void main(){
          vAge = aAge;
          vSide = aSide;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColA, uColB, uColC;
        uniform float uCharge;
        varying float vAge, vSide;
        void main(){
          // Derive irisee le long du ruban.
          vec3 c = mix(uColA, uColB, vAge);
          c = mix(c, uColC, 0.35 * (1.0 - vAge));
          // Le ruban blanchit quand le carve est charge a bloc.
          c = mix(c, vec3(1.0), uCharge * 0.6);
          // Bords adoucis : un ruban a bord franc fait autocollant.
          float edge = 1.0 - abs(vSide);
          float a = pow(1.0 - vAge, 1.7) * (0.30 + 0.70 * edge);
          gl_FragColor = vec4(c * a * 0.95, a * 0.8);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new Mesh(this.geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
  }

  reset(p: Vector3): void {
    for (let i = 0; i < SEGMENTS; i++) {
      this.pts[i].copy(p);
      this.ages[i] = 1;
      this.width[i] = 0;
    }
    this.last.copy(p);
  }

  update(p: Vector3, dt: number, speedN: number, charge: number, airborne: boolean): void {
    this.mat.uniforms.uCharge.value = charge;

    // Vieillissement.
    for (let i = 0; i < SEGMENTS; i++) this.ages[i] = Math.min(1, this.ages[i] + dt / 1.1);

    // Nouveaux echantillons a distance fixe. Une boucle, pas un `if` :
    // a 30 fps et 60 m/s le surfeur avance de 2 m par frame, et un seul
    // echantillon par frame laisserait le ruban court et anguleux.
    const w = airborne ? 0.18 : 0.34 + speedN * 0.42 + charge * 0.46;
    let guard = 0;
    while (this.last.distanceTo(p) >= SAMPLE_DIST && guard++ < SEGMENTS) {
      this.last.lerp(p, SAMPLE_DIST / this.last.distanceTo(p));
      this.pts.pop();
      this.ages.pop();
      this.width.pop();
      this.pts.unshift(this.last.clone());
      this.ages.unshift(0);
      this.width.unshift(w);
    }

    // Construction du ruban.
    const arr = this.posAttr.array as Float32Array;
    const ages = this.ageAttr.array as Float32Array;
    for (let i = 0; i < SEGMENTS; i++) {
      const cur = this.pts[i];
      const nxt = this.pts[Math.min(SEGMENTS - 1, i + 1)];
      this.dir.subVectors(cur, nxt);
      if (this.dir.lengthSq() < 1e-8) this.dir.set(0, 0, -1);
      this.dir.normalize();
      this.side.crossVectors(this.dir, this.up).normalize();

      const w = this.width[i] * (1 - this.ages[i] * 0.55);
      const a = i * 6;
      arr[a] = cur.x - this.side.x * w;
      arr[a + 1] = cur.y - this.side.y * w;
      arr[a + 2] = cur.z - this.side.z * w;
      arr[a + 3] = cur.x + this.side.x * w;
      arr[a + 4] = cur.y + this.side.y * w;
      arr[a + 5] = cur.z + this.side.z * w;
      ages[i * 2] = this.ages[i];
      ages[i * 2 + 1] = this.ages[i];
    }
    this.posAttr.needsUpdate = true;
    this.ageAttr.needsUpdate = true;
  }
}
