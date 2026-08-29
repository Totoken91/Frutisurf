import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  NormalBlending,
  ShaderMaterial,
  Vector3,
} from 'three';
import { Rng } from '../core/Noise';
import { vec3 } from '../core/Palette';

/**
 * La ville de cristal. Elle n'est pas une destination : c'est une promesse.
 * On la garde a distance constante du joueur (astuce du matte painting) avec
 * une parallaxe laterale legere, sinon on finirait par lui rentrer dedans.
 */
const DISTANCE = 1700;

export class City {
  readonly group = new Group();
  private mesh: InstancedMesh;
  private mat: ShaderMaterial;

  constructor(count = 78) {
    this.mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: NormalBlending,
      uniforms: {
        uFace: { value: vec3('cityFace') },
        uLit: { value: vec3('cityLit') },
        uDeep: { value: vec3('cityDeep') },
        uHaze: { value: vec3('skyHorizon') },
      },
      vertexShader: /* glsl */ `
        varying float vH;
        varying vec3 vNormalW;
        varying vec3 vViewDir;
        void main(){
          vH = uv.y;
          vec4 wp = instanceMatrix * vec4(position, 1.0);
          vec4 world = modelMatrix * wp;
          vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
          vViewDir = normalize(cameraPosition - world.xyz);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uFace, uLit, uDeep, uHaze;
        varying float vH;
        varying vec3 vNormalW;
        varying vec3 vViewDir;
        void main(){
          // Degrade vertical : les sommets accrochent la lumiere, les bases se noient.
          vec3 c = mix(uDeep, uFace, smoothstep(0.0, 0.55, vH));
          c = mix(c, uLit, smoothstep(0.55, 1.0, vH) * 0.75);

          // Arete lumineuse : c'est ce qui fait lire "cristal" et pas "boite".
          float fres = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewDir))), 2.2);
          c += uLit * fres * 0.55;

          // Ecrasement atmospherique : la ville est presque dans le ciel.
          c = mix(c, uHaze, 0.52);

          float a = 0.30 + fres * 0.42 + smoothstep(0.0, 0.9, vH) * 0.18;
          gl_FragColor = vec4(c, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), this.mat, count);
    this.mesh.frustumCulled = false;

    const rng = new Rng(4242);
    const m = new Matrix4();
    for (let i = 0; i < count; i++) {
      // Amas decale a droite du centre, comme dans la reference.
      const cluster = rng.next();
      const x = rng.range(-260, 620) + (cluster > 0.7 ? rng.range(-120, 120) : 0);
      const z = rng.range(-190, 190);
      // Tours fines et hautes ; les plus hautes au coeur de l'amas.
      const core = 1 - Math.min(1, Math.abs(x - 190) / 380);
      const h = rng.range(24, 68) + core * rng.range(24, 120);
      const w = rng.range(9, 22);
      m.makeScale(w, h, w * rng.range(0.7, 1.3));
      m.setPosition(x, h * 0.5, z);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.group.add(this.mesh);
    this.group.renderOrder = -800;
  }

  update(origin: Vector3): void {
    this.group.position.set(origin.x * 0.06, 0, origin.z - DISTANCE);
  }
}
