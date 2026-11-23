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

## Programmes de séance
Onglet Séance → **Programmes** : une suite d'exercices avec un objectif chacun (répétitions, ou
secondes pour le gainage / la chaise) et un repos entre les exercices. Ouvrir un programme permet de
l'**ajuster avant de lancer** (objectifs, ordre, ajout / retrait d'exercices, repos) sans forcément
enregistrer les changements. Pendant la séance : enchaînement automatique quand l'objectif est
atteint, écran de repos (passable), bouton « Suivant » pour passer un exercice, annonces vocales du
prochain exercice. Le bilan détaille chaque étape ; chaque exercice fait est enregistré dans
l'historique. Les programmes sont synchronisés avec le profil (`js/program.js`, testé).

## Profils, synchronisation et mensurations
- **Profils** : à l'ouverture, la page « **Qui s'entraîne ?** » propose les profils (prénom + photo)
  et permet d'en ajouter. Chaque profil a ses séances, mesures, programmes et exercices, stockés sur
  le serveur (`DATA_DIR/profiles/<id>.json`) et synchronisés entre appareils. Changer de profil :
  pastille en haut de l'onglet Séance, ou Réglages → profil. Un profil supprimé part dans `trash/`.
- **Code PIN** par profil (4 chiffres), vérifié par le serveur (empreinte scrypt, jetons d'accès par
  appareil, attente croissante après 5 erreurs). Fichiers de profils **chiffrés** (AES-256-GCM,
  clé `DATA_SECRET`). Voir DEPLOY.md.
- **Photo de profil** : recadrée en carré et réduite (256 px, ~20-40 Ko) sur le téléphone avant envoi.
- **Accès** : réservé aux personnes connectées via Pangolin (SSO). Toute personne ayant accès voit
  tous les profils (usage familial). Sans Pangolin, l'app reste en mode local sur le téléphone.
- L'app marche hors ligne : tout est d'abord enregistré sur le téléphone, puis fusionné
  (`js/merge.js` : union des séances, la modification la plus récente gagne, suppressions propagées).
- **Onglet Corps** : poids, cou, épaules, poitrine, taille, hanches, bras, cuisse, mollet ;
  IMC, masse grasse estimée (méthode U.S. Navy), courbes d'évolution et **mannequin 3D**
  (three.js) dont les proportions suivent tes mesures, avec comparaison côte à côte.
- Développement local : `DATA_DIR=data DEV_USER=moi npm start`
  (`DEV_USER` simule une connexion Pangolin, à ne jamais utiliser en production).

## Tableau de bord (ordinateur)
`/dashboard.html` (lien dans Réglages) : choix du profil, période (7 j → tout), filtre par exercice ;
répétitions, séances, jours actifs, temps actif, série, record ; volume par jour / semaine / mois,
répartition par exercice, muscles travaillés, régularité sur 52 semaines, courbes des mensurations,
comparaison de tous les profils sur 30 jours ; gestion (suppression de séances, mesures, programmes)
et export CSV de l'historique.

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
js/store.js, js/merge.js      données du profil, synchronisation et fusion (testée)
js/body.js, js/bodyui.js      mensurations : calculs (testés) et onglet Corps
js/body3d.js                  mannequin 3D (three.js, chargé à la demande)
js/program.js, js/programui.js  programmes de séance : logique (testée) et éditeur
js/profileui.js, js/pinpad.js page « Qui s'entraîne ? », photos de profil, pavé de code PIN
dashboard.html, js/dashboard.js  tableau de bord pour ordinateur
js/voice.js                   synthèse vocale + bips
sw.js, manifest.webmanifest   PWA / hors-ligne
server.mjs                    serveur statique (HTTP ou HTTPS)
scripts/                      récupération de MediaPipe, icônes (make-icons.sh depuis icons/source.webp)
```
