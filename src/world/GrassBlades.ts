import {
  BufferAttribute,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import { GLSL_NOISE } from '../core/Noise';
import { vec3 } from '../core/Palette';
import { SUN_DIR } from './Sky';
import { terrainGLSL } from './Terrain';
import { WEATHER_GLSL } from './Weather';

/**
 * Le champ de touffes.
 *
 * Une texture donne le grain, mais elle reste plate : au premier plan on voit
 * une image d'herbe collee sur un plan. Ce qui fait la difference, c'est la
 * SILHOUETTE — des brins qui depassent, qui coupent la ligne d'horizon locale,
 * qui bougent independamment du sol.
 *
 * Dispersion par CELLULE MONDE. Chaque instance porte un indice de grille ; le
 * shader en deduit la cellule monde a partir de la position du joueur, la hache
 * pour en tirer un decalage, une orientation et une hauteur. Les touffes ne
 * suivent donc pas le joueur : elles restent ou elles sont, et c'est l'ensemble
 * des cellules visitees qui glisse. Des decalages fixes dans un carre qu'on
 * deplace donneraient une prairie qui rame avec la camera, defaut immediatement
 * visible et impossible a ignorer une fois qu'on l'a vu.
 *
 * Pas de transparence : la hauteur tombe a zero au bord du disque et sous le
 * joueur. Un fondu en alpha imposerait un tri par profondeur pour quelques
 * milliers d'instances, et laisserait un anneau franc la ou le seuil coupe.
 */

/**
 * Une touffe = quatre brins, chacun en deux segments.
 *
 * Les quatre ne partent PAS du meme point : le shader les disperse dans la
 * cellule. Groupes a l'origine, une instance faisait un buisson isole et la
 * prairie ressemblait a un champ d'aileron de requin. Disperses, la meme
 * depense d'instances couvre quatre fois plus de sol.
 */
function tuftGeometry(): InstancedBufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const bladeId: number[] = [];
  const idx: number[] = [];
  const ROWS = [0, 0.5, 1];

  for (let b = 0; b < 4; b++) {
    const base = pos.length / 3;
    for (let r = 0; r < ROWS.length; r++) {
      const v = ROWS[r];
      for (let s = -1; s <= 1; s += 2) {
        pos.push(s, v, 0);
        uv.push(s * 0.5 + 0.5, v);
        bladeId.push(b);
      }
    }
    for (let r = 0; r < ROWS.length - 1; r++) {
      const a = base + r * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const g = new InstancedBufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
  g.setAttribute('aBlade', new BufferAttribute(new Float32Array(bladeId), 1));
  g.setIndex(idx);
  return g;
}

export class GrassBlades {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;

  /**
   * @param grid nombre de cellules de cote
   * @param cell taille d'une cellule, en metres
   */
  constructor(grid = 56, cell = 0.38) {
    const geo = tuftGeometry();
    const count = grid * grid;
    const cells = new Float32Array(count * 2);
    for (let i = 0; i < count; i++) {
      cells[i * 2] = i % grid;
      cells[i * 2 + 1] = Math.floor(i / grid);
    }
    geo.setAttribute('iCell', new InstancedBufferAttribute(cells, 2));
    geo.instanceCount = count;

    const radius = grid * cell * 0.5;

    this.mat = new ShaderMaterial({
      side: DoubleSide,
      uniforms: {
        uOrigin: { value: new Vector3() },
        uTime: { value: 0 },
        uSpeed: { value: 0 },
        uCell: { value: cell },
        uGrid: { value: grid },
        uRadius: { value: radius },
        uSun: { value: SUN_DIR.clone() },
        // Base sur le vert MEDIAN et non sur l'ombre : le brin doit sortir de
        // la matiere du sol, pas s'y detacher en sombre.
        uBase: { value: vec3('grassNear') },
        uTip: { value: vec3('grassStreak') },
        uGlow: { value: vec3('grassHorizon') },
        uSkyLight: { value: [0.32, 0.52, 0.72] },
      },
      vertexShader: /* glsl */ `
        attribute vec2 iCell;
        attribute float aBlade;
        uniform vec3 uOrigin;
        uniform float uTime, uSpeed, uCell, uGrid, uRadius;
        uniform vec3 uSun;
        varying float vV, vTint, vLight, vGlint, vShade;

        ${GLSL_NOISE}
        ${WEATHER_GLSL}
        ${terrainGLSL()}

        float h21(vec2 p){
          p = fract(p * vec2(127.31, 311.7));
          p += dot(p, p + 34.23);
          return fract(p.x * p.y);
        }

        void main(){
          vec2 base = floor(uOrigin.xz / uCell) + iCell - uGrid * 0.5;
          // Chaque brin de la touffe tire SA propre place dans la cellule.
          vec2 key = base + aBlade * 7.77;
          float r1 = h21(key);
          float r2 = h21(key + 17.3);
          float r3 = h21(key + 91.7);
          vec2 wp = (base + vec2(r1, r2)) * uCell;

          float dist = length(wp - uOrigin.xz);
          // La hauteur tombe a zero au bord du disque ET sous le joueur : la
          // premiere pour que le champ n'ait pas de frontiere, la seconde pour
          // que le disque ne traverse pas les brins.
          // Rayon volontairement COURT (une dizaine de metres) : au-dela le
          // brin passe sous le pixel et ne fait plus que du bruit, alors que la
          // meme depense concentree pres du joueur double la densite percue.
          // Le fondu s'etale sur la MOITIE du rayon : coupe court, la limite
          // du champ se lit comme un cercle trace autour du joueur.
          float fade = smoothstep(uRadius, uRadius * 0.45, dist) * smoothstep(0.9, 3.0, dist);

          float ang = r3 * 6.2831;
          // Hauteur DIVISEE PAR DEUX : a 25-46 cm chaque touffe lisait comme
          // un arbuste plante dans une pelouse tondue.
          // Un brin sur huit depasse nettement les autres : une hauteur
          //  uniforme donne un tapis tondu, pas une prairie.
          // Rien ne pousse dans l'eau : la hauteur tombe a zero des que le
          // sol passe sous la ligne de flottaison, avec une frange de
          // vegetation rase juste au-dessus.
          float dry = smoothstep(WATER_LEVEL - 0.1, WATER_LEVEL + 1.4, terrainHeightAt(wp, dist));
          float hgt = (0.11 + r1 * 0.11 + step(0.87, r2) * 0.15) * fade * dry;
          float v = uv.y;

          // Le vent couche les touffes, et la vitesse du joueur les couche
          // davantage : le sol participe a la sensation de course.
          // Vent de fond, plus la RAFALE : c'est la vague qui traverse le champ
          // qu'on lit comme du vent, pas l'inclinaison moyenne.
          float wind = sin(uTime * 1.9 + wp.x * 0.35 + wp.y * 0.21) * 0.5 + 0.5;
          float gust = gustAt(wp, uTime);
          float lay = (0.10 + wind * 0.14 + gust * 0.34 + uSpeed * 0.26) * v * v;
          // La meme ombre de nuage que le sol, lue au meme endroit : sans ca les
          // brins resteraient au soleil dans une plage d'ombre.
          vShade = cloudShade(wp, uTime);

          vec3 local = vec3(position.x * (1.0 - v * 0.82) * 0.032, v * hgt, lay * hgt);
          vec2 rot = vec2(cos(ang), sin(ang));
          vec3 world = vec3(
            wp.x + local.x * rot.x - local.z * rot.y,
            0.0,
            wp.y + local.x * rot.y + local.z * rot.x
          );
          world.y = terrainHeightAt(world.xz, dist) + local.y;

          vV = v;
          vTint = r2;
          // Eclairage bon marche : la face du brin regarde son axe de rotation.
          // Plancher haut : un brin ne doit JAMAIS etre plus sombre que le sol,
          // sinon la prairie se lit comme un semis de piquants sombres au lieu
          // d'une matiere continue.
          // Plancher haut : un brin ne doit JAMAIS etre plus sombre que le sol,
          // sinon la prairie se lit comme un semis de piquants sombres au lieu
          // d'une matiere continue.
          vec3 face = normalize(vec3(rot.y, 0.0, -rot.x));
          vLight = 0.80 + 0.20 * abs(dot(face, normalize(vec3(0.4, 0.0, -0.9))));
          // Les brins tournes vers le soleil accrochent un eclat sur la pointe.
          vGlint = pow(max(dot(face, normalize(uSun)), 0.0), 5.0);

          gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uBase, uTip, uGlow, uSkyLight;
        varying float vV, vTint, vLight, vGlint, vShade;
        void main(){
          // Degrade base -> pointe en carre : l'ombre reste au pied, la
          // lumiere ne prend que sur le dernier tiers. Lineaire, un brin lit
          // comme un batonnet peint en degrade.
          vec3 c = mix(uBase, uTip, vV * vV);
          c *= 0.90 + 0.22 * vTint;
          c *= vLight;
          // Translucidite : le soleil traverse la pointe. C'est ce terme qui
          // donne le duvet lumineux d'une prairie a contre-jour.
          c += uGlow * pow(vV, 3.0) * 0.40;
          // Eclat de pointe : c'est le gloss Frutiger Aero applique au vegetal,
          // et il ne prend que sur les brins reellement tournes vers le soleil.
          c += vec3(0.95, 1.0, 0.80) * vGlint * pow(vV, 6.0) * 0.85 * (1.0 - vShade);
          c = mix(c, c * 0.62 + uSkyLight * 0.055, vShade * 0.85);
          gl_FragColor = vec4(c, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -880;
  }

  update(origin: Vector3, time: number, speedN: number): void {
    this.mat.uniforms.uOrigin.value.copy(origin);
    this.mat.uniforms.uTime.value = time;
    this.mat.uniforms.uSpeed.value = speedN;
  }
}
