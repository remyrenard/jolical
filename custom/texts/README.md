# Vos langues et vos textes

Ce dossier est monté en lecture seule dans le conteneur (`/texts`). Les changements sont pris en compte au prochain
chargement de la page, sans redémarrage.

- **Modifier quelques textes** : créez `texts_FR.perso.json` (ou `texts_EN.perso.json`…) contenant seulement les lignes à
  changer, copiées depuis `texts/texts_FR.json`. Exemple :

  ```json
  {
    "load.title": "Un instant…"
  }
  ```

- **Ajouter une langue** : copiez `texts/texts_EN.json` ici sous le nom `texts_XX.json` (XX = code de la langue, par exemple
  `texts_DE.json`), traduisez les textes, et réglez `lang.name` (nom affiché dans la liste) et `locale` (format des dates,
  par exemple `de-DE`). La langue apparaît alors dans **Paramètres généraux > Langue**. Une clé absente est affichée en français.

Les clés qui commencent par `_` sont ignorées. `{nom}` est une valeur insérée par Jolical ; `\n` est un retour à la ligne.
