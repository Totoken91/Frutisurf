import { BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector3 } from 'three';
import { RIDER_GLSL, riderUniforms } from './RiderLight';
import { GLSL_SAFE, GLSL_NOISE } from '../core/Noise';
import { colClone, vec3 } from '../core/Palette';
import { SUN_DIR } from './Sky';
import { GLSL_DAY, dayUniforms } from './Daylight';
import { swellGLSL, terrainGLSL, terrainUniforms } from './Terrain';
import { WEATHER_GLSL } from './Weather';

/**
 * Les etendues d'eau.
 *
 * Aucun lac n'est place a la main. Il y a un NIVEAU, et l'eau remplit tout ce
 * que le relief laisse en dessous : la surface est un plan parfaitement plat,
 * decoupe au `discard` la ou le terrain repasse au-dessus. Les rives suivent
 * donc les courbes de niveau, elles sont organiques et toutes differentes,
 * pour le prix d'une constante.
 *
 * La geometrie est la MEME grille en eventail que le sol, a plat. Elle est
 * dense la ou on la regarde de pres et lache au loin, exactement la ou il faut,
 * et elle suit le joueur par les memes pas entiers de maille.
 *
 * Le rendu vise le Frutiger Aero litteral : turquoise sature, fond visible en
 * eau peu profonde, ciel reflechi a l'incidence rasante, et surtout des
 * PAILLETTES de soleil. Ce sont elles qui font l'eau ; une surface lisse et
 * bleue ne fait qu'un plastique bleu.
 */

const SNAP = 1.2;
const Z_START = 45;
const Z_END = -1800;

function buildGeometry(dense: boolean): BufferGeometry {
  const rows: number[] = [];
  let z = Z_START;
  let step = dense ? SNAP * 2 : SNAP * 3.5;
  while (z > Z_END) {
    rows.push(z);
    z -= step;
    if (z < -120) step = Math.min(step * (dense ? 1.06 : 1.09), 80);
  }
  rows.push(Z_END);

  const cols = dense ? 90 : 56;
  const R = rows.length;
  const pos = new Float32Array(R * cols * 3);
  const idx: number[] = [];
  for (let i = 0; i < R; i++) {
    const zz = rows[i];
    const half = 80 + 1.35 * (Z_START - zz);
    for (let j = 0; j < cols; j++) {
      const t = j / (cols - 1);
      const o = (i * cols + j) * 3;
      pos[o] = (t - 0.5) * 2 * half;
      pos[o + 1] = 0;
      pos[o + 2] = zz;
    }
  }
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const a = i * cols + j;
      idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

export class Water {
  readonly mesh: Mesh;
  readonly mat: ShaderMaterial;

  constructor(dense = true) {
    this.mat = new ShaderMaterial({
      transparent: true,
      depthWrite: true,
      uniforms: {
        ...riderUniforms(),
        // Le relief est pilote par uniformes : changer de monde ne recompile
        // aucun shader (cf. Terrain.terrainGLSL).
        ...terrainUniforms(),
        uTime: { value: 0 },
        uCam: { value: new Vector3() },
        uOrigin: { value: new Vector3() },
        uSun: { value: SUN_DIR.clone() },
        uDeep: { value: vec3('waterDeep') },
        uShallow: { value: vec3('waterShallow') },
        uFoam: { value: vec3('waterFoam') },
        uSkyLow: { value: colClone('skyHorizon') },
        uSkyHigh: { value: colClone('skyMid') },
        uSkyLight: { value: [0.32, 0.52, 0.72] },
        ...dayUniforms(),
        /** x, z du surfeur et force du sillage (0 hors de l'eau). */
        uWake: { value: new Vector3() },
      },
      vertexShader: /* glsl */ `
        uniform vec3 uOrigin;
        uniform float uTime;
        varying vec3 vWorld;
        varying float vDepth;
        /** Pente de la houle, transmise au fragment pour la normale. */
        varying vec2 vSwellSlope;
        /**
         * Hauteur normalisee de la vague, -1 en creux, +1 en crete.
         *
         * Passee en varying plutot que recalculee au fragment : la houle est
         * une fonction lisse a grande echelle, l'interpoler sur un triangle ne
         * coute aucune qualite, et l'evaluer par pixel paierait deux sinus pour
         * une valeur qui ne change quasiment pas sur la surface d'un triangle.
         */
        varying float vCrest;

        ${terrainGLSL()}
${swellGLSL()}

        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          wp.y = WATER_LEVEL;
          float d = length(wp.xz - uOrigin.xz);
          // La profondeur est calculee ICI et interpolee : la decoupe de rive
          // se fait ensuite au fragment sur cette valeur lissee, ce qui donne
          // un bord net mais pas cranele par la grille.
          vDepth = WATER_LEVEL - terrainHeightAt(wp.xz, d);

          // --- LA HOULE, deplacee au sommet.
          //
          //     La MEME fonction que celle du Controller, au meme instant : le
          //     surfeur plane a la hauteur que calcule le processeur, la vague
          //     est dessinee a la hauteur que calcule la carte graphique. Un
          //     ecart de signe le ferait surfer dans les creux, un ecart
          //     d'amplitude le ferait flotter au-dessus de l'eau.
          float shoal = swellShoal(vDepth);
          float sw = swellAt(wp.xz, uTime);
          wp.y += sw * shoal;
          vCrest = uSwell.x > 0.0 ? sw / uSwell.x : 0.0;

          // La pente de la vague, par differences finies sur quelques metres.
          // Sans elle la houle serait une deformation SANS ombre : la surface
          // monterait et descendrait sans qu'aucune lumiere ne le dise, et on
          // ne verrait rien du tout.
          float e = 2.5;
          vSwellSlope = vec2(
            swellAt(wp.xz + vec2(e, 0.0), uTime) - swellAt(wp.xz - vec2(e, 0.0), uTime),
            swellAt(wp.xz + vec2(0.0, e), uTime) - swellAt(wp.xz - vec2(0.0, e), uTime)
          ) * (shoal / (2.0 * e));

          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
${GLSL_SAFE}
        uniform float uTime;
        uniform vec3 uCam, uSun, uDeep, uShallow, uFoam, uSkyLow, uSkyHigh, uSkyLight, uWake;
${GLSL_DAY}
        varying vec3 vWorld;
        varying float vDepth;
        varying vec2 vSwellSlope;
        varying float vCrest;
        uniform vec3 uSwell;
${RIDER_GLSL}

        ${GLSL_NOISE}
        ${WEATHER_GLSL}

        void main(){
          // Hors de l'eau : rien. C'est ce discard qui dessine les rives.
          if (vDepth <= 0.02) discard;

          vec3 V = nsafe(uCam - vWorld, vec3(0.0, 1.0, 0.0));
          vec3 L = normalize(uSun);

          // --- La ride. Deux couches de bruit qui derivent en sens contraire :
          //     une seule donnerait un motif qui glisse en bloc, et l'oeil lit
          //     tout de suite une texture qu'on translate.
          vec2 p = vec2(vWorld.x, mod(vWorld.z, 1000.0));
          vec2 a = p * 0.38 + vec2(uTime * 0.22, uTime * 0.14);
          vec2 b = p * 0.83 - vec2(uTime * 0.17, uTime * 0.31);
          float h1 = fbm(a);
          float h2 = fbm(b);
          // Normale par differences finies sur le champ de rides.
          float e = 0.06;
          float hx = fbm(a + vec2(e, 0.0)) * 0.6 + fbm(b + vec2(e, 0.0)) * 0.4;
          float hz = fbm(a + vec2(0.0, e)) * 0.6 + fbm(b + vec2(0.0, e)) * 0.4;
          float h0 = h1 * 0.6 + h2 * 0.4;
          // --- SILLAGE. Il n'y a pas de glisse sans trace. C'est lui qui dit
          //     que le disque PORTE sur l'eau au lieu de la traverser, et c'est
          //     le seul retour qui reste visible quand la camera est basse.
          //     Deux branches en V ouvertes a ~20 degres, plus le remous
          //     central juste derriere le disque.
          vec2 rel = vWorld.xz - uWake.xy;
          float back = rel.y; // le joueur avance en -Z : derriere lui, c'est +Z
          float wake = 0.0;
          if (uWake.z > 0.001 && back > -1.0 && back < 90.0) {
            float bb = max(back, 0.0);
            float arm = abs(abs(rel.x) - bb * 0.36);
            float fade = 1.0 - bb / 90.0;
            wake = exp(-arm * arm * 1.1) * fade * fade;
            wake += exp(-rel.x * rel.x * 0.30) * exp(-bb * 0.20) * 0.85;
            wake *= uWake.z;
          }

          // Les rides s'aplatissent en eau peu profonde, comme dans la nature.
          float amp = 1.5 * smoothstep(0.0, 1.6, vDepth);
          vec3 N = normalize(vec3((h0 - hx) * amp, 0.09, (h0 - hz) * amp));
          // La houle incline la normale a GRANDE echelle : c'est ce qui donne
          // aux flancs de vague leur ombre et a leurs cretes leur reflet, donc
          // ce qui rend le relief de l'ocean lisible de loin.
          N = normalize(N + vec3(-vSwellSlope.x, 0.0, -vSwellSlope.y) * 2.2);
          // Le sillage BOMBE la surface : il doit accrocher la lumiere, sinon
          // ce n'est qu'une trainee blanche peinte sur l'eau.
          N = normalize(N + vec3(sign(rel.x) * wake * 0.55, 0.0, -wake * 0.35));

          // --- LE CORPS DE L'EAU, et lui seul, recoit l'heure.
          //
          //     C'est ici que le crepuscule tournait mal. La couleur finale —
          //     corps ET reflet du ciel confondus — passait dans daylight()
          //     tout a la fin, donc le reflet du ciel etait teinte une SECONDE
          //     fois par la lumiere. Un cyan sature multiplie par un orange
          //     sature ne donne ni du cyan ni de l'orange : ca donne un gris
          //     verdatre, et le lac devenait de la boue exactement au moment ou
          //     il aurait du etre le plus beau.
          float t = smoothstep(0.15, 4.6, vDepth);
          vec3 body = mix(uShallow, uDeep, t);
          body = daylight(body, 0.30 + uDayNight * 0.34);

          // --- Le reflet, lui, est DEJA a la couleur du ciel : on n'y touche
          //     plus.
          float fres = pow(max(1.0 - clamp(dot(N, V), 0.0, 1.0), 1e-4), 4.0);
          vec3 sky = mix(uSkyLow, uSkyHigh, clamp(V.y * 1.6, 0.0, 1.0));

          // Plus le soleil est bas, plus l'eau devient un MIROIR. C'est toute
          // la difference entre un lac de midi, qui a une couleur propre, et un
          // lac de couchant, qui n'a plus que des reflets. Sans ce terme, une
          // eau turquoise reste turquoise sous un ciel de braise — ce que la
          // physique interdit et ce que l'oeil repere immediatement.
          float mirror = clamp(fres * (1.15 + uDayWarm * 1.45), 0.0, 0.95);
          vec3 c = mix(body, sky, mirror);

          // L'ecume du sillage AVANT les paillettes : posee apres, elle les
          // effacait et le sillage devenait une bande de peinture blanche
          // mate au milieu d'une eau qui scintille partout ailleurs.
          vec3 foamCol = daylight(uFoam, 0.18 + uDayNight * 0.42);
          c = mix(c, foamCol, clamp(wake * 0.78, 0.0, 0.82));

          // --- PAILLETTES. Le detail qui fait l'eau, et il faut qu'il soit
          //     dur : un speculaire large donne du satin, c'est une multitude
          //     de points nets qui donne une surface liquide au soleil.
          vec3 H = normalize(V + L);
          float ndh = max(dot(N, H), 0.0);
          // Exposant 340 : c'est le pow le plus violent du projet. En mediump,
          // n * log2(x) perd toute precision utile bien avant d'atteindre ce
          // rang, et a ndh = 0 il produit un NaN qui, additionne a la couleur,
          // rend le pixel noir puis contamine le flou de bloom.
          float ndhs = max(ndh, 1e-4);
          float glint = pow(ndhs, 340.0) * 5.0 + pow(ndhs, 46.0) * 0.55;
          // La paillette prend la couleur du SOLEIL, pas un blanc chaud fixe.
          // C'est elle qui dessine le chemin de lumiere sur l'eau, et un chemin
          // blanc sous un soleil orange est la faute qu'on remarque sans savoir
          // la nommer.
          c += mix(vec3(1.0, 0.98, 0.90), uDayLight * 1.5, uDayWarm) * glint;

          // --- Ecume de rive. Elle suit la ligne de flottaison, donc la courbe
          //     de niveau du terrain : c'est gratuit et toujours juste.
          float foam = (1.0 - smoothstep(0.0, 0.55, vDepth))
                     * (0.55 + 0.45 * sin(vDepth * 26.0 - uTime * 2.4));
          c = mix(c, foamCol, clamp(foam, 0.0, 1.0) * 0.75);

          // --- L'ECUME DE CRETE. Une vague sans mousse sur le dessus est une
          //     bosse, pas une vague. On la pose la ou la surface est le plus
          //     HAUTE — c'est-a-dire au sommet du train principal — et
          //     seulement au large, ou la houle a de l'amplitude.
          float crest = smoothstep(0.30, 0.85, vCrest);
          c = mix(c, foamCol, crest * smoothstep(0.4, 4.0, vDepth) * 0.34);

          // --- Les nuages assombrissent l'eau comme le reste du paysage.
          float dark = cloudShade(vWorld.xz, uTime);
          c = mix(c, c * 0.58 + uSkyLight * 0.05, dark * 0.8);

          // La lampe du surfeur sur l'eau. Elle y est plus FORTE que sur
          // l'herbe : une surface reflechissante renvoie ce qu'on lui donne, et
          // une lueur qui glisse sur la mer la nuit est l'image que ce jeu
          // cherche depuis le debut.
          c += riderLight(vWorld) * (0.5 + uDayNight * 1.15);

          // Opacite : transparente au bord, franche au large.
          float alpha = mix(0.55, 0.97, smoothstep(0.0, 1.3, vDepth));
          gl_FragColor = vec4(c, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new Mesh(buildGeometry(dense), this.mat);
    this.mesh.frustumCulled = false;
    // Apres le sol et les brins, avant les nuages : l'eau doit recouvrir le
    // fond qu'elle cache et se laisser recouvrir par ce qui flotte dessus.
    this.mesh.renderOrder = -860;
  }

  /** @param wake x, z du surfeur et force du sillage — 0 quand il n'est pas dessus. */
  update(camPos: Vector3, origin: Vector3, time: number, wake: Vector3): void {
    const u = this.mat.uniforms;
    u.uCam.value.copy(camPos);
    u.uOrigin.value.copy(origin);
    u.uWake.value.copy(wake);
    u.uTime.value = time;
    this.mesh.position.z = Math.round(origin.z / SNAP) * SNAP;
  }
}

