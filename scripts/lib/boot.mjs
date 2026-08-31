/**
 * Demarrer comme un joueur QUI A DEJA CHOISI son equipement.
 *
 * Depuis que l'ecran d'equipement s'ouvre au premier lancement, un profil de
 * navigateur neuf — ce qu'est CHAQUE lancement de Playwright — tombe dessus.
 * Les consequences ne sont pas cosmetiques : le panneau couvre le rendu, donc
 * toutes les captures montrent le menu, et il intercepte les touches et les
 * doigts, donc le banc d'entrees ne teste plus rien.
 *
 * Le contournement paresseux aurait ete de fermer le panneau apres le
 * chargement. Il est mauvais : la fermeture appelle `restart()`, et on
 * mesurerait alors une partie qui vient de repartir a zero, pas celle que le
 * script croit observer. On seme donc le choix AVANT le chargement, exactement
 * comme un joueur qui revient — le jeu ne voit jamais d'ecran a fermer.
 *
 * A appeler imperativement avant `page.goto`.
 */
export async function seedLoadout(page, rider = 'bleu', mount = 'cd') {
  await page.addInitScript(
    ([r, m]) => {
      try {
        localStorage.setItem('frutisurf.loadout', JSON.stringify({ r, m }));
      } catch {
        // Stockage refuse : le jeu ouvrira l'ecran, et le script le verra.
      }
    },
    [rider, mount],
  );
}
