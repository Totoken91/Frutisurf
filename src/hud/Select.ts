import {
  AXES,
  MOUNTS,
  NEUTRAL,
  RIDERS,
  combine,
  highlights,
  loadChoice,
  saveChoice,
  type Loadout,
  type Perk,
} from '../core/Loadout';

/**
 * L'ecran d'equipement.
 *
 * ---
 *
 * CE QU'IL DOIT RESOUDRE, et ce n'est pas « afficher six vignettes ».
 *
 * Un ecran de selection rate toujours de la meme facon : il montre des noms et
 * des images, le joueur prend le plus joli, et il ne revient jamais. Pour qu'un
 * choix existe vraiment il faut que le joueur puisse REPONDRE a la question
 * « qu'est-ce que je perds ? » avant de valider — sinon il ne choisit pas, il
 * cueille.
 *
 * D'ou trois decisions :
 *
 *   1. CHAQUE CARTE PORTE SON COUT. Deux etiquettes, un « + » vert et un « − »
 *      ambre, sur la carte elle-meme et pas dans une infobulle. Une option sans
 *      etiquette ambre est explicitement marquee EQUILIBRE : l'absence de cout
 *      est une information, pas un blanc.
 *
 *   2. LES ETIQUETTES SONT CALCULEES, jamais ecrites (cf. Loadout.highlights).
 *      Un libelle redige a la main survit toujours a l'equilibrage qui le rend
 *      faux, et l'ecran se met alors a mentir sans que rien ne le signale.
 *
 *   3. LE PROFIL EST AFFICHE POUR LA COMBINAISON, pas par carte. Le joueur ne
 *      joue pas un buddy et une monture, il joue leur PRODUIT : cinq jauges
 *      signees, tracees depuis le centre, disent d'un coup d'oeil ce que la
 *      paire donne. Les barres partent du milieu parce que la grandeur
 *      interessante est un ECART au neutre — une barre remplie depuis la gauche
 *      cacherait le signe, qui est justement tout le sujet.
 *
 * ---
 *
 * Le decor reste VIVANT derriere : le monde continue de defiler, le cycle
 * jour/nuit continue de tourner. Un fond fige derriere une interface donne
 * immediatement l'impression d'un menu colle par-dessus un jeu ; un fond qui
 * bouge dit que le jeu est deja la, et qu'il attend.
 *
 * Seul le CHRONO est gele (cf. Game.frame) : laisser le temps couler pendant
 * qu'on lit des libelles serait une punition pour avoir lu.
 */

/** Echelle des jauges : l'ecart maximal atteignable touche pile la butee. */
const SPAN = 1.3;

function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export class Select {
  private cards: HTMLButtonElement[][] = [[], []];
  /**
   * Deux moities par jauge, une de chaque cote du neutre.
   *
   * Une seule barre dont on animerait `left` et `width` aurait ete plus
   * courte a ecrire — et c'est ce que j'avais fait. Elle ne s'affichait pas :
   * une transition sur `width` part d'un `auto` que le navigateur ne sait pas
   * interpoler, et la barre reste a zero. Deux moities animees en `scaleX`
   * n'ont pas ce probleme, ne declenchent aucune mise en page, et tiennent
   * entierement sur le compositeur — exactement comme la jauge de boost.
   */
  private ups: HTMLElement[] = [];
  private dns: HTMLElement[] = [];
  private blurbs: HTMLElement[] = [];
  private row = 0;
  private idx = [0, 0];
  private opened = false;

  /** Appele a la validation, avec la combinaison retenue. */
  onConfirm: ((l: Loadout) => void) | null = null;
  /** Appele a l'ouverture et a la fermeture. Sert a masquer le HUD. */
  onToggle: ((open: boolean) => void) | null = null;

  constructor(private root: HTMLElement) {
    const saved = loadChoice();
    this.idx[0] = Math.max(0, RIDERS.indexOf(saved.rider));
    this.idx[1] = Math.max(0, MOUNTS.indexOf(saved.mount));

    root.innerHTML = `
      <div class="pickscrim"></div>
      <div class="pickpanel">
        <div class="in">
          <div class="pickhead">
            <b>ÉQUIPEMENT</b>
            <i>chaque choix se paie</i>
          </div>
          ${this.rowHtml('BUDDY', RIDERS, 0, 'av')}
          ${this.rowHtml('MONTURE', MOUNTS, 1, 'mv')}
          <div class="pickread">
            <p data-el="blurb0"></p>
            <p data-el="blurb1"></p>
            <div class="meters">
              ${AXES.map(
                (a) => `
              <div class="meter">
                <span class="lb">${a.label}</span>
                <span class="tk">
                  <i class="mid"></i>
                  <i class="up" data-up="${a.key}"></i>
                  <i class="dn" data-dn="${a.key}"></i>
                </span>
              </div>`,
              ).join('')}
            </div>
          </div>
          <div class="pickgo"><u data-el="go">c'est parti</u></div>
        </div>
      </div>
    `;

    for (const b of Array.from(root.querySelectorAll<HTMLButtonElement>('.card'))) {
      const r = Number(b.dataset.row);
      this.cards[r][Number(b.dataset.i)] = b;
      b.addEventListener('click', () => this.pick(r, Number(b.dataset.i)));
    }
    for (const a of AXES) {
      this.ups.push(root.querySelector<HTMLElement>(`[data-up="${a.key}"]`)!);
      this.dns.push(root.querySelector<HTMLElement>(`[data-dn="${a.key}"]`)!);
    }
    this.blurbs.push(
      root.querySelector<HTMLElement>('[data-el="blurb0"]')!,
      root.querySelector<HTMLElement>('[data-el="blurb1"]')!,
    );
    root.querySelector<HTMLElement>('[data-el="go"]')!.addEventListener('click', () => this.confirm());

    addEventListener('keydown', this.key);
    this.refresh();
  }

  private rowHtml(title: string, list: Perk[], row: number, kind: string): string {
    const cards = list
      .map((p, i) => {
        const h = highlights(p);
        const tags = h.up || h.down
          ? `${h.up ? `<em class="up">+${h.up}</em>` : ''}${h.down ? `<em class="dn">−${h.down}</em>` : ''}`
          : '<em class="eq">équilibré</em>';
        return `
          <button class="card" type="button" data-row="${row}" data-i="${i}">
            <span class="emb"><i class="${kind} ${p.id}"><b></b><u></u></i></span>
            <span class="nm">${p.name}</span>
            <span class="tags">${tags}</span>
          </button>`;
      })
      .join('');
    return `<div class="pickrow"><h3>${title}</h3><div class="cards">${cards}</div></div>`;
  }

  get isOpen(): boolean {
    return this.opened;
  }

  get loadout(): Loadout {
    return combine(RIDERS[this.idx[0]], MOUNTS[this.idx[1]]);
  }

  open(): void {
    if (this.opened) return;
    this.opened = true;
    this.root.classList.add('show');
    this.refresh();
    this.onToggle?.(true);
  }

  close(): void {
    if (!this.opened) return;
    this.opened = false;
    this.root.classList.remove('show');
    this.onToggle?.(false);
  }

  /** Public pour les captures automatisees (scripts/pick-shot.mjs). */
  pick(row: number, i: number): void {
    this.row = row;
    this.idx[row] = i;
    this.refresh();
  }

  confirm(): void {
    const l = this.loadout;
    saveChoice(l.rider, l.mount);
    this.close();
    this.onConfirm?.(l);
  }

  /**
   * Clavier. Le jeu se joue au clavier sur ordinateur : un ecran qu'il faudrait
   * quitter pour attraper la souris casserait la boucle « je relance, je change
   * de monture, je relance » — c'est-a-dire exactement l'usage qu'on cherche.
   */
  private readonly key = (e: KeyboardEvent): void => {
    if (!this.opened) return;
    const n = this.row === 0 ? RIDERS.length : MOUNTS.length;
    switch (e.code) {
      case 'ArrowLeft': case 'KeyA': case 'KeyQ':
        this.pick(this.row, (this.idx[this.row] + n - 1) % n); break;
      case 'ArrowRight': case 'KeyD':
        this.pick(this.row, (this.idx[this.row] + 1) % n); break;
      case 'ArrowUp': case 'KeyW':
        this.row = 0; this.refresh(); break;
      case 'ArrowDown': case 'KeyS':
        this.row = 1; this.refresh(); break;
      case 'Enter': case 'Space': case 'NumpadEnter':
        this.confirm(); break;
      default:
        return;
    }
    // Empeche le defilement de la page et la repetition du navigateur. Ca
    // n'empeche PAS l'ecouteur de Input de voir la meme touche — deux
    // ecouteurs sur la meme cible ne s'arretent pas l'un l'autre — mais c'est
    // sans consequence : pendant le choix, Game passe une entree neutre a la
    // physique et refuse la relance (cf. `picking` dans Game.frame).
    e.preventDefault();
  };

  private refresh(): void {
    for (let r = 0; r < 2; r++) {
      for (let i = 0; i < this.cards[r].length; i++) {
        const c = this.cards[r][i];
        c.classList.toggle('on', i === this.idx[r]);
        c.classList.toggle('cursor', r === this.row && i === this.idx[r]);
      }
    }

    const l = this.loadout;
    this.blurbs[0].textContent = `${l.rider.name} — ${l.rider.blurb}`;
    this.blurbs[1].textContent = `${l.mount.name} — ${l.mount.blurb}`;

    for (let i = 0; i < AXES.length; i++) {
      const v = l[AXES[i].key] / NEUTRAL[AXES[i].key];
      // d vaut au plus une demi-largeur de rail, donc chaque moitie s'exprime
      // en 0..1 apres multiplication par deux.
      const d = clamp((v - 1) * SPAN, -0.5, 0.5);
      this.ups[i].style.transform = `scaleX(${Math.max(0, d * 2).toFixed(3)})`;
      this.dns[i].style.transform = `scaleX(${Math.max(0, -d * 2).toFixed(3)})`;
    }
  }
}
