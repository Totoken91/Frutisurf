import {
  BufferAttribute,
  BufferGeometry,
  Color,
  FrontSide,
  Mesh,
  ShaderMaterial,
  Vector3,
} from 'three';
import { GLSL_SAFE } from '../core/Noise';
import { vec3 } from '../core/Palette';
import { GLSL_DAY, dayUniforms } from './Daylight';

/**
 * LES CRETES LOINTAINES.
 *
 * Le relief jouable s'arrete a cinq cents metres — c'est la portee de la nappe
 * de sol, et il n'y a aucune raison de la pousser : au-dela, plus rien n'est
 * ni parcouru ni collisionne. Mais visuellement, cette limite se VOIT. Les
 * collines montent, elles redescendent, et derriere il n'y a rien : le ciel
 * pose directement sur la derniere ondulation. Le monde a un bord, et un monde
 * qui a un bord a la taille de son bord.
 *
 * Ces cretes ne sont pas du relief. Ce sont des SILHOUETTES : une couronne de
 * quads verticaux ancree sur le joueur, dont le bord superieur est decoupe par
 * une somme de sinus sur l'azimut. Elles ne portent rien, ne collisionnent
 * rien, ne sont jamais atteintes. Leur seul travail est de dire qu'il y a
 * quelque chose derriere — et c'est exactement le travail d'une chaine de
 * montagnes vue depuis une plaine.
 *
 * ---
 *
 * LA PARALLAXE, ET C'EST ELLE QUI FAIT LA DISTANCE.
 *
 * Une couronne ancree sur le joueur tourne avec lui : sans correction, la
 * meme bosse reste plein nord pour l'eternite et le decor colle a la camera,
 * ce qui est precisement le defaut qu'on essaie de corriger. On decale donc
 * l'azimut auquel on ECHANTILLONNE le profil, du deplacement du joueur ramene
 * au rayon de la couche :
 *
 *     az_monde = az_ecran + (O.x cos az - O.z sin az) / R
 *
 * C'est la petite approximation d'angle d'un point fixe a distance R vu depuis
 * un observateur en O. A neuf cents metres, cent metres de course font six
 * degres — assez pour que les cretes glissent les unes devant les autres, ce
 * qui est la seule chose que l'oeil demande. Trois rayons differents donnent
 * trois vitesses de glissement, donc de la profondeur entre les cretes
 * elles-memes.
 */

/** Trois couches : rayon, hauteur, part de brume, frequence du profil. */
const LAYERS: ReadonlyArray<readonly [number, number, number, number]> = [
  [900, 132, 0.52, 24],
  [1350, 232, 0.72, 15],
  [1950, 345, 0.87, 9.5],
];
// 256 et non 168 : a vingt-quatre sommets par tour, une periode ne couvre plus
// que sept segments et les aretes deviennent des marches.
const SEG = 256;

function buildGeometry(): BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const az: number[] = [];
  const top: number[] = [];
  const layer: number[] = [];

  // --- LES COUCHES SONT EMISES DE LA PLUS LOINTAINE A LA PLUS PROCHE, ET
  //     CE N'EST PAS UN DETAIL DE STYLE.
  //
  //     Les trois vivent dans un SEUL maillage transparent : three.js n'a donc
  //     rien a trier, il les dessine dans l'ordre des indices. Emises de la
  //     plus proche a la plus lointaine, chaque couche PEIGNAIT PAR-DESSUS
  //     celle qui la precede — la plus pale, la plus noyee, celle qui devrait
  //     etre au fond, recouvrait les deux autres. Le resultat etait une nappe
  //     blanchatre uniforme, sans une seule silhouette : trois chaines de
  //     montagnes rendues, et pas une seule visible.
  for (let li = 0; li < LAYERS.length; li++) {
    const l = LAYERS.length - 1 - li;
    const r = LAYERS[l][0];
    const first = pos.length / 3;
    for (let i = 0; i <= SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      // Le X et le Z portent l'azimut ; le Y est reecrit par le shader, qui
      // seul connait le decalage de parallaxe.
      for (let t = 0; t < 2; t++) {
        pos.push(Math.sin(a) * r, 0, Math.cos(a) * r);
        az.push(a);
        top.push(t);
        layer.push(l);
      }
    }
    for (let i = 0; i < SEG; i++) {
      const b = first + i * 2;
      idx.push(b, b + 1, b + 2);
      idx.push(b + 1, b + 3, b + 2);
    }
  }

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
  g.setAttribute('aAz', new BufferAttribute(new Float32Array(az), 1));
  g.setAttribute('aTop', new BufferAttribute(new Float32Array(top), 1));
  g.setAttribute('aLayer', new BufferAttribute(new Float32Array(layer), 1));
  g.setIndex(idx);
  return g;
}

export class Ridge {
  readonly mesh: Mesh;
  readonly mat: ShaderMaterial;

  constructor() {
    this.mat = new ShaderMaterial({
      // UNE SEULE FACE, ET PAS LES DEUX. On est A L'INTERIEUR de l'anneau : en
      // rendant les deux faces, la moitie LOINTAINE et la moitie PROCHE de la
      // couronne se superposent a l'ecran et le melange se fait deux fois. Ca
      // ne se voit pas sur un aplat, mais chaque couture de quad devient une
      // ligne verticale pale — et il y en a cent soixante-huit.
      //
      // FrontSide et non BackSide : l'anneau est enroule de sorte que la face
      // AVANT regarde vers l'interieur. Monte a l'envers, il disparaissait
      // entierement — et une geometrie qui ne rend rien du tout se diagnostique
      // tres mal, parce qu'elle ressemble a un uniforme oublie, a un ordre de
      // rendu, a une couleur trop pale, a tout sauf a un sens d'enroulement.
      side: FrontSide,
      // --- L'ORDRE DE RENDU, ET IL M'A COUTE UNE PASSE.
      //
      //     Premier jet : depthTest coupe et renderOrder a -960, pour passer
      //     entre le dome de ciel (-1000) et le sol (-900). Ca ne marche pas,
      //     et pour une raison qui n'a rien a voir avec renderOrder : three.js
      //     tient DEUX listes, opaque puis transparente, et la seconde passe
      //     toujours apres la premiere quel qu'en soit l'ordre interne. Un
      //     materiau transparent ne peut donc structurellement pas se glisser
      //     sous un materiau opaque. Le resultat etait une bande grise en
      //     travers de tout l'ecran : la JUPE des cretes — leur bord inferieur,
      //     qui plonge loin sous l'horizon — peinte par-dessus le paysage.
      //
      //     La bonne reponse n'etait pas de forcer l'ordre mais de rendre la
      //     profondeur : les cretes passent apres le sol, et le sol les
      //     recouvre parce qu'il est DEVANT. La jupe disparait toute seule, et
      //     elle disparait exactement la ou il faut — sur la silhouette reelle
      //     du relief, ce qu'aucun ordre de rendu n'aurait su faire.
      depthWrite: false,
      depthTest: true,
      transparent: true,
      uniforms: {
        ...dayUniforms(),
        uOrigin: { value: new Vector3() },
        /** Hauteur relative, 0..1. Zero = pas de cretes du tout. */
        uAmount: { value: 1 },
        /** 0 = cretes arrondies, 1 = aretes vives. CHROME n'a pas d'erosion. */
        uEdge: { value: 0 },
        // Des TABLEAUX et non des Color : c'est la convention de tous les
        // decors du jeu, et World.paint ecrit dans les trois canaux d'un
        // tableau. Sur un Color il posait des proprietes "0", "1", "2" a cote
        // de r, g et b — sans une erreur, sans un effet, et les cretes
        // gardaient la palette de la plaine dans les cinq mondes.
        uRock: { value: vec3('cloudShadow') },
        // --- LA BRUME DES CRETES EST LE CIEL LUI-MEME, PAS UNE COULEUR DE
        //     PALETTE, et c'est ce qui rend le reglage inutile.
        //
        //     Une montagne a deux kilometres est essentiellement de l'air : sa
        //     couleur EST celle du ciel a la hauteur ou on la regarde. Peinte
        //     depuis une cle de palette, elle se decalait du ciel des que
        //     l'heure tournait — grise a midi sur un ciel blanc, bleue le soir
        //     sur un ciel orange — et une silhouette qui ne se dissout pas
        //     dans son fond redevient une decoupe de papier.
        //
        //     On y verse donc, a chaque image, l'horizon courant de Daylight.
        //     Le cycle jour/nuit et les cinq ciels sont alors gratuits.
        uHaze: { value: vec3('cloudCore') },
        uSnow: { value: vec3('cloudRim') },
        /** Part de neige sur la couche haute. */
        uCap: { value: 0.35 },
      },
      vertexShader: /* glsl */ `
${GLSL_SAFE}
        attribute float aAz, aTop, aLayer;
        uniform vec3 uOrigin;
        uniform float uAmount, uEdge;
        varying float vTop, vLayer, vRidge;

        // Le profil. Quatre harmoniques non commensurables : deux suffisaient a
        // faire une crete, mais elles se repetaient visiblement sur un tour
        // complet, et une chaine de montagnes periodique est un rideau.
        // LA FREQUENCE EST LE VRAI REGLAGE, ET JE L'AI RATEE DE VINGT FOIS.
        //
        // Premier jet : trois ondulations par tour. En portrait le champ
        // HORIZONTAL fait quarante-trois degres, soit un huitieme de tour : on
        // voyait donc trois huitiemes d'une seule bosse. A l'ecran, ca n'est
        // pas une montagne basse, c'est une BARRE HORIZONTALE grise — et une
        // barre grise en travers de l'horizon est bien pire que pas de
        // montagne du tout. Il faut au moins deux ou trois sommets DANS le
        // cadre pour que l'oeil lise une chaine, donc une vingtaine par tour.
        float profile(float a, float f){
          float s = 0.34 * sin(a * f)
                  + 0.42 * sin(a * f * 0.47 + 1.7)
                  + 0.17 * sin(a * f * 2.13 - 0.6)
                  + 0.08 * sin(a * f * 4.41 + 2.9);
          // LE PLANCHER EST HAUT ET LA PLAGE EST ETROITE, et c'est ce qui fait
          // la difference entre une chaine et un accident.
          //
          // Premier jet : 0,52 de plancher et la somme brute. La somme vaut
          // -0,70 a +0,70, donc le profil descendait a 0 sur un bon tiers du
          // tour — et sur ce tiers, la crete passait SOUS l'horizon, ou le sol
          // la recouvre. On voyait une bosse ici, un morceau la, et surtout de
          // longs pans de rien : pas une chaine, des accidents. Une chaine de
          // montagnes vue de la plaine n'a pas de trous ; elle a des cols.
          float base = 0.58 + s * 0.60;
          // La valeur absolue transforme les creux en VALLEES a fond plat et
          // les sommets en aretes : c'est la difference entre une chaine et
          // une tole ondulee. uEdge dose l'erosion.
          return mix(base, abs(s) * 1.18 + 0.30, uEdge);
        }

        void main(){
          float R = length(position.xz);
          // Azimut MONDE : l'azimut ecran corrige du deplacement du joueur.
          // C'est toute la parallaxe, et elle tient en une ligne.
          float w = aAz + (uOrigin.x * cos(aAz) - uOrigin.z * sin(aAz)) / R;

          float f = aLayer < 0.5 ? 24.0 : (aLayer < 1.5 ? 15.0 : 9.5);
          float H = aLayer < 0.5 ? 132.0 : (aLayer < 1.5 ? 232.0 : 345.0);
          float p = clamp(profile(w, f), 0.22, 1.5);
          vRidge = p;

          // La base descend SOUS l'horizon geometrique : le sol la recouvre de
          // toute facon, et si elle s'arretait pile a zero, la moindre colline
          // creuse laisserait voir une bande de ciel sous la montagne.
          float y = aTop > 0.5 ? p * H * uAmount : -0.16 * R;

          vTop = aTop; vLayer = aLayer;
          gl_Position = projectionMatrix * modelViewMatrix
                      * vec4(position.x, y, position.z, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
${GLSL_SAFE}
${GLSL_DAY}
        uniform vec3 uRock, uHaze, uSnow;
        uniform float uAmount, uCap;
        varying float vTop, vLayer, vRidge;

        void main(){
          if (uAmount < 0.02) discard;

          // --- LA PERSPECTIVE AERIENNE, ET ELLE SE LIT DANS LES DEUX SENS.
          //
          //     Plus la couche est loin, plus elle est noyee : c'est l'axe
          //     evident. Mais DANS une meme crete, c'est le PIED qui est le
          //     plus noye, pas le sommet — on regarde a travers plus d'air en
          //     rasant le sol qu'en visant une cime. Sans ce second degrade,
          //     une silhouette de montagne se lit comme une decoupe de papier
          //     collee sur le ciel, quelle que soit sa couleur.
          float far = vLayer < 0.5 ? 0.46 : (vLayer < 1.5 ? 0.64 : 0.79);
          float haze = mix(min(far + 0.20, 0.97), far, vTop);
          // La roche est ASSOMBRIE avant d'etre noyee. Le gris de monde dont
          // elle sort est un gris d'ombre de nuage, donc deja clair ; noye a
          // trente pour cent dans un horizon presque blanc il rendait une
          // montagne de la meme valeur que le ciel, c'est-a-dire rien.
          vec3 c = mix(uRock * 0.46, uHaze, haze);

          // Les neiges, sur la seule couche haute et seulement au-dessus d'un
          // seuil de profil : une cime blanche sur chaque bosse ferait un
          // decor de creche.
          float snow = uCap * step(1.5, vLayer) * vTop
                     * smoothstep(1.02, 1.36, vRidge);
          c = mix(c, mix(uSnow, uHaze, far * 0.6), snow);

          // L'alpha suit la brume : la couche la plus lointaine ne doit pas
          // effacer le ciel, elle doit s'y dissoudre.
          gl_FragColor = vec4(c, mix(1.0, 0.80, far));
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    this.mesh = new Mesh(buildGeometry(), this.mat);
    this.mesh.frustumCulled = false;
    // Entre le dome de ciel (-1000) et le sol (-900).
    this.mesh.renderOrder = -960;
  }

  update(origin: Vector3, haze: Color): void {
    this.mat.uniforms.uOrigin.value.copy(origin);
    const h = this.mat.uniforms.uHaze.value as number[];
    h[0] = haze.r;
    h[1] = haze.g;
    h[2] = haze.b;
    this.mesh.position.set(origin.x, origin.y, origin.z);
  }
}
