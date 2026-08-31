import { BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector3 } from 'three';
import { GLSL_SAFE, GLSL_NOISE } from '../core/Noise';
import { colClone, vec3 } from '../core/Palette';
import { SUN_DIR } from './Sky';
import { GLSL_DAY, dayUniforms } from './Daylight';
import { terrainGLSL, WATER_LEVEL } from './Terrain';
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
        varying vec3 vWorld;
        varying float vDepth;

        ${terrainGLSL()}

        void main(){
          vec4 wp = modelMatrix * vec4(position, 1.0);
          wp.y = WATER_LEVEL;
          float d = length(wp.xz - uOrigin.xz);
          // La profondeur est calculee ICI et interpolee : la decoupe de rive
          // se fait ensuite au fragment sur cette valeur lissee, ce qui donne
          // un bord net mais pas cranele par la grille.
          vDepth = WATER_LEVEL - terrainHeightAt(wp.xz, d);
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
          // Le sillage BOMBE la surface : il doit accrocher la lumiere, sinon
          // ce n'est qu'une trainee blanche peinte sur l'eau.
          N = normalize(N + vec3(sign(rel.x) * wake * 0.55, 0.0, -wake * 0.35));

          // --- Couleur du volume : le fond transparait en eau basse.
          float t = smoothstep(0.15, 4.6, vDepth);
          vec3 body = mix(uShallow, uDeep, t);

          // --- Reflexion du ciel a l'incidence rasante. C'est le terme qui
          //     fait la SURFACE : sans Fresnel, une etendue d'eau vue de loin
          //     reste une tache bleue posee sur l'herbe.
          float fres = pow(max(1.0 - clamp(dot(N, V), 0.0, 1.0), 1e-4), 4.0);
          vec3 sky = mix(uSkyLow, uSkyHigh, clamp(V.y * 1.6, 0.0, 1.0));
          vec3 c = mix(body, sky, clamp(fres * 1.15, 0.0, 0.92));

          // L'ecume du sillage AVANT les paillettes : posee apres, elle les
          // effacait et le sillage devenait une bande de peinture blanche
          // mate au milieu d'une eau qui scintille partout ailleurs.
          c = mix(c, uFoam, clamp(wake * 0.78, 0.0, 0.82));

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
          c += vec3(1.0, 0.98, 0.90) * glint;

          // --- Ecume de rive. Elle suit la ligne de flottaison, donc la courbe
          //     de niveau du terrain : c'est gratuit et toujours juste.
          float foam = (1.0 - smoothstep(0.0, 0.55, vDepth))
                     * (0.55 + 0.45 * sin(vDepth * 26.0 - uTime * 2.4));
          c = mix(c, uFoam, clamp(foam, 0.0, 1.0) * 0.75);

          // --- Les nuages assombrissent l'eau comme le reste du paysage.
          float dark = cloudShade(vWorld.xz, uTime);
          c = mix(c, c * 0.58 + uSkyLight * 0.05, dark * 0.8);

          // Opacite : transparente au bord, franche au large.
          // L'heure. Le reflet du ciel est DEJA a la bonne couleur (uSkyLow et
          // uSkyHigh viennent du cycle) : seul le corps de l'eau doit etre
          // teinte, sinon on colore deux fois le meme ciel.
          c = daylight(c, dark * 0.45 + uDayNight * 0.22);
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

export { WATER_LEVEL };
