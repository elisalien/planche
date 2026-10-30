# Planche

Tableau blanc infini, local d'abord, collaboratif en temps réel et auto-hébergeable gratuitement.
Instance en ligne : https://planche-elpl.onrender.com

Inspiré de l'usage d'outils comme Miro, sans en reprendre le code ni la marque.

## Fonctions

- **Cadres / artboards** : formats prédéfinis (16:9, A4, mobile, desktop, story…) ou tracé libre,
  fond, motif (points, grille, lignes), coins arrondis, titre masquable, « Ajuster au contenu »,
  « Encadrer la sélection » (Maj+F). Un cadre emporte son contenu quand on le déplace.
- **Panneau Cadres** : liste ordonnée, clic = zoom animé sur le cadre, réordonnancement.
  Le mode **Présenter** (P) enchaîne les cadres dans cet ordre.
- **Zoom / dézoom** : molette centrée sur le curseur, pincement trackpad/tactile, Maj+1 / Maj+2.
  Les titres de cadres restent à taille d'écran constante, se tronquent à la largeur du cadre
  et deviennent de grandes étiquettes centrées quand on dézoome (vue d'ensemble).
- **Connecteurs (nodal)** : survolez un élément ou un cadre, tirez depuis un point bleu vers
  un autre élément. Droit / courbe / coudé, flèches, pointillés, libellé (double-clic).
  Les extrémités suivent les éléments et se rattachent par glisser.
- **Aperçu de liens** : collez une URL (Ctrl+V) → carte avec titre, description, image, favicon.
  YouTube, Vimeo, Dailymotion, Loom et fichiers .mp4/.webm → lecteur vidéo lisible dans le tableau,
  plus une fenêtre d'aperçu agrandie.
- **Magnétisme** : guides intelligents (bords et centres des objets voisins et des cadres),
  grille optionnelle, Alt pour ignorer pendant le glisser.
- **Alignement** : gauche/centre/droite/haut/milieu/bas, répartition, rangement en grille,
  même largeur/hauteur ; un élément seul dans un cadre s'aligne sur le cadre.
- Post-it, texte, formes, images (coller/glisser-déposer), annuler/rétablir, copier/coller,
  verrouillage, export/import JSON, curseurs et sélections des collaborateurs.

## Lancer en local

```bash
npm install
npm run dev        # développement (Vite + serveur de collaboration) → http://localhost:8787
npm run build && npm start   # production
```

Chaque tableau a son URL (`/#/b/<id>`). Les données sont gardées dans le navigateur (IndexedDB)
**et** sur le serveur (`./data/<id>.ybin`). Hors ligne, tout fonctionne ; les modifications se
fusionnent à la reconnexion (CRDT Yjs).

## Collaborer

- **Réseau local** : lancez `npm start`, partagez `http://<ip-de-votre-pc>:8787/#/b/<id>`.
- **En ligne gratuitement** : déployez le dépôt sur un hébergeur Node gratuit
  (Render « Free » via `render.yaml`, ou tout service acceptant le `Dockerfile` : Fly.io, Koyeb…).
  Sur les offres gratuites le disque est souvent effacé au redémarrage : ce n'est pas grave, chaque
  navigateur garde une copie complète et la renvoie au serveur à la reconnexion.
- **Hébergement statique seul** (GitHub Pages, Netlify) : l'application marche en local ;
  renseignez un serveur de collaboration dans ⚙ Paramètres (`wss://…/yjs`) pour le temps réel.
  Sans serveur, les aperçus de liens passent par l'API publique microlink.io.

Toute personne qui possède l'URL d'un tableau peut le modifier : les identifiants sont aléatoires,
mais il n'y a pas de comptes ni de droits d'accès.

## Architecture

- `server/server.mjs` : HTTP + WebSocket compatible y-websocket, persistance disque, Vite en dev.
- `server/unfurl.mjs` : métadonnées Open Graph / oEmbed (adresses privées refusées).
- `src/board.ts` : document Yjs, présence, opérations (déplacer, reparenter, supprimer…).
- `src/components/Canvas.tsx` : caméra, interactions pointeur, création, redimensionnement.
- `src/components/Overlay.tsx` : couche écran (titres responsives, poignées, guides, curseurs).
- `src/snapping.ts`, `src/align.ts`, `src/geometry.ts` : magnétisme, alignement, tracé des connecteurs.

Rendu DOM + SVG (pas de canvas) pour pouvoir intégrer des iframes vidéo et du texte éditable.

## Sauvegarde permanente en ligne (gratuit, Neon)

Sur un hébergement gratuit dont le disque est effacé (Render Free), branchez une base Postgres
gratuite : les boards y sont enregistrés et survivent aux mises en veille et redéploiements.

1. Créez un compte sur https://neon.com (gratuit, sans carte) puis un projet.
2. Copiez la *connection string* (`postgresql://…?sslmode=require`).
3. Render → service `planche` → **Environment** → ajoutez `DATABASE_URL` = cette chaîne → **Save**.
4. Après redémarrage, `/api/health` répond `"storage":"postgres"`.

Sans `DATABASE_URL`, le serveur enregistre dans `DATA_DIR` (disque local).

## Installation automatique (release)

Windows (PowerShell) :

```powershell
irm https://github.com/elisalien/planche/releases/latest/download/install.ps1 | iex
```

macOS / Linux :

```bash
curl -fsSL https://github.com/elisalien/planche/releases/latest/download/install.sh | sh
```

Le script vérifie Node.js 22+ (installation proposée via winget sous Windows), télécharge la
dernière release, installe les dépendances et crée un raccourci « Planche » (Bureau + menu
Démarrer) ou une commande `planche`. Relancer le script met à jour sans toucher aux tableaux (`data/`).
Si le dépôt est privé, le script passe par `gh` (connexion GitHub de l'utilisateur).

Publier une version : `git tag v0.2.0 && git push --tags` — GitHub Actions construit, teste et publie la release.
