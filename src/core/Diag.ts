import type { Game } from '../Game';

/**
 * Sonde de diagnostic. Trois declencheurs : `?diag=1`, la touche F3 ou I, et
 * trois doigts poses en meme temps — parce que dans une visionneuse d'artefacts
 * la page tourne dans une iframe qui a sa propre adresse, et qu'aucune chaine
 * de requete tapee dans la barre du navigateur ne lui parvient.
 *
 * Elle existe pour trancher UNE question et une seule : quand le joueur voit un
 * flash noir, est-ce que le jeu a rendu une image noire, ou est-ce que la page
 * qui l'heberge a laisse voir sa toile de fond le temps d'une image ?
 *
 * Les deux se ressemblent exactement a l'oeil et n'ont RIEN a voir :
 *
 *  - `noires > 0` : le rendu WebGL est en cause. C'est reparable dans ce code.
 *  - `noires = 0` alors que le joueur voit clignoter : le tampon de dessin
 *    etait valide a chaque image. Le noir vient d'ailleurs — compositeur du
 *    navigateur, iframe hote, changement de theme, montee de couche. Aucune
 *    correction cote WebGL ne peut l'atteindre, et continuer a en chercher une
 *    est une perte de temps.
 *
 * La sonde lit le tampon APRES chaque rendu, ce qu'aucune capture d'ecran ne
 * permet : un flash d'une image ne se photographie pas. `readPixels` sur
 * quatre pixels coute quelques microsecondes mais SYNCHRONISE le pipeline —
 * d'ou l'activation explicite par l'URL, jamais par defaut.
 */

const BLACK = 24; // luminance sommee (0..765) en dessous de laquelle on parle de noir
const LONG_FRAME = 100; // ms : au-dela, le compositeur a hoquete

interface Record {
  frames: number;
  /** Images noires telles que RENDUES (sonde placee juste apres le rendu). */
  black: number;
  long: number;
  worst: number;
  ctxLost: number;
  resizes: number;
  hidden: number;
  lastBlack: number;
  nan: number;
  /** Images NOIRES telles qu'elles seront presentees (sonde de fin de tick). */
  presented: number;
}

export function attachDiag(game: Game): void {
  const rec: Record = {
    frames: 0,
    black: 0,
    long: 0,
    worst: 0,
    ctxLost: 0,
    resizes: 0,
    hidden: 0,
    lastBlack: -1,
    nan: 0,
    presented: 0,
  };
  (window as unknown as Record & { __diag?: unknown }).__diag = rec;

  const gl = game.engine.renderer.getContext();
  const px = new Uint8Array(4);
  // Quatre points repartis dans le cadre : le ciel, les deux flancs et le
  // premier plan. Une image reellement noire les eteint tous les quatre ; une
  // image simplement sombre en garde au moins un.
  const taps: Array<[number, number]> = [
    [0.5, 0.22],
    [0.22, 0.62],
    [0.78, 0.62],
    [0.5, 0.9],
  ];

  const embedded = (() => {
    try {
      return window.top !== window.self;
    } catch {
      return true; // acces refuse = on est bien dans une iframe d'une autre origine
    }
  })();

  const canvas = game.engine.renderer.domElement;
  canvas.addEventListener('webglcontextlost', () => rec.ctxLost++);
  addEventListener('resize', () => rec.resizes++);
  visualViewport?.addEventListener('resize', () => rec.resizes++);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) rec.hidden++;
  });

  // Sonde de FIN DE TICK : elle se reprogramme depuis sa propre execution, donc
  // apres la boucle de jeu (qui se reprogramme, elle, en tete de la sienne).
  // Elle passe donc en dernier et lit le tampon tel qu'il sera PRESENTE.
  //
  // C'est une question differente de « le jeu a-t-il dessine du noir ? », et
  // c'est celle qui compte : n'importe quel code inscrit apres la boucle peut
  // reallouer le tampon une fois le rendu termine, et un tampon realloue est
  // noir. La sonde d'apres rendu ne peut structurellement pas le voir.
  const tail = (): void => {
    requestAnimationFrame(tail);
    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    let max = 0;
    for (const [fx, fy] of taps) {
      gl.readPixels((w * fx) | 0, (h * fy) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const l = px[0] + px[1] + px[2];
      if (l > max) max = l;
    }
    if (max < BLACK) rec.presented++;
  };
  requestAnimationFrame(tail);

  const originalRender = game.post.render.bind(game.post);
  let last = performance.now();
  game.post.render = (dt: number): void => {
    originalRender(dt);

    const now = performance.now();
    const ms = now - last;
    last = now;
    if (ms > LONG_FRAME) rec.long++;
    if (ms > rec.worst) rec.worst = ms;

    const w = gl.drawingBufferWidth;
    const h = gl.drawingBufferHeight;
    let max = 0;
    for (const [fx, fy] of taps) {
      gl.readPixels((w * fx) | 0, (h * fy) | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const l = px[0] + px[1] + px[2];
      if (l > max) max = l;
    }
    rec.frames++;
    if (max < BLACK) {
      rec.black++;
      rec.lastBlack = rec.frames;
    }
    const c = game.controller;
    if (!Number.isFinite(c.x + c.y + c.z + c.speed)) rec.nan++;
  };

  // --- Affichage. Volontairement moche et lisible de loin : c'est un outil,
  //     pas une interface, et il doit se photographier au telephone.
  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed',
    'left:8px',
    'bottom:8px',
    'z-index:99',
    'font:11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace',
    'color:#052a3a',
    'background:rgba(255,255,255,0.82)',
    'border:1px solid rgba(5,42,58,0.25)',
    'border-radius:8px',
    'padding:7px 9px',
    'white-space:pre',
    'pointer-events:none',
    'backdrop-filter:blur(6px)',
  ].join(';');
  document.body.appendChild(el);

  // L'etat de `color-scheme` est releve UNE fois au demarrage et surveille :
  // c'etait la cause reelle du flash noir precedent, et un hote qui l'ecrase en
  // ligne peut la faire revenir sans qu'aucun compteur ne bouge.
  const scheme = (): string => {
    const inline = document.documentElement.style.colorScheme;
    const computed = getComputedStyle(document.documentElement).colorScheme;
    return inline && inline !== computed ? `${computed} (inline:${inline})` : computed || '?';
  };

  // Rafraichissement au TEMPS, pas toutes les N images. Un compteur d'images
  // se fige precisement quand la cadence s'effondre — c'est-a-dire au moment ou
  // l'on regarde le panneau.
  let lastPaint = 0;
  const paint = (): void => {
    requestAnimationFrame(paint);
    const now = performance.now();
    if (now - lastPaint < 250) return;
    lastPaint = now;
    const eng = game.engine;
    const bad = rec.black + rec.presented;
    const verdict =
      bad > 0
        ? `>> LE RENDU EST EN CAUSE (${bad} images noires)`
        : rec.frames > 600
          ? '>> le rendu est HORS DE CAUSE'
          : '>> mesure en cours...';
    el.textContent = [
      `fps       ${game.state.fps.toFixed(0).padStart(3)}   qualite ${eng.quality}`,
      `images    ${rec.frames}`,
      `noires    rendu ${rec.black}   presentees ${rec.presented}` +
        `${rec.lastBlack >= 0 ? `  (derniere #${rec.lastBlack})` : ''}`,
      `longues   ${rec.long}   pire ${rec.worst.toFixed(0)} ms`,
      `contexte  ${rec.ctxLost} perte(s)   masquee ${rec.hidden}   NaN ${rec.nan}`,
      // Le chiffre a surveiller est le DEUXIEME. Des evenements resize en
      // rafale sont absorbes par le garde d'egalite ; ce sont les
      // redimensionnements REELS qui reallouent le tampon, et une page hote
      // dont la taille oscille en fait un par image.
      `resize    ${eng.resizeEvents} evts -> ${eng.resizeApplied} reels` +
        `${eng.resizeSkipped ? `   (${eng.resizeSkipped} tailles nulles)` : ''}`,
      `tampon    ${gl.drawingBufferWidth}x${gl.drawingBufferHeight}` +
        `   fenetre ${innerWidth}x${innerHeight}`,
      `contexte  ${embedded ? 'DANS une iframe' : 'page autonome'}   scheme ${scheme()}`,
      ``,
      verdict,
    ].join('\n');
  };
  paint();
}
