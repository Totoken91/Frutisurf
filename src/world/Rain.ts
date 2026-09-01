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
import { terrainGLSL, terrainUniforms } from './Terrain';

/**
 * L'AVERSE. Pas la pluie : l'averse.
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
 * CE QUI SEPARE UNE AVERSE D'UNE PLUIE, et ce ne sont pas les gouttes.
 *
 * Le premier reglage donnait une pluie honnete : des traits fins, espaces,
 * qu'on remarquait sans jamais les subir. Multiplier leur nombre n'aurait pas
 * suffi — une pluie torrentielle ne se reconnait pas au COMPTE des gouttes
 * mais a trois choses qu'elles ne font pas toutes seules :
 *
 *   1. LA LONGUEUR DU TRAIT. Une goutte tombe a vingt metres par seconde ;
 *      pendant le temps de pose de l'oeil elle parcourt plusieurs decimetres.
 *      C'est la STRIE qui dit la violence, pas le point.
 *   2. LE VOILE. Au-dela de quelques dizaines de metres, l'eau qui tombe entre
 *      l'oeil et le paysage fait ecran (cf. Ground.uWet). Une pluie qui
 *      n'enleve rien a la vue n'est qu'un motif de traits pose devant un beau
 *      temps.
 *   3. LE REJAILLISSEMENT. Sous une vraie averse, une nappe blanche tient a
 *      quelques dizaines de centimetres du sol — l'eau qui remonte. C'est le
 *      detail qui distingue « il pleut fort » de « il tombe des cordes », et
 *      une part des instances lui est reservee ici meme.
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
  private readonly span = 20;

  constructor(count = 3000) {
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
        // La nappe de rejaillissement se pose sur le SOL : il lui faut le
        // relief, comme au tapis de feuilles.
        ...terrainUniforms(),
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
        varying float vFade, vMist;

${WEATHER_GLSL}
        ${terrainGLSL()}

        void main(){
          if (uAmount < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

          // --- Position ancree en monde, repliee autour de la CAMERA (et non
          //     du joueur) : c'est la camera qui definit ce qu'on voit, et une
          //     pluie centree sur le disque laisserait un trou juste devant
          //     l'objectif quand la camera recule dans un virage.
          vec3 p;
          p.x = uCam.x + (fract(iSeed.x + uTime * 0.011) - 0.5) * uSpan * 2.0;
          p.z = uCam.z + (fract(iSeed.z + uTime * 0.007) - 0.5) * uSpan * 2.0;

          // Une instance sur dix n'est pas une goutte mais une BOUFFEE de
          // rejaillissement. Elles partagent le meme appel de dessin : deux
          // maillages auraient double le cout de commande pour deux fois rien.
          float kind = fract(iSeed.w * 91.7);
          if (kind > 0.90) {
            // Nom : PAS "flat", qui est un qualificateur d'interpolation
            // RESERVE en GLSL ES 3.0. Quatrieme fois que ce piege coute une
            // compilation dans ce projet, apres "cast" et "patch" — et un
            // maillage qui ne compile pas disparait sans un mot.
            float span = length(uCam.xz - p.xz);
            float gy = max(terrainHeightAt(p.xz, span), WATER_LEVEL);
            // Chaque bouffee a sa propre respiration : synchronisees, elles
            // feraient un brouillard qui pulse au lieu d'une nappe qui bout.
            float puff = fract(iSeed.y + uTime * (0.60 + fract(iSeed.w * 5.3) * 0.55));
            p.y = gy + 0.05 + puff * 0.50;
            p.x += gustPush(p.xz, uTime) * uWind * 0.14;

            vec3 toCam = uCam - p;
            float dist = length(toCam);
            vec3 fwd = toCam / max(dist, 0.001);
            vec3 right = nsafe(cross(vec3(0.0, 1.0, 0.0), fwd), vec3(1.0, 0.0, 0.0));
            vec3 up = cross(fwd, right);
            // Elle nait serree et s'etale en mourant.
            float s = (0.30 + fract(iSeed.x * 7.7) * 0.42) * (0.45 + puff * 0.95);
            vec3 world = p + right * position.x * s * 1.7 + up * position.y * s * 0.7;

            // Portee COURTE. Au-dela de dix metres la nappe ne raconte plus
            // rien et ne coute que du remplissage — et le remplissage est le
            // seul poste ou trois mille quads translucides peuvent faire mal.
            vFade = uAmount * puff * (1.0 - puff) * 3.4
                  * smoothstep(11.0, 5.0, dist) * smoothstep(1.0, 2.6, dist);
            vMist = 1.0;
            vWorld = world;
            vUv = uv;
            gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
            return;
          }

          // La goutte tombe vite — 18 a 28 m/s, la vitesse terminale d'une
          // grosse goutte d'orage — et se replie sur 32 m de haut.
          float speed = 18.0 + fract(iSeed.w * 7.71) * 10.0;
          p.y = uCam.y + 16.0 - fract(iSeed.y + uTime * speed / 32.0) * 32.0;

          // --- L'INCLINAISON, prise sur la MEME rafale que le disque et les
          //     feuilles. Quand la bourrasque pousse le joueur, la pluie se
          //     couche dans le meme sens : trois couches qui obeissent au meme
          //     nombre, c'est ce qui fait qu'on croit au vent.
          float push = gustPush(p.xz, uTime) * uWind;
          // Et une INCLINAISON PROPRE a chaque goutte, par-dessus la rafale.
          //
          // Sans elle, les trois mille traits sont rigoureusement paralleles :
          // l'oeil ne lit plus une averse mais des RAYURES posees sur l'image,
          // et le defaut est d'autant plus voyant que les traits sont longs.
          // Quelques degres d'ecart suffisent a rendre son volume au champ.
          vec2 jit = vec2(fract(iSeed.x * 17.31), fract(iSeed.z * 23.07)) - 0.5;
          vec3 dir = normalize(vec3(push * 0.085 + jit.x * 0.10, -1.0, 0.02 + jit.y * 0.08));

          vec3 toCam = uCam - p;
          float dist = length(toCam);
          vec3 fwd = toCam / max(dist, 0.001);
          // Nul quand on regarde la goutte pile dans l'axe de sa chute : sans
          // le repli, un trait sur N sort en NaN, donc noir, et le flou de
          // bloom etale ce noir sur tout son voisinage.
          vec3 side = nsafe(cross(dir, fwd), vec3(1.0, 0.0, 0.0));

          // LE TRAIT, et c'est lui qui porte la violence de l'averse. Une
          // bruine fait des points, une averse fait des barres.
          float len = (1.10 + fract(iSeed.w * 3.31) * 1.45) * (0.35 + uAmount * 1.05);
          float wide = 0.014 + dist * 0.0024;
          vec3 world = p + dir * position.y * len + side * position.x * wide;

          // Fondu au ras de l'objectif ET au bord du volume : une goutte qui
          // apparait a un metre de l'oeil est une salissure, une goutte qui
          // disparait net au bord du cube est un mur.
          vFade = smoothstep(0.8, 2.6, dist) * smoothstep(uSpan * 1.55, uSpan * 0.7, dist);
          // Toutes les gouttes n'ont pas la meme densite : une pluie dont
          // chaque trait a exactement la meme valeur est une trame, pas une
          // averse. C'est le meme raisonnement que l'inclinaison propre.
          vFade *= uAmount * (0.55 + fract(iSeed.y * 41.7) * 0.75);
          vMist = 0.0;

          vWorld = world;
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
${GLSL_DAY}
        varying vec2 vUv;
        varying vec3 vWorld;
        varying float vFade, vMist;
${RIDER_GLSL}

        void main(){
          if (vFade < 0.004) discard;

          float a;
          if (vMist > 0.5) {
            // La bouffee : ronde, molle, et surtout PALE. Une nappe de
            // rejaillissement trop dense se lit comme du brouillard, et un
            // brouillard ne tombe pas.
            float r = length(vUv - 0.5) * 2.0;
            if (r > 1.0) discard;
            a = pow(max(1.0 - r, 1e-4), 2.1) * vFade * 0.26;
          } else {
            // Le trait est net au milieu et se dissout sur les bords : une
            // bande a bord franc lit comme une rayure, pas comme de l'eau.
            float t = 1.0 - abs(vUv.x * 2.0 - 1.0);
            t = pow(max(t, 1e-4), 1.55);
            // La goutte a une TETE : plus dense en bas qu'en haut, ce qui
            // donne au trait un sens de chute meme fige sur une image.
            t *= mix(0.22, 1.0, vUv.y);
            a = t * vFade * 0.80;
          }

          // Elle prend la couleur du remplissage du ciel, eclaircie : c'est ce
          // que renvoie vraiment une goutte, et ca la garde juste a toute heure.
          vec3 c = mix(uDayFill, vec3(1.0), 0.44);
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
