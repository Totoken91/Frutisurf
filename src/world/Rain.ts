import {
  BufferAttribute,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { GLSL_SAFE } from '../core/Noise';
import { GLSL_DAY, dayUniforms } from './Daylight';
import { RIDER_GLSL, riderUniforms } from './RiderLight';
import { WEATHER_GLSL } from './Weather';

/**
 * LA PLUIE.
 *
 * ---
 *
 * ELLE EST ANCREE AU MONDE, PAS A LA CAMERA, et c'est tout le sujet.
 *
 * Une pluie collee a l'ecran est le reflexe evident et c'est aussi ce qui la
 * trahit : les traits restent immobiles pendant que le paysage defile, donc ils
 * lisent comme une texture posee sur l'objectif plutot que comme de l'eau qui
 * tombe. Ici chaque goutte a une position en monde ; a 30 m/s le joueur la
 * TRAVERSE, et c'est cette parallaxe — les gouttes proches filent, les
 * lointaines derivent — qui fait toute la difference.
 *
 * Le champ se replie autour de la camera comme celui du pollen : le volume
 * utile est un cube d'une vingtaine de metres, et rien au-dela n'aurait de
 * toute facon la taille d'un pixel.
 *
 * ---
 *
 * MELANGE NORMAL, PAS ADDITIF.
 *
 * L'additif est le choix par defaut pour tout ce qui brille, et il aurait ete
 * faux ici : une pluie additive disparait completement sur un ciel clair et ne
 * se voit que sur le sol sombre, donc elle change d'existence selon l'endroit
 * ou l'on regarde. Une averse VOILE — elle est plus claire que ce qu'il y a
 * derriere quand le fond est sombre, et plus terne quand le fond est clair.
 * C'est exactement ce que fait un melange normal avec une couleur prise sur le
 * remplissage du ciel.
 *
 * Et la goutte prend sa couleur du CIEL, jamais un gris fixe : sous un ciel de
 * braise, une pluie grise serait la faute qu'on remarque sans savoir la nommer
 * — la meme que le reflet de l'eau teinte deux fois.
 */
export class Rain {
  readonly mesh: Mesh;
  readonly mat: ShaderMaterial;
  /** Demi-cote du cube replie autour de la camera, en metres. */
  private readonly span = 21;

  constructor(count = 1100) {
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
      uniforms: {
        ...riderUniforms(),
        ...dayUniforms(),
        uCam: { value: new Vector3() },
        uTime: { value: 0 },
        uSpan: { value: this.span },
        /** Intensite de l'averse, 0..1. Zero = pas de pluie dans ce monde. */
        uAmount: { value: 0 },
        /** Force du vent : c'est elle qui couche les traits. */
        uWind: { value: 0 },
      },
      vertexShader: /* glsl */ `
${GLSL_SAFE}
        attribute vec4 iSeed;
        uniform vec3 uCam;
        uniform float uTime, uSpan, uAmount, uWind;
        varying vec2 vUv;
        varying vec3 vWorld;
        varying float vFade;

${WEATHER_GLSL}

        void main(){
          if (uAmount < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

          // --- Position ancree en monde, repliee autour de la CAMERA (et non
          //     du joueur) : c'est la camera qui definit ce qu'on voit, et une
          //     pluie centree sur le disque laisserait un trou juste devant
          //     l'objectif quand la camera recule dans un virage.
          vec3 p;
          p.x = uCam.x + (fract(iSeed.x + uTime * 0.011) - 0.5) * uSpan * 2.0;
          p.z = uCam.z + (fract(iSeed.z + uTime * 0.007) - 0.5) * uSpan * 2.0;

          // La goutte tombe vite — 14 a 21 m/s, ce qui est la vraie vitesse
          // terminale d'une grosse goutte — et se replie sur 30 m de haut.
          float speed = 14.0 + fract(iSeed.w * 7.71) * 7.0;
          p.y = uCam.y + 15.0 - fract(iSeed.y + uTime * speed / 30.0) * 30.0;

          // --- L'INCLINAISON, prise sur la MEME rafale que le disque et les
          //     feuilles. Quand la bourrasque pousse le joueur, la pluie se
          //     couche dans le meme sens : trois couches qui obeissent au meme
          //     nombre, c'est ce qui fait qu'on croit au vent.
          float push = gustPush(p.xz, uTime) * uWind;
          vec3 dir = normalize(vec3(push * 0.075, -1.0, 0.02));

          vec3 toCam = uCam - p;
          float dist = length(toCam);
          vec3 fwd = toCam / max(dist, 0.001);
          // Nul quand on regarde la goutte pile dans l'axe de sa chute : sans
          // le repli, un trait sur N sort en NaN, donc noir, et le flou de
          // bloom etale ce noir sur tout son voisinage.
          vec3 side = nsafe(cross(dir, fwd), vec3(1.0, 0.0, 0.0));

          // Le trait s'allonge avec l'averse : une bruine fait des points, une
          // averse fait des traits.
          float len = (0.55 + fract(iSeed.w * 3.31) * 0.85) * (0.5 + uAmount * 0.9);
          float wide = 0.011 + dist * 0.0019;
          vec3 world = p + dir * position.y * len + side * position.x * wide;

          // Fondu au ras de l'objectif ET au bord du volume : une goutte qui
          // apparait a un metre de l'oeil est une salissure, une goutte qui
          // disparait net au bord du cube est un mur.
          vFade = smoothstep(0.9, 3.0, dist) * smoothstep(uSpan * 1.5, uSpan * 0.7, dist);
          vFade *= uAmount;

          vWorld = world;
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
${GLSL_DAY}
        varying vec2 vUv;
        varying vec3 vWorld;
        varying float vFade;
${RIDER_GLSL}

        void main(){
          if (vFade < 0.004) discard;
          // Le trait est net au milieu et se dissout sur les bords : une bande
          // a bord franc lit comme une rayure, pas comme de l'eau.
          float a = 1.0 - abs(vUv.x * 2.0 - 1.0);
          a = pow(max(a, 1e-4), 1.7);
          // La goutte a une TETE : elle est plus dense en bas qu'en haut, ce
          // qui donne au trait un sens de chute meme fige sur une image.
          a *= mix(0.28, 1.0, vUv.y);
          a *= vFade * 0.5;

          // Elle prend la couleur du remplissage du ciel, eclaircie : c'est ce
          // que renvoie vraiment une goutte, et ca la garde juste a toute heure.
          vec3 c = mix(uDayFill, vec3(1.0), 0.42);
          c += riderLight(vWorld) * 1.1;

          gl_FragColor = vec4(c, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    // Tout devant : la pluie passe devant le decor ET devant le surfeur.
    this.mesh.renderOrder = 9;
  }

  update(camPos: Vector3, time: number): void {
    this.mat.uniforms.uCam.value.copy(camPos);
    this.mat.uniforms.uTime.value = time;
  }
}
