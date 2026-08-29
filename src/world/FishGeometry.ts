import { BufferAttribute, BufferGeometry } from 'three';

/**
 * Poisson procedural. Corps en anneaux le long de Z (nez en +Z), comprime
 * lateralement comme un vrai poisson, plus caudale, dorsale et pectorales.
 *
 * L'attribut `aSpine` (0 = pointe de la queue, 1 = nez) sert au shader a
 * moduler l'ondulation : la queue balaye, la tete bouge a peine.
 */
export function makeFishGeometry(): BufferGeometry {
  const RINGS = 22;
  const SEG = 10;
  const pos: number[] = [];
  const nor: number[] = [];
  const spine: number[] = [];
  const idx: number[] = [];

  const smoothstep = (a: number, b: number, x: number): number => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  const radius = (u: number): number => {
    // Montee longue depuis la queue : c'est ce qui donne un fuseau et pas un ballon.
    const rise = Math.pow(smoothstep(0.02, 0.62, u), 0.8);
    // Arc de cercle sur l'avant : nez arrondi, jamais pointu.
    const t = Math.min(1, Math.max(0, (u - 0.74) / 0.26));
    const fall = Math.sqrt(Math.max(0, 1 - t * t));
    return rise * fall;
  };

  for (let i = 0; i < RINGS; i++) {
    const u = i / (RINGS - 1);
    const z = -1 + u * 2;
    const r = radius(u);
    // Le ventre descend plus bas que le dos ne monte : silhouette de poisson.
    const belly = -0.07 * r;
    for (let j = 0; j < SEG; j++) {
      const a = (j / SEG) * Math.PI * 2;
      const cx = Math.cos(a);
      const sy = Math.sin(a);
      const x = cx * r * 0.22;
      const y = sy * r * 0.40 + belly;
      pos.push(x, y, z);
      const n = Math.hypot(cx * 0.40, sy * 0.22) || 1;
      nor.push((cx * 0.40) / n, (sy * 0.22) / n, 0);
      spine.push(u);
    }
  }
  for (let i = 0; i < RINGS - 1; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = i * SEG + j;
      const b = i * SEG + ((j + 1) % SEG);
      const c = (i + 1) * SEG + j;
      const d = (i + 1) * SEG + ((j + 1) % SEG);
      idx.push(a, c, b, b, c, d);
    }
  }

  /** Ajoute une nageoire plate (quad) et renvoie rien. */
  const fin = (
    verts: Array<[number, number, number]>,
    normal: [number, number, number],
    u: number,
  ): void => {
    const base = pos.length / 3;
    for (const v of verts) {
      pos.push(v[0], v[1], v[2]);
      nor.push(normal[0], normal[1], normal[2]);
      spine.push(u);
    }
    idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  };

  // Caudale fourchue, dans le plan XY, derriere la queue.
  fin(
    [
      [0, 0.015, -0.94],
      [0, 0.34, -1.46],
      [0, 0.05, -1.22],
      [0, -0.015, -0.94],
    ],
    [0, 0, 1],
    0.02,
  );
  fin(
    [
      [0, -0.015, -0.94],
      [0, 0.03, -1.22],
      [0, -0.32, -1.44],
      [0, -0.05, -0.94],
    ],
    [0, 0, 1],
    0.02,
  );

  // Dorsale.
  fin(
    [
      [0, 0.20, 0.30],
      [0, 0.46, 0.02],
      [0, 0.42, -0.36],
      [0, 0.16, -0.30],
    ],
    [0, 0, 1],
    0.55,
  );

  // Pectorales, une de chaque cote.
  for (const s of [1, -1]) {
    fin(
      [
        [0.08 * s, -0.02, 0.32],
        [0.30 * s, -0.18, 0.10],
        [0.28 * s, -0.22, -0.12],
        [0.08 * s, -0.07, 0.10],
      ],
      [0, 1, 0],
      0.66,
    );
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(nor), 3));
  g.setAttribute('aSpine', new BufferAttribute(new Float32Array(spine), 1));
  g.setIndex(idx);
  return g;
}
