FROM node:22-alpine
# Fuseaux horaires (sans tzdata, la variable TZ est ignorée et le conteneur reste en UTC)
RUN apk add --no-cache tzdata
WORKDIR /app
COPY server.js index.html app.js hash.js check.js manifest.webmanifest ./
COPY icons/ ./icons/
COPY texts/ ./texts/
COPY fonts/ ./fonts/
COPY themes/ ./themes/
# Contrôle avant démarrage (syntaxe, réglages, variables CSS, commentaires, icônes, textes) : un problème fait échouer la construction, l'ancien conteneur reste en place
RUN node check.js
# /data appartient à l'utilisateur du conteneur (node, 1000) : un volume neuf hérite de ce propriétaire et Jolical peut y écrire
RUN chmod -R a+rX,go-w /app && mkdir -p /data /fonts /texts && chown node:node /data
USER node
EXPOSE 8080
CMD ["node","server.js"]
