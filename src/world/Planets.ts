import {
  BufferAttribute,
  BufferGeometry,
  FrontSide,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import { GLSL_NOISE, GLSL_SAFE } from '../core/Noise';
import { GLSL_DAY, dayUniforms } from './Daylight';
import { SUN_DIR } from './Sky';

/**
 * LES PLANETES.
 *
 * Un ciel de nuit est un fond. Un ciel de nuit avec une geante gazeuse posee au
 * ras de l'horizon est un LIEU — et la difference tient entierement au fait
 * qu'on peut estimer sa taille, donc la distance, donc l'echelle de tout le
 * reste. C'est le meme argument que le bosquet, applique a ce qu'il y a au-dela
 * du monde au lieu de ce qu'il y a dedans.
 *
 * ---
 *
 * TROIS QUADS, ET TOUT EST DANS LE FRAGMENT.
 *
 * Une sphere maillee coute des centaines de sommets pour rendre un disque
 * eclaire, et un anneau maille coute une couronne de plus, avec le tri de
 * transparence qui va avec. Or ce qu'on regarde ici est une IMAGE : un disque,
 * un terminateur, des bandes, un anneau elliptique. Tout cela s'ecrit
 * analytiquement dans un quad face camera, sans un seul sommet de plus, et le
 * resultat est parfaitement lisse a n'importe quelle taille d'ecran.
 *
 * ---
 *
 * OPAQUE ET SANS TEST DE PROFONDEUR, et l'ordre est le tout.
 *
 *   dome de ciel   -1000  (n'ecrit pas la profondeur)
 *   PLANETES        -980  (n'ecrit ni ne teste : elles se posent sur le ciel)
 *   cretes          -960
 *   sol             -900  (ecrit la profondeur, donc recouvre tout le reste)
 *
 * Elles ne peuvent donc structurellement pas passer devant une colline, et
 * elles n'ont besoin d'aucun tri. Un materiau transparent aurait bascule dans
 * la seconde liste de rendu de three.js — celle qui passe APRES tous les
 * opaques, sol compris — et une geante gazeuse dessinee par-dessus le paysage
 * est exactement ce qu'on ne veut pas. Le limbe se fond donc dans une couleur
 * de ciel passee en uniforme plutot que dans un alpha.
 */

/** [azimut, elevation, rayon angulaire, teinte, inclinaison d'anneau, part d'anneau]. */
/*
 * L'AZIMUT ZERO EST DANS LE DOS DU JOUEUR, et ca n'a rien d'intuitif.
 *
 * La direction se construit en (sin az, ., cos az) et la camera regarde vers
 * les Z NEGATIFS : un astre place a az = 0 pointe donc vers +Z, c'est-a-dire
 * derriere. Les trois corps sont ranges autour de PI, qui est droit devant, et
 * le premier jet les avait tous les trois dans le dos — trois planetes rendues,
 * pas une seule visible, et rien dans l'image pour dire pourquoi.
 */
const PI = Math.PI;
const BODIES: ReadonlyArray<readonly [number, number, number, number, number, number]> = [
  // La grande, basse sur l'horizon, avec des anneaux francs : c'est elle qu'on
  // vient voir. Legerement hors de l'axe de course pour qu'on la decouvre en
  // carvant plutot que de l'avoir plantee en face en permanence.
  //
  // ELEVATIONS RELEVEES : a quatre degres, la grande etait rendue et invisible,
  // parce que les cretes lointaines montent a sept ou dix degres et la
  // couvraient entierement. Un astre pose sur l'horizon est une belle idee de
  // cadrage tant qu'on oublie ce qu'il y a devant.
  [PI - 0.24, 0.205, 0.245, 0.08, 0.34, 1.0],
  // La moyenne, plus haute et de l'autre cote : elle donne la profondeur entre
  // les deux, ce qu'un astre unique ne peut pas faire.
  [PI + 0.66, 0.415, 0.108, 0.55, -0.20, 0.55],
  // La lune, petite, pale, sans anneau. Elle sert d'unite de mesure.
  [PI + 1.42, 0.300, 0.046, 0.72, 0.0, 0.0],
];

/** Distance d'ancrage. Grande, pour que la parallaxe reste douce. */
const R = 1780;

function buildGeometry(): BufferGeometry {
  const pos: number[] = [];
  const corner: number[] = [];
  const idx: number[] = [];
  const body: number[] = [];

  for (let b = 0; b < BODIES.length; b++) {
    const base = pos.length / 3;
    for (const [cx, cy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      // Le quad est construit a l'origine : c'est le sommet qui le pose et le
      // tourne vers la camera.
      pos.push(0, 0, 0);
      corner.push(cx, cy);
      body.push(b);
    }
    idx.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aCorner', new BufferAttribute(new Float32Array(corner), 2));
  g.setAttribute('aBody', new BufferAttribute(new Float32Array(body), 1));
  g.setIndex(idx);
  return g;
}

export class Planets {
  readonly mesh: Mesh;
  readonly mat: ShaderMaterial;

  constructor() {
    const az: number[] = [];
    const el: number[] = [];
    const rad: number[] = [];
    const hue: number[] = [];
    const tilt: number[] = [];
    const ring: number[] = [];
    for (const b of BODIES) {
      az.push(b[0]); el.push(b[1]); rad.push(b[2]); hue.push(b[3]); tilt.push(b[4]); ring.push(b[5]);
    }

    this.mat = new ShaderMaterial({
      side: FrontSide,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        ...dayUniforms(),
        uOrigin: { value: new Vector3() },
        uTime: { value: 0 },
        uSun: { value: SUN_DIR.clone() },
        /** Presence, 0..1. Zero = pas de planetes. */
        uAmount: { value: 0 },
        /** Le ciel derriere elles : le limbe s'y fond, faute d'alpha. */
        uSky: { value: [0.06, 0.05, 0.16] },
        uAz: { value: az },
        uEl: { value: el },
        uRad: { value: rad },
        uHue: { value: hue },
        uTilt: { value: tilt },
        uRing: { value: ring },
      },
      vertexShader: /* glsl */ `
${GLSL_SAFE}
        attribute vec2 aCorner;
        attribute float aBody;
        uniform vec3 uOrigin;
        uniform float uAmount;
        uniform float uAz[${BODIES.length}];
        uniform float uEl[${BODIES.length}];
        uniform float uRad[${BODIES.length}];
        uniform float uHue[${BODIES.length}];
        uniform float uTilt[${BODIES.length}];
        uniform float uRing[${BODIES.length}];
        varying vec2 vUv;
        varying float vHue, vTilt, vRing;
        varying vec3 vDir;

        void main(){
          if (uAmount < 0.02) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

          int b = int(aBody + 0.5);
          float az = 0.0, el = 0.0, rd = 0.0;
          // Une indexation dynamique de tableau d'uniformes n'est pas garantie
          // en GLSL ES 1.0 : on deroule. Trois corps, trois comparaisons.
          for (int i = 0; i < ${BODIES.length}; i++) {
            if (i == b) { az = uAz[i]; el = uEl[i]; rd = uRad[i]; vHue = uHue[i]; vTilt = uTilt[i]; vRing = uRing[i]; }
          }

          // --- LA PARALLAXE, exactement celle des cretes : l'azimut auquel on
          //     POSE l'astre est corrige du deplacement du joueur ramene a la
          //     distance d'ancrage. A dix-sept cents metres, six cents metres
          //     de course la font glisser de vingt degres — assez pour qu'on
          //     la voie tourner autour du monde au lieu de la voir collee a la
          //     camera.
          float w = az - (uOrigin.x * cos(az) - uOrigin.z * sin(az)) / ${R}.0;
          vec3 d = vec3(sin(w) * cos(el), sin(el), cos(w) * cos(el));
          vDir = d;

          vec3 centre = d * ${R}.0;
          // Panneau face camera, construit dans le repere de la VUE : c'est le
          // seul moyen qu'il reste rond quel que soit l'endroit du ciel.
          vec3 right = nsafe(cross(d, vec3(0.0, 1.0, 0.0)), vec3(1.0, 0.0, 0.0));
          vec3 up = cross(right, d);
          float s = rd * ${R}.0;
          vec3 p = centre + right * aCorner.x * s + up * aCorner.y * s;

          vUv = aCorner;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
${GLSL_SAFE}
${GLSL_NOISE}
${GLSL_DAY}
        uniform float uAmount, uTime;
        uniform vec3 uSun, uSky;
        varying vec2 vUv;
        varying float vHue, vTilt, vRing;
        varying vec3 vDir;

        // La rampe cosinusoidale d'Inigo Quilez : trois cosinus dephases d'un
        // tiers de tour donnent un spectre continu et sans cassure. C'est la
        // meme rampe qui peint le sol de ce monde — deux arcs-en-ciel qui ne
        // seraient pas d'accord se verraient immediatement.
        vec3 spectrum(float t){
          return 0.55 + 0.45 * cos(6.28318 * (t + vec3(0.0, 0.33, 0.67)));
        }

        void main(){
          if (uAmount < 0.02) discard;

          // Le disque occupe 0,62 du quad : le reste est la place de l'anneau.
          float DISC = 0.62;
          float r = length(vUv);

          // --- L'ETOILE DU SYSTEME, ET ELLE N'EST PAS LE SOLEIL DU MONDE.
          //
          //     Premier jet : les planetes prenaient uSun, pour rester
          //     d'accord avec le reste de la scene. C'est juste sur le papier
          //     et faux a l'ecran — le cycle amene ce soleil DERRIERE la
          //     camera la moitie du temps, et la geante se retrouvait alors en
          //     nouvelle lune, c'est-a-dire noire, exactement aux heures ou
          //     elle est la seule chose qu'on regarde. Une direction fixe,
          //     haute et a gauche, la garde en phase gibbeuse en permanence :
          //     un croissant se lit comme un bug, un disque presque plein se
          //     lit comme une planete.
          vec3 L = normalize(vec3(-0.55, 0.42, -0.72));
          vec3 col = vec3(0.0);
          float on = 0.0;

          // --- L'ANNEAU, dessine EN PREMIER : la planete passera par-dessus,
          //     ce qui cache tout seul la moitie arriere. Un anneau complet
          //     rendu apres la sphere lui barre le ventre et l'aplatit.
          if (vRing > 0.01) {
            // Ellipse : on ecrase l'axe vertical du facteur d'inclinaison. La
            // valeur absolue de l'inclinaison donne l'ouverture, son SIGNE dit
            // de quel cote on voit la tranche.
            float sq = max(abs(vTilt), 0.06);
            vec2 e = vec2(vUv.x, vUv.y / sq);
            float er = length(e);
            // Deux bandes separees par une division : un anneau plein se lit
            // comme une soucoupe.
            float band = smoothstep(0.72, 0.78, er) * (1.0 - smoothstep(1.02, 1.08, er));
            band *= 1.0 - 0.75 * smoothstep(0.86, 0.88, er) * (1.0 - smoothstep(0.90, 0.92, er));
            // Grain radial : un anneau est fait de cailloux, pas de plastique.
            band *= 0.62 + 0.38 * smoothstep(0.35, 0.75, fbm2(vec2(er * 26.0, vHue * 30.0)));
            if (band > 0.02) {
              vec3 rc = mix(spectrum(vHue + 0.42), vec3(1.0), 0.30);
              // La moitie AVANT de l'anneau (celle qui passe devant la
              // planete) est plus claire : elle recoit la lumiere de face.
              rc *= 0.85 + 0.55 * step(0.0, -vUv.y * sign(vTilt));
              col = rc; on = band;
            }
          }

          // --- LA PLANETE.
          if (r < DISC) {
            // Normale de la sphere, reconstruite depuis le disque.
            float z = sqrt(max(1.0 - (r / DISC) * (r / DISC), 0.0));
            vec3 n = normalize(vec3(vUv / DISC, z));

            // Les BANDES. Une geante gazeuse se lit a ses ceintures, et elles
            // doivent suivre la LATITUDE de la sphere et non l'ecran : sur un
            // disque plat elles se liraient comme des rayures peintes.
            float lat = n.y;
            float turb = fbm2(vec2(lat * 7.0 + vHue * 20.0, n.x * 1.3 + uTime * 0.006));
            float bandT = lat * 3.1 + turb * 0.85;
            vec3 base = spectrum(vHue + sin(bandT) * 0.085);
            // Les ceintures claires et sombres alternent : c'est le contraste
            // qui fait la geante, pas la teinte.
            base *= 0.74 + 0.46 * smoothstep(-0.3, 0.6, sin(bandT * 2.2 + turb));
            // Une tache, sur la grande seulement.
            float spot = exp(-pow((lat + 0.22) * 6.5, 2.0) - pow((n.x - 0.28) * 3.4, 2.0));
            base = mix(base, spectrum(vHue + 0.5) * 1.15, spot * vRing * 0.55);

            // Terminateur. La lumiere vient du meme soleil que le reste du
            // monde : une planete eclairee d'ailleurs trahit tout de suite un
            // decor colle.
            float ndl = dot(n, L) * 0.5 + 0.5;
            float lit = smoothstep(0.18, 0.72, ndl);
            vec3 pc = base * (0.16 + lit * 1.35);
            // Le limbe se fond dans le ciel : sans alpha, c'est la seule facon
            // d'eviter un bord de decoupe.
            pc = mix(pc, uSky, smoothstep(0.86, 1.0, r / DISC));
            col = pc; on = 1.0;
          }

          if (on < 0.03) discard;
          // PAS DE daylight() ICI, et c'est deliberé. Une geante gazeuse est
          // eclairee par l'etoile du systeme, pas par l'heure locale du monde
          // qu'on survole : lui appliquer le cycle jour/nuit l'eteignait la
          // nuit — c'est-a-dire exactement au moment ou elle est la seule
          // chose qu'on regarde.
          vec3 c = mix(uSky, col, clamp(on, 0.0, 1.0)) * uAmount;
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new Mesh(buildGeometry(), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -980;
  }

  update(origin: Vector3, time: number, sky: { r: number; g: number; b: number }): void {
    this.mat.uniforms.uOrigin.value.copy(origin);
    this.mat.uniforms.uTime.value = time;
    const s = this.mat.uniforms.uSky.value as number[];
    s[0] = sky.r;
    s[1] = sky.g;
    s[2] = sky.b;
    this.mesh.position.set(origin.x, origin.y, origin.z);
  }
}
