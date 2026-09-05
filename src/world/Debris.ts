import {
  BufferAttribute,
  BufferGeometry,
  FrontSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  ShaderMaterial,
  Vector3,
} from 'three';
import { GLSL_NOISE, GLSL_SAFE, Rng } from '../core/Noise';
import { RIDER_GLSL, riderUniforms } from './RiderLight';
import { vec3 } from '../core/Palette';
import { GLSL_DAY, dayUniforms } from './Daylight';
import { SUN_DIR } from './Sky';
import { terrainGLSL, terrainUniforms } from './Terrain';

/**
 * LES BLOCS EN APESANTEUR.
 *
 * Le defaut se voit sur n'importe quelle capture d'ORBITE : le ciel occupe le
 * haut, le sol occupe le bas, et entre les deux il n'y a RIEN. Sur les mondes
 * a atmosphere ce vide est rempli par les nuages, la brume, la ligne d'arbres,
 * les tours — tout ce qu'un monde spatial vient justement de perdre. Il faut
 * donc lui rendre autre chose, et un corps brise en a une toute trouvee : ses
 * propres morceaux, qui ne sont jamais retombes.
 *
 * ---
 *
 * POURQUOI DE LA GEOMETRIE ET PAS UN PANNEAU.
 *
 * La version precedente de ce monde avait une geante gazeuse peinte sur un
 * quad face camera. Elle a ete supprimee, et pour une raison qui vaut d'etre
 * ecrite : un panneau colle dans le ciel ne bouge par rapport a rien. Il n'a
 * pas de parallaxe, donc pas de distance ; pas de distance, donc pas
 * d'echelle ; et l'oeil finit par le lire comme un autocollant pose sur le
 * decor, quelle que soit la qualite de ce qu'on peint dessus.
 *
 * Ces blocs sont a dix, trente, quatre-vingts metres. Ils se croisent, ils se
 * depassent, ils passent au-dessus de la tete. C'est ce glissement des uns par
 * rapport aux autres qui donne au vide une profondeur — et il ne s'obtient que
 * si les objets existent vraiment dans le monde.
 *
 * ---
 *
 * Facettes DURES, et c'est tout le sujet de la geometrie : les triangles ne
 * partagent aucun sommet, chacun porte la normale de sa face. Une roche brisee
 * n'a que des aretes vives ; lissee, elle redevient un galet, et un galet en
 * apesanteur ne raconte rien.
 */

const GRID = 13;
const CELL = 42;
const COUNT = GRID * GRID;

/**
 * Un eclat : octaedre subdivise une fois, puis chaque sommet pousse ou tire le
 * long de son rayon. Trente-deux faces suffisent — au-dela on gagne du galet,
 * pas du caillou.
 */
function chunkGeometry(): BufferGeometry {
  const base: number[][] = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
  ];
  const faces: number[][] = [
    [0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4],
    [2, 0, 5], [1, 2, 5], [3, 1, 5], [0, 3, 5],
  ];

  // Subdivision : chaque face devient quatre.
  const sub: number[][][] = [];
  for (const f of faces) {
    const a = base[f[0]], b = base[f[1]], c = base[f[2]];
    const mid = (u: number[], v: number[]): number[] => {
      const m = [u[0] + v[0], u[1] + v[1], u[2] + v[2]];
      const n = Math.hypot(m[0], m[1], m[2]) || 1;
      return [m[0] / n, m[1] / n, m[2] / n];
    };
    const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
    sub.push([a, ab, ca], [ab, b, bc], [ca, bc, c], [ab, bc, ca]);
  }

  // Deformation : un rayon par DIRECTION, pour que deux faces voisines
  // partagent exactement le meme deplacement sur leur arete commune. Un bruit
  // par sommet ouvrirait la coque.
  const rng = new Rng(20260905);
  const cache = new Map<string, number>();
  const radius = (v: number[]): number => {
    const k = v.map((x) => Math.round(x * 1000)).join(',');
    let r = cache.get(k);
    if (r === undefined) {
      r = 0.62 + rng.next() * 0.62;
      cache.set(k, r);
    }
    return r;
  };

  const pos: number[] = [];
  const nrm: number[] = [];
  for (const tri of sub) {
    const p = tri.map((v) => {
      const r = radius(v);
      return [v[0] * r, v[1] * r * 0.72, v[2] * r];
    });
    const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]];
    const w = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
    const ln = Math.hypot(n[0], n[1], n[2]) || 1;
    for (const q of p) {
      pos.push(q[0], q[1], q[2]);
      nrm.push(n[0] / ln, n[1] / ln, n[2] / ln);
    }
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aNrm', new BufferAttribute(new Float32Array(nrm), 3));
  return g;
}

export class Debris {
  readonly mesh: InstancedMesh;
  readonly mat: ShaderMaterial;
  private m = new Matrix4();

  constructor() {
    const rng = new Rng(775311);
    const seed = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) seed[i] = rng.next();

    this.mat = new ShaderMaterial({
      side: FrontSide,
      uniforms: {
        ...riderUniforms(),
        ...terrainUniforms(),
        ...dayUniforms(),
        uTime: { value: 0 },
        uOrigin: { value: new Vector3() },
        uSun: { value: SUN_DIR.clone() },
        /** Presence, 0..1. Zero = pas un seul bloc. */
        uAmount: { value: 0 },
        uRock: { value: vec3('grassNear') },
        uDark: { value: vec3('grassShadow') },
        /** Le lisere de l'etoile sur l'arete. */
        uRim: { value: vec3('grassStreak') },
        /** La lueur du coeur, qui vient d'en bas. */
        uCore: { value: vec3('leafRust') },
      },
      vertexShader: /* glsl */ `
${GLSL_SAFE}
${GLSL_NOISE}
        attribute vec3 aNrm;
        attribute float iSeed;
        uniform float uTime, uAmount;
        uniform vec3 uOrigin;
        varying vec3 vN, vWorldPos;
        varying float vSeed, vFog, vLow;

        ${terrainGLSL()}

        void main(){
          if (uAmount < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

          // Cellule monde, comme le bosquet et le quartier : le contenu ne
          // depend QUE de la position, jamais de l'indice d'instance.
          vec2 base = vec2(
            floor(uOrigin.x / ${CELL}.0 + instanceMatrix[3][0]) * ${CELL}.0,
            floor(uOrigin.z / ${CELL}.0 + instanceMatrix[3][2]) * ${CELL}.0);
          float h1 = hash21(base * 0.0231 + 2.9);
          float h2 = hash21(base * 0.0177 + 13.7);
          float h3 = hash21(base * 0.0349 + 51.3);
          float h4 = hash21(base * 0.0091 + 83.1);

          // Le tirage AVANT tout le reste : un bloc rejete ne doit pas payer
          // le relief.
          if (step(mix(1.15, 0.34, uAmount), h3) < 0.5) {
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }

          vec2 wp = base + vec2(h1, h2) * ${CELL}.0 * 0.9;

          // --- LA HAUTEUR, ET ELLE EST LE VRAI REGLAGE.
          //
          //     Trop bas, les blocs se confondent avec le sol et on ne voit
          //     qu'un champ de cailloux ; trop haut, ils sortent du cadre et le
          //     milieu reste vide. Entre huit et soixante-dix metres, avec une
          //     distribution qui favorise le bas — c'est la bande que la camera
          //     de poursuite regarde vraiment.
          float lift = 8.0 + pow(h4, 1.7) * 62.0;
          float gh = terrainHeightAt(wp, 0.0) + lift;
          vLow = 1.0 - smoothstep(8.0, 42.0, lift);

          // Echelle : les gros sont rares, sinon le ciel se bouche.
          float scale = 1.6 + pow(h2, 2.2) * 7.4;

          // --- LA VRILLE. Lente, et sur DEUX axes : un bloc qui tourne autour
          //     d'un seul axe se lit comme une roue, pas comme un debris. En
          //     apesanteur rien ne redresse rien.
          float t = uTime * (0.05 + h1 * 0.10) + iSeed * 31.0;
          float ca = cos(t), sa = sin(t);
          float cb = cos(t * 0.61 + 1.3), sb = sin(t * 0.61 + 1.3);
          mat3 rot = mat3(ca, 0.0, -sa, 0.0, 1.0, 0.0, sa, 0.0, ca)
                   * mat3(1.0, 0.0, 0.0, 0.0, cb, -sb, 0.0, sb, cb);

          vec3 p = rot * (position * scale);
          vN = normalize(rot * aNrm);
          vec3 world = vec3(wp.x, gh, wp.y) + p;
          vWorldPos = world;
          vSeed = iSeed;
          vFog = smoothstep(120.0, 400.0, length(wp - uOrigin.xz));

          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
${GLSL_SAFE}
        uniform vec3 uRock, uDark, uRim, uCore, uSun;
        uniform float uAmount;
${RIDER_GLSL}
${GLSL_DAY}
        varying vec3 vN, vWorldPos;
        varying float vSeed, vFog, vLow;

        void main(){
          if (uAmount < 0.02) discard;
          vec3 L = normalize(uSun);
          vec3 V = nsafe(cameraPosition - vWorldPos, vec3(0.0, 1.0, 0.0));

          // --- LE TERMINATEUR EST DUR, et c'est tout ce qui dit "pas d'air".
          //     Sans atmosphere pour diffuser, une face est eclairee ou elle ne
          //     l'est pas ; le degrade doux entre les deux est une invention de
          //     ciel bleu.
          float ndl = smoothstep(-0.02, 0.30, dot(vN, L));
          vec3 c = mix(uDark, uRock, 0.35 + vSeed * 0.4) * (0.05 + ndl * 1.75);

          // --- LE LISERE. Un eclat vu a contre-jour garde une arete allumee :
          //     c'est elle qui detache le bloc du noir, et sans elle la moitie
          //     du semis disparait purement et simplement dans le fond.
          float rim = pow(1.0 - clamp(abs(dot(vN, V)), 0.0, 1.0), 3.2);
          c += uRim * rim * (0.16 + ndl * 0.75) * 0.9;

          // --- LA LUEUR DU COEUR, PAR EN DESSOUS.
          //
          //     C'est le detail qui raccroche les blocs au sol : les failles
          //     brillent sous eux, donc leur FACE INFERIEURE prend cette
          //     couleur. Sans ce terme ils flottent dans une scene a laquelle
          //     ils n'appartiennent pas ; avec lui, ils sont eclaires par le
          //     monde qu'ils survolent. Elle ne touche que les blocs bas — a
          //     soixante metres, plus rien ne remonte.
          //     A 0,55 ce n'etait plus un reflet mais une matiere : les blocs
          //     devenaient des cristaux cyan et le monde perdait sa discipline
          //     d'une seule couleur d'accent — le cyan doit rester dans les
          //     failles, les blocs ne font que l'attraper.
          c += uCore * max(-vN.y, 0.0) * vLow * 0.16;

          c += riderLight(vWorldPos) * 0.6;
          // Ils s'eteignent au loin dans le NOIR et non dans une brume : il n'y
          // a pas d'air pour les blanchir.
          c *= 1.0 - vFog * 0.85;

          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new InstancedMesh(chunkGeometry(), this.mat, COUNT);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -830;

    const half = (GRID - 1) / 2;
    let i = 0;
    for (let gz = 0; gz < GRID; gz++) {
      for (let gx = 0; gx < GRID; gx++) {
        this.m.identity();
        this.m.setPosition(gx - half, 0, gz - half - GRID * 0.30);
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
