// Contrôle avant livraison et avant démarrage (lancé aussi par le Dockerfile : un problème fait échouer la construction).
// Usage : node check.js     (aucune dépendance ; n'écrit que dans un dossier temporaire, ne contacte rien)
// Vérifie les pièges déjà rencontrés (docs/NOTES.md, « Pièges connus ») :
//   1. syntaxe de server.js, app.js, hash.js
//   2. toutes les valeurs par défaut (DEF, app.js) acceptées par le clean() du serveur (sinon : réglage effacé à chaque sauvegarde)
//   3. réglages cohérents : clés de GEN et des Paramètres présentes dans SCHEMA, aucune clé de SCHEMA orpheline
//   4. variables CSS utilisées sans valeur de repli : définies hors d'une règle conditionnelle (sinon toute la déclaration est ignorée, ex. --thc)
//   5. code caché derrière un commentaire « // » en milieu de ligne
//   6. éléments #id appelés par app.js présents dans index.html ; manifeste et icônes de l'application installable
//   7. textes : texts/texts_FR.json lisible ; toute clé appelée (T('…') dans app.js, TX('…') dans server.js, {{…}} dans index.html) existe ;
//      clés jamais utilisées signalées
//   8. autres langues (texts/texts_*.json) : mêmes clés que le français, mêmes valeurs insérées {…}, « lang.name » et « locale » présents
//   9. thèmes fournis (themes/*.json) : lisibles, tous leurs réglages acceptés par le serveur (polices fournies comprises)
const fs=require('fs'),path=require('path'),os=require('os'),vm=require('vm'),{spawnSync}=require('child_process');
const D=__dirname,rd=f=>fs.readFileSync(path.join(D,f),'utf8'),errs=[],warns=[];
const err=(n,m)=>errs.push(`[${n}] ${m}`),ok=n=>console.log(`  ✓ ${n}`);

// 1. Syntaxe
for(const f of['server.js','app.js','hash.js']){const r=spawnSync(process.execPath,['--check',path.join(D,f)],{encoding:'utf8'});if(r.status)err(1,f+' : '+(r.stderr||'').split('\n').slice(0,5).join(' '))}
if(!errs.length)ok('1. syntaxe');

// 2 et 3. Réglages : serveur chargé en mode contrôle (secret factice, dossier de données temporaire, pas de démarrage)
const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'jolical-check-')),cfg=path.join(tmp,'config');
fs.writeFileSync(cfg,'NC_URL=https://nextcloud.invalid\nNC_USER=x\nNC_APP_PASSWORD=x\nAPP_PASSWORD_HASH=scrypt:16384:8:1:AAAA:BBBB\n');
Object.assign(process.env,{AGENDA_CHECK:'1',CONFIG_FILE:cfg,DATA_DIR:path.join(tmp,'data'),FONTS_DIR:path.join(tmp,'fonts'),TEXTS_DIR:path.join(tmp,'texts'),LOG_LEVEL:'error'});
const app=rd('app.js');let S;
const log0=console.log;console.log=()=>{};try{S=require(path.join(D,'server.js'))}catch(e){err(2,'server.js ne se charge pas : '+e.message)}finally{console.log=log0}
if(S){
  // DEF : de « const WD= » à la ligne qui complète DEF pour les 5 familles
  const a=app.indexOf('const WD=['),b=app.indexOf('\n',app.indexOf("for(const x of'gbcpf')Object.assign(DEF"));let DEF=null;
  try{DEF=vm.runInNewContext(app.slice(a,b)+'\nDEF',{T:k=>k})}catch(e){err(2,'DEF illisible dans app.js : '+e.message)}   // T() : textes (ici, la clé suffit)
  if(DEF){const c=S.clean(DEF),bad=Object.keys(DEF).filter(k=>JSON.stringify(c[k])!==JSON.stringify(DEF[k]));
    if(bad.length)err(2,'valeurs par défaut refusées par le serveur (SCHEMA) : '+bad.map(k=>k+'='+JSON.stringify(DEF[k])).join(', '));else ok('2. valeurs par défaut acceptées par le serveur ('+Object.keys(DEF).length+')')}
  const SK=new Set(Object.keys(S.SCHEMA)),LISTS=['hidden','collapsed','setOpen','wd','wdf','links'];   // listes gérées à part par clean()
  for(const k of S.GEN)if(!SK.has(k)&&!LISTS.includes(k))err(3,`« ${k} » est dans GEN mais pas dans SCHEMA`);
  // champs des Paramètres écrits en clair : ['clé','libellé','type'…]
  const LBL="(?:'[^'\\n]*?'|T\\('[\\w.]+'(?:,\\{[^}]*\\})?\\))";   // libellé : 'texte' ou T('clé')
  const fields=new Set([...app.matchAll(new RegExp("\\['([A-Za-z]+)',"+LBL+",'(text|font|check|time|range|color|auto|select|frame|checks)'",'g'))].map(m=>m[1]));
  for(const m of app.matchAll(new RegExp("\\[\\[\\['?(\\w+)',"+LBL+"\\],\\['(\\w+)',"+LBL+"\\]\\]\\]",'g'))){fields.add(m[1]);fields.add(m[2])}   // cases multiples (checks)
  for(const k of fields)if(!SK.has(k)&&!['bdv','wd','wdf'].includes(k))err(3,`champ des Paramètres « ${k} » absent de SCHEMA (valeur jamais enregistrée)`);
  // clé de SCHEMA ni par défaut, ni dans les Paramètres, ni état de l'interface (STATE, CSS personnalisé compris) : orpheline
  const STATE=['showDone','showRO','dated','tasksByList','toolsName','toolsCal','toolsDeck','toolsTasks','srK','sideClosed','theme','themeEdit','themeFrame','themeEditFrame','holUrl','vacUrl','frameSrc','css'],gen=k=>/^[gbcpf](Fg|Bg|Bo|Bc|Bw|Br|Sh)$/.test(k)||/^[bcedtfg]H[mv]$/.test(k);
  for(const k of SK)if(!(DEF&&k in DEF)&&!fields.has(k)&&!STATE.includes(k)&&!gen(k))err(3,`« ${k} » est dans SCHEMA mais nulle part dans app.js (DEF, Paramètres)`);
  if(!errs.some(e=>e.startsWith('[3]')))ok('3. réglages cohérents (SCHEMA, GEN, Paramètres)');
  // quelques fonctions de sécurité
  const t=(c,m)=>{if(!c)err(3,m)};
  t(S.isPriv('10.1.2.3')&&S.isPriv('192.168.0.1')&&S.isPriv('127.0.0.1')&&S.isPriv('::1')&&S.isPriv('fe80::1')&&S.isPriv('::ffff:192.168.1.1')&&S.isPriv('100.64.1.1')&&S.isPriv('169.254.169.254'),'isPriv : une adresse privée passe pour publique');
  t(!S.isPriv('8.8.8.8')&&!S.isPriv('2a01:e0a::1'),'isPriv : une adresse publique est refusée');
  t(S.inCidr('192.168.1.20','192.168.1.0/24')&&!S.inCidr('192.168.2.20','192.168.1.0/24')&&S.inCidr('fd00::5','fc00::/7'),'inCidr incorrect');
  t(S.okObjTest('/remote.php/dav/calendars/u/','/remote.php/dav/calendars/u/perso/a.ics')&&!S.okObjTest('/remote.php/dav/calendars/u/','/remote.php/dav/calendars/u/perso/')&&!S.okObjTest('/remote.php/dav/calendars/u/','/remote.php/dav/calendars/u/perso'),'okObj : une collection passe pour un objet');
  t(S.ipKey('2a01:e0a:1:2:3:4:5:6')===S.ipKey('2a01:e0a:1:2:aaaa::1'),'ipKey : un même /64 donne deux clés');}

// 4. Variables CSS sans valeur de repli
{const h=rd('index.html'),css=[...h.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(m=>m[1]).join('\n').replace(/\/\*[\s\S]*?\*\//g,''),def=new Set();
  for(const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)){const sel=m[1].trim();if(/^body[.:]/.test(sel))continue;for(const v of m[2].matchAll(/(--[\w-]+)\s*:/g))def.add(v[1])}   // règle « body.xxx » : conditionnelle
  for(const m of app.matchAll(/setProperty\('(--[\w-]+)'/g))def.add(m[1]);
  const DYN=[/^--[gbcpf]-(fg|bg|bc|bo|bw|br|sh)$/,/^--[bcedtfg]-h[mp]$/,/^--w[df]\d$/,/^--(ev|dot)-l[mp]$/,/^--cas[tscb]1?$/];   // noms construits par theme()
  const used=new Set([...css.matchAll(/var\((--[\w-]+)\)/g),...app.matchAll(/var\((--[\w-]+)\)/g)].map(m=>m[1]));
  const miss=[...used].filter(v=>!def.has(v)&&!DYN.some(r=>r.test(v)));
  if(miss.length)err(4,'variables CSS utilisées sans repli et jamais définies hors règle conditionnelle : '+miss.join(', '));else ok('4. variables CSS ('+used.size+' utilisées sans repli)')}

// 5. Code caché derrière un « // » en milieu de ligne
for(const f of['server.js','app.js']){rd(f).split('\n').forEach((l,i)=>{const m=l.match(/(?:^|[\s;})\]])\/\/(?!\/)(.*)$/);if(!m)return;const c=m[1];
  if(/'[^']*$/.test(l.slice(0,m.index))&&(l.slice(0,m.index).match(/'/g)||[]).length%2)return;   // « // » dans une chaîne
  if(/\);\s*\S|=>\s*[{(\w]|\)\{|;\s*(const|let|if|for|return)\b|\.(push|append|replaceChildren|addEventListener|setProperty)\(|\b(if|for|while)\(/.test(c))err(5,`${f}:${i+1} code possible après « // » : ${c.trim().slice(0,90)}`)})}
if(!errs.some(e=>e.startsWith('[5]')))ok('5. aucun code caché derrière un commentaire');

// 6. Éléments appelés par app.js, application installable
{const h=rd('index.html'),ids=new Set([...h.matchAll(/\bid="([\w-]+)"/g)].map(m=>m[1])),DYN=['ldt','dropbox'];   // éléments créés par le script
  const miss=[...new Set([...app.matchAll(/\$\('#([\w-]+)/g)].map(m=>m[1]))].filter(x=>!ids.has(x)&&!DYN.includes(x)&&!x.endsWith('-'));   // « #v-'+vue » : nom construit
  if(miss.length)err(6,'app.js appelle des éléments absents de index.html : #'+miss.join(', #'));
  let mf=null;try{mf=JSON.parse(rd('manifest.webmanifest'))}catch(e){err(6,'manifest.webmanifest illisible : '+e.message)}
  for(const ic of mf?.icons||[])if(!fs.existsSync(path.join(D,ic.src)))err(6,'icône absente : '+ic.src);
  for(const f of['icons/icon.svg','icons/icon-32.png','icons/apple-touch-icon.png'])if(!fs.existsSync(path.join(D,f)))err(6,'icône absente : '+f);
  if(!errs.some(e=>e.startsWith('[6]')))ok('6. éléments de la page, manifeste et icônes')}

// 7. Textes
{let X=null;try{X=JSON.parse(rd('texts/texts_FR.json'))}catch(e){err(7,'texts/texts_FR.json illisible : '+e.message)}
  if(X){const srv=rd('server.js'),h=rd('index.html'),has=k=>Object.hasOwn(X,k),pre=new Set(Object.keys(X).map(k=>k.split('.')[0]));
    const used=new Set(),dyn=[];
    for(const m of app.matchAll(/\bT\('([\w.]+)'(?=[,)])/g))used.add(m[1]);for(const m of srv.matchAll(/\bTX\('([\w.]+)'(?=[,)])/g))used.add(m[1]);
    for(const m of h.matchAll(/\{\{([\w.]+)\}\}/g))used.add(m[1]);
    for(const m of(app+srv).matchAll(/\bTX?\('([\w.]+\.)'\s*\+/g))dyn.push(m[1]);   // clé construite : T('rem.'+k) → préfixe « rem. »
    for(const m of(app+srv).matchAll(/'([a-z]\w*\.[\w.]+)'/g))if(pre.has(m[1].split('.')[0])&&!/^[\w.]+\.(js|json|ics|png|svg|html)$/.test(m[1]))used.add(m[1]);   // clés dans un ternaire ou un objet : T(c?'a.b':'a.c')
    used.add('locale');used.add('lang.name');used.add('load.title');used.add('login.title');used.add('app.defaultTitle');   // lus par le serveur dans l'objet des textes
    const miss=[...used].filter(k=>!has(k)&&!dyn.some(p=>k.startsWith(p)&&k===p));
    if(miss.length)err(7,'textes absents de texts_FR.json : '+miss.join(', '));
    for(const p of dyn)if(!Object.keys(X).some(k=>k.startsWith(p)))err(7,`aucun texte « ${p}… » dans texts_FR.json`);
    const unused=Object.keys(X).filter(k=>!k.startsWith('_')&&!used.has(k)&&!dyn.some(p=>k.startsWith(p)));
    if(unused.length)err(7,'textes jamais utilisés (à retirer de texts_FR.json) : '+unused.join(', '));
    if(!errs.some(e=>e.startsWith('[7]')))ok('7. textes ('+Object.keys(X).length+' dans texts_FR.json)')
    // 8. autres langues
    const ph=v=>[...String(v).matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort().join(','),keys=Object.keys(X).filter(k=>!k.startsWith('_')),L=[];
    for(const f of fs.readdirSync(path.join(D,'texts')).filter(f=>/^texts_[\w-]+\.json$/.test(f)&&f!=='texts_FR.json')){let Y=null;try{Y=JSON.parse(rd('texts/'+f))}catch(e){err(8,f+' illisible : '+e.message);continue}L.push(f.slice(6,-5));
      const yk=Object.keys(Y).filter(k=>!k.startsWith('_')),miss=keys.filter(k=>!Object.hasOwn(Y,k)),extra=yk.filter(k=>!has(k)),badp=keys.filter(k=>Object.hasOwn(Y,k)&&ph(X[k])!==ph(Y[k]));
      if(miss.length)err(8,f+' : textes absents : '+miss.join(', '));if(extra.length)err(8,f+' : clés inconnues : '+extra.join(', '));if(badp.length)err(8,f+' : valeurs {…} différentes du français : '+badp.join(', '));
      for(const k of['lang.name','locale'])if(!Y[k])err(8,f+' : « '+k+' » manquant');if(Y['lang.name']===X['lang.name'])err(8,f+' : « lang.name » identique au français')}
    if(!errs.some(e=>e.startsWith('[8]')))ok('8. autres langues : '+(L.join(', ')||'aucune'))}}

// 9. Thèmes fournis
if(S){for(const f of fs.readdirSync(path.join(D,'themes')).filter(f=>f.endsWith('.json'))){let t=null;try{t=JSON.parse(rd('themes/'+f))}catch(e){err(9,f+' illisible : '+e.message);continue}
    if(!/^[a-z0-9-]{1,40}\.json$/.test(f)||f==='defaut.json')err(9,f+' : nom de fichier refusé (a-z, 0-9, -)');
    if(!t.name||!t.s)err(9,f+' : « name » ou « s » manquant');else{const c=S.clean(t.s),bad=Object.keys(t.s).filter(k=>JSON.stringify(c[k])!==JSON.stringify(t.s[k]));if(bad.length)err(9,f+' : réglages refusés par le serveur : '+bad.join(', '))}}
  if(!errs.some(e=>e.startsWith('[9]')))ok('9. thèmes fournis')}

fs.rmSync(tmp,{recursive:true,force:true});
if(errs.length){console.error('\n✗ '+errs.length+' problème(s) :\n  '+errs.join('\n  '));process.exit(1)}
console.log('\nContrôle réussi.');
