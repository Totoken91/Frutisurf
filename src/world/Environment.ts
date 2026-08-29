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
          c += uSun * pow(s, 22.0) * 2.4;
        } else {
          c = mix(uGrassHorizon, uGrassNear, smoothstep(0.0, 0.55, -d.y));
        }
        gl_FragColor = vec4(c, 1.0);
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
