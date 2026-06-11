# Brief Figma — Refonte page `/entrainement`

> Page d'accueil de l'espace d'entraînement aux annales médicales. À refondre en gardant la même structure de données, juste plus pro et plus lisible.

---

## 1. Contexte

**Produit** : Hypocampus, app locale de révision pour étudiant en médecine français (EDN). Tourne sur `127.0.0.1` uniquement, jamais en ligne. Un seul utilisateur.

**Stack visuelle actuelle** : React 18 + Vite + TailwindCSS 4 + shadcn/ui + `lucide-react` pour les icônes + `sonner` pour les toasts.

**Public** : un étudiant qui révise plusieurs heures par jour, souvent fatigué. Il faut que la page soit **calme**, **lisible**, **immédiatement actionnable** — pas d'éblouissement, pas de bruit visuel inutile.

---

## 2. Fonction de la page

C'est l'écran d'arrivée de l'espace entraînement. Elle permet de :

1. **Voir d'un coup d'œil** quelles annales sont disponibles, lesquelles ont déjà été faites, et un résumé statistique récent.
2. **Lancer une session d'entraînement** sur une annale (clic sur card → page d'examen).
3. **Basculer entre 2 modes** : Mode examen (correction en bloc à la fin, comme l'EDN officiel) ou Mode libre (correction inline après chaque question).
4. **Accéder à l'historique** des sessions précédentes.
5. **Importer une nouvelle annale** depuis un PDF UNESS.
6. **Renommer / regrouper en DP** des questions QI orphelines (actions secondaires, hover-only).

---

## 3. Direction esthétique recherchée

| Axe | Direction |
|---|---|
| **Mood** | Calme, studieux, sérieux mais pas froid. Pas d'effets gratuits. Pense bibliothèque universitaire propre, pas hôpital. |
| **Hiérarchie** | Le titre d'annale et le statut "déjà fait" doivent être lisibles en 0.5s. Le reste (année, matière, KPIs) en deuxième niveau. |
| **Densité** | Moyenne. 3 colonnes sur desktop, 1 sur mobile. Pas de cards trop écrasées, pas de cards trop vides. |
| **Couleur** | Palette neutre dominante (grays, off-whites). Accent indigo/violet pour les actions. Vert sauge pour "déjà fait". Ambre pour les warnings. |
| **Typographie** | Sans-serif lisible (système ou Inter). Hiérarchie en taille **et** poids, pas seulement en taille. |
| **Coins** | Doux (rounded-2xl ≈ 16px). Pas d'angles vifs. |

### Inspirations à montrer à Figma
- Linear (pour la sobriété et la densité d'info)
- Notion (pour les cards calmes avec accents subtils)
- Apple iCloud Drive web (pour la grille d'éléments et les hover states)

### À éviter
- Effets de gradient agressifs, ombres exagérées, néons
- Icônes trop nombreuses (max 1-2 par card)
- Animations qui distraient (les transitions doivent être < 200ms)

---

## 4. Composants à conserver (fonctionnels — ne pas changer)

### Header
- Lien retour "Cahier d'erreurs" (← icône)
- Titre + sous-titre "Mode UNESS. Sélectionne une annale pour démarrer."
- **Toggle Mode examen / Mode libre** (switch important — il change le comportement de la page de quiz)
- Bouton "Historique"
- Bouton "Import local"

### KPI cards (rangée de 4 sur desktop)
- Nombre d'annales
- Nombre de sessions totales
- Moyenne sur 30 jours
- Durée moyenne par examen sur 30 jours

### Cards d'annale (la grille principale)
Chaque card affiche :
- **Titre** de l'annale (ex: "ECN 2024 — Session 1")
- **Année** + **session** en sous-titre (ex: "2024 · S1")
- **Nombre de questions** (ex: "57 questions")
- **Marqueur "déjà fait"** (subtil, voir ci-dessous)
- **Actions hover** : icône crayon (renommer), icône fusion (regrouper en DP)
- **Action principale** : clic sur la card → lance l'entraînement

### Groupement par matière
Les annales sont groupées par matière (Cardiologie, Hématologie, Neurologie...) avec un titre de section en uppercase léger.

---

## 5. Le marqueur "déjà fait" (vient d'être ajouté côté code)

**État actuel** : trait vertical fin (4px) en bord gauche vert sauge + point vert 8px à gauche du titre + texte "fait Nx" en sous-titre + tooltip natif au survol.

**Liberté pour Figma** : la mécanique doit rester (visible en 0.5s, subtil mais pas invisible), mais le style exact peut bouger. Idées alternatives :
- Card avec léger fond teinté vert pâle au lieu du trait
- Coin replié en haut-droite (style "dossier déjà lu")
- Checkmark discret en filigrane derrière le titre

**Important** : on doit distinguer 3 états :
- Jamais fait (état neutre, défaut)
- Fait 1x (marqueur subtil)
- Fait Nx avec N>1 (marqueur + compteur visible)

Bonus (pas obligatoire) : si la dernière note est < 50%, le marqueur peut tirer vers l'ambre/rouge pâle pour suggérer "à refaire".

---

## 6. États interactifs à designer

| État | Comportement actuel | À conserver / améliorer |
|---|---|---|
| **Hover card** | Bordure devient indigo, ombre légère, le texte "Démarrer" / "Refaire" apparaît à droite | ✅ Garder, peut être plus élégant |
| **Hover actions secondaires** | Boutons crayon/fusion apparaissent en haut-droite (opacity 0 → 100) | ✅ Garder ce pattern |
| **Édition d'annale** (clic crayon) | La card devient un formulaire inline avec bordure indigo épaisse | ✅ Garder, à styler plus proprement |
| **Modal regroupement DP** (clic icône fusion) | Modal centrée, sélection multi-questions QI, formulaire de groupement | À redesigner (pas vu dans ce brief) |
| **Loading** | Skeletons pour les cards | ✅ Garder, à styler avec la nouvelle palette |
| **Empty state** (aucune annale) | Icône + message + CTA "Importer une annale" | ✅ Garder, polish |
| **Erreur fetch** | Bloc rouge "Erreur de chargement" | À redesigner plus discret |

---

## 7. Responsive

- **Desktop** (≥ 1024px) : 3 colonnes de cards, KPI sur 4 colonnes, header complet
- **Tablet** (≥ 640px) : 2 colonnes de cards, KPI sur 2 colonnes
- **Mobile** (< 640px) : 1 colonne, KPI empilés, header avec menu burger (toggle examen + historique + import dans un drawer)

Actuellement le mobile est faible (header overflow, KPI 2x2 illisibles). À redesigner sérieusement.

---

## 8. Accessibilité (à ne pas oublier)

- Contraste min AA partout (4.5:1 sur texte normal)
- Focus visible sur tous les éléments interactifs (les cards sont des liens, le toggle est un button)
- Le marqueur "fait" doit aussi être perceptible sans la couleur (forme + texte tooltip)
- Aria-labels présents sur les boutons icône-seulement
- Hiérarchie de headings correcte : `<h1>` page → `<h2>` matières → `<h3>` titres d'annale

---

## 9. Dark mode

L'app a un dark mode existant. La refonte doit en tenir compte :
- Background base : `neutral-900` (presque noir tirant violet)
- Cards : `neutral-800` 
- Bordures : `neutral-700`
- Texte primaire : `neutral-100`
- Texte secondaire : `neutral-400`
- Accents indigo et émeraude doivent être lisibles sur fond sombre (préférer les variantes 400/500 que 600/700 en dark)

---

## 10. Hors scope

- **Ne pas redesigner la page d'examen** (`/entrainement/:annaleId`) — c'est un autre chantier
- **Ne pas changer les endpoints API** ni le contenu des données
- **Ne pas toucher au mode capture** (extension Chrome séparée)
- Les classes Tailwind utilisées dans le code restent libres à changer côté CSS, du moment que le rendu visuel correspond au design Figma

---

## 11. Livrables attendus

1. **Maquette desktop** (1440px) — layout normal, état idle
2. **Maquette desktop hover** sur une card (déjà faite et jamais faite, comparées)
3. **Maquette mobile** (375px) avec header drawer ouvert
4. **Composant card** isolé en 3 variantes (idle, hover, déjà-faite)
5. **Palette** documentée (light + dark)
6. **Optionnel** : maquette de la modal de regroupement DP et du formulaire d'édition d'annale

