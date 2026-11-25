# Jolical — notes techniques

Client web d'agenda pour Nextcloud (CalDAV), en JavaScript natif, **sans aucune dépendance externe**.
Ce document décrit le fonctionnement interne, pour qui veut modifier le code ou contribuer.
Le guide d'installation et d'administration est dans [INSTALLATION.md](INSTALLATION.md).

## Architecture

```
Navigateur  ──/api/*──►  server.js (Node 20+, proxy CalDAV)  ──►  Nextcloud
   index.html + app.js        garde les identifiants Nextcloud
```

- Le navigateur ne parle **qu'à ce serveur**, jamais à Nextcloud (pas de CORS, pas d'identifiants côté navigateur).
- `server.js` : proxy CalDAV + stockage des réglages + service des fichiers statiques, des polices, du manifeste et des icônes (application installable).
- `index.html` : structure + tout le CSS (sections numérotées 1 à 12 ; 8 = survol, 8b = animations, 11 = glisser-déposer, 12 = message bref et raccourcis).
- `app.js` : toute l'interface (sections numérotées 1 à 13, voir son en-tête ; 5b = Nextcloud injoignable, 9b = glisser-déposer).
- `check.js` : contrôle avant livraison, lancé aussi au build Docker (voir « Contrôle automatique »). `manifest.webmanifest` + `icons/` : application installable (PWA).
- `texts/texts_FR.json`, `texts/texts_EN.json` : **tous les textes affichés**, une langue par fichier (voir « Langues »).
- `themes/` : thèmes fournis (copiés dans `/data/themes` au premier démarrage) ; `fonts/` : polices libres fournies (OFL).
- Déploiement : `Dockerfile` + `docker-compose.yml`. L'image est `node:22-alpine`, utilisateur non-root `node`.

## Déploiement

Identifiants : **secret Docker `config`** (fichier `config.secret` à côté de docker-compose.yml, propriétaire 1000, droits 600, lu dans `/run/secrets/config`, lignes `NOM=valeur`) : `NC_URL` (sous-chemin accepté), `NC_USER` (idéalement un utilisateur Nextcloud dédié, à qui les calendriers sont partagés), `NC_APP_PASSWORD`, `APP_PASSWORD_HASH` (empreinte scrypt générée par `hash.js`). Modèle : `config.secret.example`. Après modification : `docker compose up -d --force-recreate`.
Pas de repli : secret absent, illisible (propriétaire ≠ 1000) ou incomplet → le serveur s'arrête avec un message clair.
Variables d'environnement restantes : `PORT` (8080), `DATA_DIR` (/data, volume Docker `jolical-data`), `FONTS_DIR` (/fonts, polices de l'utilisateur), `TEXTS_DIR` (/texts, langues et textes de l'utilisateur), `LOG_LEVEL` (`info` ou `debug`, dans le `.env`), `CONFIG_FILE` (tests), `AGENDA_CHECK` (check.js uniquement : charge server.js sans le démarrer).
`.env` peut aussi contenir `JOLICAL_BIND` : adresse sur laquelle le port 6006 est ouvert (127.0.0.1 par défaut, voir INSTALLATION.md section 7).
Healthcheck Docker (docker-compose.yml) : `wget` sur `/api/health` toutes les 60 s (état healthy / unhealthy, sans redémarrage automatique).
Guide d'administration : `docs/INSTALLATION.md`.

Le Dockerfile installe `tzdata` (sinon `TZ` est ignoré dans l'image alpine) ; `TZ` dans docker-compose.yml (défaut Europe/Paris, réglable dans `.env`). Le fuseau du conteneur ne sert qu'aux logs et à `date` : toutes les heures sont calculées dans le navigateur.

Volumes : `jolical-data:/data` (nom réglable : `JOLICAL_VOLUME`) (réglages, thèmes, calendriers externes), `./custom/fonts:/fonts:ro` (polices .woff2/.woff/.ttf/.otf de l'utilisateur, en plus de celles de `fonts/`) et `./custom/texts:/texts:ro` (langues et textes modifiés).

Après chaque modification du code : **rebuild** (`docker compose up -d --build`). Un simple redémarrage ne suffit pas. Le build lance `node check.js` : s'il trouve un problème, la construction échoue et l'ancien conteneur reste en place.

Logs : JSON dans la sortie du conteneur et console du navigateur (F12). Le serveur journalise les rejets d'URL, les erreurs DAV (avec la réponse de Nextcloud) et le contenu de `/fonts` au démarrage.


## Serveur (`server.js`)

- **Chemin des agendas découvert**, jamais deviné : `current-user-principal` puis `calendar-home-set`. Toute URL hors de ce dossier est rejetée (`okp`, anti-traversée). Écriture et suppression (`/api/event`, `/api/raw`) : **un objet seulement** (`okObj` : `<dossier>/<calendrier>/<objet>`), jamais un calendrier entier.
- **Sécurité** : page de connexion par mot de passe seul (voir « Connexion »), `umask 077` (fichiers de /data lisibles par le seul propriétaire), en-tête `X-Requested-With: cal` obligatoire pour les requêtes non-GET (anti-CSRF), CSP stricte (`default-src 'self'`, `base-uri 'none'`, `form-action 'self'`, `frame-ancestors`), corps de requête lus en octets (1 Mo max, connexion coupée = erreur, JSON invalide = 400), requête entière en 60 s max (`requestTimeout`). Avertissement dans les logs si `NC_URL` n'est pas en https.
- **Nextcloud** : chaque requête DAV a 30 s maximum. Nextcloud injoignable (réseau, délai, réponse 5xx) = `503 {error:'nextcloud'}` au navigateur (bascule en mode hors-ligne). `PUT` avec `If-Match` (ou `If-None-Match:*` en création), `DELETE` avec `If-Match` quand le navigateur connaît l'ETag : modifié ailleurs entre-temps = 412, rien n'est fait.
- Routes publiques (sans session) : `/`, `/app.js`, `/manifest.webmanifest`, `/icons/*`, `/fonts/*`, `/api/fonts`, `/api/session`, `/api/login`, `/api/health`. Avec session : `/api/calendars`, `events`, `tasks`, `raw`, `event` (PUT/DELETE), `settings` (GET/PUT), `themes` (GET/POST/PUT/DELETE, `themes/<id>/overwrite` POST), `config` (GET export / POST import), `ext` (GET), `ext/hol` et `ext/vac` (POST), `extdata`, `extcals` (GET/POST/PUT/DELETE), `extevents`, `offline`, `devices`, `logout`, `lockout` (GET), `lockout/clear` (POST), `daycolors` (couleurs personnalisées des jours), `search` (recherche).
- **Fichiers statiques** (script, manifeste, icônes, polices) : `ETag` + `Cache-Control: no-cache` (le navigateur garde sa copie, réponse 304 si rien n'a changé). La page `/` reste `no-store` (couleurs et titre calculés à chaque fois).
- **Fichiers JSON de /data** (sessions, blocage, réglages, thèmes, calendriers externes) : lus via `rj()`, gardés en mémoire tant que le fichier ne change pas (date + taille) ; `wa()` écrit (fichier temporaire + renommage) et oublie la copie en mémoire.
- **Téléchargement des calendriers externes** (`safeGet`, anti-SSRF) : http(s) seulement, 15 s et 5 Mo max, `Accept-Encoding: identity`. Adresses non publiques refusées (loopback, 10/8, 172.16/12, 192.168/16, 100.64/10 = Tailscale, 169.254/16, IPv6 locales, IPv4 « mappées »…) sauf réglage `extAllow` (« Adresses autorisées » : noms, `*.domaine`, adresses, plages CIDR). Contrôle sur l'adresse **réellement connectée** (fonction `lookup` de http/https : pas de contournement par un DNS qui change de réponse) ; adresse écrite en clair vérifiée avant ; redirections suivies à la main (5 max), chacune contrôlée. Messages simplifiés (`extErr` : « adresse non autorisée… », « serveur injoignable », « nom de domaine introuvable », « certificat du site invalide », « délai dépassé », « le serveur distant répond 404 ») : plus de code réseau qui permettrait de cartographier le réseau local. L'import d'une configuration enregistre d'abord les réglages généraux (dont `extAllow`) puis télécharge.
- **Calendriers externes** (jours fériés `hol`, vacances `vac`) : `POST /api/ext/hol {url}` → téléchargement (`safeGet`), vérification (`checkIcs` : `BEGIN:VCALENDAR` + au moins un `VEVENT` avec `DTSTART` lisible, **20 000 VEVENT au plus**), puis `/data/ext-hol.ics` + `/data/ext-hol.json` (url, date, nombre d'évènements, première/dernière date, nom). `GET /api/ext` renvoie ces métadonnées + `next` (prochaine mise à jour). Erreurs : HTTP 502 + `{error}` lisible.
- **Lecteur ICS unique** (`icsParse` + `occurrences` + `expandAll`, fichiers gardés en mémoire par `icsGet`) pour les jours fériés, les vacances et les calendriers ajoutés : fuseaux, RRULE (DAILY / WEEKLY / MONTHLY / YEARLY, INTERVAL, COUNT, UNTIL, BYDAY avec rang, BYMONTHDAY, BYMONTH, BYSETPOS, WKST ; YEARLY + BYDAY avec rang sans BYMONTH = rang dans l'année, ex. `20MO`), EXDATE, RDATE, exceptions RECURRENCE-ID, DURATION, annulations. **Protection** : sans COUNT, la règle démarre directement à la période demandée (moins la durée de l'évènement) au lieu de parcourir tout depuis le début de la série ; budget d'itérations par requête (`bud` : 5×10⁵ pour `/api/extevents`, 4×10⁵ pour fériés/vacances) : un fichier piégé ne bloque plus le serveur (lecture arrêtée, avertissement dans les logs).
- **`GET /api/extdata`** : `{hol:[{s,e,t}], vac:[…]}` (dates `AAAAMMJJ`, fin exclue) via le lecteur unique, fenêtre de −3 à +4 ans. Règles propres : évènements « enseignants » (prérentrée) ignorés ; fin absente ou égale au début = 1 jour (cas réels : « Pont de l'Ascension 2027 », « Début des Vacances d'Été 2028 ») ; évènement à heure = jours touchés (heure du conteneur). Formats vérifiés sur les fichiers publics français (jours fériés Etalab, calendrier scolaire).
- **Mise à jour automatique des calendriers externes** (`extAuto`) : vérifiée 10 s après le démarrage puis **toutes les 5 minutes** ; une échéance passée de moins de 2 min compte comme atteinte (« toutes les heures » = vraiment toutes les heures). Deux listes de fréquences : fériés / vacances = `extEvery` (jour, semaine, mois, **trimestre** par défaut, semestre, an, jamais) ; calendriers ajoutés = leur propre `every` (heure, 12 h, jour, semaine, trimestre, an, jamais). Retélécharge l'URL du dernier téléchargement réussi. Échec : ancien fichier conservé, `err` + `errDate` dans le .json, **nouvel essai après la moitié de la période, entre 30 min et 24 h** (`retryMs`) ; un téléchargement réussi efface l'erreur. La prochaine date est calculée **par le serveur seulement** (`extDue` → `next`, affichée telle quelle par le navigateur).
- **Erreurs API côté navigateur** : `api()` ajoute le message `{error}` du serveur à « HTTP xxx » ; cas courants traduits : 503 Nextcloud (« Nextcloud injoignable, rien n'a été modifié »), 412 (« modifié ailleurs entre-temps… »), serveur injoignable.
- **Évènements** : requête `REPORT` avec `expand` (récurrences développées) ; repli automatique sans `expand` si Nextcloud le refuse (mais pas s'il est injoignable).
- **Lecture seule** détectée par : chemin `app-generated--` (cartes Nextcloud Deck) ou absence de privilège d'écriture.
- **Réglages** : généraux dans `settings.json`, apparence dans `/data/themes/<id>.json` (voir « Thèmes »), validés par `SCHEMA` (clés inconnues ou valeurs invalides ignorées). La liste `GEN` dit quels réglages sont généraux.
- **Healthcheck** : `GET /api/health` (public, aucune donnée) = `{ok, nextcloud}` ; 503 si /data n'est pas accessible en écriture ; `nextcloud` = secondes depuis le dernier échange réussi (information seulement : une panne de Nextcloud ne rend pas le conteneur « unhealthy »).
- Décodage XML : les entités numériques (`&#13;`) sont décodées (Nextcloud les utilise dans les ICS).


## Réglages (nomenclature)

Référence : `docs/PARAMETRES.md` (liste des paramètres dans l'ordre de l'écran, avec leur clé). Ordre des catégories de l'Apparence : Général, Espacements, Titres et textes, Écran de chargement, Panneaux et volets, Boutons, Calendriers, Couleur des jours, Évènements, Tâches, Pop-up, Champs, Animations, Custom CSS.

Cinq familles d'éléments, chacune avec 7 réglages (clé = lettre + suffixe) :

| Lettre | Famille | Suffixes |
|---|---|---|
| `g` | Général (menu, cadres) | `Fg` texte · `Bg` fond · `Bo` opacité · `Bc` bordure · `Bw` épaisseur · `Br` radius · `Sh` ombre |
| `b` | Boutons | idem |
| `c` | Calendriers (semaines, mois, mini) | idem |
| `p` | Pop-up | idem |
| `f` | Champs | idem |

Côté CSS, ce sont les variables `--g-fg`, `--g-bg`, `--g-bo`, etc. Pour ajouter un réglage : `SCHEMA` (server.js), `DEF` + `theme()` + liste `cats` (app.js), variable dans `:root` (index.html).

Autres réglages notables : `maxEv` (évènements avant regroupement, **par section** du jour), `evDur` (durée par défaut en minutes, 5–240 ; une ancienne valeur > 240 est ramenée à 240),
`pmStart` / `evStart` (début de l'après-midi / de la soirée, type `time` « HH:MM », défaut 13:30 / 18:00), `minM` / `minA` / `minS` (hauteur minimale des sections en évènements, défaut 2 / 2 / 1),
`sepW` / `sepOp` (épaisseur / opacité des pointillés, catégorie Calendriers), `hdBp` (largeur à partir de laquelle l'en-tête tient sur une ligne, défaut 900 px, catégorie Titres et textes),
`fontHead` / `sizeHead` (police / taille des en-têtes « lun 12 » de la vue Mois, catégorie Titres et textes ; non définis = ceux des sous-titres),
`holUrl` / `vacUrl` (URL des ICS externes), `holMonth` / `holYear` / `vacMonth` / `vacYear` (fonds fériés/vacances par vue, cochés par défaut ; « Année » vaut aussi pour le mini-calendrier),
`vacCut` (arrondir aussi le boudin des vacances aux coupures de ligne/mois), `extOp` (opacité des fonds fériés/vacances, 30 %), `holEv` (couleur des évènements fériés, #c0392b),
`fabSize` (taille du bouton principal en %, 60–200, Paramètres généraux), `evFg` / `evAuto` (couleur des noms des évènements / automatique blanc-noir selon le fond, défaut blanc et décoché),
`evLum` / `dotLum` (luminosité des évènements / des pastilles Année-mini, −100 = noir, 0 = couleur du calendrier, +100 = blanc), `dotSize` (taille des pastilles, % de la case, 80),
`extEvery` (fréquence de mise à jour des calendriers externes), `ncOp` (opacité des évènements provisoires, 50 % ; annulés = la moitié), `yrMax` (regroupement de la liste « Vue Année », 3),
`remTime` (heure des rappels « le jour-même / la veille… », 08:30, Paramètres généraux sous la durée par défaut ; l'envoi se choisit maintenant rappel par rappel),
**Animations** (Apparence > Animations) : `anim` (activer), `animSpeed` (`fast` ×0,42 / `normal` ×0,65 / `slow` ×1), `animView` (fondus de changement de mois / année / vue), `animSwipe` (balayage mobile : `none` / `t` translation / `o` opacité / `to` les deux ; défaut `o`), `animSide`, `animFold`, `animPop` (`o` opacité / `s` échelle 92 % / `os` les deux), `animHov`, `animLift`, `animFab`, `animDot` ; `showTags` est dans les Paramètres généraux (sous « Filtrer les tâches »),
`bigRadius` (radius des évènements « Double taille », 4), `showTags` (tags dans l'aperçu, coché), `taskCal` (calendrier des nouvelles tâches, href ; Paramètres généraux),
`taskFilter` (préfixes de tâches à masquer), `showDone` / `showRO` / `dated` (options des tâches), `collapsed` / `setOpen` (sections repliées), `hidden` (calendriers décochés).

**Survol des éléments** (réglage « Survol des éléments » dans 7 sections) : clés `XHm` (mode `none` / `lum` / `acc`) et `XHv` (intensité −100…100), validées par le type `enum` du `SCHEMA`.

| Lettre | Section | Éléments | Modes | Défaut |
|---|---|---|---|---|
| `b` | Boutons | tout le bouton (fond, texte, bordure) | aucun / luminosité | luminosité −10 |
| `c` | Calendriers | sections matin/aprem/soir ; numéros de jour **sans** pastille (Année, mini) | les 3 | couleur principale 18 |
| `e` | Évènements | pastilles de la vue Mois, de la pop-up du jour et de la bulle ; pastilles de la vue Année et du mini | les 3 | aucun |
| `d` | Couleur des jours | en-têtes « lun 12 » | les 3 | aucun |
| `t` | Tâches | ligne de tâche du menu latéral (texte + case) | les 3 | aucun |
| `f` | Champs | champs de formulaire (pop-ups et paramètres) | les 3 | aucun |
| `g` | Général | lignes de la liste des calendriers, titres repliables, lien « +N de plus » | les 3 | couleur principale 18 |

Fonctionnement (index.html section 8) : chaque élément expose sa couleur de base dans une variable (`--bb`/`--bt`/`--bl` boutons, `--sb` sections, `--evb` évènements, `--mdb` pastilles, `--hb` en-têtes, `--tkc`/`--tka` tâches, `--fb`/`--fl` champs) ; au survol, `color-mix(base, --X-hm --X-hp)` avec `--X-hm` = blanc / noir / `var(--acc)` / transparent (aucun). Survol actif **uniquement** avec une souris (`@media(hover:hover)`). Même principe pour la luminosité (`--ev-lm`/`--ev-lp`, `--dot-lm`/`--dot-lp`).


## Connexion et mode hors-ligne

- **Mot de passe seul** (pas d'identifiant), comparé à son empreinte scrypt (`APP_PASSWORD_HASH`, générée par `hash.js`, environ 0,1 s par essai).
  Session = cookie `HttpOnly`, `SameSite=Strict` (`Secure` en HTTPS) ; un appareil reste connecté 10 jours après sa dernière visite, 90 jours au plus.
  Appareils listés dans Paramètres > Connexions (nom deviné depuis le navigateur, renommable, déconnexion à l'unité ou de tous).
- **Blocage par adresse** (IPv6 : par /64) : 3 erreurs → 5 min, 3 de plus → 1 h, puis 24 h ; 20 erreurs ou plus en une heure, toutes adresses
  confondues → un essai toutes les 5 s pour tout le monde. Déblocage depuis Paramètres > Connexions ou en supprimant `/data/lockout.json`.
- **Nextcloud injoignable** (réseau, délai de 30 s, réponse 5xx) : le serveur répond `503 {error:'nextcloud'}` ; le navigateur garde les données
  affichées, réessaie automatiquement et, au démarrage, propose la dernière sauvegarde hors-ligne (`/data/offline.json`, mise à jour régulièrement) en lecture seule.

## Langues

- Un fichier par langue : `texts_<CODE>.json` (`FR`, `EN`…), clé → texte, `{nom}` = valeur insérée, `\n` = retour à la ligne.
  Clés spéciales : `lang.name` (nom affiché dans la liste des langues), `locale` (format des dates, `Intl` : `fr-FR`, `en-GB`…).
- Deux dossiers lus par le serveur : `texts/` (dans l'image) et `TEXTS_DIR` (`/texts`, monté depuis `custom/texts`).
  Ordre de fusion pour une langue : français (secours d'une clé absente) < `texts/texts_XX.json` < `/texts/texts_XX.json` < `/texts/texts_XX.perso.json`.
  Fusion gardée en mémoire tant qu'aucun fichier ne change (date + taille) : une modification est prise en compte au prochain chargement, sans redémarrer.
- Langue de la page : réglage général `lang` ; tant qu'il n'est pas choisi, celle du navigateur (`Accept-Language`) si elle existe, sinon le français.
  Le serveur remplace `{{clé}}` dans `index.html`, règle `<html lang>` et pose les textes dans `<script type="application/json" id="tx">`,
  avec trois clés ajoutées : `@lang` (langue de la page), `@langs` (langues disponibles `[{code, name}]`), `@langSet` (langue déjà choisie).
- Navigateur : `T('clé', {nom: valeur})` ; `LOC` = `locale`. Première ouverture (`@langSet` faux et plusieurs langues) : petite fenêtre de choix ;
  Paramètres généraux > Langue (en tête) ; changer de langue enregistre tout de suite puis recharge la page.
- Les données ne se traduisent pas : noms des tags (Important, Double taille, Vue Année : écrits tels quels dans les évènements),
  valeurs de STATUS, noms de fichiers ; les messages des logs restent en français.
- `check.js` vérifie que chaque langue de `texts/` a exactement les clés du français et les mêmes valeurs `{…}`.

## Thèmes

- Réglages répartis en deux : **généraux** (`/data/settings.json`, liste `GEN` dans server.js) et **apparence** (un fichier par thème,
  `/data/themes/<id>.json` = `{name, names?, s:{…}, from?}`). Le navigateur reçoit les deux fusionnés et renvoie le tout : le serveur range chaque réglage à sa place.
- « Par défaut » (id `defaut`) : `/data/themes/defaut.json` s'il existe, sinon les valeurs du code ; jamais modifié par Jolical.
- Modifier l'apparence crée une copie « <nom> (modifié) » (`from` = thème d'origine), qui reçoit les modifications suivantes tant qu'elle reste choisie ;
  « Écraser » remplace l'origine, « Nouveau » renomme la copie. Deux contextes indépendants : navigateur (`theme`) et iframe (`themeFrame`).
- **Thèmes fournis** (`themes/*.json`, avec `names` : nom traduit par langue) : copiés une seule fois dans `/data/themes`
  (liste dans `/data/themes/.bundled.json` : un thème supprimé n'est pas réinstallé, un nouveau thème fourni l'est à la mise à jour).
  Nouvelle installation (pas de `settings.json`) : « Vert Clair » est choisi. Renommer un thème efface ses noms traduits.
- **Apparence simple / avancée** : par défaut, Paramètres > Apparence ne montre que l'essentiel (couleur principale, fond, polices du texte
  et des titres, taille du texte, densité, animations) ; le bouton « Paramètres avancés » (réglage général `setAdv`, mémorisé) montre toutes les catégories.

## Polices

- Deux dossiers : `fonts/` (polices libres fournies, OFL : Jost, Belanosima, Darumadrop One) et `FONTS_DIR` (`/fonts`, monté depuis `custom/fonts`),
  prioritaire si un même nom existe dans les deux. Noms acceptés : `.woff2`, `.woff`, `.ttf`, `.otf`, sans séparateur de chemin ni guillemet.
- Une police est désignée par son nom de fichier (réglages `fontTitle`, `fontSub`, `fontText`, `fontTask`, `fontHead`) ; le navigateur la charge par `@font-face` depuis `/fonts/<nom>`.

## Contrôle automatique (`check.js`)

Lancé à la construction de l'image Docker (un problème fait échouer la construction) et à lancer avant chaque contribution : `node check.js`.

1. syntaxe de `server.js`, `app.js`, `hash.js` ;
2. valeurs par défaut (`DEF`, app.js) acceptées par `clean()` (server.js) ;
3. réglages cohérents : clés de `GEN` et des Paramètres présentes dans `SCHEMA`, aucune clé orpheline ; quelques fonctions de sécurité (`isPriv`, `inCidr`, `okObj`, `ipKey`) ;
4. variables CSS utilisées sans repli, définies hors d'une règle conditionnelle ;
5. code caché derrière un commentaire `//` en milieu de ligne ;
6. éléments `#id` appelés par app.js présents dans index.html ; manifeste et icônes ;
7. textes : toute clé appelée existe dans `texts_FR.json`, aucune clé inutilisée ;
8. autres langues : mêmes clés et mêmes valeurs `{…}` que le français ;
9. thèmes fournis : tous leurs réglages acceptés par le serveur.

## Pièges connus
- **Commentaire `//` au milieu d'une ligne** (piège le plus fréquent du projet) : tout ce qui suit sur la ligne est ignoré. Toujours mettre un commentaire **en fin de ligne seulement** et le code ajouté sur **sa propre ligne**. `node check.js` le détecte désormais (avec `DEF` / `clean()`, `SCHEMA` / `GEN`, variables CSS) : le lancer après chaque lot.

- **Ne jamais renvoyer `false` dans un `onmousedown`** (ni via une flèche sans accolades) : le navigateur n'active alors plus le focus des champs. Utiliser `addEventListener`.
- `Element.append()` **renvoie `undefined`** : ne pas chaîner `box.append(...).append(...)`.
- `crypto.randomUUID` n'existe pas en HTTP : utiliser la fonction `uuid()` basée sur `getRandomValues`.
- Fichiers à permissions trop strictes à l'hôte : le Dockerfile force `chmod 644` au build.
- Les cartes Deck (`app-generated--…`) sont en lecture seule côté Nextcloud : toute écriture renvoie 404.
- Les tâches « List : … » sont la structure des Decks, pas de vraies tâches : filtre `taskFilter`.
- **Tâches et Nextcloud** : dans un VTODO, `DUE` et `DTSTART` doivent avoir le même type (date / date-heure) et `DUE` ne doit pas précéder `DTSTART`, sinon le serveur rejette le fichier (validation sabre/vobject) : voir `dueProps()`.
- **Heures en UTC = rappels décalés** : Nextcloud calculait mal les rappels des évènements écrits en UTC (`Z`) et les affichait « UTC / heure locale ». Toujours écrire les heures avec `TZID` (`dtProp()` + `withTz()`).
- **Ne pas mettre de commentaire `//` au milieu d'une ligne de code minifiée** : tout ce qui suit est ignoré (accolade manquante, erreur « Unexpected end of input »).
- **Fermeture des pop-up animée** : `dialog.close()` est différé ; un dialogue en cours de fermeture a encore `open=true` pendant ~0,2 s. 
- **Rappels** : les évènements de la vue viennent d'un `REPORT` avec `expand`, qui peut ne pas contenir les `VALARM` : toujours lire les rappels dans l'ICS brut (`/api/raw`) avant de les modifier, sinon on risquerait de supprimer un rappel invisible.
- **Ne jamais écrire `.map(chip)`** : `map` passe l'index en 2e argument, qui serait pris pour le libellé (titres « 1 », « 2 »…). Écrire `.map(v=>chip(v))`.
- **iPad / Safari** : les champs date ont une largeur minimale imposée -> `minmax(0,1fr)` + `min-width:0` + `appearance:none` (uniquement sur iOS, via `@supports(-webkit-touch-callout:none)`).
- **Variable CSS sans valeur par défaut** : `var(--x)` sans repli dont `--x` n'est défini que dans une règle conditionnelle (`body.an-hov{…}`) rend **toute** la déclaration invalide quand la règle ne s'applique pas (bug `--thc` : toute la `transition` perdue). Toujours donner une valeur dans `:root` (contrôlé par check.js).
- **Évènement « développé » (REPORT expand)** : heures en UTC ; mais l'ICS brut (`/api/raw`, tâches, repli sans expand) garde `TZID` : toujours lire les dates avec `pdate(v, paramètres)` (fuseau converti).
- **En-têtes de proxy** : `X-Forwarded-For` est complété par chaque proxy ; la première valeur est choisie par le client. Ne lire que celle ajoutée par notre proxy (la dernière) et seulement si la connexion vient d'une adresse privée.
- **Textes** : ne jamais écrire un texte affiché en dur dans app.js / index.html / les réponses du serveur : l'ajouter à `texts/texts_FR.json` **et** `texts/texts_EN.json`, et utiliser `T('clé')` / `{{clé}}` / `TX('clé')` (check.js signale les clés absentes et inutilisées). Ne pas traduire ce qui est une donnée (noms des tags, valeurs de STATUS, noms de fichiers).
- **Variable `T` déjà prise** : dans une fonction, ne pas nommer une variable locale `T` : elle masquerait la fonction des textes.
- **Pas de `subgrid` sur un élément qui a `container-type`** : `container-type` ajoute une containment de mise en page, et le navigateur ignore alors `subgrid` (lignes du jour désalignées, case « écrasée »). D'où la grille à plat de la vue Mois.

