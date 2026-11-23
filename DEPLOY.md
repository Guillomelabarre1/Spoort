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

## 4. Authentification et profils
Garde l'authentification **Pangolin SSO** sur la ressource : elle réserve l'accès à ta famille.
Une fois connecté, chacun choisit son profil sur la page « **Qui s'entraîne ? »** (prénom + photo).
Les données de chaque profil sont stockées dans le volume (`/data/users/profiles`, un fichier par
profil) et synchronisées entre appareils. Le tableau de bord est sur `https://<domaine>/dashboard.html`.

- **Ajouter quelqu'un** (ta copine) : invite-la comme utilisatrice dans ton organisation Pangolin et
  donne-lui accès à la ressource ; elle crée son profil depuis la page de choix.
- Toute personne ayant accès voit tous les profils (pas de mot de passe par profil).
- Avec un code PIN Pangolin ou sans authentification, l'app ne reçoit pas d'identité et reste en
  mode « données sur ce téléphone uniquement ».
- **Ne publie jamais le port 8080** du conteneur : seul Pangolin doit pouvoir le joindre,
  sinon l'en-tête d'identité pourrait être imité.
- Sauvegarde des profils : `docker cp repcounter:/data/users ./sauvegarde-profils`
  (les profils supprimés sont dans `/data/users/trash`).

Sur iPhone, l'app installée sur l'écran d'accueil a son propre stockage : connecte-toi
**une fois dans Safari, puis une fois dans l'app installée**.

### Codes PIN et chiffrement
- **Code PIN par profil** (4 chiffres) : vérifié par le serveur. Sans le bon code, impossible de
  lire ou modifier les données d'un profil, même en appelant l'API directement. Après 5 erreurs,
  attente croissante (jusqu'à 15 min). Le code n'est stocké que sous forme d'empreinte (scrypt).
  « Changer de profil » reverrouille et efface la copie locale du profil sur le téléphone.
- **Chiffrement des données** : chaque fichier de profil est chiffré (AES-256-GCM) avec la clé
  `DATA_SECRET`. Quelqu'un qui récupère le disque ou une sauvegarde du volume ne peut rien lire.
  1. Génère une clé, par exemple : `openssl rand -base64 32`
  2. Dans Dockhand, ajoute-la en **Secret** nommé `DATA_SECRET`, et dans le compose :
     `environment: - DATA_SECRET=${DATA_SECRET}`
  3. **Garde-la dans ton gestionnaire de mots de passe** : sans elle, les données sont perdues.
  Sans `DATA_SECRET`, une clé est créée automatiquement dans le volume (`/data/users/.key`) :
  ça marche, mais la clé voyage alors avec les sauvegardes du volume.
- Limite : l'administrateur du serveur détient la clé ; le chiffrement protège contre le vol des
  fichiers, le code PIN protège l'accès entre les personnes de la famille.

## 5. Sur l'iPhone
1. Si tu viens de l'ancienne app (celle du Wi-Fi) : **Réglages → Exporter** d'abord, l'historique
   est stocké par adresse. (Les données déjà présentes sur le téléphone à l'adresse du VPS sont
   reprises automatiquement dans ton profil à la première synchronisation.)
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
