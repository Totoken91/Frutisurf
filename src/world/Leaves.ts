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
import { vec3 } from '../core/Palette';
import { RIDER_GLSL, riderUniforms } from './RiderLight';
import { GLSL_DAY, dayUniforms } from './Daylight';
import { SUN_DIR } from './Sky';
import { WEATHER_GLSL } from './Weather';
import { terrainGLSL, terrainUniforms } from './Terrain';

/**
 * LES FEUILLES MORTES.
 *
 * ---
 *
 * POURQUOI ELLES NE SONT PAS DU POLLEN ORANGE.
 *
 * Le pollen (cf. Motes.ts) est un semis de points ronds qui derivent : il donne
 * une MATIERE a l'air, et c'est tout ce qu'on lui demande. Une feuille, elle,
 * est un OBJET — elle a une taille, une face et une tranche, elle tombe, elle
 * tourne sur elle-meme, et surtout elle FINIT PAR SE POSER. Repeindre le pollen
 * en ocre aurait donne des confettis en suspension, ce qui est l'image d'une
 * fete, pas d'un mois d'octobre.
 *
 * Trois choses font la difference, et elles coutent chacune trois lignes :
 *
 *   1. LA CULBUTE. Le quad se referme sur sa largeur (cosinus d'un angle propre
 *      a chaque feuille) puis tourne dans le plan de l'ecran. Une feuille vue en
 *      permanence de face est une paillette ; c'est le passage par la TRANCHE,
 *      ce clignotement, qui dit qu'elle tombe en tournoyant.
 *
 *   2. LE PALIER AU SOL. La chute atteint le sol aux quatre cinquiemes du cycle
 *      et la feuille y reste jusqu'a la fin. Sans lui, aucune feuille ne touche
 *      jamais terre : il pleut des feuilles sur une prairie vierge, ce qui est
 *      exactement l'inverse de ce qu'un tapis d'automne raconte. Et elle se pose
 *      sur l'EAU aussi bien que sur l'herbe — une feuille qui coulerait dans un
 *      etang serait la premiere chose qu'on remarquerait.
 *
 *   3. LE CONTRE-JOUR. Une feuille seche est translucide. Face au soleil bas,
 *      elle s'allume comme un vitrail — c'est litteralement l'image qu'on vient
 *      chercher en octobre, et elle est gratuite : le meme produit scalaire que
 *      le pollen.
 *
 * ---
 *
 * Et elles suivent LA MEME RAFALE que le disque du joueur (cf. Weather.gustPush).
 * Quand la bourrasque deporte le surfeur vers la droite, le tapis de feuilles
 * part vers la droite avec lui. C'est ce couplage qui transforme un vent subi en
 * vent LU : on le voit venir dans les feuilles avant de le sentir dans les
 * commandes.
 */
export class Leaves {
  readonly mesh: Mesh;
  readonly mat: ShaderMaterial;
  /** Rayon du champ replie autour du joueur, en metres. */
  private readonly span = 34;

  constructor(count = 1600) {
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
      // Pas d'ecriture de profondeur : quelques centaines de quads translucides
      // qui s'ecrivent les uns sur les autres donnent des trous noirs des que
      // l'ordre de tri change, c'est-a-dire a chaque virage.
      depthWrite: false,
      uniforms: {
        ...riderUniforms(),
        ...terrainUniforms(),
        ...dayUniforms(),
        uOrigin: { value: new Vector3() },
        uTime: { value: 0 },
        uSpan: { value: this.span },
        /** Presence, 0..1. Zero = le monde n'a pas d'automne. */
        uDensity: { value: 0 },
        /** Force du vent du monde, en m/s. Elle emporte le tapis. */
        uWind: { value: 0 },
        uSun: { value: SUN_DIR.clone() },
        uLeafA: { value: vec3('leafRust') },
        uLeafB: { value: vec3('leafBlood') },
        uLeafC: { value: vec3('leafAmber') },
      },
      vertexShader: /* glsl */ `
${GLSL_SAFE}
        attribute vec4 iSeed;
        uniform vec3 uOrigin, uSun;
        uniform float uTime, uSpan, uDensity, uWind;
        varying vec2 vUv;
        varying vec3 vWorld;
        varying float vFace, vBack, vFade, vTone, vRest;

${WEATHER_GLSL}
        ${terrainGLSL()}

        void main(){
          // Un monde sans automne ne paie pas ses feuilles : le quad part hors
          // du volume de vue et le rasteriseur n'a rien a faire.
          if (uDensity < 0.004) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

          // --- Semis ancre en MONDE, replie autour du joueur. La feuille
          //     traverse le champ de vision, elle ne l'accompagne pas : c'est
          //     la meme regle que le pollen et les nuages, et c'est elle qui
          //     empeche le decor de coller a la camera.
          vec2 g;
          g.x = uOrigin.x + (fract(iSeed.x + uTime * 0.0031) - 0.5) * uSpan * 2.1;
          g.y = uOrigin.z + 14.0 - mod(uOrigin.z - (iSeed.z - 0.5) * uSpan * 3.0, uSpan * 2.2);

          // --- LA CHUTE, et son palier.
          float rate = 0.055 + fract(iSeed.w * 7.31) * 0.055;
          float fall = fract(iSeed.y + uTime * rate);
          // La rampe est CARREE, et c'est le reglage qui a tout change. Une
          // rampe lineaire repartit les feuilles uniformement sur onze metres
          // de hauteur : la ou la camera regarde — le premier metre — il n'en
          // reste qu'un dixieme, et on obtient une pluie de confettis au-dessus
          // d'une prairie vierge. Au carre, les trois quarts d'entre elles
          // vivent dans le metre du bas, et le tapis existe.
          float ramp = max(0.0, 1.0 - fall * 1.15);
          float h = ramp * ramp;
          vRest = 1.0 - smoothstep(0.008, 0.09, h);

          // --- La derive laterale, prise sur la MEME rafale que le disque.
          float push = gustPush(g, uTime) * uWind;
          // Une feuille au sol ne s'envole plus qu'a moitie ; en l'air elle
          // prend tout le vent. Et chacune a son propre battement, sinon le
          // tapis entier glisse d'un bloc comme une nappe.
          float grip = mix(1.0, 0.35, vRest);
          g.x += push * 0.42 * grip;
          g.x += sin(uTime * (0.9 + fract(iSeed.w * 3.17) * 1.6) + iSeed.y * 41.0) * 0.75 * grip;
          g.y += cos(uTime * (0.7 + fract(iSeed.x * 5.11) * 1.3) + iSeed.z * 27.0) * 0.55 * grip;

          vec3 p;
          p.xz = g;
          float d = length(g - uOrigin.xz);
          // Elle se pose sur le sol OU sur l'eau, celui des deux qui est le
          // plus haut. Une feuille qui coulerait dans un etang serait le
          // premier defaut qu'on remarquerait.
          float ground = max(terrainHeightAt(g, d), WATER_LEVEL);
          p.y = ground + 0.075 + h * 10.5;

          // --- La CULBUTE. Deux angles : la feuille se referme sur sa largeur,
          //     puis l'ensemble tourne dans le plan de l'ecran.
          float tumble = uTime * (0.8 + fract(iSeed.y * 9.13) * 2.1) + iSeed.z * 17.0;
          // Posee, elle ne tournoie plus : elle frissonne a plat.
          float face = mix(abs(cos(tumble)), 0.86, vRest);
          float spin = uTime * (0.9 + fract(iSeed.w * 13.7) * 2.2) * (1.0 - vRest * 0.8)
                     + iSeed.x * 31.0;

          vec3 toCam = cameraPosition - p;
          float dist = length(toCam);
          vec3 fwd = toCam / max(dist, 0.001);
          // nsafe : nul quand la camera est a la VERTICALE de la feuille, ce
          // qui arrive a chaque saut. Un NaN sort noir et contamine le bloom.
          vec3 right = nsafe(cross(vec3(0.0, 1.0, 0.0), fwd), vec3(1.0, 0.0, 0.0));
          vec3 up = cross(fwd, right);

          vec2 b = vec2(position.x * (0.20 + 0.80 * face), position.y);
          float cs = cos(spin), sn = sin(spin);
          vec2 q = vec2(b.x * cs - b.y * sn, b.x * sn + b.y * cs);

          // Taille en metres, avec un plancher qui croit avec la distance : une
          // feuille qui passe sous le pixel ne disparait pas, elle SCINTILLE.
          float s = 0.185 + fract(iSeed.w * 3.71) * 0.125 + dist * 0.0013;
          vec3 world = p + right * q.x * s * 1.15 + up * q.y * s;

          vFace = face;
          // A CONTRE-JOUR elle s'allume : une feuille seche est translucide, et
          // c'est toute l'image d'octobre. Le meme produit scalaire que le
          // pollen, pour la meme raison.
          // Exposant serre et dose basse : le lobe doit rester un CONTRE-JOUR
          // et non un eclairage. A l'exposant 3 il repeignait tout le tapis en
          // blanc des que le soleil entrait dans le cadre, ce qui est
          // precisement le moment ou l'on veut voir des feuilles.
          float toward = max(dot(normalize(-fwd), normalize(uSun)), 0.0);
          vBack = pow(max(toward, 1e-4), 6.0) * (1.0 - face * 0.45);

          // Fondu au ras de l'objectif : une feuille a deux metres de l'oeil
          // occupe un quart du cadre et devient un obstacle, pas un decor.
          vFade = smoothstep(uSpan * 1.25, uSpan * 0.5, dist) * smoothstep(1.4, 4.2, dist);
          // Le fondu de monde monte la densite : chaque feuille apparait pour
          // son compte plutot que par paliers, sinon le tapis surgit d'un bloc.
          vFade *= clamp((uDensity - fract(iSeed.w * 51.7)) * 5.0, 0.0, 1.0);
          // Fin de cycle : elle se dissout dans le tapis au lieu de sauter en
          // haut du ciel.
          vFade *= 1.0 - smoothstep(0.90, 1.0, fall);

          vTone = fract(iSeed.w * 17.3 + iSeed.x * 0.61);
          vWorld = world;
          vUv = uv;
          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uLeafA, uLeafB, uLeafC;
${GLSL_DAY}
        varying vec2 vUv;
        varying vec3 vWorld;
        varying float vFace, vBack, vFade, vTone, vRest;
${RIDER_GLSL}

        void main(){
          if (vFade < 0.004) discard;
          vec2 q = vUv * 2.0 - 1.0;

          // --- Silhouette. Une ellipse POINTUE aux deux bouts : un disque
          //     donnerait un confetti, un carre une paillette de plastique.
          float w = pow(max(1.0 - q.y * q.y, 1e-4), 0.62) * 0.66;
          if (abs(q.x) > w) discard;

          // Nervure centrale et nervures obliques. Elles ne se voient qu'au
          // premier plan, mais ce sont elles qui font lire « feuille » plutot
          // que « tache ocre » quand une passe devant la camera.
          float rib = smoothstep(0.11, 0.0, abs(q.x));
          float vein = smoothstep(0.70, 1.0, abs(sin(q.y * 9.0 + abs(q.x) * 6.5)));
          float edge = smoothstep(w, w * 0.5, abs(q.x));

          vec3 c = mix(uLeafA, uLeafB, smoothstep(0.0, 0.52, vTone));
          c = mix(c, uLeafC, smoothstep(0.52, 1.0, vTone));
          // Le BORD brunit avant le coeur : c'est le trait qui separe une
          // feuille morte d'un morceau de papier de couleur.
          c = mix(c * 0.52, c, edge);
          c = mix(c, c * 0.74, rib * 0.55);
          c *= 0.93 + vein * 0.15;
          // De face elle prend la lumiere, de tranche elle s'eteint.
          c *= 0.56 + 0.44 * vFace;
          // Posee, elle passe a l'ombre du sol : un tapis aussi lumineux que
          // les feuilles en vol brillerait comme une nappe de neon.
          c *= 1.0 - vRest * 0.18;

          c = daylight(c, 0.32 + uDayNight * 0.30);
          // Le vitrail : elle s'allume par transparence, et elle tire vers l'or
          // en le faisant. Une feuille a contre-jour n'est jamais de sa propre
          // couleur, elle est de la couleur de la lumiere qui la traverse.
          c += mix(uLeafA, vec3(1.0, 0.80, 0.42), 0.40) * vBack * 0.85;
          // La lampe du personnage, APRES l'eclairage de la scene : c'est une
          // source, elle ne participe pas a l'heure qu'il est.
          c += riderLight(vWorld) * 0.85;

          gl_FragColor = vec4(c, vFade);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    // Apres le sol et l'eau, avant le pollen et les nuages.
    this.mesh.renderOrder = 6;
  }

  update(origin: Vector3, time: number): void {
    this.mat.uniforms.uOrigin.value.copy(origin);
    this.mat.uniforms.uTime.value = time;
  }
}
