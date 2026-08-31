/** Bruit deterministe, cote CPU (placement) et cote GLSL (shaders). */

export function hash1(n: number): number {
  const s = Math.sin(n) * 43758.5453123;
  return s - Math.floor(s);
}

export function hash2(x: number, y: number): number {
  return hash1(x * 127.1 + y * 311.7);
}

/** Generateur reproductible — le monde doit etre identique a chaque run. */
export class Rng {
  constructor(private s = 1337) {}
  next(): number {
    this.s = (this.s * 1664525 + 1013904223) >>> 0;
    return this.s / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.min(arr.length - 1, Math.floor(this.next() * arr.length))];
  }
}

export function valueNoise2D(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy);
  const b = hash2(ix + 1, iy);
  const c = hash2(ix, iy + 1);
  const d = hash2(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function fbm2D(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise2D(x, y);
    norm += amp;
    amp *= 0.5;
    x *= 2.03;
    y *= 2.03;
  }
  return sum / norm;
}

/** Chunk GLSL partage — a injecter dans les shaders qui ont besoin de bruit. */
export const GLSL_NOISE = /* glsl */ `
float hash21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a = hash21(i), b = hash21(i+vec2(1,0));
  float c = hash21(i+vec2(0,1)), d = hash21(i+vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for(int i=0;i<5;i++){ s += a*vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
// Variantes ECONOMES, a choisir sur la FREQUENCE du champ et non par habitude.
// Un champ basse frequence n'a que faire de ses octaves hautes : a l'ecran
// elles tombent sous le pixel, elles ne produisent que du cout et du
// scintillement. Le sol appelait fbm() trois fois par pixel, soit quinze
// octaves, dont deux tiers invisibles.
//
// Chacune est normalisee sur la MEME plage que fbm() : sans ca, changer le
// nombre d'octaves decalerait la couleur au lieu de seulement l'alleger.
// Somme des amplitudes : 5 octaves 0,96875 / 3 octaves 0,875 / 2 octaves 0,75.
float fbm3(vec2 p){
  float s = 0.0, a = 0.5;
  for(int i=0;i<3;i++){ s += a*vnoise(p); p *= 2.03; a *= 0.5; }
  return s * (0.96875 / 0.875);
}
float fbm2(vec2 p){
  float s = 0.0, a = 0.5;
  for(int i=0;i<2;i++){ s += a*vnoise(p); p *= 2.03; a *= 0.5; }
  return s * (0.96875 / 0.75);
}
vec3 hue2rgb(float h){
  return clamp(abs(mod(h*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0);
}
`;
