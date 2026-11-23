# RepCounter

Webapp qui compte tes **exercices au poids du corps** avec la caméra (19 exercices + les tiens),
et les annonce à voix haute.
Tout tourne **dans le navigateur** : la détection de pose (MediaPipe Pose Landmarker) s'exécute
sur le téléphone, aucune image n'est envoyée à un serveur. Installable sur l'écran d'accueil de
l'iPhone (PWA) et utilisable hors-ligne une fois chargée.

## Démarrer en local

```bash
npm run setup   # installe MediaPipe et télécharge les modèles dans vendor/ (~45 Mo)
npm start       # http://127.0.0.1:5173
npm test        # tests de la logique de comptage
```

Pour tester sans caméra, passe une vidéo : `http://127.0.0.1:5173/?video=/vendor/ma-video.mp4`
(le fichier doit être dans un dossier servi, par exemple `vendor/`).

## Comment ça compte

Le catalogue est dans `js/exercises.js` : pour chaque exercice, les muscles travaillés et un
« détecteur » qui transforme les 33 points du corps (MediaPipe) en une valeur par image.
`js/counter.js` (sans dépendance, testé dans `tests/`) compte ensuite avec une machine à états à
**deux seuils** (hystérésis) : position de départ → descente → retour = 1 répétition.

| Détecteur | Principe | Exercices |
|---|---|---|
| `height` | hauteur des épaules au-dessus des mains, en % de la hauteur bras tendus (de face ou de profil) | pompes (classiques, larges, diamant, piquées), dips |
| `angle` | angle d'une articulation ; côté le mieux vu, le plus fléchi des deux, ou chaque côté séparément ; valeur inversable | tractions, squats, fentes, pont fessier, relevés de buste / jambes, mountain climbers, jumping jacks, montées de genoux |
| `stature` | hauteur du corps (nez → pieds), en % de la hauteur debout | burpees |
| `hold` | secondes passées immobile dans la bonne position | gainage, chaise |

Garde-fous : position de départ obligatoire, référence apprise sur une position immobile, posture
vérifiée, mouvements trop rapides ignorés, répétitions incomplètes signalées (bip + consigne).

**Exercices personnalisés** : nom, muscles, et un mouvement à suivre parmi des préréglages
(plier les coudes, les genoux, les hanches, lever les bras, descendre au sol, tenir une position…).

**Fiabilité** : les pompes ont été validées sur de vraies séances (fixtures dans `tests/fixtures/`).
Les autres détecteurs sont testés sur des poses synthétiques : active « Infos de détection » pour
envoyer un diagnostic si un exercice compte mal, puis `node scripts/replay-diag.mjs` pour le rejouer.

## Utiliser sur l'iPhone (auto-hébergement)

Safari n'autorise la caméra **qu'en HTTPS** (sauf `localhost`). Il faut donc servir l'app en HTTPS.
Options, de la plus simple à la plus complète :

### A. Tailscale (recommandé, rien à exposer sur Internet)
Installe Tailscale sur le Mac (ou le serveur) et sur l'iPhone, puis :
```bash
npm start
tailscale serve --bg 5173
```
Ouvre l'URL `https://<machine>.<tailnet>.ts.net` affichée, sur l'iPhone.

### B. Réseau local (Wi-Fi) avec une autorité de certification locale
Le dossier `certs/` (jamais servi, ignoré par git/Docker) contient une CA locale créée avec `openssl`.
Elle est **restreinte** (name constraints) au réseau `192.168.1.0/24`, aux noms `.local` et à `localhost` :
même installée sur l'iPhone, elle ne peut pas usurper d'autres sites.
Si l'IP du Mac change, regénère `server.pem` (voir `certs/server.ext`).

```bash
TLS_CERT=certs/server.pem TLS_KEY=certs/server-key.pem CA_CERT=certs/RepCounter-CA.crt HOST=0.0.0.0 PORT=8443 node server.mjs
```
Sur l'iPhone (même Wi-Fi), ouvre `http://<IP du Mac>:8080` : la page explique l'installation du
certificat (Réglages → Général → VPN et gestion de l'appareil, puis Informations → Réglages des
certificats), puis donne le lien `https://<IP du Mac>:8443`.
Ne partage jamais `certs/ca-key.pem`. Pour tout révoquer : supprime le profil sur l'iPhone.

### C. VPS avec Dockhand et Pangolin (recommandé pour un usage quotidien)
Image Docker multi-étapes + `docker-compose.yml` prêt pour Pangolin (labels blueprint, réseau
partagé, aucun port publié). Guide pas à pas : **[DEPLOY.md](DEPLOY.md)**.

Sans Pangolin, n'importe quel reverse proxy HTTPS fait l'affaire :
```bash
docker build -t repcounter .
docker run -d --name repcounter -p 127.0.0.1:8080:8080 repcounter
```
Exemple Caddy : `reps.mondomaine.fr { reverse_proxy localhost:8080 }`

### Installer sur l'écran d'accueil
Dans Safari : bouton **Partager → Sur l'écran d'accueil**. L'app s'ouvre alors en plein écran.

## Conseils d'utilisation
- Pose le téléphone au sol ou contre un mur, à 2–3 m, tout le corps dans le cadre.
- Pompes : téléphone debout au sol **devant toi** (~1 m des mains), ou de profil. Squats : de face ou de profil. Tractions : de face, bras et tête visibles.
- Bonne lumière, fond dégagé : la détection est bien plus fiable.
- Si ça rate des répétitions, essaie la détection « Précise » dans les réglages.

## Statistiques
L'onglet **Stats** calcule tout en local, dont la **carte des muscles** (volume des 7 derniers jours :
1 par répétition pour les muscles principaux, 0,5 pour les secondaires, 3 s de maintien = 1 rép.),
le classement des muscles et ceux à travailler. Également à partir de l'historique (`js/stats.js`, testé) :
répétitions sur 7 et 30 jours (avec l'écart par rapport à la semaine précédente), série de jours
d'affilée, record par séance et par exercice, cadence (reps/min), barres des 14 derniers jours et
calendrier de régularité sur 12 semaines. Filtrable par exercice.

Saisie manuelle d'une série (onglet Séance) et **sauvegarde** export / import en JSON
(onglet Réglages, l'import fusionne sans doublons).

## Diagnostic
Avec « Infos de détection » activé, la fin de séance envoie les points détectés (pas d'image) au
serveur s'il est lancé avec `DIAG_DIR=logs`. Pour rejouer un enregistrement dans le compteur :
`node scripts/replay-diag.mjs logs/diag-….json [--verbose]`.

## Structure
```
index.html, css/, js/app.js   interface, caméra, voix, chrono, historique (localStorage)
js/counter.js                 logique de comptage (pure, testée)
js/stats.js                   statistiques de l'historique (pures, testées)
js/exercises.js               catalogue : muscles, consignes, réglages de détection
js/musclemap.js               silhouette face / dos de la carte des muscles
js/voice.js                   synthèse vocale + bips
sw.js, manifest.webmanifest   PWA / hors-ligne
server.mjs                    serveur statique (HTTP ou HTTPS)
scripts/                      récupération de MediaPipe, icônes (make-icons.sh depuis icons/source.webp)
```
