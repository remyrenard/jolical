# Installation et administration

Toutes les commandes se lancent sur le serveur, depuis le dossier du projet (celui qui contient `docker-compose.yml`).

---

## 1. Installation

### Côté Nextcloud

1. Créez de préférence un **utilisateur dédié** (par exemple `jolical`) et partagez-lui, avec les droits d'écriture, les calendriers et listes de tâches à afficher. Jolical n'a ainsi accès qu'à ce que vous lui partagez.
2. Connecté avec cet utilisateur : **Paramètres personnels > Sécurité > Créer un mot de passe d'application**.

### Côté serveur

1. Créez `config.secret` à partir du modèle :

   ```
   cp config.secret.example config.secret
   ```
2. Générez **l’empreinte de votre mot de passe** d’accès à Jolical :  
   Votre mot de passe n'est jamais stocké, seule son empreinte (calcul à sens unique) l'est.  
   (Le mot de passe est demandé deux fois, sans s'afficher)

   ```
   docker compose run --rm jolical node hash.js
   ```

   Copiez la ligne affichée `APP_PASSWORD_HASH=scrypt:…` pour l'étape suivante.
3. Remplissez `config.secret` :

   ```
   nano config.secret
   ```

   ```
   NC_URL=https://cloud.example.com
   NC_USER=jolical
   NC_APP_PASSWORD=xxxxx-xxxxx-xxxxx-xxxxx-xxxxx
   APP_PASSWORD_HASH=scrypt:…   (généré à l'étape précédente)
   ```

   `NC_URL` accepte un sous-chemin (`https://example.com/nextcloud`).
4. Donnez le fichier à l'utilisateur du conteneur (1000) et protégez-le :

   ```
   sudo chown 1000:1000 config.secret
   chmod 600 config.secret
   ```

   Sans ce propriétaire, Jolical ne démarre pas et l'indique dans les logs.
5. Démarrez :

   ```
   docker compose up -d --build
   ```
6. Configurez votre proxy HTTPS vers `http://127.0.0.1:6006`, ou l'accès direct en réseau local (voir section 7).

Le fichier `.env` (facultatif, à côté de `docker-compose.yml`) peut contenir :

| Variable         | Rôle                                                                 | Défaut         |
|------------------|----------------------------------------------------------------------|----------------|
| `LOG_LEVEL`      | `info` ou `debug`                                                    | `info`         |
| `JOLICAL_BIND`   | adresse sur laquelle le port 6006 est ouvert (section 7)             | `127.0.0.1`    |
| `JOLICAL_VOLUME` | nom du volume Docker des données (pour reprendre un volume existant) | `jolical-data` |
| `TZ`             | fuseau horaire du conteneur (logs)                                   | `Europe/Paris` |

> ⚠️ Docker ne relit pas `config.secret` lors d’un simple redémarrage : après chaque modification, relancez avec  
> `docker compose up -d --force-recreate`.

---

## 2. Modifier le mot de passe d’accès à Jolical

Le mot de passe n'est jamais stocké : seule son **empreinte** (calcul à sens unique) l'est.

1. Générez la nouvelle empreinte (le mot de passe est demandé deux fois, sans s'afficher) :

   ```
   docker compose run --rm jolical node hash.js
   ```
2. Copiez la ligne affichée `APP_PASSWORD_HASH=scrypt:…` dans `config.secret`, à la place de l'ancienne.
3. Relancez :

   ```
   docker compose up -d --force-recreate
   ```

Tous les appareils sont alors déconnectés et devront saisir le nouveau mot de passe.

**Mot de passe oublié ?** Il n'y a rien à récupérer : créez-en simplement un nouveau avec les étapes ci-dessus.

**Conseil** : une phrase de 4 ou 5 mots pris au hasard, 8 caractères au minimum ; le trousseau du navigateur la retient ensuite.

---

## 3. Mots de passe erronés : blocage et ralentissement

Jolical se protège contre quelqu'un qui essaierait de deviner le mot de passe en enchaînant les essais. Deux protections se complètent :

**1. Le blocage concerne l'appareil qui se trompe** (un téléphone, un ordinateur…), pas tout le monde :  
3 erreurs → blocage de 5 min · 3 de plus → 1 h · 3 de plus → 24 h (puis 24 h toutes les 3 erreurs).  
Si un appareil inconnu s'acharne, vous pouvez toujours vous connecter depuis les vôtres.

**2. Le ralentissement concerne tout le monde.** Un attaquant peut disposer de milliers d'adresses (ordinateurs piratés, plage d'adresses IPv6) : même avec 3 essais par adresse, il en ferait des milliers par heure. Si beaucoup d'erreurs interviennent, toutes sources confondues (20 ou plus en une heure), Jolical n'accepte plus qu'**un essai toutes les 5 secondes**, au total.

- *Pourquoi ralentir plutôt que tout bloquer ?* Un blocage général serait une arme pour l'attaquant : il lui suffirait de se tromper exprès pour vous empêcher de vous connecter. Ralentie, la saisie reste possible pour vous (au pire quelques secondes d'attente), alors que l'attaquant est limité à 720 essais par heure : bien trop peu pour deviner un mot de passe de plusieurs mots.
- Le ralentissement s'arrête de lui-même quand les erreurs cessent (moins de 20 sur la dernière heure).

Les appareils déjà connectés ne sont concernés ni par l'un ni par l'autre.

Pour lever le blocage tout de suite :

- **depuis un appareil connecté** : Paramètres > Connexions > Saisie du mot de passe > **Débloquer la saisie du mot de passe** ;
- **sans appareil connecté** :

  ```
  docker compose exec jolical rm -f /data/lockout.json
  ```

---

## 4. Déconnecter des appareils

- **Depuis Jolical** : Paramètres > Connexions > ✕ rouge au bout de la ligne de l'appareil, ou « Déconnecter tous les appareils ».
- **Sans accès à Jolical** (appareil perdu, aucun autre appareil connecté) :

  ```
  docker compose exec jolical rm -f /data/sessions.json
  ```

Un appareil reste connecté 10 jours après sa dernière visite, et 90 jours au plus.

---

## 5. Changer le mot de passe d'application Nextcloud

1. Dans Nextcloud, connecté avec l'utilisateur de Jolical : Paramètres personnels > Sécurité > créez un nouveau mot de passe d'application (et révoquez l'ancien).
2. Mettez-le dans `config.secret` (`NC_APP_PASSWORD=`).
3. `docker compose up -d --force-recreate`

Si `config.secret` a pu tomber entre d'autres mains (serveur ou disque perdu, volé ou piraté, sauvegarde partagée par erreur…) : révoquez **d'abord** ce mot de passe d'application dans Nextcloud, il ne donnera alors plus accès à rien. Changez ensuite le mot de passe de Jolical (section 2), car `config.secret` contient aussi son empreinte.

---

## 6. Thèmes, langues, polices et sauvegarde

- **Thèmes** : un fichier par thème dans le volume, `/data/themes/<id>.json`. Quatre thèmes sont fournis (Clair, Sombre, Vert Clair, Vert Foncé) ; ils sont installés une seule fois : un thème fourni que vous supprimez ne revient pas.
- **Modifier un thème** ne le change pas : une copie « <nom> (modifié) » est créée et choisie. Ensuite, dans Paramètres > Apparence > Thème : **Écraser** (la copie remplace le thème d'origine), **Nouveau** (la copie est gardée sous un autre nom) ou **Supprimer**.
- **Jolical intégré à Nextcloud (iframe)** : il a son propre thème choisi (au départ, celui du navigateur) mais est gardé en mémoire en cas de changement (par exemple, pour avoir un thème aux couleurs de Nextcloud mais garder le thème par défaut lors de la consultation de Jolical dans un navigateur).
- **Changer le thème « Par défaut »** : copiez un thème sous le nom `defaut.json`, par exemple :

  ```
  docker compose exec jolical cp /data/themes/vert-clair.json /data/themes/defaut.json
  ```

  Pour revenir aux valeurs d'origine : `docker compose exec jolical rm /data/themes/defaut.json`
- **Langue** : choisie à la première ouverture, puis dans Paramètres généraux > Langue. Ajouter une langue ou modifier quelques textes : voir [custom/texts/README.md](../custom/texts/README.md).
- **Polices** : déposez vos fichiers dans `custom/fonts/` ; elles apparaissent dans les listes de polices. Vérifiez leur licence : une police commerciale ne doit pas être publiée avec vos fichiers.
- **Sauvegarde** : Paramètres > Sauvegarde de la configuration > Exporter (réglages généraux, calendriers externes, thème choisi). « Importer une configuration… » la recharge, sur cette installation ou une nouvelle.

---

## 7. Accès : proxy HTTPS ou réseau local

Le port 6006 n'est ouvert que sur l'adresse `JOLICAL_BIND` : **127.0.0.1 par défaut** (la machine elle-même).
Jolical n'est ainsi joignable qu'à travers un proxy installé sur cette machine.

### Avec un proxy HTTPS (recommandé)

- **Proxy installé directement sur la machine** : cible `http://127.0.0.1:6006`.
- **Proxy dans un conteneur Docker** : 127.0.0.1 n'est pas joignable depuis ce conteneur. Deux solutions :
  1. mettre les deux conteneurs sur un même réseau Docker et viser `http://jolical:8080` ;
  2. ou ouvrir le port sur l'adresse du pont Docker, dans `.env` : `JOLICAL_BIND=172.17.0.1`, et viser `http://172.17.0.1:6006`.

Jolical ne croit les en-têtes du proxy (adresse réelle de l'appareil, HTTPS) que si la connexion vient d'une adresse privée,
ce qui est le cas d'un proxy sur la même machine ou dans Docker.

### Sans proxy, sur le réseau local

Indiquez dans `.env` l'adresse IP de la machine sur votre réseau (par exemple `JOLICAL_BIND=192.168.1.10`), puis ouvrez `http://192.168.1.10:6006` depuis un appareil du même réseau. À savoir :

- la connexion n'est **pas chiffrée** : le mot de passe circule en clair sur le réseau local ; à réserver à un réseau de confiance ;
- les navigateurs ne proposent pas d'**installer l'application** (PWA) sans HTTPS ;
- Jolical reste injoignable depuis l'extérieur, sauf si vous ouvrez ce port sur votre box (déconseillé sans HTTPS).

`JOLICAL_BIND=0.0.0.0` ouvre le port sur toutes les adresses de la machine (déconseillé).

Après un changement de `.env` : `docker compose up -d`.

**Intégration dans Nextcloud** :  
Dans Jolical, cochez Paramètres généraux > « Autoriser les iframes » en y indiquant l'adresse de votre Nextcloud.  
Vous pouvez désormais intégrer directement Jolical à Nextcloud grâce à l'application « External sites » de Nextcloud.

---

## 8. Contrôle au démarrage, état et logs

- À chaque construction de l'image, Jolical se contrôle lui-même (`node check.js`). En cas de problème, la construction **échoue** avec un message, et l'ancien conteneur continue de tourner.
- **État du conteneur** (healthy / unhealthy) : vérifié toutes les minutes (`/api/health` : le serveur répond et `/data` est accessible en écriture). Une panne de Nextcloud ne rend pas le conteneur « unhealthy » : Jolical passe en mode hors-ligne.

  ```
  docker inspect --format '{{.State.Health.Status}}' jolical
  ```
- **Logs** (JSON) : `docker compose logs jolical` ; connexions : `docker compose logs jolical | grep -i connexion`. Les messages des logs sont en français.

---

## 9. Mettre à jour

```
git pull
docker compose up -d --build
```

Le volume `jolical-data` (réglages, thèmes, appareils, calendriers externes, sauvegarde hors-ligne) est conservé.