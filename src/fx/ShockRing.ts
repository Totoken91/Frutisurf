import {
  AdditiveBlending,
  Group,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { vec3 } from '../core/Palette';

/**
 * Anneaux de choc au sol : atterrissage et pop de carve.
 * Petit pool fixe, aucune allocation en jeu.
 */
const POOL = 5;
const LIFE = 0.5;

interface Ring {
  mesh: Mesh;
  birth: number;
  power: number;
}

export class ShockRing {
  readonly group = new Group();
  private rings: Ring[] = [];
  private cursor = 0;
  private mat: ShaderMaterial;

  constructor() {
    this.mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uColor: { value: vec3('grassHorizon') },
        uHot: { value: vec3('cloudCore') },
        uFade: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main(){
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor, uHot;
        uniform float uFade;
        varying vec2 vUv;
        void main(){
          float d = length(vUv - 0.5) * 2.0;
          // Anneau fin qui s'amincit en s'etendant.
          float ring = smoothstep(0.70, 0.93, d) * smoothstep(1.0, 0.93, d);
          float a = ring * uFade;
          vec3 c = mix(uColor, uHot, ring * 0.5);
          gl_FragColor = vec4(c * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    for (let i = 0; i < POOL; i++) {
      const m = new Mesh(new PlaneGeometry(1, 1), this.mat.clone());
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      m.renderOrder = 6;
      this.group.add(m);
      this.rings.push({ mesh: m, birth: -999, power: 0 });
    }
  }

  spawn(at: Vector3, power: number, time: number): void {
    const r = this.rings[this.cursor];
    this.cursor = (this.cursor + 1) % POOL;
    r.mesh.position.set(at.x, 0.03, at.z);
    r.mesh.visible = true;
    r.birth = time;
    r.power = power;
  }

  update(time: number): void {
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      const t = (time - r.birth) / LIFE;
      if (t >= 1) {
        r.mesh.visible = false;
        continue;
      }
      // 0 -> 6 m sur la duree de vie, en decelerant.
      r.mesh.scale.setScalar(0.6 + Math.pow(t, 0.6) * 6 * r.power);
      const m = r.mesh.material as ShaderMaterial;
      m.uniforms.uFade.value = (1 - t) * (1 - t);
    }
  }
}
