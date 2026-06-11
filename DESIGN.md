# DESIGN — Audit UX/UI + Roadmap pro

> État des lieux et plan d'évolution de l'interface React/Vite/Tailwind/shadcn à `local-site/web/`.
> Objectif : passer d'une UI "amateur fonctionnel" à un niveau "site de prépa pro" (référents UNESS, Mediko, EDN, Lecturio).
> Lié à `ARCHITECTURE.md` (technique backend) et `HANDOVER.md` (contexte produit).
> Dernière revue : 2026-05-21.

---

## 1. Verdict global

**Constat** : l'app marche bien, mais elle dégage l'impression d'un outil personnel bricolé plutôt que d'un produit fini. Pas mauvais. Pas pro non plus.

| Dimension | Niveau | Justification courte |
|---|---|---|
| Palette couleurs | 🟡 Mid | ~70% cohérent (indigo CTA, sémantiques vert/rouge/ambre). Mais mix orange/ambre non sémantique. Quelques dark mode oubliés. |
| Typographie | 🔴 Amateur | **91 occurrences de `font-semibold`** = overdose qui aplatit la hiérarchie. `text-[19px]` custom au lieu de tokens. H1 de l'examen en `text-sm` (!). Aucun usage de `<h1>/<h2>/<h3>` sémantique. |
| Espacement | 🔴 Amateur | Pas de grille 8pt. Mix `p-3` / `p-4` / `p-5` sans règle. Border-radius mélangés (`rounded`, `-lg`, `-xl`, `-2xl`) sans logique. |
| Composants | 🟡 Mid | Cards et boutons primaires cohérents. Mais boutons tertiaires anarchiques, modals sans gestion z-index propre, états disabled fragiles en dark mode. |
| Feedback / loading | 🔴 Amateur | "Chargement…" en texte plain, **zéro skeleton, zéro toast, zéro micro-interaction**. Tu fais une action, l'écran update silencieusement. |
| UX page examen | 🔴 Amateur | **Pas de keyboard shortcut** (PgUp/PgDn, Entrée). Pas de mode focus. Timer mute (pas d'alerte <5min). Sidebar toujours visible = distrait. |
| Microcopy | 🟡 Mid | Labels boutons impératifs OK. Mais quelques erreurs trop techniques ("HTTP 500" au lieu de "Connexion perdue"). |
| Navigation | 🟡 Mid | Claire mais sans breadcrumb / fil d'Ariane après long examen. |

**Verdict synthétique** : amateur fonctionnel. ~12h de travail bien ciblé pour basculer en mid-pro.

---

## 2. Top 5 problèmes qui crient "amateur"

1. **Overdose de `font-semibold`** : 91 occurrences = tout est emphasized = rien ne l'est. Une UI pro a une hiérarchie nette : H1/H2/H3 en bold, body en normal, juste les 5% critiques en medium.
2. **Zéro toast / skeleton / micro-interaction** : actions sans feedback visuel. L'utilisateur ne sait pas si son click a marché ou si l'app a freezé.
3. **Mode examen sans keyboard ni focus** : impensable pour 30-60 min de concentration. UNESS/Mediko : PgDn/PgUp, flèches, raccourcis pour cocher A/B/C/D.
4. **Timer chrono mute** : pas de warning visuel <5min, pas d'alerte à 1min. Un timer qui ne stresse pas = un timer inutile.
5. **Score résultat = même gradient indigo pour 80% ou 40%** : la couleur ne porte pas la sémantique succès/échec. Devrait être vert si ≥70%, ambre si 50-69%, rouge si <50%.

---

## 3. Détail par dimension

### 3.1 Palette couleurs — 🟡 Mid

**Ce qui marche** :
- Brand : `indigo-600` cohérent comme CTA primaire
- Sémantiques solides : `success` (green-50/700/200), `danger` (red-50/600/200), `warn` (amber-50/600/200)
- Dark mode couvert à ~90%

**Ce qui cloche** :
- Ambre ET orange utilisés sans distinction sémantique (`annale-import-page.tsx` mélange `amber-*` et `orange-*`)
- CTAs secondaires anarchiques : parfois `neutral-900`, parfois border + indigo, parfois ghost
- Quelques `text-neutral-800` sans variant `dark:text-neutral-200` (≈15 oublis détectés)

**Action recommandée** : voir Sprint 1 (design tokens explicites dans `tailwind.config.ts`).

### 3.2 Typographie — 🔴 Amateur

**Tailles utilisées** : text-xs (102 fois), text-sm (115), text-base (10), text-lg (11), text-2xl (6), text-7xl (2). text-base et text-lg sont sous-utilisés.

**Poids** : font-semibold (91), font-bold (49), font-medium (38), font-normal (5). **Overdose de semibold**.

**Problèmes ciblés** :
- `exam-page.tsx:441` : titre annale en `text-sm font-semibold` → DEVRAIT être text-base ou text-lg + bold
- `exam-page.tsx:585` : énoncé question en `text-[19px]` (custom, hors tokens) → DEVRAIT être text-lg ou text-xl
- Pas de balise sémantique `<h1>/<h2>/<h3>` → tout en `<div>` avec classes
- Mix arbitraire entre font-semibold et font-medium sur le body

**Action recommandée** : Sprint 1 — purge font-semibold (91 → 30) + tokens fontSize dans config Tailwind.

### 3.3 Espacement & layout — 🔴 Amateur

**Symptômes** :
- Aucun système 8pt. Padding card oscille entre `p-3`, `p-4`, `p-5` sans règle
- Border-radius : `rounded`, `rounded-lg`, `rounded-xl`, `rounded-2xl` utilisés ad-hoc
- Sidebar examen `w-64` hard-codée sans token

**Conséquence** : impression d'inconsistance même quand chaque page est OK isolément.

**Action recommandée** : Sprint 1 — tokens `borderRadius`, convention "tout card = rounded-card".

### 3.4 Composants — 🟡 Mid

**Cards** : pattern cohérent `bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-2xl p-5 shadow-sm`. Hover `border-indigo-300`. ✓

**Boutons** :
- Primaire CTA : `bg-indigo-600 hover:bg-indigo-700 text-white font-semibold px-4 py-2.5 rounded-lg` — cohérent ✓
- Secondaire outline : `border border-neutral-200 hover:bg-neutral-100` — cohérent ✓
- Tertiaire (text) : ANARCHIQUE — parfois `text-indigo-600 hover:underline`, parfois `text-neutral-500 hover:text-neutral-900` ❌

**Inputs** : `px-2.5 py-1.5 rounded-lg border border-neutral-300 outline-none focus:ring-2 focus:ring-indigo-500` — cohérent ✓

**Modals** : pattern OK mais **z-index non géré systématiquement** (sidebar examen `w-64` n'a pas de z-index → modal `z-50` peut être caché derrière dans certaines configs).

**États disabled** : `opacity-60` insuffisamment contrasté en dark mode.

### 3.5 Feedback & états — 🔴 Amateur

**Loading** : `"Chargement…"` plain text partout. ZÉRO skeleton screen. ZÉRO spinner cohérent.

**Success** : aucun toast / banner. Tu publies une annale → l'écran update silencieusement. Pas de "✓ Publié avec succès".

**Error** : messages parfois trop techniques (`exam-page.tsx:389` : `"Échec de la soumission : {e.message}"` peut afficher "HTTP 500"). Devrait être humanisé.

**Empty states** : juste un icon Lucide + texte. Pas d'illustration. Pas de CTA encourageant.

**Disabled states** : pas de tooltip explicatif. L'utilisateur ne sait pas pourquoi un bouton est grisé.

**Action recommandée** : Sprint 1 — toast (sonner) + skeleton + `humanizeError`.

### 3.6 Page examen — 🔴 Amateur (CRITIQUE)

C'est LA page sur laquelle l'utilisateur passe 30-60 min. Elle DOIT être impeccable.

**Strengths** :
- Sidebar avec chrono + progression + numérotation cliquable → pro
- Badge mode (EXAMEN / LIBRE) visible
- Vignette progressive bien intégrée
- Confirmation avant submit
- Mode libre = validation par Q + correction inline ← excellent
- Sauvegarde auto en localStorage

**Frictions critiques** :
- ❌ **Pas de keyboard shortcuts** (UNESS/Mediko ont PgDn/PgUp, flèches, 1-9 pour cocher)
- ❌ **Sidebar toujours visible** = pas de focus mode
- ❌ **Timer mute** : pas d'alerte visuelle <5min ou <1min
- ❌ **Score gradient mono-couleur** (indigo même à 40% qu'à 90%)
- ❌ **Placeholder zones trop long** (90 chars, wrap mobile)
- ❌ **Disabled "Valider" sans tooltip** explicatif
- ❌ **Pas de "marquer pour revue"** (drapeau qui suit la question dans la liste latérale)

**Action recommandée** : Sprint 2 entier dédié.

### 3.7 Microcopy — 🟡 Mid

**OK** :
- Labels boutons impératifs ("Soumettre l'annale", "Valider la réponse", "Recommencer")

**À corriger** :
- Placeholder Matière : "Sans matière" (label-like, mauvaise pratique)
- Placeholder Zones : "Décris ce que tu observes sur l'image…" (90 chars → couper)
- Erreurs : `"Échec : {e.message}"` non humanisé (`historique-page.tsx:79`)

**Action recommandée** : Sprint 3 — helper `humanizeError(err)`.

### 3.8 Navigation — 🟡 Mid

**OK** : Sidebar gauche + routing clair, active state visuel.

**Manque** : fil d'Ariane / breadcrumb. Après 30 min d'examen, retour disorientant.

**Action recommandée** : Sprint 3 — breadcrumb sticky en haut de chaque page (sauf examen).

---

## 4. Roadmap en 3 sprints

### 🚀 Sprint 1 — Foundation (≈ 3h)

Les briques que **tout le reste réutilise**. Sans ça, on patche sur du sable.

#### 1.1 Design tokens dans `tailwind.config.ts` (1h)

Créer le fichier de config explicite au lieu de tout inline.

```ts
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        brand:   { 50: '#eef2ff', ..., 600: '#4f46e5', 700: '#4338ca', 950: '#1e1b4b' },
        success: { 50: '#f0fdf4', 500: '#22c55e', 700: '#15803d', 950: '#052e16' },
        danger:  { 50: '#fef2f2', 500: '#ef4444', 700: '#b91c1c', 950: '#450a0a' },
        warn:    { 50: '#fffbeb', 500: '#f59e0b', 700: '#b45309', 950: '#451a03' },
        // ban "orange" — utiliser "warn" partout
      },
      fontSize: {
        h1:      ['1.875rem', { lineHeight: '2.25rem', fontWeight: '700' }],
        h2:      ['1.5rem',   { lineHeight: '2rem',    fontWeight: '700' }],
        h3:      ['1.25rem',  { lineHeight: '1.75rem', fontWeight: '600' }],
        body:    ['0.9375rem', { lineHeight: '1.5rem' }],
        caption: ['0.8125rem', { lineHeight: '1.25rem' }],
      },
      borderRadius: {
        card:  '0.75rem',  // 12px — toute card
        input: '0.5rem',   // 8px — tout input
        pill:  '9999px',
      },
    },
  },
}
```

#### 1.2 Composant `<Toast>` global (45min)

Ajouter `sonner` (lib React minimaliste, ~5KB).

```tsx
// AppShell.tsx
import { Toaster } from 'sonner';

<Toaster position="top-right" theme="dark" richColors />
```

À chaque action :
```ts
import { toast } from 'sonner';
toast.success("Annale publiée");
toast.error("Connexion perdue");
```

#### 1.3 Composant `<Skeleton>` réutilisable (30min)

```tsx
// components/Skeleton.tsx
export function SkeletonCard() {
  return (
    <div className="bg-white dark:bg-neutral-800 border rounded-card p-5 space-y-3">
      <div className="h-4 bg-neutral-200 dark:bg-neutral-700 rounded animate-pulse w-2/3" />
      <div className="h-3 bg-neutral-200 dark:bg-neutral-700 rounded animate-pulse w-1/2" />
    </div>
  );
}
```

Remplacer tous les `"Chargement…"` plain text.

#### 1.4 Purge typographique (1h)

`grep -r "font-semibold" src/` → garder seulement sur H1/H2/H3 sémantiques + labels uppercase. Remplacer par `font-medium` sur le body emphasis. De **91 → ~30 occurrences**.

**Résultat Sprint 1** : foundation propre. Les sprints 2 et 3 deviennent 3× plus rapides.

---

### ⚡ Sprint 2 — Page examen (≈ 3h30)

LA page critique. 30-60 min de focus utilisateur. Doit être impeccable.

#### 2.1 Keyboard shortcuts (30min)

`exam-page.tsx` → useEffect global avec `keydown` listener :
- `←` / `→` : question précédente / suivante
- `Espace` ou `Entrée` : valider la réponse (mode libre)
- `1-9` : sélectionner option A-I
- `Ctrl+S` : sauvegarde manuelle
- `Esc` : ouvre la confirmation "Quitter ?"
- Modal `<KeyboardShortcuts />` accessible via icône `?` en sidebar

#### 2.2 Mode focus / distraction-free (45min)

- Bouton `<Maximize2 />` en haut de la sidebar examen
- Click → sidebar passe en mode "rail" 12px (juste un trait vertical), main content prend tout l'écran
- Re-click → restore
- State persisté en localStorage : `hypocampus_exam_focus_mode`

#### 2.3 Timer visuel stressant (15min)

À ≤ 300s restants : `bg-danger-100`, `text-danger-700`, `animate-pulse`.
À ≤ 60s : font passe de `text-lg` à `text-2xl`, pulse plus rapide.

#### 2.4 Score result coloré par sémantique (10min)

`exam-page.tsx` ~ligne 958 :
- `>=80%` → gradient `from-success-500 to-success-700`
- `50-79%` → gradient `from-warn-500 to-warn-700`
- `<50%` → gradient `from-danger-500 to-danger-700`

La couleur du score raconte une histoire avant qu'on lise le pourcentage.

#### 2.5 Marquer pour revue (45min)

Sur chaque question, petit drapeau cliquable (`<Flag />` Lucide).
Marquée → pastille dans la liste latérale devient ambre.
À la fin, "X questions marquées à revoir".
Pattern UNESS classique.

#### 2.6 Sidebar mobile drawer (30min)

Sur breakpoint `<sm`, sidebar examen devient un drawer ouvrable.
Hidden par défaut, bouton hamburger en haut. Sinon mobile = écran inutilisable.

**Résultat Sprint 2** : la page d'examen devient **vraiment** une page d'examen pro.

---

### ✨ Sprint 3 — Polish & dashboard (≈ 5h30)

Ce qui transforme l'impression générale.

#### 3.1 Stats cards en haut de `/entrainement` (1h)

Rangée de 4 KPI cards en haut de `annales-list.tsx` (avant `grouped.map`) :

```
┌───────────┬───────────┬───────────┬───────────┐
│ 📚 16     │ ✅ 23     │ 🎯 67%    │ ⏱️ 1h12   │
│ annales   │ sessions  │ moyenne   │ moy/exam  │
│ dispo     │ jouées    │ 30j       │ 30j       │
└───────────┴───────────┴───────────┴───────────┘
```

Data agrégée depuis `/api/exam-sessions`. Transforme une "liste" en "dashboard".

#### 3.2 Sparkline progression dans historique (1h)

Sur chaque carte d'annale dans `historique-page.tsx`, mini-graphe SVG des derniers scores.
Lib : `react-sparklines` (15KB) ou SVG inline.
Utilisateur voit en un coup d'œil sa progression sur une annale précise.

#### 3.3 Empty states soignés (1h)

Pour annales-list vide, historique vide, captures vides : illustration SVG + titre encourageant + CTA clair.

```
       ┌─────────────────┐
       │   📋  (SVG)     │
       │                 │
       │ Aucune session  │
       │ pour l'instant  │
       │                 │
       │ Joue ta première│
       │ annale pour voir│
       │ tes stats ici.  │
       │                 │
       │ [Démarrer →]    │
       └─────────────────┘
```

Aujourd'hui : `<FileText size={32} />` + texte plain.

#### 3.4 Breadcrumb sticky (30min)

Bandeau fin sticky en haut de chaque page (sauf examen) :
`Entraînement › Cardiologie › Cardio 2024 S1`.
AppShell.tsx wrappé pour partager le composant.

#### 3.5 Micro-interactions CTA (30min)

Ajouter `transition-all duration-150 active:scale-95 hover:shadow-lg` sur les CTAs primaires.
Les boutons se sentent vivants au click.

#### 3.6 Tooltips sur les disabled (45min)

Wrapper `<Tooltip>` (radix-ui) autour des boutons `disabled` avec explication.
Ex : "Réponds d'abord à la question" sur le bouton "Valider" disabled.

#### 3.7 Microcopy fix (30min)

Helper `humanizeError(err)` qui mappe :
- `HTTP 500` → "Le serveur ne répond pas"
- `Network error` → "Connexion perdue, vérifie ton réseau"
- `HTTP 409` → "Cette annale existe déjà"

Placeholder Zone : "Décris ce que tu observes sur l'image…" → "Décris les zones…"

#### 3.8 Dark mode complet (45min)

`grep -E "text-neutral-[0-9]+(?!.*dark:)" src/` → corriger les ~15 cas manqués.

**Résultat Sprint 3** : l'app passe d'"outil qui marche" à "outil qu'on a envie d'utiliser".

---

## 5. Principes de design system à graver

Une fois les 3 sprints faits, garder ces règles pour ne pas re-dégrader.

1. **Une couleur = une sémantique**. `brand` pour interactions, `success` pour réussite, `danger` pour échec/blocage, `warn` pour attention. Plus jamais `orange` ET `amber`.
2. **8pt grid**. Espacement et tailles toujours multiples de 4 : 4, 8, 12, 16, 24, 32, 48. Bannir `text-[19px]` et autres customs.
3. **Hiérarchie 4 niveaux max** : H1 (page) > H2 (section) > H3 (card) > body. `font-semibold` réservé aux titres et aux 5% de body qui doivent vraiment crier.
4. **Tout `border-radius` dans le token** : `rounded-card`, `rounded-input`, `rounded-pill`. Plus de mix `rounded-xl` / `rounded-2xl` arbitraire.
5. **Toute action a un feedback** : toast pour success/error, skeleton pour loading, optimistic UI quand possible.
6. **Tout `disabled` a un tooltip** qui explique pourquoi.
7. **Toute icône seule a un `aria-label`**.
8. **Mode focus avant les fioritures** : le contenu (la question, le PDF, le score) doit toujours respirer.

---

## 6. Effort total

| Sprint | Durée | Quick wins | Cumul |
|---|---|---|---|
| Sprint 1 — Foundation | ~3h | Tokens + Toast + Skeleton + Purge typo | 3h |
| Sprint 2 — Page examen | ~3h30 | Shortcuts + Focus mode + Timer + Flag | 6h30 |
| Sprint 3 — Polish & dashboard | ~5h30 | Stats KPI + Sparkline + Empty states + Breadcrumb + microcopy | 12h |

**Total ~12h de dev**. C'est ce qui sépare une UI bricolée d'une UI qui ferait dire à un autre étudiant en médecine : "ah, ils ont vraiment pensé à l'utilisateur".

---

## 7. Recommandation pragmatique

**Si tu fais une seule action** : Sprint 1 sous-action 1.4 → purger `font-semibold` (91 → 30). 1h de travail, zéro risque, **effet visuel énorme**.

**Si tu fais une seule journée** : Sprint 1 entier. Foundation = tout le reste devient plus simple.

**Si tu veux atteindre le niveau pro complet** : enchaîner les 3 sprints sur 2 jours. ROI maximal.

**Ne pas faire** : tout refactor d'un coup avec une lib UI custom. C'est le piège classique qui aboutit à une refonte qui prend 2 semaines pour aucun gain visible.

---

## 8. Anti-patterns à éviter en évolutif

À surveiller dans les prochaines features pour ne pas re-créer le problème.

- ❌ Ajouter `text-[Npx]` custom au lieu d'utiliser un token fontSize
- ❌ Empiler des `font-semibold` sur du body parce que "ça met en valeur"
- ❌ Inline `bg-orange-500` au lieu d'utiliser `warn-500`
- ❌ Mettre une action sans toast / sans confirmation visuelle
- ❌ Ajouter un bouton `disabled` sans `<Tooltip>` qui explique
- ❌ Désigner une nouvelle page sans empty state
- ❌ Hard-coder une `w-64` ou `p-5` sans passer par un token

---

## 9. Références externes

- UNESS officiel : interface examen sobre, focus content
- Mediko : dashboards avec KPI + sparklines en tête
- Lecturio : cards modernes, illustrations dans les empty states
- shadcn/ui : pattern library qu'on utilise déjà → réutiliser plus de composants (Tooltip, Toast, Dialog, Sheet)
- sonner (toasts) : https://sonner.emilkowal.ski/
- Tailwind UI : inspiration pour les empty states et stat cards

---

**Pour signaler une amélioration UX/UI** : ajout direct dans la section "anti-patterns" + bump la date "Dernière revue" en tête.
