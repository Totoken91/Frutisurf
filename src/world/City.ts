import {
  BoxGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { GLSL_NOISE, Rng } from '../core/Noise';
import { vec3 } from '../core/Palette';

/**
 * La ville de cristal. Elle n'est pas une destination : c'est une promesse.
 * On la garde a distance constante du joueur (astuce du matte painting) avec
 * une parallaxe laterale legere, sinon on finirait par lui rentrer dedans.
 */
/**
 * Distance de la ville. Ramenee de 1700 a 1150 : au-dela de 1600 elle passait
 * DERRIERE le banc de nuages d'horizon et disparaissait completement du cadre.
 * Une promesse qu'on ne voit jamais n'est pas une promesse.
 */
const DISTANCE = 1150;

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

          // Ecrasement atmospherique : la ville est presque dans le ciel. A
          // 0,52 elle s'y dissolvait au point qu'on ne distinguait plus une
          // seule tour ; il en faut assez pour la reculer, pas pour l'effacer.
          c = mix(c, uHaze, 0.36);

          float a = 0.46 + fres * 0.40 + smoothstep(0.0, 0.9, vH) * 0.16;
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
    this.group.add(this.treeline());
    this.group.renderOrder = -800;
  }

  /**
   * La ligne d'arbres au pied de la ville.
   *
   * Sans elle, la plaine s'arretait net et les tours poussaient directement
   * dans l'herbe : une decoupe de papier. Une bande d'arbres donne au regard
   * un palier entre le vert du sol et le verre du fond, et c'est exactement ce
   * que fait la reference — c'est meme la seule chose qui separe sa pelouse de
   * son horizon.
   *
   * Un plan et un shader : la silhouette est decoupee au bruit dans le
   * fragment. Modeliser des arbres a 1150 m serait payer des milliers de
   * triangles pour trente pixels de haut.
   */
  private treeline(): Mesh {
    const mat = new ShaderMaterial({
      // ECRIT la profondeur, contrairement au reste du fond. La silhouette est
      // decoupee au discard, donc le tampon ne recoit que les pixels pleins —
      // et sans cette ecriture, le banc de nuages situe pourtant un kilometre
      // plus loin se peignait par-dessus les arbres.
      transparent: true,
      depthWrite: true,
      side: DoubleSide,
      uniforms: {
        uDark: { value: vec3('treeLine') },
        uLit: { value: vec3('grassNear') },
        uHaze: { value: vec3('skyHorizon') },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main(){
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uDark, uLit, uHaze;
        varying vec2 vUv;
        ${GLSL_NOISE}
        void main(){
          // Deux octaves : la premiere donne les bosquets, la seconde
          // l'irregularite des cimes. Une seule ferait une haie taillee.
          float crown = fbm(vec2(vUv.x * 26.0, 0.5)) * 0.62 + fbm(vec2(vUv.x * 96.0, 3.7)) * 0.38;
          float top = 0.30 + crown * 0.62;
          if (vUv.y > top) discard;

          // Les cimes accrochent la lumiere, le pied reste dans l'ombre : sans
          // ce degrade la bande lit comme un aplat noir pose sur l'herbe.
          float lit = smoothstep(0.0, top, vUv.y);
          vec3 c = mix(uDark, mix(uDark, uLit, 0.55), lit);
          c = mix(c, uHaze, 0.30);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    // Plantee bien DEVANT les tours, a 700 m du joueur. Posee au pied de la
    // ville (1150 m) elle etait masquee en permanence par les cretes situees
    // entre elle et la camera : le relief culmine a 13 m et depasse la ligne
    // d'oeil, il faut donc s'en degager franchement pour exister.
    const m = new Mesh(new PlaneGeometry(3000, 64), mat);
    m.position.set(90, 16, 450);
    m.renderOrder = -750;
    m.frustumCulled = false;
    return m;
  }

  update(origin: Vector3): void {
    this.group.position.set(origin.x * 0.06, 0, origin.z - DISTANCE);
  }
}
