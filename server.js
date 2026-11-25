// Proxy CalDAV minimal, sans dépendances (Node 20+). Les identifiants Nextcloud restent ici.
const http=require('http'),https=require('https'),dns=require('dns'),net=require('net'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const {PORT=8080,DATA_DIR='/data',FONTS_DIR='/fonts',LOG_LEVEL='info',CONFIG_FILE='/run/secrets/config'}=process.env;
process.umask(0o077);   // fichiers créés dans /data (réglages, sessions, sauvegarde…) : lisibles par le seul propriétaire
const log=(l,m,x={})=>{if(l==='debug'&&LOG_LEVEL!=='debug')return;(l==='error'?console.error:console.log)(JSON.stringify({t:new Date().toISOString(),level:l,msg:m,...x}))};
const h256=s=>crypto.createHash('sha256').update(s).digest();

/* ===== 0. CONFIGURATION =====
   Identifiants lus dans le secret Docker « config » (fichier config.secret monté dans /run/secrets/config ; lignes NOM=valeur, # = commentaire) :
   NC_URL, NC_USER, NC_APP_PASSWORD : accès à Nextcloud · APP_PASSWORD_HASH : empreinte du mot de passe de l'agenda (node hash.js).
   Seul LOG_LEVEL reste une variable d'environnement (.env). CONFIG_FILE : autre emplacement du secret (tests). */
const CFG={};
try{for(const l of fs.readFileSync(CONFIG_FILE,'utf8').split(/\r?\n/)){const m=l.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);if(m)CFG[m[1]]=m[2].replace(/^(["'])(.*)\1$/,'$2')}}
catch(e){console.error(e.code==='ENOENT'?'Secret « config » introuvable : créer config.secret (voir config.secret.example et docs/INSTALLATION.md)':
  'Secret « config » illisible ('+e.code+') : le fichier config.secret doit appartenir à l\'utilisateur 1000 (sudo chown 1000:1000 config.secret ; chmod 600 config.secret), puis docker compose up -d --force-recreate');process.exit(1)}
const{NC_URL='',NC_USER='',NC_APP_PASSWORD='',APP_PASSWORD_HASH:PH=''}=CFG;
if(!NC_URL||!NC_USER||!NC_APP_PASSWORD||!PH){console.error('Variables manquantes dans config.secret : NC_URL, NC_USER, NC_APP_PASSWORD, APP_PASSWORD_HASH');process.exit(1)}
const PHM=PH.match(/^scrypt:(\d+):(\d+):(\d+):([\w-]+):([\w-]+)$/);
if(!PHM){console.error('APP_PASSWORD_HASH invalide : le régénérer avec « node hash.js »');process.exit(1)}
const U=new URL(NC_URL),origin=U.origin,pre=U.pathname.replace(/\/+$/,'');
const auth='Basic '+Buffer.from(NC_USER+':'+NC_APP_PASSWORD).toString('base64');
if(U.protocol!=='https:')log('warn','NC_URL n\'est pas en https : le mot de passe d\'application circule en clair',{nextcloud:origin});
// Erreur « Nextcloud injoignable » (réseau, délai, réponse 5xx) : renvoyée au navigateur en 503 {error:'nextcloud'} (bascule en mode hors-ligne)
const ncErr=(msg,cause)=>Object.assign(new Error(msg),{nc:true,cause});
// Requête vers Nextcloud : 30 s au plus (sinon une requête figée bloquerait la sauvegarde hors-ligne pour toujours)
let ncOk=0;   // dernier échange réussi avec Nextcloud (information du healthcheck)
const dav=async(m,p,b,h={})=>{let r;try{r=await fetch(origin+p,{method:m,body:b,signal:AbortSignal.timeout(30000),headers:{Authorization:auth,'Content-Type':'application/xml; charset=utf-8',...h}})}
  catch(e){throw ncErr('Nextcloud injoignable ('+(e.name==='TimeoutError'?'délai dépassé':e.cause?.code||e.message)+')',e)}
  if(r.status>=500)log('warn',`DAV ${m} -> ${r.status}`,{path:p});else ncOk=Date.now();
  if(!r.ok&&r.status<500)log('warn',`DAV ${m} -> ${r.status}`,{path:p,reponse:(await r.clone().text()).slice(0,300)});return r};
const tag=(s,n)=>{const m=s.match(new RegExp(`<(?:\\w+:)?${n}[^>]*>([\\s\\S]*?)</(?:\\w+:)?${n}>`));return m?m[1]:''};
const unx=s=>s.replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCharCode(parseInt(n,16))).replace(/&#(\d+);/g,(_,n)=>String.fromCharCode(+n)).replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
const resps=x=>x.split(/<(?:\w+:)?response>/).slice(1);
let root='';
// Calendrier en lecture seule : généré par une app (Deck...) ou sans privilège d'écriture
const ro=s=>{const h=unx(tag(s,'href')),p=tag(s,'current-user-privilege-set');return /app-generated--/.test(h)||(!!p&&!/<(?:\w+:)?(write-content|write|all)\s*\/>/.test(p))};
const okp=h=>typeof h==='string'&&root&&h.startsWith(root)&&!/\.\.|%2e/i.test(h);
// Objet d'un calendrier (évènement, tâche) : exactement <dossier agendas>/<calendrier>/<objet>, jamais un calendrier entier (DELETE d'une collection = calendrier supprimé)
const okObj=h=>okp(h)&&/^[^/]+\/[^/]+$/.test(h.slice(root.length))&&!/%2f|%5c/i.test(h);
// Découverte du dossier d'agendas auprès de Nextcloud (pas de chemin deviné)
async function discover(){if(root)return;
  const pf=async(p,body)=>{const r=await dav('PROPFIND',p,body,{Depth:'0'});if(r.status>=500)throw ncErr('Nextcloud : HTTP '+r.status);return r.text()};
  let x=await pf(pre+'/remote.php/dav/','<d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>');
  const pr=unx(tag(tag(x,'current-user-principal'),'href'));if(!pr)throw new Error('principal introuvable (URL/identifiants ?)');
  x=await pf(pr,'<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>');
  root=unx(tag(tag(x,'calendar-home-set'),'href'));if(!root)throw new Error('calendar-home-set introuvable');log('info','dossier agendas détecté',{root})}

// Noms acceptés : tout sauf séparateurs de chemin, guillemets, < > et caractères de contrôle
const FONT_OK=/^[^\\\/"'<>\x00-\x1f]+\.(woff2?|ttf|otf)$/i;
// Deux dossiers : celui de l'utilisateur (FONTS_DIR, prioritaire si un nom existe dans les deux) et les polices libres fournies avec l'application (fonts/)
const FONT_APP=path.join(__dirname,'fonts');
const scanFonts=()=>{let err='',all=[],app=[];try{all=fs.readdirSync(FONTS_DIR)}catch(e){err=e.code||e.message}try{app=fs.readdirSync(FONT_APP).filter(f=>FONT_OK.test(f))}catch{}
  const ok=all.filter(f=>FONT_OK.test(f));return{err,ok:[...new Set([...ok,...app])],bad:all.filter(f=>!FONT_OK.test(f)&&!/^readme|\.(md|txt)$/i.test(f)),user:ok.length}};
const fonts=()=>scanFonts().ok;
const fontFile=f=>{const u=path.join(FONTS_DIR,f);return fs.existsSync(u)?u:path.join(FONT_APP,f)};
const sf=path.join(DATA_DIR,'settings.json');
// Réglages autorisés : tout le reste est ignoré (validation côté serveur)
const SCHEMA={};
const add=(t,keys,lo,hi)=>keys.split(' ').forEach(k=>SCHEMA[k]=[t,lo,hi]);
add('hex','bmFg bmBg evFg holEv accent bg sideBg ldBg muteBg muteFg shadow grpBg colTitle colPanel colPop colSub colText monthCol todoCol doneCol dangerBg dangerFg dangerBc todayBg todayFg vacBg holBg popBg');
add('font','fontTitle fontSub fontText fontTask fontHead');add('bool','showDone showRO dated tasksByList evAuto');add('text','title',60);add('text','css',20000);add('text','taskFilter',200);
// Sections matin / après-midi / soir (heures "HH:MM") · calendriers externes (URL + affichage)
add('time','pmStart evStart remTime');
// Animations
add('bool','anim animSide animFold animHov animLift animFab animDot animTitle');add('bool','frameOn');add('text','frameSrc',500);   // iframes autorisées (case + sites)
add('bool','sideClosed');   // volet latéral replié (écrans larges)
add('enum','casTitle casSub casCal casBtn',['first','words','lower','upper']);   // casse des titres / sous-titres / calendriers
add('enum','animSpeed',['fast','normal','slow']);add('enum','animPop',['o','s','os']);add('bool','animView animSwipeAll');add('enum','animSwipe',['none','t','o','to']);add('text','holUrl vacUrl',500);add('bool','holMonth holYear vacMonth vacYear vacCut');
// Survol des éléments : mode (aucun / luminosité / couleur principale) + intensité, par famille
// b=Boutons (pas de couleur principale) · c=Calendriers · e=Évènements · d=Couleur des jours (en-têtes) · t=Tâches · f=Champs · g=Général
add('enum','bHm',['none','lum']);add('enum','extEvery',['never','day','week','month','quarter','semester','year']);add('num','ncOp',10,100);add('num','yrMax',1,10);add('num','bigRadius',0,30);add('bool','showTags');add('text','taskCal',500);add('enum','cHm eHm dHm tHm fHm gHm',['none','lum','acc']);add('num','bHv cHv eHv dHv tHv fHv gHv',-100,100);
// 5 familles d'éléments : g=Général, b=Boutons, c=Calendriers, p=Pop-up, f=Champs (texte, fond, opacité, bordure, épaisseur, radius, ombre)
for(const x of'gbcpf'){add('hex',`${x}Fg ${x}Bg ${x}Bc`);add('num',`${x}Bo`,0,100);add('num',`${x}Bw`,0,6);add('num',`${x}Br`,0,30);add('num',`${x}Sh`,0,40)}
add('num','evSh',0,40);   // ombres : taille en px (0 = aucune)
add('enum','startView',['month','year','bday']);
add('text','bdayCal',500);   // calendrier des anniversaires
add('bool','bdayMonth bdayYear');   // anniversaires affichés dans les vues Mois / Année
add('text','extAllow',500);
add('bool','srT srL srD srF srP srK');   // srK : tâches datées (Deck compris)   // recherche : dans les titres / lieux / descriptions ; évènements futurs / passés
add('text','toolsName',40);add('bool','toolsCal toolsDeck toolsTasks');   // volet > Outils : nom de la catégorie, liens Nextcloud affichés (liens personnalisés : « links », voir clean)
add('hex','dayC1 dayC2 dayC3');   // couleurs personnalisées des jours (Apparence > Couleur des jours)   // calendriers externes : adresses du réseau local autorisées (voir safeGet)
add('text','defCal',500);   // calendrier par défaut (création d'évènement)
add('enum','abbr',['always','mobile','never']);   // noms des jours abrégés (vue Mois)
add('hex','ldFg');   // couleur du texte de l'écran de chargement
add('text','theme themeEdit themeFrame themeEditFrame',40);add('text','lang',12);add('bool','setAdv');   // langue choisie (code d'un fichier texts_<CODE>.json) · Apparence : paramètres avancés affichés   // thème choisi (id de /data/themes/<id>.json ; « defaut » = Par défaut)
for(const[k,lo,hi]of[['fontSize',11,20],['dens',0,12],['maxEv',1,10],['weekGap',0,30],['calPad',0,30],['calPadM',0,30],['hdRadius',0,24],['evRadius',0,16],['evPad',0,10],['popPad',4,40],['evDur',5,240],
  ['sizeTitle',16,60],['sizeSub',9,24],['sizeHead',9,24],['muteOp',10,100],['recOp',10,100],['grpOp',0,100],['bubR',0,30],['shadowOp',0,100],['popOp',0,100],['blur',0,20],['evLum',-100,100],['dotLum',-100,100],['dotSize',40,100],['fabSize',60,200],
  ['hdBp',500,2000],['extOp',0,100],['minM',0,10],['minA',0,10],['minS',0,10],['sepOp',0,100],['sepW',0,4]])add('num',k,lo,hi);
const clean=o=>{o=o&&typeof o==='object'?{...o}:{};
  // Conversion unique (26/10/2026, à retirer plus tard) : ombres « case à cocher » -> taille en px (cochée = ancienne « Taille des ombres », 12 par défaut)
  for(const k of['gSh','bSh','cSh','pSh','fSh','evSh'])if(typeof o[k]==='boolean')o[k]=o[k]?(typeof o.shadowSize==='number'?o.shadowSize:12):0;
  const r={},hex=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v);
  for(const[k,[t,lo,hi]]of Object.entries(SCHEMA)){const v=o[k];
    if(t==='hex'&&hex(v))r[k]=v;else if(t==='num'&&typeof v==='number'&&v>=lo&&v<=hi)r[k]=v;else if(t==='bool'&&typeof v==='boolean')r[k]=v;
    else if(t==='enum'&&lo.includes(v))r[k]=v;
    else if(t==='time'&&typeof v==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v))r[k]=v;
    else if(t==='text'&&typeof v==='string')r[k]=v.slice(0,lo);else if(t==='font'&&typeof v==='string'&&fonts().includes(v))r[k]=v}
  for(const k of['wd','wdf'])if(Array.isArray(o[k])&&o[k].length===7)r[k]=o[k].map(v=>hex(v)?v:'');
  const strs=(k,n,ok)=>{if(Array.isArray(o[k]))r[k]=o[k].filter(x=>typeof x==='string'&&x.length<n&&(!ok||ok.includes(x))).slice(0,200)};
  strs('hidden',500);strs('collapsed',10,['cal','tasks','tools']);strs('setOpen',20);
  // liens personnalisés du menu Outils : [{t: intitulé, u: adresse http(s)}], 10 au plus (jamais javascript:, data:…)
  if(Array.isArray(o.links))r.links=o.links.filter(x=>x&&typeof x.t==='string'&&typeof x.u==='string'&&x.t.trim()&&linkOk(x.u)).slice(0,10).map(x=>({t:x.t.replace(/[\x00-\x1f]/g,'').trim().slice(0,60),u:x.u.trim().slice(0,500)}));
  return r};
const linkOk=u=>{try{const x=new URL(String(u).trim());return/^https?:$/.test(x.protocol)&&String(u).length<=500}catch{return false}};
const rd=f=>clean(rj(f,{}));   // réglages validés (fichier lu une fois tant qu'il ne change pas)

// Calendriers externes (jours fériés "hol", vacances "vac") : téléchargés par le serveur dans /data (ext-hol.ics + ext-hol.json)
// Garde-fous (le serveur fait la requête) : http(s) uniquement, 5 Mo maximum, 15 s maximum
const EXT_MAX=5*1024*1024,EXT_EVMAX=20000;
// Lecture d'un fichier JSON de /data, gardée en mémoire tant que le fichier ne change pas (sessions, blocage, thèmes… lus à chaque requête)
// wa() écrit dans un fichier temporaire puis le renomme, et oublie la copie en mémoire
const RJ=new Map();
const rj=(f,d)=>{let st;try{st=fs.statSync(f)}catch{RJ.delete(f);return d}const c=RJ.get(f),k=st.mtimeMs+':'+st.size;
  if(c&&c.k===k)return structuredClone(c.v);try{const v=JSON.parse(fs.readFileSync(f,'utf8'));RJ.set(f,{k,v});return structuredClone(v)}catch{return d}};
const wa=(f,d)=>{fs.writeFileSync(f+'.tmp',d);fs.renameSync(f+'.tmp',f);RJ.delete(f)};
const extMeta=k=>rj(path.join(DATA_DIR,`ext-${k}.json`),null);

/* ----- Textes affichés et langues -----
   Un fichier par langue : texts_<CODE>.json (ex. texts_FR.json, texts_EN.json). Deux dossiers : texts/ (fourni avec l'application) et
   TEXTS_DIR (/texts, monté par docker compose) où l'on peut ajouter une langue (texts_DE.json…) ou corriger quelques textes
   (texts_<CODE>.perso.json : seulement les clés modifiées). Ordre : français (secours pour une clé absente) < texts/ < /texts < .perso.
   Une clé = un texte ; {nom} = valeur insérée ; « lang.name » = nom de la langue dans la liste ; « locale » = format des dates (fr-FR, en-GB…).
   Relus quand un fichier change (pas besoin de redémarrer). Les logs restent en français dans le code. */
const TXA=path.join(__dirname,'texts'),TXU=process.env.TEXTS_DIR||'/texts',LANG_RE=/^texts_([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})?)\.json$/;
const txObj=o=>Object.fromEntries(Object.entries(o&&typeof o==='object'?o:{}).filter(([k,v])=>!k.startsWith('_')&&typeof v==='string'));
const langs=()=>{const m=new Map();for(const d of[TXA,TXU]){let f=[];try{f=fs.readdirSync(d)}catch{}for(const x of f){const c=x.match(LANG_RE)?.[1];if(c&&!m.has(c.toUpperCase()))m.set(c.toUpperCase(),c)}}
  return[...m.values()].map(c=>({code:c.toUpperCase(),name:String(txFor(c)['lang.name']||c.toUpperCase())})).sort((a,b)=>a.name.localeCompare(b.name))};
const txMemo=new Map();   // langue -> {k: dates et tailles des fichiers, v: textes fusionnés} (refusionnés seulement si un fichier change)
const txFor=code=>{const c=String(code||'FR'),fl=[path.join(TXA,'texts_FR.json'),...[TXA,TXU].map(d=>path.join(d,`texts_${c}.json`)),path.join(TXU,`texts_${c}.perso.json`)];
  const k=fl.map(f=>{try{const st=fs.statSync(f);return st.mtimeMs+':'+st.size}catch{return'-'}}).join('|'),m=txMemo.get(c);if(m&&m.k===k)return m.v;
  const v=Object.assign({},...fl.map(f=>txObj(rj(f,{}))));txMemo.set(c,{k,v});return v};
// langue : celle choisie (Paramètres généraux) ; pas encore choisie : celle du navigateur si elle existe (Accept-Language), sinon le français
let langGuess='FR';
const langOf=req=>{const l=langs(),has=c=>l.find(x=>x.code===String(c||'').toUpperCase())?.code,g=rd(sf).lang;if(has(g))return has(g);
  if(req){for(const p of String(req.headers['accept-language']||'').split(',')){const c=p.split(';')[0].trim();const x=has(c)||has(c.split('-')[0]);if(x){langGuess=x;return x}}langGuess=has('FR')||l[0]?.code||'FR'}
  return has(langGuess)||'FR'};
const TXT=req=>txFor(langOf(req));
const TX=(k,v={})=>String(TXT()[k]??k).replace(/\{(\w+)\}/g,(m,n)=>v[n]!=null?v[n]:m);

/* ----- Téléchargement sûr (anti-SSRF) -----
   Le serveur ne contacte que des adresses publiques : réseau local, loopback, réseau Docker, Tailscale, link-local… sont refusés,
   sauf les « Adresses autorisées » (Paramètres > Calendriers externes : noms, adresses ou plages CIDR, séparés par des virgules ; *.domaine accepté).
   Le contrôle porte sur l'adresse réellement connectée (fonction lookup) : un nom qui change d'adresse entre deux résolutions ne passe pas.
   Redirections suivies à la main (5 au plus), chacune contrôlée. 15 s et 5 Mo au plus. */
const ip4n=a=>a.split('.').reduce((n,x)=>n*256+(+x),0);
const ip6g=a=>{a=a.toLowerCase().replace(/%.*$/,'');const m=a.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);if(m){const n=ip4n(m[2]);a=m[1]+Math.floor(n/65536).toString(16)+':'+(n%65536).toString(16)}
  const[h,t]=a.split('::'),hs=h?h.split(':'):[],ts=t===undefined?[]:t?t.split(':'):[],z=t===undefined?[]:Array(Math.max(0,8-hs.length-ts.length)).fill('0');
  return[...hs,...z,...ts].map(x=>parseInt(x||'0',16))};
// ip dans la plage « adresse/bits » (même famille)
function inCidr(ip,c){const[a,b]=c.split('/'),bits=+b;if(!net.isIP(a)||!(bits>=0))return false;
  if(net.isIPv4(ip)&&net.isIPv4(a)){if(!bits)return true;if(bits>32)return false;const s=32-bits;return Math.floor(ip4n(ip)/2**s)===Math.floor(ip4n(a)/2**s)}
  if(net.isIPv6(ip)&&net.isIPv6(a)){const x=ip6g(ip),y=ip6g(a);for(let i=0,r=bits;i<8&&r>0;i++,r-=16){const m=r>=16?65535:(65535<<(16-r))&65535;if((x[i]&m)!==(y[i]&m))return false}return true}
  return false}
const PRIV4=['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16','172.16.0.0/12','192.0.0.0/24','192.168.0.0/16','198.18.0.0/15','224.0.0.0/4','240.0.0.0/4'];
const PRIV6=['::/127','fc00::/7','fe80::/10','ff00::/8'];
// adresse non publique (IPv4 « mappée » en IPv6 comprise)
function isPriv(ip){ip=String(ip||'').replace(/^\[|\]$/g,'');if(net.isIPv4(ip))return PRIV4.some(c=>inCidr(ip,c));if(!net.isIPv6(ip))return true;
  const g=ip6g(ip);if(g.slice(0,5).every(x=>!x)&&g[5]===65535)return isPriv(`${g[6]>>8}.${g[6]&255}.${g[7]>>8}.${g[7]&255}`);return PRIV6.some(c=>inCidr(ip,c))}
const sameIp=(a,b)=>net.isIPv4(a)&&net.isIPv4(b)?a===b:net.isIPv6(a)&&net.isIPv6(b)&&ip6g(a).join()===ip6g(b).join();
function safeGet(u0){const allow=String(rd(sf).extAllow||'').split(/[,\s]+/).map(x=>x.trim().toLowerCase()).filter(Boolean),end=Date.now()+15000;
  const hostOk=h=>allow.some(a=>a===h||a.startsWith('*.')&&h.endsWith(a.slice(1)));
  const ipOk=(h,ip)=>!isPriv(ip)||hostOk(h)||allow.some(a=>a.includes('/')?inCidr(ip,a):sameIp(a,ip));
  const blocked=()=>Object.assign(new Error('adresse non autorisée'),{code:'EBLOCKED'});
  const once=(url,hop)=>new Promise((ok,ko)=>{let done=false;const fin=(f,v)=>{if(!done){done=true;clearTimeout(tm);f(v)}};
    if(!/^https?:$/.test(url.protocol))return ko(new Error(TX('srv.httpOnly')));
    const h=url.hostname.replace(/^\[|\]$/g,'').toLowerCase();if(net.isIP(h)&&!ipOk(h,h))return ko(blocked());   // adresse écrite en clair : pas de résolution DNS
    const lookup=(host,o,cb)=>dns.lookup(host,{...o,all:true},(e,l)=>{if(e)return cb(e);if(!l.length)return cb(Object.assign(new Error('introuvable'),{code:'ENOTFOUND'}));
      if(l.some(a=>!ipOk(h,a.address)))return cb(blocked());o.all?cb(null,l):cb(null,l[0].address,l[0].family)});
    const req=(url.protocol==='https:'?https:http).get(url,{lookup,headers:{Accept:'text/calendar,*/*','Accept-Encoding':'identity','User-Agent':'Jolical'}},res=>{const c=res.statusCode;
      if(c>=300&&c<400&&res.headers.location){res.resume();if(hop>=5)return fin(ko,new Error(TX('srv.redirects')));let n;try{n=new URL(res.headers.location,url)}catch{return fin(ko,new Error(TX('srv.badRedirect')))}
        done=true;clearTimeout(tm);return once(n,hop+1).then(ok,ko)}
      if(c<200||c>=300){res.resume();return fin(ko,new Error(TX('srv.status',{n:c})))}
      if(+res.headers['content-length']>EXT_MAX){res.destroy();return fin(ko,new Error(TX('srv.tooBig')))}
      const parts=[];let n=0;res.on('data',d=>{n+=d.length;if(n>EXT_MAX){res.destroy();fin(ko,new Error(TX('srv.tooBig')))}else parts.push(d)});
      res.on('end',()=>fin(ok,Buffer.concat(parts)));res.on('error',e=>fin(ko,e));res.on('aborted',()=>fin(ko,new Error(TX('srv.cut'))))});
    const tm=setTimeout(()=>{req.destroy();fin(ko,Object.assign(new Error('délai'),{name:'TimeoutError'}))},Math.max(1,end-Date.now()));req.on('error',e=>fin(ko,e))});
  return once(u0,0)}
async function fetchIcs(u){let url;try{url=new URL(u)}catch{throw new Error(TX('srv.badUrl'))}
  return(await safeGet(url)).toString('utf8').replace(/^﻿/,'')}
// Vérifie que le fichier est un ICS exploitable : VCALENDAR + au moins un VEVENT avec une date de début lisible ; 20 000 évènements au plus
function checkIcs(t){const u=t.replace(/\r?\n[ \t]/g,'');
  if(!/^BEGIN:VCALENDAR\s*$/m.test(u))throw new Error(TX('srv.notIcs'));
  const bl=u.split(/^BEGIN:VEVENT\s*$/m).slice(1);if(bl.length>EXT_EVMAX)throw new Error(TX('srv.tooMany'));
  let n=0,from='',to='';
  for(const b of bl){const m=b.match(/^DTSTART[^:\r\n]*:(\d{8})/m);if(!m)continue;n++;if(!from||m[1]<from)from=m[1];if(!to||m[1]>to)to=m[1]}
  if(!n)throw new Error(TX('srv.noEvent'));
  const name=((u.match(/^X-WR-CALNAME:(.*)$/m)||[])[1]||'').replace(/\\([,;\\])/g,'$1').trim().slice(0,100);
  return{n,from,to,name}}
// Jours fériés / vacances : [{s:'AAAAMMJJ', e:'AAAAMMJJ' (exclu), t:titre}], lus avec le même lecteur que les calendriers ajoutés
// (récurrences, exclusions, durées, annulations) sur une fenêtre de −3 à +4 ans ; règles propres : évènements « enseignants » (prérentrée) ignorés,
// fin absente ou <= début : 1 seul jour, évènement à heure : jours touchés (heure du conteneur)
function extList(k){const ev=icsGet(extFile(k,'ics'));if(!ev)return[];
  const now=Date.now(),day=864e5,ymdL=ms=>{const d=new Date(ms);return d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0')},out=[],seen=new Set();
  for(const{e,o}of expandAll(ev,now-3*365*day,now+4*365*day,{n:4e5})){const t=unesc(e.SUMMARY?.v).trim();if(/enseignant/i.test(t+' '+unesc(e.DESCRIPTION?.v)))continue;
    const s=o.all?ymdOf(o.s):ymdL(o.s);let en=o.all?ymdOf(o.e):ymdL(Math.max(o.s,o.e-1));
    if(!o.all){const d=new Date(+en.slice(0,4),+en.slice(4,6)-1,+en.slice(6,8)+1);en=ymdL(+d)}
    if(en<=s){const d=new Date(Date.UTC(+s.slice(0,4),+s.slice(4,6)-1,+s.slice(6,8)+1));en=ymdOf(+d)}
    const id=s+en+t;if(!seen.has(id)){seen.add(id);out.push({s,e:en,t})}}
  return out.sort((a,b)=>a.s<b.s?-1:a.s>b.s?1:0)}
// Téléchargement + vérification + écriture (ext-hol.ics / ext-hol.json) ; renvoie les métadonnées
const extFile=(k,x)=>path.join(DATA_DIR,`ext-${k}.${x}`);
async function extDownload(k,url){const txt=await fetchIcs(url),meta={url,date:new Date().toISOString(),...checkIcs(txt)};
  wa(extFile(k,'ics'),txt);wa(extFile(k,'json'),JSON.stringify(meta));return meta}

/* ===== CALENDRIERS EXTERNES AJOUTÉS (Paramètres > Calendriers externes > « Calendrier(s) externe(s) ») =====
   Liste dans /data/extcals.json : [{id, url, name (vide = nom du fichier), color}] ; fichiers ext-c-<id>.ics / .json (même téléchargement,
   mêmes garde-fous et même mise à jour automatique que les jours fériés). Affichés en lecture seule ; récurrences développées ici. */
const XC_FILE=path.join(DATA_DIR,'extcals.json'),XC_MAX=10,XC_COL=['#8e44ad','#16a085','#d35400','#2980b9','#c0392b','#27ae60','#f39c12','#2c3e50','#e84393','#00897b'];
const xcList=()=>{const l=rj(XC_FILE,[]);return Array.isArray(l)?l.filter(x=>x&&/^[a-f0-9]{8}$/.test(x.id)):[]};
const xcSave=l=>wa(XC_FILE,JSON.stringify(l));
const XC_EVERY=['hour','h12','day','week','quarter','year','never'];
const xcView=x=>{const m=extMeta('c-'+x.id)||{},ev=x.every||'quarter';return{id:x.id,url:x.url,every:ev,name:x.name||m.name||(()=>{try{return new URL(x.url).hostname}catch{return TX('ext.fallback')}})(),own:!!x.name,color:x.color,meta:m.date?extView(m,ev):null}};
const xcColor=v=>typeof v==='string'&&/^#[0-9a-f]{6}$/i.test(v)?v:null;

/* ----- Lecture complète d'un fichier .ics : évènements, fuseaux horaires, récurrences (RRULE courantes, EXDATE, RDATE, exceptions RECURRENCE-ID) ----- */
const TZF=new Map(),WINTZ={'Romance Standard Time':'Europe/Paris','W. Europe Standard Time':'Europe/Berlin','Central Europe Standard Time':'Europe/Budapest','GMT Standard Time':'Europe/London','UTC':'UTC','Eastern Standard Time':'America/New_York','Pacific Standard Time':'America/Los_Angeles'};
const tzOff=(z,ms)=>{let f=TZF.get(z);if(f===undefined){try{f=new Intl.DateTimeFormat('en-US',{timeZone:z,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}catch{f=null}TZF.set(z,f)}
  if(!f)return null;const p=Object.fromEntries(f.formatToParts(new Date(ms)).map(x=>[x.type,x.value]));return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour%24,+p.minute,+p.second)-ms};
const tzOf=t=>{if(!t)return'';if(WINTZ[t])return WINTZ[t];const m=t.match(/[A-Za-z]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?$/);return m&&tzOff(m[0],0)!==null?m[0]:''};
// heure « murale » dans un fuseau -> instant UTC (ms) ; fuseau inconnu ou heure flottante : heure locale du serveur (TZ du conteneur)
function wallUtc(y,mo,d,h,mi,s,z){if(z==='UTC')return Date.UTC(y,mo,d,h,mi,s);if(!z)return new Date(y,mo,d,h,mi,s).getTime();
  const g=Date.UTC(y,mo,d,h,mi,s);let u=g-tzOff(z,g);const o2=tzOff(z,u);return g-o2}
// valeur de date ICS -> {all, y, mo, d, h, mi, s, z}
function icsDt(x){if(!x)return null;const v=x.v.trim(),m=v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);if(!m)return null;
  const all=x.p.VALUE==='DATE'||!m[4];return{all,y:+m[1],mo:+m[2]-1,d:+m[3],h:all?0:+m[4],mi:all?0:+m[5],s:all?0:+m[6],z:m[7]?'UTC':tzOf(x.p.TZID)}}
const dtMs=t=>t.all?Date.UTC(t.y,t.mo,t.d):wallUtc(t.y,t.mo,t.d,t.h,t.mi,t.s,t.z);
const ymdOf=ms=>new Date(ms).toISOString().slice(0,10).replace(/-/g,'');
function icsParse(raw,comp='VEVENT'){const out=[];let cur=null,depth=0;   // comp : VEVENT (évènements) ou VTODO (tâches, recherche)
  for(const l of raw.replace(/\r?\n[ \t]/g,'').split(/\r?\n/)){
    if(l==='BEGIN:'+comp){cur={};depth=0;continue}if(!cur)continue;if(l==='END:'+comp){out.push(cur);cur=null;continue}
    if(l.startsWith('BEGIN:')){depth++;continue}if(l.startsWith('END:')){depth--;continue}if(depth)continue;
    const i=l.indexOf(':');if(i<0)continue;const[n,...ps]=l.slice(0,i).split(';'),p={};for(const q of ps){const j=q.indexOf('=');if(j>0)p[q.slice(0,j).toUpperCase()]=q.slice(j+1).replace(/^"|"$/g,'')}
    const k=n.toUpperCase(),v=l.slice(i+1);if(k==='EXDATE'||k==='RDATE')(cur[k]=cur[k]||[]).push(...v.split(',').map(x=>({v:x,p})));else if(!(k in cur))cur[k]={v,p}}
  return out}
const unesc=s=>String(s||'').replace(/\\n/gi,'\n').replace(/\\([,;\\])/g,'$1');
const WD=['SU','MO','TU','WE','TH','FR','SA'];
// jours d'un mois répondant à BYDAY (« MO », « 2MO », « -1FR ») ou BYMONTHDAY (« 15 », « -1 »)
function monthDays(y,mo,r,d0){const n=new Date(Date.UTC(y,mo+1,0)).getUTCDate();let ds=[];
  if(r.BYMONTHDAY)ds=r.BYMONTHDAY.map(x=>x<0?n+1+x:x).filter(x=>x>=1&&x<=n);
  else if(r.BYDAY){for(const b of r.BYDAY){const m=b.match(/^([+-]?\d+)?([A-Z]{2})$/);if(!m)continue;const w=WD.indexOf(m[2]),all=[];for(let d=1;d<=n;d++)if(new Date(Date.UTC(y,mo,d)).getUTCDay()===w)all.push(d);
    if(m[1]){const k=+m[1],x=k>0?all[k-1]:all[all.length+k];if(x)ds.push(x)}else ds.push(...all)}}
  else if(d0<=n)ds=[d0];
  ds=[...new Set(ds)].sort((a,b)=>a-b);if(r.BYSETPOS)ds=r.BYSETPOS.map(k=>k>0?ds[k-1]:ds[ds.length+k]).filter(Boolean).sort((a,b)=>a-b);return ds}
// jours d'une année répondant à BYDAY avec rang (« 20MO » = 20e lundi de l'année, « -1FR » = dernier vendredi), sans BYMONTH ni BYMONTHDAY
function yearDays(y,r){const all=[];for(let d=new Date(Date.UTC(y,0,1));d.getUTCFullYear()===y;d.setUTCDate(d.getUTCDate()+1))all.push([d.getUTCMonth(),d.getUTCDate(),d.getUTCDay()]);
  let ds=[];for(const b of r.BYDAY){const m=String(b).match(/^([+-]?\d+)?([A-Z]{2})$/);if(!m)continue;const l=all.filter(x=>x[2]===WD.indexOf(m[2]));
    if(m[1]){const k=+m[1],x=k>0?l[k-1]:l[l.length+k];if(x)ds.push(x)}else ds.push(...l)}
  ds=[...new Map(ds.map(x=>[x[0]*100+x[1],x])).values()].sort((a,b)=>a[0]*100+a[1]-(b[0]*100+b[1]));
  if(r.BYSETPOS)ds=r.BYSETPOS.map(k=>k>0?ds[k-1]:ds[ds.length+k]).filter(Boolean);return ds.map(x=>[y,x[0],x[1]])}
// occurrences (dates « murales » y/mo/d) d'une règle, dans l'ordre, jusqu'à la limite de la règle.
// from (instant) : sans COUNT, on part directement de la période voulue (moins la durée « back », en jours) au lieu de tout parcourir depuis le début de la série ;
// bud = budget d'itérations partagé par toute la requête (un fichier piégé ne peut pas bloquer le serveur)
function* ruleDates(t0,r,from,back=0,bud){const iv=Math.max(1,+r.INTERVAL||1),F=r.FREQ;let k=0,guard=0;
  if(from!=null&&!r.COUNT){const f=new Date(from-back*864e5-864e5),dd=(f-Date.UTC(t0.y,t0.mo,t0.d))/864e5,md=(f.getUTCFullYear()-t0.y)*12+f.getUTCMonth()-t0.mo;
    k=Math.max(0,Math.floor(({DAILY:dd/iv,WEEKLY:dd/7/iv,MONTHLY:md/iv,YEARLY:md/12/iv}[F]||0))-1)}
  while(guard++<20000){if(bud&&--bud.n<0)return;let c=[];
    if(F==='DAILY'){const d=new Date(Date.UTC(t0.y,t0.mo,t0.d+k*iv));c=[[d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()]];
      c=c.filter(([y,mo,d])=>(!r.BYMONTH||r.BYMONTH.includes(mo+1))&&(!r.BYMONTHDAY||r.BYMONTHDAY.includes(d))&&(!r.BYDAY||r.BYDAY.some(b=>b.endsWith(WD[new Date(Date.UTC(y,mo,d)).getUTCDay()]))))}
    else if(F==='WEEKLY'){const ws=WD.indexOf(r.WKST||'MO'),b0=new Date(Date.UTC(t0.y,t0.mo,t0.d)),off=(b0.getUTCDay()-ws+7)%7,st=Date.UTC(t0.y,t0.mo,t0.d-off+k*7*iv);
      const days=r.BYDAY?r.BYDAY.map(b=>WD.indexOf(b.slice(-2))):[b0.getUTCDay()];
      for(let i=0;i<7;i++){const d=new Date(st+i*864e5);if(days.includes(d.getUTCDay())&&(!r.BYMONTH||r.BYMONTH.includes(d.getUTCMonth()+1)))c.push([d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()])}}
    else if(F==='MONTHLY'){const m=new Date(Date.UTC(t0.y,t0.mo+k*iv,1)),y=m.getUTCFullYear(),mo=m.getUTCMonth();if(!r.BYMONTH||r.BYMONTH.includes(mo+1))c=monthDays(y,mo,r,t0.d).map(d=>[y,mo,d])}
    else if(F==='YEARLY'){const y=t0.y+k*iv,ms=r.BYMONTH?r.BYMONTH.map(x=>x-1):r.BYDAY&&!r.BYMONTHDAY?[...Array(12).keys()]:[t0.mo];
      if(r.BYDAY&&!r.BYMONTH&&!r.BYMONTHDAY&&r.BYDAY.some(b=>/^[+-]?\d/.test(String(b))))c=yearDays(y,r);   // rang dans l'année (pas dans chaque mois)
      else for(const mo of ms)c.push(...monthDays(y,mo,{...r,BYSETPOS:null},t0.d).map(d=>[y,mo,d]))}
    else return;
    for(const x of c)yield x;k++}}
// occurrences d'un évènement qui touchent [from, to[ : [{s, e, all}] (s/e en ms ; journée entière : minuit UTC, fin exclue)
function occurrences(ev,from,to,ovr,bud){const t0=icsDt(ev.DTSTART);if(!t0)return[];const s0=dtMs(t0);
  let dur;const te=icsDt(ev.DTEND);if(te)dur=dtMs(te)-s0;else{const m=(ev.DURATION?.v||'').match(/P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/);dur=m&&m[0].length>1?((+m[1]||0)*7*864e5+(+m[2]||0)*864e5+(+m[3]||0)*36e5+(+m[4]||0)*6e4+(+m[5]||0)*1e3):t0.all?864e5:0}
  if(t0.all&&dur<864e5)dur=864e5;
  const ex=new Set((ev.EXDATE||[]).map(x=>{const t=icsDt(x);return t&&(t.all?ymdOf(dtMs(t)):dtMs(t))})),key=ms=>t0.all?ymdOf(ms):ms,out=[];
  const add=s=>{if(ex.has(key(s))||ovr?.has(key(s)))return;if(s<to&&s+Math.max(dur,1)>from)out.push({s,e:s+dur,all:t0.all})};
  if(!ev.RRULE){add(s0);for(const x of ev.RDATE||[]){const t=icsDt(x);if(t)add(dtMs(t))}return out}
  const r={};for(const p of ev.RRULE.v.split(';')){const[a,b]=p.split('=');if(a&&b)r[a.toUpperCase()]=['BYDAY','BYMONTH','BYMONTHDAY','BYSETPOS'].includes(a.toUpperCase())?b.split(',').map(x=>/^[+-]?\d+$/.test(x)?+x:x.toUpperCase()):b}
  const ut=r.UNTIL&&icsDt({v:r.UNTIL,p:{}}),until=ut?dtMs(ut)+(ut.all?864e5-1:0):Infinity,count=+r.COUNT||Infinity;let n=0;
  for(const[y,mo,d]of ruleDates(t0,r,from,Math.ceil(Math.max(dur,0)/864e5),bud)){const s=t0.all?Date.UTC(y,mo,d):wallUtc(y,mo,d,t0.h,t0.mi,t0.s,t0.z);if(s<s0)continue;if(s>until||n>=count||s>=to)break;n++;add(s)}
  for(const x of ev.RDATE||[]){const t=icsDt(x);if(t)add(dtMs(t))}
  return out}
const ICSC=new Map();   // fichiers .ics lus une seule fois tant qu'ils ne changent pas
function icsGet(f){let st;try{st=fs.statSync(f)}catch{ICSC.delete(f);return null}
  let c=ICSC.get(f);if(!c||c.m!==st.mtimeMs){c={m:st.mtimeMs,ev:icsParse(fs.readFileSync(f,'utf8'))};ICSC.set(f,c)}return c.ev}
// toutes les occurrences [{e, o}] d'une liste de VEVENT sur [from, to[ (exceptions RECURRENCE-ID et annulations prises en compte) ; bud = budget d'itérations
function expandAll(evs,from,to,bud){const ovr=new Map(),out=[];
  for(const e of evs)if(e['RECURRENCE-ID']&&e.UID){const t=icsDt(e['RECURRENCE-ID']);if(t){if(!ovr.has(e.UID.v))ovr.set(e.UID.v,new Set());ovr.get(e.UID.v).add(t.all?ymdOf(dtMs(t)):dtMs(t))}}
  for(const e of evs){if(e.STATUS?.v==='CANCELLED')continue;for(const o of occurrences(e,from,to,e['RECURRENCE-ID']?null:ovr.get(e.UID?.v),bud))out.push({e,o});if(out.length>2e4||bud.n<0)break}
  if(bud.n<0)log('warn','calendrier externe : trop de répétitions, lecture arrêtée');return out}
function xcEvents(id,from,to,bud){const ev=icsGet(extFile('c-'+id,'ics'));if(!ev)return[];
  return expandAll(ev,from,to,bud).map(({e,o})=>({c:id,t:unesc(e.SUMMARY?.v),l:unesc(e.LOCATION?.v)||undefined,d:unesc(e.DESCRIPTION?.v)||undefined,st:e.STATUS?.v||undefined,a:o.all||undefined,
      s:o.all?ymdOf(o.s):new Date(o.s).toISOString(),e:o.all?ymdOf(o.e):new Date(o.e).toISOString()}))}

// Mise à jour automatique : fériés / vacances selon « extEvery » (trimestre par défaut), calendriers ajoutés selon leur propre fréquence.
// Vérifiée 10 s après le démarrage puis toutes les 5 minutes (une échéance passée de moins de 2 min compte comme atteinte : « toutes les heures » = vraiment toutes les heures).
// Échec : l'ancien fichier reste utilisé, l'erreur est notée dans le .json (err, errDate) ; nouvel essai après la moitié de la période (entre 30 min et 24 h).
// La date de la prochaine mise à jour est calculée ici seulement (« next », envoyé au navigateur avec les métadonnées).
const PER={hour:[0,0,1],h12:[0,0,12],day:[0,1],week:[0,7],month:[1,0],quarter:[3,0],semester:[6,0],year:[12,0]};   // [mois, jours, heures]
const nextUpd=(m,every)=>{const p=PER[every];if(!p||!m||!m.date)return null;const d=new Date(m.date);d.setUTCMonth(d.getUTCMonth()+p[0]);d.setUTCDate(d.getUTCDate()+p[1]);d.setUTCHours(d.getUTCHours()+(p[2]||0));return d};
const retryMs=every=>{const p=PER[every]||[3,0];return Math.min(864e5,Math.max(18e5,((p[0]*30+p[1])*864e5+(p[2]||0)*36e5)/2))};
const extDue=(m,every)=>{const nx=nextUpd(m,every);return!nx?null:m.errDate?new Date(Math.max(+nx,+new Date(m.errDate)+retryMs(every))):nx};   // après un échec : nouvel essai décalé
// métadonnées envoyées au navigateur (avec la prochaine mise à jour)
const extView=(m,every)=>m&&m.date?{url:m.url,date:m.date,n:m.n,from:m.from,to:m.to,name:m.name,err:m.err,errDate:m.errDate,next:extDue(m,every)?.toISOString()||null}:m;
let extBusy=false;
async function extAuto(){if(extBusy)return;extBusy=true;try{const every=rd(sf).extEvery||'quarter',xe=Object.fromEntries(xcList().map(x=>['c-'+x.id,x.every||'quarter']));   // calendriers ajoutés : leur propre fréquence
  for(const k of['hol','vac',...Object.keys(xe)]){const m=extMeta(k),ev=xe[k]||every,nx=nextUpd(m,ev);if(!m||!m.url||!nx||Date.now()<+nx-12e4)continue;
    if(m.errDate&&Date.now()-new Date(m.errDate)<retryMs(ev))continue;
    try{const n=await extDownload(k,m.url);log('info','calendrier externe mis à jour automatiquement',{type:k,n:n.n})}
    catch(e){const err=extErr(e);wa(extFile(k,'json'),JSON.stringify({...m,err,errDate:new Date().toISOString()}));log('warn','mise à jour automatique du calendrier externe : échec',{type:k,url:m.url,err})}}}
  finally{extBusy=false}}
// Messages d'erreur simples (sans code réseau, qui permettrait de cartographier le réseau local)
const extErr=e=>e.name==='TimeoutError'||e.name==='AbortError'?TX('srv.timeout'):e.code==='EBLOCKED'?TX('srv.blocked'):
  e.code==='ENOTFOUND'||e.code==='EAI_AGAIN'?TX('srv.noDns'):e.code&&/^E[A-Z]+$/.test(e.code)||/^(certificate|unable to verify|self.signed)/i.test(e.message)?TX(/cert/i.test(e.code+e.message)?'srv.cert':'srv.unreach'):e.message;

// Écran de chargement : fond, couleur et police du titre, titre de l'agenda, calculés ici depuis les réglages (connecté : tous ; sinon : apparence publique)
// pour que le tout premier affichage ait déjà les bonnes couleurs (app.js n'applique le thème qu'après avoir chargé les réglages)
const escH=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
function preHtml(s,pub,req){const html=fs.readFileSync(path.join(__dirname,'index.html'),'utf8'),lum=h=>{const n=parseInt(h.slice(1),16);return((n>>16)*299+((n>>8&255)*587)+(n&255)*114)/1000};
  const v=[],f=s.fontTitle&&fonts().includes(s.fontTitle)?s.fontTitle:'';   // seulement ce qui est réglé : sinon les valeurs par défaut du CSS (thème sombre du système compris)
  if(s.bg)v.push('--bg:'+s.bg,'--fg:'+(lum(s.bg)>140?'#1c2025':'#e6e8eb'));if(s.colText)v.push('--fg:'+s.colText);if(s.ldBg)v.push('--ldbg:'+s.ldBg);
  if(s.ldFg||s.colTitle)v.push('--ldc:'+(s.ldFg||s.colTitle));else if(s.ldBg)v.push('--ldc:'+(lum(s.ldBg)>140?'#1c2025':'#e6e8eb'));   // titre lisible sur le fond de l'écran de chargement
  if(f)v.push('--ldf:"ldf"');
  const css=(f?`@font-face{font-family:"ldf";src:url(/fonts/${encodeURIComponent(f)})}`:'')+`:root{${v.join(';')}}`;
  // écran de chargement : titre de l'agenda, sinon « Chargement… » (sans session, s n'a pas de titre : rien de personnel avant le mot de passe)
  const L=langOf(req),X=TXT(req),t=escH(s.title||X['load.title']||'…'),tx=JSON.stringify({...X,'@lang':L,'@langs':langs(),'@langSet':!!rd(sf).lang}).replace(/</g,'\\u003c');
  return html.replace(/<html lang="[^"]*">/,`<html lang="${escH((X.locale||'fr').split('-')[0])}">`).replace(/\{\{([\w.]+)\}\}/g,(m,k)=>escH(X[k]??k))   // textes fixes de la page
    .replace('<!--TEXTS-->',`<script type="application/json" id="tx">${tx}</script>`)   // textes de app.js (données, jamais exécutées : autorisé par la CSP)
    .replace('<meta name="theme-color" content="#32ad95">',`<meta name="theme-color" content="${s.bg||'#32ad95'}">`)   // barre du navigateur / de l'application installée : fond de la page s'il est réglé
    .replace('<!--PRE-->',`<style id="pre">${css}</style>`).replace('<b id="ldt"></b>',`<b id="ldt">${t}</b>`).replace('<!--TITLE-->',pub?escH(X['login.title']||''):escH(s.title||X['app.defaultTitle']||''))}

/* ===== CONNEXION : mot de passe seul, appareils autorisés, blocage progressif par adresse =====
   Mot de passe : comparé à son empreinte scrypt (lente exprès : environ 0,1 s par essai).
   Appareils : jeton aléatoire de 256 bits dans un cookie HttpOnly / SameSite=Strict (Secure en HTTPS) ;
   /data/sessions.json ne garde que l'empreinte du jeton (inutilisable si le fichier est lu) + nom, dates, adresse.
   Validité : 10 jours après la dernière visite, 90 jours au plus ; changer le mot de passe déconnecte tout le monde.
   Blocage (/data/lockout.json, relu à chaque essai : le supprimer débloque tout) :
   - par adresse IP (IPv6 : par bloc /64, un appareil en change souvent) : toutes les 3 erreurs, 5 min, puis 1 h, puis 24 h ;
     remis à zéro par une connexion réussie depuis cette adresse ou 24 h sans erreur. Quelqu'un qui essaie se bloque lui-même :
     les autres appareils peuvent toujours se connecter.
   - filet global (attaque répartie sur de nombreuses adresses) : au-delà de 20 erreurs en une heure, toutes adresses confondues,
     un seul essai toutes les 5 s pour tout le monde (ralentissement, jamais de fermeture).
   - depuis un appareil connecté : Paramètres > Connexions affiche les derniers échecs et « Débloquer la saisie du mot de passe ».
   Le blocage ne concerne que la saisie du mot de passe : les appareils déjà connectés continuent de fonctionner.
   Adresse du client : quand la connexion vient d'une adresse privée (le proxy : Nginx Proxy Manager…), celle que le proxy indique
   (X-Real-IP, sinon la DERNIÈRE de X-Forwarded-For, la seule ajoutée par le proxy) ; sinon l'adresse de la connexion, et les en-têtes,
   que le client pourrait choisir, sont ignorés (X-Forwarded-Proto aussi). */
const SESS=path.join(DATA_DIR,'sessions.json'),LOCK=path.join(DATA_DIR,'lockout.json'),CK='agenda_s';   // nom du cookie de session gardé depuis l'ancien nom du projet (le changer déconnecterait tous les appareils)
const MIN=6e4,HOUR=36e5,DAY=864e5,IDLE=10*DAY,MAXAGE=90*DAY,STEPS=[5*MIN,HOUR,DAY],SLOW_N=20,SLOW_MS=5000;
const PWF=h256(PH).toString('hex').slice(0,16);   // marque du mot de passe actuel, copiée dans chaque session
const pwOk=pw=>new Promise(ok=>{if(typeof pw!=='string'||!pw||pw.length>1024)return ok(false);
  const[,N,r,p,salt,hh]=PHM,ref=Buffer.from(hh,'base64url');
  crypto.scrypt(pw.normalize('NFC'),Buffer.from(salt,'base64url'),ref.length,{N:+N,r:+r,p:+p,maxmem:256*N*r},(e,k)=>ok(!e&&k.length===ref.length&&crypto.timingSafeEqual(k,ref)))});
const proxied=req=>isPriv(String(req.socket.remoteAddress||''));   // connexion venue d'une adresse privée : en-têtes du proxy acceptés
const ipOf=req=>{const s=String(req.socket.remoteAddress||'').replace(/^::ffff:/,'');if(!proxied(req))return s.slice(0,64);
  const xr=String(req.headers['x-real-ip']||'').trim(),xf=String(req.headers['x-forwarded-for']||'').split(',').map(x=>x.trim()).filter(Boolean).pop();
  return String(xr||xf||s).replace(/^::ffff:/,'').slice(0,64)};
const isHttps=req=>proxied(req)&&req.headers['x-forwarded-proto']==='https';
const cookie=req=>{for(const c of(req.headers.cookie||'').split(';')){const i=c.indexOf('=');if(c.slice(0,i).trim()===CK)return c.slice(i+1).trim()}return''};
const setCk=(req,res,v,age)=>res.setHeader('Set-Cookie',`${CK}=${v}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}`+(isHttps(req)?'; Secure':''));
// sessions valides seulement (les expirées disparaissent à la prochaine écriture)
const sessAll=()=>{const n=Date.now(),a=rj(SESS,{});for(const[k,s]of Object.entries(a))if(!s||s.pw!==PWF||n-s.seen>IDLE||n-s.created>MAXAGE)delete a[k];return a};
const sessSave=a=>wa(SESS,JSON.stringify(a));
// session de la requête : {has: cookie présent, id, s} ; dernière activité enregistrée au plus une fois par heure
function sessGet(req){const t=cookie(req);if(!/^[\w-]{40,64}$/.test(t))return{has:!!t};const id=h256(t).toString('hex'),a=sessAll(),s=a[id];if(!s)return{has:true};
  const ip=ipOf(req);if(Date.now()-s.seen>HOUR||s.ip!==ip){s.seen=Date.now();s.ip=ip;sessSave(a)}return{has:true,id,s}}
const devView=(id,s,me)=>({id:id.slice(0,16),name:s.name||s.auto,auto:s.auto,created:s.created,seen:s.seen,ip:s.ip,me:id===me});
// blocage : {ips:{<adresse>:{fails, until, last, dur}}, recent:[{t, ip}] (50 derniers échecs, 7 jours)} ; une adresse est oubliée 24 h après sa dernière erreur ou la fin de son blocage
const ipKey=ip=>net.isIPv6(ip)?ip6g(ip).slice(0,4).map(x=>x.toString(16)).join(':')+'::/64':ip||'?';
const lockAll=()=>{const l=rj(LOCK,null),n=Date.now(),o={ips:{},recent:[]};if(!l||typeof l!=='object'||!l.ips)return o;   // ancien format (blocage global) : ignoré
  for(const[k,x]of Object.entries(l.ips))if(x&&n-Math.max(x.last||0,x.until||0)<DAY)o.ips[k]=x;
  o.recent=(Array.isArray(l.recent)?l.recent:[]).filter(r=>r&&n-r.t<7*DAY).slice(-50);return o};
const lockOf=(L,k)=>L.ips[k]||{fails:0,until:0,last:0,dur:0};
const lockInfo=l=>l&&l.until>Date.now()?{until:l.until,long:l.dur>=DAY}:null;
const slowNow=L=>L.recent.filter(r=>Date.now()-r.t<HOUR).length>=SLOW_N;
let lastTry=0;   // filet global : heure du dernier essai, toutes adresses confondues
const clean40=s=>String(s||'').replace(/[\x00-\x1f<>]/g,'').trim().slice(0,40);
let loginQ=Promise.resolve();   // essais traités un par un (sinon des essais simultanés échapperaient au compteur) ; le corps est lu AVANT d'entrer dans la file
async function login(req,res,raw){let b;try{b=JSON.parse(raw)}catch{return send(res,400,{error:TX('srv.badRequest')})}
  const L=lockAll(),n=Date.now(),ip=ipOf(req),k=ipKey(ip),l=lockOf(L,k);
  if(l.until>n){log('warn','connexion refusée : saisie bloquée',{ip,jusqu_a:new Date(l.until).toISOString()});return send(res,429,{error:'lock',...lockInfo(l)})}
  if(slowNow(L)&&n-lastTry<SLOW_MS){log('warn','connexion refusée : trop d\'essais récents (ralentissement général)',{ip});return send(res,429,{error:'slow',until:lastTry+SLOW_MS})}
  lastTry=n;
  if(await pwOk(b.password)){if(L.ips[k]){delete L.ips[k];wa(LOCK,JSON.stringify(L))}
    const t=crypto.randomBytes(32).toString('base64url'),id=h256(t).toString('hex'),a=sessAll();
    a[id]={auto:clean40(b.name)||TX('device.other'),name:'',created:n,seen:n,ip,pw:PWF};sessSave(a);setCk(req,res,t,MAXAGE/1000);
    log('info','connexion réussie',{ip,appareil:a[id].auto});return send(res,200,{ok:true})}
  l.fails++;l.last=n;const lk=l.fails%3===0;if(lk){l.dur=STEPS[Math.min(l.fails/3-1,STEPS.length-1)];l.until=n+l.dur}
  L.ips[k]=l;L.recent.push({t:n,ip});L.recent=L.recent.slice(-50);wa(LOCK,JSON.stringify(L));
  log('warn',lk?'connexion refusée : saisie bloquée pour '+Math.round(l.dur/MIN)+' min':'connexion refusée : mot de passe incorrect',{ip,erreurs:l.fails});
  return lk?send(res,429,{error:'lock',...lockInfo(l)}):send(res,401,{error:'bad',left:3-l.fails%3,next:STEPS[Math.min(Math.floor(l.fails/3),STEPS.length-1)]})}
// apparence de la page de connexion : réglages de mise en page seulement (couleurs, polices, tailles, arrondis… + titre), aucune donnée
/* ===== THÈMES =====
   Réglages répartis en deux : généraux (settings.json : Paramètres généraux, calendriers externes, état de l'interface, thèmes choisis)
   et apparence (un fichier par thème : /data/themes/<id>.json = {name, s:{…}, from}). « Par défaut » (id defaut) : /data/themes/defaut.json
   s'il existe (à remplacer à la main par la copie d'un thème), sinon les valeurs d'origine du code ; il n'est jamais modifié par l'agenda.
   Le client reçoit les deux fusionnés (GET /api/settings) et renvoie le tout (PUT) : le serveur range chaque réglage à sa place.
   Deux thèmes choisis (contexte, en-tête X-Agenda-Ctx du navigateur) : « web » (navigateur, clés theme / themeEdit) et « frame » (agenda intégré
   dans une iframe, ex. Nextcloud : themeFrame / themeEditFrame). À la première ouverture dans une iframe, themeFrame reprend le thème du navigateur ;
   ensuite les deux choix sont indépendants (un thème modifié ou choisi dans l'un ne change pas l'autre, sauf « Écraser », qui change le fichier du thème).
   Modifier l'apparence : le thème affiché n'est jamais modifié directement ; une copie « <nom> (modifié) » est créée (puis « (modifié) (2) », « (3) »…)
   et choisie, avec from = thème d'origine ; tant qu'elle reste choisie (themeEdit = son id), les modifications suivantes y sont enregistrées.
   Choisir un autre thème termine cette « session » : modifier à nouveau la copie plus tard en crée une nouvelle.
   Copie : « Écraser » (POST /api/themes/<id>/overwrite) remplace le thème d'origine et supprime la copie ; « Nouveau » la renomme (PUT {name})
   et en fait un thème ordinaire. « Par défaut » ne peut pas être écrasé. */
const TH_DIR=path.join(DATA_DIR,'themes'),GEN=new Set(['title','startView','defCal','taskCal','evDur','remTime','pmStart','evStart','taskFilter','showTags','frameOn','frameSrc',
  'bdayCal','bdayMonth','bdayYear','holUrl','vacUrl','extEvery','extAllow','holMonth','holYear','vacMonth','vacYear','vacCut','hidden','collapsed','setOpen','sideClosed','showDone','showRO','dated','tasksByList','toolsName','toolsCal','toolsDeck','toolsTasks','links','srT','srL','srD','srF','srP','srK',
  'lang','setAdv','theme','themeEdit','themeFrame','themeEditFrame']);
const THK={web:{th:'theme',ed:'themeEdit'},frame:{th:'themeFrame',ed:'themeEditFrame'}},TH_KEYS=['theme','themeEdit','themeFrame','themeEditFrame'];
const ctxOf=req=>req.headers['x-agenda-ctx']==='frame'||req.headers['sec-fetch-dest']==='iframe'?'frame':'web';   // page dans une iframe (Sec-Fetch-Dest) ou appel de l'API depuis une iframe (en-tête posé par app.js)
try{fs.mkdirSync(TH_DIR,{recursive:true})}catch{}
const thFile=id=>path.join(TH_DIR,id+'.json'),thOk=id=>typeof id==='string'&&/^[a-z0-9-]{1,40}$/.test(id);
// names : noms traduits des thèmes fournis ({FR:…, EN:…}) ; name = nom affiché dans la langue choisie (renommer un thème efface names)
const thNames=n=>n&&typeof n==='object'?Object.fromEntries(Object.entries(n).filter(([k,v])=>/^[A-Za-z-]{2,12}$/.test(k)&&typeof v==='string').map(([k,v])=>[k.toUpperCase(),v.slice(0,60)])):undefined;
const thRead=id=>{if(!thOk(id))return null;const t=rj(thFile(id),null);if(!t||typeof t!=='object')return null;const names=thNames(t.names);
  return{name:String(names?.[langOf()]||t.name||id).slice(0,60),names,s:appOnly(clean(t.s||{})),from:thOk(t.from)?t.from:undefined}};
const appOnly=s=>Object.fromEntries(Object.entries(s).filter(([k])=>!GEN.has(k))),genOnly=s=>Object.fromEntries(Object.entries(s).filter(([k])=>GEN.has(k)));
const noTh=g=>Object.fromEntries(Object.entries(g).filter(([k])=>!TH_KEYS.includes(k))),thKeys=g=>Object.fromEntries(TH_KEYS.filter(k=>g[k]).map(k=>[k,g[k]]));
const thList=()=>{let f=[];try{f=fs.readdirSync(TH_DIR)}catch{}return f.filter(x=>/^[a-z0-9-]{1,40}\.json$/.test(x)&&x!=='defaut.json').map(x=>{const id=x.slice(0,-5),t=thRead(id);return t&&{id,name:t.name,from:t.from}}).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name,TX('locale')))};
// thème choisi dans ce contexte (iframe pas encore réglée : celui du navigateur) ; disparu : « Par défaut »
const thCur=(ctx='web')=>{const g=rd(sf),id=g[THK[ctx].th];if(ctx==='frame'&&!id)return thCur('web');return id&&id!=='defaut'&&thRead(id)?id:'defaut'};
const thGet=id=>id==='defaut'?{name:TX('theme.default'),s:thRead('defaut')?.s||{}}:thRead(id);
// première ouverture dans une iframe : le thème du navigateur y devient le thème choisi (ensuite indépendant)
const ctxInit=ctx=>{if(ctx!=='frame')return;const g=rd(sf);if(!g.themeFrame)wa(sf,JSON.stringify({...g,themeFrame:thCur('web')}))};
const settingsAll=(ctx='web')=>{const g=genOnly(rd(sf)),id=thCur(ctx);return{...(thGet(id)?.s||{}),...noTh(g),theme:id}};
const same=(a,b)=>{const k=o=>JSON.stringify(Object.keys(o).sort().map(x=>[x,o[x]]));return k(a)===k(b)};
const thId=name=>{const b=(name.normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')||'theme').slice(0,30);let id=b,n=2;while(id==='defaut'||fs.existsSync(thFile(id)))id=b+'-'+n++;return id};
const thName=base=>{const l=thList().map(t=>t.name);let n=base,i=2;while(l.includes(n))n=base+' ('+i+++')';return n};   // « Bleu (modifié) », puis « Bleu (modifié) (2) »…
const thWrite=(id,name,s,from,names)=>wa(thFile(id),JSON.stringify({name,...(names?{names}:{}),s:appOnly(s),...(from?{from}:{})},null,1));
// réglages reçus du client : le général dans settings.json, l'apparence dans la copie en cours de modification, ou dans une nouvelle copie « (modifié) »
function settingsPut(all,ctx='web'){const s=clean(all),st=genOnly(rd(sf)),g={...noTh(genOnly(s)),...thKeys(st)},a=appOnly(s),k=THK[ctx],id=thCur(ctx),t=thGet(id);let made=null;
  if(!same(a,t.s)){
    if(id!=='defaut'&&st[k.ed]===id)thWrite(id,t.name,a,t.from);   // copie en cours de modification : on continue dedans
    else{const org=t.from&&(t.from==='defaut'||thRead(t.from))?t.from:id,on=thGet(org)?.name||t.name,n=thName(TX('theme.modified',{name:on})),nid=thId(n);
      thWrite(nid,n,a,org);g[k.th]=nid;g[k.ed]=nid;made={name:n,from:on};log('info','thème modifié : copie créée',{theme:n,origine:on,contexte:ctx})}}
  wa(sf,JSON.stringify(g));faUpd();return{...settingsAll(ctx),...(made?{created:made}:{})}}
// choix d'un thème dans les deux contextes : remplace « old » par « nw » (ou l'oublie si nw est vide), et termine les sessions de modification qui le visent
const thSwap=(old,nw)=>{const g=rd(sf);for(const c of Object.values(THK)){if(g[c.th]===old){if(nw)g[c.th]=nw;else delete g[c.th]}if(g[c.ed]===old)delete g[c.ed]}wa(sf,JSON.stringify(genOnly(g)))};
// Passage à cette version : l'apparence enregistrée dans settings.json devient le thème « Mon thème » (sélectionné)
{const s=rd(sf),a=appOnly(s);if(!s.theme&&Object.keys(a).length&&!thList().length){const n=TX('theme.mine'),id=thId(n);thWrite(id,n,a);wa(sf,JSON.stringify({...genOnly(s),theme:id}));log('info','apparence actuelle enregistrée comme thème « Mon thème »')}}
// Thèmes fournis (dossier themes/ de l'application : Clair, Sombre, Vert Clair, Vert Foncé) : copiés une seule fois dans /data/themes
// (liste dans /data/themes/.bundled.json : un thème supprimé ou renommé n'est pas réinstallé ; un nouveau thème fourni l'est à la mise à jour).
// Nouvelle installation (pas encore de settings.json) : « Vert Clair » est choisi.
try{const mf=path.join(TH_DIR,'.bundled.json'),done=rj(mf,[]),fresh=!fs.existsSync(sf),TA=path.join(__dirname,'themes'),add=[];let f=[];try{f=fs.readdirSync(TA)}catch{}
  for(const x of f){const id=x.slice(0,-5);if(!/^[a-z0-9-]{1,40}\.json$/.test(x)||id==='defaut'||(Array.isArray(done)&&done.includes(id)))continue;
    const t=rj(path.join(TA,x),null);if(!t?.s)continue;if(!fs.existsSync(thFile(id)))thWrite(id,String(t.name||id).slice(0,60),clean(t.s),undefined,thNames(t.names));add.push(id)}
  if(add.length){wa(mf,JSON.stringify([...(Array.isArray(done)?done:[]),...add]));log('info','thèmes fournis installés',{themes:add.join(', ')})}
  if(fresh&&thRead('vert-clair'))wa(sf,JSON.stringify({theme:'vert-clair'}))}
catch(e){log('error',`thèmes fournis non installés : ${DATA_DIR} n'est pas accessible en écriture (propriétaire attendu : 1000)`,{erreur:e.code||e.message})}

const DCF=path.join(DATA_DIR,'daycolors.json'),dcAll=()=>{const a=rj(DCF,{});return a&&typeof a==='object'&&!Array.isArray(a)?Object.fromEntries(Object.entries(a).filter(([k,v])=>/^\d{4}-\d{2}-\d{2}$/.test(k)&&[1,2,3].includes(v)).slice(0,20000)):{}};
const pubTheme=(ctx='web')=>{const s=settingsAll(ctx),r={};for(const[k,v]of Object.entries(s))if(['hex','num','bool','enum','font'].includes(SCHEMA[k]?.[0]))r[k]=v;return r};   // sans le titre : rien de personnel avant le mot de passe
/* iframes : par défaut, aucun site ne peut afficher l'agenda dans une iframe (protection contre le « clickjacking »).
   Paramètres généraux > « Autoriser les iframes » coché : seuls les sites listés (séparés par des virgules) le peuvent.
   Chaque site est ramené à une origine (https:// ajouté si absent, chemin retiré ; *.domaine accepté) ; une saisie invalide est ignorée. */
let FA="'none'";
const faUpd=()=>{const s=rd(sf),l=[];
  if(s.frameOn)for(const x of String(s.frameSrc||'').split(/[,\s]+/)){const m=x.trim().toLowerCase().match(/^(?:(https?):\/\/)?((?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*)(:\d{1,5})?(?:\/.*)?$/);if(m)l.push(`${m[1]||'https'}://${m[2]}${m[3]||''}`)}
  const n=l.length?[...new Set(l)].join(' '):"'none'";if(n!==FA){FA=n;log('info','iframes',{autorisees:FA})}};
// CSP : rien d'autre que ce serveur (scripts, polices, images, manifeste) ; styles en ligne autorisés (thème) ; base-uri / form-action verrouillés
const send=(res,c,b,t='application/json; charset=utf-8',h={})=>{res.writeHead(c,{'Content-Type':t,'Content-Security-Policy':"default-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors "+FA,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cache-Control':'no-store',...h});res.end(Buffer.isBuffer(b)||typeof b==='string'?b:JSON.stringify(b))};
// Fichiers statiques (script, polices, icônes, manifeste) : ETag + « no-cache » = le navigateur garde sa copie et demande seulement si elle a changé (réponse 304, sans contenu)
function sendFile(req,res,f,t){let st;try{st=fs.statSync(f)}catch{return send(res,404,{error:'not found'})}
  const et=`"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`,h={'Cache-Control':'no-cache',ETag:et};
  if(req.headers['if-none-match']===et){res.writeHead(304,h);return res.end()}return send(res,200,fs.readFileSync(f),t,h)}
// Corps de requête (1 Mo au plus) : morceaux assemblés en octets puis décodés (un caractère accentué coupé entre deux morceaux reste entier) ;
// échoue aussi si la connexion est coupée avant la fin (sinon la promesse resterait en attente pour toujours)
const readBody=req=>new Promise((ok,ko)=>{const b=[];let n=0,end=false;
  req.on('data',c=>{n+=c.length;if(n>1e6){ko(new Error('trop gros'));req.destroy()}else b.push(c)});
  req.on('end',()=>{end=true;ok(Buffer.concat(b).toString('utf8'))});req.on('error',ko);req.on('close',()=>{if(!end)ko(new Error('connexion interrompue'))})});
const jsonBody=async req=>{try{return JSON.parse(await readBody(req)||'{}')}catch{return null}};   // null = requête invalide (réponse 400)
const report=(cal,comp,extra,range)=>dav('REPORT',cal,`<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data>${extra}</c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="${comp}">${range}</c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`,{Depth:'1'}).then(r=>{if(r.status>=500)throw ncErr('REPORT '+r.status);if(!r.ok)throw new Error('REPORT '+r.status);return r.text()});
const items=x=>resps(x).map(s=>({href:unx(tag(s,'href')),etag:unx(tag(s,'getetag')),ics:unx(tag(s,'calendar-data'))})).filter(o=>o.ics);
async function calList(){   // erreur si Nextcloud répond mal : sinon liste vide (et sauvegarde hors-ligne écrasée par du vide)
  const r=await dav('PROPFIND',root,`<d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:prop><d:displayname/><d:resourcetype/><a:calendar-color/><c:supported-calendar-component-set/><d:current-user-privilege-set/></d:prop></d:propfind>`,{Depth:'1'});
  if(r.status>=500)throw ncErr('Nextcloud : HTTP '+r.status);if(!r.ok)throw new Error('Nextcloud : HTTP '+r.status);const x=await r.text();
  return resps(x).filter(s=>/<(?:\w+:)?calendar\s*\/>/.test(s)).map(s=>({href:unx(tag(s,'href')),name:unx(tag(s,'displayname')),color:(unx(tag(s,'calendar-color')).match(/^#[0-9a-f]{6}/i)||['#4f8cff'])[0],ev:/name="VEVENT"/.test(s),todo:/name="VTODO"/.test(s),ro:ro(s)})).filter(c=>c.ev||c.todo)}

/* ----- Sauvegarde hors-ligne : /data/offline.json -----
   Contenu : calendriers + évènements (récurrences développées) d'il y a 1 an à dans 2 ans + toutes les tâches, ICS bruts.
   Quand : 30 s après le démarrage, puis toutes les 12 h, et 2 min après chaque modification faite dans l'application.
   Écriture dans un fichier temporaire puis renommage : en cas d'échec (Nextcloud injoignable), l'ancienne sauvegarde est gardée. */
const offF=path.join(DATA_DIR,'offline.json'),zt=t=>new Date(t).toISOString().replace(/[-:]/g,'').replace(/\.\d+/,'');
let offBusy=false,offT;
async function offSave(){if(offBusy)return;offBusy=true;try{await discover();
  const cals=await calList(),s=zt(Date.now()-365*864e5),e=zt(Date.now()+730*864e5),tr=`<c:time-range start="${s}" end="${e}"/>`,ev={},tk={};let ne=0,nt=0;
  for(const c of cals){
    if(c.ev){let x;try{x=await report(c.href,'VEVENT',`<c:expand start="${s}" end="${e}"/>`,tr)}catch{x=await report(c.href,'VEVENT','',tr)}ev[c.href]=items(x).filter(o=>okp(o.href));ne+=ev[c.href].length}
    if(c.todo){tk[c.href]=items(await report(c.href,'VTODO','','')).filter(o=>okp(o.href));nt+=tk[c.href].length}}
  fs.writeFileSync(offF+'.tmp',JSON.stringify({date:new Date().toISOString(),cals,ev,tk}));fs.renameSync(offF+'.tmp',offF);
  log('info','sauvegarde hors-ligne enregistrée',{evenements:ne,taches:nt})}
  catch(e){log('warn','sauvegarde hors-ligne : échec, ancienne sauvegarde conservée',{err:e.message})}finally{offBusy=false}}
const offSoon=()=>{SRC.clear();clearTimeout(offT);offT=setTimeout(offSave,12e4)};   // une écriture : cache de la recherche vidé, sauvegarde hors-ligne dans 2 min

/* ----- Recherche (volet > champ de recherche) -----
   GET /api/search?q=…&in=tld&when=fp&cal=<href>…&x=<id externe>… : tous les évènements, passés et futurs, des calendriers demandés (les cochés du volet).
   Nextcloud : tous les objets VEVENT du calendrier (sans période), gardés 60 s (cache vidé à chaque écriture) ; injoignable : sauvegarde hors-ligne.
   Correspondance : chaque mot de la recherche doit se trouver dans l'un des champs choisis (titre t, lieu l, description d), sans tenir compte
   des majuscules ni des accents. Une ligne par évènement (série : prochaine occurrence, sinon la dernière ; rec = répétée).
   Ordre : à venir (du plus proche au plus lointain) puis passés (du plus récent au plus ancien) ; 500 résultats au plus (n = nombre total). */
const SRC=new Map();
async function calAll(href,comp='VEVENT'){const ck=comp+href,c=SRC.get(ck);if(c&&Date.now()-c.t<6e4)return c.v;
  let v;try{v=items(await report(href,comp,'','')).filter(o=>okp(o.href))}
  catch(e){if(!e.nc)throw e;let o={};try{o=JSON.parse(fs.readFileSync(offF,'utf8'))}catch{}v=(o[comp==='VTODO'?'tk':'ev']||{})[href]||[];log('warn','recherche : Nextcloud injoignable, sauvegarde hors-ligne utilisée',{cal:href})}
  SRC.set(ck,{t:Date.now(),v});return v}
// tâche datée (DUE, sinon DTSTART ; cartes Deck comprises) -> résultat ou null : à venir si l'échéance n'est pas passée
function srTask(e,words,inn,when,now){const d=icsDt(e.DUE)||icsDt(e.DTSTART);if(!d)return null;
  const f=fold([inn.includes('t')&&unesc(e.SUMMARY?.v),inn.includes('l')&&unesc(e.LOCATION?.v),inn.includes('d')&&unesc(e.DESCRIPTION?.v)].filter(Boolean).join(' '));if(!words.every(w=>f.includes(w)))return null;
  const ms=dtMs(d),fut=(d.all?ms+864e5:ms)>now;if(!when.includes(fut?'f':'p'))return null;
  return{t:unesc(e.SUMMARY?.v),a:d.all||undefined,fut,s:d.all?ymdOf(ms):new Date(ms).toISOString(),e:d.all?ymdOf(ms):new Date(ms).toISOString(),ms}}
const fold=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
// un évènement (VEVENT d'un même UID : série + exceptions) -> résultat ou null
function srOne(evs,words,inn,when,now,bud){
  const txt=evs.map(e=>[inn.includes('t')&&unesc(e.SUMMARY?.v),inn.includes('l')&&unesc(e.LOCATION?.v),inn.includes('d')&&unesc(e.DESCRIPTION?.v)].filter(Boolean).join(' ')).join(' '),f=fold(txt);
  if(!words.every(w=>f.includes(w)))return null;
  const m=evs.find(e=>!e['RECURRENCE-ID'])||evs[0],rec=evs.length>1||!!m.RRULE||!!m.RDATE,Y=365*864e5;
  let o=null;
  if(when.includes('f')){for(const x of expandAll(evs,now,now+(rec?10*Y:300*Y),bud))if(x.o.e>now&&(!o||x.o.s<o.o.s))o=x}   // à venir (ou en cours)
  if(!o&&when.includes('p')){for(const x of expandAll(evs,rec?now-30*Y:-300*Y,now,bud))if(x.o.e<=now&&(!o||x.o.s>o.o.s))o=x}   // passé : le plus récent
  if(!o)return null;const e=o.e;
  return{t:unesc(e.SUMMARY?.v),l:unesc(e.LOCATION?.v)||undefined,d:unesc(e.DESCRIPTION?.v)||undefined,st:e.STATUS?.v||undefined,a:o.o.all||undefined,rec:rec||undefined,fut:o.o.e>now,
    s:o.o.all?ymdOf(o.o.s):new Date(o.o.s).toISOString(),e:o.o.all?ymdOf(o.o.e):new Date(o.o.e).toISOString(),ms:o.o.s}}
const byUid=evs=>{const g=new Map();for(const e of evs){const k=e.UID?.v||Math.random();if(!g.has(k))g.set(k,[]);g.get(k).push(e)}return[...g.values()]};

try{fs.mkdirSync(DATA_DIR,{recursive:true})}catch(e){log('warn','DATA_DIR inaccessible',{err:e.message})}

// Contrôle avant livraison (check.js) : réglages exportés, serveur non démarré
if(process.env.AGENDA_CHECK){module.exports={clean,SCHEMA,GEN,isPriv,inCidr,ipKey,occurrences,icsParse,expandAll,okObjTest:(r,h)=>{root=r;return okObj(h)}};return}

faUpd();
// Fichiers publics (aucune donnée) : page, script, manifeste et icônes de l'application installable (PWA), polices
const stat={'/':['index.html','text/html; charset=utf-8'],'/app.js':['app.js','text/javascript; charset=utf-8'],'/manifest.webmanifest':['manifest.webmanifest','application/manifest+json; charset=utf-8']};
const ICONS=path.join(__dirname,'icons'),ICON_OK=/^[\w.-]+\.(png|svg)$/;
let fontsWarned=false;   // « aucune police utilisable » : écrit une seule fois dans les logs (la route est publique)
const server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://x'),p=url.pathname,q=k=>url.searchParams.get(k);
  // Healthcheck Docker : le serveur répond et /data est accessible en écriture (nextcloud = secondes depuis le dernier échange réussi, pour information)
  if(p==='/api/health'&&req.method==='GET'){let ok=true;try{fs.accessSync(DATA_DIR,fs.constants.W_OK)}catch{ok=false}
    return send(res,ok?200:503,{ok,nextcloud:ncOk?Math.round((Date.now()-ncOk)/1000):null})}
  // accès libre : la page, le script, le manifeste, les icônes, les polices (aucune donnée) + état de connexion et connexion ; tout le reste demande une session
  const ses=sessGet(req),pub=req.method==='GET'&&(stat[p]||p.startsWith('/icons/')||p.startsWith('/fonts/')||p==='/api/fonts'||p==='/api/session')||p==='/api/login';
  if(!pub&&!ses.s)return send(res,p.startsWith('/api/')?401:404,{error:'auth'});
  if(req.method==='GET'&&p==='/')return send(res,200,ses.s?preHtml(settingsAll(ctxOf(req)),false,req):preHtml(pubTheme(ctxOf(req)),true,req),stat[p][1]);   // page + couleurs de l'écran de chargement
  if(req.method==='GET'&&stat[p])return sendFile(req,res,path.join(__dirname,stat[p][0]),stat[p][1]);
  if(req.method==='GET'&&p.startsWith('/icons/')){const f=p.slice(7);return ICON_OK.test(f)?sendFile(req,res,path.join(ICONS,f),f.endsWith('.svg')?'image/svg+xml':'image/png'):send(res,404,{})}
  if(req.method==='GET'&&p.startsWith('/fonts/')){const f=decodeURIComponent(p.slice(7));return fonts().includes(f)?sendFile(req,res,fontFile(f),'font/'+f.split('.').pop().toLowerCase()):send(res,404,{})}
  if(req.method!=='GET'&&req.headers['x-requested-with']!=='cal')return send(res,403,{error:'csrf'});

  // ----- connexion -----
  if(p==='/api/session'){const l=lockOf(lockAll(),ipKey(ipOf(req)));return send(res,200,ses.s?{auth:true,nc:origin+pre}:{auth:false,ended:ses.has,lock:lockInfo(l),theme:pubTheme(ctxOf(req))})}
  if(p==='/api/login'&&req.method==='POST'){let raw;try{raw=await readBody(req)}catch{return}   // corps lu avant la file : un client lent ne peut pas la bloquer
    const run=loginQ.then(()=>login(req,res,raw));loginQ=run.catch(()=>{});return run}
  if(p==='/api/logout'&&req.method==='POST'){const a=sessAll();delete a[ses.id];sessSave(a);setCk(req,res,'',0);log('info','déconnexion',{appareil:ses.s.name||ses.s.auto});return send(res,200,{ok:true})}
  // saisie du mot de passe : derniers échecs, adresses bloquées ; déblocage depuis un appareil connecté
  if(p==='/api/lockout'&&req.method==='GET'){const L=lockAll(),n=Date.now();
    return send(res,200,{blocked:Object.entries(L.ips).filter(([,x])=>x.until>n).map(([ip,x])=>({ip,until:x.until,long:x.dur>=DAY})),recent:L.recent.slice(-10).reverse(),slow:slowNow(L)})}
  if(p==='/api/lockout/clear'&&req.method==='POST'){try{fs.unlinkSync(LOCK)}catch{}RJ.delete(LOCK);lastTry=0;log('info','saisie du mot de passe débloquée',{par:ses.s.name||ses.s.auto});return send(res,200,{ok:true})}
  if(p==='/api/devices'){const a=sessAll();
    if(req.method==='GET')return send(res,200,Object.entries(a).map(([k,s])=>devView(k,s,ses.id)).sort((x,y)=>y.me-x.me||y.seen-x.seen));
    const b=await jsonBody(req);if(!b)return send(res,400,{error:TX('srv.badRequest')});
    if(req.method==='DELETE'&&b.all){sessSave({});setCk(req,res,'',0);log('info','tous les appareils déconnectés',{par:ses.s.name||ses.s.auto});return send(res,200,{ok:true})}
    const id=typeof b.id==='string'&&b.id.length===16&&Object.keys(a).find(k=>k.startsWith(b.id));if(!id)return send(res,404,{error:TX('srv.unknownDevice')});
    if(req.method==='PUT'){a[id].name=clean40(b.name);sessSave(a);return send(res,200,devView(id,a[id],ses.id))}
    if(req.method==='DELETE'){const nm=a[id].name||a[id].auto;delete a[id];sessSave(a);if(id===ses.id)setCk(req,res,'',0);log('info','appareil déconnecté',{appareil:nm});return send(res,200,{ok:true})}}
  if(p==='/api/fonts'){const f=scanFonts();if(!f.ok.length&&!fontsWarned){fontsWarned=true;log('warn','aucune police utilisable',{dossier:FONTS_DIR,erreur:f.err||undefined,fichiers_ignores:f.bad.slice(0,8)})}return send(res,200,f.ok)}
  if(p==='/api/settings'){
    if(req.method==='PUT'){const b=await jsonBody(req);return b?send(res,200,settingsPut(b,ctxOf(req))):send(res,400,{error:TX('srv.badRequest')})}
    ctxInit(ctxOf(req));return send(res,200,settingsAll(ctxOf(req)))}
  // thèmes : liste, choix, nouveau (copie du thème affiché), renommer, supprimer ; chaque action renvoie les réglages fusionnés
  if(p==='/api/themes'&&req.method==='GET'){const c=ctxOf(req),g=rd(sf),cur=thCur(c);return send(res,200,{list:thList(),cur,edit:g[THK[c].ed]===cur,defFile:fs.existsSync(thFile('defaut'))})}
  {const tm=p.match(/^\/api\/themes(?:\/([a-z0-9-]{1,40})(\/overwrite)?)?$/);
   if(tm&&req.method!=='GET'){const b=await jsonBody(req);if(!b)return send(res,400,{error:TX('srv.badRequest')});
    const c=ctxOf(req),k=THK[c],id=tm[1],nm=typeof b.name==='string'?b.name.replace(/[\x00-\x1f<>]/g,'').trim().slice(0,60):'',g=()=>rd(sf),put=o=>wa(sf,JSON.stringify(genOnly({...g(),...o})));
    if(id&&id!=='defaut'&&!thRead(id))return send(res,404,{error:TX('srv.unknownTheme')});
    // nouveau thème : copie de l'apparence affichée, choisi dans ce contexte
    if(req.method==='POST'&&!id){if(!nm)return send(res,400,{error:TX('srv.nameMissing')});if(thList().some(t=>t.name===nm))return send(res,400,{error:TX('srv.nameTaken')});
      const nid=thId(nm);thWrite(nid,nm,appOnly(settingsAll(c)));const o=g();o[k.th]=nid;delete o[k.ed];wa(sf,JSON.stringify(genOnly(o)));log('info','thème créé',{theme:nm});return send(res,200,settingsAll(c))}
    // écraser : la copie remplace son thème d'origine (même nom, même id), puis disparaît ; les contextes qui l'utilisaient passent sur l'origine
    if(req.method==='POST'&&tm[2]){const t=thRead(id),o=t?.from&&t.from!=='defaut'&&thRead(t.from);if(!o)return send(res,400,{error:TX('srv.impossible')});
      thWrite(t.from,o.names?.FR||o.name,t.s,o.from,o.names);try{fs.unlinkSync(thFile(id))}catch{}RJ.delete(thFile(id));thSwap(id,t.from);log('info','thème écrasé par sa copie modifiée',{theme:o.name});return send(res,200,settingsAll(c))}
    if(req.method==='PUT'&&id&&b.select){const o=g();o[k.th]=id;delete o[k.ed];wa(sf,JSON.stringify(genOnly(o)));return send(res,200,settingsAll(c))}   // choisir un thème : fin de la modification en cours
    // renommer ; une copie « (modifiée) » renommée (bouton Nouveau) devient un thème ordinaire
    if(req.method==='PUT'&&id&&id!=='defaut'){if(!nm)return send(res,400,{error:TX('srv.nameMissing')});if(thList().some(t=>t.name===nm&&t.id!==id))return send(res,400,{error:TX('srv.nameTaken')});
      const t=thRead(id);thWrite(id,nm,t.s);if(t.from){const o=g();for(const x of Object.values(THK))if(o[x.ed]===id)delete o[x.ed];wa(sf,JSON.stringify(genOnly(o)))}return send(res,200,settingsAll(c))}
    if(req.method==='DELETE'&&id&&id!=='defaut'){try{fs.unlinkSync(thFile(id))}catch{}RJ.delete(thFile(id));thSwap(id,'defaut');log('info','thème supprimé',{id});return send(res,200,settingsAll(c))}
    return send(res,400,{error:TX('srv.impossible')})}}
  // sauvegarde de la configuration : réglages généraux, calendriers externes (adresses, noms, couleurs, actualisation), thème choisi (nom + valeurs)
  if(p==='/api/config'&&req.method==='GET'){const id=thCur(ctxOf(req)),t=thGet(id);
    res.setHeader('Content-Disposition','attachment; filename="jolical-configuration.json"');
    return send(res,200,{app:'jolical',version:1,date:new Date().toISOString(),general:noTh(genOnly(rd(sf))),daycolors:dcAll(),extcals:xcList().map(({url,name,color,every})=>({url,name,color,every})),theme:{default:id==='defaut',name:t.name,s:t.s}})}
  if(p==='/api/config'&&req.method==='POST'){const b=await jsonBody(req);if(!b)return send(res,400,{error:TX('srv.unreadable')});
    if((b.app!=='jolical'&&b.app!=='agenda')||!b.general)return send(res,400,{error:TX('srv.notCfg')});
    // réglages généraux d'abord : les « Adresses autorisées » du fichier s'appliquent aux téléchargements qui suivent
    const errs=[],l=xcList(),g0=thKeys(genOnly(rd(sf)));wa(sf,JSON.stringify({...noTh(genOnly(clean(b.general))),...g0}));
    for(const x of Array.isArray(b.extcals)?b.extcals.slice(0,XC_MAX):[]){if(typeof x?.url!=='string'||l.some(y=>y.url===x.url))continue;if(l.length>=XC_MAX)break;
      const n={id:crypto.randomBytes(4).toString('hex'),url:x.url.trim().slice(0,500),name:typeof x.name==='string'?x.name.slice(0,60):'',color:xcColor(x.color)||XC_COL[l.length%XC_COL.length],every:XC_EVERY.includes(x.every)?x.every:'quarter'};
      try{await extDownload('c-'+n.id,n.url);l.push(n);xcSave(l)}catch(e){errs.push(n.url+' : '+extErr(e))}}
    let tid='defaut';
    if(b.theme&&!b.theme.default&&typeof b.theme.name==='string'){const nm=b.theme.name.replace(/[\x00-\x1f<>]/g,'').trim().slice(0,60)||TX('theme.imported'),ex=thList().find(t=>t.name===nm);tid=ex?ex.id:thId(nm);if(!ex)thWrite(tid,nm,clean(b.theme.s||{}))}
    if(b.daycolors&&typeof b.daycolors==='object'){const a={...dcAll()};for(const[k,v]of Object.entries(b.daycolors))if(/^\d{4}-\d{2}-\d{2}$/.test(k)&&[1,2,3].includes(v))a[k]=v;wa(DCF,JSON.stringify(a))}   // couleurs des jours : ajoutées / remplacées
    {const c=THK[ctxOf(req)];wa(sf,JSON.stringify({...noTh(genOnly(clean(b.general))),...g0,[c.th]:tid,[c.ed]:undefined}))}faUpd();log('info','configuration importée',{calendriers:l.length,erreurs:errs.length});return send(res,200,{settings:settingsAll(ctxOf(req)),errors:errs})}
  // Calendriers externes : état des fichiers déjà téléchargés (avec la date de la prochaine mise à jour) / téléchargement + vérification
  if(p==='/api/extdata')return send(res,200,{hol:extList('hol'),vac:extList('vac')});
  if(p==='/api/ext'&&req.method==='GET'){const ev=rd(sf).extEvery||'quarter';return send(res,200,{hol:extView(extMeta('hol'),ev),vac:extView(extMeta('vac'),ev)})}
  // calendriers externes ajoutés : liste, ajout (téléchargement), modification (nom, couleur, nouvelle URL), nouveau téléchargement, suppression, évènements
  if(p==='/api/extcals'&&req.method==='GET')return send(res,200,xcList().map(xcView));
  if(p==='/api/extevents'){const a=Date.parse(q('start')),b=Date.parse(q('end'));if(!(a<b)||b-a>4e11)return send(res,400,{error:'bad'});
    const bud={n:5e5};return send(res,200,xcList().flatMap(x=>xcEvents(x.id,a,b,bud)))}   // budget commun à tous les calendriers de la requête
  {const cm=p.match(/^\/api\/extcals(?:\/([a-f0-9]{8}))?$/);
   if(cm&&req.method!=='GET'){const b=await jsonBody(req);if(!b)return send(res,400,{error:TX('srv.badRequest')});
    const l=xcList(),i=cm[1]?l.findIndex(x=>x.id===cm[1]):-1;if(cm[1]&&i<0)return send(res,404,{error:TX('srv.unknownCal')});
    if(req.method==='DELETE'){const x=l.splice(i,1)[0];xcSave(l);for(const e of['ics','json'])try{fs.unlinkSync(extFile('c-'+x.id,e))}catch{}ICSC.delete(extFile('c-'+x.id,'ics'));log('info','calendrier externe supprimé',{url:x.url});return send(res,200,{ok:true})}
    const lnk=typeof b.url==='string'?b.url.trim():null;if(lnk!==null&&(!lnk||lnk.length>500))return send(res,400,{error:TX('srv.urlMissing')});
    const x=i>=0?l[i]:{id:crypto.randomBytes(4).toString('hex'),url:'',name:'',color:XC_COL[l.length%XC_COL.length]};
    if(i<0&&l.length>=XC_MAX)return send(res,400,{error:TX('srv.maxCals',{n:XC_MAX})});
    if(XC_EVERY.includes(b.every))x.every=b.every;
    if(typeof b.name==='string')x.name=b.name.replace(/[\x00-\x1f<>]/g,'').trim().slice(0,60);if(xcColor(b.color))x.color=b.color;
    if(lnk!==null&&(lnk!==x.url||b.refresh||i<0)){try{const meta=await extDownload('c-'+x.id,lnk);x.url=lnk;log('info','calendrier externe téléchargé',{url:lnk,n:meta.n})}
      catch(e){const m=extErr(e);log('warn','calendrier externe : échec',{url:lnk,err:m});return send(res,502,{error:m})}}
    if(i<0)l.push(x);xcSave(l);return send(res,200,xcView(x))}}
  const xm=p.match(/^\/api\/ext\/(hol|vac)$/);
  if(xm&&req.method==='POST'){const k=xm[1],b=await jsonBody(req);if(!b)return send(res,400,{error:TX('srv.badRequest')});
    const lnk=typeof b.url==='string'?b.url.trim():'';if(!lnk||lnk.length>500)return send(res,400,{error:TX('srv.urlMissing')});
    try{const meta=await extDownload(k,lnk);
      log('info','calendrier externe téléchargé',{type:k,...meta});return send(res,200,extView(meta,rd(sf).extEvery||'quarter'))}
    catch(e){const m=extErr(e);log('warn','calendrier externe : échec',{type:k,url:lnk,err:m});return send(res,502,{error:m})}}

  // Couleurs personnalisées des jours (aperçu d'un jour, vue Mois) : GET = {AAAA-MM-JJ: 1|2|3} ; PUT {d, c} (c = 0 : retirée). Gardées dans l'agenda, pas dans Nextcloud
  if(p==='/api/daycolors'){if(req.method==='GET')return send(res,200,dcAll());
    if(req.method==='PUT'){const b=await jsonBody(req);if(!b||!/^\d{4}-\d{2}-\d{2}$/.test(b.d)||![0,1,2,3].includes(b.c))return send(res,400,{error:TX('srv.badRequest')});
      const a=dcAll();if(b.c)a[b.d]=b.c;else delete a[b.d];wa(DCF,JSON.stringify(a));return send(res,200,{ok:true})}}
  if(p==='/api/search'){const qs=String(q('q')||'').slice(0,100),inn=String(q('in')||'t'),when=String(q('when')||'fp'),words=fold(qs).split(/\s+/).filter(Boolean),now=Date.now(),bud={n:1e6},out=[];
    if(!words.length||!/^[tld]+$/.test(inn)||!/^[fp]+$/.test(when))return send(res,400,{error:TX('srv.badRequest')});
    for(const id of url.searchParams.getAll('x').filter(x=>/^[a-f0-9]{8}$/.test(x)))for(const g of byUid(icsGet(extFile('c-'+id,'ics'))||[])){const r=srOne(g,words,inn,when,now,bud);if(r)out.push({k:'x',c:id,...r})}
    const c0=url.searchParams.getAll('cal');if(c0.length)await discover();const cs=c0.filter(okp);   // okp a besoin du dossier découvert
    for(const c of cs)for(const o of await calAll(c)){let evs;try{evs=icsParse(o.ics)}catch{continue}for(const g of byUid(evs)){const r=srOne(g,words,inn,when,now,bud);if(r)out.push({k:'nc',c,href:o.href,etag:o.etag,ics:o.ics.length<2e4?o.ics:undefined,...r})}}
    // tâches datées des listes demandées (tl : listes de tâches cochées, Deck compris) ; ics renvoyé pour l'aperçu
    for(const c of url.searchParams.getAll('tl').filter(okp))for(const o of await calAll(c,'VTODO')){let evs;try{evs=icsParse(o.ics,'VTODO')}catch{continue}
      for(const e of evs){const r=srTask(e,words,inn,when,now);if(r)out.push({k:'tk',c,href:o.href,etag:o.etag,ics:o.ics,...r})}}
    out.sort((a,b)=>a.fut!==b.fut?(a.fut?-1:1):a.fut?a.ms-b.ms:b.ms-a.ms);
    log('debug','recherche',{mots:words.length,resultats:out.length});return send(res,200,{n:out.length,list:out.slice(0,500).map(({ms,...r})=>r)})}
  // Mode hors-ligne : sauvegarde lue sans contacter Nextcloud (?meta=1 : date seulement)
  if(p==='/api/offline'){let o;try{o=JSON.parse(fs.readFileSync(offF,'utf8'))}catch{return send(res,404,{error:'aucune sauvegarde'})}
    return send(res,200,q('meta')?{date:o.date}:o)}

  await discover();
  if(p==='/api/calendars'){const out=await calList();log('debug','calendriers',{n:out.length});return send(res,200,out)}
  if(p==='/api/events'){
    const cal=q('cal'),s=q('start'),e=q('end'),re=/^\d{8}T\d{6}Z$/;
    if(!okp(cal)||!re.test(s)||!re.test(e)){log('warn','requête events invalide',{cal});return send(res,400,{error:'bad'})}
    const tr=`<c:time-range start="${s}" end="${e}"/>`;let x;
    try{x=await report(cal,'VEVENT',`<c:expand start="${s}" end="${e}"/>`,tr)}
    catch(err){if(err.nc)throw err;log('warn','expand refusé, nouvel essai sans expand (récurrences non développées)',{err:err.message});x=await report(cal,'VEVENT','',tr)}
    const all=items(x),good=all.filter(o=>okp(o.href));
    if(!all.length)log('debug','réponse REPORT sans événement',{debut:x.slice(0,400)});
    if(good.length<all.length)log('warn','href rejetés (hors dossier agendas)',{n:all.length-good.length,exemple:all.find(o=>!okp(o.href)).href,root});
    log('debug','events',{cal,n:good.length,hrefs:good.slice(0,3).map(o=>o.href)});return send(res,200,good)}
  if(p==='/api/tasks'){
    const cal=q('cal');if(!okp(cal))return send(res,400,{error:'bad'});
    return send(res,200,items(await report(cal,'VTODO','','')).filter(o=>okp(o.href)))}
  if(p==='/api/raw'){const h=q('href');if(!okObj(h))return send(res,400,{error:'bad'});
    const r=await dav('GET',h);if(r.status>=500)throw ncErr('GET '+r.status);return send(res,r.ok?200:r.status,{ics:await r.text(),etag:r.headers.get('etag')||''})}
  // écriture / suppression : un objet d'un calendrier seulement (okObj) ; If-Match = rien n'est fait si l'objet a été modifié ailleurs entre-temps (412)
  if(p==='/api/event'&&req.method==='PUT'){
    const b=await jsonBody(req);if(!b)return send(res,400,{error:TX('srv.badRequest')});let href=b.href;
    if(!href){if(!okp(b.cal)||!b.cal.endsWith('/')||!/^[\w-]{8,64}$/.test(b.uid))return send(res,400,{error:'bad'});href=b.cal+b.uid+'.ics'}
    if(!okObj(href)||typeof b.ics!=='string')return send(res,400,{error:'bad'});
    const r=await dav('PUT',href,b.ics,{'Content-Type':'text/calendar; charset=utf-8',...(b.etag?{'If-Match':b.etag}:{'If-None-Match':'*'})});
    if(r.status>=500)throw ncErr('PUT '+r.status);if(r.ok)offSoon();return send(res,r.ok?200:r.status,{ok:r.ok,error:r.ok?undefined:TX(r.status===412?'srv.conflict':'srv.refused')})}
  if(p==='/api/event'&&req.method==='DELETE'){
    const b=await jsonBody(req);if(!b)return send(res,400,{error:TX('srv.badRequest')});if(!okObj(b.href))return send(res,400,{error:'bad'});
    const r=await dav('DELETE',b.href,undefined,typeof b.etag==='string'&&b.etag?{'If-Match':b.etag}:{});if(r.status>=500)throw ncErr('DELETE '+r.status);
    if(r.ok)offSoon();return send(res,r.ok?200:r.status,{ok:r.ok,error:r.ok?undefined:TX(r.status===412?'srv.conflict':'srv.refused')})}
  send(res,404,{error:'not found'});
}catch(e){if(e.nc){log('warn',e.message,{url:req.url.split('?')[0]});return send(res,503,{error:'nextcloud'})}log('error',e.message,{url:req.url});send(res,500,{error:'server'})}});
server.requestTimeout=60000;   // requête entière en 60 s au plus (corps compris)
server.listen(PORT,()=>{setTimeout(extAuto,10000);setInterval(extAuto,3e5);setTimeout(offSave,30000);setInterval(offSave,432e5);const f=scanFonts();
  {const fr=rj(path.join(TXA,'texts_FR.json'),null);if(!fr)log('error','texts/texts_FR.json introuvable ou illisible : les textes affichés seront leurs clés',{dossier:TXA});
   else for(const{code}of langs()){const P=rj(path.join(TXU,`texts_${code}.perso.json`),null);if(!P)continue;const bad=Object.keys(P).filter(k=>!k.startsWith('_')&&!(k in fr));
     if(bad.length)log('warn',`texts_${code}.perso.json : clés inconnues, ignorées (fautes de frappe ?)`,{cles:bad.slice(0,20)})}
   log('info','langues disponibles',{langues:langs().map(l=>l.code).join(', ')})}
  log('info','démarré',{port:PORT,nextcloud:origin+pre,polices:f.ok.length,polices_perso:f.user,fichiers_ignores:f.bad.slice(0,8),erreur_polices:f.user?undefined:f.err&&f.err!=='ENOENT'?f.err:undefined})});
