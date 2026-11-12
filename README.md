# Shallow

Launcher de jeux local pour Windows, construit avec Electron.

## Fonctionnalités

- **Bibliothèque** : scanne tes dossiers de jeux et détecte l'exécutable de chaque jeu
- **Steam et Epic Games** : importe automatiquement les jeux installés et les lance via leur launcher
- **Jaquettes automatiques** : covers, bannières, logos et descriptions récupérés via Steam
- **Historique** : chaque session est enregistrée (temps sur 7 jours, série de jours, graphique, top du mois)
- **Récap** : bilan du mois ou de l'année (jeu phare, classement, habitudes de jeu)
- **Journal** : une note pour chaque session
- **Notes et objectif** par jeu, avec une barre de progression vers le temps visé
- **Statuts** (À faire, Commencé, Terminé, Abandonné) et **collections** personnalisées
- **Recherche rapide** `Ctrl+K` pour lancer un jeu au clavier
- **Mode manette** (`F11` ou bouton Start) : interface plein écran pilotable à la manette
- Favoris, jeux masqués, ajout manuel, filtres par source et par statut

## Raccourcis

| Raccourci | Action |
| --- | --- |
| `Ctrl+K` | Recherche rapide |
| `Ctrl+F` ou `/` | Filtrer la bibliothèque |
| `F11` | Mode manette |
| Flèches + `Entrée` | Naviguer et lancer un jeu |

## Lancer en développement

```bash
npm install
npm start
```

## Créer l'installateur

```bash
npm run dist
```

L'installateur est généré dans `dist/`.
