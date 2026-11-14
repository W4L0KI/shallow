# Shallow

Launcher de jeux pour Windows : tous tes jeux au même endroit (tes dossiers, Steam et Epic Games), avec de belles jaquettes, ton temps de jeu et un mode manette plein écran.

## Installation

1. Va sur la page **[Releases](https://github.com/W4L0KI/shallow/releases/latest)**.
2. Télécharge **`Shallow-Setup-x.x.x.exe`**.
3. Lance-le et suis l'installation.

Windows peut afficher « Windows a protégé votre ordinateur » : l'installateur n'est pas encore signé. Clique sur **Informations complémentaires**, puis **Exécuter quand même**.

Pour mettre à jour, télécharge la dernière version et installe-la par-dessus : ta bibliothèque, tes favoris et ton historique sont conservés.

## Fonctionnalités

- **Bibliothèque** : détecte les jeux de tes dossiers et leur exécutable
- **Steam et Epic Games** : importe automatiquement les jeux installés et les lance via leur launcher
- **Jaquettes automatiques** : covers, fonds, logos et descriptions, re-téléchargés tout seuls s'ils manquent
- **Historique** : chaque session est enregistrée (temps sur 7 jours, série de jours, graphique, top du mois)
- **Récap** : bilan du mois ou de l'année (jeu phare, classement, habitudes de jeu)
- **Journal** : une note pour chaque session
- **Notes et objectif** par jeu, avec une barre de progression vers le temps visé
- **Statuts** (À faire, Commencé, Terminé, Abandonné) et **collections** personnalisées
- **Recherche rapide** `Ctrl+K` pour lancer un jeu au clavier
- **Mode manette** (`F11` ou bouton Start/Options) : interface plein écran, manettes Xbox et PlayStation
- Favoris, jeux masqués, ajout manuel, filtres par source et par statut

## Raccourcis

| Raccourci | Action |
| --- | --- |
| `Ctrl+K` | Recherche rapide |
| `Ctrl+F` ou `/` | Filtrer la bibliothèque |
| `F11` | Mode manette |
| Flèches + `Entrée` | Naviguer et lancer un jeu |

## Données

Tout reste sur ton PC, dans `%APPDATA%\Shallow` : bibliothèque, images et historique. Une copie de secours est faite chaque jour dans `%APPDATA%\Shallow\backups`.

## Pour les développeurs

```bash
npm install
npm start          # lancer en développement
npm run dist       # créer l'installateur dans dist/
```
