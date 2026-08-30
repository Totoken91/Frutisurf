import {
  AdditiveBlending,
  CylinderGeometry,
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
import { terrainHeight } from './Terrain';

/**
 * Les plots de vitesse.
 *
 * Une COLONNE DE LUMIERE plantee au sol, pas une pastille posee dessus.
 *
 * Le premier jet etait un disque a plat epousant le terrain. Vu depuis une
 * camera rasante il n'offrait presque aucune surface a l'ecran, et un plot dans
 * un creux disparaissait derriere la colline suivante : on ne pouvait pas viser
 * ce qu'on ne voyait pas. La colonne se voit par-dessus le relief et de loin,
 * et sa base indique le point exact a franchir.
 *
 * Ils sont semes en slalom en travers du couloir : les enchainer demande de
 * tourner, c'est ce qui en fait une recompense d'adresse et pas un ramassage
 * passif.
 */

/** Demi-largeur de semis. Suit l'elargissement du couloir (CORRIDOR = 34). */
const SPREAD = 24;
/** Espacement entre deux plots consecutifs, le long du parcours. */
const GAP_MIN = 52;
const GAP_MAX = 88;
/** Distance du premier plot au demarrage, et au-dela de laquelle on resseme. */
const NEAR = 45;
const FAR = 520;
const RADIUS = 3.2;
/** Hauteur de la colonne : assez haute pour depasser une crete voisine. */
const HEIGHT = 19;

export interface BoosterHit {
  index: number;
  position: Vector3;
}

interface Pad {
  pos: Vector3;
  alive: boolean;
  /** Repousse apres un delai : le couloir ne se vide jamais completement. */
  respawnAt: number;
}

export class Boosters {
  readonly mesh: InstancedMesh;
  private pads: Pad[] = [];
  private mat: ShaderMaterial;
  private m = new Matrix4();
  private q = new Quaternion();
  private scale = new Vector3(1, 1, 1);
  private rng = new Rng(8123);
  private alphaAttr: InstancedBufferAttribute;
  private lastSide = 1;

  constructor(count = 16) {
    // Tube ouvert : on ne voit que la paroi, ce qui donne la colonne creuse.
    // Le sommet se resserre : un tube droit se lit comme une barre, un cone
    // effile se lit comme un faisceau.
    const geo = new CylinderGeometry(RADIUS * 0.28, RADIUS, HEIGHT, 22, 1, true);
    geo.translate(0, HEIGHT * 0.5, 0);
    const alpha = new Float32Array(count).fill(1);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) seed[i] = this.rng.range(0, 10);
    this.alphaAttr = new InstancedBufferAttribute(alpha, 1);
    geo.setAttribute('iAlpha', this.alphaAttr);
    geo.setAttribute('iSeed', new InstancedBufferAttribute(seed, 1));

    this.mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        // Coeur CHAUD. Sur une plaine vert sature, un additif cyan se noie :
        // le vert est deja proche de la saturation et l'ajout ne fait que
        // paler. L'ambre est la seule teinte qui tranche encore — c'est aussi
        // le seul accent chaud de la reference, donc il reste dans la palette.
        uCore: { value: vec3('cloudCore') },
        uEdge: { value: [1.0, 0.72, 0.26] },
        uWarm: { value: [1.0, 0.94, 0.72] },
      },
      side: DoubleSide,
      vertexShader: /* glsl */ `
        attribute float iAlpha, iSeed;
        varying vec2 vUv;
        varying float vAlpha, vSeed;
        varying vec3 vNormalW;
        varying vec3 vViewW;
        void main(){
          vUv = uv;
          vAlpha = iAlpha;
          vSeed = iSeed;
          vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
          vNormalW = normalize(mat3(instanceMatrix) * normal);
          vViewW = normalize(cameraPosition - wp.xyz);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform vec3 uCore, uEdge, uWarm;
        varying vec2 vUv;
        varying float vAlpha, vSeed;
        varying vec3 vNormalW, vViewW;

        void main(){
          if (vAlpha < 0.01) discard;

          // Le pied est franc, le sommet se dissout : la colonne se lit comme
          // posee au sol et non comme un cylindre flottant.
          float up = vUv.y;
          float body = pow(1.0 - up, 1.6);
          float foot = smoothstep(0.14, 0.0, up);

          // Chevrons qui montent : ils disent que c'est une PRISE, pas un obstacle.
          float wave = sin(up * 13.0 - uTime * 4.2 + vSeed) * 0.5 + 0.5;
          float chevron = smoothstep(0.55, 1.0, wave) * body * 0.7;

          // Bords vus de profil plus lumineux : donne le volume du tube.
          float rim = pow(1.0 - abs(dot(normalize(vNormalW), normalize(vViewW))), 2.2);

          float pulse = 0.82 + 0.18 * sin(uTime * 3.4 + vSeed);
          vec3 c = mix(uEdge, uCore, rim * 0.55 + chevron * 0.45) * 1.6 + uWarm * foot * 1.2;
          float a = (body * 0.62 + chevron * 0.7 + rim * 0.7 + foot * 1.1) * vAlpha * pulse;
          gl_FragColor = vec4(c * a, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new InstancedMesh(geo, this.mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;

    for (let i = 0; i < count; i++) {
      this.pads.push({ pos: new Vector3(0, 0, 1e6), alive: true, respawnAt: 0 });
    }
    // Semis initial dans l'ordre : chaque plot s'accroche au precedent.
    this.pads.forEach((p) => this.seed(p, 0));
  }

  /**
   * Seme un plot EN BOUT DE CHAINE, a un ecart controle du plus lointain.
   *
   * Un tirage independant dans une fenetre laisse de gros trous : avec neuf
   * plots repartis au hasard sur 450 m, le plus proche naissait a 144 m et on
   * pouvait rouler dix secondes sans en croiser un. La chaine garantit un
   * espacement regulier, donc un plot toujours a portee de vue.
   */
  private seed(pad: Pad, originZ: number): void {
    const r = this.rng;
    // Ancre par defaut choisie pour que le PREMIER plot de la chaine tombe a
    // NEAR une fois l'ecart retranche. Partir de (originZ - NEAR) le repoussait
    // d'un ecart entier, et le plot le plus proche naissait a plus de 100 m.
    let far = originZ - NEAR + GAP_MIN;
    for (const q of this.pads) {
      if (q !== pad && q.pos.z < far) far = q.pos.z;
    }
    const z = Math.max(far - r.range(GAP_MIN, GAP_MAX), originZ - FAR);
    // On repousse le plot du cote oppose au precedent : ca dessine un slalom
    // plutot qu'une file, et prendre la chaine entiere demande de tourner.
    const side = this.lastSide > 0 ? -1 : 1;
    this.lastSide = side;
    pad.pos.set(side * r.range(SPREAD * 0.25, SPREAD), 0, z);
    pad.alive = true;
    pad.respawnAt = 0;
  }

  /** Remise a zero complete : nouvelle partie. */
  reseedAll(originZ: number): void {
    this.lastSide = 1;
    for (const p of this.pads) p.pos.z = 1e6;
    for (let i = 0; i < this.pads.length; i++) {
      this.seed(this.pads[i], originZ);
      this.alphaAttr.setX(i, 1);
    }
    this.alphaAttr.needsUpdate = true;
  }

  /** Ramasse un plot ; il repartira plus loin. */
  take(index: number, now: number): void {
    const p = this.pads[index];
    if (!p?.alive) return;
    p.alive = false;
    p.respawnAt = now + 0.35;
    this.alphaAttr.setX(index, 0);
    this.alphaAttr.needsUpdate = true;
  }

  /**
   * Plots a portee. La tolerance VERTICALE est genereuse : on doit pouvoir en
   * accrocher un en retombant d'un saut, sinon les plots et le vol s'excluent.
   */
  query(center: Vector3, radius: number, out: BoosterHit[]): BoosterHit[] {
    out.length = 0;
    for (let i = 0; i < this.pads.length; i++) {
      const p = this.pads[i];
      if (!p.alive) continue;
      const dx = p.pos.x - center.x;
      const dz = p.pos.z - center.z;
      // On prend la colonne en la traversant : large en hauteur, pour pouvoir
      // l'accrocher aussi en retombant d'un saut.
      const dy = center.y - p.pos.y;
      const rr = radius + RADIUS;
      if (dx * dx + dz * dz < rr * rr && dy > -2.5 && dy < HEIGHT * 0.7) {
        out.push({ index: i, position: p.pos });
      }
    }
    return out;
  }

  update(origin: Vector3, time: number): void {
    this.mat.uniforms.uTime.value = time;

    for (let i = 0; i < this.pads.length; i++) {
      const p = this.pads[i];

      if (!p.alive) {
        if (time < p.respawnAt) continue;
        this.seed(p, origin.z);
        this.alphaAttr.setX(i, 1);
        this.alphaAttr.needsUpdate = true;
      }

      // Passe derriere la camera, ou trop loin devant : on resseme dans la fenetre.
      const ahead = origin.z - p.pos.z;
      if (ahead < -40 || ahead > FAR + 120) this.seed(p, origin.z);

      // La colonne reste VERTICALE meme en pente : c'est un faisceau, pas un
      // objet pose, et l'incliner le rendrait moins lisible sans rien gagner.
      p.pos.y = terrainHeight(p.pos.x, p.pos.z);
      this.m.compose(p.pos, this.q, this.scale);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
