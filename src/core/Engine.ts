import {
  NeutralToneMapping,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { col } from './Palette';

export type Quality = 'low' | 'medium' | 'high';

/** Detection au boot ; PostFX et GrassField s'y adaptent. */
function detectQuality(): Quality {
  const mem = (navigator as { deviceMemory?: number }).deviceMemory ?? 4;
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (mobile || mem <= 2 || cores <= 2) return 'low';
  if (mem <= 4 || cores <= 4) return 'medium';
  return 'high';
}

export class Engine {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  quality: Quality;

  /**
   * Vrai entre `webglcontextlost` et `webglcontextrestored`. Tant qu'il l'est,
   * la boucle NE REND PAS : dessiner sur un contexte perdu ne produit rien et
   * laisse le compositeur afficher un canvas vide, donc noir.
   */
  contextLost = false;

  /** Repli automatique si la moyenne glissante depasse 20 ms (docs/02 §5). */
  private frameAcc = 0;
  private frameCount = 0;
  private downgraded = false;
  onQualityDrop: ((q: Quality) => void) | null = null;

  // Derniere taille reellement appliquee. Sur telephone la barre d'adresse qui
  // se retracte emet une rafale d'evenements resize pour la MEME taille : sans
  // ce garde, chaque evenement reallouait toutes les cibles de rendu du
  // composer, et une reallocation pendant la frame se voit comme un flash noir.
  private lastW = 0;
  private lastH = 0;
  private lastRatio = 0;
  private resizeQueued = false;
  /** Le redimensionnement en attente doit ignorer le garde d'egalite. */
  private resizeForce = false;

  constructor(canvas: HTMLCanvasElement) {
    this.quality = detectQuality();

    this.renderer = new WebGLRenderer({
      canvas,
      antialias: false, // SMAA s'en charge dans la chaine de post
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    this.renderer.outputColorSpace = SRGBColorSpace;

    // --- LA couleur qui manquait.
    //
    // Le joueur signalait des flashs noirs que la sonde n'a jamais reproduits :
    // deux mille images sur le profil telephone, avec rafales de
    // redimensionnement, rotations, passages en arriere-plan et une perte de
    // contexte provoquee — zero image noire. Le rendu ne devient donc jamais
    // noir. Ce qui devient noir, c'est le FOND DU TAMPON.
    //
    // Par defaut la couleur d'effacement est le noir, et le contexte est cree
    // en `alpha: false`, donc le canvas est OPAQUE : le fond CSS cyan pose plus
    // tot ne pouvait structurellement jamais se voir. Des qu'une image ne
    // recouvre pas tout l'ecran — contexte perdu et re-cree, tampon
    // reattribue apres un changement de taille, trou du compositeur entre deux
    // images — c'est ce noir-la qui s'affiche.
    //
    // La couleur d'effacement correcte n'a jamais ete le noir : c'est le ciel.
    // Le dome le recouvre en temps normal, donc ca ne coute rien, et le jour ou
    // il manque on voit du ciel au lieu d'un trou.
    this.renderer.setClearColor(col('skyHorizon'), 1);
    // Neutral (Khronos PBR Neutral) au lieu d'ACES : ACES desature violemment
    // les cyans et verts quasi hors-gamut de la reference et rend l'image pastel.
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.setPixelRatio(this.pixelRatio());

    this.camera = new PerspectiveCamera(62, 1, 0.1, 2600);
    this.camera.position.set(0, 3, -7);

    // Perte de contexte : sur telephone elle arrive pour de vrai (pression
    // memoire, appli en arriere-plan, reset du pilote). Sans preventDefault le
    // navigateur ne restaure JAMAIS le contexte et le canvas reste noir.
    canvas.addEventListener('webglcontextlost', this.onLost as EventListener, false);
    canvas.addEventListener('webglcontextrestored', this.onRestored as EventListener, false);

    this.apply(true);
    addEventListener('resize', this.queueResize);
    addEventListener('orientationchange', this.queueResize);
    visualViewport?.addEventListener('resize', this.queueResize);
  }

  private readonly onLost = (e: Event): void => {
    e.preventDefault();
    this.contextLost = true;
  };

  private readonly onRestored = (): void => {
    this.contextLost = false;
    // Tout est a reconstruire : on force le passage par apply() en invalidant
    // la taille memorisee. Mais via la FILE, pas tout de suite : l'evenement
    // peut tomber n'importe quand dans la frame, y compris apres le rendu.
    this.lastW = 0;
    this.queueForced();
  };

  private pixelRatio(): number {
    const cap = this.quality === 'high' ? 2 : this.quality === 'medium' ? 1.5 : 1;
    return Math.min(devicePixelRatio || 1, cap);
  }

  /**
   * Un seul redimensionnement par frame, quel que soit le nombre d'evenements.
   * Les rafales de la barre d'adresse mobile en emettent une dizaine d'affilee.
   *
   * On ne fait ici QUE lever un drapeau. La version precedente programmait son
   * propre `requestAnimationFrame`, et c'etait une COURSE avec le rendu :
   *
   *   frame N    la boucle de jeu se rearme (rAF), rend, puis un evenement
   *              resize arrive et programme son rAF pour la frame suivante ;
   *   frame N+1  la boucle de jeu s'execute d'abord — elle etait inscrite en
   *              premier — et rend. PUIS le rAF de redimensionnement appelle
   *              setSize, qui REALLOUE le tampon de dessin.
   *
   * Un tampon reattribue est vide, et la specification WebGL le remet a noir
   * transparent ; avec `alpha: false` cela se presente en noir OPAQUE. La
   * couleur d'effacement ne le sauve pas : elle ne s'applique qu'aux appels a
   * `clear()`, pas a la reallocation. La frame N+1 se retrouve donc presentee
   * avec un tampon noir jamais redessine — un flash d'exactement une image,
   * exactement au moment ou la barre d'adresse se retracte ou ou la page hote
   * redimensionne son iframe.
   *
   * Le drapeau est consomme par `flushResize()`, appele EN TETE de la boucle de
   * jeu : redimensionner puis rendre dans la meme frame supprime la course.
   */
  private readonly queueResize = (): void => {
    this.resizeQueued = true;
  };

  /** Programme un redimensionnement force pour la prochaine frame. */
  private queueForced(): void {
    this.resizeQueued = true;
    this.resizeForce = true;
  }

  /**
   * Applique le redimensionnement en attente, s'il y en a un.
   *
   * A appeler au DEBUT de la boucle de jeu et nulle part ailleurs : c'est
   * l'ordre redimensionnement-puis-rendu qui garantit qu'aucun tampon
   * fraichement realloue n'est jamais presente sans avoir ete peint.
   */
  flushResize(): void {
    if (!this.resizeQueued) return;
    const force = this.resizeForce;
    this.resizeQueued = false;
    this.resizeForce = false;
    this.apply(force);
  }

  /** Redimensionnement effectif. `force` ignore le garde d'egalite. */
  private apply(force: boolean): void {
    // Jamais zero : une cible de rendu de largeur nulle rend une image vide.
    const w = Math.max(1, Math.floor(innerWidth));
    const h = Math.max(1, Math.floor(innerHeight));
    const ratio = this.pixelRatio();
    if (!force && w === this.lastW && h === this.lastH && ratio === this.lastRatio) return;
    this.lastW = w;
    this.lastH = h;
    this.lastRatio = ratio;

    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.onResize?.(w, h);
  }

  /** Redimensionnement immediat, expose pour les tests et la reprise. */
  readonly resize = (): void => this.apply(true);

  onResize: ((w: number, h: number) => void) | null = null;

  /** Appele chaque frame avec le temps d'image en ms. */
  sampleFrame(ms: number): void {
    if (this.downgraded) return;
    this.frameAcc += ms;
    this.frameCount++;
    if (this.frameCount < 120) return;
    const avg = this.frameAcc / this.frameCount;
    this.frameAcc = 0;
    this.frameCount = 0;
    if (avg > 20 && this.quality !== 'low') {
      this.quality = this.quality === 'high' ? 'medium' : 'low';
      this.downgraded = true;
      this.onQualityDrop?.(this.quality);
      // setPixelRatio change la taille du tampon de dessin : sans ce passage
      // par apply(), le composer gardait ses cibles a l'ANCIENNE resolution et
      // la passe finale se retrouvait desalignee avec le canvas.
      //
      // Mais PAS ici. sampleFrame() est appele en fin de boucle, APRES le
      // rendu : reallouer le tampon a cet instant le laisse noir jusqu'a la
      // frame suivante, et le compositeur presente ce noir. C'est la meme
      // course que celle du redimensionnement, et elle se joue une fois par
      // session sur un appareil lent — donc typiquement dans les premieres
      // secondes de jeu sur telephone. On la met en file : la prochaine frame
      // redimensionne PUIS rend.
      this.queueForced();
    }
  }

  dispose(): void {
    removeEventListener('resize', this.queueResize);
    removeEventListener('orientationchange', this.queueResize);
    visualViewport?.removeEventListener('resize', this.queueResize);
    this.renderer.dispose();
  }
}
