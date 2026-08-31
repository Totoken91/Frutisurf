import {
  AdditiveBlending,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { GLSL_SAFE, Rng } from '../core/Noise';
import { vec3 } from '../core/Palette';

/**
 * Les brins d'herbe arraches par la carre.
 *
 * Toute la physique vit dans le VERTEX SHADER : le CPU n'ecrit que lors du
 * spawn (quelques particules par frame), jamais pour animer les 700 autres.
 * Chaque brin est etire le long de sa vitesse — un point rond ne lit pas
 * comme de la matiere projetee.
 */
const GRAVITY = 11;

export class Spray {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  private cursor = 0;
  private readonly count: number;
  private aPos: InstancedBufferAttribute;
  private aVel: InstancedBufferAttribute;
  private aBirth: InstancedBufferAttribute;
  private aSeed: InstancedBufferAttribute;
  private aFoam: InstancedBufferAttribute;
  private rng = new Rng(31337);
  private emitDebt = 0;
  /**
   * 0 = herbe arrachee, 1 = ecume. Ecrit AU SPAWN et non en uniforme global :
   * sinon les brins verts encore en vol vireraient au blanc a l'instant ou
   * l'on touche l'eau, et l'ecume redeviendrait verte en touchant la rive.
   */
  foam = 0;

  constructor(count = 700) {
    this.count = count;
    const base = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.instanceCount = count;

    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    const birth = new Float32Array(count).fill(-999);
    const seed = new Float32Array(count);
    for (let i = 0; i < count; i++) seed[i] = this.rng.next();
    const foam = new Float32Array(count);

    this.aPos = new InstancedBufferAttribute(pos, 3);
    this.aVel = new InstancedBufferAttribute(vel, 3);
    this.aBirth = new InstancedBufferAttribute(birth, 1);
    this.aSeed = new InstancedBufferAttribute(seed, 1);
    this.aFoam = new InstancedBufferAttribute(foam, 1);
    this.aPos.setUsage(35048); // DynamicDrawUsage
    this.aVel.setUsage(35048);
    this.aBirth.setUsage(35048);
    this.aFoam.setUsage(35048);

    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iVel', this.aVel);
    geo.setAttribute('iBirth', this.aBirth);
    geo.setAttribute('iSeed', this.aSeed);
    geo.setAttribute('iFoam', this.aFoam);

    this.mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      uniforms: {
        uTime: { value: 0 },
        uLife: { value: 0.72 },
        uGravity: { value: GRAVITY },
        uColA: { value: vec3('grassMid') },
        uColB: { value: vec3('grassHorizon') },
        uFoamA: { value: vec3('waterFoam') },
        uFoamB: { value: vec3('waterShallow') },
      },
      vertexShader: /* glsl */ `
${GLSL_SAFE}
        attribute vec3 iPos, iVel;
        attribute float iBirth, iSeed, iFoam;
        uniform float uTime, uLife, uGravity;
        varying float vAge, vSeed, vFoam, vNear;
        varying vec2 vQuad;

        void main(){
          float age = uTime - iBirth;
          vAge = clamp(age / uLife, 0.0, 1.0);
          vSeed = iSeed;
          vFoam = iFoam;

          if (age < 0.0 || age > uLife) {
            // Particule morte : on la replie sur un point degenere.
            gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
            return;
          }

          vec3 vel = iVel - vec3(0.0, uGravity * age, 0.0);
          vec3 center = iPos + iVel * age - vec3(0.0, 0.5 * uGravity * age * age, 0.0);

          // Billboard oriente sur la vitesse : le brin s'etire dans son sens
          // de projection au lieu de rester une pastille ronde.
          // Par PARTICULE : celles qui passent au ras de l'objectif avaient un
          // vecteur de vue nul, donc un NaN, donc un quad noir — pendant que
          // leurs voisines s'affichaient normalement.
          vec3 fwd = nsafe(cameraPosition - center, vec3(0.0, 0.0, 1.0));
          vec3 up = vel - fwd * dot(vel, fwd);
          float upLen = length(up);
          up = upLen > 0.0001 ? up / upLen : vec3(0.0, 1.0, 0.0);
          // Si le repli vec3(0,1,0) se retrouve colineaire a fwd — camera juste
          // au-dessus de la particule — le produit vectoriel est nul.
          vec3 right = nsafe(cross(up, fwd), vec3(1.0, 0.0, 0.0));

          float fade = 1.0 - vAge;
          float w = (0.085 + iSeed * 0.055) * fade * (1.0 + iFoam * 0.55);
          // Une gouttelette s'etire beaucoup moins qu'un brin : elle est ronde.
          float h = w * mix(1.8 + min(length(vel) * 0.34, 7.0), 1.5, iFoam);

          vQuad = position.xy * 2.0; // -1 .. 1 sur le quad
          // La gerbe part vers l'ARRIERE — jusqu'a une quinzaine de metres par
          // seconde en z — et la camera est a une dizaine de metres derriere.
          // Une gouttelette additive collee a l'objectif est un flash blanc
          // plein cadre. On l'eteint avant qu'elle n'y arrive.
          vNear = smoothstep(0.5, 3.0, distance(cameraPosition, center));
          vec3 p = center + right * position.x * w + up * position.y * h;
          gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uColA, uColB, uFoamA, uFoamB;
        varying float vAge, vSeed, vFoam, vNear;
        varying vec2 vQuad;
        void main(){
          // MASQUE. Sans lui la particule est le quad lui-meme : sur de
          // l'herbe verte ca passe, mais une gerbe d'ecume blanche devient une
          // pluie de CARRES nets — le defaut le plus voyant de tout le jeu.
          // Ellipse inscrite dans le quad, bord adouci.
          float r = length(vQuad);
          float mask = 1.0 - smoothstep(0.45, 1.0, r);
          if (mask <= 0.002) discard;

          // Le brin s'eclaircit en vieillissant, comme s'il prenait la lumiere.
          float k = vSeed * 0.6 + vAge * 0.4;
          vec3 c = mix(mix(uColA, uColB, k), mix(uFoamA, uFoamB, k), vFoam);
          // L'ecume est presque blanche : en additif elle sature tout de suite
          // et se met a bloomer en pave. On la rentre volontairement.
          float a = (1.0 - vAge) * (1.0 - vAge) * 0.9 * mask * mix(1.0, 0.55, vFoam) * vNear;
          gl_FragColor = vec4(c * (0.8 + vAge * 0.6), a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 10;
  }

  private spawn(origin: Vector3, vel: Vector3, time: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.count;
    this.aPos.setXYZ(i, origin.x, origin.y, origin.z);
    this.aVel.setXYZ(i, vel.x, vel.y, vel.z);
    this.aBirth.setX(i, time);
    this.aFoam.setX(i, this.foam);
    this.aPos.needsUpdate = true;
    this.aVel.needsUpdate = true;
    this.aBirth.needsUpdate = true;
    this.aFoam.needsUpdate = true;
  }

  /**
   * Emission continue depuis le point de contact.
   * @param lateral direction laterale de la carre (signe du virage)
   */
  emit(
    contact: Vector3,
    lateral: number,
    speed: number,
    steerAbs: number,
    dt: number,
    time: number,
  ): void {
    // 0 -> 160 particules/s selon |steer| * vitesse (docs/03 §6).
    const rate = 260 * steerAbs * Math.min(1, speed / 30);
    this.emitDebt += rate * dt;
    const n = Math.floor(this.emitDebt);
    this.emitDebt -= n;

    const r = this.rng;
    const v = new Vector3();
    const o = new Vector3();
    for (let i = 0; i < n; i++) {
      // Ejection perpendiculaire au disque, vers l'exterieur du virage.
      const side = -Math.sign(lateral) || 1;
      o.set(
        contact.x + side * r.range(1.1, 1.7),
        contact.y + r.range(-0.05, 0.15),
        contact.z + r.range(-0.4, 0.4),
      );
      v.set(
        side * r.range(2.5, 7.5) * (0.5 + steerAbs),
        r.range(3.4, 7.5),
        r.range(1.5, 5.0) + speed * 0.10,
      );
      this.spawn(o, v, time);
    }
  }

  /** Gerbe ponctuelle : pop de carve, atterrissage. */
  burst(contact: Vector3, count: number, power: number, time: number): void {
    const r = this.rng;
    const v = new Vector3();
    const o = new Vector3();
    for (let i = 0; i < count; i++) {
      const a = r.range(0, Math.PI * 2);
      const sp = r.range(3, 10) * power;
      o.set(contact.x + Math.cos(a) * 0.6, contact.y + 0.05, contact.z + Math.sin(a) * 0.6);
      v.set(Math.cos(a) * sp, r.range(4, 11) * power, Math.sin(a) * sp + 2);
      this.spawn(o, v, time);
    }
  }

  update(time: number): void {
    this.mat.uniforms.uTime.value = time;
  }
}
