import { BackSide, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { GLSL_NOISE, GLSL_SAFE } from '../core/Noise';
import { colClone } from '../core/Palette';

/**
 * Dome de ciel. Degrade vertical cyan sature + gonflement lumineux vers l'horizon.
 * Pas de disque solaire : la reference n'en montre pas, seulement une lumiere diffuse
 * qui vient d'en haut a droite.
 */
/**
 * Direction du soleil.
 *
 * Il etait a 46 degres d'elevation ET 30 degres sur la droite : hors cadre en
 * permanence. En portrait le champ VERTICAL fait 62 degres mais l'horizontal
 * n'en fait que 37, soit 18 de chaque cote — un soleil place a 30 degres
 * d'azimut ne peut structurellement pas entrer dans l'image, on n'en voyait
 * qu'une lueur de coin.
 *
 * A 13 degres d'azimut et 19 d'elevation il est DANS le cadre, au-dessus de la
 * ligne de fuite. Deux consequences voulues : il brule (le bloom s'en charge)
 * et la plaine passe en CONTRE-JOUR — les cretes prennent un lisere et les
 * flancs se separent enfin les uns des autres.
 */
export const SUN_DIR = new Vector3(0.23, 0.33, -0.92).normalize();

export function createSky(): Mesh {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: colClone('skyZenith') },
      uHigh: { value: colClone('skyHigh') },
      uMid: { value: colClone('skyMid') },
      uHorizon: { value: colClone('skyHorizon') },
      uSun: { value: SUN_DIR.clone() },
      uNight: { value: 0 },
      uTime: { value: 0 },
      /**
       * 0 = ciel degage, 1 = plafond de nuages.
       *
       * Le soleil de ce dome n'est pas une lumiere, c'est un OBJET : un coeur
       * brulant, une couronne, une etoile a douze branches et une trainee
       * anamorphique. Baisser la puissance de la lumiere directe (cf. Daylight)
       * n'y touche pas d'un pouce — et c'est exactement ce qui est arrive au
       * monde d'octobre : un ciel de plomb, une lumiere a 0,58, et une etoile
       * de cinema en plein milieu. Un jour couvert n'a pas d'etoile ; il a une
       * TACHE CLAIRE derriere le plafond, et c'est tout ce qu'on lui laisse.
       */
      uOvercast: { value: 0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
${GLSL_SAFE}
${GLSL_NOISE}
      varying vec3 vDir;
      uniform vec3 uZenith, uHigh, uMid, uHorizon, uSun;
      uniform float uNight, uTime, uOvercast;

      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;
        vec3 sun = normalize(uSun);

        // --- Degrade a QUATRE etages.
        //
        // Trois suffisaient tant que le ciel restait cyan de haut en bas. Avec
        // un azur profond au zenith et un horizon presque blanc, l'ecart de
        // valeur est trop grand pour trois arrets : il apparait une bande dure
        // au milieu du cadre. Le quatrieme etage absorbe la transition.
        //
        // Les bornes se recouvrent volontairement : deux smoothstep qui se
        // touchent bout a bout laissent une cassure de derivee visible sur un
        // aplat aussi grand qu'un ciel.
        // Bande blanche RESSERREE. Etalee jusqu'a 10 degres d'elevation, elle
        // delavait tout le ciel a la hauteur exacte ou vivent les cumulus :
        // des nuages blancs sur un ciel blanc, il ne restait d'eux qu'un
        // contour. Le blanc ne doit tenir que les deux premiers degres.
        vec3 c = mix(uHorizon, uMid, smoothstep(-0.02, 0.06, h));
        c = mix(c, uHigh, smoothstep(0.04, 0.16, h));
        // Le haut du cadre plafonne vers 22 degres d'elevation, soit h = 0,37 :
        // si l'azur profond n'arrive qu'au zenith geometrique, on ne le voit
        // JAMAIS. La montee est calee pour qu'il occupe le haut de l'image.
        c = mix(c, uZenith, smoothstep(0.13, 0.50, h));

        // --- LES CIRRUS, ET C'EST LA COUCHE QUI MANQUAIT AU CIEL.
        //
        //     Le dome n'avait qu'un degrade et des cumulus. Un degrade n'a pas
        //     de profondeur — c'est un mur peint — et les cumulus vivent tous
        //     a la meme altitude, donc ils n'en donnent pas non plus. Il
        //     manquait l'etage du dessus : des voiles fibreux, dix fois plus
        //     hauts, dix fois plus lents, qui fuient vers l'horizon.
        //
        //     LA PROJECTION EST LE TOUT DU PROCEDE. Un bruit echantillonne sur
        //     la direction du regard s'enroule sur la sphere et donne des
        //     taches concentriques autour du zenith. Divise par la hauteur, il
        //     s'echantillonne sur un PLAN horizontal a altitude fixe — et un
        //     plan vu en perspective donne exactement ce qu'on cherche : des
        //     bandes qui s'ecrasent et se resserrent en approchant de
        //     l'horizon. C'est la meme projection qu'une route qui fuit.
        {
          float hh = max(h, 0.055);
          // Etirement fort dans l'axe du vent : un cirrus est une fibre, pas
          // un flocon. C'est l'anisotropie qui le distingue d'un cumulus, bien
          // avant sa couleur ou son altitude.
          vec2 pl = vec2(d.x / hh * 0.26, d.z / hh * 1.15) + vec2(uTime * 0.010, uTime * 0.026);
          float v = fbm2(pl * 0.42);
          v = smoothstep(0.50, 0.88, v) * smoothstep(0.42, 0.70, fbm2(pl * 0.11 + 4.7));
          // Ils meurent en bas (la brume les mange) et en haut (on y regarde a
          // travers trop peu d'air pour qu'ils s'accumulent).
          float band = smoothstep(0.05, 0.20, h) * (1.0 - smoothstep(0.40, 0.88, h));
          c = mix(c, mix(vec3(1.0), uHigh, 0.14), v * band * 0.52 * (1.0 - uOvercast));
        }

        // --- Soleil. Un halo etage plutot qu'un disque net : trois lobes de
        // duretes tres differentes donnent la diffusion atmospherique, la
        // couronne, puis le coeur. Un seul lobe fait une tache collee au ciel.
        float sd = max(dot(d, sun), 0.0);
        // Doses resserrees : au premier reglage le lobe large seul brulait un
        // quart du cadre et noyait l'etoile qu'il etait cense mettre en valeur.
        // Sous le plafond, seule la diffusion large survit — et elle survit
        // MEME renforcee : c'est elle qui fait la tache claire d'un jour gris.
        float clear = 1.0 - uOvercast;
        c += vec3(0.30, 0.44, 0.52) * pow(sd, 4.5) * 0.14;    // diffusion large
        c += vec3(0.62, 0.70, 0.66) * pow(sd, 70.0) * 0.42 * clear;   // couronne
        c += vec3(1.00, 0.97, 0.90) * pow(sd, 1600.0) * 2.1 * clear;  // coeur
        // La tache derriere les nuages : large, molle, et de la couleur du ciel
        // et non du soleil. C'est le seul indice qu'il reste de sa position.
        c += mix(uHorizon, vec3(1.0), 0.30) * pow(max(sd, 1e-4), 8.0) * 0.30 * uOvercast;

        // --- L'ETOILE. C'est la signature des references : un soleil qui ne
        // se contente pas de bruler, il envoie des branches. On les construit
        // dans le plan tangent au soleil pour qu'elles restent droites quel
        // que soit l'endroit du ciel ou l'on regarde ; calculees en espace
        // ecran, elles tourneraient avec le roulis de la camera.
        vec3 up = vec3(0.0, 1.0, 0.0);
        vec3 sx = nsafe(cross(up, sun), vec3(1.0, 0.0, 0.0));
        vec3 sy = cross(sun, sx);
        vec2 t = vec2(dot(d, sx), dot(d, sy));
        float r = length(t) + 1e-5;
        float ang = atan(t.y, t.x);

        // Six branches longues + six courtes decalees : une etoile a branches
        // toutes egales lit comme un flocon, pas comme un eblouissement.
        // abs(cos()) passe par zero a chaque quart de tour : bases plafonnees.
        float spikes = pow(max(abs(cos(ang * 3.0)), 1e-4), 22.0)
                     + 0.45 * pow(max(abs(cos(ang * 3.0 + 0.5236)), 1e-4), 34.0);
        float falloff = exp(-r * 19.0);
        c += vec3(1.00, 0.98, 0.92) * spikes * falloff * 1.9 * clear;

        // Trainee horizontale anamorphique, plus large et plus douce que les
        // branches : c'est elle qui donne le rendu "objectif de cinema".
        float streak = exp(-abs(t.y) * 190.0) * exp(-abs(t.x) * 7.0);
        c += vec3(0.72, 0.86, 1.00) * streak * 0.85 * clear;

        // --- Voile atmospherique juste au-dessus de l'horizon. Il blanchit la
        // bande basse et donne la profondeur : sans lui, la plaine se colle au
        // ciel au lieu de s'y enfoncer.
        float lowBand = pow(max(1.0 - clamp(abs(h) * 8.0, 0.0, 1.0), 1e-4), 2.4);
        c = mix(c, uHorizon, lowBand * 0.42);
        // Et un supplement de lumiere du cote du soleil, ou l'air diffuse le plus.
        c += vec3(0.30, 0.36, 0.38) * lowBand * pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(sun.x, 0.0, sun.z))), 1e-4), 3.0) * 0.55;

        // Sous l'horizon le dome ne doit jamais s'assombrir : le sol le recouvre,
        // mais les bords d'ecran en perspective large peuvent le laisser voir.
        c = mix(c, uHorizon * 1.02, smoothstep(0.0, -0.16, h));

        // --- LES ETOILES.
        //
        //     Une grille hachee, seuillee tres haut : on ne garde qu'une
        //     poignee de cellules sur mille, sinon on obtient du grain et non
        //     un ciel. Elles montent avec la nuit et s'eteignent pres de
        //     l'horizon, ou la brume les mangerait de toute facon.
        //
        //     Le scintillement est indexe sur la position ET sur le temps, avec
        //     une phase propre a chaque etoile : sans decalage, tout le ciel
        //     clignote a l'unisson et l'illusion tombe immediatement.
        if (uNight > 0.01) {
          vec2 sc = vec2(atan(d.z, d.x) * 2.4, d.y * 3.4) * 42.0;
          vec2 cell = floor(sc);
          float rnd = hash21(cell);
          float bright = smoothstep(0.9955, 1.0, rnd);
          // Un plafond de nuages cache aussi les etoiles.
          bright *= clear;
          if (bright > 0.0) {
            vec2 sub = fract(sc) - 0.5;
            float dot2 = 1.0 - smoothstep(0.0, 0.34, length(sub));
            float twink = 0.62 + 0.38 * sin(uTime * 2.1 + rnd * 88.0);
            float high = smoothstep(0.02, 0.30, d.y);
            c += vec3(0.92, 0.96, 1.0) * bright * dot2 * twink * high * uNight * 26.0;
          }
        }

        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const sky = new Mesh(new SphereGeometry(2000, 40, 24), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  return sky;
}
