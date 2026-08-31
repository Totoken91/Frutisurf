import { CanvasTexture, LinearMipmapLinearFilter, RepeatWrapping } from 'three';
import { Rng, valueNoise2D } from '../core/Noise';

/**
 * La texture de brins, generee au boot.
 *
 * Jusqu'ici la plaine n'avait que du bruit fractal : des taches, pas des
 * brins. A trois metres de la camera on voyait un aplat colore, et c'est ce qui
 * trahissait le plus le rendu — une prairie se reconnait a son GRAIN bien avant
 * sa couleur.
 *
 * Elle encode quatre canaux :
 *   R,G  la normale du micro-relief (x et y, centrees sur 0,5)
 *   B    la variation d'albedo : touffes claires, creux plus sombres
 *   A    la couverture de brins, qui sert de masque au speculaire et a l'ombre
 *
 * La normale est le canal qui compte. Avec un soleil bas et de face, ce sont
 * les milliers de micro-facettes des brins qui accrochent la lumiere : sans
 * elles, aucune quantite de bruit sur la COULEUR ne fera de l'herbe.
 *
 * La tuile est raccordable : tout trait proche d'un bord est redessine de
 * l'autre cote. Sans ca, une couture apparait tous les 1,6 m.
 */

export interface GrassMaps {
  texture: CanvasTexture;
  /** Repetitions par metre. 1000 * cette valeur doit rester ENTIER : le sol
   *  replie sa coordonnee Z modulo 1000 m, et un multiple non entier de la
   *  periode de tuile y ferait une couture franche. */
  scale: number;
}

/** Un trait de brin : courbe, effile, plus clair vers la pointe. */
function blade(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  len: number,
  ang: number,
  width: number,
  value: number,
): void {
  const bend = (Math.random() - 0.5) * 0.9;
  const mx = x + Math.cos(ang + bend * 0.5) * len * 0.5;
  const my = y + Math.sin(ang + bend * 0.5) * len * 0.5;
  const ex = x + Math.cos(ang + bend) * len;
  const ey = y + Math.sin(ang + bend) * len;
  ctx.strokeStyle = `rgba(255,255,255,${value})`;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.quadraticCurveTo(mx, my, ex, ey);
  ctx.stroke();
}

export function makeGrassTexture(res = 512): GrassMaps {
  const S = res;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d')!;
  const rng = new Rng(90210);

  // --- Passe 1 : le champ de HAUTEUR, dessine en niveaux de gris.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, S, S);
  ctx.globalCompositeOperation = 'lighter';

  const count = Math.round((S * S) / 95);
  const margin = S * 0.09;
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, S);
    const y = rng.range(0, S);
    // Orientation LIBRE. Un biais directionnel reapparait a l'ecran sous forme
    // de rayures des que la camera rase le sol — le defaut precedent du projet.
    const ang = rng.range(0, Math.PI * 2);
    const len = rng.range(S * 0.012, S * 0.034);
    const w = rng.range(S / 520, S / 300);
    const v = rng.range(0.12, 0.38);
    blade(ctx, x, y, len, ang, w, v);
    // Raccord : un trait pres d'un bord est redessine de l'autre cote.
    const ox = x < margin ? S : x > S - margin ? -S : 0;
    const oy = y < margin ? S : y > S - margin ? -S : 0;
    if (ox) blade(ctx, x + ox, y, len, ang, w, v);
    if (oy) blade(ctx, x, y + oy, len, ang, w, v);
    if (ox && oy) blade(ctx, x + ox, y + oy, len, ang, w, v);
  }
  ctx.globalCompositeOperation = 'source-over';

  // --- Passe 2 : normale par differences finies, plus albedo et couverture.
  const img = ctx.getImageData(0, 0, S, S);
  const d = img.data;
  const h = new Float32Array(S * S);
  for (let i = 0; i < S * S; i++) h[i] = d[i * 4] / 255;

  const seed = rng.range(0, 400);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      // Voisinage REPLIE : la normale doit se raccorder comme le dessin.
      const xm = h[y * S + ((x - 1 + S) % S)];
      const xp = h[y * S + ((x + 1) % S)];
      const ym = h[((y - 1 + S) % S) * S + x];
      const yp = h[((y + 1) % S) * S + x];
      const nx = (xm - xp) * 1.5;
      const ny = (ym - yp) * 1.5;

      // Touffes : une modulation lente qui groupe les brins en paquets. Sans
      // elle la densite est uniforme, et une prairie uniforme lit comme un tapis.
      const clump =
        valueNoise2D((x / S) * 5 + seed, (y / S) * 5) * 0.62 +
        valueNoise2D((x / S) * 13 + seed, (y / S) * 13) * 0.38;

      const cov = Math.min(1, h[i] * 1.35);
      const j = i * 4;
      d[j] = Math.max(0, Math.min(255, (nx * 0.5 + 0.5) * 255));
      d[j + 1] = Math.max(0, Math.min(255, (ny * 0.5 + 0.5) * 255));
      d[j + 2] = Math.max(0, Math.min(255, (clump * 0.75 + cov * 0.25) * 255));
      d[j + 3] = cov * 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const texture = new CanvasTexture(cv);
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = 8;
  // PAS de conversion sRGB : ces canaux sont des DONNEES (normale, masque),
  // pas des couleurs. Les faire passer par une courbe gamma decalerait la
  // normale et l'eclairage partirait de travers.
  // Une periode de 1 m : a 1,6 m les traits faisaient huit centimetres a
  // l'ecran et le sol lisait comme du cuir craquele, pas comme de l'herbe.
  return { texture, scale: 1.0 };
}
