import {
  AdditiveBlending,
  CircleGeometry,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Quaternion,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
} from 'three';
import { GLSL_SAFE, Rng } from '../core/Noise';
import { vec3 } from '../core/Palette';
import { terrainHeight, WATER_LEVEL } from './Terrain';

/**
 * Les anneaux de verre. C'est EUX qui font le jeu.
 *
 * Le projet avait de la glisse, des figures et une jauge, mais aucun objectif :
 * on roulait joliment sans jamais avoir de raison de tourner ici plutot que la.
 * Un anneau donne trois choses d'un coup — une cible a viser, du temps au
 * chrono, et une raison d'utiliser le saut qu'on avait construit.
 *
 * Deux hauteurs, et c'est tout le design :
 *  - au sol, on les enfile en glissant, c'est le rythme de base ;
 *  - en hauteur, il FAUT sauter, donc lire le relief et armer a l'avance.
 * Le second paie beaucoup plus. Le joueur decide de son niveau de risque a
 * chaque anneau, sans qu'aucun menu ne lui demande.
 */

/** Rayon median du tore. */
export const RING_R = 5.4;
/** Rayon utile pour le passage : plus genereux que le trou geometrique. */
const PASS_R = RING_R - 0.5;
const TUBE = 0.5;

const GAP_MIN = 64;
const GAP_MAX = 98;
const NEAR = 90;
const FAR = 620;
/** Demi-largeur de semis. Plus resserre que les colonnes : un anneau doit
 *  rester atteignable meme quand on arrive de travers. */
const SPREAD = 18;

/**
 * Hauteur du centre au-dessus du sol.
 *
 * L'anneau bas est plante DANS l'herbe : son bas passe 1,8 m sous la surface.
 * C'est volontaire — pose juste au-dessus du sol, il faudrait un petit saut
 * pour l'enfiler, et le rythme de base ne serait plus la glisse mais le saut.
 * Enterre, on l'enfile en roulant, avec 3,3 m de marge laterale.
 *
 * L'anneau haut demande environ 4 m d'altitude : atteignable avec un elan
 * arme et une crete correctement timee, jamais par accident.
 */
const LOW_Y = 3.6;
const HIGH_Y = 9.0;

export interface RingHit {
  index: number;
  pass: boolean;
  high: boolean;
  point: Vector3;
}

export interface Ring {
  pos: Vector3;
  high: boolean;
  alive: boolean;
  flash: number;
  seed: number;
}

const GLASS = /* glsl */ `
${GLSL_SAFE}
  attribute float iAlpha, iFlash, iSeed, iHigh;
  varying vec3 vN, vV;
  varying vec2 vUv;
  varying float vAlpha, vFlash, vSeed, vHigh;
  void main(){
    vUv = uv;
    vAlpha = iAlpha; vFlash = iFlash; vSeed = iSeed; vHigh = iHigh;
    // Le passage fait GONFLER l'anneau : l'expansion est ce qui se lit le
    // mieux en vision peripherique, mieux qu'un simple changement de couleur.
    vec3 p = position * (1.0 + iFlash * 0.42);
    vec4 wp = modelMatrix * instanceMatrix * vec4(p, 1.0);
    vN = nsafe(mat3(instanceMatrix) * normal, vec3(0.0, 1.0, 0.0));
    // La camera traverse les anneaux (mesure a -0,98 m) : sans garde, le
    // vecteur de vue s'annule et normalize rend NaN, donc du noir.
    vV = nsafe(cameraPosition - wp.xyz, vec3(0.0, 0.0, 1.0));

    // --- FONDU DE PROXIMITE.
    //
    // La camera traverse REELLEMENT les anneaux : mesure a -0,98 m, une a deux
    // images d'affilee, a chaque anneau franchi — le surfeur passe dedans, la
    // camera le suit une fraction de seconde plus tard. Un tore et un voile
    // translucides DOUBLE FACE dans lesquels on entre remplissent tout le
    // cadre, et a vingt images par seconde deux images font cent millisecondes
    // de plein ecran. Ce n'est pas un effet, c'est un accident — et c'est
    // exactement ce que le joueur decrivait par « des objets qui viennent sur
    // la camera une fraction de seconde ».
    //
    // Le fondu est calcule PAR SOMMET et non par pixel : il ne coute rien, et
    // sur une grande surface il fait mieux que disparaitre d'un bloc — la
    // partie qui arrive dans l'objectif s'efface pendant que le reste tient.
    vAlpha *= smoothstep(0.8, 6.5, distance(cameraPosition, wp.xyz));
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

export class Rings {
  readonly group: InstancedMesh;
  readonly veil: InstancedMesh;
  private rings: Ring[] = [];
  private torusMat: ShaderMaterial;
  private veilMat: ShaderMaterial;
  private m = new Matrix4();
  private q = new Quaternion();
  private scale = new Vector3(1, 1, 1);
  private rng = new Rng(4471);
  /** Graine imposee par un banc d'essai, sinon indefinie (semis aleatoire). */
  private fixedSeed?: number;
  private aAlpha: InstancedBufferAttribute;
  private aFlash: InstancedBufferAttribute;
  private vAlpha: InstancedBufferAttribute;
  private vFlash: InstancedBufferAttribute;
  private highAttr: InstancedBufferAttribute;
  private side = 1;
  private highStreak = 0;

  /**
   * @param seed graine du semis. Laissee libre, elle est TIREE AU SORT pour que
   *   deux parties ne proposent jamais le meme parcours. Les bancs d'essai la
   *   fixent : une verification dont le resultat depend d'un tirage n'echoue
   *   pas, elle flotte — et une vérif qui flotte, on finit par l'ignorer.
   */
  constructor(count = 8, fixedSeed?: number) {
    const torus = new TorusGeometry(RING_R, TUBE, 10, 46);
    const disc = new CircleGeometry(RING_R - TUBE, 44);

    const alpha = new Float32Array(count).fill(1);
    const flash = new Float32Array(count);
    const seed = new Float32Array(count);
    const high = new Float32Array(count);
    for (let i = 0; i < count; i++) seed[i] = this.rng.range(0, 6.28);

    this.aAlpha = new InstancedBufferAttribute(alpha, 1);
    this.aFlash = new InstancedBufferAttribute(flash, 1);
    const aSeed = new InstancedBufferAttribute(seed, 1);
    const aHigh = new InstancedBufferAttribute(high, 1);
    torus.setAttribute('iAlpha', this.aAlpha);
    torus.setAttribute('iFlash', this.aFlash);
    torus.setAttribute('iSeed', aSeed);
    torus.setAttribute('iHigh', aHigh);

    // Les deux maillages partagent les MEMES tableaux d'attributs : un seul
    // etat a tenir a jour, impossible de les desynchroniser.
    this.vAlpha = new InstancedBufferAttribute(alpha, 1);
    this.vFlash = new InstancedBufferAttribute(flash, 1);
    disc.setAttribute('iAlpha', this.vAlpha);
    disc.setAttribute('iFlash', this.vFlash);
    disc.setAttribute('iSeed', aSeed);
    disc.setAttribute('iHigh', aHigh);

    this.torusMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uGlass: { value: vec3('buddyGlass') },
        uRim: { value: vec3('buddyHot') },
        uDeep: { value: vec3('aeroBlue') },
        uHigh: { value: vec3('discDriftB') },
      },
      vertexShader: GLASS,
      fragmentShader: /* glsl */ `
${GLSL_SAFE}
        uniform float uTime;
        uniform vec3 uGlass, uRim, uDeep, uHigh;
        varying vec3 vN, vV;
        varying vec2 vUv;
        varying float vAlpha, vFlash, vSeed, vHigh;

        void main(){
          if (vAlpha < 0.01) discard;
          float fres = pow(max(1.0 - abs(dot(nsafe(vN, vec3(0.0, 1.0, 0.0)),
                                             nsafe(vV, vec3(0.0, 0.0, 1.0)))), 1e-4), 2.1);

          // Teinte : cyan au sol, violet iridescent en hauteur. La couleur DIT
          // s'il faut sauter, avant meme d'avoir juge la hauteur a l'oeil.
          vec3 body = mix(uGlass, uHigh, vHigh * 0.72);
          // Valeurs VOLONTAIREMENT au-dessus de 1 : la cible est un tampon
          // demi-flottant, et c'est ce depassement qui fait mordre le bloom.
          // Le premier jet melangeait vers un bleu profond et les anneaux
          // sortaient gris sur la plaine verte, invisibles a trente metres.
          vec3 c = mix(body, uRim, fres) * 1.95 + uDeep * 0.10;

          // Reflet qui court le long du tore : c'est ce qui fait le VERRE.
          // Fixe, il ferait plastique.
          float sweep = sin(vUv.x * 6.2831 * 2.0 - uTime * 1.7 + vSeed) * 0.5 + 0.5;
          c += uRim * smoothstep(0.62, 1.0, sweep) * 1.15;
          c += uRim * vFlash * 2.4;

          float a = (0.62 + fres * 0.38) * vAlpha * (1.0 - vFlash * 0.5) + vFlash * 0.5;
          gl_FragColor = vec4(c, clamp(a, 0.0, 1.0));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.veilMat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
      uniforms: {
        uTime: { value: 0 },
        uGlass: { value: vec3('buddyRim') },
        uHigh: { value: vec3('discDriftB') },
      },
      vertexShader: GLASS,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uGlass, uHigh;
        varying vec3 vN, vV;
        varying vec2 vUv;
        varying float vAlpha, vFlash, vSeed, vHigh;

        void main(){
          if (vAlpha < 0.01) discard;
          // Le voile est presque invisible au centre et s'allume au bord : il
          // remplit le trou juste assez pour qu'on VOIE la cible de loin, sans
          // jamais masquer le paysage qu'on traverse.
          float r = length(vUv - 0.5) * 2.0;
          float edge = smoothstep(0.45, 1.0, r);
          float ripple = sin(r * 16.0 - uTime * 2.4 + vSeed) * 0.5 + 0.5;
          vec3 c = mix(uGlass, uHigh, vHigh * 0.6) * 1.5;
          float a = (edge * 0.30 + ripple * edge * 0.14 + vFlash * 0.7) * vAlpha;
          gl_FragColor = vec4(c * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.group = new InstancedMesh(torus, this.torusMat, count);
    this.group.frustumCulled = false;
    this.group.renderOrder = 6;
    this.veil = new InstancedMesh(disc, this.veilMat, count);
    this.veil.frustumCulled = false;
    this.veil.renderOrder = 4;

    this.highAttr = aHigh;
    for (let i = 0; i < count; i++) {
      this.rings.push({ pos: new Vector3(0, 0, 1e6), high: false, alive: true, flash: 0, seed: seed[i] });
    }
    this.fixedSeed = fixedSeed;
    this.reseedAll(0);
  }

  /** Remise a zero complete : relance de partie. */
  reseedAll(originZ: number): void {
    this.rng = new Rng(this.fixedSeed ?? 4471 + Math.floor(Math.random() * 100000));
    this.side = 1;
    this.highStreak = 0;
    for (const r of this.rings) r.pos.z = 1e6;
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      r.flash = 0;
      this.seed(r, originZ);
      this.aFlash.setX(i, 0);
      this.vFlash.setX(i, 0);
      this.aAlpha.setX(i, 1);
      this.vAlpha.setX(i, 1);
      this.highAttr.setX(i, r.high ? 1 : 0);
      this.place(i, r);
    }
    this.flush();
  }

  /**
   * Semis en chaine, comme les colonnes : chaque anneau s'accroche au plus
   * lointain deja pose. Un tirage independant laisse des trous de 150 m et le
   * chrono devient injouable pendant ce trou.
   */
  private seed(ring: Ring, originZ: number): void {
    const r = this.rng;
    let far = originZ - NEAR + GAP_MIN;
    for (const q of this.rings) {
      if (q !== ring && q.pos.z < far) far = q.pos.z;
    }
    const z = Math.max(far - r.range(GAP_MIN, GAP_MAX), originZ - FAR);

    // Deux anneaux hauts de suite tuent le rythme : on ne peut pas rearmer un
    // saut assez vite, et rater le second est alors une punition subie.
    const high = this.highStreak < 1 && r.next() < 0.38;
    this.highStreak = high ? this.highStreak + 1 : 0;

    // Alternance, mais pas metronomique : un anneau sur quatre revient pres du
    // centre. Une alternance stricte gauche-droite-gauche finit par se jouer
    // toute seule, et c'est exactement la sensation de rail qu'on veut eviter.
    this.side = -this.side;
    const centred = r.next() < 0.25;
    const x = centred
      ? r.range(-SPREAD * 0.22, SPREAD * 0.22)
      : this.side * r.range(SPREAD * 0.30, SPREAD);
    // Un anneau au-dessus d'une etendue se cale sur la SURFACE et non sur le
    // fond : sinon il serait a moitie noye et deviendrait infranchissable.
    const floorY = Math.max(terrainHeight(x, z), WATER_LEVEL);
    ring.pos.set(x, floorY + (high ? HIGH_Y : LOW_Y), z);
    ring.high = high;
    ring.alive = true;
    ring.flash = 0;
  }

  private place(i: number, r: Ring): void {
    this.scale.setScalar(1);
    this.m.compose(r.pos, this.q, this.scale);
    this.group.setMatrixAt(i, this.m);
    this.veil.setMatrixAt(i, this.m);
  }

  private flush(): void {
    this.group.instanceMatrix.needsUpdate = true;
    this.veil.instanceMatrix.needsUpdate = true;
    this.aAlpha.needsUpdate = true;
    this.aFlash.needsUpdate = true;
    this.vAlpha.needsUpdate = true;
    this.vFlash.needsUpdate = true;
    this.highAttr.needsUpdate = true;
  }

  /**
   * Franchissement du plan de l'anneau entre deux pas de simulation.
   *
   * On teste le PLAN, pas la proximite : a 45 m/s le surfeur avance de 0,4 m
   * par pas, et un test de sphere laisserait passer un anneau sur deux.
   */
  cross(px: number, py: number, pz: number, x: number, y: number, z: number): RingHit | null {
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];
      if (!r.alive) continue;
      if (!(pz > r.pos.z && z <= r.pos.z)) continue;
      const span = pz - z;
      const t = span > 1e-6 ? (pz - r.pos.z) / span : 0;
      const ix = px + (x - px) * t;
      const iy = py + (y - py) * t;
      const dx = ix - r.pos.x;
      const dy = iy - r.pos.y;
      const pass = dx * dx + dy * dy < PASS_R * PASS_R;
      return { index: i, pass, high: r.high, point: r.pos };
    }
    return null;
  }

  /** Franchi : l'anneau eclate et se retire de la chaine. */
  take(index: number): void {
    const r = this.rings[index];
    if (!r?.alive) return;
    r.alive = false;
    r.flash = 1;
  }

  /** Distance a l'anneau suivant, pour le guidage sonore et le HUD. */
  nextAhead(originZ: number): Ring | null {
    let best: Ring | null = null;
    for (const r of this.rings) {
      if (!r.alive) continue;
      const ahead = originZ - r.pos.z;
      if (ahead <= 0) continue;
      if (!best || r.pos.z > best.pos.z) best = r;
    }
    return best;
  }

  update(origin: Vector3, time: number, dt: number): void {
    this.torusMat.uniforms.uTime.value = time;
    this.veilMat.uniforms.uTime.value = time;

    let dirty = false;
    for (let i = 0; i < this.rings.length; i++) {
      const r = this.rings[i];

      if (r.flash > 0) {
        r.flash = Math.max(0, r.flash - dt * 3.2);
        this.aFlash.setX(i, r.flash);
        this.vFlash.setX(i, r.flash);
        const a = r.alive ? 1 : r.flash;
        this.aAlpha.setX(i, a);
        this.vAlpha.setX(i, a);
        this.place(i, r);
        dirty = true;
      }

      const ahead = origin.z - r.pos.z;
      // Un anneau eclate ou depasse repart en bout de chaine.
      if ((!r.alive && r.flash <= 0) || ahead < -30 || ahead > FAR + 140) {
        this.seed(r, origin.z);
        this.aAlpha.setX(i, 1);
        this.vAlpha.setX(i, 1);
        this.aFlash.setX(i, 0);
        this.vFlash.setX(i, 0);
        this.highAttr.setX(i, r.high ? 1 : 0);
        this.place(i, r);
        dirty = true;
      }
    }
    if (dirty) this.flush();
  }
}
