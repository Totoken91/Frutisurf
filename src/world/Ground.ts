import { BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector3 } from 'three';
import { GLSL_NOISE } from '../core/Noise';
import { vec3 } from '../core/Palette';
import { SUN_DIR } from './Sky';
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

  constructor(dense = true) {
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
        varying vec3 vWorld;
        varying vec3 vNormal;
        uniform vec3 uNear, uMid, uFar, uHorizon, uShadow, uStreak, uSun, uCam;
        uniform vec3 uOrigin;
        uniform float uTime, uSpeed;

        ${GLSL_NOISE}
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
          float m1 = fbm(vec2(p.x * 0.062, p.y * 0.062));
          float m2 = fbm(vec2(p.x * 0.021, p.y * 0.021));
          float streak = m1 * 0.55 + m2 * 0.45;
          streak = mix(0.5, streak, 1.10 + uSpeed * 0.45);
          streak = clamp(streak, 0.0, 1.0);

          // --- Gradient de valeur : CLAIR au loin, SOMBRE au premier plan.
          //     C'est lui qui porte toute la profondeur de la plaine, donc il
          //     doit rester le terme dominant — tout ce qui vient apres ne fait
          //     que le moduler.
          vec3 c = mix(uNear, uMid, smoothstep(0.02, 0.30, f));
          c = mix(c, uFar, smoothstep(0.26, 0.60, f));
          c = mix(c, uHorizon, smoothstep(0.46, 0.92, f));

          c = mix(mix(c, uShadow, 0.30), mix(c, uStreak, 0.55), streak);

          // --- Micro-detail de brins, uniquement dans le champ proche
          float near = 1.0 - smoothstep(0.0, 0.55, f);
          // Touffes, pas brins : a 2,2 (45 cm de periode) le motif tombait
          // sous le pixel des la deuxieme rangee et ne rendait qu'un bruit gris.
          float blade = fbm(vec2(p.x * 0.42, p.y * 0.42));
          c = mix(c, mix(c, uStreak, 0.34), blade * near * 0.46);
          c *= 1.0 - near * 0.16 * fbm(vec2(p.x * 0.17, p.y * 0.17));

          // --- Bandes de defilement : la lecture de vitesse
          float band = sin(p.y * 0.201) * 0.5 + 0.5;
          c = mix(c, c * 1.16, band * (0.030 + uSpeed * 0.045) * (1.0 - f * 0.55));

          // --- Relief. Sans ces deux termes on ne voit pas ou est le sommet,
          //     donc on ne peut pas le timer : c'est de la lisibilite de jeu,
          //     pas de la decoration.
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
          float sweep = fbm(sweepUv);
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
          vec3 V = normalize(uCam - vWorld);
          float graze = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 4.5);
          c += vec3(0.07, 0.22, 0.15) * graze * 0.50;

          vec3 H = normalize(V + L);
          c += vec3(0.20, 0.27, 0.22) * pow(max(dot(N, H), 0.0), 46.0) * 0.48;

          // --- Brume d'horizon. Elle separe les plans lointains les uns des
          //     autres : sans elle, des collines a 300 m et a 900 m ont
          //     exactement la meme valeur et le relief s'aplatit.
          c = mix(c, mix(uHorizon, vec3(0.62, 0.92, 0.86), 0.35), smoothstep(0.50, 0.99, f) * 0.42);

          // --- Contre-jour. Le soleil est devant : la derniere bande d'herbe
          //     avant le ciel est traversee par la lumiere et s'allume. Sans
          //     ce lisere, la plaine se termine par une decoupe de papier.
          float toward = max(dot(normalize(vec3(vWorld.x, 0.0, vWorld.z) - vec3(uCam.x, 0.0, uCam.z)), normalize(vec3(uSun.x, 0.0, uSun.z))), 0.0);
          c += vec3(0.34, 0.46, 0.30) * smoothstep(0.68, 0.99, f) * pow(toward, 2.0) * 1.05;

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

  update(camPos: Vector3, origin: Vector3, time: number, speedN: number): void {
    const u = this.mat.uniforms;
    u.uCam.value.copy(camPos);
    u.uOrigin.value.copy(origin);
    u.uTime.value = time;
    u.uSpeed.value = speedN;
    // Ancrage par pas entiers de maille : un suivi continu ferait glisser les
    // sommets le long des pentes et scintiller tout le relief.
    this.mesh.position.z = Math.round(origin.z / SNAP) * SNAP;
  }
}
