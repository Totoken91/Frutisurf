import { BackSide, Mesh, ShaderMaterial, SphereGeometry, Vector3 } from 'three';
import { vec3 } from '../core/Palette';

/**
 * Dome de ciel. Degrade vertical cyan sature + gonflement lumineux vers l'horizon.
 * Pas de disque solaire : la reference n'en montre pas, seulement une lumiere diffuse
 * qui vient d'en haut a droite.
 */
export const SUN_DIR = new Vector3(0.45, 0.72, -0.32).normalize();

export function createSky(): Mesh {
  const mat = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: vec3('skyZenith') },
      uMid: { value: vec3('skyMid') },
      uHorizon: { value: vec3('skyHorizon') },
      uSun: { value: SUN_DIR.clone() },
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
      uniform vec3 uZenith, uMid, uHorizon, uSun;

      void main(){
        vec3 d = normalize(vDir);
        float h = d.y;

        // Bande d'horizon serree : la transition doit rester lisible mais pas brumeuse.
        float tHor = smoothstep(-0.02, 0.20, h);
        float tZen = smoothstep(0.16, 0.78, h);
        vec3 c = mix(uHorizon, uMid, tHor);
        c = mix(c, uZenith, tZen);

        // Halo solaire large, sans disque. Rechauffe le quadrant haut-droit.
        float sd = max(dot(d, normalize(uSun)), 0.0);
        c += vec3(0.40, 0.55, 0.46) * pow(sd, 3.6) * 0.20;
        c += vec3(0.30, 0.44, 0.42) * pow(sd, 14.0) * 0.55;

        // Legere surexposition juste au-dessus de l'horizon (diffusion atmospherique).
        c += uHorizon * 0.18 * pow(1.0 - clamp(abs(h) * 5.0, 0.0, 1.0), 2.0);

        // Sous l'horizon le dome ne doit jamais s'assombrir : le sol le recouvre,
        // mais les bords d'ecran en perspective large peuvent le laisser voir.
        c = mix(c, uHorizon * 1.02, smoothstep(0.0, -0.16, h));

        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const sky = new Mesh(new SphereGeometry(2000, 40, 24), mat);
  sky.frustumCulled = false;
  sky.renderOrder = -1000;
  return sky;
}
