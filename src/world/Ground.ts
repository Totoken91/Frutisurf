import { BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector3 } from 'three';
import { GLSL_SAFE, GLSL_NOISE } from '../core/Noise';
import { vec3 } from '../core/Palette';
import { makeGrassTexture } from './GrassTexture';
import { SUN_DIR } from './Sky';
import { WEATHER_GLSL } from './Weather';
import { terrainGLSL } from './Terrain';

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
  private mat: ShaderMaterial;

  constructor(dense = true, detailRes = 512) {
    const grass = makeGrassTexture(detailRes);
    this.mat = new ShaderMaterial({
      fog: false,
      uniforms: {
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
        uniform vec3 uOrigin;
        uniform float uTime, uSpeed;
        uniform sampler2D uGrass;
        uniform float uDetail, uDetailFar;
        /** xz = centre de l'ombre projetee du surfeur, y = sa hauteur de vol. */
        uniform vec3 uCast;
        uniform vec3 uSkyLight;

        ${GLSL_NOISE}
        ${WEATHER_GLSL}
        ${terrainGLSL()}

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
          streak = mix(0.5, streak, 1.32 + uSpeed * 0.45);
          streak = clamp(streak, 0.0, 1.0);

          // --- Gradient de valeur : CLAIR au loin, SOMBRE au premier plan.
          //     C'est lui qui porte toute la profondeur de la plaine, donc il
          //     doit rester le terme dominant — tout ce qui vient apres ne fait
          //     que le moduler.
          vec3 c = mix(uNear, uMid, smoothstep(0.02, 0.30, f));
          c = mix(c, uFar, smoothstep(0.26, 0.60, f));
          c = mix(c, uHorizon, smoothstep(0.46, 0.92, f));

          c = mix(mix(c, uShadow, 0.30), mix(c, uStreak, 0.55), streak);

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
          c = mix(c * 0.93, mix(c, uStreak, 0.26) * 1.05, tuft);
          c *= 0.96 + 0.09 * blade;

          // --- Bandes de defilement : la lecture de vitesse
          float band = sin(p.y * 0.201) * 0.5 + 0.5;
          c = mix(c, c * 1.16, band * (0.030 + uSpeed * 0.045) * (1.0 - f * 0.55));

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
          c *= 0.78 + 0.34 * smoothstep(0.10, 0.52, ndl);
          // Les versants exposes accrochent un lisere clair sur la crete.
          c += uHorizon * 0.20 * smoothstep(0.26, 0.72, ndl) * (1.0 - f * 0.5);

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
          c += vec3(0.07, 0.22, 0.15) * graze * 0.50;

          //     Gloss Frutiger Aero : le speculaire est MASQUE par les brins.
          //     Une plaine qui brille uniformement lit comme du plastique ; ce
          //     sont les pointes qui doivent scintiller, pas la surface.
          vec3 H = normalize(V + L);
          float spec = pow(max(dot(N, H), 1e-4), 62.0);
          c += vec3(0.26, 0.34, 0.24) * spec * (0.28 + blade * 1.05);

          //     Et un lisere sur les pointes vues de biais : c'est ce qui donne
          //     le duvet argente d'une prairie a contre-jour.
          c += vec3(0.30, 0.40, 0.26) * graze * blade * detail * 0.55;

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
          c = mix(c, c * 0.62 + uSkyLight * 0.055, cloudDark * 0.85);

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
          float sr = length(vWorld.xz - uCast.xz) / (1.15 + uCast.y * 0.42);
          float drop = (1.0 - smoothstep(0.45, 1.0, sr)) * exp(-uCast.y * 0.26);
          c = mix(c, c * 0.52 + uSkyLight * 0.05, drop * 0.9);

          // --- Rafale : le passage de la vague eclaircit brievement l'herbe,
          //     les brins se couchant montrent leur face lisse au soleil.
          c *= 1.0 + gustAt(vWorld.xz, uTime) * 0.055 * detail;

          // --- Brume d'horizon. Elle separe les plans lointains les uns des
          //     autres : sans elle, des collines a 300 m et a 900 m ont
          //     exactement la meme valeur et le relief s'aplatit.
          c = mix(c, mix(uHorizon, vec3(0.62, 0.92, 0.86), 0.35), smoothstep(0.50, 0.99, f) * 0.42);

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
          float shoreWide = 2.0 + fbm2(vWorld.xz * 0.010) * 4.0;
          // Trois echelles de decoupe : les anses, les langues de sable qui
          // remontent dans l'herbe, et la dentelure fine du bord. C'est cette
          // superposition qui empeche de lire une courbe de niveau.
          float ragged = (fbm3(vWorld.xz * 0.055) - 0.5) * 2.1
                       + (fbm2(vWorld.xz * 0.17) - 0.5) * 0.8
                       + (fbm2(vWorld.xz * 0.62) - 0.5) * 0.24;
          float sand = 1.0 - smoothstep(0.0, shoreWide, above + ragged);
          sand = clamp(sand, 0.0, 1.0);
          // Le haut de plage se MELANGE a l'herbe au lieu de s'arreter : une
          // frontiere nette entre deux aplats se lit comme un masque de
          // decoupe, quelle que soit la finesse du contour.
          sand = smoothstep(0.02, 0.78, sand);

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

          // --- Contre-jour. Le soleil est devant : la derniere bande d'herbe
          //     avant le ciel est traversee par la lumiere et s'allume. Sans
          //     ce lisere, la plaine se termine par une decoupe de papier.
          float toward = max(dot(normalize(vec3(vWorld.x, 0.0, vWorld.z) - vec3(uCam.x, 0.0, uCam.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0);
          c += vec3(0.34, 0.46, 0.30) * smoothstep(0.68, 0.99, f) * pow(max(toward, 1e-4), 2.0) * 1.05;

          // Contact net avec le ciel.
          c = mix(c, uHorizon, smoothstep(0.94, 1.0, f));

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
