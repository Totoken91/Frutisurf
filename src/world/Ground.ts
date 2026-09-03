import { BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector3 } from 'three';
import { RIDER_GLSL, riderUniforms } from './RiderLight';
import { GLSL_SAFE, GLSL_NOISE } from '../core/Noise';
import { vec3 } from '../core/Palette';
import { makeGrassTexture } from './GrassTexture';
import { SUN_DIR } from './Sky';
import { GLSL_DAY, dayUniforms } from './Daylight';
import { WEATHER_GLSL } from './Weather';
import { shoreGLSL, terrainGLSL, terrainUniforms } from './Terrain';
import { TOWN_GLSL } from './Town';

/**
 * La plaine, desormais vallonnee.
 *
 * Grille en EVENTAIL ancree sur le joueur : les rangees sont serrees devant lui
 * (1.2 m) puis s'ecartent geometriquement jusqu'a l'horizon, et leur largeur
 * croit avec la distance pour couvrir le champ de vision quel que soit le
 * rapport d'ecran. On concentre les sommets la ou ils comptent au lieu d'etaler
 * une grille reguliere sur des kilometres.
 *
 * La grille ne suit le joueur QUE en Z, et par pas entiers de la maille : sinon
 * les sommets glissent le long des pentes et le relief scintille. En X elle
 * reste fixe — le couloir de jeu fait +/-14 m, la grille est bien plus large.
 *
 * Les stries radiales, le gradient de valeur et le sheen du doc 01 sont
 * conserves tels quels ; seule la normale devient reelle, ce qui allume les
 * versants et rend les cretes LISIBLES — sans quoi on ne peut pas timer un saut.
 */

const SNAP = 1.2;
const Z_START = 45;
const Z_END = -2600;

function buildRows(near: number, growth: number): number[] {
  const rows: number[] = [];
  let z = Z_START;
  let step = near;
  while (z > Z_END) {
    rows.push(z);
    z -= step;
    if (z < -120) step = Math.min(step * growth, 70);
  }
  rows.push(Z_END);
  return rows;
}

function buildGeometry(dense: boolean): BufferGeometry {
  const rows = buildRows(dense ? SNAP : SNAP * 1.9, dense ? 1.045 : 1.07);
  const cols = dense ? 128 : 76;
  const R = rows.length;

  const pos = new Float32Array(R * cols * 3);
  const idx: number[] = [];

  for (let i = 0; i < R; i++) {
    const z = rows[i];
    // Largeur qui s'ouvre avec la distance : couvre aussi le 16:9 large.
    const half = 80 + 1.35 * (Z_START - z);
    for (let j = 0; j < cols; j++) {
      const t = j / (cols - 1);
      const o = (i * cols + j) * 3;
      pos[o] = (t - 0.5) * 2 * half;
      pos[o + 1] = 0;
      pos[o + 2] = z;
    }
  }
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      // Enroulement anti-horaire vu du dessus. L'ordre naif (a, c, b) donne
      // des faces tournees vers le BAS : la grille entiere disparait au
      // back-face culling et on voit le ciel a travers le sol.
      idx.push(a, b, c, b, d, c);
    }
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class Ground {
  readonly mesh: Mesh;
  readonly mat: ShaderMaterial;

  constructor(dense = true, detailRes = 512) {
    const grass = makeGrassTexture(detailRes);
    this.mat = new ShaderMaterial({
      fog: false,
      uniforms: {
        ...riderUniforms(),
        // Le relief est pilote par uniformes : changer de monde ne recompile
        // aucun shader (cf. Terrain.terrainGLSL).
        ...terrainUniforms(),
        uNear: { value: vec3('grassNear') },
        uMid: { value: vec3('grassMid') },
        uFar: { value: vec3('grassFar') },
        uHorizon: { value: vec3('grassHorizon') },
        uShadow: { value: vec3('grassShadow') },
        uStreak: { value: vec3('grassStreak') },
        uSun: { value: SUN_DIR.clone() },
        uCam: { value: new Vector3() },
        uOrigin: { value: new Vector3() },
        uTime: { value: 0 },
        uSpeed: { value: 0 },
        uGrass: { value: grass.texture },
        uCast: { value: new Vector3(0, 0, 0) },
        // Ce qui reste d'eclairage a l'ombre : le ciel, donc du BLEU. Une ombre
        // qui se contente d'assombrir est une ombre grise, et une ombre grise
        // en plein jour est le signe le plus sur d'un rendu qui triche.
        uSkyLight: { value: [0.32, 0.52, 0.72] },
        ...dayUniforms(),
        uSandDry: { value: vec3('sandDry') },
        uSandPale: { value: vec3('sandPale') },
        uSandWet: { value: vec3('sandWet') },
        uSandShell: { value: vec3('sandShell') },
        // Deux echelles pour casser la repetition. Les deux valeurs, multipliees
        // par 1000, donnent des entiers (620 et 85) : le sol replie sa
        // coordonnee Z modulo 1000 m, et un multiple non entier de la periode
        // de tuile y ferait une couture franche en travers de la plaine.
        uDetail: { value: grass.scale },
        uDetailFar: { value: 0.13 },
        /** 0 = prairie, 1 = dalle et grille neon. Le monde CHROME le met a 1. */
        uTech: { value: 0 },
        /**
         * 0 = sol sec, 1 = sous l'averse. Le monde OCTOBRE le met a 1.
         *
         * Ce n'est PAS un filtre de couleur : la pluie change l'OPTIQUE du sol.
         * Un sol mouille s'assombrit et se sature (le film d'eau piege la
         * lumiere diffuse), il rend le ciel a l'incidence rasante au lieu de
         * verdir, son speculaire s'elargit, et il retient des flaques dans ses
         * creux plats. Repeindre l'herbe en gris n'aurait donne qu'une prairie
         * sale ; c'est le passage du diffus au SPECULAIRE qui dit « il pleut ».
         */
        uWet: { value: 0 },
        /**
         * LE TAPIS DE FEUILLES, peint dans le sol. 0..1.
         *
         * Il n'est pas fait de feuilles, et c'est le point. Un tapis credible
         * en demande des dizaines de milliers au metre carre ; le systeme de
         * particules (cf. Leaves.ts) en pose quelques centaines dans tout le
         * champ de vision — assez pour qu'on en voie TOMBER, jamais assez pour
         * qu'on marche dessus. La division du travail est donc celle-ci : les
         * particules font les feuilles qui tombent, le sol fait celles qui sont
         * DEJA tombees. Chacune est bonne exactement la ou l'autre ne l'est pas.
         */
        uLitter: { value: 0 },
        /** Les deux tons du tapis. Les MEMES que ceux des feuilles en vol. */
        uLeafA: { value: vec3('leafRust') },
        uLeafB: { value: vec3('leafBlood') },
        /**
         * LE QUARTIER, vu depuis le sol. 0..1.
         *
         * Deux choses que le decor ne peut pas faire lui-meme, parce qu'il ne
         * connait pas le pixel de sol qu'il touche : la ROUTE, et surtout la
         * FLAQUE DE LUMIERE au pied de chaque lampadaire. Un lampadaire qui
         * n'eclaire rien est un poteau ; c'est ce qu'il pose par terre qui en
         * fait une lampe, et c'est encore plus vrai sur de l'asphalte mouille.
         */
        uTown: { value: 0 },
        uLamp: { value: vec3('townWindow') },
        /**
         * 0 = ciel degage, 1 = plafond de nuages.
         *
         * Sous un plafond, l'essentiel de l'eclairement vient du DOME et non du
         * soleil. Un ombrage qui reste pilote par N·L donne alors un relief en
         * carton : des versants francs sous une lumiere qui n'existe pas, et un
         * paysage qui a l'air d'attendre un soleil qui ne viendra jamais.
         */
        uOvercast: { value: 0 },
      },
      vertexShader: /* glsl */ `
        uniform vec3 uOrigin;
        varying vec3 vWorld;
        varying vec3 vNormal;

        ${terrainGLSL()}

        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          float d = length(wp.xz - uOrigin.xz);
          wp.y = terrainHeightAt(wp.xz, d);
          vWorld = wp.xyz;
          vNormal = terrainNormalAt(wp.xz, d);
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
${GLSL_SAFE}
        varying vec3 vWorld;
        varying vec3 vNormal;
        uniform vec3 uNear, uMid, uFar, uHorizon, uShadow, uStreak, uSun, uCam;
        uniform vec3 uSandDry, uSandPale, uSandWet, uSandShell;
${GLSL_DAY}
        uniform vec3 uOrigin;
        uniform float uTime, uSpeed;
        uniform sampler2D uGrass;
        uniform float uDetail, uDetailFar;
        uniform float uTech, uWet, uLitter, uTown, uOvercast;
        uniform vec3 uLeafA, uLeafB, uLamp;
${RIDER_GLSL}
        /** xz = centre de l'ombre projetee du surfeur, y = sa hauteur de vol. */
        uniform vec3 uCast;
        uniform vec3 uSkyLight;

        ${GLSL_NOISE}
        ${WEATHER_GLSL}
        ${terrainGLSL()}
${shoreGLSL()}
${TOWN_GLSL}

        /**
         * POURQUOI IL N'Y A PAS D'OMBRE PORTEE DU RELIEF, ET LA MESURE.
         *
         * L'idee est bonne et le terrain s'y prete : il est ANALYTIQUE, donc on
         * peut marcher le rayon solaire dessus et obtenir la vraie ombre, sans
         * carte d'ombres, sans biais et sans resolution. Ecrit, teste, teint en
         * rouge vif pour le voir : il ne couvrait PAS UN PIXEL.
         *
         * La cause n'est pas dans le code, elle est dans la geometrie. Les
         * pentes de ce terrain plafonnent vers onze degres en usage courant —
         * chaque couche apporte une pente amplitude x frequence de l'ordre de
         * 0,12 a 0,17, et elles ne s'alignent presque jamais. Le soleil, lui,
         * monte a trente-trois degres au zenith de ce cycle. Un rayon plus
         * redresse que le terrain ne rencontre rien, jamais.
         *
         * Meme en plafonnant artificiellement le rayon a seize degres — la
         * triche classique de l'ombre allongee — la mesure restait blanche. Il
         * aurait fallu descendre vers six degres, c'est-a-dire un couchant
         * permanent, et assombrir la moitie de la plaine pour un effet qu'on
         * n'a pas demande.
         *
         * Six evaluations de terrain par pixel, soit le poste le plus cher du
         * shader, pour rien : le terme est retire. La lecon vaut d'etre ecrite,
         * parce que l'effet est tentant et que rien dans le code ne dit qu'il
         * ne peut pas marcher — seule la mesure le dit.
         */
        void main(){
          // Coordonnees de texture repliees modulo la periode du bruit : la
          // position monde croit sans borne et finirait par perdre en precision.
          vec2 p = vec2(vWorld.x, mod(vWorld.z, 1000.0));
          float dist = length(vWorld.xz - uCam.xz);

          // --- Normale recalculee PAR PIXEL.
          //
          // La normale de sommet interpolee laissait des bandes horizontales
          // franches en travers de la plaine : la grille est en eventail, ses
          // rangees lointaines font des dizaines de metres de profondeur, et
          // interpoler une normale sur un triangle aussi grand casse a chaque
          // rangee. Le terrain etant analytique, son gradient l'est aussi : le
          // recalculer ici coute quelques cosinus et rend un relief NET.
          vec3 N = terrainNormalAt(vWorld.xz, length(vWorld.xz - uOrigin.xz));
          // La pente AVANT le micro-relief des brins. Les flaques se posent sur
          // ce qui est plat a l'echelle du terrain, pas sur ce qui est plat a
          // l'echelle d'une touffe d'herbe : lue apres, la normale perturbee
          // aurait sable les flaques en confettis de dix centimetres.
          float macroFlat = N.y;

          // --- Profondeur normalisee : asymptotique, jamais de coupure franche.
          //     A 95 m d'echelle, la plaine etait entierement noyee dans la
          //     brume passe 150 m : plus aucune structure au-dela du premier
          //     plan, et un aplat pale sur les deux tiers du cadre.
          float f = 1.0 - exp(-dist / 175.0);

          // --- Moucheture ISOTROPE.
          //
          //     L'ancien motif etait un bruit ecrase ~70x le long de Z : des
          //     traits interminables dans l'axe de la course, qui en
          //     perspective se lisaient comme des rayures verticales collees a
          //     l'ecran. Un motif de fond d'ecran, pas une prairie.
          //
          //     Deux octaves de bruit aux MEMES frequences en x et en z : les
          //     taches sont rondes, elles defilent avec le sol au lieu de
          //     glisser dessus, et rien n'a plus de direction privilegiee.
          // Trois octaves pour le motif fin, deux pour le motif large : au-dela
          // le detail tombe sous le pixel. Mesure : le sol represente 39 % de
          // l'image, et ces deux appels en etaient la plus grosse part.
          float m1 = fbm3(vec2(p.x * 0.062, p.y * 0.062));
          float m2 = fbm2(vec2(p.x * 0.021, p.y * 0.021));
          float streak = m1 * 0.55 + m2 * 0.45;
          // --- LE GAIN, ET C'EST LUI QUI DECIDE DE TOUT.
          //
          //     Ces deux champs ont une moyenne de 0,48 et un ecart-type de
          //     l'ordre du dixieme ; les moyenner le reduit encore. A 1,32 la
          //     strie ne parcourait donc qu'un QUART de la plage disponible,
          //     alors que les deux couleurs qu'elle melange (l'ombre et la
          //     strie) sont separees de cent niveaux. Mesure sur capture : du
          //     bas du cadre au tiers superieur du sol, la luminance de la
          //     plaine variait de 184 a 192 — trois pour cent. Un aplat.
          //
          //     Ce qui manquait au premier plan n'etait pas du DETAIL — le
          //     grain de brin y est deja — c'etait de la VALEUR. Le meme
          //     diagnostic que le tapis de feuilles d'octobre, et le meme
          //     remede : caler le gain sur la statistique du champ, pas a vue.
          streak = mix(0.5, streak, 2.9 + uSpeed * 0.7);
          streak = clamp(streak, 0.0, 1.0);

          // --- Gradient de valeur : CLAIR au loin, SOMBRE au premier plan.
          //     C'est lui qui porte toute la profondeur de la plaine, donc il
          //     doit rester le terme dominant — tout ce qui vient apres ne fait
          //     que le moduler.
          vec3 c = mix(uNear, uMid, smoothstep(0.02, 0.30, f));
          c = mix(c, uFar, smoothstep(0.26, 0.60, f));
          c = mix(c, uHorizon, smoothstep(0.46, 0.92, f));

          c = mix(mix(c, uShadow, 0.30), mix(c, uStreak, 0.55), streak);

          // --- ET UNE VARIATION DE TEINTE, PAS SEULEMENT DE VALEUR.
          //
          //     La strie ne melange que deux couleurs de la palette : elle fait
          //     donc varier la LUMINOSITE du sol sans jamais en changer la
          //     couleur, et un pre entier reste une seule teinte plus ou moins
          //     eclairee. Aucune prairie ne ressemble a ca — il y a de l'herbe
          //     jeune, de l'herbe seche, de la terre qui affleure, et c'est
          //     leur cohabitation qui donne sa richesse a un champ.
          //
          //     Une rotation de teinte suffit, sur une echelle differente de
          //     celle de la strie (soixante metres contre seize) : superposees
          //     a la meme frequence, les deux se confondraient en une seule
          //     tache et on n'aurait rien gagne.
          {
            float tint = fbm2(vec2(p.x * 0.017 + 31.7, p.y * 0.017));
            float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
            //   Vers le CHAUD d'un cote, vers le FROID de l'autre, autour du
            //   gris de meme luminance : la teinte tourne, la valeur ne bouge
            //   pas. C'est ce qui evite que la variation se lise comme des
            //   taches sales.
            vec3 warm = mix(c, vec3(lum) * vec3(1.14, 1.02, 0.80), 0.55);
            vec3 cool = mix(c, vec3(lum) * vec3(0.84, 1.04, 1.06), 0.55);
            c = mix(c, mix(cool, warm, smoothstep(0.36, 0.64, tint)),
                    0.34 * (1.0 - uTech));
          }

          // --- LES BRINS.
          //
          //     Deux echantillons de la MEME tuile a des echelles tres
          //     differentes : le premier donne le brin (1,6 m de periode), le
          //     second casse la repetition sur 11,8 m. Un seul echantillon et
          //     l'oeil voit la grille de tuiles au bout de trois secondes.
          //
          //     Ce bloc remplace deux appels de bruit fractal : c'est a la fois
          //     plus juste ET moins cher. Une texture avec mipmaps se filtre
          //     toute seule la ou un bruit procedural se met a scintiller des
          //     que le motif passe sous le pixel.
          float detail = 1.0 - smoothstep(0.06, 0.52, f);
          vec4 g0 = texture2D(uGrass, p * uDetail);
          vec4 g1 = texture2D(uGrass, p * uDetailFar);
          float blade = mix(0.5, g0.a * 0.72 + g1.a * 0.28, detail);
          float tuft = mix(0.5, g0.b * 0.55 + g1.b * 0.45, detail);

          //     Albedo : les touffes exposees sont plus claires, les creux
          //     entre elles plus sombres et plus satures.
          //     Amplitude ROUVERTE (0,84 au lieu de 0,93) : c'est l'occlusion
          //     de la canopee, et c'est elle qui donne sa matiere au premier
          //     plan. Une herbe dont les creux ne sont pas plus sombres que
          //     les touffes est une moquette.
          c = mix(c * 0.84, mix(c, uStreak, 0.26) * 1.07, tuft);
          c *= 0.94 + 0.13 * blade;

          // --- Bandes de defilement : la lecture de vitesse
          float band = sin(p.y * 0.201) * 0.5 + 0.5;
          c = mix(c, c * 1.16, band * (0.030 + uSpeed * 0.045) * (1.0 - f * 0.55));

          // --- L'ASSOMBRISSEMENT DE PROXIMITE.
          //
          //     L'herbe sous les pieds n'est pas vue de DESSUS mais de BIAIS :
          //     on regarde DANS la canopee, entre les brins, et non sur leurs
          //     pointes. Elle est donc plus sombre que la meme herbe a
          //     cinquante metres, et c'est un indice de profondeur qu'aucune
          //     texture ne remplace — sans lui, le bas du cadre est une dalle
          //     de couleur posee devant un paysage.
          //
          //     Ancre sur la DISTANCE, donc il defile avec le sol : une
          //     vignette d'ecran ferait la meme tache mais collee a l'oeil, et
          //     l'oeil la lit immediatement comme un filtre.
          float closeUp = 1.0 - smoothstep(0.02, 0.26, f);
          c *= mix(1.0, 0.80, closeUp);

          // --- Relief. Sans ces deux termes on ne voit pas ou est le sommet,
          //     donc on ne peut pas le timer : c'est de la lisibilite de jeu,
          //     pas de la decoration.
          //     La NORMALE des brins, c'est elle qui fait l'herbe. Avec un
          //     soleil bas et de face, ce sont les micro-facettes qui accrochent
          //     la lumiere ; aucune quantite de bruit sur la couleur ne
          //     remplacerait ce terme.
          //     Dose PRUDENTE : a 1,55 le relief passait de l'herbe au cuir
          //     craquele. Le micro-relief doit accrocher la lumiere, pas
          //     sculpter le sol.
          //     SEUL l'echantillon fin porte le relief. L'echantillon large
          //     n'est la que pour casser la repetition de la couleur ; lui
          //     donner du relief sculptait des plaques de dix metres et le sol
          //     prenait un aspect de crepi.
          vec2 micro = (g0.rg - 0.5) * 0.55 * detail;
          N = normalize(N + vec3(micro.x, 0.0, micro.y));

          vec3 L = normalize(uSun);
          float ndl = dot(N, L);

          // 1. Versants FACE A LA CAMERA plus clairs que les versants de dos.
          //    C'est le terme le plus lisible sur un relief doux : il dessine
          //    le flanc proche de chaque colline. Ancre en espace monde, donc
          //    il ne pulse pas quand le joueur monte ou descend — un tint
          //    d'altitude relatif au joueur ferait respirer tout le paysage.
          c *= 0.88 + 0.24 * clamp(N.z, -1.0, 1.0);

          // 2. Teinte d'ALTITUDE. Le terme le plus rentable de tout le shader.
          //
          //    Les pentes du terrain plafonnent vers 11 degres : la normale ne
          //    s'ecarte presque jamais de la verticale, et un ombrage qui ne
          //    depend que d'elle rend une plaine plate quoi qu'on fasse. La
          //    HAUTEUR, elle, varie de treize metres d'un creux a une crete.
          //    En la lisant sur une plage serree, chaque vallon se colore et
          //    le relief se lit d'un coup d'oeil, comme sur une carte ombree.
          c = mix(c * 0.86, c * 1.14, smoothstep(-6.0, 6.0, vWorld.y));

          // 3. Ombrage directionnel, franc. Le soleil est bas et devant : les
          //    seuils sont cales sur cette plage-la, pas sur un zenith.
          // Plage RESSERREE autour de la valeur de travail : avec un soleil a
          // 19 degres et un sol presque plat, ndl vit entre 0,18 et 0,48. Une
          // rampe large sur [-0.28, 0.58] n'en exploitait qu'un tiers.
          //     ET SOUS UN PLAFOND, ELLE N'A PLUS DE DIRECTION DU TOUT.
          //
          //     Le ciel couvert eclaire par le DOME : ce qui decide de la
          //     luminance d'un point n'est plus l'angle au soleil mais son
          //     OUVERTURE VERS LE HAUT. On fond donc la rampe directionnelle
          //     vers une rampe en N.y, et on ajoute une ambiante franche prise
          //     sur le remplissage du ciel. C'est ce qui separe un jour gris
          //     d'un jour de soleil assombri — et c'est la seule chose qui
          //     manquait vraiment a la lumiere d'octobre.
          float lambert = 0.78 + 0.34 * smoothstep(0.10, 0.52, ndl);
          float dome = 0.80 + 0.30 * clamp(N.y, 0.0, 1.0);
          c *= mix(lambert, dome, uOvercast);


          c += uDayFill * (0.045 + 0.11 * clamp(N.y, 0.0, 1.0)) * uOvercast;
          // Les versants exposes accrochent un lisere clair sur la crete — mais
          // pas sous les nuages : un lisere de soleil sans soleil est la faute
          // qui trahit un eclairage peint.
          c += uHorizon * 0.20 * smoothstep(0.26, 0.72, ndl) * (1.0 - f * 0.5)
             * (1.0 - uOvercast * 0.75);

          // --- L'OCCLUSION DE RELIEF, ET C'EST ELLE QUI DONNE DU VOLUME AUX
          //     COLLINES.
          //
          //     Le probleme se voit sur n'importe quelle capture large : les
          //     collines a cent metres ont exactement la meme valeur que le pre
          //     sous les pieds, donc le paysage est PLAT. Le terme diffus n'y
          //     peut rien — les pentes du jeu font sept degres de moyenne, et
          //     sept degres ne separent pas deux versants.
          //
          //     Les vraies ombres portees non plus : elles ont ete essayees, et
          //     retirees, precisement pour cette raison (voir le long
          //     commentaire plus bas). Ce qui reste, et qui suffit, est
          //     l'occlusion de forme : un fond de vallon voit moins de ciel
          //     qu'une crete, donc il est plus sombre et plus froid. C'est vrai
          //     par temps couvert comme en plein soleil, ce qui en fait le seul
          //     terme d'ombrage sur lequel on puisse compter dans les cinq
          //     mondes.
          //
          //     LA MESURE DU CREUX EST GRATUITE, et c'est ce qui rend le terme
          //     abordable. terrainHeightAt prend une DISTANCE, et s'en sert
          //     pour eteindre les couches fines ; l'appeler avec une grande
          //     distance rend donc le relief LISSE, ses grandes ondulations
          //     seules. L'ecart entre la hauteur reelle et cette version lissee
          //     EST le creux, sans un seul echantillon supplementaire du bruit.
          {
            float macro = terrainHeightAt(vWorld.xz, 900.0);
            float bowl = clamp((vWorld.y - macro) * 0.42, -1.0, 1.0);
            // Le creux assombrit et REFROIDIT, la bosse eclaire et rechauffe.
            // Une occlusion qui ne fait que baisser la valeur se lit comme un
            // voile gris ; celle qui deplace aussi la teinte se lit comme de la
            // lumiere, parce que c'est ce que fait le ciel.
            c *= 1.0 + bowl * 0.20;
            c = mix(c, c * vec3(0.88, 0.94, 1.06), max(-bowl, 0.0) * 0.55);
            // Et la crete prend le ciel de plein fouet.
            c += uSkyLight * max(bowl, 0.0) * 0.055 * (1.0 - uOvercast * 0.4);
          }

          // --- L'ECLAT DE L'HERBE, ET C'EST CE QUI EN FAIT UNE MATIERE.
          //
          //     Un sol qui n'a qu'un albedo et un ombrage diffus est une
          //     COULEUR posee sur une forme : il ne renvoie rien, donc rien ne
          //     dit de quoi il est fait. Un brin d'herbe est une lame lisse et
          //     cireuse — c'est la premiere chose qu'on voit d'un pre a
          //     contre-jour, et c'est ce qui manquait ici.
          //
          //     Le speculaire est LARGE (exposant 26) parce qu'un brin n'est
          //     pas un miroir, et il est module par le micro-relief des brins :
          //     ce sont les touffes exposees qui accrochent, jamais les creux.
          //     C'est cette correlation qui le fait lire comme de l'herbe et
          //     non comme un vernis.
          {
            vec3 V2 = nsafe(uCam - vWorld, vec3(0.0, 1.0, 0.0));
            vec3 H = nsafe(V2 + L, vec3(0.0, 1.0, 0.0));
            float sheen = pow(max(dot(N, H), 1e-4), 26.0);
            //   Il n'existe qu'au PREMIER PLAN. Au-dela, la lame passe sous le
            //   pixel : ce qui reste n'est plus un eclat, c'est du bruit qui
            //   scintille a chaque pas de camera.
            c += uDayLight * sheen * (0.30 + blade * 0.85) * detail * 0.55
               * (1.0 - uOvercast * 0.85);
          }

          // --- 4. Grandes nappes de lumiere.
          //
          //     C'est le trait le plus present des references : la prairie
          //     n'est jamais d'un vert uniforme, de larges plages claires la
          //     traversent, comme des trouees entre des nuages. Ancrees en
          //     monde et tres basse frequence (150 a 400 m), elles defilent
          //     avec le paysage et donnent son echelle a la plaine.
          //     Un seul champ basse frequence pour deux roles : les grandes
          //     plages de lumiere ET les taches de prairie. Il y en avait deux,
          //     de frequences voisines, qui se contrariaient — l'un eclaircissait
          //     ou l'autre assombrissait — et le resultat etait un vert boueux
          //     pour le prix de vingt octaves de bruit par pixel.
          vec2 sweepUv = vec2(vWorld.x * 0.0042 + vWorld.z * 0.0016, vWorld.z * 0.0068);
          // Frequence 0,005 : la cinquieme octave de ce champ a une periode de
          // douze centimetres monde, invisible a cette echelle.
          float sweep = fbm2(sweepUv);
          // Dose asymetrique : on ASSOMBRIT plus qu'on n'eclaircit. Eclaircir
          // fort delave le vert electrique qui fait l'identite du jeu, alors
          // qu'une plage d'ombre lui redonne du contraste sans rien lui oter.
          float lightPool = smoothstep(0.46, 0.86, sweep);
          float shade = smoothstep(0.50, 0.10, sweep);
          c = mix(c, mix(c, uStreak, 0.20) * 1.12, lightPool * 0.75);
          c = mix(c, c * 0.88, shade * 0.50);

          // --- Bandes de tonte, EN TRAVERS de la course.
          //     Alignees sur x, elles dessinaient elles aussi des rayures
          //     verticales a l'ecran. En travers, elles defilent vers le joueur
          //     et servent au passage de lecture de vitesse. Ondulees pour ne
          //     pas ressembler a un passage pieton.
          float mow = sin(vWorld.z * 0.052 + sin(vWorld.x * 0.013) * 2.2) * 0.5 + 0.5;
          c *= 1.0 + (smoothstep(0.35, 0.65, mow) - 0.5) * 0.09 * (1.0 - f * 0.6);

          // --- Sheen laque : il allume la bande d'horizon
          vec3 V = nsafe(uCam - vWorld, vec3(0.0, 1.0, 0.0));
          float graze = pow(max(1.0 - clamp(dot(N, V), 0.0, 1.0), 1e-4), 4.5);
          // Sous la pluie ce lisere n'est plus de la chlorophylle mais du
          // CIEL : un sol mouille renvoie ce qu'il y a au-dessus de lui a
          // l'incidence rasante, il ne verdit pas.
          c += mix(vec3(0.07, 0.22, 0.15), uDayFill * 0.55, uWet) * graze * (0.50 + uWet * 0.80);

          //     Gloss Frutiger Aero : le speculaire est MASQUE par les brins.
          //     Une plaine qui brille uniformement lit comme du plastique ; ce
          //     sont les pointes qui doivent scintiller, pas la surface.
          vec3 H = normalize(V + L);
          float spec = pow(max(dot(N, H), 1e-4), 62.0);
          c += mix(vec3(0.26, 0.34, 0.24), uDayLight * 0.70, uWet)
             * spec * (0.28 + blade * 1.05 + uWet * 1.10);

          //     Et un lisere sur les pointes vues de biais : c'est ce qui donne
          //     le duvet argente d'une prairie a contre-jour.
          c += vec3(0.30, 0.40, 0.26) * graze * blade * detail * 0.55 * (1.0 - uWet * 0.7);

          // --- OMBRES DE NUAGES.
          //
          //     Elles ne s'attenuent pas avec la distance : c'est au loin
          //     qu'elles font le travail, en donnant au paysage une echelle
          //     qu'un eclairage uniforme lui refuse.
          // Nom distinct : shade est DEJA pris par la plage d'ombre des
          // nappes de lumiere, quarante lignes plus haut et dans la meme
          // portee. La redeclaration cassait la compilation du shader et le
          // sol ne se dessinait plus DU TOUT : ce qu'on voyait a sa place
          // etait le dome de ciel, d'ou l'image entierement delavee.
          // (Et pas d'accent grave dans ces commentaires : ils vivent dans un
          //  gabarit JS, un seul backtick termine la chaine.)
          float cloudDark = cloudShade(vWorld.xz, uTime);
          // SOUS UNE COUVERTURE TOTALE, IL N'Y A PLUS D'OMBRE DE NUAGE.
          // Une tache d'ombre suppose une trouee a cote ; quand le plafond est
          // ferme, la lumiere est diffuse et le sol est uniformement eclaire.
          // Garder les taches sous l'averse retirait quarante pour cent de la
          // luminance d'octobre, et par-dessus le voile et le sol mouille il ne
          // restait rien a regarder.
          c = mix(c, c * 0.62 + uSkyLight * 0.055,
                  cloudDark * 0.85 * (1.0 - uOvercast * 0.75));

          // --- OMBRE PORTEE DU SURFEUR.
          //
          //     Analytique : une ellipse molle centree sur la projection du
          //     disque le long des rayons du soleil. Une carte d'ombre pour un
          //     seul objet couterait une passe entiere et un tampon de plus,
          //     pour un resultat qu'une distance au centre decrit exactement.
          //     Elle s'elargit et palit avec l'altitude — c'est elle qui dit au
          //     joueur a quelle hauteur il vole.
          //     Nom : PAS "cast", qui est un mot reserve en GLSL ES. Le
          //     projet s'est deja fait avoir avec "patch".
          //
          //     ET ELLE DOIT ETRE PLUS LARGE QUE CE QU'ELLE PROJETTE. A 1,15 m
          //     de rayon, elle etait plus PETITE que le disque : au sol, ou le
          //     decalage solaire est nul, elle passait entierement dessous et
          //     n'existait pour personne. Verifie en la peignant en rouge vif :
          //     la tache tombait pile sous le CD et le CD la couvrait. Mesure sur capture : une ligne de
          //     pixels traversant le point de contact ne variait pas d'un
          //     niveau. Le personnage flottait au-dessus de la plaine dans les
          //     cinq mondes, et c'est le premier defaut qu'on voit sans savoir
          //     le nommer.
          //
          //     Le projeteur n'est pas le disque seul : c'est le buddy entier,
          //     un volume d'un metre soixante de large et de deux metres de
          //     haut. Deux metres de rayon, une penombre longue, et le contact
          //     se lit enfin.
          float sr = length(vWorld.xz - uCast.xz) / (3.2 + uCast.y * 0.55);
          float drop = (1.0 - smoothstep(0.10, 1.0, sr)) * exp(-uCast.y * 0.15);
          // Elle n'est PAS appliquee ici : voir la fin du shader. Une ombre
          // posee avant la lampe du personnage est effacee par elle.

          // --- Rafale : le passage de la vague eclaircit brievement l'herbe,
          //     les brins se couchant montrent leur face lisse au soleil.
          //
          //     A 0,055 et modulee par le facteur de detail, elle n'existait qu'au
          //     premier plan et n'y valait que cinq pour cent : autant dire rien.
          //     c'est LA chose qui distingue un pre d'un tapis — une vague de
          //     lumiere qui traverse tout le champ, jusqu'a l'horizon. Elle
          //     garde une part de detail (les brins proches reagissent plus,
          //     ce qui est vrai) mais elle ne s'y reduit plus.
          {
            float g = gustAt(vWorld.xz, uTime);
            c *= 1.0 + g * (0.055 + 0.10 * detail);
            // La face lisse d'un brin couche renvoie le ciel, pas l'herbe : la
            // vague DESATURE en meme temps qu'elle eclaircit, et c'est ce
            // decalage de teinte qui la fait lire comme du vent et non comme
            // une variation d'albedo.
            c = mix(c, mix(c, uSkyLight, 0.20), g * 0.55 * (1.0 - uOvercast * 0.5));
          }

          // --- Brume d'horizon. Elle separe les plans lointains les uns des
          //     autres : sans elle, des collines a 300 m et a 900 m ont
          //     exactement la meme valeur et le relief s'aplatit.
          // Sous l'averse la brume d'horizon EST le ciel : c'est la meme regle
          // que la brume de la ville, qui relit deja l'horizon plutot qu'une
          // couleur fixe. Les mondes secs gardent exactement leur teinte.
          c = mix(c, mix(uHorizon, mix(vec3(0.62, 0.92, 0.86), uDayFill, uWet), 0.35),
                  smoothstep(0.50, 0.99, f) * 0.42);

          // --- LA PLAGE.
          //
          //     L'herbe s'arretait net sur la ligne de flottaison : une decoupe
          //     a la courbe de niveau, parfaitement reguliere, qui se lisait
          //     comme un lisere peint. Ce qui fait une greve naturelle, c'est
          //     qu'elle n'a PAS de largeur constante — elle s'etale dans les
          //     creux, se pince sur les pointes, et sa limite haute est
          //     dechiquetee par les langues de sable qui remontent dans l'herbe.
          //
          //     On obtient tout ca en perturbant la HAUTEUR avant de la seuiller,
          //     plutot qu'en adoucissant le seuil. Adoucir donnerait un degrade
          //     regulier ; perturber donne une cote.
          float above = vWorld.y - WATER_LEVEL;

          // Largeur de la greve : basse frequence, donc elle varie sur des
          // centaines de metres, comme un littoral.
          // Attention : cette largeur est une HAUTEUR, pas une distance au sol.
          // Sur une pente douce elle donne une greve large, sur une pente raide
          // un simple lisere — ce qui est exactement le comportement d'une vraie
          // cote, mais il faut la calibrer genereusement pour qu'elle se voie
          // meme la ou le relief plonge.
          float shoreWide = shoreWidth(vWorld.xz);
          float sand = shoreMask(vWorld.xz, above);

          if (sand > 0.002) {
            // Le sable MOUILLE n'est pas du sable sec assombri : il est plus
            // sature et plus froid, parce que le film d'eau lui renvoie le ciel.
            // Assombrir seulement donnerait de la boue.
            float dryness = smoothstep(-0.1, shoreWide * 0.55, above);
            vec3 sc = mix(uSandWet, uSandDry, dryness);
            sc = mix(sc, uSandPale, smoothstep(0.45, 1.0, dryness) * 0.55);

            // Le GRAIN, sur TROIS echelles, et c'est la premiere qui compte le
            // plus. Les deux fines ne survivent qu'au premier plan : au-dela
            // elles passent sous le pixel, s'y moyennent, et la greve redevient
            // un aplat beige. Une variation LARGE — des plaques de sable plus
            // clair et plus sombre sur une dizaine de metres — reste lisible a
            // toute distance, et c'est elle qui empeche l'aplat.
            // Nomme broad, et surtout PAS patch : patch est un mot RESERVE
            // en GLSL ES, comme cast avant lui. Troisieme fois que ce piege
            // coute une session : un maillage qui ne compile pas disparait
            // sans un mot d'explication.
            float broad = fbm2(vWorld.xz * 0.085);
            float coarse = fbm3(vWorld.xz * 1.7);
            float fine = fbm2(vWorld.xz * 9.0);
            sc *= 0.86 + broad * 0.24 + coarse * 0.14 * detail + fine * 0.09 * detail;
            // Les plaques les plus claires tirent vers le blanc chaud : du sable
            // sec souffle par le vent, qui s'accumule en haut de greve.
            sc = mix(sc, uSandPale, smoothstep(0.60, 0.92, broad) * dryness * 0.45);

            // La LAISSE DE MER : les lignes que la mer laisse en se retirant.
            // Elles suivent la ligne de flottaison, donc la hauteur, et c'est
            // le detail qui dit « plage » plutot que « terrain beige ».
            // La MEME dentelure que le masque de plage, relue depuis Terrain :
            // une laisse de mer qui suivrait un autre bruit traverserait le
            // sable en diagonale au lieu de longer l'eau.
            float ragged = shoreRagged(vWorld.xz);
            float tide = sin((above + ragged * 0.35) * 5.4) * 0.5 + 0.5;
            tide = smoothstep(0.48, 0.96, tide) * (1.0 - dryness * 0.7);
            sc = mix(sc, sc * vec3(0.82, 0.81, 0.86), tide * 0.9);

            // Eclats de coquillage : de rares points tres clairs, seuil haut
            // sur un bruit fin. Rares, sinon ca fait du sel.
            float shell = smoothstep(0.93, 0.995, fine) * detail;
            sc = mix(sc, uSandShell, shell * 0.7);

            // Frange d'ecume seche tout en bas, la ou l'eau vient de partir.
            float lick = (1.0 - smoothstep(-0.35, 0.55, above + ragged * 0.2));
            sc = mix(sc, uSandShell, lick * 0.35);

            c = mix(c, sc, sand);
          }

          // Sous l'eau : le fond est du SABLE, pas de l'herbe noyee. Il vire au
          // turquoise en profondeur, mais il garde son grain — c'est ce qui rend
          // les hauts-fonds lisibles a travers la surface.
          float sunk = smoothstep(0.0, -1.6, above);
          if (sunk > 0.002) {
            vec3 bed = uSandWet * (0.92 + fbm3(vWorld.xz * 1.3) * 0.16);
            bed = mix(bed, vec3(0.05, 0.30, 0.34), smoothstep(0.0, -3.4, above) * 0.82);
            c = mix(c, bed, sunk);
          }

          // --- LA ROUTE.
          //
          //     Une bande d'asphalte au milieu du couloir de jeu, avec des
          //     bas-cotes fondus. Elle n'est pas decorative : c'est elle qui
          //     donne un SENS au quartier. Des maisons plantees dans un pre ne
          //     sont pas un lotissement, ce sont des maisons dans un pre — il
          //     faut la route pour qu'elles bordent quelque chose.
          //
          //     Et c'est elle qui rend les flaques de lampadaire lisibles : sur
          //     l'herbe une tache de lumiere chaude se noie, sur du noir mouille
          //     elle brule.
          float road = townRoad(vWorld.xz, above, uTown);
          // Les passages de roues sont releves ICI parce que les flaques en ont
          // besoin plus bas : l'eau ne stagne pas la ou les pneus passent.
          float wheel = 0.0;
          {
            // --- L'ACCOTEMENT, avant la chaussee : gravier, terre battue, et le
            //     gravillon qui deborde. Il occupe la bande ou l'herbe ne
            //     pousse plus mais ou l'enrobe n'a pas encore commence.
            float berm = townShoulder(vWorld.xz, above, uTown);
            if (berm > 0.003) {
              // Du gravier MOUILLE, donc sombre et gris. Tire trop clair, il
              // lit comme du sable et l'oeil voit une plage le long de la
              // route — on l'a eu, et c'etait la premiere chose qu'on
              // remarquait dans le cadre.
              vec3 dirt = mix(uSandWet, uSandDry, 0.30) * 0.32;
              dirt *= 0.66 + fbm3(vWorld.xz * 3.4) * 0.66 + fbm2(vWorld.xz * 0.5) * 0.22;
              c = mix(c, dirt, berm * 0.88);
            }

            if (road > 0.003) {
              // --- L'ENROBE, sur trois echelles.
              //
              //     Le gravillon (fin), la reprise d'enrobe (large), et le
              //     LISSAGE DES PASSAGES DE ROUES. Ce dernier est le detail qui
              //     dit « route utilisee » plutot que « ruban gris » : le
              //     caoutchouc polit le bitume et le noircit sur deux bandes,
              //     a un metre et demi de l'axe. Il ne coute qu'une gaussienne.
              vec3 tar = vec3(0.052, 0.049, 0.056);
              tar *= 0.66 + fbm3(vWorld.xz * 2.6) * 0.55 + fbm2(vWorld.xz * 0.28) * 0.30;
              // Ornieres, bande axiale et rive n'existent que sur la route
              // LONGITUDINALE : une rue de desserte n'a ni marquage ni trafic
              // assez dense pour polir deux bandes. Sans cette distinction, les
              // ornieres de la grande route traversaient les rues laterales en
              // travers, ce qui n'a aucun sens.
              float main = townMainBand(vWorld.xz);
              wheel = exp(-pow((abs(vWorld.x) - 1.7) * 1.45, 2.0)) * main;
              tar *= 1.0 - wheel * 0.24;

              // --- LES FISSURES. Un RESEAU, pas des rayures : on prend la
              //     crete d'un bruit — la vallee de |fbm - 0.5| — ce qui donne
              //     des lignes qui se rejoignent et se ferment, comme une
              //     faience. Des traits paralleles auraient lu comme un motif.
              //     Par plaques, et seulement au premier plan : au loin le
              //     reseau passe sous le pixel et ne produit que du bruit.
              float crack = 1.0 - smoothstep(0.0, 0.05, abs(fbm2(vWorld.xz * 0.55) - 0.5));
              crack *= smoothstep(0.38, 0.72, fbm2(vWorld.xz * 0.085)) * detail;
              tar *= 1.0 - crack * 0.55;

              // --- LES GRAVILLONS DU BORD. Le balayage rejette le gravier
              //     contre la rive : une bande de points clairs, uniquement la
              //     ou la chaussee touche l'accotement. C'est le detail qui
              //     empeche le bord de lire comme une decoupe.
              float kerbBand = smoothstep(0.45, 0.95, abs(vWorld.x) / max(townEdge(vWorld.xz), 0.001));
              float grit = smoothstep(0.86, 0.99, fbm2(vWorld.xz * 7.0)) * kerbBand * detail;
              tar = mix(tar, vec3(0.17, 0.16, 0.14), grit * 0.7);

              // --- LA BANDE AXIALE : ETROITE, DISCONTINUE et USEE. Trop large
              //     ou trop propre, elle passe au premier plan comme une barre
              //     grise posee sous le personnage — elle attire l'oeil au
              //     centre du cadre, exactement la ou il ne doit pas rester.
              float lane = (1.0 - smoothstep(0.07, 0.15, abs(vWorld.x)))
                         * step(0.62, fract(vWorld.z * 0.14))
                         * smoothstep(0.30, 0.62, fbm2(vWorld.xz * 0.7)) * main;
              // --- ET LA RIVE, continue, posee EXACTEMENT sur le bord que
              //     townRoad utilise. C'est elle qui donne sa largeur a la
              //     route : sans elle, l'oeil ne sait pas ou la chaussee finit.
              float ex = townEdge(vWorld.xz) - 0.55;
              float rive = (1.0 - smoothstep(0.09, 0.19, abs(abs(vWorld.x) - ex)))
                         * smoothstep(0.32, 0.68, fbm2(vWorld.xz * 0.9)) * main;
              // ASSEZ CLAIRES POUR SE VOIR SUR DU NOIR MOUILLE. Le marquage
              // est la seule chose qui donne sa LARGEUR a la chaussee : pose a
              // 0,26 sur un enrobe a 0,05, il disparaissait des vingt metres et
              // la route redevenait une bande sombre sans bords.
              tar = mix(tar, vec3(0.44, 0.42, 0.36), max(lane, rive) * 0.85);

              c = mix(c, tar, road * 0.96);
            }
          }

          // --- LE TAPIS DE FEUILLES MORTES.
          //
          //     Il vient AVANT le sol mouille, et l'ordre compte : sous
          //     l'averse un tapis de feuilles fonce et se sature comme le reste
          //     du sol. Pose apres, il serait resté sec au milieu d'un champ
          //     trempe — le genre de detail qu'on ne sait pas nommer mais qui
          //     fait que l'image ne tient pas.
          if (uLitter > 0.002) {
            //   Les feuilles S'AMASSENT. Elles ne se repartissent jamais
            //   uniformement : le vent les pousse en trainees et les depose
            //   dans les creux. D'ou deux echelles — la trainee de dix metres
            //   et le grain du metre — et un seuil qui laisse de l'herbe entre
            //   les tas. Un tapis integral effacerait le sol, et avec lui tout
            //   le relief qu'on a besoin de lire pour sauter.
            float drift = fbm2(vWorld.xz * 0.085);
            float speck = fbm3(vWorld.xz * 1.15);
            //   SEUIL CALE SUR LA STATISTIQUE, pas a vue. Ces deux champs ont
            //   une moyenne de 0,48 et un ecart-type de l'ordre du dixieme ;
            //   les moyenner en reduit encore la variance. Un premier seuil a
            //   [0,44 ; 0,80] ne laissait donc passer que trois pour cent du
            //   sol : le tapis existait dans le code et nulle part a l'ecran.
            //   Une plage serree AUTOUR de la moyenne est ce qui donne une
            //   couverture d'a peu pres la moitie, avec de vrais tas et de
            //   vraies trouees.
            float mat = smoothstep(0.35, 0.57, drift * 0.70 + speck * 0.30);
            //   Plus dense en bas qu'en haut : c'est la que le vent les laisse.
            mat *= mix(0.55, 1.30, 1.0 - smoothstep(-3.0, 5.0, vWorld.y));
            //   ET CONTRE LA ROUTE. Le vent et les voitures les chassent de
            //   l'asphalte, mais elles ne vont pas loin : elles s'entassent
            //   sur le bas-cote. Sans ce terme, la bande entre la chaussee et
            //   les maisons reste nue, et c'est justement celle qu'on regarde.
            mat *= 1.0 + (1.0 - smoothstep(9.0, 26.0, abs(vWorld.x))) * uTown * 0.55;
            //   Ni sur le sable, ni dans l'eau.
            //   Et il s'ECLAIRCIT sur la route : le vent et les voitures
            //   poussent les feuilles vers les bas-cotes. Sans ce terme, le
            //   tapis recouvrait l'asphalte et la route disparaissait sous les
            //   feuilles — on avait fait une route pour ne pas la voir.
            mat = clamp(mat, 0.0, 1.0) * uLitter * (1.0 - sand * 0.6)
                * smoothstep(-0.2, 0.8, above) * (1.0 - road * 0.55);

            if (mat > 0.003) {
              //   Un tapis pietine n'a pas la couleur d'une feuille en vol : il
              //   est plus sombre et plus brun. On part donc des MEMES deux
              //   couleurs, assombries — c'est ce qui fait qu'on reconnait la
              //   feuille qui vient de tomber dans celle qui est au sol.
              //   ET IL EST DETREMPE, DONC BRUN. Une feuille qui vient de
              //   tomber garde sa couleur ; celle qui est au sol depuis une
              //   semaine a vire. Prises a la meme saturation que les feuilles
              //   en vol, elles peignaient une bande ROUILLE VIF le long de la
              //   route — la couleur d'un tapis neuf, pas d'un mois d'octobre.
              vec3 litter = mix(uLeafB, uLeafA, smoothstep(0.38, 0.80, speck));
              litter = mix(litter, uShadow, 0.34) * 0.74;
              //   Une feuille plaquee sur du bitume mouille est plus SOMBRE et
              //   plus collee qu'une feuille dans l'herbe : elle a perdu son
              //   relief. Sans ce terme, le tapis flotte au-dessus de la route.
              litter *= 1.0 - road * 0.42;
              //   Le grain, au premier plan seulement : sans lui c'est une
              //   tache de couleur, avec lui c'est un tas de feuilles.
              litter *= 0.84 + fbm3(vWorld.xz * 5.5) * 0.34 * detail;
              c = mix(c, litter, mat * 0.88);
            }
          }

          // --- LE SOL MOUILLE, ET SES FLAQUES.
          //
          //     Deux effets distincts, et il faut les deux. Le premier tient en
          //     une ligne et porte tout le reste : un sol mouille s'ASSOMBRIT
          //     et se SATURE. Le film d'eau piege la lumiere au lieu de la
          //     diffuser, donc les couleurs foncent et gagnent en contraste.
          //     Un simple assombrissement aurait donne de la terre grise ;
          //     c'est le gain de saturation qui fait lire « trempe ».
          if (uWet > 0.002) {
            //   Le gain compense la mise au carre : sans lui, le sol trempe
            //   ne fonce pas, il DISPARAIT. Mesure a 0,55 / 1,30 le premier
            //   plan perdait 45 % de sa luminance, et par-dessus l'ombre des
            //   nuages il ne restait que du noir.
            c = mix(c, c * c * 1.75, uWet * 0.44);

            //   LES IMPACTS NE SONT PAS QUE DANS LES FLAQUES.
            //
            //   Une averse assez forte fait sauter l'eau du sol lui-meme :
            //   toute la surface crepite, pas seulement les creux ou l'eau
            //   s'est rassemblee. C'est le meme semis d'anneaux que la flaque
            //   (cf. Weather.rainRings), a une echelle plus serree et beaucoup
            //   plus discret — et eteint des vingt metres, ou l'anneau passe
            //   sous le pixel et ne produit plus que du scintillement.
            float near = 1.0 - smoothstep(9.0, 38.0, dist);
            if (near > 0.004) {
              float hit = rainRings(vWorld.xz * 1.75, uTime + 3.1);
              c += mix(uDayFill, vec3(1.0), 0.40) * max(hit, 0.0) * uWet * near * 0.20;
            }

            // Le second : LES FLAQUES. Deux conditions et pas une seule — plat
            //   A L'ECHELLE DU TERRAIN, et dans un creux du champ de bruit. Une
            //   flaque sur un versant est le genre de faute qu'on repere sans
            //   savoir la nommer.
            float pool = uWet
                       * smoothstep(0.966, 0.994, macroFlat)
                       * smoothstep(0.50, 0.82, fbm2(vWorld.xz * 0.055))
                       * smoothstep(-0.1, 1.2, above)
                       * (1.0 - sand * 0.35);
            // L'ASPHALTE RETIENT L'EAU BIEN MIEUX QUE L'HERBE : elle ne s'y
            // infiltre pas. C'est la que les flaques doivent etre, et c'est la
            // qu'elles servent — une flaque sur du noir renvoie le halo des
            // lampadaires, une flaque dans un pre ne renvoie que du gris.
            //   Sur la route, elles sont ETIREES DANS SON AXE : l'eau suit le
            //   devers et les ornieres, elle ne fait pas des ronds. Un bruit
            //   ecrase quatre fois en z suffit a le dire.
            //   Sur la route, elles sont ETIREES DANS SON AXE : l'eau suit le
            //   devers et les ornieres, elle ne fait pas des ronds. Un bruit
            //   ecrase quatre fois en z suffit a le dire.
            //   Et elle ne stagne PAS dans les passages de roues : c'est
            //   justement la que les pneus la chassent, et ce vide entre deux
            //   flaques est ce qui fait lire des ornieres plutot que des taches.
            pool = max(pool, road * uWet * (1.0 - wheel * 0.75)
                    * smoothstep(0.40, 0.70, fbm2(vec2(vWorld.x * 0.30, vWorld.z * 0.075) + 3.3)));

            if (pool > 0.003) {
              //   Une flaque n'est pas une tache sombre, c'est un MIROIR : elle
              //   rend le ciel a l'incidence rasante et vire presque au noir vue
              //   d'aplomb. C'est ce contraste, sur un sol par ailleurs mat, qui
              //   la fait lire comme de l'eau et non comme de la boue.
              vec3 mirror = mix(uDayFill, uHorizon, 0.35);
              float pf = pow(max(1.0 - clamp(dot(N, V), 0.0, 1.0), 1e-4), 3.2);
              //   Sur l'asphalte la flaque est un VRAI miroir : le sol qu'elle
              //   recouvre est presque noir, donc tout ce qu'on y voit vient du
              //   ciel. Dans l'herbe elle reste plus discrete — il y a de la
              //   matiere claire dessous qui transparait.
              vec3 pc = mix(c * 0.30, mirror,
                            clamp(0.16 + pf * (1.25 + road * 0.9), 0.0, 0.95));

              //   LES IMPACTS. Ce sont eux qui disent que l'averse est EN COURS :
              //   une flaque lisse est une flaque d'apres la pluie. Ils
              //   s'eteignent au loin, la ou l'anneau passerait sous le pixel et
              //   ne produirait plus que du scintillement.
              float rip = rainRings(vWorld.xz, uTime) * (1.0 - smoothstep(18.0, 85.0, dist));
              pc += mirror * rip * 0.50;
              pc += uDayLight * max(rip, 0.0) * 0.22;

              c = mix(c, pc, pool);
            }
          }

          // --- LES FLAQUES DE LAMPADAIRE.
          //
          //     Elles lisent la MEME fonction de placement que les mats
          //     eux-memes (cf. Town.TOWN_GLSL). Deux formules « a peu pres
          //     pareilles » se decaleraient d'un metre, et la flaque serait a
          //     cote de la lampe — le genre de faute qu'on voit sans savoir la
          //     nommer.
          //
          //     Trois rangees suffisent : le pas est de vingt-quatre metres et
          //     la flaque en fait douze de rayon, donc au-dela de la voisine
          //     immediate il ne reste rien a additionner.
          if (uTown > 0.004) {
            float row0 = floor(townRowAt(vWorld.z, uOrigin.xz) + 0.5);
            vec3 lampGlow = vec3(0.0);
            for (int k = -1; k <= 1; k++) {
              vec2 lp = lampXZ(row0 + float(k), uOrigin.xz);
              float dl = length(vWorld.xz - lp);
              // Deux lobes : un coeur serre sous la lanterne et une nappe
              // longue qui meurt dans le noir. Un seul lobe fait un rond de
              // projecteur.
              float fall = pow(max(1.0 - clamp(dl / 15.0, 0.0, 1.0), 1e-4), 3.0) * 0.50
                         + pow(max(1.0 - clamp(dl / 6.5, 0.0, 1.0), 1e-4), 1.6) * 1.10;
              lampGlow += uLamp * fall;
            }
            lampGlow *= uTown * (0.45 + uDayNight * 0.95);

            // --- ET ELLE POSE DEUX CHOSES TRES DIFFERENTES, pas une.
            //
            //     Un peu de lumiere DIFFUSE, et surtout un REFLET etire. C'est
            //     le reflet qui fait l'image d'une rue mouillee le soir ; la
            //     part diffuse, poussee seule, delave l'asphalte en beige et
            //     lui enleve exactement ce qu'on venait chercher — c'est ce
            //     qu'a donne le premier reglage, une route couleur sable sous
            //     un ciel d'orage.
            //
            //     Le reflet passe par le meme terme rasant que le sheen du sol :
            //     il s'allonge vers l'horizon et disparait sous les pieds, ce
            //     qui est exactement le comportement d'un reflet.
            //     LA PART DIFFUSE EST MINUSCULE, ET C'EST TOUT LE REGLAGE.
            //
            //     Une nappe large et generalement etalee ne fait pas une rue
            //     eclairee, elle fait un cadre BEIGE : mesure a la capture,
            //     couper uTown faisait passer le premier plan de (121, 83, 56)
            //     a (18, 15, 10) — autrement dit ce n'etait plus le paysage
            //     qu'on voyait, c'etait le beurre des lampadaires par-dessus.
            //     Le rapprochement des mats a neuf metres, qui les remet enfin
            //     sur la chaussee, a rendu la faute quatre fois plus visible.
            c += lampGlow * (0.035 + uWet * 0.045);
            c += lampGlow * graze * (0.30 + uWet * 1.25);

            // --- LA LUMIERE DES FENETRES SUR L'HERBE.
            //
            //     Une maison allumee qui n'eclaire rien autour d'elle flotte :
            //     elle est une vignette posee sur le paysage, pas un objet
            //     dedans. Une tache chaude devant sa facade la POSE, et c'est
            //     le seul terme qui relie le quartier au sol qu'on traverse.
            //
            //     Le placement vient de houseAt, partage avec le decor : deux
            //     formules voisines mettraient la lumiere a cote de la maison.
            //     Deux rangees et le premier rang seulement — les maisons du
            //     fond sont trop loin pour que leur lueur compte, et chaque
            //     evaluation coute trois hachages.
            vec3 warm = vec3(0.0);
            for (int k = 0; k < 2; k++) {
              float zz = townZ(row0 + float(k), uOrigin.xz);
              for (int sd = 0; sd < 2; sd++) {
                vec3 hh = houseAt(zz, sd == 0 ? -1.0 : 1.0, 0.0, uTown);
                float dh = length(vWorld.xz - hh.xy);
                warm += uLamp * hh.z
                      * pow(max(1.0 - clamp(dh / 19.0, 0.0, 1.0), 1e-4), 2.8);
              }
            }
            c += warm * uTown * (0.05 + uDayNight * 0.15);
          }

          // --- LA GRILLE Y2K.
          //
          //     Deux mailles, une fine et une large, et surtout AUCUN
          //     appel a fwidth : l'anti-aliasing par derivees est l'outil evident
          //     pour une grille, mais il repose sur une extension dont la
          //     disponibilite depend du profil GLSL, et ce projet a deja perdu
          //     assez de temps sur des shaders qui echouent en silence. Ici la
          //     largeur du fil est calculee depuis la DISTANCE, ce qui fait le
          //     meme travail, se regle a la main, et marche partout.
          //
          //     L'extinction au loin n'est pas cosmetique : une grille qui ne
          //     s'attenue pas moire des la ligne d'horizon, et une grille qui
          //     moire lit comme un bug, jamais comme une texture.
          if (uTech > 0.002) {
            float w = 0.05 + dist * 0.011;
            vec2 q4 = abs(fract(vWorld.xz * 0.25 + 0.5) - 0.5) * 4.0;
            vec2 q20 = abs(fract(vWorld.xz * 0.05 + 0.5) - 0.5) * 20.0;
            float fine = 1.0 - smoothstep(0.0, w, min(q4.x, q4.y));
            float bold = 1.0 - smoothstep(0.0, w * 2.2, min(q20.x, q20.y));
            float reach = 1.0 - smoothstep(90.0, 320.0, dist);
            // La dalle est plus sombre que l'herbe qu'elle remplace : un neon
            // ne se voit que sur du sombre, et la couleur du monde ne suffit
            // pas — c'est le CONTRASTE qui fait le neon.
            c = mix(c, c * 0.42, uTech);
            c += uStreak * (fine * 0.55 + bold * 1.35) * reach * uTech;
            // Balayage lent en travers : l'ecran de veille qui respire. Sans
            // lui la grille est un quadrillage, avec lui c'est une machine.
            float sweepZ = fract(vWorld.z * 0.006 + uTime * 0.05);
            c += uStreak * smoothstep(0.94, 1.0, sweepZ) * reach * uTech * 0.5;
          }

          // --- Contre-jour. Le soleil est devant : la derniere bande d'herbe
          //     avant le ciel est traversee par la lumiere et s'allume. Sans
          //     ce lisere, la plaine se termine par une decoupe de papier.
          float toward = max(dot(normalize(vec3(vWorld.x, 0.0, vWorld.z) - vec3(uCam.x, 0.0, uCam.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0);
          c += mix(vec3(0.34, 0.46, 0.30), uDayFill * 0.72, uWet)
             * smoothstep(0.68, 0.99, f) * pow(max(toward, 1e-4), 2.0) * 1.05;

          // --- LA DIFFUSION ATMOSPHERIQUE, ET ELLE N'EST PAS LA BRUME.
          //
          //     La brume d'horizon fait fondre le lointain vers UNE couleur, la
          //     meme dans toutes les directions. L'air reel ne fait pas ca : il
          //     renvoie beaucoup plus de lumiere du cote du soleil que du cote
          //     oppose — c'est la raison pour laquelle un paysage a contre-jour
          //     a un lointain lumineux et laiteux, et un paysage eclaire de dos
          //     un lointain net et sombre. Sans ce terme, les deux moities de
          //     l'horizon ont la meme valeur et la scene perd sa DIRECTION.
          //
          //     Il croit avec la distance parcourue dans l'air (donc avec f) et
          //     avec l'alignement au soleil, exactement comme la diffusion de
          //     Mie dont il est la version a un terme.
          c += mix(uDayLight, uHorizon, 0.45)
             * smoothstep(0.14, 0.92, f)
             * (0.10 + 0.55 * pow(max(toward, 1e-4), 2.6))
             * (1.0 - uOvercast * 0.55) * 0.42;

          // --- LE VOILE DE L'AVERSE.
          //
          //     Il vient APRES la brume d'horizon et il fait autre chose : la
          //     brume separe les plans lointains, le voile ETEINT le paysage.
          //     Au-dela de quelques dizaines de metres, l'eau qui tombe entre
          //     l'oeil et le sol fait ecran — et c'est ce qui distingue une
          //     averse d'un motif de traits pose devant un beau temps. Sans
          //     lui, on peut multiplier les gouttes par dix sans jamais rendre
          //     la pluie forte : rien ne se PERD.
          //
          //     Il prend la couleur du remplissage du ciel, comme la goutte
          //     elle-meme : un voile gris fixe sous un ciel de braise serait
          //     la meme faute que le reflet de l'eau teinte deux fois.
          c = mix(c, uDayFill * 1.06, smoothstep(0.06, 0.80, f) * uWet * 0.40);

          // Contact net avec le ciel.
          c = mix(c, uHorizon, smoothstep(0.94, 1.0, f));

          // --- L'HEURE, appliquee en DERNIER sur l'albedo assemble.
          //     L'ombre des nuages sert d'entree : sous un nuage, c'est le ciel
          //     qui eclaire, donc la couleur de remplissage domine — et c'est ce
          //     basculement qui fait qu'une nuit n'est pas un jour assombri.
          c = daylight(c, cloudDark * 0.55 * (1.0 - uOvercast * 0.75) + uDayNight * 0.30
                        + uOvercast * 0.30);
          // ET LE PLAFOND REND CE QU'IL DIFFUSE.
          //
          // daylight() bascule vers la couleur de REMPLISSAGE, qui decrit ce
          // que recoit une face a l'ombre : sombre par construction. Un ciel
          // couvert n'est pas une ombre, c'est une source de mille metres de
          // large — plus douce que le soleil, pas plus faible. Sans ce gain,
          // octobre etait une plaine noire ou seuls les lampadaires
          // existaient, et c'est exactement ce que le joueur voyait.
          c *= 1.0 + uOvercast * 0.62;

          // --- LA LAMPE DU SURFEUR, et elle vient APRES l'eclairage de la
          //     scene, jamais avant.
          //
          //     C'est une SOURCE : ce qu'elle emet ne depend pas de l'heure. Le
          //     premier jet l'ajoutait plus haut, avant daylight(), donc la
          //     nuit la multipliait par sa propre lumiere — bleue et faible —
          //     et le vert acide du personnage ressortait gris sombre.
          //     Exactement la meme faute que le reflet de l'eau teinte deux
          //     fois, et elle merite la meme regle : une source s'AJOUTE au
          //     resultat eclaire, elle n'y participe pas.
          //
          //     Le gain monte avec la nuit parce qu'une lueur en plein soleil
          //     ne se voit pas et delave le sol au lieu de l'eclairer.
          // Dose reduite apres capture : a 0,80 la flaque recouvrait la grille
          //     de CHROME, et le monde disparaissait sous la lampe du
          //     personnage. Une lueur doit REVELER la matiere du sol, pas la
          //     remplacer par un aplat de sa propre couleur.
          c += riderLight(vWorld) * (0.24 + uDayNight * 0.58);

          // --- L'OMBRE DE CONTACT, ET ELLE VIENT EN DERNIER.
          //
          //     Elle etait posee cent lignes plus haut, avec le reste de
          //     l'albedo, et elle n'a jamais existe a l'ecran : la LAMPE DU
          //     PERSONNAGE, ajoutee tout en bas, rallume exactement la zone
          //     qu'elle vient d'assombrir. Le surfeur effacait sa propre
          //     ombre. Mesure : une ligne de pixels traversant le point de
          //     contact ne variait pas d'un niveau, dans les cinq mondes.
          //
          //     Une ombre n'est pas une couleur, c'est une OCCLUSION : elle
          //     s'applique apres tout ce qui eclaire, sources comprises. Et le
          //     resultat est meilleur que ce qu'on visait — une flaque de
          //     lumiere cyan avec un coeur sombre juste sous le disque, ce qui
          //     pose le personnage bien mieux qu'une tache grise.
          c = mix(c, c * 0.44 + uSkyLight * 0.05, drop * 0.92);

          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new Mesh(buildGeometry(dense), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -900;
  }

  /** @param cast xz = centre de l'ombre portee du surfeur, y = hauteur de vol */
  update(camPos: Vector3, origin: Vector3, time: number, speedN: number, cast: Vector3): void {
    const u = this.mat.uniforms;
    u.uCast.value.copy(cast);
    u.uCam.value.copy(camPos);
    u.uOrigin.value.copy(origin);
    u.uTime.value = time;
    u.uSpeed.value = speedN;
    // Ancrage par pas entiers de maille : un suivi continu ferait glisser les
    // sommets le long des pentes et scintiller tout le relief.
    this.mesh.position.z = Math.round(origin.z / SNAP) * SNAP;
  }
}
