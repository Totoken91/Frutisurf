import {
  BackSide,
  Mesh,
  PMREMGenerator,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Texture,
  WebGLRenderer,
} from 'three';
import { vec3 } from '../core/Palette';

/**
 * Environnement PMREM genere une seule fois au boot.
 *
 * Le dome de ciel seul ne suffirait pas : le verre du buddy doit capter le
 * REBOND VERT de la plaine, sinon il flotte sans rapport avec le sol.
 * On construit donc une sphere ciel-au-dessus / herbe-en-dessous.
 */
export function createEnvironment(renderer: WebGLRenderer): Texture {
  const scene = new Scene();
  const mat = new ShaderMaterial({
    side: BackSide,
    uniforms: {
      uSkyZenith: { value: vec3('skyZenith') },
      uSkyMid: { value: vec3('skyMid') },
      uSkyHorizon: { value: vec3('skyHorizon') },
      uGrassHorizon: { value: vec3('grassHorizon') },
      uGrassNear: { value: vec3('grassNear') },
      uSun: { value: vec3('cloudCore') },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main(){
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uSkyZenith, uSkyMid, uSkyHorizon, uGrassHorizon, uGrassNear, uSun;
      void main(){
        vec3 d = normalize(vDir);
        vec3 c;
        if (d.y >= 0.0) {
          c = mix(uSkyHorizon, uSkyMid, smoothstep(0.0, 0.30, d.y));
          c = mix(c, uSkyZenith, smoothstep(0.25, 0.85, d.y));
          // Zone chaude vers le soleil : donne un highlight directionnel au verre.
          float s = max(dot(d, normalize(vec3(0.45, 0.72, -0.32))), 0.0);
          // Le facteur solaire vaut exactement 0 sur TOUTE la moitie opposee
          // au soleil. (Pas de backtick dans ce commentaire : il terminerait
          // le template literal qui porte le GLSL. Troisieme fois.)
          // Sur beaucoup de GPU mobiles, pow(x,n) est calcule en
          // exp2(n * log2(x)) : a x = 0, log2(0) = -Inf, et le produit par un
          // exposant eleve sort du domaine de la precision mediump. Le
          // resultat n'est alors pas 0 mais NaN.
          //
          // Ici c'est le pire endroit possible du projet : cette passe
          // alimente la carte d'environnement pre-filtree. Un NaN y entre, le
          // pre-filtrage le FLOUTE sur toute la chaine de mips, et chaque
          // objet en verre qui l'echantillonne — le buddy, le disque, les
          // anneaux, la ville — se couvre de taches NOIRES qui apparaissent
          // et disparaissent au gre de sa rotation.
          c += uSun * pow(max(s, 1e-4), 22.0) * 2.4;
        } else {
          c = mix(uGrassHorizon, uGrassNear, smoothstep(0.0, 0.55, -d.y));
        }
        // PARE-FEU. Cette passe alimente la carte pre-filtree, et le
        // pre-filtrage FLOUTE : une seule valeur invalide se repand sur toute
        // la chaine de mips et ressort en taches noires sur chaque objet en
        // verre du jeu. On ne laisse donc sortir que du fini et du positif.
        // La forme NIEE et non la comparaison directe : un NaN est faux dans
        // toute comparaison, donc seul un test inverse l'attrape.
        if (!(c.r >= 0.0)) c.r = 0.0;
        if (!(c.g >= 0.0)) c.g = 0.0;
        if (!(c.b >= 0.0)) c.b = 0.0;
        gl_FragColor = vec4(min(c, vec3(16.0)), 1.0);
      }
    `,
  });
  scene.add(new Mesh(new SphereGeometry(10, 32, 20), mat));

  const pmrem = new PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromScene(scene, 0.04);
  pmrem.dispose();
  mat.dispose();
  return rt.texture;
}
