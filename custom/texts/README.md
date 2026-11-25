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

---

## English

This folder is mounted read-only in the container (`/texts`). Changes apply the next time the page loads, without a restart.

- **Change a few texts**: create `texts_EN.perso.json` (or `texts_FR.perso.json`…) containing only the lines to change, copied from
  `texts/texts_EN.json`. Example: `{ "load.title": "One moment…" }`
- **Add a language**: copy `texts/texts_EN.json` here as `texts_XX.json` (XX = language code, e.g. `texts_DE.json`), translate the
  texts, and set `lang.name` (name shown in the list) and `locale` (date format, e.g. `de-DE`). The language then appears in
  **General settings > Language**. A missing key is shown in French.

Keys starting with `_` are ignored. `{name}` is a value inserted by Jolical; `\n` is a line break.
