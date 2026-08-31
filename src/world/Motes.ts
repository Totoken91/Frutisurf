import {
  AdditiveBlending,
  BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { vec3 } from '../core/Palette';
import { SUN_DIR } from './Sky';

/**
 * Le pollen.
 *
 * Quelques centaines de points qui derivent dans l'air, presque invisibles a
 * contre-jour et lumineux face au soleil. C'est le detail le moins cher et le
 * plus rentable du projet : il donne au vide entre la camera et l'horizon une
 * MATIERE. Sans lui, l'air d'un jeu est parfaitement transparent, ce qui
 * n'arrive jamais dehors un jour de soleil.
 *
 * Le champ se replie autour du joueur, comme les nuages, avec des positions
 * ancrees en monde : les grains ne suivent pas la camera, ils la croisent.
 */
export class Motes {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  private readonly span = 70;

  constructor(count = 380) {
    const base = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position as BufferAttribute;
    geo.attributes.uv = base.attributes.uv as BufferAttribute;
    geo.instanceCount = count;

    const seed = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seed[i * 4] = Math.random();
      seed[i * 4 + 1] = Math.random();
      seed[i * 4 + 2] = Math.random();
      seed[i * 4 + 3] = Math.random();
    }
    geo.setAttribute('iSeed', new InstancedBufferAttribute(seed, 4));

    this.mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uOrigin: { value: new Vector3() },
        uTime: { value: 0 },
        uSpan: { value: this.span },
        uSun: { value: SUN_DIR.clone() },
        uWarm: { value: vec3('cloudCore') },
      },
      vertexShader: /* glsl */ `
        attribute vec4 iSeed;
        uniform vec3 uOrigin, uSun;
        uniform float uTime, uSpan;
        varying float vGlow;
        varying vec2 vUv;

        void main(){
          // Position ancree en monde, repliee autour du joueur : le grain
          // traverse le champ de vision au lieu de l'accompagner.
          vec3 p;
          p.x = uOrigin.x + (fract(iSeed.x + uTime * 0.004) - 0.5) * uSpan * 1.6;
          p.z = uOrigin.z - mod(uOrigin.z - (iSeed.z - 0.5) * uSpan * 2.0, uSpan);
          // Derive verticale lente, avec un flottement propre a chaque grain.
          p.y = 0.4 + iSeed.y * 7.0 + sin(uTime * (0.30 + iSeed.w * 0.5) + iSeed.x * 30.0) * 0.55;
          p.x += sin(uTime * (0.22 + iSeed.z * 0.4) + iSeed.y * 22.0) * 0.9;

          vec3 toCam = cameraPosition - p;
          float dist = length(toCam);
          vec3 fwd = toCam / max(dist, 0.001);
          vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
          vec3 up = cross(fwd, right);

          // Taille en metres, legerement croissante avec la distance pour ne
          // pas tomber sous le pixel : un grain qui disparait scintille.
          float s = 0.030 + iSeed.w * 0.030 + dist * 0.0016;
          vec3 world = p + right * position.x * s + up * position.y * s;

          // A CONTRE-JOUR il s'allume. C'est ce contraste entre les grains face
          // au soleil et ceux qui lui tournent le dos qui donne la profondeur ;
          // un pollen d'intensite uniforme n'est qu'un semis de points blancs.
          float facing = max(dot(normalize(-fwd), normalize(uSun)), 0.0);
          vGlow = (0.22 + pow(facing, 3.0) * 1.5) * smoothstep(uSpan, uSpan * 0.35, dist)
                * smoothstep(1.5, 5.0, dist);
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uWarm;
        varying float vGlow;
        varying vec2 vUv;
        void main(){
          float r = length(vUv - 0.5) * 2.0;
          if (r > 1.0) discard;
          // Coeur dur, halo doux : un simple disque flou lit comme une tache
          // de poussiere sur l'objectif, pas comme un grain en suspension.
          float a = pow(1.0 - r, 2.2) * 0.55 + pow(max(0.0, 1.0 - r * 2.4), 6.0) * 0.9;
          a *= vGlow;
          gl_FragColor = vec4(uWarm * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
  }

  update(origin: Vector3, time: number): void {
    this.mat.uniforms.uOrigin.value.copy(origin);
    this.mat.uniforms.uTime.value = time;
  }
}
