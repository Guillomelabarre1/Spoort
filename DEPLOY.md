# Déployer RepCounter sur un VPS avec Dockhand et Pangolin

Pangolin fournit le domaine et le HTTPS (obligatoire pour la caméra sur iPhone) : plus besoin du
certificat local. Dockhand construit l'image depuis ton dépôt Git et la redéploie à chaque push.

```
iPhone ──HTTPS──▶ Pangolin (domaine, certificat, authentification)
                     │ réseau Docker partagé
                     ▼
               conteneur repcounter :8080 (HTTP, aucun port publié)
```

## Ce qu'il faut
- Un VPS avec Docker, Pangolin et Dockhand déjà installés.
- Un sous-domaine (ex. `reps.mondomaine.fr`) géré par Pangolin.
- Un dépôt Git **privé** (GitHub, GitLab, Gitea ou Forgejo) qui contient ce dossier.
  Privé, car `tests/fixtures/` contient les points du corps enregistrés pendant de vraies séances.

## 1. Trouver le réseau Docker de Pangolin
Sur le VPS :
```bash
docker network ls
```
Repère le réseau utilisé par Pangolin (avec l'installateur officiel il s'appelle en général
`pangolin`). Si ton VPS est relié à un Pangolin distant par un site **Newt**, prends plutôt le
réseau du conteneur Newt :
```bash
docker inspect newt --format '{{json .NetworkSettings.Networks}}'
```
C'est par ce réseau que Pangolin joindra le conteneur sous le nom `repcounter`.

## 2. Créer la stack dans Dockhand
1. **Stacks → ajouter depuis Git** : URL du dépôt, branche `main`, fichier `docker-compose.yml`.
2. Active **« Build images on deploy »** : le compose construit l'image (`build: .`).
3. **Environment variables** :
   | Variable | Valeur |
   |---|---|
   | `REPCOUNTER_DOMAIN` | `reps.mondomaine.fr` |
   | `PANGOLIN_NETWORK` | le réseau trouvé à l'étape 1 (défaut : `pangolin`) |
   | `DIAG_DIR` | vide (voir « Diagnostics » plus bas) |
4. **Deploy**. La première construction télécharge MediaPipe et les modèles (~45 Mo).
   Le conteneur passe « healthy » au bout de quelques secondes.

Mise à jour automatique : copie l'URL du webhook de la stack (Dockhand) dans les webhooks du
dépôt Git. Chaque push reconstruit et redéploie l'app ; le service worker installe la nouvelle
version au prochain lancement sur l'iPhone.

## 3. Publier l'app dans Pangolin
**Option A, à la main (marche partout)** : *Resources → Add resource*
- type **HTTP**, sous-domaine `reps` sur ton domaine ;
- site : celui qui tourne sur ce VPS ;
- cible : méthode `http`, hôte `repcounter`, port `8080`.

**Option B, automatique** : le `docker-compose.yml` contient déjà les labels « blueprint »
(`pangolin.public-resources.repcounter.*`). Ils ne sont lus que si un connecteur de site
Pangolin a accès au socket Docker du VPS. Sinon, ils sont ignorés : utilise l'option A.

## 4. Authentification
Par défaut, Pangolin protège la ressource par son SSO : c'est recommandé (app perso).
Sur iPhone, l'app installée sur l'écran d'accueil a son propre stockage : tu devras te
connecter **une fois dans Safari, puis une fois dans l'app installée**. Si c'est gênant,
remplace le SSO par un code PIN ou désactive l'authentification dans la ressource Pangolin.

## 5. Sur l'iPhone
1. Avant tout, dans l'ancienne app (celle du Wi-Fi) : **Réglages → Exporter**. L'historique est
   stocké par adresse, il ne suit pas automatiquement.
2. Ouvre `https://reps.mondomaine.fr` dans Safari → **Partager → Sur l'écran d'accueil**.
3. Dans la nouvelle app : **Réglages → Importer** le fichier exporté.
4. Tu peux supprimer l'ancienne icône et le profil « RepCounter Local CA »
   (Réglages → Général → VPN et gestion de l'appareil).

## Diagnostics (optionnel)
Pour analyser un exercice qui compte mal : mets `DIAG_DIR=/data/diag` dans Dockhand,
redéploie, fais la séance avec « Infos de détection » activé, puis récupère les fichiers :
```bash
docker cp repcounter:/data/diag ./diag
node scripts/replay-diag.mjs diag/diag-….json --verbose
```
Remets `DIAG_DIR` vide ensuite : quand il est activé, l'endpoint accepte des envois
(limités à 200 fichiers de 25 Mo max).

## Vérifications utiles
```bash
docker ps --filter name=repcounter          # STATUS doit indiquer (healthy)
docker logs repcounter                      # « RepCounter sur http://localhost:8080 »
docker exec repcounter wget -qO- http://127.0.0.1:8080/ | head -c 100
```
