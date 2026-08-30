import {
  CanvasTexture,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  NormalBlending,
  PlaneGeometry,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
} from 'three';
import { Rng, valueNoise2D } from '../core/Noise';
import { vec3 } from '../core/Palette';
import { SUN_DIR } from './Sky';

/**
 * Les cumulus. C'est le poste qui fait ou defait le Frutiger Aero.
 *
 * La premiere version dessinait des pastilles : un empilement de gaussiennes,
 * un degrade vertical en guise d'ombrage, silhouette parfaitement ronde. A
 * cote des references c'etait du carton decoupe — un cumulus n'a pas un
 * dessus clair et un dessous sombre, il a des LOBES, chacun avec sa propre
 * face eclairee et sa propre ombre portee sur le lobe d'a cote.
 *
 * Trois changements, dans l'ordre d'importance :
 *
 *  1. L'ombrage vient d'une NORMALE, pas d'une hauteur. On accumule le champ
 *     de densite dans un tampon flottant, on en prend le gradient, et on
 *     eclaire ce faux relief avec la vraie direction du soleil. Chaque lobe
 *     recupere sa joue claire et son creux sombre : le nuage prend du volume
 *     sans une seule ligne de rendu volumetrique.
 *  2. Des sous-lobes fractals et une deformation de contour au bruit. Une
 *     silhouette parfaitement circulaire trahit le procede a tous les coups.
 *  3. Un LISERE argente la ou le nuage est mince. C'est le detail signature
 *     des references : le bord ne fond pas dans le ciel, il s'allume.
 *
 * Et cote champ, trois plans au lieu d'un seul : un banc massif pose sur
 * l'horizon, une couche mediane, quelques nuages proches et hauts. C'est
 * l'etagement qui donne la distance, pas la taille des sprites.
 */

interface Lobe {
  x: number;
  y: number;
  r: number;
}

/**
 * Noyau de densite d'un lobe. Polynomial : trois fois plus rapide qu'une
 * exponentielle, meme galbe.
 *
 * Le support s'etend a 1,8 fois le rayon nominal, et c'est le point CRITIQUE.
 * Une premiere version coupait net au rayon : chaque lobe restait une bulle
 * isolee, la somme ne formait aucune masse, et l'atlas rendait un chapelet de
 * bulles au lieu d'un cumulus. Deux lobes ne se fondent l'un dans l'autre que
 * si leurs queues se recouvrent largement.
 */
function blob(d2: number): number {
  const s = d2 * 0.30;
  if (s >= 1) return 0;
  const t = 1 - s;
  return t * t * t;
}

function makeCloudAtlas(res: number): CanvasTexture {
  const S = res;
  const H = S >> 1; // cote d'une cellule de l'atlas 2x2
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(S, S);
  const d = img.data;
  const rng = new Rng(20240524);
  const field = new Float32Array(H * H);

  // Lumiere dans l'espace de la texture. v croit vers le BAS, d'ou le signe.
  //
  // Elle est volontairement orientee VERS L'OBSERVATEUR (z dominant). Une
  // lumiere rasante donnait un ndl de 0,31 sur toutes les zones plates, donc
  // un cumulus gris de bout en bout — des nuages d'orage. Avec z dominant, le
  // plat est PLEINEMENT eclaire et seuls les flancs qui se detournent et les
  // plis entre lobes s'assombrissent : blanc eclatant, creux bleutes.
  const lx = 0.40;
  const ly = -0.48;
  const lz = 0.78;

  for (let q = 0; q < 4; q++) {
    const ox = (q % 2) * H;
    const oy = ((q / 2) | 0) * H;

    // --- Silhouette : une rangee de gros lobes a la base, un ou deux etages
    //     au-dessus, puis des sous-lobes accroches sur chaque gros lobe.
    const lobes: Lobe[] = [];
    // Rangee de base : elle porte la MASSE et la ligne de flottaison.
    const nBase = rng.int(5, 7);
    for (let i = 0; i < nBase; i++) {
      const t = nBase === 1 ? 0.5 : i / (nBase - 1);
      const spread = Math.sin(Math.PI * t);
      lobes.push({
        x: 0.15 + t * 0.70 + rng.range(-0.03, 0.03),
        y: 0.65 - spread * 0.08,
        r: 0.105 + spread * rng.range(0.05, 0.095),
      });
    }
    // Etage superieur : les tours. C'est lui qui donne la hauteur du cumulus.
    const nUp = rng.int(2, 4);
    for (let i = 0; i < nUp; i++) {
      const t = nUp === 1 ? 0.5 : i / (nUp - 1);
      lobes.push({
        x: 0.27 + t * 0.46 + rng.range(-0.06, 0.06),
        y: 0.44 + rng.range(-0.05, 0.04),
        r: 0.11 + rng.range(0.0, 0.085),
      });
    }
    if (rng.next() < 0.85) {
      lobes.push({ x: rng.range(0.34, 0.66), y: rng.range(0.24, 0.33), r: rng.range(0.10, 0.16) });
    }
    // Sous-lobes. GROS et peu nombreux : le premier reglage en mettait deux a
    // trois par lobe majeur, a 40 % de leur rayon. Resultat, du pop-corn — une
    // grappe de petites bosses qui detruisait la silhouette d'ensemble au lieu
    // de l'enrichir. Un cumulus se lit d'abord a sa MASSE ; le detail ne doit
    // jamais concurrencer le contour general.
    const major = lobes.length;
    for (let i = 0; i < major; i++) {
      if (rng.next() < 0.45) continue;
      const l = lobes[i];
      const a = rng.range(0, Math.PI * 2);
      const dr = l.r * rng.range(0.45, 0.70);
      lobes.push({
        x: l.x + Math.cos(a) * dr,
        y: l.y + Math.sin(a) * dr * 0.6,
        r: l.r * rng.range(0.58, 0.82),
      });
    }

    // --- Passe 1 : le champ de densite.
    const seed = rng.range(0, 500);
    for (let y = 0; y < H; y++) {
      const v = y / H;
      for (let x = 0; x < H; x++) {
        const u = x / H;
        let f = 0;
        for (let i = 0; i < lobes.length; i++) {
          const l = lobes[i];
          const dx = (u - l.x) / l.r;
          const dy = (v - l.y) / l.r;
          f += blob(dx * dx + dy * dy);
        }
        // Deformation du contour : sans elle, chaque bord reste un arc de
        // cercle parfait et l'oeil lit la construction geometrique.
        // Deformation BASSE frequence seulement. A 22 cycles la texture
        // grumelait le contour au lieu de l'irregulariser.
        f += (valueNoise2D(u * 5.5 + seed, v * 5.5) - 0.5) * 0.30;
        f += (valueNoise2D(u * 12.0 + seed, v * 12.0) - 0.5) * 0.09;
        field[y * H + x] = f;
      }
    }

    // --- Passe 2 : normale par differences finies, puis eclairage.
    for (let y = 0; y < H; y++) {
      const v = y / H;
      for (let x = 0; x < H; x++) {
        const i0 = y * H + x;
        const f = field[i0];

        // Base franche : un cumulus a un fond PLAT, c'est ce qui le distingue
        // d'un cumulonimbus ou d'un simple paquet de coton.
        const floorCut = 1 - Math.max(0, (v - 0.76) / 0.05);
        let a = Math.min(1, Math.max(0, (f - 0.36) * 2.2)) * Math.max(0, floorCut);
        a = a * a * (3 - 2 * a);

        const xm = x > 0 ? field[i0 - 1] : f;
        const xp = x < H - 1 ? field[i0 + 1] : f;
        const ym = y > 0 ? field[i0 - H] : f;
        const yp = y < H - 1 ? field[i0 + H] : f;
        // Le gradient du champ EST la pente du relief apparent. On l'inverse :
        // le champ monte vers l'interieur du nuage, la surface s'y bombe.
        // Amplitude du relief apparent. Reglee entre deux ecueils : a 3,2 avec
        // des sous-lobes serres, chaque bosse devenait dure et le nuage
        // ressemblait a un cerveau ; a 1,4 l'interieur redevenait un aplat.
        let nx = (xm - xp) * 2.6;
        let ny = (ym - yp) * 2.6;
        const nz = 1.0;
        const inv = 1 / Math.hypot(nx, ny, nz);
        nx *= inv;
        ny *= inv;
        const nzn = nz * inv;

        const ndl = nx * lx + ny * ly + nzn * lz;
        // Eclairage enveloppant : un nuage est un milieu diffusant, sa face a
        // l'ombre reste claire. Un Lambert brut le rendrait sale.
        let lit = ndl * 0.80 + 0.28;
        // Occlusion verticale : le dessous d'un cumulus est toujours plus
        // sombre que son sommet, meme la ou la normale dit le contraire — la
        // lumiere du ciel n'y arrive plus. C'est ce terme qui pose le nuage.
        lit *= 0.82 + 0.18 * (1 - v);
        lit = Math.min(1, Math.max(0, lit));

        const j = ((oy + y) * S + (ox + x)) * 4;
        d[j] = lit * 255;
        // Vert = epaisseur normalisee, lue par le shader pour le lisere.
        d[j + 1] = Math.min(1, Math.max(0, (f - 0.34) * 1.5)) * 255;
        d[j + 2] = 255;
        d[j + 3] = a * 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export class Clouds {
  readonly mesh: Mesh;
  private mat: ShaderMaterial;
  readonly span = 2600;

  constructor(count = 64, res = 768) {
    const base = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    geo.instanceCount = count;

    const off = new Float32Array(count * 3);
    const scl = new Float32Array(count * 2);
    const misc = new Float32Array(count * 3); // variante, opacite, phase
    const rng = new Rng(77);

    for (let i = 0; i < count; i++) {
      // Trois plans. La proportion compte plus que les tailles : c'est le banc
      // d'horizon qui donne l'echelle du monde, et il doit dominer.
      const band = i / count;
      let z: number;
      let y: number;
      let s: number;
      if (band < 0.22) {
        // Banc d'horizon : quelques masses enormes. Elles sont maintenant
        // PLUS HAUTES qu'avant (leur base passe au-dessus des tours) et moins
        // nombreuses : posees sur la ligne, elles effacaient la ville, qui est
        // pourtant la seule chose que le joueur voit au loin.
        z = -rng.range(this.span * 0.62, this.span);
        y = rng.range(240, 400);
        s = rng.range(420, 760);
      } else if (band < 0.80) {
        // Couche mediane : le gros du ciel.
        z = -rng.range(this.span * 0.26, this.span * 0.68);
        y = rng.range(180, 340);
        s = rng.range(230, 460);
      } else {
        // Quelques nuages proches et hauts : ils passent au-dessus du joueur
        // et donnent la vitesse. Sans eux le ciel est une image fixe.
        z = -rng.range(180, this.span * 0.30);
        y = rng.range(210, 430);
        s = rng.range(120, 280);
      }
      off[i * 3] = rng.range(-1900, 1900);
      off[i * 3 + 1] = y;
      off[i * 3 + 2] = z;

      scl[i * 2] = s;
      // Cumulus plus large que haut, toujours. Un carre lit comme un ballon.
      scl[i * 2 + 1] = s * rng.range(0.50, 0.70);

      misc[i * 3] = rng.int(0, 3);
      // Le banc lointain reste transparent : c'est un fond, pas un sujet.
      misc[i * 3 + 1] = band < 0.22 ? rng.range(0.50, 0.72) : rng.range(0.82, 1.0);
      misc[i * 3 + 2] = rng.range(0, 100);
    }

    geo.setAttribute('iOffset', new InstancedBufferAttribute(off, 3));
    geo.setAttribute('iScale', new InstancedBufferAttribute(scl, 2));
    geo.setAttribute('iMisc', new InstancedBufferAttribute(misc, 3));

    this.mat = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: {
        uMap: { value: makeCloudAtlas(res) },
        uTime: { value: 0 },
        uOrigin: { value: new Vector3() },
        uSpan: { value: this.span },
        uHorizon: { value: vec3('skyHorizon') },
        uCore: { value: vec3('cloudCore') },
        uShadow: { value: vec3('cloudShadow') },
        uRim: { value: vec3('cloudRim') },
        uSun: { value: SUN_DIR.clone() },
      },
      vertexShader: /* glsl */ `
        attribute vec3 iOffset;
        attribute vec2 iScale;
        attribute vec3 iMisc;
        uniform float uTime, uSpan;
        uniform vec3 uOrigin;
        varying vec2 vUv;
        varying float vOpacity;
        varying float vDepth;
        varying vec3 vDir;

        void main(){
          // Repli du champ devant la camera : les nuages ne s'epuisent jamais.
          vec3 o = iOffset;
          o.z = uOrigin.z - mod(uOrigin.z - o.z, uSpan);
          o.x += uOrigin.x * 0.10 + sin(uTime * 0.05 + iMisc.z) * 14.0;

          // Billboard autour de Y uniquement.
          vec3 toCam = cameraPosition - o;
          // Un nuage exactement au-dessus (ou au-dessous) de la camera annule
          // le produit vectoriel, et normalize(vec3(0)) rend NaN : le quad
          // disparait. Repli sur un axe arbitraire, le billboard est de toute
          // facon degenere dans ce cas.
          vec3 axis = cross(vec3(0.0, 1.0, 0.0), toCam);
          float axisLen = length(axis);
          vec3 right = axisLen > 1e-4 ? axis / axisLen : vec3(1.0, 0.0, 0.0);
          vec3 pos = o + right * position.x * iScale.x + vec3(0.0, 1.0, 0.0) * position.y * iScale.y;

          // Quadrant de l'atlas
          float q = iMisc.x;
          vec2 cell = vec2(mod(q, 2.0), floor(q * 0.5));
          vUv = (uv + cell) * 0.5;

          vDepth = clamp((uOrigin.z - o.z) / uSpan, 0.0, 1.0);
          vOpacity = iMisc.y;
          vDir = normalize(pos - cameraPosition);

          gl_Position = projectionMatrix * viewMatrix * vec4(pos, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform vec3 uHorizon, uCore, uShadow, uRim, uSun;
        varying vec2 vUv;
        varying float vOpacity;
        varying float vDepth;
        varying vec3 vDir;

        void main(){
          vec4 t = texture2D(uMap, vUv);
          if (t.a < 0.01) discard;

          // Ombrage volumetrique precalcule dans le canal rouge, mais durci
          // ici : la courbe compte autant que le calcul. Un melange lineaire
          // entre ombre et lumiere donne un nuage laiteux.
          float lit = smoothstep(0.10, 0.96, t.r);
          vec3 c = mix(uShadow, uCore, lit);

          // --- Lisere argente. La ou le nuage est MINCE (canal vert bas mais
          // couverture encore franche), la lumiere le traverse. C'est le
          // detail qui separe un cumulus d'une tache blanche.
          // Fenetre ETROITE : le premier reglage allumait un lisere sur tout
          // le pourtour de chaque nuage, et l'ensemble virait au dessin au
          // neon. Un lisere ne se voit que sur les quelques pixels ou le nuage
          // est vraiment mince.
          float thin = (1.0 - smoothstep(0.02, 0.20, t.g)) * smoothstep(0.12, 0.60, t.a);
          // Plus fort du cote du soleil : un contre-jour ne s'allume pas
          // uniformement sur tout le pourtour.
          float back = max(dot(normalize(vDir), normalize(uSun)), 0.0);
          c += uRim * thin * (0.10 + back * 0.85);

          // Les nuages lointains se dissolvent dans la brume d'horizon. A 50 %
          // le banc du fond devenait invisible : il n'a plus de blanc a lui.
          c = mix(c, uHorizon, vDepth * 0.30);
          float a = t.a * vOpacity * (1.0 - vDepth * 0.20);
          // Fondu d'apparition en fond de zone : jamais de pop.
          a *= smoothstep(1.0, 0.88, vDepth);
          gl_FragColor = vec4(c, a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.mat.blending = NormalBlending;

    this.mesh = new Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -700;
  }

  update(origin: Vector3, time: number): void {
    this.mat.uniforms.uOrigin.value.copy(origin);
    this.mat.uniforms.uTime.value = time;
  }
}
