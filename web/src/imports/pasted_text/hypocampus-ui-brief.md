# Brief — UI du site local Hypocampus

## 1. Contexte

Outil personnel local pour qu'un étudiant en médecine puisse réviser ses erreurs aux annales de l'examen EDN (Épreuves Dématérialisées Nationales). Les questions sont capturées automatiquement depuis une plateforme externe et stockées localement. Monoposte, jamais exposé publiquement.

## 2. Utilisateur cible

- 1 utilisateur unique
- Sessions de révision longues (plusieurs heures consécutives)
- Volumétrie cible : 500 à 5000 questions à terme
- Desktop / laptop 14"+, pas de mobile

## 3. Structure des données

Chaque question contient :

| Champ | Description |
|---|---|
| `format` | `QI` (question isolée) / `DP` (dossier progressif, 3-8 questions liées sur un même cas) / `KFP` (problème à élément clé, 3 questions liées) |
| `subject` | Matière médicale (Cardiologie, Pneumo, etc.) |
| `chapter` | Chapitre dans la matière, éditable par l'utilisateur |
| `customTitle` | Nom personnalisé donné par l'utilisateur |
| `seriesId`, `seriesPosition`, `seriesTotal` | Si série DP/KFP : identifiant partagé, position dans la série, nombre total de questions de la série |
| `vignette` | Cas clinique (texte long) — évolue par incréments dans un DP |
| `questionText` | Énoncé de la question |
| `options` | Réponses du QCM avec marqueur correcte / incorrecte / cochée par l'utilisateur |
| `selectedAnswers` / `correctAnswers` | Ce que l'étudiant a coché vs la vraie réponse |
| `freeAnswers` | Réponses libres (QROC) : saisie utilisateur + réponse attendue |
| `correctionText` | Explication détaillée de la bonne réponse |
| `images` | Captures : ECG, radios, schémas, screenshots manuels |
| `status` | `wrong` / `partial` / `unknown` |
| `capturedAt` | Date de capture |

**Règle métier importante — DP progressif** : dans un DP, le cas clinique évolue entre les questions. Par exemple, avant la question 2 quelques lignes sont ajoutées au cas (résultats biologiques), avant la question 3 d'autres lignes (évolution sous traitement), etc. L'utilisateur doit pouvoir distinguer ce qui a été ajouté à chaque étape.

## 4. Besoins de consultation

L'utilisateur doit pouvoir consulter ses captures :
- Triées dans le temps (les plus récentes d'abord, les plus anciennes d'abord)
- Regroupées par matière
- Regroupées par chapitre
- Ordonnées par matière A→Z

Pour les séries DP/KFP, l'utilisateur doit pouvoir naviguer dans la série en gardant visible le cas clinique de base, et en distinguant clairement les éléments cliniques ajoutés à chaque question.

## 5. Besoins de filtrage et recherche

- Filtrer par statut de réponse (incorrecte / partielle / indéterminée)
- Filtrer par format (QI / DP / KFP)
- Filtrer par présence d'image
- Filtrer par chapitre
- Filtrer par matière
- Combiner plusieurs filtres
- Réinitialiser les filtres rapidement
- Recherche textuelle qui couvre l'intégralité du contenu (énoncé, vignette, correction, options, réponses, chapitre, matière, titre personnalisé)
- Effacer le champ de recherche d'un geste
- Voir combien de questions répondent aux critères actifs

## 6. Information à présenter pour chaque question

- Statut de la réponse (incorrecte / partielle / indéterminée)
- Format de la question
- Position dans la série si applicable
- Matière
- Chapitre si attribué
- Date de capture
- Titre personnalisé si défini
- Source/contexte (page d'origine)
- Cas clinique (vignette)
- Énoncé de la question — c'est l'information centrale, doit être l'élément le plus immédiatement lisible
- Images associées (consultables, agrandissables, individuellement supprimables)
- Options du QCM avec distinction visuelle pour : option correcte, option incorrecte, option cochée par l'utilisateur, option correcte non cochée par l'utilisateur (erreur d'omission)
- Réponses libres : ce que l'utilisateur a saisi et ce qui était attendu, avec indicateur de justesse
- Correction détaillée

Pour les séries, les questions s'enchaînent dans l'ordre de la série, avec entre chaque la possibilité de voir les nouveaux éléments cliniques apportés.

## 7. Actions utilisateur

- Renommer une question ou une série entière
- Attribuer un chapitre à une question ou série, avec aide à la saisie à partir des chapitres déjà existants
- Ajouter une image depuis le disque local ou le presse-papier (cas où l'extraction automatique a échoué)
- Supprimer une image individuelle d'une question
- Supprimer une question entière (action sensible : confirmation et idéalement annulation possible)
- Charger une image à la demande (les images ne sont pas toujours chargées d'office pour des raisons de performance)
- Basculer entre mode clair et mode sombre, avec persistance entre sessions

## 8. Feedback attendu

- Actions instantanées (pas d'attente perceptible)
- États visuels distincts pour :
  - Chargement initial / action en cours
  - Aucune capture
  - Aucun résultat (recherche / filtre)
  - Erreur (serveur déconnecté, échec d'action)
- Confirmations des actions destructives sans utiliser les popups natives du navigateur
- Annulation possible des suppressions

## 9. Distinctions visuelles à supporter

Le système doit permettre de distinguer rapidement les statuts d'une question :
- Réponse incorrecte
- Réponse partielle
- Réponse indéterminée
- Réponse correcte (cas rare, certaines actions peuvent les générer)

Ainsi que les états techniques :
- Image disponible / partiellement disponible / manquante
- Élément éditorial (chapitre, matière, titre personnalisé)

Les conventions chromatiques sont libres tant que les distinctions restent claires en sessions prolongées.

## 10. Contraintes techniques

- Implémentation finale : **HTML / CSS / JavaScript vanilla** (sans framework). Designs riches bienvenus mais doivent être implémentables avec des compositions simples.
- Chargement instantané (< 500ms perçus) même sur 5000 questions
- Lazy-load des images (chargement à la demande, certaines pèsent plusieurs Mo)
- Compatible Chrome récent uniquement

## 11. Pistes d'extensions futures (optionnel)

- Mode galerie pour révision visuelle (ECG, imagerie)
- Mode révision plein écran avec navigation clavier et masquage progressif de la correction
- Mode flashcard
- Statistiques de progression dans le temps (erreurs par matière / chapitre / période)
- Tags multiples par question
- Recherche avec opérateurs (matière:"cardio", statut:"wrong", etc.)

## 12. Direction

Outil personnel utilisé en sessions longues. Liberté totale sur la direction esthétique. Le seul impératif est que la **lisibilité de l'énoncé** prime et que l'œil ne fatigue pas après plusieurs heures.

---

**Ce qui a été retiré pour ne pas brider Gemini** :
- Toute mention de "cartes", "sidebar", "lightbox", "dépliable", "header", "badge", "modal" → reformulé en besoins fonctionnels
- Le code couleur précis (rouge/orange/vert/gris) → laissé libre, seules les distinctions à supporter sont listées
- Le mood "calme, dense, minimal" → remplacé par "lisibilité prime + sessions longues confortables"
- Les références aux frameworks visuels (Notion, Linear) déjà absentes

Tu peux copier ce brief tel quel dans Gemini.