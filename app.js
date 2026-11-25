/* =====================================================================
   AGENDA — app.js (navigateur)
   Sommaire : 1 Utilitaires & icônes (1b messages, 1c connexion, 1d écran de chargement) · 2 ICS (fuseaux, durées ; 2b répétitions)
              3 État & réglages · 4 Thème · 5 Chargement et actualisation automatique (5b Nextcloud injoignable : mode hors-ligne)
              6 Jour (pastilles, bulle, aperçu) · 7 Mini-calendrier · 8 Menu latéral · 9 Vues mois/année (9b glisser-déposer)
              10 Dialogue évènement (10a rappels, 10b tâches) · 11 Sélecteur de couleur
              12 Paramètres (12b calendriers externes, connexions) · 13 Initialisation, raccourcis (touche ? : raccourcis utiles)
   ===================================================================== */

/* ===== 1. UTILITAIRES & ICÔNES ===== */
const $=s=>document.querySelector(s),pad=n=>String(n).padStart(2,'0');
/* Textes affichés : texts/texts_<LANGUE>.json (+ ajouts et corrections du dossier monté /texts), fusionnés par le serveur et posés dans la page (<script id="tx">).
   T('clé', {nom: valeur}) : texte de la clé, {nom} remplacé ; clé absente = la clé elle-même (repérable à l'écran). LOC = format des dates (Intl).
   Clés ajoutées par le serveur : @lang (langue de la page), @langs (langues disponibles : [{code, name}]), @langSet (langue déjà choisie) */
const TXT=(()=>{try{return JSON.parse(document.getElementById('tx')?.textContent||'{}')}catch{return{}}})();
const T=(k,v={})=>String(TXT[k]??k).replace(/\{(\w+)\}/g,(m,n)=>v[n]!=null?v[n]:m),LOC=TXT.locale||'fr-FR';
const LANGS=Array.isArray(TXT['@langs'])?TXT['@langs']:[];
const mk=(t,c,x)=>{const e=document.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=x;return e};
// Appel à l'API : en cas d'erreur, le message renvoyé par le serveur ({error}) est ajouté à "HTTP xxx"
let AUTHED=false,READY=false;   // connecté au démarrage : une réponse 401 ensuite = session terminée -> rechargement (page de connexion) · READY = premier affichage fait (bascule hors-ligne automatique permise)
// Erreurs : e.status (code HTTP), e.nc (Nextcloud injoignable : 503 du serveur), e.net (serveur de l'agenda injoignable) ;
// messages lisibles pour les cas courants (Nextcloud injoignable, modification faite ailleurs entre-temps)
// FRAMED : agenda affiché dans une iframe (ex. Nextcloud) ; le serveur garde alors un thème choisi à part (en-tête X-Agenda-Ctx)
const FRAMED=(()=>{try{return window.self!==window.top}catch{return true}})();
const api=async(p,o={})=>{try{let r;try{r=await fetch('/api/'+p,{...o,headers:{'X-Requested-With':'cal','Content-Type':'application/json','X-Agenda-Ctx':FRAMED?'frame':'web'}})}
    catch(e){throw Object.assign(new Error(T('api.serverDown')),{net:true})}
  if(r.status===401&&AUTHED){location.reload();return new Promise(()=>{})}
  if(!r.ok){let j=null;try{j=await r.json()}catch{}
    if(r.status===503&&j?.error==='nextcloud'){ncDown();throw Object.assign(new Error(T('api.ncDown')),{status:503,nc:true})}
    if(r.status===412)throw Object.assign(new Error(T('api.conflict')),{status:412});
    throw Object.assign(new Error('HTTP '+r.status+(j?.error?' : '+j.error:'')),{status:r.status})}
  return await r.json()}
  catch(e){console.error('[jolical] /api/'+p.split('?')[0],e.message);throw e}};
const fmtZ=d=>d.getUTCFullYear()+pad(d.getUTCMonth()+1)+pad(d.getUTCDate())+'T'+pad(d.getUTCHours())+pad(d.getUTCMinutes())+pad(d.getUTCSeconds())+'Z';
const fmtD=d=>d.getFullYear()+pad(d.getMonth()+1)+pad(d.getDate());
/* Fuseau horaire : les heures sont écrites dans le fuseau du navigateur (ex. DTSTART;TZID=Europe/Paris:20261023T130000), comme Nextcloud,
   avec un bloc VTIMEZONE ajouté au fichier s'il manque. En UTC (ex. 11:00Z), Nextcloud affichait « UTC / heure locale » et calculait mal les rappels. */
const TZ=(()=>{try{return Intl.DateTimeFormat().resolvedOptions().timeZone||''}catch{return''}})(),useTz=!!TZ&&!/^(UTC|GMT|Etc\/)/i.test(TZ);
const fmtL=d=>fmtD(d)+'T'+pad(d.getHours())+pad(d.getMinutes())+pad(d.getSeconds());
const dtProp=(n,d)=>useTz?`${n};TZID=${TZ}:${fmtL(d)}`:`${n}:${fmtZ(d)}`;
// VTIMEZONE déduit du navigateur : changements d'heure de l'année en cours -> règles annuelles (« dernier dimanche de mars »…)
function vtimezone(){const y=new Date().getFullYear(),off=d=>-d.getTimezoneOffset(),fo=m=>(m<0?'-':'+')+pad(Math.floor(Math.abs(m)/60))+pad(Math.abs(m)%60),WD=['SU','MO','TU','WE','TH','FR','SA'];
  const L=['BEGIN:VTIMEZONE','TZID:'+TZ],tr=[];let prev=off(new Date(y,0,1));
  for(let d=1;d<=366;d++){const o=off(new Date(y,0,d+1));if(o!==prev){let t=+new Date(y,0,d);while(off(new Date(t))===prev)t+=9e5;tr.push({t,from:prev,to:o});prev=o}}
  if(!tr.length)return[...L,'BEGIN:STANDARD','DTSTART:19700101T000000','TZOFFSETFROM:'+fo(prev),'TZOFFSETTO:'+fo(prev),'END:STANDARD','END:VTIMEZONE'];
  for(const x of tr){const w=new Date(x.t+x.from*6e4),mo=w.getUTCMonth(),dd=w.getUTCDate(),wd=w.getUTCDay(),last=dd+7>new Date(Date.UTC(y,mo+1,0)).getUTCDate(),n=last?-1:Math.ceil(dd/7);
    let d0;if(last){d0=new Date(Date.UTC(1970,mo+1,0));while(d0.getUTCDay()!==wd)d0.setUTCDate(d0.getUTCDate()-1)}else{d0=new Date(Date.UTC(1970,mo,1));while(d0.getUTCDay()!==wd)d0.setUTCDate(d0.getUTCDate()+1);d0.setUTCDate(d0.getUTCDate()+7*(n-1))}
    const k=x.to>x.from?'DAYLIGHT':'STANDARD';
    L.push('BEGIN:'+k,'DTSTART:1970'+pad(mo+1)+pad(d0.getUTCDate())+'T'+pad(w.getUTCHours())+pad(w.getUTCMinutes())+'00',`RRULE:FREQ=YEARLY;BYMONTH=${mo+1};BYDAY=${n}${WD[wd]}`,'TZOFFSETFROM:'+fo(x.from),'TZOFFSETTO:'+fo(x.to),'END:'+k)}
  return[...L,'END:VTIMEZONE']}
// Ajoute le VTIMEZONE du navigateur au fichier s'il utilise ce fuseau et ne le contient pas encore
function withTz(ics){if(!useTz||!ics.includes(';TZID='+TZ+':')||ics.split(/\r?\n/).includes('TZID:'+TZ))return ics;
  const i=ics.search(/^BEGIN:(VEVENT|VTODO)$/m);return i<0?ics:ics.slice(0,i)+vtimezone().join('\r\n')+'\r\n'+ics.slice(i)}
const key=d=>d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate());
const inp=(d,all)=>all?key(d):key(d)+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
const pd=v=>new Date(v.length===10?v+'T00:00':v);
const midnight=d=>new Date(d.getFullYear(),d.getMonth(),d.getDate());
const sameDay=(a,b)=>key(a)===key(b);
const cap=s=>s.charAt(0).toUpperCase()+s.slice(1);
const fdate=(d,o)=>cap(d.toLocaleDateString(LOC,o));
const loc=(d,o)=>d.toLocaleDateString(LOC,o);
const wd3=d=>loc(d,{weekday:'short'}).replace('.','').toLowerCase(); // "lun", "mar"...
const hm=d=>T('fmt.hm',{h:pad(d.getHours()),m:pad(d.getMinutes())});   // "19h00"
const tmin=s=>{const[h,m]=String(s||'0:0').split(':');return(+h||0)*60+(+m||0)};   // "13:30" -> 810 (minutes depuis minuit)
const unesc=s=>s.replace(/\\n/gi,'\n').replace(/\\([,;\\])/g,'$1'),esc=s=>s.replace(/\\/g,'\\\\').replace(/\r?\n/g,'\\n').replace(/([,;])/g,'\\$1');
const fam=f=>f.replace(/\.\w+$/,'');
// UUID v4 : getRandomValues marche aussi en HTTP (contrairement à randomUUID)
const uuid=()=>'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=crypto.getRandomValues(new Uint8Array(1))[0]&15;return(c==='x'?r:r&3|8).toString(16)});
// Icônes SVG (mêmes triangles arrondis partout, indépendants de la police)
const SV=(vb,b)=>`<svg class="ico" viewBox="${vb}" aria-hidden="true">${b}</svg>`,TRI=d=>SV('0 0 24 24',`<path d="${d}" fill="currentColor" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>`);
const ICO={l:TRI('M15 5 7 12l8 7z'),r:TRI('M9 5l8 7-8 7z'),d:TRI('M5 8l7 8 7-8z'),
  plus:SV('0 0 24 24','<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/>'),
  imp:SV('0 0 24 24','<path d="M12 3.2 2.6 20h18.8z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/><path d="M12 9.6v4.9" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1.35" fill="currentColor"/>'),
  x:SV('0 0 24 24','<path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" fill="none"/>'),
  eye:SV('0 0 24 24','<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/>'),   // œil ouvert : mot de passe visible
  eyeoff:SV('0 0 24 24','<path d="M3 9.5c2.5 3.3 5.6 5 9 5s6.5-1.7 9-5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M12 14.5v3.2M7.4 13.4l-1.5 2.8M16.6 13.4l1.5 2.8M4 11.4l-2.1 2.1M20 11.4l2.1 2.1" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'),   // œil fermé avec cils : masqué
  dchev:SV('0 0 24 24','<path d="M12.5 6 6.5 12l6 6M18.5 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),   // double chevron « (languette du volet)
  ext:SV('0 0 24 24','<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),   // lien externe
  u:TRI('M5 16l7-8 7 8z'),   // triangle vers le haut (flèches des nombres ; vers le bas : d)
  trash:SV('0 0 24 24','<path d="M4 7h16M10 3.5h4M6.5 7l.9 12.1a1.5 1.5 0 0 0 1.5 1.4h6.2a1.5 1.5 0 0 0 1.5-1.4L17.5 7M10 11v6M14 11v6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'),   // corbeille (glisser-déposer)
  cake:SV('0 0 24 24','<path d="M4 21h16M5 21v-7.5a1.5 1.5 0 0 1 1.5-1.5h11a1.5 1.5 0 0 1 1.5 1.5V21M5 16c1.2 1 2.3 1 3.5 0s2.3-1 3.5 0 2.3 1 3.5 0 2.3-1 3.5 0M12 12V8.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 3c1.2 1.3 1.5 2.5 0 3.6-1.5-1.1-1.2-2.3 0-3.6z" fill="currentColor"/>'),   // gâteau (anniversaires)
  search:SV('0 0 24 24','<circle cx="13.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="3"/><path d="M8.5 15.5 3.5 20.5" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>'),   // loupe (recherche) : verre en haut à droite, manche en bas à gauche
  gear:SV('0 0 189 189','<path fill="currentColor" d="M188.8,87.4l-9.1-33.8c-.8-3-3.8-5-6.9-4.5l-19.2,2.9c-4.6-6.5-10.2-12.1-16.6-16.7l2.9-19.1c.5-3.1-1.5-6.1-4.5-6.9L101.6.2c-3-.8-6.2.8-7.4,3.7l-7,18c-7.8.8-15.4,2.8-22.7,6.1l-15.1-12.1c-2.5-2-6-1.8-8.3.4l-24.8,24.8c-2.2,2.2-2.4,5.8-.4,8.3l12.1,15.1c-3.3,7.3-5.3,14.7-6.1,22.7l-18,7c-2.9,1.1-4.6,4.3-3.7,7.4l9.1,33.8c.8,3,3.8,5,6.9,4.5l19.2-2.9c4.6,6.5,10.2,12.1,16.6,16.7l-2.9,19.1c-.5,3.1,1.5,6.1,4.5,6.9l33.8,9.1c3,.8,6.2-.8,7.4-3.7l7-18c7.8-.8,15.4-2.8,22.7-6.1l15.1,12.1c2.5,2,6,1.8,8.3-.4l24.8-24.8c2.2-2.2,2.4-5.8.4-8.3l-12.1-15.1c3.3-7.3,5.3-14.7,6.1-22.7l18-7c2.9-1.2,4.5-4.3,3.7-7.4ZM94.5,131.7c-20.5,0-37.2-16.6-37.2-37.2s16.6-37.2,37.2-37.2,37.2,16.6,37.2,37.2-16.6,37.2-37.2,37.2Z"/>')};

/* ===== 1b. POP-UPS DE MESSAGE / CONFIRMATION (remplacent alert() et confirm() du navigateur) ===== */
// btns = [[texte, classe, valeur]] ; def = valeur choisie par Entrée (par défaut : dernier bouton)
function popup(msg,btns,def){return new Promise(res=>{const d=$('#dmsg'),row=mk('div','row');let done=false;const fin=v=>{if(done)return;done=true;d.close();res(v)};
  btns.forEach(([t,cls,val])=>{const x=mk('button',cls,t);x.onclick=()=>fin(val);row.append(x)});
  $('#dm').replaceChildren(mk('p','mtext',msg),row);d.onclose=()=>fin(false);
  d.onkeydown=e=>{if(e.key==='Enter'&&!e.target.matches('button')){e.preventDefault();fin(def!==undefined?def:btns.at(-1)[2])}};   // Entrée = dernier bouton (Confirmer / Supprimer / OK) ou « def » ; un bouton choisi au clavier (Tab) garde son rôle
  d.showModal();$('#dm').focus({preventScroll:true})})}   // Échap / clic dehors = annuler
const say=m=>popup(m,[[T('btn.ok'),'pri',true]]);
const ask=(m,ok=T('btn.confirm'),danger)=>popup(m,[[T('btn.cancel'),'',false],[ok,danger?'danger':'pri',true]]);

/* ===== 1c. CONNEXION : page de connexion (mot de passe seul) =====
   Le serveur dit si l'appareil est connecté (/api/session) ; sinon il fournit l'apparence (réglages de mise en page seulement),
   l'éventuel blocage en cours et « ended » (cookie présent mais session terminée : expirée, révoquée, mot de passe changé). */
const devAuto=()=>{const u=navigator.userAgent,ipad=/iPad/.test(u)||/Macintosh/.test(u)&&navigator.maxTouchPoints>1;   // iPadOS se présente comme un Mac
  const os=T('device.'+(ipad?'ipad':/iPhone/.test(u)?'iphone':/Android/.test(u)?(/Mobile/.test(u)?'androidPhone':'androidTablet'):/Macintosh|Mac OS X/.test(u)?'mac':/Windows/.test(u)?'windows':/CrOS/.test(u)?'chromebook':/Linux/.test(u)?'linux':'other'));
  const br=/Edg\//.test(u)?'Edge':/Firefox|FxiOS/.test(u)?'Firefox':/OPR\//.test(u)?'Opera':/Chrome|CriOS/.test(u)?'Chrome':/Safari/.test(u)?'Safari':'';return br?os+' · '+br:os};
const lockDur=ms=>ms>=864e5?T('time.24h'):ms>=36e5?T('time.1h'):T('time.min',{n:Math.round(ms/6e4)});
const cdTxt=ms=>{const s=Math.ceil(ms/1000),m=Math.floor(s/60);return m?T('time.cdMin',{m,s:pad(s%60)}):T('time.cdSec',{s})};   // décompte « 4 min 32 s »
const whenTxt=(t,a)=>{const d=new Date(t),n=new Date(),j=Math.round((midnight(d)-midnight(n))/864e5);
  return T(a?'when.at':'when.plain',{day:j===0?T('when.today'):j===1?T('when.tomorrow'):j===-1?T('when.yesterday'):T('when.on',{date:d.toLocaleDateString(LOC)}),time:hm(d)})};   // a : « aujourd'hui, à 19h36 »
function loginPage(st){S=st.theme||{};theme();document.title=T('login.title');document.body.classList.add('login');$('#loader')?.remove();   // connexion : affichée tout de suite
  const d=$('#dlogin'),p=$('#lgp'),ok=$('#lgok'),err=$('#lgerr'),eye=$('#lgeye');let tm;$('#lgend').hidden=!st.ended;
  const unreach=T('login.unreach');
  // œil : fermé (avec cils) = masqué, ouvert = visible
  const eyeSet=v=>{p.type=v?'text':'password';eye.innerHTML=v?ICO.eye:ICO.eyeoff;eye.title=T(v?'login.hide':'login.show');eye.setAttribute('aria-pressed',v)};
  p.oninput=()=>{if(!p.disabled)err.textContent=''};   // le message disparaît dès qu'on retape
  eyeSet(false);eye.onclick=()=>{eyeSet(p.type==='password');p.focus()};
  // blocage : champ et bouton grisés ; décompte en direct (5 min, 1 h) ou heure de fin (24 h)
  const lock=l=>{clearInterval(tm);const tick=()=>{const r=l.until-Date.now();
      if(r<=0){clearInterval(tm);p.disabled=ok.disabled=false;err.textContent='';p.focus();return}
      p.disabled=ok.disabled=true;err.textContent=l.slow?T('login.slow',{t:cdTxt(r)}):l.long?T('login.lockUntil',{when:whenTxt(l.until)}):T('login.lock',{t:cdTxt(r)})};
    tick();tm=setInterval(tick,1000)};
  $('#lgf').onsubmit=async e=>{e.preventDefault();if(ok.disabled)return;if(!p.value){err.textContent=T('login.empty');p.focus();return}
    ok.disabled=true;err.textContent='';
    try{const r=await fetch('/api/login',{method:'POST',headers:{'X-Requested-With':'cal','Content-Type':'application/json'},body:JSON.stringify({password:p.value,name:devAuto()})}),j=await r.json().catch(()=>({}));
      if(r.ok){location.replace('/');return}
      if(j.error==='slow')return lock({...j,slow:true});   // ralentissement général (attaque répartie) : quelques secondes, mot de passe gardé
      p.value='';
      if(j.error==='lock')return lock(j);   // ralentissement général (attaque répartie) : quelques secondes
      err.textContent=j.error==='bad'?T(j.left>1?'login.bad':'login.badLast',{n:j.left,dur:lockDur(j.next)}):r.status>=502?unreach:T('login.err',{e:j.error||'HTTP '+r.status})}
    catch{err.textContent=unreach}
    ok.disabled=false;p.focus()};
  d.addEventListener('cancel',e=>e.preventDefault());   // Échap ne ferme pas la page de connexion
  d.showModal();if(st.lock)lock(st.lock);else setTimeout(()=>p.focus(),animOn('pop')?330*AKP():0)}

/* ===== 1d. ÉCRAN DE CHARGEMENT : retiré en fondu quand le premier mois est affiché (au plus tard 10 s après le démarrage) ===== */
function ldDone(){const l=$('#loader');if(!l||l._d)return;l._d=true;l.removeAttribute('aria-busy');l.style.animation='none';l.style.pointerEvents='none';   // sécurité CSS coupée
  if(!animOK()||!l.animate)return l.remove();
  // en deux temps : le titre s'efface, puis le fond, un peu après et plus lentement
  // opacité finale posée AVANT le fondu et respiration CSS coupée : rien ne peut faire revenir le titre (Safari / iPad le réaffichait quelques images)
  // Safari : plus d'opacité imbriquée (fondu du titre DANS un conteneur lui-même en fondu = titre réaffiché quelques images) : le fond s'efface par sa couleur
  const k=AK(),t=l.querySelector('b'),bg=getComputedStyle(l).backgroundColor;
  if(t){const o=getComputedStyle(t).opacity;t.style.animation='none';t.style.opacity='0';t.animate([{opacity:o},{opacity:0}],{duration:450*k,easing:'ease',fill:'forwards'}).onfinish=()=>{t.style.visibility='hidden'}}
  l.style.backgroundColor='transparent';l.animate([{backgroundColor:bg},{backgroundColor:'transparent'}],{duration:2000*k,delay:200*k,easing:'ease',fill:'backwards'}).onfinish=()=>l.remove();setTimeout(()=>l.remove(),4000)}
setTimeout(ldDone,10000);

/* ===== 2. ICS : lecture et modification ===== */
/* Fuseaux horaires (même calcul que le serveur) : une heure écrite « TZID=America/New_York:…T090000 » est convertie en instant réel ;
   fuseau inconnu ou absent (heure « flottante ») : heure du navigateur. Quelques noms Windows (Outlook) sont reconnus. */
const TZF=new Map(),WINTZ={'Romance Standard Time':'Europe/Paris','W. Europe Standard Time':'Europe/Berlin','Central Europe Standard Time':'Europe/Budapest','GMT Standard Time':'Europe/London','UTC':'UTC','Eastern Standard Time':'America/New_York','Pacific Standard Time':'America/Los_Angeles'};
const tzOff=(z,ms)=>{let f=TZF.get(z);if(f===undefined){try{f=new Intl.DateTimeFormat('en-US',{timeZone:z,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'})}catch{f=null}TZF.set(z,f)}
  if(!f)return null;const p=Object.fromEntries(f.formatToParts(new Date(ms)).map(x=>[x.type,x.value]));return Date.UTC(+p.year,+p.month-1,+p.day,+p.hour%24,+p.minute,+p.second)-ms};
const tzOf=t=>{if(!t)return'';if(WINTZ[t])return WINTZ[t];const m=t.match(/[A-Za-z]+\/[A-Za-z_+-]+(?:\/[A-Za-z_+-]+)?$/);return m&&tzOff(m[0],0)!==null?m[0]:''};
// heure « murale » dans le fuseau z -> instant (ms)
const wallUtc=(a,z)=>{if(z==='UTC')return Date.UTC(...a);const g=Date.UTC(...a),u=g-tzOff(z,g);return g-tzOff(z,u)};
function pdate(v,par=''){
  if(/VALUE=DATE(?!-)/.test(par)||v.length===8)return{d:new Date(+v.slice(0,4),+v.slice(4,6)-1,+v.slice(6,8)),all:true};
  const a=[+v.slice(0,4),+v.slice(4,6)-1,+v.slice(6,8),+v.slice(9,11),+v.slice(11,13),+v.slice(13,15)];if(v.endsWith('Z'))return{d:new Date(Date.UTC(...a)),all:false};
  const z=tzOf((par.match(/TZID=([^;:]+)/)||[])[1]);return{d:z&&z!==TZ?new Date(wallUtc(a,z)):new Date(...a),all:false}}   // fuseau du navigateur : lecture directe
// Durée iCalendar (DURATION:P1DT2H) -> fin à partir du début : jours « nominaux » (calendrier), heures / minutes / secondes en temps réel
function addDur(d,v){const m=String(v||'').match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);if(!m)return null;const k=m[1]==='-'?-1:1;
  const e=new Date(d.getFullYear(),d.getMonth(),d.getDate()+k*((+m[2]||0)*7+(+m[3]||0)),d.getHours(),d.getMinutes(),d.getSeconds());return new Date(+e+k*((+m[4]||0)*36e5+(+m[5]||0)*6e4+(+m[6]||0)*1e3))}
// alarms = rappels (VALARM) du composant : [{TRIGGER, ACTION, X-AGENDA-REMINDER…}]
function parse(ics,comp='VEVENT'){const out=[];let ev=null,depth=0,al=null;
  for(const l of ics.replace(/\r?\n[ \t]/g,'').split(/\r?\n/)){
    if(l==='BEGIN:'+comp){ev={};depth=0;continue}if(!ev)continue;
    if(l==='END:'+comp){if(comp==='VTODO'){ev.done=ev.status==='COMPLETED';out.push(ev)}
      else if(ev.start){ev.end=ev.end||(ev.dur&&addDur(ev.start,ev.dur))||(ev.allDay?new Date(ev.start.getFullYear(),ev.start.getMonth(),ev.start.getDate()+1):ev.start);delete ev.dur;out.push(ev)}ev=null;continue}   // fin : DTEND, sinon DURATION, sinon 1 jour (journée entière) ou instantané
    if(l.startsWith('BEGIN:')){depth++;if(depth===1&&l==='BEGIN:VALARM')al={};continue}
    if(l.startsWith('END:')){if(depth===1&&al){(ev.alarms=ev.alarms||[]).push(al);al=null}depth--;continue}
    if(depth){if(al&&depth===1){const j=l.indexOf(':');al[l.slice(0,j).split(';')[0]]=l.slice(j+1)}continue}
    const i=l.indexOf(':'),[n,...p]=l.slice(0,i).split(';'),v=l.slice(i+1);
    if(n==='SUMMARY')ev.title=unesc(v);else if(n==='LOCATION')ev.loc=unesc(v);else if(n==='DESCRIPTION')ev.desc=unesc(v);
    else if(n==='STATUS')ev.status=v;else if(n==='DUE'){const r=pdate(v,p.join(';'));ev.due=r.d;ev.dueAll=r.all}
    else if(n==='RECURRENCE-ID'){ev.rec=true;ev.recId=pdate(v,p.join(';')).d}   // occurrence d'une série : date d'origine
    else if(n==='RRULE'){ev.rec=true;ev.rrule=v}
    else if(n==='X-AGENDA-BIRTHYEAR')ev.byear=+v;   // anniversaire : année de naissance (âge)
    else if(n==='CATEGORIES')(ev.cats=ev.cats||[]).push(...v.split(/(?<!\\),/).map(x=>unesc(x).trim()).filter(Boolean));   // tags (plusieurs lignes possibles)
    else if(n==='DTSTART'){const r=pdate(v,p.join(';'));ev.start=r.d;ev.allDay=r.all}
    else if(n==='DTEND')ev.end=pdate(v,p.join(';')).d;else if(n==='DURATION')ev.dur=v}
  return out}
// Remplace uniquement les propriétés données du composant (alarmes, invités... conservés)
/* ===== 2b. ÉVÈNEMENTS RÉPÉTÉS (série = VEVENT avec RRULE ; occurrences modifiées ailleurs = VEVENT avec RECURRENCE-ID, conservés) ===== */
// Range les VEVENT : la série (sans RECURRENCE-ID) en premier. sansOcc = supprime les occurrences modifiées (série redevenue simple)
function masterFirst(raw,sansOcc=false){const rest=[],blk=[];let cur=null,depth=0;
  for(const l of raw.split(/\r?\n/)){if(cur){cur.push(l);if(/^BEGIN:/.test(l))depth++;else if(/^END:/.test(l)&&!--depth){blk.push(cur);cur=null}continue}
    if(l==='BEGIN:VEVENT'){cur=[l];depth=1;continue}if(l)rest.push(l)}
  const occ=b=>b.some(x=>x.startsWith('RECURRENCE-ID'));let ev=[...blk.filter(b=>!occ(b)),...blk.filter(occ)];if(sansOcc&&ev.some(b=>!occ(b)))ev=ev.filter(b=>!occ(b));
  const i=rest.lastIndexOf('END:VCALENDAR');rest.splice(i<0?rest.length:i,0,...ev.flat());return rest.join('\r\n')+'\r\n'}
// Décale EXDATE et RECURRENCE-ID quand le début de la série change (sinon les occurrences supprimées ou modifiées ne correspondent plus)
function shiftDates(raw,ms){if(!ms)return raw;const days=Math.round(ms/864e5);
  return raw.split(/\r?\n/).map(l=>{const m=l.match(/^(EXDATE|RECURRENCE-ID)([^:]*):(.*)$/);if(!m)return l;
    return m[1]+m[2]+':'+m[3].split(',').map(v=>{if(/^\d{8}$/.test(v)){const d=pd(v.slice(0,4)+'-'+v.slice(4,6)+'-'+v.slice(6,8));d.setDate(d.getDate()+days);return fmtD(d)}
      if(v.endsWith('Z'))return fmtZ(new Date(+pdate(v,m[2]).d+ms));   // heure UTC : décalage réel
      const w=new Date(Date.UTC(+v.slice(0,4),+v.slice(4,6)-1,+v.slice(6,8),+v.slice(9,11),+v.slice(11,13),+v.slice(13,15))+ms);   // heure « murale » (fuseau d'origine conservé) : même décalage
      return w.toISOString().replace(/[-:]/g,'').slice(0,15)}).join(',')}).join('\r\n')}
// EXDATE ajoutée à la série pour supprimer une seule occurrence (même forme que DTSTART : date, fuseau ou UTC)
function addExdate(raw,occ){const ev=raw.slice(raw.indexOf('BEGIN:VEVENT')),t=ev.match(/^DTSTART([^:\r\n]*):([^\r\n]*)/m),   // DTSTART de la série (pas celui du fuseau horaire)
  par=t?t[1]:'',tz=(par.match(/TZID=([^;:]+)/)||[])[1];
  const line=/VALUE=DATE(?!-)/.test(par)||(t&&t[2].length===8)?'EXDATE;VALUE=DATE:'+fmtD(occ):tz&&tz===TZ?`EXDATE;TZID=${tz}:${fmtL(occ)}`:'EXDATE:'+fmtZ(occ);
  let done=false;return raw.split(/\r?\n/).flatMap(l=>{if(!done&&l==='END:VEVENT'){done=true;return[line,l]}return[l]}).join('\r\n')}
// Supprime le bloc « occurrence modifiée » correspondant à cette date d'origine
function dropOcc(raw,occ){const rest=[];let cur=null,depth=0;
  for(const l of raw.split(/\r?\n/)){if(cur){cur.push(l);if(/^BEGIN:/.test(l))depth++;else if(/^END:/.test(l)&&!--depth){const r=cur.find(x=>x.startsWith('RECURRENCE-ID'));
      if(!(r&&+pdate(r.split(':').pop(),r.split(':')[0])?.d===+occ))rest.push(...cur);cur=null}continue}
    if(l==='BEGIN:VEVENT'){cur=[l];depth=1;continue}rest.push(l)}
  return rest.join('\r\n')}
const WDS=['MO','TU','WE','TH','FR','SA','SU'],WDL=T('days.short').split(',');   // lun. → dim.
// RRULE -> {f, i, days[], end:'', 'until', 'count', until:Date, count, custom} ; custom = règle non représentable ici (gardée telle quelle)
function rrParse(s){const r={};for(const p of String(s||'').split(';')){const[a,b]=p.split('=');if(a&&b)r[a.toUpperCase()]=b}
  const o={f:r.FREQ||'',i:+r.INTERVAL||1,days:r.BYDAY?r.BYDAY.split(','):[],end:r.UNTIL?'until':r.COUNT?'count':'',count:+r.COUNT||10,until:r.UNTIL?pdate(r.UNTIL,'').d:null};
  o.custom=!['DAILY','WEEKLY','MONTHLY','YEARLY'].includes(o.f)||Object.keys(r).some(k=>!['FREQ','INTERVAL','UNTIL','COUNT','WKST',...(o.f==='WEEKLY'?['BYDAY']:[])].includes(k))||o.days.some(d=>!WDS.includes(d));return o}
function rrText(s){const o=rrParse(s);if(!['DAILY','WEEKLY','MONTHLY','YEARLY'].includes(o.f)||o.custom)return T('rr.custom');
  let t=T('rr.'+o.f+(o.i>1?'.n':''),{n:o.i});   // « tous les jours » / « tous les 3 jours »
  if(o.f==='WEEKLY'&&o.days.length)t+=T('rr.days',{days:WDS.filter(d=>o.days.includes(d)).map(d=>WDL[WDS.indexOf(d)]).join(', ')});
  if(o.end==='until')t+=T('rr.until',{date:o.until.toLocaleDateString(LOC)});else if(o.end==='count')t+=T('rr.count',{n:o.count});return t}

function patch(raw,comp,props,rm=[]){const out=[];let inC=false,depth=0,skip=false,nth=0;   // seulement le 1er composant (série en tête : masterFirst)
  const names=new RegExp('^('+[...props.map(p=>p.split(/[;:]/)[0]),...rm,...(comp==='VEVENT'?['DURATION']:[])].join('|')+')[;:]');
  for(const l of raw.split(/\r?\n/)){
    if(/^[ \t]/.test(l)){if(!skip)out.push(l);continue}skip=false;
    if(l==='BEGIN:'+comp){inC=++nth===1;depth=0}
    else if(inC&&l==='END:'+comp){out.push(...props);inC=false}
    else if(inC&&l.startsWith('BEGIN:'))depth++;
    else if(inC&&l.startsWith('END:'))depth--;
    else if(inC&&!depth&&names.test(l)){skip=true;continue}
    if(l)out.push(l)}
  return out.join('\r\n')+'\r\n'}

/* ===== 3. ÉTAT & RÉGLAGES ===== */
// Tags gérés par l'interface (CATEGORIES de l'ICS, comparaison sans tenir compte des majuscules). Pour en ajouter un : TAGS + son effet.
// Les noms des tags sont des DONNÉES (écrits tels quels dans les évènements, CATEGORIES) : ils ne changent pas avec la langue (texts_*.json) ; seul leur libellé affiché (tagLbl) en vient
const TAG={imp:'Important',big:'Double taille',year:'Vue Année'},TAGS=Object.values(TAG);   // ordre = ordre d'affichage
const tagLbl=t=>T('tag.'+Object.keys(TAG).find(k=>TAG[k]===t));
const hasTag=(v,t)=>!!v&&(v.cats||[]).some(c=>c.toLowerCase()===t.toLowerCase());
const isBig=v=>hasTag(v,TAG.big);
// Calendriers externes : jours fériés (évènements + fonds) et vacances (fonds). HOLCAL = pseudo-calendrier du menu latéral (lecture seule)
let xcals=[];   // calendriers externes ajoutés : {href:'ext:c:<id>', id, name, color, url, meta, ro, ext, on}
let hols=[],holMap=new Map(),vacSet=new Set();const HOLCAL={href:'ext:hol',name:T('cal.hol'),color:'#c0392b',ro:true,ext:true,on:true};
let OFF=null,offE=null;   // mode hors-ligne : sauvegarde du serveur (lecture seule) et ses évènements déjà lus
let mCur=null,dprSeen=0,cals=[],events=[],tasks=[],view='month',prevView='month',cur=new Date(),miniD=new Date(),editing=null,S={},fail=false,bubKey='',yrCustom=false,durMs=3600000;
const WD=['#4f8cff','#e67e22','#27ae60','#9b59b6','#e74c3c','#16a085','#d35400']; // fonds par défaut lun→dim
// Valeurs par défaut (S = ce que l'utilisateur a modifié)
const DEF={title:T('app.defaultTitle'),lang:T('@lang'),setAdv:false,fontSize:14,dens:3,maxEv:5,weekGap:6,calPad:12,calPadM:4,hdRadius:10,evRadius:4,evPad:2,popPad:18,grpOp:0,bubR:10,evSh:0,evDur:60,startView:'month',abbr:'always',
  sizeTitle:30,sizeSub:12,casTitle:'first',casSub:'upper',casCal:'lower',casBtn:'first',bdayMonth:true,bdayYear:true,muteBg:'#9aa3ad',muteOp:55,recOp:70,shadow:'#000000',shadowOp:25,todayBg:'#e74c3c',todayFg:'#ffffff',popBg:'#000000',popOp:45,blur:4,vacBg:'#f6d365',holBg:'#f5a3a3',fabSize:100,
  evFg:'#ffffff',evAuto:false,evLum:0,dotLum:0,dotSize:80,                 // évènements : couleur du nom (ou automatique), luminosité ; pastilles (Année/mini) : luminosité, taille (% de la case)
  bHm:'lum',bHv:-10,cHm:'acc',cHv:18,gHm:'acc',gHv:18,eHm:'none',eHv:0,dHm:'none',dHv:0,tHm:'none',tHv:0,fHm:'none',fHv:0,   // survol par famille (mode + intensité)
  hdBp:900,                                                   // largeur (px) à partir de laquelle l'en-tête tient sur une ligne
  remTime:'08:30',                                           // rappels : heure « le jour-même / la veille… »
  srT:true,srL:false,srD:false,srF:true,srP:true,srK:true,animTitle:false,   // recherche : titres seulement, futurs et passés · animation des titres (désactivée)
  toolsName:T('side.tools'),toolsCal:true,toolsDeck:true,toolsTasks:true,dayC1:'#8e44ad',dayC2:'#27ae60',dayC3:'#2980b9',   // Outils : liens Nextcloud affichés · couleurs personnalisées des jours
  anim:true,animSpeed:'normal',animView:true,animSwipe:'o',animSwipeAll:false,animSide:true,animFold:true,animPop:'os',animHov:true,animLift:true,animFab:true,animDot:true,   // animations
  pmStart:'13:30',evStart:'18:00',minM:2,minA:2,minS:1,       // sections du jour (vue Mois) : heures de début + hauteurs minimales (en évènements)
  sepOp:100,sepW:1,                                           // pointillés entre les sections
  holMonth:true,holYear:true,vacMonth:true,vacYear:true,vacCut:false,extOp:30,holEv:'#c0392b',extEvery:'quarter',   // calendriers externes (+ fréquence de mise à jour)
  ncOp:50,yrMax:3,bigRadius:4,showTags:true};                // opacité des évènements provisoires / annulés · regroupement « Vue Année » · radius « Double taille » · tags dans l'aperçu
// 5 familles : g=Général, b=Boutons, c=Calendriers, p=Pop-up, f=Champs -> opacité, épaisseur, radius, ombre (par défaut : ombre sur Général et Pop-up)
for(const x of'gbcpf')Object.assign(DEF,{[x+'Bo']:100,[x+'Bw']:1,[x+'Br']:10,[x+'Sh']:x==='g'||x==='p'?12:0});   // ombre : taille en px (0 = aucune)
const get=k=>S[k]??DEF[k],wdc=i=>S.wd?.[i]||WD[i],wfc=i=>S.wdf?.[i]||'#ffffff';
// Animations : actives si la case est cochée et si le système ne demande pas de les réduire ; AK = facteur de vitesse
const RM=window.matchMedia?.('(prefers-reduced-motion: reduce)');
const animOK=()=>!!get('anim')&&!RM?.matches,AK=()=>({fast:.42,normal:.65,slow:1}[get('animSpeed')]||.65),animOn=f=>document.body.classList.contains('an-'+f);
const AKP=()=>AK()*1.54;   // ouverture des pop-up : une vitesse plus lente que les autres animations (même valeur que --akp en CSS)
let BS=[[],{}],thSync=null;   // arguments de buildSettings (polices, calendriers externes) · mise à jour de la liste des thèmes
// sauvegarde : le serveur range chaque réglage (généraux / thème) ; une modification de l'apparence crée une copie « (modifié) » du thème : la liste suit + message
let tmr;const saveS=()=>{clearTimeout(tmr);tmr=setTimeout(()=>api('settings',{method:'PUT',body:JSON.stringify(S)}).then(thAfter).catch(()=>say(T('settings.saveErr'))),400)};
const thAfter=r=>{if(!r)return;if(r.theme&&r.theme!==S.theme){S.theme=r.theme;thSync?.()}};   // copie « (modifié) » créée : la liste des thèmes suit (sans message)
// petite fenêtre de saisie (nom d'un thème) : Entrée = OK, Échap = Annuler ; renvoie le texte ou null
function promptBox(msg,val='',ok=T('btn.ok')){return new Promise(res=>{const d=$('#dmsg'),row=mk('div','row'),i=mk('input'),c=mk('button',null,T('btn.cancel')),o=mk('button','pri',ok);let done=false;
  const fin=v=>{if(done)return;done=true;d.close();res(v)};i.type='text';i.maxLength=60;i.value=val;i.className='pin';c.onclick=()=>fin(null);o.onclick=()=>fin(i.value.trim()||null);row.append(c,o);
  $('#dm').replaceChildren(mk('p','mtext',msg),i,row);d.onclose=()=>fin(null);d.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();o.click()}};d.showModal();setTimeout(()=>{i.focus();i.select()},60)})}
const upd=(k,v)=>{v===''||v==null?delete S[k]:S[k]=v;theme();saveS()};

/* ===== 4. THÈME : applique les réglages en variables CSS ===== */
function fitTitle(){const t=$('#sidetitle');if(!t||!t.clientWidth)return;let s=34;t.style.fontSize=s+'px';while(t.scrollWidth>t.clientWidth&&s>10)t.style.fontSize=(--s)+'px'} // titre du menu : pleine largeur
// En-tête sur une ligne au-delà de "hdBp" px (les media queries CSS ne lisent pas les variables : on bascule une classe)
// Le passage 1 ligne <-> 2 lignes est animé : chaque bloc (☰, navigation, titre, vues) glisse de son ancienne à sa nouvelle place,
// et l'espace sous l'en-tête (marge animée) suit, pour que le calendrier monte / descende en douceur. Pas d'animation au 1er affichage.
let wideOnce=false;
const wide=()=>{const m=$('main'),b=document.body;if(!m||!m.clientWidth)return;const w=m.clientWidth>=get('hdBp');   // largeur de la zone principale (volet latéral déduit)
  if(b.classList.contains('wide')===w){wideOnce=true;return}
  const hd=$('header'),els=['#burger','#nav','#title','#tabs'].map(s=>$(s)),go=wideOnce&&animOK()&&hd.animate;wideOnce=true;
  const c=e=>{const r=e.getBoundingClientRect();return[r.left+r.width/2,r.top+r.height/2]},r0=go&&els.map(c),h0=hd.offsetHeight;
  b.classList.toggle('wide',w);if(!go)return;
  const o={duration:380*AK(),easing:'cubic-bezier(.3,.9,.3,1)'};
  els.forEach((e,i)=>{const[x,y]=c(e),dx=r0[i][0]-x,dy=r0[i][1]-y;if(Math.abs(dx)+Math.abs(dy)>.5)e.animate([{transform:`translate(${dx}px,${dy}px)`},{transform:'none'}],o)});
  const dh=h0-hd.offsetHeight;if(dh)hd.animate([{marginBottom:dh+'px'},{marginBottom:'0px'}],o)};
function theme(){const r=document.documentElement.style,v=(k,x)=>x!=null&&x!==''?r.setProperty(k,x):r.removeProperty(k),px=(k,n)=>r.setProperty(k,get(n)+'px'),fm=(k,f)=>v(k,f&&`"${fam(f)}",system-ui,sans-serif`);
  v('--acc',S.accent);
  if(S.bg){const n=parseInt(S.bg.slice(1),16),l=((n>>16)*299+((n>>8&255)*587)+(n&255)*114)/1000;v('--bg',S.bg);v('--fg',l>140?'#1c2025':'#e6e8eb')}else{v('--bg');v('--fg')}
  if(S.colText)r.setProperty('--fg',S.colText);
  v('--sbg',S.sideBg);v('--ldbg',S.ldBg);v('--ldc',S.ldFg||S.colTitle);v('--tc',S.colTitle);v('--tcp',S.colPanel);v('--tcd',S.colPop);v('--sc',S.colSub);v('--mut',S.muteFg);v('--grp',S.grpBg);v('--mnc',S.monthCol);v('--todoc',S.todoCol);v('--donec',S.doneCol);
  v('--bm-fg',S.bmFg);v('--bm-bg',S.bmBg);v('--danger',S.dangerBg);v('--dangerfg',S.dangerFg);v('--dangerbc',S.dangerBc);
  const SH=n=>n>0?`0 ${(n/3).toFixed(1)}px ${n}px var(--shd)`:'';   // ombre de n px
  for(const x of'gbcpf'){v(`--${x}-fg`,S[x+'Fg']);v(`--${x}-bg`,S[x+'Bg']);v(`--${x}-bc`,S[x+'Bc']);
    r.setProperty(`--${x}-bo`,get(x+'Bo')+'%');px(`--${x}-bw`,x+'Bw');px(`--${x}-br`,x+'Br');r.setProperty(`--${x}-sh`,SH(+get(x+'Sh'))||'0 0 0 transparent')}
  {const p=devicePixelRatio||1,v=+get('cBw');r.setProperty('--c-bw',(v>0?Math.max(1,Math.floor(v*p+.01))/p:0)+'px');dprSeen=p}   // bordures des calendriers en pixels d'écran entiers (mise à l'échelle 125 / 175 %…) : en-têtes arrondis et jours ont le même trait
  r.setProperty('--ev-sh',SH(+get('evSh'))||'none');
  px('--fs','fontSize');px('--dn','dens');px('--wgap','weekGap');px('--calpad','calPad');px('--calpadm','calPadM');px('--hr','hdRadius');px('--evr','evRadius');px('--evpad','evPad');px('--ppad','popPad');
  {const C={first:['none','uppercase'],words:['capitalize','uppercase'],lower:['lowercase','lowercase'],upper:['uppercase','uppercase']};   // casse : [texte, 1re lettre]
    for(const[k,x]of[['casTitle','t'],['casSub','s'],['casCal','c'],['casBtn','b']]){const c=C[get(k)]||C.first;r.setProperty('--cas'+x,c[0]);r.setProperty('--cas'+x+'1',c[1])}}
  px('--blur','blur');px('--tt','sizeTitle');px('--st','sizeSub');px('--sepw','sepW');r.setProperty('--sepop',get('sepOp')+'%');
  const mix=(c,o)=>`color-mix(in srgb,${c} ${o}%,transparent)`;
  r.setProperty('--muteop',get('muteOp')/100);r.setProperty('--recop',get('recOp')/100);r.setProperty('--ncop',get('ncOp')/100);r.setProperty('--bigr',get('bigRadius')+'px');r.setProperty('--grpo',get('grpOp')+'%');r.setProperty('--bubr',get('bubR')+'px');
  // Luminosité : + = mélange avec du blanc, − = avec du noir
  const L=(p,n)=>{r.setProperty(p+'-lm',n<0?'black':'white');r.setProperty(p+'-lp',Math.abs(n)+'%')};L('--ev',get('evLum'));L('--dot',get('dotLum'));
  // Provisoire (formulaire) : couleur principale assombrie de 50 % si elle est claire, éclaircie de 50 % si elle est foncée
  {const ac=S.accent||'#4f8cff',lt=autoFg(ac,0)!=='#ffffff';r.setProperty('--tent-bg',`color-mix(in srgb,var(--acc),${lt?'black':'white'} 50%)`);r.setProperty('--tent-fg',lt?'#ffffff':'#1c2025')}
  // Animations : classes sur <body> (voir index.html section 8b)
  {const on=animOK(),B=document.body.classList,pm=get('animPop');B.toggle('an',on);B.toggle('an-pop',on);
   for(const[f,k]of[['side','animSide'],['fold','animFold'],['hov','animHov'],['lift','animLift'],['fab','animFab'],['dot','animDot']])B.toggle('an-'+f,on&&!!get(k));
   r.setProperty('--ak',AK());B.toggle('an-view',on&&!!get('animView'));B.toggle('an-title',on&&!!get('animTitle'));r.setProperty('--po0',pm==='s'?1:0);r.setProperty('--ps0',pm==='o'?1:.92);r.setProperty('--dotk',100/get('dotSize'))}
  r.setProperty('--dotsz',get('dotSize')+'%');r.setProperty('--evfg',get('evFg'));r.setProperty('--fabk',get('fabSize')/100);
  // Survol : aucun = transparent 0 % · luminosité = blanc/noir · couleur principale = --acc (0 à 100 %)
  for(const x of'bcedtfg'){const m=get(x+'Hm'),n=get(x+'Hv');r.setProperty(`--${x}-hm`,m==='lum'?(n<0?'black':'white'):m==='acc'?'var(--acc)':'transparent');
    r.setProperty(`--${x}-hp`,m==='lum'?Math.abs(n)+'%':m==='acc'?Math.max(0,n)+'%':'0%')}
  r.setProperty('--mute',get('muteBg'));r.setProperty('--mutehd',S.muteFg||'#ffffff');r.setProperty('--shd',mix(get('shadow'),get('shadowOp')));r.setProperty('--ovl',mix(get('popBg'),get('popOp')));
  for(const n of[1,2,3])r.setProperty('--cc'+n,get('dayC'+n));r.setProperty('--today',get('todayBg'));r.setProperty('--todayfg',get('todayFg'));r.setProperty('--vac',get('vacBg'));r.setProperty('--hol',get('holBg'));r.setProperty('--extop',get('extOp')+'%');HOLCAL.color=get('holEv');
  for(let i=0;i<7;i++){r.setProperty('--wd'+i,wdc(i));r.setProperty('--wf'+i,wfc(i))}
  fm('--ft',S.fontTitle);fm('--fsb',S.fontSub);fm('--fx',S.fontText);fm('--fk',S.fontTask);fm('--fh',S.fontHead);v('--hs',S.sizeHead!=null?S.sizeHead+'px':'');   // en-têtes : sous-titres par défaut
  $('#ff').textContent=[...new Set([S.fontTitle,S.fontSub,S.fontText,S.fontTask,S.fontHead].filter(Boolean))].map(f=>`@font-face{font-family:"${fam(f)}";src:url(/fonts/${encodeURIComponent(f)})}`).join('');
  $('#cc').textContent=S.css||'';document.title=$('#sidetitle').textContent=get('title');wide();fitTitle();fitHeads();tabSize();document.fonts?.ready.then(tabSize)}
// Onglets à picto (Anniversaires, Paramètres) : ronds, de la hauteur de l'onglet « Mois » (police et taille des boutons comprises)
function tabSize(){const r=$('.tab[data-v="month"]')?.getBoundingClientRect();if(r?.height)$('#tabs').style.setProperty('--tabih',r.height+'px')}
// Titre de la vue (#title). « Animation des titres » : petit saut quand le texte change (autre mois / année / vue, Paramètres).
// Appelé dès le clic par fadeSwap (le nouveau mois / la nouvelle vue est connu avant le chargement des évènements), puis par render() (rien ne bouge alors) ; pas au premier affichage
function titleNow(){const tt=$('#title'),nt=view==='month'?fdate(cur,{month:'long',year:'numeric'}):view==='year'?yearLabel():view==='bday'?T('view.bday'):T('view.settings');
  if(tt.textContent===nt)return;tt.textContent=nt;if(READY&&animOn('title')){tt.classList.remove('hop');void tt.offsetWidth;tt.classList.add('hop')}}
// Shrink des évènements « Double taille » : police réduite (9 px minimum) jusqu'à ce que le nom tienne sur ses 2 lignes, sans mot coupé (sinon « … »)
function fitBigs(){for(const t of document.querySelectorAll('.sec .ev.big .t')){t.style.fontSize='';if(!t.clientWidth)continue;let s=parseFloat(getComputedStyle(t).fontSize)||13;
  while((t.scrollHeight>t.clientHeight+1||t.scrollWidth>t.clientWidth+1)&&s>9){s-=.5;t.style.fontSize=s+'px'}}}
// Shrink des en-têtes de la vue Mois : une taille commune, réduite pour que l'en-tête le plus large tienne dans sa case (8 px minimum)
function fitHeads(){const g=$('#grid'),hs=[...document.querySelectorAll('.week .dh span:not(.bdi)')];if(!g)return;g.style.removeProperty('--hsfit');if(!hs.length||!g.clientWidth)return;
  const base=parseFloat(getComputedStyle(hs[0]).fontSize)||12;let r=1;
  for(const s of hs){const d=s.parentNode,cs=getComputedStyle(d),room=d.clientWidth-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight);if(s.offsetWidth>room&&room>0)r=Math.min(r,room/s.offsetWidth)}
  if(r<1)g.style.setProperty('--hsfit',Math.max(8,Math.floor(base*r*10)/10-.2)+'px');
  for(const i of g.querySelectorAll('.dh .bdi')){i.classList.remove('bdx');const t=i.parentNode.firstChild;if(t?.getBoundingClientRect&&i.getBoundingClientRect().left<t.getBoundingClientRect().right+2)i.classList.add('bdx')}}   // picto anniversaire masqué s'il touche le texte
// Colonnes de la vue Mois calées sur les pixels de l'écran : sinon les bordures arrondies des en-têtes (dessinées avec anticrénelage)
// tombent entre deux pixels et paraissent plus épaisses / décalées d'1 px par rapport aux bordures des jours
function snapCols(){const g=$('#grid'),w=g?.querySelector('.week');if(!w)return;const r=w.getBoundingClientRect(),p=devicePixelRatio||1;if(!r.width)return g.style.removeProperty('--wcols');
  const c=[];let prev=0;for(let k=1;k<7;k++){const b=Math.round((r.left+k*r.width/7)*p)/p-r.left;c.push((b-prev).toFixed(3)+'px');prev=b}
  g.style.setProperty('--wcols',c.join(' ')+' minmax(0,1fr)')}
if(window.ResizeObserver)new ResizeObserver(()=>snapCols()).observe($('#grid'));

/* ===== 5. CHARGEMENT des évènements et des tâches ===== */
const gs=d=>{const f=new Date(d.getFullYear(),d.getMonth(),1);return new Date(f.getFullYear(),f.getMonth(),1-(f.getDay()+6)%7)}; // lundi de la 1re semaine affichée
const gridStart=()=>gs(cur);
// Vue année : "personnalisée" (2 mois avant, mois courant, 9 mois après) via le bouton Année / Aujourd'hui ; ensuite années civiles
const yearStart=()=>yrCustom?new Date(new Date().getFullYear(),new Date().getMonth()-2,1):new Date(cur.getFullYear(),0,1);
const yearMonths=()=>{const s=yearStart();return Array.from({length:12},(_,i)=>new Date(s.getFullYear(),s.getMonth()+i,1))};
const yearLabel=()=>{const m=yearMonths(),x=m[0].getFullYear(),y=m[11].getFullYear();return x===y?String(x):x+'-'+y};
// Plage chargée = vue principale + mois affiché dans le mini-calendrier (pour ses repères d'évènements)
function range(){const m=view==='year'||view==='bday'?[yearStart(),new Date(yearStart().getFullYear(),yearStart().getMonth()+12,1)]:[gs(cur),new Date(gs(cur).getFullYear(),gs(cur).getMonth(),gs(cur).getDate()+42)];
  const c=gs(miniD),e=new Date(c.getFullYear(),c.getMonth(),c.getDate()+42);return[m[0]<c?m[0]:c,m[1]>e?m[1]:e]}
// Tâches : dans l'agenda (jamais filtrées par "lecture seule") / dans la liste (filtrées, et masquées si datées + option cochée)
const tfil=t=>{const w=(S.taskFilter||'').split(',').map(x=>x.trim().toLowerCase()).filter(Boolean),ti=(t.title||'').trim().toLowerCase();return!w.some(x=>ti.startsWith(x))}; // "Filtrer les tâches commençant par"
const tvisCal=t=>t.cal.ton&&tfil(t)&&(S.showDone!==false||!t.done);   // ton = liste de tâches cochée dans le volet
const tvisList=t=>tvisCal(t)&&(S.showRO!==false||!t.cal.ro)&&!(S.dated&&t.due);
const taskEv=t=>({title:(t.done?'✓ ':'☐ ')+(t.title||T('common.untitled')),start:t.due,end:t.due,allDay:true,cal:t.cal,task:t});
// Évènements d'un jour, triés : 1 tâches datées, 2 journées entières, 3 évènements horaires. strict = année/mini : sans tâches en lecture seule
/* Anniversaires : calendrier choisi dans les Paramètres généraux (masqué du volet, jamais affiché comme évènement) ;
   évènements « journée entière » répétés tous les ans ; X-AGENDA-BIRTHYEAR = année de naissance (âge affiché) */
const isBday=v=>!!v&&!v.task&&!!S.bdayCal&&v.cal?.href===S.bdayCal,bdCal=()=>S.bdayCal&&cals.find(c=>c.href===S.bdayCal&&c.ev)||null;
const bdAge=v=>v.byear&&v.start.getFullYear()>v.byear?v.start.getFullYear()-v.byear:null,bdLbl=v=>(v.title||T('common.noname'))+(bdAge(v)?T('bday.age',{n:bdAge(v)}):'');
const bdOf=(s,e)=>events.filter(v=>isBday(v)&&v.start>=s&&v.start<e).sort((a,b)=>a.start-b.start||(a.title||'').localeCompare(b.title||'',LOC));
const bdDay=d=>bdOf(midnight(d),nextD(midnight(d)));
const dayEvents=(d,strict)=>{const s=midnight(d),e=new Date(s.getFullYear(),s.getMonth(),s.getDate()+1);
  const ev=events.filter(v=>v.cal.on&&!isBday(v)&&v.start<e&&(v.end>s||v.start>=s));
  if(HOLCAL.on)for(const h of hols)if(h.start<e&&h.end>s)ev.push({title:h.t,start:h.start,end:h.end,allDay:true,cal:HOLCAL});
  const tk=S.dated?tasks.filter(t=>t.due&&tvisCal(t)&&!(strict&&t.cal.ro)&&sameDay(t.due,d)).map(taskEv):[];
  const rank=v=>v.task?0:v.allDay?1:2;return[...ev,...tk].sort((a,b)=>rank(a)-rank(b)||a.start-b.start)};
// Calendriers externes : lus depuis /data par le serveur (GET /api/extdata)
const d8=s=>new Date(+s.slice(0,4),+s.slice(4,6)-1,+s.slice(6,8)),nextD=(d,n=1)=>new Date(d.getFullYear(),d.getMonth(),d.getDate()+n);
// Calendriers externes ajoutés (Paramètres > Calendriers externes) : liste + évènements (récurrences développées par le serveur)
async function loadXc(){try{const l=await api('extcals');xcals=l.map(x=>({...x,href:'ext:c:'+x.id,ro:true,ext:true,on:!(S.hidden||[]).includes('ext:c:'+x.id)}))}catch{xcals=[]}}
async function xcEvents(s,e){if(!xcals.length)return[];try{const by=new Map(xcals.map(c=>[c.id,c]));
  return(await api(`extevents?start=${s.toISOString()}&end=${e.toISOString()}`)).filter(x=>by.has(x.c)).map(x=>({title:x.t,loc:x.l,desc:x.d,status:x.st,allDay:!!x.a,start:x.a?d8(x.s):new Date(x.s),end:x.a?d8(x.e):new Date(x.e),cal:by.get(x.c)}))}catch{return[]}}
async function loadExt(){try{const x=await api('extdata');hols=x.hol.map(h=>({t:h.t,start:d8(h.s),end:d8(h.e)}));holMap=new Map();vacSet=new Set();
  for(const h of hols)for(let d=h.start;d<h.end;d=nextD(d))holMap.set(key(d),h.t);
  for(const v of x.vac)for(let d=d8(v.s),e=d8(v.e);d<e;d=nextD(d))vacSet.add(key(d))}catch{}}
const isHol=d=>holMap.has(key(d)),isVac=d=>vacSet.has(key(d));
// Couleurs personnalisées des jours (aperçu d'un jour) : {AAAA-MM-JJ: 1|2|3}, gardées par le serveur (/data/daycolors.json)
let dayCols={};const dayCol=d=>dayCols[key(d)]||0;
async function loadDayCols(){try{dayCols=await api('daycolors')}catch{}}
async function setDayCol(D,c){const k=key(D),old=dayCols[k]||0;if(c)dayCols[k]=c;else delete dayCols[k];render();
  try{await api('daycolors',{method:'PUT',body:JSON.stringify({d:k,c})})}catch(e){if(old)dayCols[k]=old;else delete dayCols[k];render();say(T('common.fail',{e:e.message}))}}
// Vue Mois : fond des sections (aujourd'hui > couleur personnalisée > férié > vacances)
const extMonth=(d,td)=>td?'':dayCol(d)?' cc'+dayCol(d):get('holMonth')&&isHol(d)?' hol':get('vacMonth')&&isVac(d)?' vac':'';
// Vue Année / mini : couches derrière la pastille. Vacances arrondies au vrai début/fin ; aux coupures (lundi/dimanche, 1er/dernier du mois) seulement si « vacCut »
function extYear(D){let c='';if(dayCol(D))c+=' cc'+dayCol(D);else if(get('holYear')&&isHol(D))c+=' hol';   // couleur personnalisée : à la place du rond férié
  if(get('vacYear')&&isVac(D)){const cut=get('vacCut'),w=(D.getDay()+6)%7,n=nextD(D);c+=' vac';
    if(!isVac(nextD(D,-1))||cut&&(w===0||D.getDate()===1))c+=' vs';if(!isVac(n)||cut&&(w===6||n.getDate()===1))c+=' ve'}
  return c}
// Bannière rouge sous l'en-tête : texte selon la cause (Nextcloud injoignable, serveur de l'agenda injoignable, autre erreur)
const bannerTxt=w=>{$('#banner').textContent=T(w==='nc'?'banner.nc':w==='net'?'banner.net':'banner.err')};
// silent = charger sans afficher (les fondus affichent eux-mêmes, une fois l'ancien contenu effacé)
// loadGen : numéro du chargement ; une réponse arrivée après un chargement plus récent (flèches enchaînées) est ignorée
let loadGen=0,taskGen=0,lastLoad=0;
async function load(silent){rawC.clear();if(view==='settings')return silent?undefined:render();const g=++loadGen,[s,e]=range(),all=[];let bad=false,down='';lastLoad=Date.now();
  if(OFF){const ev=[...(offE||=cals.filter(c=>c.ev).flatMap(c=>(OFF.ev[c.href]||[]).flatMap(o=>parse(o.ics).map(v=>({...v,cal:c,href:o.href,etag:o.etag}))))),...await xcEvents(s,e)];   // hors-ligne : sauvegarde + calendriers externes (fichiers locaux)
    if(g!==loadGen)return;events=ev;fail=false;if(!silent)render();return}
  const xp=xcEvents(s,e);   // calendriers externes, en parallèle
  await Promise.all(cals.filter(c=>c.ev).map(async c=>{try{
    for(const o of await api(`events?cal=${encodeURIComponent(c.href)}&start=${fmtZ(s)}&end=${fmtZ(e)}`))
      for(const v of parse(o.ics))all.push({...v,cal:c,href:o.href,etag:o.etag})}catch(x){bad=true;if(x.net)down='net';else if(x.nc&&!down)down='nc'}}));
  const xe=await xp;if(g!==loadGen)return;   // un chargement plus récent a été lancé entre-temps
  fail=bad;bannerTxt(down);console.debug('[jolical] événements chargés:',all.length,'| erreur:',fail);
  if(!down)events=[...all,...xe];   // Nextcloud ou serveur injoignable : on garde les évènements déjà affichés (un mois vide serait trompeur)
  if(!silent)render()}
async function loadTasks(){const g=++taskGen,all=[];let down=false;
  if(OFF){tasks=cals.filter(c=>c.todo).flatMap(c=>(OFF.tk[c.href]||[]).flatMap(o=>parse(o.ics,'VTODO').map(v=>({...v,cal:c,href:o.href,etag:o.etag,raw:o.ics}))));return render()}
  await Promise.all(cals.filter(c=>c.todo).map(async c=>{try{for(const o of await api('tasks?cal='+encodeURIComponent(c.href)))for(const v of parse(o.ics,'VTODO'))all.push({...v,cal:c,href:o.href,etag:o.etag,raw:o.ics})}catch(x){fail=true;if(x.nc||x.net)down=true}}));
  if(g!==taskGen)return;if(!down)tasks=all;render()}
// Actualisation automatique : toutes les 2 minutes et au retour sur l'onglet (s'il n'a pas été actualisé depuis 15 s) ; rien pendant un glisser-déposer,
// dans les Paramètres ou onglet masqué. Mode hors-ligne : nouvel essai de connexion à Nextcloud à la place (aussi toutes les minutes).
async function refresh(){if(document.hidden||drag)return;if(OFF||!$('#banner').hidden&&/injoignable/.test($('#banner').textContent))return ncRetry();
  if(view==='settings')return;await loadDayCols();await load(true);await loadTasks()}

/* ===== 5b. NEXTCLOUD INJOIGNABLE PENDANT L'UTILISATION =====
   Une réponse 503 « nextcloud » (voir api) bascule sur la sauvegarde hors-ligne du serveur : lecture seule, languette rouge en bas à gauche,
   évènements déjà affichés conservés jusque-là. Nouvel essai toutes les minutes et au retour sur l'onglet : dès que Nextcloud répond,
   retour automatique aux données réelles. Sans sauvegarde : bannière seule. */
let ncBusy=false;
function ncDown(){if(OFF||ncBusy||!READY)return;ncBusy=true;(async()=>{try{offEnter(await api('offline'),true)}catch{bannerTxt('nc');$('#banner').hidden=false}})().finally(()=>{ncBusy=false})}
const offWhen=d=>T('fmt.dateAt',{date:loc(d,{weekday:'long',day:'numeric',month:'long'}),time:hm(d)});
// entrée en mode hors-ligne (o = sauvegarde) ; auto = pendant l'utilisation (message + rechargement) ; les calendriers cochés / décochés sont gardés
function offEnter(o,auto){OFF=o;offE=null;
  cals=o.cals.map(c=>calVis({...c,ro:true}));document.body.classList.add('offline');
  $('#offd').textContent=T('offline.badge',{date:loc(new Date(o.date),{day:'numeric',month:'short'}),time:hm(new Date(o.date))});$('#offb').hidden=false;$('#banner').hidden=true;
  $('#offb').onclick=async()=>{if(await ask(T('offline.ask',{when:offWhen(new Date(o.date))}),T('btn.retry'))&&!await ncRetry())say(T('offline.still'))};
  if(auto){toast(T('offline.toast',{when:offWhen(new Date(o.date))}),true);loadTasks();load()}}
// nouvel essai : Nextcloud répond -> retour aux données réelles ; renvoie true si c'est le cas
async function ncRetry(){let c;try{c=await api('calendars')}catch{return false}
  const was=!!OFF;OFF=null;offE=null;cals=c.map(calVis);
  document.body.classList.remove('offline');$('#offb').hidden=true;$('#banner').hidden=true;if(was)toast(T('offline.back'));
  try{buildSettings(...BS)}catch{}loadTasks();await load();return true}
// Message bref en bas de l'écran (4 s)
// centré sur la zone principale (pas sur la fenêtre : le volet ouvert la décalerait) ; err = couleurs des boutons rouges
let toastT;function toast(m,err){const t=$('#toast'),p=[...document.querySelectorAll('main .pane')].find(x=>!x.hidden);t.textContent=m;t.classList.toggle('err',!!err);t.hidden=false;
  if(p){const r=p.getBoundingClientRect();t.style.left=(r.left+r.width/2)+'px';t.style.maxWidth=Math.max(200,Math.min(620,r.width-24))+'px'}t.classList.remove('out');clearTimeout(toastT);toastT=setTimeout(()=>{t.classList.add('out');toastT=setTimeout(()=>t.hidden=true,400)},4000)}
async function toggle(t){if(t.cal.ro)return;try{const d=!t.done;
  await api('event',{method:'PUT',body:JSON.stringify({href:t.href,etag:t.etag,ics:patch(t.raw,'VTODO',d?['STATUS:COMPLETED','COMPLETED:'+fmtZ(new Date()),'PERCENT-COMPLETE:100']:['STATUS:NEEDS-ACTION'],d?[]:['COMPLETED','PERCENT-COMPLETE'])})})}
  catch(e){say(T('common.fail',{e:e.message}))}await loadTasks()}

/* ===== 6. JOUR : pastille, aperçu, bulle (année / mini), pop-up (mois) ===== */
/* Fermeture animée : dialog.close() et les bulles (float) jouent l'animation de sortie avant de disparaître (si « Apparition des pop-up » est active).
   Réouverture pendant la fermeture : la fermeture est annulée. */
{const C=HTMLDialogElement.prototype.close,O=HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.close=function(v){if(!this.open||this._ct)return;if(!animOn('pop'))return C.call(this,v);
    this.classList.add('closing');this._ct=setTimeout(()=>{this._ct=null;this.classList.remove('closing');C.call(this,v)},200*AK())};
  HTMLDialogElement.prototype.showModal=function(){this._dirty=false;if(this._ct){clearTimeout(this._ct);this._ct=null;this.classList.remove('closing');if(this.open)return}return O.call(this)}}
function float(el,show){if(show){if(el._ct){clearTimeout(el._ct);el._ct=null;el.classList.remove('closing')}el.hidden=false;return}
  if(el.hidden||el._ct)return;if(!animOn('pop')){el.hidden=true;return}el.classList.add('closing');el._ct=setTimeout(()=>{el._ct=null;el.classList.remove('closing');el.hidden=true},200*AK())}
const shown=el=>!el.hidden&&!el._ct;
// Menus dépliants : hauteur + opacité animées (ouverture avec léger rebond, fermeture avec élan)
function foldTo(el,open){if(el._anim){el._anim.cancel();el._anim=null}el._closing=false;
  if(!animOn('fold')||!el.animate){el.hidden=!open;return}
  if(open)el.hidden=false;const cs=getComputedStyle(el),h=el.offsetHeight,pt=cs.paddingTop,pb=cs.paddingBottom,full={height:h+'px',paddingTop:pt,paddingBottom:pb,opacity:1},zero={height:'0px',paddingTop:'0px',paddingBottom:'0px',opacity:0};
  el.style.overflow='hidden';el._closing=!open;
  const a=el._anim=el.animate(open?[zero,full]:[full,zero],{duration:(open?450:300)*AK(),easing:open?'cubic-bezier(.19,.13,.49,1.12)':'cubic-bezier(.25,-.25,.8,1)'});
  a.onfinish=()=>{el._anim=null;el._closing=false;el.style.overflow='';if(!open)el.hidden=true}}
// Focus du titre après l'animation d'ouverture : sur téléphone, le clavier qui apparaît en même temps que l'animation la saccade
// (le formulaire, autofocus + tabindex=-1, reçoit le focus à l'ouverture sans clavier)
function focusLater(d,el){const go=()=>{if(d.open&&!d._ct&&(document.activeElement===d.querySelector('form')||document.activeElement===document.body))el.focus({preventScroll:true})};animOn('pop')?setTimeout(go,330*AKP()):go()}
// Changement de taille d'une pop-up ouverte (ligne de rappel ajoutée, note…) : transition douce de la hauteur
if(window.ResizeObserver)document.querySelectorAll('dialog').forEach(d=>{let h=0;new ResizeObserver(()=>{const n=d.offsetHeight;
  if(h&&n&&n!==h&&d.open&&!d._ct&&animOn('pop')&&d.animate)d.animate([{height:h+'px',overflow:'hidden'},{height:n+'px',overflow:'hidden'}],{duration:240*AK(),easing:'ease-out'});h=n}).observe(d.querySelector('.box'))});
const closePops=()=>{$('#dday').close();$('#dinfo').close();float($('#bub'),false)};
// Pastille : titre à gauche, heure à droite (masquée si la case est étroite, cf. @container en CSS)
// Couleur automatique du nom : blanc ou noir selon la couleur du calendrier après « Luminosité des évènements »
const autoFg=(hex,n)=>{const x=parseInt(hex.slice(1),16),t=n<0?0:255,p=Math.abs(n)/100,[r,g,b]=[x>>16,x>>8&255,x&255].map(c=>c+(t-c)*p);return(r*299+g*587+b*114)/1000>150?'#1c2025':'#ffffff'};
// lbl = libellé à la place du titre (liste « Vue Année ») · classes : rec (récurrent), tent / canc (provisoire / annulé), imp (Important), big (Double taille)
function chip(v,lbl){const imp=hasTag(v,TAG.imp),cls=(v.rec||(v.task&&v.task.cal.ro&&v.task.done)?' rec':'')+(v.status==='TENTATIVE'?' tent':v.status==='CANCELLED'?' canc':'')+(imp?' imp':'')+(isBig(v)?' big':'');
  const e=mk('div','ev'+cls),t=mk('span','t',lbl||v.title||T('common.untitled'));e.style.setProperty('--evc',v.cal.color);if(get('evAuto'))e.style.setProperty('--evtx',autoFg(v.cal.color,get('evLum')));
  if(imp)t.insertAdjacentHTML('afterbegin',ICO.imp.replace('class="ico"','class="ico imp"'));e.append(t);   // Important : picto avant le nom
  // à droite : l'heure, puis la cloche si l'évènement a un rappel, tout au bout (journée entière : la cloche seule)
  const bell=!!v.alarms?.length,tm=mk('span','tm');if(!v.allDay)tm.append(pad(v.start.getHours())+':'+pad(v.start.getMinutes()));if(bell)tm.insertAdjacentHTML('beforeend',ICO.bell);if(bell||!v.allDay)e.append(tm);
  // tâche modifiable : pop-up de modification directement ; sinon aperçu
  e.onclick=x=>{x.stopPropagation();closePops();v.task&&!v.task.cal.ro?openTask(v.task):showInfo(v)};return e}
// strict : retire les tâches en lecture seule (vue année et mini-calendrier)
// full = aperçu d'un jour (vue Mois) : titre, évènements (ou « Rien de prévu actuellement »), en bas les 3 couleurs personnalisées (à gauche) et + (à droite)
function dayContent(D,full,strict){
  const a=mk('button',full?'plusbtn pri':'plusbtn'),w=mk('div','plusrow');a.innerHTML=ICO.plus;a.title=T('ev.add');a.onclick=()=>{closePops();openEv(null,D)};
  if(full){const cw=mk('div','dcols'),draw=()=>cw.replaceChildren(...[1,2,3].map(n=>{const b=mk('button','dcol'+(dayCol(D)===n?' on':''));b.type='button';b.style.setProperty('--dc',`var(--cc${n})`);
      b.title=T('day.color',{n});b.setAttribute('aria-pressed',dayCol(D)===n);b.onclick=async()=>{await setDayCol(D,dayCol(D)===n?0:n);draw()};return b}));   // re-clic sur la couleur choisie : retirée
    draw();w.append(cw)}
  w.append(a);
  const h=full?mk('h3','dtitle',fdate(D,{weekday:'long',day:'numeric',month:'long',year:'numeric'})):mk('div','dh',fdate(D,{weekday:'long',day:'numeric'})),l=dayEvents(D,strict).map(v=>chip(v));   // (pas .map(chip) : l'index serait pris pour un libellé)
  return[h,...(l.length||!full?l:[mk('p','dnone',T('day.nothing'))]),w]}
function dayDialog(D){$('#dd').replaceChildren(...dayContent(D,true));$('#dday').showModal()}
function toggleBubble(D,el){const b=$('#bub'),k=key(D);if(shown(b)&&bubKey===k){float(b,false);return}bubKey=k; // re-clic sur le même jour = fermer
  const was=shown(b);b.style.borderColor='';b.replaceChildren(...dayContent(D,false,true));float(b,true);const r=el.getBoundingClientRect(),bw=b.offsetWidth||250;
  if(was&&animOn('pop')){b.style.animation='none';void b.offsetWidth;b.style.animation=''}   // nouveau jour : la bulle « réapparaît »
  // centrée sous le jour, sauf près des bords
  b.style.left=Math.max(4,Math.min(r.left+r.width/2-bw/2,innerWidth-bw-4))+'px';b.style.top=Math.max(4,Math.min(r.bottom+4,innerHeight-b.offsetHeight-8))+'px'}
// Bulle placée sous un élément (centrée, sauf près des bords)
function placeBub(b,el){const r=el.getBoundingClientRect(),bw=b.offsetWidth||250;b.style.left=Math.max(4,Math.min(r.left+r.width/2-bw/2,innerWidth-bw-4))+'px';b.style.top=Math.max(4,Math.min(r.bottom+4,innerHeight-b.offsetHeight-8))+'px'}
// Bulle d'anniversaires : titre + une ligne par anniversaire (clic = aperçu) ; k = clé (re-clic = fermer)
function bdBubble(el,k,title,l,fmt){const b=$('#bub');if(shown(b)&&bubKey===k){float(b,false);return}const was=shown(b);bubKey=k;
  const h=mk('div','dh',title),bc=bdCal()?.color||'';h.style.background=bc;b.style.borderColor=bc;   // en-tête et bordure : couleur du calendrier des anniversaires
  b.replaceChildren(h,...l.map(v=>{const x=mk('div','bdl',fmt(v));x.onclick=e=>{e.stopPropagation();closePops();showInfo(v)};return x}));float(b,true);
  if(was&&animOn('pop')){b.style.animation='none';void b.offsetWidth;b.style.animation=''}placeBub(b,el)}
const bdIcon=(k,l,title,fmt)=>{const i=mk('span','bdi');i.innerHTML=ICO.cake;i.title=l.map(bdLbl).join(', ');i.onclick=e=>{e.stopPropagation();bdBubble(i,k,title,l,fmt)};return i};   // k = clé de la bulle (re-clic = fermer)
// Date « littéraire » + heure : ["Du mercredi 21 au vendredi 23 octobre 2026", "de 19h00 à 21h30"]
function dateLine(v){const t=v.task,s=v.start;let e=v.allDay&&!t?new Date(v.end.getFullYear(),v.end.getMonth(),v.end.getDate()-1):v.end;if(e<s)e=s;
  const F={weekday:'long',day:'numeric'},FM={...F,month:'long'},FY={...FM,year:'numeric'};let date;
  if(sameDay(s,e))date=cap(loc(s,FY));
  else if(s.getFullYear()===e.getFullYear()&&s.getMonth()===e.getMonth())date=T('date.range',{from:loc(s,F),to:loc(e,FY)});
  else if(s.getFullYear()===e.getFullYear())date=T('date.range',{from:loc(s,FM),to:loc(e,FY)});
  else date=T('date.range',{from:loc(s,FY),to:loc(e,FY)});
  if(t)return[date,t.due.getHours()||t.due.getMinutes()?T('date.at',{time:hm(t.due)}):''];
  return[date,v.allDay?T('date.allDay'):+s===+e?T('date.at',{time:hm(s)}):T('date.fromTo',{from:hm(s),to:hm(e)})]}
// Réduit la police d'un titre jusqu'à ce qu'il tienne sur une seule ligne
function fitText(el,min=12){if(!el)return;el.style.fontSize='';if(!el.clientWidth)return;let s=parseFloat(getComputedStyle(el).fontSize)||24;while(el.scrollWidth>el.clientWidth&&s>min){s--;el.style.fontSize=s+'px'}}
// Aperçu (évènement ou tâche) : boutons seulement si modifiable
// tâche : grosse case d'état à la place de la pastille du calendrier (cocher = terminée tout de suite)
// ICS brut d'un évènement, mis en cache 1 min (vidé à chaque rechargement) : préchargé dès l'aperçu pour que les rappels
// soient prêts à l'ouverture du formulaire (sinon la pop-up s'ouvre puis change de taille)
const rawC=new Map();
function rawGet(href){const c=rawC.get(href);if(c&&Date.now()-c.t<6e4)return c.p;const p=api('raw?href='+encodeURIComponent(href)).then(r=>r.ics);p.catch(()=>rawC.delete(href));rawC.set(href,{p,t:Date.now()});return p}
function showInfo(v){const t=v.task,b=$('#di'),ttl=mk('div','ttl');let dot;if(!t&&!v.cal.ext&&v.href)rawGet(v.href).catch(()=>{});
  if(t&&!t.cal.ro){dot=mk('input');dot.type='checkbox';dot.checked=t.done;dot.title=T(t.done?'task.done':'task.todo');dot.onchange=async()=>{await toggle(t);$('#dinfo').close()}}
  else{dot=mk('i');dot.style.background=v.cal.color;dot.title=v.cal.name}   // évènement ou tâche en lecture seule : pastille du calendrier
  const bd=isBday(v);ttl.append(dot,mk('h3',null,bd?bdLbl(v):(t?t.title:v.title)||T('common.untitled')));b.replaceChildren(ttl);
  const tg=t||!get('showTags')?[]:TAGS.filter(x=>hasTag(v,x));if(tg.length){const r=mk('div','tagv');tg.forEach(x=>r.append(mk('span',null,tagLbl(x))));b.append(r)}   // tags entre le titre et la date
  const[d1,d2]=bd?[cap(loc(v.start,{weekday:'long',day:'numeric',month:'long',year:'numeric'})),v.byear?T('bday.born',{y:v.byear}):T('bday.one')]:dateLine(v),canc=!t&&v.status==='CANCELLED',x=canc?' x':'';if(canc)b.append(mk('div','dl t',T('info.cancelled')));
  b.append(mk('div','dl'+x,d1));if(d2)b.append(mk('div','dl t'+x,d2));if(!t&&v.status==='TENTATIVE')b.append(mk('div','dl t',T('info.tentative')));
  let rp=null;if(!t&&!bd&&v.rec&&!v.cal.ext&&v.href){const rl=mk('div','dl t');b.append(rl);rp=rawGet(v.href).then(raw=>{const m=parse(masterFirst(raw))[0];if(m?.rrule)rl.textContent=T('info.repeat',{rule:rrText(m.rrule)})}).catch(()=>{})}   // série : sa règle (attendue avant l'ouverture)
  if(v.loc)b.append(mk('div','meta','📍 '+v.loc));if(v.desc)b.append(mk('div','meta d',v.desc));
  const ro=t?t.cal.ro:v.cal.ro,row=mk('div','row'),canDup=!t&&!v.cal.ext&&cals.some(c=>c.ev&&!c.ro);
  const dup=()=>{const x=mk('button',null,T('btn.dup'));x.onclick=()=>{$('#dinfo').close();openEv(null,null,v)};return x};
  if(ro)b.append(mk('p','muted',T(v.cal.ext?'info.roExt':OFF?'info.roOff':'info.ro')));
  if(t&&!ro){const x=mk('button','danger',T('btn.del')),m=mk('button','pri',T('btn.edit'));x.onclick=()=>{$('#dinfo').close();tkEdit=t;$('#tk-del').onclick()};m.onclick=()=>{$('#dinfo').close();openTask(t)};row.append(x,m)}
  else if(!t&&!ro){const x=mk('button','danger',T('btn.del')),m=mk('button','pri',T('btn.edit'));x.onclick=()=>delEv(v);m.onclick=()=>{$('#dinfo').close();bd?openBday(v):openEv(v)};bd?row.append(x,m):row.append(x,dup(),m)}
  else if(canDup)row.append(dup());   // évènement récurrent / lecture seule : on peut au moins le dupliquer
  if(infoGo){const w=mk('div','srgo'),g=mk('button','sm',T('search.goto')),f=infoGo;g.onclick=()=>f();w.append(g);b.append(w)}   // ouvert depuis la recherche : petit bouton à gauche, au-dessus des boutons
  if(row.children.length)b.append(row);
  const go=()=>{$('#dinfo').showModal();fitText(ttl.querySelector('h3'))};rp?Promise.race([rp,new Promise(r=>setTimeout(r,400))]).then(go):go()}   // série : ouverture avec sa ligne Répétition (400 ms au plus)
// Touche Suppr (ou ⌫ sur Mac / iPad) dans l'aperçu = bouton « Supprimer » (s'il existe)
// Entrée = bouton « Modifier » (sauf si un autre bouton a été choisi avec Tab)
$('#dinfo').addEventListener('keydown',e=>{if(e.repeat||e.target.matches('button'))return;const x=e.key==='Enter'?$('#di .row .pri'):e.key==='Delete'||e.key==='Backspace'?$('#di .row .danger'):null;if(x){e.preventDefault();x.click()}});
async function delEv(v){
  // évènement d'une série : « Cette occurrence » (Entrée) = date exclue de la série ; « Toute la série » = fichier supprimé
  if(isBday(v)){if(!await ask(T('bday.delAsk',{name:v.title||T('common.noname')}),T('btn.del'),true))return;try{await api('event',{method:'DELETE',body:JSON.stringify({href:v.href,etag:v.etag})});$('#dlg').close();$('#dinfo').close();load()}catch(e){say(T('common.fail',{e:e.message}))}return}   // anniversaire : tout
  const one=v.rec&&v.recId?await popup(T('ev.delRecAsk'),[[T('ev.occ'),'pri','one'],[T('ev.series'),'danger','all'],[T('btn.cancel'),'',false]],'one'):await ask(T('ev.delAsk'),T('btn.del'),true);if(!one)return;
  try{if(one==='one'){const r=await api('raw?href='+encodeURIComponent(v.href));const ics=addExdate(dropOcc(masterFirst(r.ics),v.recId),v.recId);
      await api('event',{method:'PUT',body:JSON.stringify({href:v.href,ics,etag:r.etag})})}
    else await api('event',{method:'DELETE',body:JSON.stringify({href:v.href,etag:v.etag})});$('#dlg').close();$('#dinfo').close();load()}catch(e){say(T('common.fail',{e:e.message}))}}

/* ===== 6b. RECHERCHE (volet, sous le mini-calendrier) =====
   Champ + loupe (ou Entrée ; touche R ou / pour y aller) + engrenage (« Rechercher dans » : titres / lieux / descriptions ; évènements futurs / passés).
   Le serveur cherche dans tous les évènements des calendriers cochés (externes et anniversaires compris), voir server.js « Recherche ».
   Pop-up : nombre de résultats, « À venir » puis « Évènements passés », regroupés par mois, 30 à la fois (« Afficher plus »).
   Clic sur un résultat : aperçu habituel + « Voir dans l'agenda » (vue Mois de l'évènement, jour encadré un instant). */
let infoGo=null,srTok=0;
const SRF=[['q-t','srT'],['q-l','srL'],['q-d','srD'],['q-f','srF'],['q-p','srP'],['q-k','srK']];
for(const[id,k]of SRF)$('#'+id).onchange=()=>{S[k]=$('#'+id).checked;saveS()};
const qpop=show=>{float($('#qpop'),show);$('#qgear').classList.toggle('open',show)};
$('#qgear').onclick=e=>{const p=$('#qpop'),r=e.currentTarget.getBoundingClientRect();for(const[id,k]of SRF)$('#'+id).checked=!!get(k);qpop(!shown(p));
  p.style.left=Math.min(r.right+8,innerWidth-250)+'px';p.style.top=Math.max(8,Math.min(r.top,innerHeight-p.offsetHeight-8))+'px'};
$('#qgo').onclick=()=>search();
$('#q').onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();search()}else if(e.key==='Escape'){e.preventDefault();$('#q').blur()}};
// touche R ou / : champ de recherche (volet ouvert si besoin)
function srFocus(){if(document.body.classList.contains('closed')){document.body.classList.remove('closed');sideSave();relayout()}setTimeout(()=>{$('#q').focus();$('#q').select()},50)}
// résultat du serveur -> objet évènement de l'agenda (comme ceux de la vue Mois)
// tâche (k tk) : tâche complète (comme dans le volet) affichée comme dans la vue Mois ; évènement : données de l'ics (tags, année de naissance…) + date trouvée par le serveur
const srEv=x=>{const cal=x.k==='x'?xcals.find(c=>c.id===x.c):cals.find(c=>c.href===x.c);if(!cal)return null;
  if(x.k==='tk'){const t=parse(x.ics,'VTODO')[0];if(!t?.due)return null;return{...taskEv({...t,cal,href:x.href,etag:x.etag,raw:x.ics}),srFut:x.fut}}
  const base=x.ics?parse(x.ics).find(e=>!e.recId)||{}:{};
  return{...base,title:x.t,loc:x.l,desc:x.d,status:x.st,allDay:!!x.a,start:x.a?d8(x.s):new Date(x.s),end:x.a?d8(x.e):new Date(x.e),cal,href:x.href,etag:x.etag,rec:!!x.rec,srFut:x.fut,srBd:cal.href===S.bdayCal}};
async function search(){const q=$('#q').value.trim();qpop(false);
  if([...q].length<2)return say(T('search.short'));
  const inn=[['t','srT'],['l','srL'],['d','srD']].filter(([,k])=>get(k)).map(([x])=>x).join(''),when=(get('srF')?'f':'')+(get('srP')?'p':'');
  if(!inn)return say(T('search.noField'));if(!when)return say(T('search.noWhen'));
  const p=new URLSearchParams({q,in:inn,when});for(const c of cals)if(c.ev&&(c.on||c.href===S.bdayCal))p.append('cal',c.href);for(const c of xcals)if(c.on)p.append('x',c.id);
  if(get('srK'))for(const c of cals)if(c.todo&&c.ton)p.append('tl',c.href);   // tâches datées des listes cochées (cartes Deck comprises)
  const b=$('#ds'),tok=++srTok;b.replaceChildren(mk('h3','dtitle',T('search.title',{q})),mk('p','dnone',T('search.busy')));if(!$('#dsrch').open){$('#dsrch').showModal();b.focus({preventScroll:true})}   // focus sur le contenu (sans contour), pas sur la fenêtre
  let r;try{r=await api('search?'+p)}catch(e){if(tok===srTok)b.replaceChildren(mk('h3','dtitle',T('search.title',{q})),mk('p','dnone',T('common.fail',{e:e.message})));return}
  if(tok!==srTok||!$('#dsrch').open)return;
  // ordre : Anniversaires (date la plus proche d'abord), puis À venir, puis Évènements passés
  const l0=r.list.map(srEv).filter(Boolean),l=[...l0.filter(v=>v.srBd),...l0.filter(v=>!v.srBd)],box=mk('div','srl'),more=mk('button','sm',T('search.more'));let i=0,lastM='',lastF=null;
  const grp=v=>v.srBd?'bday':v.srFut?'future':'past',sep=new Set(l.map(grp)).size>1||l.some(v=>v.srBd);   // séparateurs : s'il y a des anniversaires ou plusieurs catégories
  b.replaceChildren(mk('h3','dtitle',T('search.title',{q})),mk('p','srn',!l.length?T('search.none'):r.n>l.length?T('search.countMax',{n:r.n,m:l.length}):T(l.length>1?'search.count':'search.one',{n:l.length})));
  if(!l.length)return;
  const add=()=>{for(const v of l.slice(i,i+30)){
      const g=grp(v);if(g!==lastF){lastF=g;lastM='';if(sep)box.append(mk('div','calsep srsep',T('search.'+g)))}
      // anniversaire : titre « le 8 décembre », sans colonne du jour ni « évènement récurrent » ; autres : titre du mois, jour à gauche (casse : CSS, « Casse des calendriers »)
      const m=v.srBd?T('search.bdDate',{date:loc(v.start,{day:'numeric',month:'long'})}):loc(v.start,{month:'long',year:'numeric'});if(m!==lastM){lastM=m;box.append(mk('h4','srm',m))}
      const row=mk('div','srr'+(v.srBd?' bd':'')),c=v.srBd?chip(v,bdLbl(v)):chip(v);c.onclick=e=>{e.stopPropagation();srOpen(v)};
      if(!v.srBd)row.append(mk('span','srd',loc(v.start,{weekday:'short',day:'numeric'})));row.append(c);
      const sub=[v.rec&&!v.srBd&&T('search.rec'),v.loc&&'📍 '+v.loc].filter(Boolean);if(sub.length)row.append(mk('span','srs',sub.join(' · ')));box.append(row)}
    i+=30;more.hidden=i>=l.length};
  more.onclick=()=>add();add();const w=mk('div','srmore');w.append(more);box.append(w);b.append(box);
  const move=()=>box.append(w);more.addEventListener('click',move)}   // « Afficher plus » reste en bas de la liste
// ouverture d'un résultat : l'évènement tel que la vue Mois l'affiche (occurrence d'une série comprise), sinon celui de la recherche
async function srOpen(v){let o=v;
  if(!v.task&&!v.cal.ext&&v.href){try{const s=new Date(v.start.getFullYear(),v.start.getMonth(),v.start.getDate()),e=nextD(s);
      for(const x of await api(`events?cal=${encodeURIComponent(v.cal.href)}&start=${fmtZ(s)}&end=${fmtZ(e)}`))if(x.href===v.href)for(const y of parse(x.ics))if(Math.abs(y.start-v.start)<6e4){o={...y,cal:v.cal,href:x.href,etag:x.etag};break}}catch{}}
  infoGo=()=>{$('#dinfo').close();$('#dsrch').close();srGoto(o.start)};try{showInfo(o)}finally{infoGo=null}}
// « Voir dans l'agenda » : vue Mois du jour, cadre autour du jour pendant 1,6 s
async function srGoto(D){await goDay(new Date(D.getFullYear(),D.getMonth(),1));const k=key(D),h=document.querySelector(`#grid .dh[data-d="${k}"]`);if(!h)return;
  h.scrollIntoView({block:'center',behavior:animOK()?'smooth':'auto'});dropBox(k);const b=$('#dropbox');if(!b)return;b.classList.add('flash');
  setTimeout(()=>{b.hidden=true;b.classList.remove('flash')},1600)}

/* ===== 7. MINI-CALENDRIER (menu latéral et vue année) : numéro cerclé si évènement, sans majuscule ===== */
// src(D) : évènements de la pastille (vue Anniversaires), sinon ceux du jour
function mini(y,m,pick,src){const w=mk('div','mini'),gh=mk('div','mg'),g=mk('div','mg days');   // gh = L M M J V S D (fixe), g = jours (animés au changement de mois)
  const mh=mk('div','mh lnk',loc(new Date(y,m,1),{month:'long',year:'numeric'}));mh.title=T('mini.seeMonth');mh.onclick=()=>goDay(new Date(y,m,1));w.append(mh,gh,g);   // nom du mois -> vue Mois
  T('days.initials').split('').forEach(c=>gh.append(mk('span','dw',c)));
  const n=new Date(y,m+1,0).getDate(),t=key(new Date());for(let i=(new Date(y,m,1).getDay()+6)%7;i>0;i--)g.append(mk('span'));
  // pastille = 1er évènement du jour, sauf jour férié quand son fond est déjà affiché (« holYear ») ; la bulle, elle, liste toujours le jour férié
  for(let d=1;d<=n;d++){const D=new Date(y,m,d),ev=(src?src(D):dayEvents(D,true)).find(v=>!(v.cal===HOLCAL&&get('holYear'))&&v.status!=='CANCELLED'),c=mk('span','md'+(key(D)===t?' today':'')+(ev?' has':''),d);if(ev)c.style.setProperty('--dot',ev.cal.color);
    const cell=mk('span','mc'+(src?'':extYear(D)));cell.onclick=()=>pick(D,c);cell.append(c);g.append(cell)}
  return w}
const goDay=D=>fadeSwap(async()=>{cur=D;view='month';if(innerWidth<700)document.body.classList.add('closed');await load(true)}).then(toNow);

/* ===== 8. MENU LATÉRAL ===== */
function renderSide(){
  // mini-calendrier indépendant de la vue principale (‹ mois ›, puis Aujourd'hui) ; clic : bulle si évènements, sinon nouvel évènement (comme la vue Année)
  const m=mini(miniD.getFullYear(),miniD.getMonth(),(D,el)=>dayEvents(D,true).length?toggleBubble(D,el):openEv(null,D)),h=m.querySelector('.mh');m.classList.add('yr');h.classList.add('mnav');
  const nav=(ic,f,c)=>{const b=mk('button',c);b.innerHTML=ic;b.onclick=f;return b},mv=n=>()=>miniSwap(()=>{miniD=new Date(miniD.getFullYear(),miniD.getMonth()+n,1)},swipeDir(n));
  const ms=mk('span','lnk',loc(miniD,{month:'long',year:'numeric'}));ms.title=T('mini.seeMonth');ms.onclick=()=>goDay(new Date(miniD.getFullYear(),miniD.getMonth(),1));
  h.classList.remove('lnk');h.onclick=null;h.removeAttribute('title');h.replaceChildren(nav(ICO.l,mv(-1),'rnd sm'),ms,nav(ICO.r,mv(1),'rnd sm'));
  const today=mk('button','sm',T('btn.today'));today.onclick=()=>miniSwap(()=>{miniD=new Date()});today.style.cssText='display:block;margin:13px auto 0';m.append(today);
  $('#mini').replaceChildren(m);
  // Calendriers (évènements ; sans le calendrier des anniversaires), puis « Calendriers externes » (ajoutés, puis « Jours fériés » dès qu'un fichier est téléchargé),
  // puis « Listes de tâches » (calendriers qui acceptent les tâches : un calendrier mixte est dans les deux sections, chaque case a son propre effet)
  // une ligne = [calendrier, 'ev' (case = ses évènements) | 'todo' (case = ses tâches)] ; masqués dans S.hidden : href (évènements) ou 'todo:'+href (tâches)
  const xl=[...xcals,...(hols.length?[HOLCAL]:[])],tl0=cals.filter(c=>c.todo),rows=[...cals.filter(c=>c.ev&&c.href!==S.bdayCal).map(c=>[c,'ev']),...xl.map(c=>[c,'ev']),...tl0.map(c=>[c,'todo'])];
  const sep=([c,k])=>k==='todo'?c===tl0[0]&&mk('div','calsep',T('side.lists')):c===xl[0]&&mk('div','calsep',T('side.ext'));
  $('#cals').replaceChildren(...rows.flatMap(x=>{const r=mk('label','cal'),k=mk('input'),i=mk('i'),[c,t]=x,f=t==='todo'?'ton':'on';k.type='checkbox';k.checked=c[f];i.style.background=c.color;
    k.onchange=()=>{c[f]=k.checked;S.hidden=[...rows.filter(([y,u])=>u==='ev'&&!y.on).map(([y])=>y.href),...rows.filter(([y,u])=>u==='todo'&&!y.ton).map(([y])=>'todo:'+y.href)];saveS();render()};
    r.append(k,i,mk('span',null,c.name));return[sep(x),r].filter(Boolean)}));
  // Tâches : à faire d'abord, puis par échéance ; « Classer les tâches par liste » (options, engrenage) : regroupées sous le nom de leur liste (ordre du volet)
  const tl=$('#tasks');tl.replaceChildren();const lists=cals.filter(c=>c.todo);let lastCal=null;
  tasks.filter(tvisList).sort((a,b)=>(S.tasksByList?lists.indexOf(a.cal)-lists.indexOf(b.cal):0)||(a.done-b.done)||((a.due||1e15)-(b.due||1e15))).slice(0,60).forEach(t=>{
    if(S.tasksByList&&t.cal!==lastCal){lastCal=t.cal;tl.append(mk('div','calsep tksep',t.cal.name))}
    // case = cocher / décocher tout de suite ; texte = pop-up tâche (sauf lecture seule)
    const r=mk('div','task'+(t.done?' done':'')+(t.cal.ro?' ro':'')),k=mk('input'),sp=mk('span',null,t.title||T('common.untitled'));k.type='checkbox';k.checked=t.done;k.onchange=()=>toggle(t);
    if(t.cal.ro){k.disabled=true;r.title=T('task.roOf',{name:t.cal.name})}else{sp.onclick=()=>openTask(t);sp.title=T('task.edit')}
    r.append(k,sp);if(t.due)r.append(mk('small',null,t.due.toLocaleDateString(LOC,{day:'numeric',month:'short'})));tl.append(r)});
  if(!tl.children.length)tl.append(mk('div',null,T('task.none')));
  // « + Tâche » : nouvelle tâche dans la « Liste de tâches par défaut » (liste modifiable dans la pop-up) ; grisé s'il n'existe aucune liste modifiable
  const tc=taskCal(),add=mk('button','sm',T('task.add')),aw=mk('div','tkadd');add.disabled=!tc;add.title=T(tc?'task.new':'task.noList');add.onclick=()=>openTask(null);aw.append(add);tl.append(aw);
  document.querySelectorAll('.fold').forEach(f=>{const c=(S.collapsed||[]).includes(f.dataset.sec),b=f.nextElementSibling;f.classList.toggle('shut',c);if(!b._anim)b.hidden=c})}

/* ===== 9. VUES : mois et année ===== */
// mCur = mois affiché en dernier dans la vue Mois : y revenir (onglet Mois, touche M) le retrouve, même si la vue Année a changé d'année entre-temps
function render(){const st=view==='settings';if(view==='month')mCur=cur;
  for(const v of['month','year','settings','bday'])$('#v-'+v).hidden=v!==view;$('.tab[data-v="bday"]').hidden=!bdCal();
  document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('on',b.dataset.v===view));$('#banner').hidden=!fail;$('#nav').hidden=$('#tabs').hidden=st;$('#nav').classList.toggle('off',view==='bday');$('#new').classList.toggle('x',st);$('#new').title=T(st?'fab.close':'fab.new');   // le + tourne de 45° pour devenir ×
  titleNow();
  if(view==='month')renderMonth();
  if(view==='year'){const now=new Date();   // le mois en cours est mis en avant (classe "curm")
    $('#yearg').replaceChildren(...yearMonths().map(M=>{const w=mini(M.getFullYear(),M.getMonth(),(D,el)=>dayEvents(D,true).length?toggleBubble(D,el):openEv(null,D));w.classList.add('yr');
      {const g=w.querySelector('.mg.days');while(g.children.length<42)g.append(mk('span','mc pad'))}   // 6 lignes partout : listes « Vue Année » alignées
      if(M.getFullYear()===now.getFullYear()&&M.getMonth()===now.getMonth())w.classList.add('curm');yearList(w,M);
      if(get('bdayYear')&&S.bdayCal){const bl=bdOf(M,new Date(M.getFullYear(),M.getMonth()+1,1));if(bl.length){const mh=w.querySelector('.mh'),hw=mk('div','mhw');mh.replaceWith(hw);hw.append(mh,bdIcon('y'+key(M),bl,T('bday.inMonth',{month:loc(M,{month:'long'})}),v=>cap(wd3(v.start))+' '+v.start.getDate()+' : '+bdLbl(v)))}}   // anniversaires du mois : picto à droite, hors du nom (survol séparé)
      return w}))}
  if(view==='bday'){const now=new Date();   // vue Anniversaires : 12 mois, pastilles = anniversaires ; clic : bulle, ou nouvel anniversaire ce jour-là
    $('#bdg').replaceChildren(...yearMonths().map(M=>{const w=mini(M.getFullYear(),M.getMonth(),(D,el)=>{const l=bdDay(D);l.length?bdBubble(el,'b'+key(D),fdate(D,{weekday:'long',day:'numeric',month:'long'}),l,bdLbl):openBday(null,D)},bdDay);w.classList.add('yr');
      {const g=w.querySelector('.mg.days');while(g.children.length<42)g.append(mk('span','mc pad'))}
      if(M.getFullYear()===now.getFullYear()&&M.getMonth()===now.getMonth())w.classList.add('curm');return w}))}
  renderSide();tabSize()}
// Liste « Vue Année » d'un mois : évènements tagués qui commencent dans le mois (« Sam 24 : Concert »), ou qui ont commencé avant
// et continuent dans ce mois (en tête, « Sam 24/10 : Festival ») ; « yrMax » lignes puis « +N de plus » (pop-up avec toute la liste)
function yearList(w,M){const s=M,e=new Date(M.getFullYear(),M.getMonth()+1,1),max=get('yrMax');
  const l=events.filter(v=>v.cal.on&&!isBday(v)&&hasTag(v,TAG.year)&&v.start<e&&(v.end>s||v.start>=s)).sort((a,b)=>a.start-b.start);if(!l.length)return;
  const lbl=v=>cap(wd3(v.start))+' '+v.start.getDate()+(v.start<s?'/'+pad(v.start.getMonth()+1):'')+' : '+(v.title||T('common.untitled'));
  const L=mk('div','ylist');l.slice(0,max).forEach(v=>L.append(chip(v,lbl(v))));
  if(l.length>max){const m=mk('div','ev more');m.append(mk('span','t',T('more',{n:l.length-max})));
    m.onclick=()=>{$('#dd').replaceChildren(mk('h3','dtitle',T('year.listTitle',{month:loc(M,{month:'long',year:'numeric'})})),...l.map(v=>chip(v,lbl(v))));$('#dday').showModal()};L.append(m)}
  w.append(L)}
// Section d'un élément dans la journée d : 0 matin, 1 après-midi, 2 soir.
// Seuls les évènements horaires qui DÉBUTENT ce jour-là après "pmStart" / "evStart" descendent ; tout le reste (journée entière, tâche, suite d'un évènement commencé la veille) va au matin
const secOf=(v,d)=>{if(v.task||v.allDay||v.start<midnight(d))return 0;const m=v.start.getHours()*60+v.start.getMinutes();return m<tmin(get('pmStart'))?0:m<tmin(get('evStart'))?1:2};
// Emplacement invisible de la taille d'une pastille (hauteur minimale des sections)
const ph=()=>{const e=mk('div','ev ph');e.append(mk('span','t','\u00a0'));return e};
// Vue mois : une "semaine" par ligne = grille 7 colonnes x 4 lignes (en-tête "lun 12", matin, après-midi, soir).
// Chaque cellule est placée directement dans la grille de la semaine (gridArea) : les hauteurs des sections s'alignent sur les 7 jours.
// Par section : "maxEv" pastilles puis "+N de plus" (même hauteur qu'une pastille) ; hauteur minimale minM / minA / minS.
// Clic sur une section = nouvel évènement à l'heure de début de la section (9h, pmStart, evStart)
function renderMonth(){const abbr=get('abbr')==='always'||get('abbr')==='mobile'&&innerWidth<700,g=$('#grid'),s=gridStart(),now=new Date(),max=get('maxEv'),mins=[get('minM'),get('minA'),get('minS')],at=[540,tmin(get('pmStart')),tmin(get('evStart'))];g.replaceChildren();
  for(let wk=0;wk<6;wk++){const W=mk('div','week');
    for(let j=0;j<7;j++){const x=mk('div','wsh h'+(j?j===6?' h6':'':' h0'));x.style.gridArea=`1/${j+1}`;W.append(x)}{const y=mk('div','wsh b');y.style.gridArea='2/1/5/8';W.append(y)}   // ombre des semaines : couche de forme dessous (voir .wsh)
    for(let j=0;j<7;j++){const d=new Date(s.getFullYear(),s.getMonth(),s.getDate()+wk*7+j),out=d.getMonth()!==cur.getMonth(),td=sameDay(d,now),aft=j>0&&!out&&nextD(d,-1).getMonth()!==cur.getMonth();   // aft : 1er jour du mois précédé d'un jour hors du mois (voir .sec.aft)
      const cls=(out?' out':'')+(td?' td':'')+(j===0?' first':j===6?' last':''),ev=dayEvents(d),parts=[[],[],[]];
      ev.forEach(v=>parts[secOf(v,d)].push(v));
      const h=mk('div','dh'+cls);h.append(mk('span',null,(abbr?wd3(d):loc(d,{weekday:'long'}))+' '+d.getDate()));h.style.gridArea=`1/${j+1}`;h.dataset.d=key(d);
      h.style.setProperty('--hb',td?'var(--today)':out?'var(--mute)':`var(--wd${j})`);h.style.color=td?'var(--todayfg)':out?'var(--mutehd)':`var(--wf${j})`;
      h.onclick=e=>{e.stopPropagation();dayDialog(d)};   // en-tête : aperçu du jour, toujours (même vide)
      if(get('bdayMonth')&&S.bdayCal){const bl=bdDay(d);if(bl.length)h.append(bdIcon('m'+key(d),bl,T(bl.length>1?'view.bday':'bday.one'),bdLbl))}   // anniversaires : picto à droite de l'en-tête
      W.append(h,...parts.map((p,i)=>{const b=mk('div','sec '+'mas'[i]+cls+(aft?' aft':'')+extMonth(d,td));b.style.gridArea=`${i+2}/${j+1}`;b.dataset.d=key(d);
        // « Double taille » en tête de section et compte pour 2 lignes (affiché même s'il dépasse quand il est seul)
        p.sort((x,y)=>isBig(y)-isBig(x));let used=0,shown=0;
        for(const v of p){const c=isBig(v)?2:1;if(used+c>max&&shown)break;const el=chip(v);if(canDrag(v))dragInit(el,v,key(d));b.append(el);used+=c;shown++}   // glisser-déposer : voir 9b
        if(p.length>shown){const m=mk('div','ev more');m.append(mk('span','t',T('more',{n:p.length-shown})));m.onclick=e=>{e.stopPropagation();dayDialog(d)};b.append(m);used++}
        for(let k=used;k<mins[i];k++)b.append(ph());
        b.onclick=()=>openEv(null,d,null,at[i]);return b}))}
    g.append(W)}
  snapCols();fitHeads();fitBigs();document.fonts?.ready.then(()=>{fitHeads();fitBigs()})}   // re-calcul une fois les polices chargées
// Flèches : retour en haut de page ; depuis la vue personnalisée, > = année de fin, < = année de début
const toTop=()=>{for(const id of['#v-month','#v-year','#v-bday'])$(id).scrollTop=0;scrollTo(0,0)};
// Mois en cours : la semaine d'aujourd'hui en 2e position si possible, sinon 3e, 4e… (le défilement manque de place en fin de mois),
// en ne s'arrêtant que sur un début de semaine (en-tête entier) et en gardant la semaine d'aujourd'hui entièrement visible ; sinon elle va tout en haut
const toNow=()=>{toTop();const n=new Date();if(view!=='month'||cur.getFullYear()!==n.getFullYear()||cur.getMonth()!==n.getMonth())return;
  const p=$('#v-month'),w=[...p.querySelectorAll('.week')],i=w.findIndex(x=>x.querySelector('.dh.td')),max=p.scrollHeight-p.clientHeight;if(i<1||max<=0)return;
  const pt=p.getBoundingClientRect().top,at=j=>j?Math.ceil(w[j-1].getBoundingClientRect().bottom-pt):0,end=w[i].getBoundingClientRect().bottom-pt;   // at(j) : défilement qui met la semaine j en haut
  for(let j=i-1;j>=0;j--){const s=at(j);if(s>max)continue;if(end-s<=p.clientHeight)p.scrollTop=s;else break;return}
  p.scrollTop=Math.min(at(i),max)};
/* Fondus de contenu (réglage « Changements de mois, d'année et de vue ») : l'ancien contenu s'efface, change() met à jour l'affichage,
   le nouveau apparaît. Balayage sur mobile (réglage « Animation du swipe ») : mode t = translation, o = opacité, to = les deux ; dir = ±1.
   h = anime aussi la hauteur (mini-calendrier). */
// contenu animé de chaque vue (le fond du « pane » n'est jamais animé)
const paneIn=()=>view==='month'?$('#grid'):view==='year'?$('#yearg'):view==='bday'?$('#bdg'):$('#set');
// flèches < > : effet swipe aussi si « Effets swipe sur les transitions classiques » est coché (sinon fondu classique) ; Aujourd'hui : toujours un fondu
const swipeDir=n=>get('animSwipeAll')&&get('animSwipe')!=='none'?n:0;
// change() modifie l'état et charge les données SANS afficher (load(true)) ; il démarre pendant la disparition, l'affichage suit
async function fadeSwap(change,pick=paneIn,mode='o',dir=0,h=false){
  // change() modifie tout de suite le mois / la vue (avant d'attendre les évènements) : le titre change et rebondit dès le clic
  if(!(dir?animOK()&&mode!=='none':animOn('view'))){const p=change();titleNow();await p;render();return}
  const D=AK(),tr=dir&&mode.includes('t'),op=!dir||mode.includes('o'),dist=mode==='t'?100:30,old=pick(),oh=h&&old?old.offsetHeight:0;let a;
  if(old?.animate)a=old.animate([{opacity:1,transform:'none'},{opacity:op?0:1,transform:tr?`translateX(${-dir*dist}%)`:'none'}],{duration:(tr?200:130)*D,easing:'ease-in',fill:'forwards'});
  const p=change();titleNow();await Promise.all([a?.finished.catch(()=>{}),p]);render();a?.cancel();const nw=pick();if(!nw?.animate)return;
  nw.animate([{opacity:op?0:1,transform:tr?`translateX(${dir*dist}%)`:'none'},{opacity:1,transform:'none'}],{duration:(tr?320:220)*D,easing:tr?'cubic-bezier(.18,.89,.32,1)':'ease-out'});
  if(h&&oh&&oh!==nw.offsetHeight)nw.animate([{height:oh+'px',overflow:'hidden'},{height:nw.offsetHeight+'px',overflow:'hidden'}],{duration:260*D,easing:'cubic-bezier(.18,.89,.32,1)'})}
// mini-calendrier : seuls les jours (numéros, pastilles, vacances, fériés) s'effacent et réapparaissent, la hauteur suit
const miniSwap=(f,d=0)=>fadeSwap(async()=>{f();await load(true)},()=>$('#mini .mg.days'),d?get('animSwipe'):'o',d,true);
const step=(n,swipe)=>{float($('#bub'),false);if(view==='bday')return Promise.resolve();const d=swipe?n:swipeDir(n);return fadeSwap(async()=>{toTop();
  if(view==='year'||view==='bday'){const m=yearMonths(),x=m[0].getFullYear(),y=m[11].getFullYear();yrCustom=false;cur=new Date(n>0?(y>x?y:y+1):(y>x?x:x-1),0,1)}
  else cur=new Date(cur.getFullYear(),cur.getMonth()+n,1);
  await load(true)},paneIn,d?get('animSwipe'):'o',d).then(toNow)};

/* ===== 9b. GLISSER-DÉPOSER (vue Mois) =====
   Évènements modifiables (calendrier personnel ; ni anniversaires, ni externes, ni en mode hors-ligne) : on les attrape à la souris
   (dès 5 px de déplacement) ou au doigt (appui long de 0,4 s) ; la pastille grossit (×1,4, animation des pop-up) et reprend sa taille au dépôt.
   Lâchée sur un autre jour : la date change, l'heure et la durée restent (évènement sur plusieurs jours : décalé du nombre de jours entre la case
   de départ et la case d'arrivée). Sur la corbeille : demande de suppression. Sur le bouton + : pop-up « Dupliquer ».
   Évènement répété (lim) : seulement la corbeille (question « cette occurrence / toute la série ») et le bouton + ; les jours ne réagissent pas.
   Échap annule. Près du haut ou du bas de la vue, elle défile toute seule. Le clic qui suit un dépôt est ignoré (sinon il ouvrirait l'aperçu ou un nouvel évènement). */
let drag=null,dragEnd=0;   // glisser-déposer en cours · heure de fin du dernier
const canDrag=v=>!OFF&&!v.task&&!v.cal.ro&&!v.cal.ext&&!!v.href&&!isBday(v);
function dragInit(el,v,day){el.classList.add('dd');
  el.addEventListener('mousedown',e=>{if(e.button||drag)return;drag={el,v,day,x:e.clientX,y:e.clientY,m:'m',on:false,lim:!!v.rec}});
  el.addEventListener('touchstart',e=>{if(e.touches.length!==1||drag)return;const t=e.touches[0];drag={el,v,day,x:t.clientX,y:t.clientY,m:'t',on:false,lim:!!v.rec};
    drag.tm=setTimeout(()=>{if(drag&&!drag.on){navigator.vibrate?.(15);dragBegin(drag.x,drag.y)}},400)},{passive:true});
  el.addEventListener('touchmove',e=>{if(!drag||drag.m!=='t')return;const t=e.touches[0];if(drag.on){e.preventDefault();dragMove(t.clientX,t.clientY)}else if(Math.hypot(t.clientX-drag.x,t.clientY-drag.y)>8)dragStop()},{passive:false});   // avant l'appui long : on fait défiler, pas de glisser
  el.addEventListener('touchend',e=>{if(!drag||drag.m!=='t')return;if(drag.on){e.preventDefault();dragDrop()}else dragStop()});
  el.addEventListener('touchcancel',()=>dragStop());el.addEventListener('contextmenu',e=>{if(drag)e.preventDefault()})}
// début du glisser : pastille fantôme (grossit autour du point saisi, qui reste sous le pointeur), pastille d'origine estompée, corbeille affichée
function dragBegin(x,y){const d=drag,r=d.el.getBoundingClientRect(),g=d.el.cloneNode(true);g.classList.add('ghost');g.classList.remove('dd');g.style.width=r.width+'px';
  d.dx=d.x-r.left;d.dy=d.y-r.top;d.g=g;g.style.transformOrigin=`${d.dx}px ${d.dy}px`;document.body.append(g);requestAnimationFrame(()=>g.classList.add('big'));d.el.classList.add('dragsrc');document.body.classList.add('dragging');d.on=true;float($('#bub'),false);trashShow(true);
  const p=$('#v-month');d.sc=setInterval(()=>{const r=p.getBoundingClientRect(),m=48;let n=0;if(d.ly<r.top+m)n=-12;else if(d.ly>r.bottom-m)n=12;if(n){const t=p.scrollTop;p.scrollTop+=n;if(p.scrollTop!==t)dragMove(d.lx,d.ly)}},30);
  dragMove(x,y)}
// position de la pastille fantôme : propriété translate, appliquée après scale (avec transform, le déplacement était lui aussi multiplié par 1,4 : pastille décalée vers le bas et la droite)
function dragMove(x,y){const d=drag;if(!d?.on)return;d.lx=x;d.ly=y;d.g.style.translate=`${x-d.dx}px ${y-d.dy}px`;
  // cible : corbeille, bouton + (dupliquer) ou jour (sauf évènement répété)
  const h=document.elementFromPoint(x,y),tr=h?.closest('#trash'),dp=h?.closest('#new'),day=!tr&&!dp&&!d.lim&&h?.closest('#grid [data-d]')?.dataset.d||null,k=tr?'trash':dp?'dup':day;
  $('#trash').classList.toggle('hot',!!tr);$('#new').classList.toggle('hot',!!dp);
  if(k!==d.over){d.over=k;for(const e of document.querySelectorAll('#grid .drop'))e.classList.remove('drop');if(day)for(const e of document.querySelectorAll(`#grid .sec[data-d="${day}"]`))e.classList.add('drop')}
  dropBox(day)}   // recalculé à chaque mouvement (la vue peut défiler)
// Contour du jour visé : un cadre unique autour de l'en-tête et des 3 sections, dans #grid (il défile avec les cases et reste coupé par la vue)
function dropBox(k){let b=$('#dropbox');if(!k){if(b)b.hidden=true;return}const c=[...document.querySelectorAll(`#grid [data-d="${k}"]`)],h=c.find(e=>e.matches('.dh')),s=c.filter(e=>e.matches('.sec'));if(!h||!s.length)return;
  if(!b||b.parentNode!==$('#grid')){b?.remove();b=mk('div');b.id='dropbox';$('#grid').append(b)}
  const g=$('#grid').getBoundingClientRect(),rh=h.getBoundingClientRect(),rs=s.map(e=>e.getBoundingClientRect()),l=Math.min(...rs.map(r=>r.left)),r=Math.max(...rs.map(r=>r.right)),bot=Math.max(...rs.map(r=>r.bottom)),ch=getComputedStyle(h),cs=getComputedStyle(s[s.length-1]);
  Object.assign(b.style,{left:l-g.left+'px',top:rh.top-g.top+'px',width:r-l+'px',height:bot-rh.top+'px',borderRadius:`${ch.borderTopLeftRadius} ${ch.borderTopRightRadius} ${cs.borderBottomRightRadius} ${cs.borderBottomLeftRadius}`});b.hidden=false}
// Corbeille (à gauche du bouton principal) : apparaît au début du glisser, disparaît au dépôt ou à l'annulation (échelle 70 % + opacité, si « Apparition des pop-up » est active)
let trashT;function trashShow(on){const t=$('#trash');clearTimeout(trashT);t.classList.remove('closing','hot');
  if(on){t.hidden=false;t.classList.remove('in');void t.offsetWidth;t.classList.add('in');return}
  if(t.hidden)return;if(!animOn('pop')){t.hidden=true;return}t.classList.remove('in');t.classList.add('closing');trashT=setTimeout(()=>{t.hidden=true;t.classList.remove('closing')},200*AK())}
// fin du glisser : la pastille fantôme reprend sa taille (animée) puis disparaît
function dragStop(){const d=drag;if(!d)return;drag=null;clearTimeout(d.tm);clearInterval(d.sc);d.el.classList.remove('dragsrc');document.body.classList.remove('dragging');
  const g=d.g;if(g){g.classList.remove('big');animOn('pop')?setTimeout(()=>g.remove(),200*AK()):g.remove()}
  for(const e of document.querySelectorAll('#grid .drop'))e.classList.remove('drop');$('#new').classList.remove('hot');dropBox(null);trashShow(false);if(d.on)dragEnd=Date.now()}
// dépôt : corbeille = demande de suppression (comme « Supprimer » dans l'aperçu) ; bouton + = Dupliquer ; autre jour = déplacement
function dragDrop(){const{v,day,over}=drag||{};dragStop();if(over==='trash')return delEv(v);if(over==='dup')return openEv(null,null,v);if(!over||over===day)return;moveEv(v,Math.round((pd(over)-pd(day))/864e5))}
document.addEventListener('mousemove',e=>{if(!drag||drag.m!=='m')return;if(!drag.on&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>5)dragBegin(e.clientX,e.clientY);else if(drag.on)dragMove(e.clientX,e.clientY)});
document.addEventListener('mouseup',()=>{if(!drag||drag.m!=='m')return;drag.on?dragDrop():dragStop()});
document.addEventListener('click',e=>{if(Date.now()-dragEnd<350){e.stopPropagation();e.preventDefault()}},true);   // clic qui suit un dépôt : ignoré
document.addEventListener('keydown',e=>{if(drag&&e.key==='Escape'){e.preventDefault();e.stopImmediatePropagation();dragStop()}},true);
// Déplacement de n jours (date seule : heure, durée, rappels relatifs inchangés) ; affiché tout de suite, annulé à l'écran si Nextcloud refuse
async function moveEv(v,n){if(!n)return;const sh=d=>new Date(d.getFullYear(),d.getMonth(),d.getDate()+n,d.getHours(),d.getMinutes(),d.getSeconds()),old=[v.start,v.end],s=sh(v.start),e=sh(v.end);
  v.start=s;v.end=e;render();
  try{const r=await api('raw?href='+encodeURIComponent(v.href)),props=v.allDay?['DTSTART;VALUE=DATE:'+fmtD(s),'DTEND;VALUE=DATE:'+fmtD(e)]:[dtProp('DTSTART',s),dtProp('DTEND',e)];
    await api('event',{method:'PUT',body:JSON.stringify({href:v.href,etag:r.etag,ics:withTz(patch(masterFirst(r.ics),'VEVENT',props))})});
    toast(T('drag.moved',{title:v.title||T('common.untitled'),date:loc(s,{weekday:'long',day:'numeric',month:'long'})}))}
  catch(x){[v.start,v.end]=old;render();say(T('drag.fail',{e:x.message}))}
  load()}

/* ===== 10. DIALOGUE ÉVÈNEMENT (création / modification) ===== */
// v = évènement à modifier · date = jour cliqué · tpl = évènement à dupliquer (champs recopiés dans un NOUVEL évènement) · min = heure de début (minutes, 9h par défaut)
function openEv(v,date,tpl,min){closePops();editing=v;const src=v||tpl,rec=v&&v.cal.ro,all=src?src.allDay:false,ec=cals.filter(c=>c.ev&&!c.ro&&(c.href!==S.bdayCal||v?.cal.href===c.href));   // rec = verrouillé (calendrier en lecture seule)
  if(!v&&!ec.length)return void say(T(OFF?'offline.noCreate':'ev.noCal'));
  const dur=get('evDur')*60000,s=src?src.start:date?new Date(date.getFullYear(),date.getMonth(),date.getDate(),0,min??540):new Date(Math.ceil(Date.now()/36e5)*36e5);
  const e=src?(all?new Date(src.end.getFullYear(),src.end.getMonth(),src.end.getDate()-1):src.end):new Date(+s+dur);
  durMs=src?Math.max(0,e-s):dur;   // durée mémorisée : sert à recalculer la fin quand on change le début
  $('#c').replaceChildren(...ec.map(c=>{const o=mk('option',null,c.name);o.value=c.href;return o}));
  $('#t').value=src?.title||'';$('#l').value=src?.loc||'';$('#d').value=src?.desc||'';
  // calendrier : celui de l'évènement, du modèle (dupliquer), le « Calendrier par défaut » des Paramètres généraux, sinon le premier
  {const cc=v?v.cal:(tpl&&ec.find(c=>c.href===tpl.cal.href))||ec.find(c=>c.href===S.defCal)||ec[0];$('#c').value=cc.href;$('#cdot').style.background=cc.color}
  $('#a').checked=all;for(const[id,d]of[['s',s],['e',e]]){$('#'+id).type=all?'date':'datetime-local';$('#'+id).value=inp(d,all)}
  // statut (sans STATUS = confirmé) et tags ; dupliquer recopie les deux
  const st=src&&['TENTATIVE','CANCELLED'].includes(src.status)?src.status:'CONFIRMED';document.querySelectorAll('#st .pill').forEach(b=>b.classList.toggle('on',b.dataset.s===st));
  $('#tg').replaceChildren(...TAGS.map(t=>{const b=mk('button','pill'+(hasTag(src,t)?' on':''),tagLbl(t));b.type='button';b.dataset.t=t;b.onclick=()=>b.classList.toggle('on');return b}));
  $('#ok').textContent=T(v?'btn.save':'btn.addNew');$('#f').classList.remove('bmode');$('#t').placeholder=T('ev.titlePh');$('#slab').textContent=T('ev.start');
  // modification : formulaire complet, sans « + d'options » ; création : options repliées, sauf si le modèle (dupliquer) en utilise
  moreSet(!!v||!!src&&(st!=='CONFIRMED'||TAGS.some(t=>hasTag(src,t))||!!src.desc));$('#moreb').hidden=!!v;
  document.querySelectorAll('#f input,#f select,#f textarea,#f .pill').forEach(x=>x.disabled=!!rec);
  const rp=remInit(src,!!v,!!rec);rrInit(null,s);serie=null;
  $('#c').disabled=!!v||!!rec;$('#note').hidden=!rec;$('#ok').hidden=!!rec;$('#del').hidden=!v||!!rec;
  // évènement d'une série : le formulaire montre la SÉRIE (début et fin de la 1re occurrence, règle) ; dupliquer = une seule occurrence
  const sp=v&&v.rec?rawGet(v.href).then(raw=>{const m=parse(masterFirst(raw))[0];if(!m?.rrule||editing!==v)return;serie={start:m.start,end:m.end,all:m.allDay};
    const e2=m.allDay?new Date(m.end.getFullYear(),m.end.getMonth(),m.end.getDate()-1):m.end;$('#a').checked=m.allDay;
    for(const[id,d]of[['s',m.start],['e',e2]]){$('#'+id).type=m.allDay?'date':'datetime-local';$('#'+id).value=inp(d,m.allDay)}durMs=Math.max(0,e2-m.start);
    rrInit(m.rrule,m.start);moreSet(true);$('#rnote').hidden=false;$('#rnote').textContent=T('ev.seriesNote',{date:m.start.toLocaleDateString(LOC)})}).catch(()=>{}):null;
  // ouverture quand les rappels (et la série) sont prêts (préchargés : instantané ; sinon 250 ms maximum, 1,5 s pour une série)
  const show=()=>{if(!$('#dlg').open){$('#dlg').showModal();focusLater($('#dlg'),$('#t'))}};if(!src)show();else Promise.race([Promise.all([rp,sp]),new Promise(r=>setTimeout(r,sp?1500:250))]).then(show)}
// Répétition : affichage selon la fréquence ; jours de la semaine (L M M J V S D) ; fin jamais / le … / après N fois
let serie=null;   // série en cours de modification : {start, end, all} de sa 1re occurrence
$('#rd').replaceChildren(...T('days.initials').split('').map((c,i)=>{const b=mk('button','pill',c);b.type='button';b.dataset.d=WDS[i];b.title=WDL[i];b.onclick=()=>b.classList.toggle('on');return b}));
// Anniversaire (vue Anniversaires, bulles) : même pop-up en mode simplifié — nom, date, « Année inconnue », rappels.
// Enregistré dans le calendrier des anniversaires : journée entière, RRULE:FREQ=YEARLY, X-AGENDA-BIRTHYEAR si l'année est connue
let bdEdit=null;
function openBday(v,D){const c=bdCal();if(!c)return void say(T('bday.noCal'));if(OFF)return void say(T('offline.noCreate'));
  closePops();editing=v;bdEdit=v;serie=null;const f=$('#f');f.classList.add('bmode');
  const d0=v?v.start:D||new Date();$('#t').value=v?.title||'';$('#t').placeholder=T('bday.namePh');$('#slab').textContent=T('bday.date');
  $('#a').checked=true;$('#s').type=$('#e').type='date';$('#s').value=key(v&&v.byear?new Date(v.byear,d0.getMonth(),d0.getDate()):d0);$('#e').value=key(d0);$('#by').checked=!!v&&!v.byear;   // (Fin masquée mais requise : valeur valide)
  $('#c').replaceChildren(Object.assign(mk('option',null,c.name),{value:c.href}));$('#c').value=c.href;rrInit('FREQ=YEARLY',d0);moreSet(false);
  $('#ok').textContent=T(v?'btn.save':'btn.addNew');$('#ok').hidden=false;$('#del').hidden=!v;$('#note').hidden=true;
  document.querySelectorAll('#f input,#f select,#f textarea,#f .pill').forEach(x=>x.disabled=false);
  const rp=remInit(v,!!v,false),show=()=>{if(!$('#dlg').open){$('#dlg').showModal();focusLater($('#dlg'),$('#t'))}};
  v?Promise.race([rp,new Promise(r=>setTimeout(r,250))]).then(show):show()}
async function saveBday(){const c=bdCal(),d=pd($('#s').value),noY=$('#by').checked,t=$('#t').value.trim();if(!c||!t||isNaN(d))return;
  const y=noY?new Date().getFullYear():d.getFullYear(),s=new Date(y,d.getMonth(),d.getDate());   // année inconnue : la série commence cette année
  const props=['SUMMARY:'+esc(t),'DTSTART;VALUE=DATE:'+fmtD(s),'DTEND;VALUE=DATE:'+fmtD(nextD(s)),'RRULE:FREQ=YEARLY','TRANSP:TRANSPARENT',...(noY?[]:['X-AGENDA-BIRTHYEAR:'+d.getFullYear()])];
  try{let raw,etag,href,uid;
    if(bdEdit){const r=await api('raw?href='+encodeURIComponent(bdEdit.href));raw=masterFirst(r.ics,true);etag=r.etag;href=bdEdit.href}
    else{uid=uuid();raw=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Jolical//FR\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:${fmtZ(new Date())}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`}
    let ics=patch(raw,'VEVENT',props,['EXDATE','RDATE','X-AGENDA-BIRTHYEAR','RRULE']);if(!rem.keep)ics=setAlarms(ics,remBuild(s,true,t));
    await api('event',{method:'PUT',body:JSON.stringify({href,cal:c.href,uid,ics,etag})});$('#dlg').close();load()}catch(e){say(T('common.saveFail',{e:e.message}))}}
// Options repliées : statut, tags, répétition, description (la pop-up s'agrandit en douceur : animation de hauteur des pop-up)
function moreSet(on){$('#f').classList.toggle('more',on);$('#moreb').textContent=T(on?'ev.less':'ev.more')}
$('#moreb').onclick=()=>moreSet(!$('#f').classList.contains('more'));
// flèches des champs nombre (tous les N…, après N fois) : couleur principale, sans fond
document.querySelectorAll('.num').forEach(w=>{const i=w.querySelector('input');w.querySelectorAll('.spin button').forEach(b=>{b.innerHTML=ICO[b.dataset.n>0?'u':'d'];
  b.onclick=()=>{if(i.disabled)return;b.dataset.n>0?i.stepUp():i.stepDown();i.dispatchEvent(new Event('change',{bubbles:true}));i.dispatchEvent(new Event('input',{bubbles:true}))}})});
function rrSync(){const f=$('#rf').value,n=+$('#ri').value||1;$('#rdw').hidden=f!=='WEEKLY';$('#rew').hidden=!f||f==='custom';
  $('#riu').textContent=['DAILY','WEEKLY','MONTHLY','YEARLY'].includes(f)?T('rr.unit.'+f+(n>1?'.n':'')):'';$('#ru').hidden=$('#re').value!=='until';$('#rcw').hidden=$('#re').value!=='count'}
function rrInit(rule,start){const o=rule?rrParse(rule):null,cu=$('#rf').querySelector('[value=custom]');cu.hidden=!o?.custom;$('#rf').value=o?(o.custom?'custom':o.f):'';$('#rf').dataset.rule=rule||'';
  $('#ri').value=o?.i||1;$('#re').value=o?.end||'';$('#rc').value=o?.count||10;$('#ru').value=o?.until?key(o.until):'';$('#rnote').hidden=true;
  const days=o?.days?.length?o.days:[WDS[(start.getDay()+6)%7]];document.querySelectorAll('#rd .pill').forEach(b=>b.classList.toggle('on',days.includes(b.dataset.d)));
  const lock=!!editing?.cal?.ro;for(const x of['#rf','#ri','#re','#ru','#rc'])$(x).disabled=lock;document.querySelectorAll('#rd .pill').forEach(b=>b.disabled=lock);rrSync()}
for(const x of['#rf','#ri','#re'])$(x).addEventListener('change',rrSync);
// règle RRULE à écrire (null = aucune ; « Personnalisée » = règle d'origine) ; fin « le … » : jusqu'à la fin de ce jour
function rrBuild(s,all){const f=$('#rf').value;if(!f)return null;if(f==='custom')return $('#rf').dataset.rule;
  let r='FREQ='+f;const n=Math.max(1,Math.min(99,+$('#ri').value||1));if(n>1)r+=';INTERVAL='+n;
  if(f==='WEEKLY'){const d=[...document.querySelectorAll('#rd .on')].map(b=>b.dataset.d);r+=';BYDAY='+(d.length?d:[WDS[(s.getDay()+6)%7]]).join(',')}
  if($('#re').value==='until'&&$('#ru').value){const u=pd($('#ru').value);r+=';UNTIL='+(all?fmtD(u):fmtZ(new Date(u.getFullYear(),u.getMonth(),u.getDate(),23,59,59)))}
  else if($('#re').value==='count')r+=';COUNT='+Math.max(1,Math.min(999,+$('#rc').value||1));return r}
// Début modifié -> la fin suit (nouvel évènement : paramètre "Durée par défaut" ; évènement existant/dupliqué : sa propre durée). Fin modifiée -> nouvelle durée mémorisée
$('#s').addEventListener('change',()=>{if(!$('#s').value)return;const s=pd($('#s').value),all=$('#a').checked;
  $('#e').value=inp(all?new Date(s.getFullYear(),s.getMonth(),s.getDate()+Math.round(durMs/864e5)):new Date(+s+durMs),all)});
$('#e').addEventListener('change',()=>{if($('#s').value&&$('#e').value)durMs=Math.max(0,pd($('#e').value)-pd($('#s').value))});
$('#c').onchange=()=>{const c=cals.find(x=>x.href===$('#c').value);$('#cdot').style.background=c?c.color:'transparent'};
$('#a').onchange=()=>{const all=$('#a').checked;for(const id of['s','e']){const el=$('#'+id),d=pd(el.value||inp(new Date()));el.type=all?'date':'datetime-local';el.value=inp(d,all)}remAdapt()};
$('#s').addEventListener('change',()=>remHint());
document.querySelectorAll('#st .pill').forEach(b=>b.onclick=()=>document.querySelectorAll('#st .pill').forEach(x=>x.classList.toggle('on',x===b)));
$('#cancel').onclick=()=>$('#dlg').close();$('#del').onclick=()=>delEv(editing);
$('#f').onsubmit=async x=>{x.preventDefault();if($('#f').classList.contains('bmode'))return saveBday();const all=$('#a').checked,s=pd($('#s').value);let e=pd($('#e').value);
  if(all)e=new Date(e.getFullYear(),e.getMonth(),e.getDate()+1);if(e<s)return void say(T('ev.endBefore'));
  const props=['SUMMARY:'+esc($('#t').value),all?'DTSTART;VALUE=DATE:'+fmtD(s):dtProp('DTSTART',s),all?'DTEND;VALUE=DATE:'+fmtD(e):dtProp('DTEND',e)];
  if($('#l').value)props.push('LOCATION:'+esc($('#l').value));if($('#d').value)props.push('DESCRIPTION:'+esc($('#d').value));
  try{let raw,etag,href,uid;
    if(editing){const r=await api('raw?href='+encodeURIComponent(editing.href));raw=masterFirst(r.ics);etag=r.etag;href=editing.href}
    else{uid=uuid();raw=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Jolical//FR\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:${fmtZ(new Date())}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`}
    // statut : confirmé = pas de STATUS · tags : nos tags cochés + les autres catégories déjà présentes (posées dans Nextcloud) conservées
    const st=$('#st .on')?.dataset.s||'CONFIRMED',sel=[...document.querySelectorAll('#tg .on')].map(b=>b.dataset.t),rm=[];
    const cats=[...(parse(raw)[0]?.cats||[]).filter(c=>!TAGS.some(t=>t.toLowerCase()===c.toLowerCase())),...sel];
    if(cats.length)props.push('CATEGORIES:'+cats.map(esc).join(','));else rm.push('CATEGORIES');
    if(st!=='CONFIRMED')props.push('STATUS:'+st);else rm.push('STATUS');
    // répétition : RRULE écrite ou retirée ; série redevenue simple = dates exclues et occurrences modifiées supprimées ; début de série déplacé = elles suivent
    const rr=rrBuild(s,all);if(rr)props.push('RRULE:'+rr);else{rm.push('RRULE','EXDATE','RDATE');if(serie)raw=masterFirst(raw,true)}
    if(serie&&rr)raw=shiftDates(raw,serie.all===all?s-serie.start:0);
    // rappel : nos VALARM (marqués X-AGENDA-REMINDER) remplacés ; ceux créés ailleurs jamais touchés ; « Personnalisé » ou rappel non chargé = inchangé
    let ics=withTz(patch(raw,'VEVENT',props,rm));if(!rem.keep)ics=setAlarms(ics,remBuild(s,all,$('#t').value));
    await api('event',{method:'PUT',body:JSON.stringify({href,cal:$('#c').value,uid,ics,etag})});$('#dlg').close();load()
  }catch(err){say(T('common.saveFail',{e:err.message}))}};

/* ===== 10a. RAPPELS (VALARM) =====
   Liste de rappels (5 maximum) : une ligne = un VALARM, marqué X-AGENDA-REMINDER:<type>/<trigger écrit>. Chaque ligne : délai + envoi
   (cloche = notification ACTION:DISPLAY, enveloppe = email ACTION:EMAIL, envoyé par Nextcloud). Les rappels créés ailleurs (Nextcloud, téléphone)
   sont affichés grisés en dessous, en lecture seule, et jamais modifiés. Un des nôtres modifié ailleurs (trigger différent) = « Personnalisé »,
   recopié tel quel. Trigger = écart relatif au début, recalculé à chaque enregistrement ici. */
// [type, libellé, minutes avant (types simples) ou jours avant (types « à l'heure par défaut »)]
const REM=[['start',0],['m5',5],['m15',15],['m30',30],['h1',60],['h2',120],['h24',1440],['day0',0],['day1',1],['day2',2],['week',7]].map(([k,n])=>[k,T('rem.'+k),n]);   // libellés : textes rem.<type>
const REMMAX=5,remDay=k=>/^(day|week)/.test(k);   // types à l'heure par défaut : seuls proposés pour « Toute la journée »
ICO.bell=SV('0 0 24 24','<path d="M12 3.5a5.5 5.5 0 0 0-5.5 5.5v3.6L5 15.5h14l-1.5-2.9V9A5.5 5.5 0 0 0 12 3.5zM9.8 18.5a2.3 2.3 0 0 0 4.4 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');
ICO.mail=SV('0 0 24 24','<rect x="3.5" y="6" width="17" height="12.5" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="m4.5 7.5 7.5 5.5 7.5-5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>');
// rem.rows = nos rappels [{kind, act, block (lignes d'origine si « Personnalisé »), label}] · rem.ext = rappels définis ailleurs · keep = ne pas toucher aux rappels
let rem={keep:true,rows:[],ext:[],msg:'',lock:false},remTok=0;
// minutes entre le rappel et le début (positif = avant). Évènement horaire : « Le jour-même » avant l'heure par défaut = au début (0)
function remBefore(k,s,all){const r=REM.find(x=>x[0]===k);if(!remDay(k))return r[2];
  const b=r[2]*1440+(all?0:s.getHours()*60+s.getMinutes())-tmin(get('remTime'));return all?b:Math.max(0,b)}
// durée iCalendar : -P1DT5H30M (jours « nominaux » : l'heure reste juste au changement d'heure) ; « 24 h avant » = -PT24H exactement (≠ « La veille » à heure fixe)
const durStr=(b,k)=>{if(k==='h24')return'-PT24H';if(!b)return'PT0S';const a=Math.abs(b),d=Math.floor(a/1440),h=Math.floor(a%1440/60),m=a%60;
  return(b>0?'-':'')+'P'+(d?d+'D':'')+(h||m?'T'+(h?h+'H':'')+(m?m+'M':''):'')};
const remTrig=(k,s,all)=>durStr(remBefore(k,s,all),k);
function durMin(x){const m=String(x).match(/^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/);if(!m)return null;
  return(m[1]==='-'?-1:1)*((+m[2]||0)*10080+(+m[3]||0)*1440+(+m[4]||0)*60+(+m[5]||0))}
// Blocs VALARM du premier VEVENT de l'ICS brut : [{lines, p:{TRIGGER, ACTION, X-AGENDA-REMINDER…}}]
function alarmBlocks(raw){const out=[];let inEv=false,cur=null,depth=0;
  for(const l of raw.replace(/\r?\n[ \t]/g,'').split(/\r?\n/)){
    if(cur){cur.lines.push(l);if(l.startsWith('BEGIN:'))depth++;else if(l.startsWith('END:')&&!--depth){out.push(cur);cur=null}else if(depth===1){const j=l.indexOf(':');cur.p[l.slice(0,j).split(';')[0]]=l.slice(j+1)}continue}
    if(l==='BEGIN:VEVENT'){if(inEv)break;inEv=true;continue}
    if(inEv&&l==='BEGIN:VALARM'){cur={lines:[l],p:{}};depth=1}else if(inEv&&l==='END:VEVENT')break}
  return out}
// Remplace nos VALARM dans le VEVENT (les autres sont conservés à l'identique)
function setAlarms(raw,alarms){const out=[];let inEv=false,buf=null,depth=0;
  for(const l of raw.split(/\r?\n/)){
    if(buf){buf.push(l);if(l.startsWith('BEGIN:'))depth++;else if(l.startsWith('END:')&&!--depth){if(!buf.some(x=>x.startsWith('X-AGENDA-REMINDER')))out.push(...buf);buf=null}continue}
    if(l==='BEGIN:VEVENT'&&!inEv){inEv=true;out.push(l);continue}
    if(inEv&&l==='BEGIN:VALARM'){buf=[l];depth=1;continue}
    if(inEv&&l==='END:VEVENT'){out.push(...alarms);inEv=false}
    if(l)out.push(l)}
  return out.join('\r\n')+'\r\n'}
// Nos VALARM à écrire : une par ligne (sauf « Aucun rappel »), doublons fusionnés, « Personnalisé » recopié tel quel
function remBuild(s,all,title){const seen=new Set(),out=[],TT=esc(title||T('rem.default'));
  for(const r of rem.rows){if(r.kind==='none')continue;let L;
    if(r.kind==='custom')L=r.block;else{const tr=remTrig(r.kind,s,all);L=['BEGIN:VALARM','ACTION:'+r.act,...(r.act==='EMAIL'?['SUMMARY:'+TT]:[]),'DESCRIPTION:'+TT,'TRIGGER:'+tr,`X-AGENDA-REMINDER:${r.kind}/${tr}`,'END:VALARM']}
    const id=L.filter(l=>!/^(SUMMARY|DESCRIPTION)[;:]/.test(l)).join('|');if(!seen.has(id)){seen.add(id);out.push(...L)}}
  return out}
// Texte d'un rappel défini ailleurs : « 15 min avant », « 1 j 2 h avant », « 5 min après le début », « le sam. 24 oct. à 09h43 »
const durTxt=m=>{const d=Math.floor(m/1440),h=Math.floor(m%1440/60),n=m%60;return[d&&T('dur.d',{n:d}),h&&T('dur.h',{n:h}),n&&T('dur.m',{n})].filter(Boolean).join(' ')};
function alarmTxt(p,start){const t=p.TRIGGER||'';if(/^\d{8}T\d{6}/.test(t)){const f=pdate(t,'').d;return T('rem.on',{date:loc(f,{weekday:'short',day:'numeric',month:'short'}),time:hm(f)})}
  const b=durMin(t);if(b==null)return T('rem.default');if(!b)return T('rem.start');if(b<0)return T('rem.before',{d:durTxt(-b)});return T('rem.after',{d:durTxt(b)})}
const fireTxt=(p,start)=>{const b=durMin(p.TRIGGER),f=b==null?null:new Date(+start+b*60000);return f?T('fmt.dateAt',{date:fdate(f,{weekday:'short',day:'numeric',month:'short'}),time:hm(f)}):T('rem.other')};
// Affichage des lignes : « Rappel : » sur la 1re, « + » (ajouter) sur la 1re, ✕ rouge (retirer) sur les suivantes ; rappels d'ailleurs grisés dessous
function remRender(){const box=$('#rems'),all=$('#a').checked,t=get('remTime'),L=rem.lock||rem.keep;
  const opts=r=>[['none',T('rem.none')],...REM.filter(x=>(!all||remDay(x[0]))&&(!$('#f').classList.contains('bmode')||['day0','day1','week'].includes(x[0]))).map(x=>[x[0],remDay(x[0])?T('rem.atTime',{label:x[1],time:t}):x[1]]),...(r.kind==='custom'?[['custom',T('rem.custom',{label:r.label})]]:[])];
  const rb=(cls,ic,title,on,dis,fn)=>{const b=mk('button','rb '+cls+(on?' on':''));b.type='button';b.innerHTML=ICO[ic];b.title=title;b.disabled=dis;b.onclick=fn;return b};
  box.replaceChildren(...rem.rows.map((r,i)=>{const row=mk('div','rrow'),sel=mk('select'),off=r.kind==='none'||r.kind==='custom';
      for(const[v,x]of opts(r)){const o=mk('option',null,x);o.value=v;sel.append(o)}sel.value=r.kind;sel.disabled=L;sel.onchange=()=>{r.kind=sel.value;rem.msg='';remRender()};
      row.append(mk('span','rlab'+(i?' gh':''),T('rem.label')),sel,rb('pill','bell',T('rem.notif'),r.act==='DISPLAY',L||off,()=>{r.act='DISPLAY';remRender()}),rb('pill','mail',T('rem.email'),r.act==='EMAIL',L||off,()=>{r.act='EMAIL';remRender()}));
      row.append(i?rb('danger','x',T('rem.remove'),false,L,()=>{rem.rows.splice(i,1);remRender()})
                  :rb('','plus',T('rem.addOne'),false,L||r.kind==='none'||rem.rows.length>=REMMAX,()=>{rem.rows.push({kind:'none',act:'DISPLAY'});remRender()}));return row}),
    ...rem.ext.map(a=>{const row=mk('div','rrow ext'),ic=mk('span');ic.innerHTML=ICO[a.p.ACTION==='EMAIL'?'mail':'bell'];ic.title=T(a.p.ACTION==='EMAIL'?'rem.email':'rem.notif');
      row.title=T('rem.extTitle');row.append(mk('span','rlab gh',T('rem.label')),mk('span','rtxt',T('rem.extTxt',{txt:alarmTxt(a.p)})),ic);return row}));
  remHint()}
function remHint(){const s=$('#s').value&&pd($('#s').value),h=$('#remhint');let m=rem.msg;
  if(!m&&rem.rows.some(r=>r.kind==='day0')&&s&&!$('#a').checked&&s.getHours()*60+s.getMinutes()<tmin(get('remTime')))m=T('rem.hintEarly',{time:get('remTime')});
  h.textContent=m;h.hidden=!m}
// « Toute la journée » cochée : un rappel horaire devient « Le jour-même » (avec une note)
function remAdapt(){const all=$('#a').checked;let n=0;if(all)for(const r of rem.rows)if(r.kind!=='none'&&r.kind!=='custom'&&!remDay(r.kind)){r.kind='day0';n++}
  rem.msg=n?T('rem.adapted',{time:get('remTime')}):'';remRender()}
// Ouverture du formulaire : rappels lus dans l'ICS brut (l'évènement « développé » de la vue peut ne pas contenir les VALARM)
async function remInit(src,edit,lock){const tok=++remTok;rem={keep:false,rows:[{kind:'none',act:'DISPLAY'}],ext:[],msg:'',lock};
  if(!src)return remRender();
  const msgRow=m=>{const r=mk('div','rrow');r.append(mk('span','rlab',T('rem.label')),mk('span',null,m));return r};   // ligne « Rappel : <message> »
  rem.keep=true;$('#rems').replaceChildren(msgRow(T('common.loading')));$('#remhint').hidden=true;
  try{const raw=masterFirst(await rawGet(src.href));if(tok!==remTok)return;const rows=[];
    for(const a of alarmBlocks(raw)){const x=a.p['X-AGENDA-REMINDER'];if(!x){if(edit)rem.ext.push(a);continue}
      const[k,tr]=x.split('/'),act=a.p.ACTION==='EMAIL'?'EMAIL':'DISPLAY';
      if(REM.some(r=>r[0]===k)&&a.p.TRIGGER===tr)rows.push({kind:k,act});else if(edit)rows.push({kind:'custom',act,block:a.lines,label:fireTxt(a.p,src.start)})}
    rem.rows=rows.length?rows.slice(0,REMMAX):[{kind:'none',act:'DISPLAY'}];rem.keep=false;remAdapt()}
  catch{if(tok!==remTok)return;$('#rems').replaceChildren(msgRow(T('rem.unavailable')))}}   // rem.keep reste vrai : rappels non modifiés

/* ===== 10b. DIALOGUE TÂCHE (création / modification / suppression) ===== */
// Listes de tâches modifiables ; liste par défaut = « Liste de tâches par défaut » (Paramètres généraux) si elle existe encore, sinon la première
const tkLists=()=>cals.filter(c=>c.todo&&!c.ro),taskCal=()=>tkLists().find(c=>c.href===S.taskCal)||tkLists()[0];
// visibilité d'un calendrier d'après S.hidden : on = ses évènements, ton = ses tâches
const calVis=c=>{const h=S.hidden||[];c.on=!h.includes(c.href);c.ton=!h.includes('todo:'+c.href);return c};
let tkEdit=null;
function openTask(t){closePops();if(OFF)return void say(T('offline.tasksRo'));const c=t?t.cal:taskCal();if(!c||c.ro)return;tkEdit=t;
  // liste : au choix pour une nouvelle tâche (liste par défaut présélectionnée) ; celle de la tâche, non modifiable, pour une tâche existante
  $('#tk-c').replaceChildren(...(t?[c]:tkLists()).map(x=>{const o=mk('option',null,x.name);o.value=x.href;return o}));$('#tk-c').value=c.href;$('#tk-c').disabled=!!t;$('#tk-dot').style.background=c.color;
  $('#tk-t').value=t?.title||'';$('#tk-done').checked=!!t?.done;$('#tk-hd').checked=!!t?.due;$('#tk-due').value=key(t?.due||new Date());$('#tk-dw').hidden=!t?.due;
  $('#tk-ok').textContent=T(t?'btn.save':'btn.addNew');$('#tk-del').hidden=!t;$('#dtk').showModal();focusLater($('#dtk'),$('#tk-t'))}
$('#tk-hd').onchange=()=>{$('#tk-dw').hidden=!$('#tk-hd').checked};
$('#tk-c').onchange=()=>{const c=cals.find(x=>x.href===$('#tk-c').value);$('#tk-dot').style.background=c?c.color:'transparent'};
$('#tk-cancel').onclick=()=>$('#dtk').close();
$('#tk-del').onclick=async()=>{const t=tkEdit;if(!t||!await ask(T('task.delAsk'),T('btn.del'),true))return;
  try{await api('event',{method:'DELETE',body:JSON.stringify({href:t.href,etag:t.etag})});$('#dtk').close();await loadTasks()}catch(e){say(T('common.fail',{e:e.message}))}};
// Échéance (date seule) : même type (date / date-heure) que DTSTART s'il existe, et DTSTART ramené à l'échéance si elle le précède (sinon Nextcloud refuse)
function dueProps(t,ds){const d=pd(ds),st=t?.start;if(!st)return['DUE;VALUE=DATE:'+fmtD(d)];
  if(t.allDay)return['DUE;VALUE=DATE:'+fmtD(d),...(d<midnight(st)?['DTSTART;VALUE=DATE:'+fmtD(d)]:[])];
  const ref=t.due&&!t.dueAll?t.due:st,dt=new Date(d.getFullYear(),d.getMonth(),d.getDate(),ref.getHours(),ref.getMinutes());return[dtProp('DUE',dt),...(dt<st?[dtProp('DTSTART',dt)]:[])]}
$('#ft').onsubmit=async x=>{x.preventDefault();const t=tkEdit,c=t?t.cal:tkLists().find(y=>y.href===$('#tk-c').value),done=$('#tk-done').checked,ds=$('#tk-hd').checked&&$('#tk-due').value,now=fmtZ(new Date());if(!c)return;
  const props=['SUMMARY:'+esc($('#tk-t').value.trim()),'LAST-MODIFIED:'+now],rm=[];
  // état : écrit seulement s'il change (la date de réalisation d'une tâche déjà terminée est conservée)
  if(!t||t.done!==done){if(done)props.push('STATUS:COMPLETED','COMPLETED:'+now,'PERCENT-COMPLETE:100');else{props.push('STATUS:NEEDS-ACTION');rm.push('COMPLETED','PERCENT-COMPLETE')}}
  // échéance : une échéance existante avec heure est conservée tant que la date ne change pas
  if(!ds)rm.push('DUE');else if(!(t?.due&&!t.dueAll&&key(t.due)===ds))props.push(...dueProps(t,ds));
  try{let raw=t?.raw,uid;if(!t){uid=uuid();raw=`BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Jolical//FR\r\nBEGIN:VTODO\r\nUID:${uid}\r\nDTSTAMP:${now}\r\nCREATED:${now}\r\nEND:VTODO\r\nEND:VCALENDAR\r\n`}
    await api('event',{method:'PUT',body:JSON.stringify({href:t?.href,cal:c.href,uid,etag:t?.etag,ics:withTz(patch(raw,'VTODO',props,rm))})});$('#dtk').close();await loadTasks()}
  catch(e){say(T('common.saveFail',{e:e.message}))}};

/* ===== 11. SÉLECTEUR DE COULEUR maison : carré saturation/luminosité + teinte + pastilles ===== */
const PRESET=['#e74c3c','#e67e22','#f1c40f','#27ae60','#16a085','#4f8cff','#9b59b6','#e84393','#34495e','#9aa3ad','#ffffff','#000000'];
const h2=n=>Math.round(n*255).toString(16).padStart(2,'0');
const hsv2hex=(h,s,v)=>{const f=n=>{const k=(n+h/60)%6;return v-v*s*Math.max(0,Math.min(k,4-k,1))};return'#'+[f(5),f(3),f(1)].map(h2).join('')};
function hex2hsv(x){const r=parseInt(x.slice(1,3),16)/255,g=parseInt(x.slice(3,5),16)/255,b=parseInt(x.slice(5,7),16)/255,mx=Math.max(r,g,b),d=mx-Math.min(r,g,b);let h=0;
  if(d){h=(mx===r?((g-b)/d)%6:mx===g?(b-r)/d+2:(r-g)/d+4)*60;if(h<0)h+=360}return[h,mx?d/mx:0,mx]}
function openPicker(anchor,start,set){const p=$('#cp'),sv=$('#cp-sv'),hs=$('#cp-h');let[h,s,v]=hex2hsv(start());
  const draw=()=>{sv.style.background=`linear-gradient(to top,#000,#0000),linear-gradient(to right,#fff,hsl(${h} 100% 50%))`;$('#cp-dot').style.cssText=`left:${s*100}%;top:${(1-v)*100}%`;hs.value=h},emit=()=>{draw();set(hsv2hex(h,s,v))};
  const mv=e=>{const r=sv.getBoundingClientRect();s=Math.min(1,Math.max(0,(e.clientX-r.left)/r.width));v=1-Math.min(1,Math.max(0,(e.clientY-r.top)/r.height));emit()};
  sv.onpointerdown=e=>{sv.setPointerCapture(e.pointerId);mv(e);sv.onpointermove=mv};sv.onpointerup=sv.onpointercancel=()=>{sv.onpointermove=null};
  hs.oninput=()=>{h=+hs.value;emit()};
  $('#cp-pre').replaceChildren(...PRESET.map(c=>{const b=mk('button','sw');b.type='button';b.style.background=c;b.onclick=()=>{[h,s,v]=hex2hsv(c);emit()};return b}));
  draw();float(p,true);const r=anchor.getBoundingClientRect(),t=r.bottom+6;
  p.style.left=Math.max(4,Math.min(r.left,innerWidth-244))+'px';p.style.top=(t+p.offsetHeight>innerHeight?Math.max(4,r.top-p.offsetHeight-6):t)+'px'}

/* ===== 12. PARAMÈTRES : formulaire généré depuis des listes ===== */
const DAYS=T('days.long').split(',');   // Lundi → Dimanche
// Champ : [clé, libellé, type, a, b, c]  — text | font | check | time | range(a=min,b=max,c=pas) | color(a=défaut,b=index tableau) | auto(a=variable CSS affichée si non défini)
// ext = état des calendriers externes déjà téléchargés (GET /api/ext)
let animSync=()=>{};
function buildSettings(fonts,ext={}){const box=$('#set');box.replaceChildren();
  const field=d=>{if(!d)return mk('div','fsp');const[k,l,t,a,b,c]=d;   // null = petit espace entre deux groupes
    const r=mk('div','fr'+(t==='hover'?' hov':'')),ctl=mk('div','ctl');r.append(mk('label',null,T('fmt.label',{l})),ctl);
    if(t==='text'){const i=mk('input');i.type='text';i.value=S[k]??DEF[k]??'';if(k==='taskFilter'||k==='extAllow')i.placeholder=T('set.'+k+'.ph');i.oninput=()=>{upd(k,i.value);if(k==='taskFilter')render();if(k==='toolsName')tools()};ctl.append(i)}
    else if(t==='font'){const i=mk('select');for(const[v,x]of[['',T('common.default')],...fonts.map(f=>[f,fam(f)])]){const o=mk('option',null,x);o.value=v;i.append(o)}i.value=S[k]||'';i.onchange=()=>upd(k,i.value);ctl.append(i)}
    else if(t==='frame'){   // iframes : case + sites autorisés (séparés par des virgules) ; champ grisé si la case est décochée
      const c=mk('input'),i=mk('input');c.type='checkbox';i.type='text';i.placeholder=T('set.frame.ph');i.value=S.frameSrc||'';
      const sync=()=>{c.checked=!!get('frameOn');i.disabled=!c.checked};sync();c.onchange=()=>{upd('frameOn',c.checked);sync()};i.oninput=()=>upd('frameSrc',i.value.trim());ctl.append(c,i);r.title=T('set.frame.title')}
    else if(t==='checks'){for(const[kk,lb]of a){const w=mk('label','chk'),i=mk('input');i.type='checkbox';i.checked=!!get(kk);i.onchange=()=>{upd(kk,i.checked);render()};w.append(i,' '+lb);ctl.append(w)}}   // plusieurs cases sur la même ligne
    else if(t==='check'){const i=mk('input');i.type='checkbox';i.checked=!!get(k);i.onchange=()=>{upd(k,i.checked);typeof a==='function'&&a()};ctl.append(i)}   // a = action après changement
    else if(t==='hover'){   // survol : k = lettre de la famille, a = « couleur principale » proposée ; curseur −100…100 (luminosité) ou 0…100 (couleur principale), grisé si Aucun
      const sel=mk('select'),i=mk('input'),o=mk('span','val'),mK=k+'Hm',vK=k+'Hv';i.type='range';
      for(const[v,x]of[['none',T('hov.none')],['lum',T('hov.lum')],...(a?[['acc',T('hov.acc')]]:[])]){const op=mk('option',null,x);op.value=v;sel.append(op)}
      const sync=()=>{const m=sel.value;i.min=m==='acc'?0:-100;i.max=100;i.step=5;i.disabled=m==='none';i.value=get(vK);o.textContent=m==='none'?'–':i.value};
      sel.value=get(mK);sync();
      sel.onchange=()=>{const m=sel.value;let n=get(vK);if(m==='acc'&&n<=0)n=n<0?-n:20;if(m==='lum'&&!n)n=-15;S[mK]=m;S[vK]=n;theme();saveS();sync()};
      i.oninput=()=>{o.textContent=i.value;upd(vK,+i.value)};ctl.append(sel,i,o)}
    else if(t==='select'){const i=mk('select');for(const[v,x]of a){const o=mk('option',null,x);o.value=v;i.append(o)}i.value=get(k)??'';if(i.selectedIndex<0)i.selectedIndex=0;i.onchange=()=>{upd(k,i.value);b&&b()};ctl.append(i)}   // a = [[valeur, libellé]], b = action après changement
    else if(t==='time'){const i=mk('input');i.type='time';i.value=get(k);i.onchange=()=>{if(i.value)upd(k,i.value)};ctl.append(i)}
    else if(t==='range'){const i=mk('input'),o=mk('span','val');i.type='range';i.min=a;i.max=b;if(c)i.step=c;i.value=get(k)??get('sizeSub');   // sizeHead non défini = taille des sous-titres
      o.textContent=i.value;i.oninput=()=>{o.textContent=i.value;upd(k,+i.value)};ctl.append(i,o)}
    else{const auto=t==='auto',idx=auto?null:b,sw=mk('button','swatch'),hx=mk('input','hx');sw.type='button';hx.type='text';hx.maxLength=7;hx.placeholder=auto?T('set.auto'):'#rrggbb';
      const val=()=>(idx==null?S[k]:S[k]?.[idx])||(auto?'':a),paint=()=>{hx.value=val();sw.style.background=val()||`var(${a})`};
      const put=c=>{if(idx==null)c?S[k]=c:delete S[k];else{S[k]=S[k]?.length===7?S[k]:Array(7).fill('');S[k][idx]=c}theme();saveS();paint()};
      sw.onclick=e=>{e.stopPropagation();openPicker(sw,()=>val()||'#ffffff',put)};
      hx.oninput=()=>{const c=hx.value.trim().replace(/^#?/,'#');if(/^#[0-9a-f]{6}$/i.test(c))put(c);else if(auto&&!hx.value.trim())put('')};
      paint();ctl.append(sw,hx)}
    return r};
  // Les 7 réglages communs d'une famille d'éléments (x = g, b, c, p, f) ; bg = variable CSS montrée tant que rien n'est défini
  const BX=(x,bg)=>[[x+'Fg',T('fam.Fg'),'auto','--fg'],[x+'Bg',T('fam.Bg'),'auto',bg||'--bg'],[x+'Bo',T('fam.Bo'),'range',0,100],[x+'Bc',T('fam.Bc'),'auto','--line'],
    [x+'Bw',T('fam.Bw'),'range',0,6],[x+'Br',T('fam.Br'),'range',0,30]];
  const SHX=x=>[x+'Sh',T('fam.Sh'),'range',0,40],HOV=(x,acc=true)=>[x,T('fam.hov'),'hover',acc],SP=null;   // toujours en fin de section : Ombre puis Survol ; SP = petit espace entre deux groupes
  const days=[['todayBg',T('set.todayBg'),'color','#e74c3c'],['todayFg',T('set.todayFg'),'color','#ffffff'],...DAYS.flatMap((n,i)=>[['wd',T('set.wd',{day:n}),'color',WD[i],i],['wdf',T('set.wdf',{day:n}),'color','#ffffff',i]]),
    ['vacBg',T('set.vacBg'),'color','#f6d365'],['holBg',T('set.holBg'),'color','#f5a3a3'],['dayC1',T('set.dayC1'),'color','#8e44ad'],['dayC2',T('set.dayC2'),'color','#27ae60'],['dayC3',T('set.dayC3'),'color','#2980b9'],['extOp',T('set.extOp'),'range',0,100],
    ['holEv',T('set.holEv'),'color','#c0392b'],HOV('d')];
  const CAS=['first','words','lower','upper'].map(k=>[k,T('cas.'+k)]);   // casse des titres / sous-titres / calendriers
  const BXc=BX('c','--pan');
  const cats=[
    ['base',T('cat.base'),[['accent',T('set.accent'),'color','#4f8cff'],['bg',T('set.bg'),'auto','--bg'],SP,['fabSize',T('set.fabSize'),'range',60,200,5],SP,
      ['shadow',T('set.shadow'),'color','#000000'],['shadowOp',T('set.shadowOp'),'range',0,100],SP,
      ['muteFg',T('set.muteFg'),'auto','--mut'],['muteBg',T('set.muteBg'),'color','#9aa3ad'],['muteOp',T('set.muteOp'),'range',10,100]]],
    ['esp',T('cat.esp'),[['dens',T('set.dens'),'range',0,12],['weekGap',T('set.weekGap'),'range',0,30],['calPad',T('set.calPad'),'range',0,30],['calPadM',T('set.calPadM'),'range',0,30]]],
    ['txt',T('cat.txt'),[['fontText',T('set.fontText'),'font'],['colText',T('set.colText'),'auto','--fg'],['fontSize',T('set.fontSize'),'range',11,20],SP,
      ['fontTitle',T('set.fontTitle'),'font'],['colTitle',T('set.colTitle'),'auto','--fg'],['colPanel',T('set.colPanel'),'auto','--tc'],['colPop',T('set.colPop'),'auto','--tc'],['sizeTitle',T('set.sizeTitle'),'range',16,60],['casTitle',T('set.casTitle'),'select',CAS],SP,
      ['fontSub',T('set.fontSub'),'font'],['colSub',T('set.colSub'),'auto','--mut'],['sizeSub',T('set.sizeSub'),'range',9,24],['casSub',T('set.casSub'),'select',CAS],SP,
      ['fontHead',T('set.fontHead'),'font'],['sizeHead',T('set.sizeHead'),'range',9,24],['casCal',T('set.casCal'),'select',CAS],SP,
      ['hdBp',T('set.hdBp'),'range',500,2000,10]]],
    ['ld',T('cat.ld'),[['ldFg',T('set.ldFg'),'auto','--tc'],['ldBg',T('set.ldBg'),'auto','--bg']]],
    ['gen',T('cat.gen'),[['sideBg',T('set.sideBg'),'auto','--sbg'],SP,...BX('g'),SP,['grpBg',T('set.grpBg'),'auto','--grp'],['grpOp',T('set.grpOp'),'range',0,100],['bubR',T('set.bubR'),'range',0,30],SP,SHX('g'),HOV('g')]],
    ['btn',T('cat.btn'),[...BX('b'),['bmFg',T('set.bmFg'),'auto','--fg'],['bmBg',T('set.bmBg'),'auto','--bg'],['dangerBg',T('set.dangerBg'),'auto','--danger'],['dangerFg',T('set.dangerFg'),'auto','--fg'],['dangerBc',T('set.dangerBc'),'auto','--line'],['casBtn',T('set.casBtn'),'select',CAS],SHX('b'),HOV('b',false)]],
    ['cal',T('cat.cal'),[BXc[0],['monthCol',T('set.monthCol'),'auto','--tc'],...BXc.slice(1),['hdRadius',T('set.hdRadius'),'range',0,24],
      ['abbr',T('set.abbr'),'select',['always','mobile','never'].map(k=>[k,T('set.abbr.'+k)]),()=>render()],
      ['sepW',T('set.sepW'),'range',0,4],['sepOp',T('set.sepOp'),'range',0,100],SHX('c'),HOV('c')]],
    ['days',T('cat.days'),days],
    ['evt',T('cat.evt'),[['evFg',T('set.evFg'),'color','#ffffff'],['evAuto',T('set.evAuto'),'check'],
      ['evRadius',T('set.evRadius'),'range',0,16],['bigRadius',T('set.bigRadius'),'range',0,30],['evPad',T('set.evPad'),'range',0,10],['recOp',T('set.recOp'),'range',10,100],
      ['ncOp',T('set.ncOp'),'range',10,100],['evLum',T('set.evLum'),'range',-100,100,5],
      ['dotLum',T('set.dotLum'),'range',-100,100,5],['dotSize',T('set.dotSize'),'range',40,100,5],
      ['minM',T('set.minM'),'range',0,10],['minA',T('set.minA'),'range',0,10],['minS',T('set.minS'),'range',0,10],
      ['maxEv',T('set.maxEv'),'range',1,10],['yrMax',T('set.yrMax'),'range',1,10],['evSh',T('set.evSh'),'range',0,40],HOV('e')]],
    ['task',T('cat.task'),[['todoCol',T('set.todoCol'),'auto','--fg'],['doneCol',T('set.doneCol'),'auto','--acc'],['fontTask',T('set.fontTask'),'font'],HOV('t')]],
    ['pop',T('cat.pop'),[...BX('p'),['popPad',T('set.popPad'),'range',4,40],['popBg',T('set.popBg'),'color','#000000'],['popOp',T('set.popOp'),'range',0,100],['blur',T('set.blur'),'range',0,20],SHX('p')]],
    ['fld',T('cat.fld'),[...BX('f'),SHX('f'),HOV('f')]],
    ['anim',T('cat.anim'),[['anim',T('set.anim'),'check',()=>animSync()],['animSpeed',T('set.animSpeed'),'select',['fast','normal','slow'].map(k=>[k,T('set.animSpeed.'+k)])],
      ['animSide',T('set.animSide'),'check'],['animFold',T('set.animFold'),'check'],['animPop',T('set.animPop'),'select',['o','s','os'].map(k=>[k,T('set.animPop.'+k)])],
      ['animHov',T('set.animHov'),'check'],['animLift',T('set.animLift'),'check'],['animFab',T('set.animFab'),'check'],['animDot',T('set.animDot'),'check'],
      ['animView',T('set.animView'),'check'],['animTitle',T('set.animTitle'),'check'],['animSwipe',T('set.animSwipe'),'select',['none','t','o','to'].map(k=>[k,T('set.animSwipe.'+k)])],['animSwipeAll',T('set.animSwipeAll'),'check']]],
    ['css',T('cat.css'),null]];
  // Calendrier par défaut : premier calendrier modifiable si rien n'est choisi ; choisi mais disparu -> « Calendrier indisponible » (grisé)
  const ecs=cals.filter(c=>c.ev&&!c.ro&&c.href!==S.bdayCal),dc=[...ecs.map(c=>[c.href,c.name]),...(S.defCal&&!ecs.some(c=>c.href===S.defCal)?[[S.defCal,T('set.calUnav')]]:[])];
  box.append(mk('h3',null,T('sec.general')),...[...(LANGS.length>1?[['lang',T('set.lang'),'select',LANGS.map(l=>[l.code,l.name]),()=>langSave(S.lang)]]:[]),['title',T('set.title'),'text'],['startView',T('set.startView'),'select',['month','year','bday'].map(k=>[k,T('set.startView.'+k)])],
    ['defCal',T('set.defCal'),'select',dc],
    ['taskCal',T('set.taskCal'),'select',[['',T('set.taskCal.first')],...cals.filter(c=>c.todo&&!c.ro).map(c=>[c.href,c.name])],()=>renderSide()],
    ['bdayCal',T('set.bdayCal'),'select',[['',T('common.none')],...cals.filter(c=>c.ev&&!c.ro).map(c=>[c.href,c.name])],()=>{if(view==='bday'&&!bdCal())view='month';buildSettings(...BS);render()}],
    ['bdv',T('set.bdv'),'checks',[['bdayMonth',T('view.month')],['bdayYear',T('view.year')]]],SP,
    ['evDur',T('set.evDur'),'range',5,240,5],['remTime',T('set.remTime'),'time'],['pmStart',T('set.pmStart'),'time'],['evStart',T('set.evStart'),'time'],SP,
    ['taskFilter',T('set.taskFilter'),'text'],['showTags',T('set.showTags'),'check'],['frameOn',T('set.frameOn'),'frame']].map(field));
  {const o=[...box.querySelectorAll('option')].find(x=>x.textContent===T('set.calUnav'));if(o)o.className='unav';const sel=o?.parentNode;if(sel){const f=()=>sel.classList.toggle('unav',sel.value===o.value);f();sel.addEventListener('change',f)}}
  // 12b. Calendriers externes (jours fériés, vacances) : URL + bouton Télécharger (Télécharger → Chargement… → Fichier téléchargé ! / Erreur : Réessayer ?)
  // prochaine mise à jour automatique : calculée par le serveur seulement (m.next ; absente si « Jamais »)
  const fd=d=>new Date(d).toLocaleDateString(LOC),fdt=d=>T('fmt.dateAt',{date:fd(d),time:hm(new Date(d))});
  const extInfo=(m,ev)=>{const y=s=>s.slice(0,4),per=y(m.from)===y(m.to)?y(m.from):y(m.from)+' → '+y(m.to),nx=m.next,h=ev==='hour'||ev==='h12';   // ev : fréquence propre (calendriers ajoutés) : heure affichée pour « heure » / « 12 h »
    return[m.name&&T('ext.name',{name:m.name}),T(m.n>1?'ext.events':'ext.event',{n:m.n}),per,T('ext.got',{date:(h?fdt:fd)(m.date)}),nx&&T('ext.next',{date:(h?fdt:fd)(nx)})].filter(Boolean).join(' · ')};
  const errInfo=m=>T('ext.err',{date:fd(m.errDate),err:m.err,file:fd(m.date)}),extIdle=[];
  const extRow=(kind,k,label)=>{const r=mk('div','fr ext'),ctl=mk('div','ctl'),i=mk('input'),b=mk('button'),info=mk('div','extinfo');let meta=ext[kind]||null;
    if(!S[k]&&meta?.url){S[k]=meta.url;saveS()}   // URL absente des réglages : reprise du fichier déjà téléchargé
    i.type='url';i.placeholder=T('ext.ph');i.value=S[k]||'';b.type='button';
    const state=(st,msg)=>{b.className=st==='ok'?'pri':st==='err'||st==='uerr'?'danger':'';b.disabled=st==='load'||!i.value.trim();
      b.textContent=T({ok:'ext.ok',err:'ext.retry',uerr:'ext.uerr',load:'common.loading'}[st]||'ext.dl');info.textContent=msg||''};
    // "téléchargé" tant que l'URL n'a pas changé ; échec de la mise à jour automatique : bouton rouge + URL en rouge (un clic relance le téléchargement)
    const idle=()=>{meta=ext[kind]||null;const same=!!meta&&meta.url===i.value.trim();i.classList.toggle('bad',same&&!!meta.err);if(!same)state('');else if(meta.err)state('uerr',errInfo(meta));else state('ok',extInfo(meta))};extIdle.push(idle);
    i.oninput=()=>{upd(k,i.value.trim());idle()};
    b.onclick=async()=>{const u=i.value.trim();if(!u)return;upd(k,u);state('load');
      try{meta=ext[kind]=await api('ext/'+kind,{method:'POST',body:JSON.stringify({url:u})});if(i.value.trim()===u){i.classList.remove('bad');state('ok',extInfo(meta))}await loadExt();renderSide()}
      catch(e){if(i.value.trim()===u)state('err',e.message.replace(/^HTTP \d+ : /,''))}};
    idle();ctl.append(i,b);r.append(mk('label',null,T('fmt.label',{l:label})),ctl,info);return r};
  // 12a. Liens externes (catégorie Outils du volet) : nom, liens Nextcloud, puis liens personnalisés (intitulé + URL ; une ligne vide en bas, 10 liens au plus)
  box.append(mk('h3',null,T('sec.links')),...[['toolsName',T('set.toolsName'),'text'],['toolsCal',T('set.toolsCal'),'check',tools],['toolsDeck',T('set.toolsDeck'),'check',tools],['toolsTasks',T('set.toolsTasks'),'check',tools]].map(field));
  {const lb=mk('div','lkrows'),L=(S.links||[]).map(x=>({...x})),save=()=>{const v=L.filter(x=>x.t.trim()&&linkOk(x.u));if(v.length)S.links=v.map(x=>({t:x.t.trim(),u:x.u.trim()}));else delete S.links;saveS();tools()};
    const row=x=>{const r=mk('div','lkrow'+(x?'':' draft')),t=mk('input'),u=mk('input'),del=mk('button','danger xb');t.type='text';t.maxLength=60;t.placeholder=T('links.title');u.type='url';u.maxLength=500;u.placeholder=T('links.url');
      del.type='button';del.innerHTML=ICO.x;del.title=T('links.del');let it=x;t.value=x?.t||'';u.value=x?.u||'';
      const chk=()=>{u.classList.toggle('bad',!!u.value.trim()&&!linkOk(u.value));
        if(!it&&t.value.trim()&&u.value.trim()){it={t:'',u:''};L.push(it);r.classList.remove('draft');del.hidden=false;if(L.length<10)lb.append(row(null))}   // ligne remplie : bouton ✕ + nouvelle ligne vide
        if(it){it.t=t.value;it.u=u.value;save()}};
      t.oninput=u.oninput=chk;u.onblur=()=>{if(u.value.trim()&&!/^[a-z]+:/i.test(u.value.trim())){u.value='https://'+u.value.trim();chk()}};   // adresse sans « https:// » : ajouté
      del.hidden=!x;del.onclick=()=>{const i=L.indexOf(it);if(i>=0)L.splice(i,1);r.remove();save();if(!lb.querySelector('.lkrow.draft')&&L.length<10)lb.append(row(null))};
      r.append(t,u,del);return r};
    lb.append(...L.map(row),...(L.length<10?[row(null)]:[]));box.append(mk('label','xlab',T('links.label')),lb)}
  box.append(mk('h3',null,T('sec.look')));
  // Thème : liste (Par défaut + thèmes enregistrés) ; thème ordinaire : Nouveau (copie du thème affiché), Renommer, Supprimer ;
  // copie « (modifié) » : Écraser (remplace le thème d'origine), Nouveau (l'enregistre sous un autre nom), Supprimer.
  // Modifier l'apparence crée la copie « (modifié) » (voir server.js, THÈMES) ; dans une iframe, le thème choisi est propre à l'intégration.
  {const r=mk('div','fr thr'),c=mk('div','ctl'),sel=mk('select'),bo=mk('button',null,T('theme.overwrite')),bn=mk('button',null,T('theme.new')),br=mk('button',null,T('theme.rename')),bd=mk('button','danger',T('btn.del'));r.append(mk('label',null,T('fmt.label',{l:T('theme.label')})),c);c.append(sel,bo,bn,br,bd);
    const apply=s=>{S=s;theme();buildSettings(...BS);render();renderSide()},flush=async()=>{clearTimeout(tmr);thAfter(await api('settings',{method:'PUT',body:JSON.stringify(S)}))};
    let L=[];const curT=()=>L.find(x=>x.id===sel.value),orgName=t=>t?.from==='defaut'?T('common.default'):L.find(x=>x.id===t?.from)?.name;
    thSync=async()=>{let t={list:[]};try{t=await api('themes')}catch{}L=t.list||[];sel.replaceChildren(...[['defaut',T('common.default')],...L.map(x=>[x.id,x.name])].map(([v,n])=>{const o=mk('option',null,n);o.value=v;return o}));
      sel.value=S.theme||'defaut';if(sel.selectedIndex<0)sel.value='defaut';const ct=curT(),dr=!!ct?.from,on=orgName(ct);
      bo.hidden=!dr;br.hidden=dr;br.disabled=bd.disabled=sel.value==='defaut';bo.disabled=!on||ct.from==='defaut';
      bo.title=!dr?'':ct.from==='defaut'?T('theme.noOverwriteDef'):on?T('theme.overwriteTitle',{name:on}):T('theme.noOrigin');
      bn.title=T(dr?'theme.saveAsTitle':'theme.newTitle')};thSync();
    const run=async f=>{try{apply(await f())}catch(e){say(T('common.fail',{e:e.message.replace(/^HTTP \d+ : /,'')}));thSync()}};
    sel.onchange=()=>run(async()=>{await flush();return api('themes/'+sel.value,{method:'PUT',body:JSON.stringify({select:true})})});
    bo.onclick=async()=>{const t=curT();if(!t?.from||!await ask(T('theme.overwriteAsk',{from:orgName(t),name:t.name}),T('theme.overwrite'),true))return;run(async()=>{await flush();return api('themes/'+t.id+'/overwrite',{method:'POST',body:'{}'})})};
    bn.onclick=async()=>{const t=curT();if(t?.from){const n=await promptBox(T('theme.saveAsAsk'),t.name,T('btn.save'));if(n)run(async()=>{await flush();return api('themes/'+t.id,{method:'PUT',body:JSON.stringify({name:n})})});return}
      const n=await promptBox(T('theme.newAsk'),'',T('btn.create'));if(n)run(async()=>{await flush();return api('themes',{method:'POST',body:JSON.stringify({name:n})})})};
    br.onclick=async()=>{const n=await promptBox(T('theme.renameAsk'),sel.options[sel.selectedIndex].text,T('theme.rename'));if(n)run(()=>api('themes/'+sel.value,{method:'PUT',body:JSON.stringify({name:n})}))};
    bd.onclick=async()=>{if(await ask(T('theme.delAsk',{name:sel.options[sel.selectedIndex].text}),T('btn.del'),true))run(()=>api('themes/'+sel.value,{method:'DELETE',body:'{}'}))};
    box.append(r,mk('p','hint',T('theme.hint')+(FRAMED?' '+T('theme.hintFrame'):'')))}
  // Apparence simple (par défaut) : les réglages essentiels ; « Paramètres avancés » (choix mémorisé, setAdv) : toutes les catégories
  const adv=!!get('setAdv'),ab=mk('button','advb',T(adv?'set.simple':'set.adv'));ab.type='button';ab.onclick=()=>{S.setAdv=!adv;saveS();buildSettings(...BS)};
  const ar=mk('div','advrow');ar.append(ab);box.append(ar);
  if(!adv){box.append(...[['accent',T('set.accent'),'color','#4f8cff'],['bg',T('set.bg'),'auto','--bg'],SP,['fontText',T('set.fontText'),'font'],['fontTitle',T('set.fontTitle'),'font'],['fontSize',T('set.fontSize'),'range',11,20],
    ['dens',T('set.dens'),'range',0,12],SP,['anim',T('set.anim'),'check',()=>animSync()],['animSpeed',T('set.animSpeed'),'select',['fast','normal','slow'].map(k=>[k,T('set.animSpeed.'+k)])]].map(field));
    const sp=[...box.querySelectorAll('.fr')].at(-1);   // ligne « Vitesse des animations »
    if(RM?.matches)sp.after(mk('p','hint',T('set.reduced')));
    animSync=()=>{const off=!get('anim');sp.style.opacity=off?.5:'';sp.querySelectorAll('select').forEach(i=>i.disabled=off)};animSync()}
  if(adv)for(const[id,name,fs]of cats){const open=(S.setOpen||[]).includes(id),box1=mk('div','cat'),h=mk('h4','cat-h'+(open?'':' shut')),b=mk('div','cat-b'),ic=mk('i');ic.innerHTML=ICO.d;h.append(mk('span',null,name),ic);b.hidden=!open;
    if(fs)b.append(...fs.map(field));else{const t=mk('textarea');t.rows=8;t.spellcheck=false;t.placeholder=T('set.css.ph');t.value=S.css||'';t.oninput=()=>upd('css',t.value);b.append(t)}
    h.onclick=()=>{const open=b.hidden||!!b._closing;foldTo(b,open);h.classList.toggle('shut',!open);S.setOpen=[...(S.setOpen||[]).filter(x=>x!==id),...(open?[id]:[])];saveS()};box1.append(h,b);box.append(box1)}
  // Animations : champs grisés si « Activer les animations » est décoché ; note si le système demande de réduire les animations
  {const c=[...box.querySelectorAll('.cat')].find(x=>x.querySelector('.cat-h span').textContent===T('cat.anim'));if(c){const b=c.querySelector('.cat-b');
    if(RM?.matches)b.prepend(mk('p','hint',T('set.reduced')));
    animSync=()=>{const off=!get('anim');[...b.querySelectorAll('.fr')].slice(1).forEach(r=>{r.style.opacity=off?.5:'';r.querySelectorAll('input,select').forEach(i=>i.disabled=off)})};animSync()}}
  // Calendriers externes (après Apparence) : d'abord les calendriers ajoutés, puis jours fériés et vacances
  // Calendrier(s) externe(s) : une ligne par calendrier téléchargé (pastille de couleur, nom, fréquence d'actualisation, ✕ rouge ; URL + Télécharger ; info),
  // puis toujours une ligne vide (URL + Télécharger) pour en ajouter un autre (10 au maximum)
  const XEV=['hour','h12','day','week','quarter','year','never'].map(k=>[k,T('xev.'+k)]);
  const xcb=mk('div','xcs'),xcDraw=()=>{
    const after=async()=>{await loadXc();renderSide();load();xcDraw()};
    const row=x=>{const r=mk('div','fr ext xc'+(x?'':' draft')),top=mk('div','ctl'),ctl=mk('div','ctl'),info=mk('div','extinfo'),i=mk('input'),b=mk('button');i.type='url';i.placeholder=T('ext.ph2');i.value=x?.url||'';b.type='button';
      const state=(st,msg)=>{b.className=st==='ok'?'pri':st==='err'||st==='uerr'?'danger':'';b.disabled=st==='load'||!i.value.trim();
        b.textContent=T({ok:'ext.ok',err:'ext.retry',uerr:'ext.uerr',load:'common.loading'}[st]||'ext.dl');info.textContent=msg||''};
      const idle=()=>{const same=!!x&&x.url===i.value.trim();i.classList.toggle('bad',same&&!!x.meta?.err);if(!same)state('');else if(x.meta?.err)state('uerr',errInfo(x.meta));else state('ok',x.meta?extInfo(x.meta,x.every):'')};
      i.oninput=idle;
      b.onclick=async()=>{const u=i.value.trim();if(!u)return;state('load');
        try{await api('extcals'+(x?'/'+x.id:''),{method:x?'PUT':'POST',body:JSON.stringify({url:u,refresh:true})});await after()}catch(e){if(i.value.trim()===u)state('err',e.message.replace(/^HTTP \d+ : /,''))}};
      if(x){const sw=mk('button','swatch'),nm=mk('input'),fq=mk('select'),del=mk('button','danger xb');sw.type=del.type='button';sw.style.background=x.color;sw.title=T('ext.color');
        nm.type='text';nm.maxLength=60;nm.value=x.own?x.name:'';nm.placeholder=x.meta?.name||x.name;nm.title=T('ext.nameTitle');
        for(const[v,t]of XEV){const o=mk('option',null,t);o.value=v;fq.append(o)}fq.value=x.every||'quarter';fq.title=T('ext.every');
        sw.onclick=e=>{e.stopPropagation();openPicker(sw,()=>x.color,async c=>{x.color=c;sw.style.background=c;clearTimeout(sw._t);sw._t=setTimeout(async()=>{try{await api('extcals/'+x.id,{method:'PUT',body:JSON.stringify({color:c})});await loadXc();renderSide();render()}catch{}},400)})};
        nm.onchange=async()=>{try{await api('extcals/'+x.id,{method:'PUT',body:JSON.stringify({name:nm.value})});await loadXc();renderSide();render()}catch(e){say(T('common.fail',{e:e.message}))}};
        nm.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();nm.blur()}};
        fq.onchange=async()=>{try{x.every=fq.value;const r=await api('extcals/'+x.id,{method:'PUT',body:JSON.stringify({every:fq.value})});x.meta=r.meta;idle()}catch(e){say(T('common.fail',{e:e.message}))}};   // le serveur renvoie la nouvelle date de mise à jour
        del.innerHTML=ICO.x;del.title=T('ext.del');
        del.onclick=async()=>{const n=(xcals.find(c=>c.id===x.id)||x).name;if(!await ask(T('ext.delAsk',{name:n}),T('btn.del'),true))return;try{await api('extcals/'+x.id,{method:'DELETE',body:'{}'})}catch(e){return say(T('common.fail',{e:e.message}))}await after()};
        top.append(sw,nm,fq,del);r.append(top)}
      ctl.append(i,b);r.append(ctl,info);idle();return r};
    xcb.replaceChildren(mk('label','xlab',T('ext.added')),...xcals.map(row),...(xcals.length<10?[row(null)]:[]))};
  xcDraw();
  box.append(mk('h3',null,T('sec.ext')),xcb,extRow('hol','holUrl',T('set.holUrl')),extRow('vac','vacUrl',T('set.vacUrl')),
    ...[['extEvery',T('set.extEvery'),'select',['day','week','month','quarter','semester','year','never'].map(k=>[k,T('set.extEvery.'+k)]),async()=>{try{clearTimeout(tmr);await api('settings',{method:'PUT',body:JSON.stringify(S)});Object.assign(ext,await api('ext'))}catch{}extIdle.forEach(f=>f())}],['holMonth',T('set.holMonth'),'check'],['holYear',T('set.holYear'),'check'],
      ['vacMonth',T('set.vacMonth'),'check'],['vacYear',T('set.vacYear'),'check'],
      ['vacCut',T('set.vacCut'),'check'],SP,['extAllow',T('set.extAllow'),'text']].map(field),
    mk('p','hint',T('set.extAllow.hint')));
  // Sauvegarde de la configuration : fichier .json (réglages généraux, calendriers externes, thème choisi) ; l'import demande confirmation puis recharge
  const bt=(t,f)=>{const b=mk('button',null,t);b.onclick=f;return b},srow=mk('div','srow'),fin=mk('input');fin.type='file';fin.accept='.json,application/json';fin.hidden=true;
  box.append(mk('h3',null,T('sec.cfg')),mk('p','hint',T('cfg.hint')),srow,fin);
  srow.append(bt(T('cfg.export'),async()=>{try{clearTimeout(tmr);await api('settings',{method:'PUT',body:JSON.stringify(S)});const r=await fetch('/api/config',{headers:{'X-Requested-With':'cal'}});if(!r.ok)throw new Error('HTTP '+r.status);
      const u=URL.createObjectURL(await r.blob()),a=mk('a');a.href=u;a.download='jolical-configuration-'+key(new Date())+'.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),2000)}catch(e){say(T('cfg.exportFail',{e:e.message}))}}),
    bt(T('cfg.import'),()=>fin.click()));
  fin.onchange=async()=>{const f=fin.files[0];fin.value='';if(!f)return;let j;try{j=JSON.parse(await f.text())}catch{return say(T('cfg.unreadable'))}
    if(j.app!=='jolical'&&j.app!=='agenda')return say(T('cfg.notCfg'));
    if(!await ask(T('cfg.importAsk',{date:j.date?new Date(j.date).toLocaleDateString(LOC):'?',theme:j.theme?.name||T('common.default')}),T('cfg.importBtn')))return;
    try{const r=await api('config',{method:'POST',body:JSON.stringify(j)});if(r.errors?.length)await say(T('cfg.partial',{errors:r.errors.join('\n')}));location.reload()}catch(e){say(T('cfg.importFail',{e:e.message.replace(/^HTTP \d+ : /,'')}))}};
  // Connexion : appareils autorisés + déconnexion
  // Connexions : appareils autorisés + déconnexion
  const dv=mk('div','devs'),crow=mk('div','srow');box.append(mk('h3',null,T('sec.conn')),mk('p','hint',T('conn.hint')),dv,crow);
  crow.append(bt(T('conn.logout'),async()=>{if(!await ask(T('conn.logoutAsk'),T('conn.logout'),true))return;try{await api('logout',{method:'POST',body:'{}'})}catch{}location.reload()}),
    Object.assign(bt(T('conn.all'),async()=>{if(!await ask(T('conn.allAsk'),T('conn.allBtn'),true))return;
      try{await api('devices',{method:'DELETE',body:JSON.stringify({all:true})})}catch{}location.reload()}),{className:'danger'}));
  // saisie du mot de passe : adresses bloquées, derniers échecs, déblocage
  const lk=mk('div');box.append(mk('div','lkh',T('lock.title')),lk);lkBox=lk;lockList(lk);
  devBox=dv;devList(dv)}
// Saisie du mot de passe (Paramètres > Connexions) : chaque adresse qui se trompe 3 fois est bloquée (5 min, 1 h, 24 h) ; ralentissement général
// au-delà de 20 erreurs en une heure ; « Débloquer » efface tout (blocages et liste des échecs)
let lkBox=null;
async function lockList(box){let l;try{l=await api('lockout')}catch(e){box.replaceChildren(mk('p','hint',T('lock.unavailable',{e:e.message})));return}
  const kids=[],ul=mk('ul','lkl'),b=mk('button',null,T('lock.clear'));
  for(const x of l.blocked)kids.push(mk('p','hint',T('lock.blocked',{ip:x.ip,when:whenTxt(x.until,true)})));
  if(l.slow)kids.push(mk('p','hint',T('lock.slow')));
  if(!l.blocked.length&&!l.slow)kids.push(mk('p','hint',T('lock.none')));
  for(const r of l.recent){const li=mk('li');li.append(mk('b',null,cap(whenTxt(r.t,true))),' — '+r.ip);ul.append(li)}
  kids.push(l.recent.length?Object.assign(mk('p','hint',T('lock.recent')),{style:'margin-bottom:0'}):mk('p','hint',T('lock.noRecent')));if(l.recent.length)kids.push(ul);
  b.disabled=!l.blocked.length&&!l.slow&&!l.recent.length;b.onclick=async()=>{try{await api('lockout/clear',{method:'POST',body:'{}'});toast(T('lock.cleared'))}catch(e){say(T('common.fail',{e:e.message}))}lockList(box)};
  const w=mk('div','srow');w.append(b);box.replaceChildren(...kids,w)}
// Liste des appareils : nom (+ « cet appareil »), dernière activité et adresse, Renommer (champ + OK, Entrée / Échap), ✕ rouge (avec confirmation)
let devBox=null;   // liste actualisée à chaque ouverture des Paramètres
async function devList(box){let l;try{l=await api('devices')}catch(e){box.replaceChildren(mk('p','hint',T('dev.unavailable',{e:e.message})));return}
  box.replaceChildren(...l.map(dv=>{const r=mk('div','dev'+(dv.me?' me':'')),info=mk('div','dn'),nm=mk('b',null,dv.name),ren=mk('button',null,T('theme.rename')),x=mk('button','danger dx');
    x.innerHTML=ICO.x;x.title=T('dev.logout');info.append(nm);if(dv.me)info.append(mk('span','me',T('dev.me')));
    info.append(mk('small',null,T('dev.seen',{when:whenTxt(dv.seen,true)})),mk('small',null,(dv.ip?T('dev.ip',{ip:dv.ip}):'')+T('dev.since',{date:new Date(dv.created).toLocaleDateString(LOC)})));
    ren.onclick=()=>{const w=mk('div','ren'),i=mk('input'),okb=mk('button','pri',T('btn.ok'));i.type='text';i.maxLength=40;i.value=dv.name;i.placeholder=dv.auto;w.append(i,okb);
      info.replaceWith(w);ren.hidden=true;i.focus();i.select();
      const done=async save=>{if(save){try{await api('devices',{method:'PUT',body:JSON.stringify({id:dv.id,name:i.value})})}catch(e){say(T('common.fail',{e:e.message}))}}devList(box)};
      okb.onclick=()=>done(true);i.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();done(true)}else if(e.key==='Escape'){e.preventDefault();e.stopPropagation();done(false)}}};
    x.onclick=async()=>{if(!await ask(dv.me?T('dev.logoutMe'):T('dev.logoutAsk',{name:dv.name}),T('dev.logoutBtn'),true))return;
      try{await api('devices',{method:'DELETE',body:JSON.stringify({id:dv.id})})}catch(e){return say(T('common.fail',{e:e.message}))}if(dv.me)location.reload();else devList(box)};
    r.append(info,ren,x);return r}))}

/* ===== 13. INITIALISATION & ÉVÈNEMENTS GLOBAUX ===== */
document.querySelectorAll('[data-ico]').forEach(e=>e.innerHTML=ICO[e.dataset.ico]);
$('#prev').onclick=()=>step(-1);$('#next').onclick=()=>step(1);const atToday=()=>view==='year'||view==='bday'?yrCustom:view==='month'&&cur.getFullYear()===new Date().getFullYear()&&cur.getMonth()===new Date().getMonth();   // la période affichée contient déjà aujourd'hui
$('#today').onclick=()=>atToday()?toNow():fadeSwap(async()=>{toTop();cur=new Date();if(view==='year'||view==='bday')yrCustom=true;await load(true)}).then(toNow);
// bouton flottant : "+ Évènement", ou "Fermer" dans les paramètres (retour à la vue précédente)
$('#new').onclick=()=>{if(view==='settings')fadeSwap(async()=>{view=prevView;await load(true)});else if(view==='bday')openBday(null,new Date());else openEv(null,new Date())};   // vue Anniversaires : + = nouvel anniversaire
document.querySelectorAll('.tab').forEach(b=>b.onclick=()=>{if(b.dataset.v===view&&(view!=='year'&&view!=='bday'||yrCustom))return toTop();   // déjà sur cette vue : pas de rechargement
  if(b.dataset.v==='settings'&&view!=='settings'){prevView=view;if(devBox)devList(devBox);if(lkBox)lockList(lkBox)}if(b.dataset.v==='year'||b.dataset.v==='bday')yrCustom=true;
  fadeSwap(async()=>{if(b.dataset.v==='month'&&view!=='month')cur=mCur||new Date();view=b.dataset.v;await load(true)}).then(toNow)});   // Mois : dernier mois affiché (ou aujourd'hui si la vue Mois n'a pas encore été ouverte)
// menu : bouton ☰, bouton ‹, clic hors du menu (voile sur mobile)
const relayout=()=>requestAnimationFrame(()=>{wide();fitTitle();fitHeads();fitBigs()});   // le volet latéral change la largeur de la zone principale
$('#side').addEventListener('transitionend',e=>{if(e.target===$('#side')&&e.propertyName==='margin-left')relayout()});   // volet animé : recalcul à la fin
RM?.addEventListener?.('change',()=>{theme();animSync()});   // « réduire les animations » changé dans le système
const sideSave=()=>{if(innerWidth<700)return;const c=document.body.classList.contains('closed');if(!!S.sideClosed!==c){S.sideClosed=c;saveS()}};   // position du volet mémorisée (écrans larges seulement)
$('#burger').onclick=()=>{document.body.classList.toggle('closed');sideSave();relayout()};$('#veil').onclick=()=>{document.body.classList.add('closed');relayout()};
let wasMob=innerWidth<700;   // « Jamais (sauf sur mobile) » : réaffichage quand on franchit 700 px
addEventListener('resize',()=>{if((devicePixelRatio||1)!==dprSeen)theme();   // mise à l'échelle / zoom changés : épaisseurs recalculées
  wide();fitTitle();fitHeads();fitBigs();tabSize();const m=innerWidth<700;if(m!==wasMob){wasMob=m;if(view==='month'&&get('abbr')==='mobile')render()}});
// sections repliables + options des tâches
document.querySelectorAll('.fold').forEach(h=>h.onclick=e=>{if(e.target.closest('#tgear'))return;const k=h.dataset.sec,a=S.collapsed||[],c=!a.includes(k);S.collapsed=c?[...a,k]:a.filter(x=>x!==k);saveS();h.classList.toggle('shut',c);foldTo(h.nextElementSibling,!c)});
// menu-bulle des options des tâches : l'engrenage tourne quand il s'ouvre / se ferme
// Raccourcis C / L / O : replie ou déplie Calendriers / Tâches / Outils ; volet fermé : il s'ouvre et le menu est déplié
function foldSec(k){const h=document.querySelector(`.fold[data-sec="${k}"]`);if(!h||h.closest('.cat').hidden)return;
  const closed=document.body.classList.contains('closed'),shut=(S.collapsed||[]).includes(k);
  if(closed){document.body.classList.remove('closed');sideSave();relayout()}if(!closed||shut)h.click()}
const tpop=show=>{float($('#tpop'),show);$('#tgear').classList.toggle('open',show)};
$('#tgear').onclick=e=>{const p=$('#tpop'),r=e.currentTarget.getBoundingClientRect();tpop(!shown(p));p.style.left=Math.min(r.right+8,innerWidth-250)+'px';p.style.top=Math.min(r.top,innerHeight-170)+'px'};
for(const[id,k]of[['p-done','showDone'],['p-ro','showRO'],['p-dated','dated'],['p-bylist','tasksByList']]){const c=$('#'+id);c.onchange=()=>{S[k]=c.checked;saveS();render()}}
// clic en dehors : ferme bulle, options des tâches et sélecteur de couleur ; pop-ups : clic sur le fond = fermer
document.addEventListener('click',e=>{if(!e.target.closest('#bub,.mc'))float($('#bub'),false);if(!e.target.closest('#tpop,#tgear')&&shown($('#tpop')))tpop(false);if(!e.target.closest('#qpop,#qgear')&&shown($('#qpop')))qpop(false);if(!e.target.closest('#cp,.swatch'))float($('#cp'),false)});
// Échap sur une pop-up : fermeture animée (au lieu de la fermeture immédiate du navigateur)
// Formulaires évènement / tâche : une saisie, un choix ou un clic sur un bouton du formulaire = modification ; Échap ou clic sur le fond demande alors confirmation
for(const d of[$('#dlg'),$('#dtk')]){const f=d.querySelector('form'),dirty=()=>{d._dirty=true};f.addEventListener('input',dirty);f.addEventListener('change',dirty);
  f.addEventListener('click',e=>{const b=e.target.closest('button');if(b&&!b.matches('#cancel,#del,#ok,#tk-cancel,#tk-del,#tk-ok'))dirty()})}
async function quit(d){if(!d._dirty)return d.close();if(d._asking)return;d._asking=true;const ok=await ask(T('quit.ask'),T('quit.btn'),true);d._asking=false;if(ok)d.close()}
document.querySelectorAll('dialog:not(#dlogin)').forEach(d=>d.addEventListener('cancel',e=>{if(d._dirty||animOn('pop')){e.preventDefault();quit(d)}}));
document.querySelectorAll('dialog:not(#dlogin)').forEach(d=>{let dn=false;d.addEventListener('mousedown',e=>{dn=e.target===d});d.addEventListener('click',e=>{if(dn&&e.target===d)quit(d)})}); // (ne jamais renvoyer false ici : cela bloquerait le focus des champs)

// Échap dans les Paramètres : ferme d'abord ce qui est ouvert (pop-up, sélecteur de couleur, options des tâches), sinon revient à la vue précédente
document.addEventListener('keydown',e=>{if(e.key!=='Escape'||view!=='settings'||document.querySelector('dialog[open]'))return;
  if(shown($('#cp'))){float($('#cp'),false);return}if(shown($('#tpop'))){tpop(false);return}fadeSwap(async()=>{view=prevView;await load(true)})});
/* Raccourcis utiles (touche ?) : une ligne par raccourci, la touche dans un carré (police des titres), sa fonction à droite */
// [titre du groupe, [[touches], fonction]] : textes keys.* (les lettres sont celles du clavier : elles ne se traduisent pas)
const KEYS=[['nav',[[['←','→'],'prevNext'],[['A'],'today'],[['M'],'month'],[['Y'],'year'],[['B'],'bday'],[['P'],'settings']]],
  ['side',[[['V'],'side'],[['C'],'foldCal'],[['L'],'foldTasks'],[['O'],'foldTools'],[['R','/'],'search']]],
  ['create',[[['N'],'newEv'],[['T'],'newTask']]],
  ['pop',[[[T('key.enter')],'enter'],[[T('key.del')],'del'],[[T('key.esc')],'esc']]],
  ['help',[[['?'],'help']]]];
function keysHelp(){const ok=mk('button','pri',T('btn.ok')),row=mk('div','row');ok.onclick=()=>$('#dkeys').close();row.append(ok);
  $('#dk').replaceChildren(mk('h3',null,T('keys.title')),...KEYS.flatMap(([t,l])=>{const g=mk('div','keys');
    for(const[ks,txt]of l){const r=mk('div','kr'),kk=mk('span','kks');for(const k of ks)kk.append(mk('kbd','kk'+(k.length>1?' w':''),k));r.append(kk,mk('span',null,T('keys.'+txt,{name:get('toolsName')||T('side.tools')})));g.append(r)}
    return[mk('h4',null,T('keys.g.'+t)),g]}),row);
  $('#dkeys').showModal();$('#dk').focus({preventScroll:true})}
// Raccourcis clavier (hors champs de saisie et pop-ups) : ? aide · ← → période précédente / suivante · A aujourd'hui · V volet latéral · N nouvel évènement (anniversaire dans la vue Anniversaires) · T nouvelle tâche · M / Y / B / P vues Mois, Année, Anniversaires, Paramètres
document.addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey||e.altKey||drag||document.querySelector('dialog[open]')||e.target.closest?.('input,textarea,select,[contenteditable]'))return;
  const k=e.key.length===1?e.key.toLowerCase():e.key,cal=view!=='settings',tab=v=>$(`.tab[data-v="${v}"]`).click();
  const f={ArrowLeft:()=>cal&&step(-1),ArrowRight:()=>cal&&step(1),a:()=>cal&&$('#today').click(),v:()=>$('#burger').click(),n:()=>view==='bday'?openBday(null,new Date()):openEv(null,new Date()),t:()=>openTask(null),m:()=>tab('month'),y:()=>tab('year'),b:()=>bdCal()&&tab('bday'),p:()=>tab('settings'),'?':()=>keysHelp(),c:()=>foldSec('cal'),l:()=>foldSec('tasks'),o:()=>foldSec('tools'),r:()=>srFocus(),'/':()=>srFocus()}[k];
  if(!f||(e.repeat&&k.length===1))return;e.preventDefault();float($('#bub'),false);f()});
// Mobile : glisser horizontalement sur la vue Mois = mois suivant (vers la gauche) / précédent (vers la droite), sans animation
for(const vm of[$('#v-month'),$('#v-year'),$('#v-bday')]){let tx=0,ty=0;   // vues Mois et Année
  vm.addEventListener('touchstart',e=>{tx=e.touches[0].clientX;ty=e.touches[0].clientY},{passive:true});
  vm.addEventListener('touchend',e=>{if(drag||Date.now()-dragEnd<400)return;const t=e.changedTouches[0],dx=t.clientX-tx,dy=t.clientY-ty;if(Math.abs(dx)>70&&Math.abs(dx)>1.5*Math.abs(dy)){float($('#bub'),false);if(['month','year'].includes(view))step(dx<0?1:-1,true)}},{passive:true})}

// Nextcloud injoignable : Réessayer (recharge la page) ou mode hors-ligne (dernière sauvegarde, tout en lecture seule). true = on continue hors-ligne
async function offline(e){let m=null;try{m=await api('offline?meta=1')}catch{}
  const r=await popup(T('offline.startErr',{e:e.message,last:m?T('offline.last',{when:offWhen(new Date(m.date))}):T('offline.none')}),
    [...(m?[[T('offline.enter'),'','off']]:[]),[T('btn.retry'),'pri','retry']]);
  if(r==='retry'){location.reload();return false}if(r!=='off')return false;
  let o;try{o=await api('offline')}catch(x){say(T('offline.unreadable',{e:x.message}));return false}
  offEnter(o,false);return true}   // ensuite : nouvel essai automatique toutes les minutes (retour aux données réelles dès que Nextcloud répond)
// Outils (bas du volet) : liens vers Nextcloud. Agenda intégré dans une iframe (ex. Nextcloud) : le lien remplace la page entière ;
// sinon : nouvel onglet
// Outils (bas du volet) : nom réglable (« toolsName »), liens Nextcloud cochés (Paramètres > Liens externes) puis liens personnalisés (« links »).
// Nouvel onglet, sauf dans une iframe (ex. Nextcloud) : liens Nextcloud et liens du même domaine que Nextcloud remplacent la page entière (_top). Catégorie masquée si aucun lien.
let NC='';
const linkOk=u=>{try{const x=new URL(String(u).trim());return/^https?:$/.test(x.protocol)}catch{return false}};
const sameNc=u=>{try{return!!NC&&new URL(u).hostname===new URL(NC).hostname}catch{return false}};
function tools(){const l=[...(NC?[['toolsCal','calendar'],['toolsDeck','deck'],['toolsTasks','tasks']].filter(([k])=>get(k)).map(([k,app])=>[T('tools.'+app),NC+'/apps/'+app+'/',true]):[]),
    ...(S.links||[]).filter(x=>x?.t&&linkOk(x.u)).map(x=>[x.t,x.u.trim(),sameNc(x.u)])];
  $('#tools').replaceChildren(...l.map(([t,u,nc])=>{const a=mk('a','cal');a.href=u;if(FRAMED&&nc)a.target='_top';else{a.target='_blank';a.rel='noopener'}a.innerHTML=ICO.ext;a.append(mk('span',null,t));return a}));
  $('#toolsc .fold span').textContent=get('toolsName')||T('side.tools');$('#toolsc').hidden=!l.length}
// Langue : enregistrée tout de suite (pas d'attente), puis page rechargée si elle change (les textes sont posés dans la page par le serveur)
async function langSave(c){if(!c)return;S.lang=c;clearTimeout(tmr);try{await api('settings',{method:'PUT',body:JSON.stringify(S)})}catch{return say(T('settings.saveErr'))}if(c!==TXT['@lang'])location.reload()}
// Première ouverture : petite fenêtre « Langue » (liste des langues disponibles, langue du navigateur présélectionnée) ; Échap = langue proposée
function langFirst(){const d=$('#dmsg'),sel=mk('select'),row=mk('div','row'),o=mk('button','pri',T('btn.ok'));for(const l of LANGS){const x=mk('option',null,l.name);x.value=l.code;sel.append(x)}sel.value=TXT['@lang'];sel.className='pin';
  let done=false;const fin=()=>{if(done)return;done=true;d.close();langSave(sel.value)};o.onclick=fin;d.onclose=fin;d.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();fin()}};row.append(o);
  $('#dm').replaceChildren(mk('p','mtext',T('lang.firstText')),sel,row);d.showModal();setTimeout(()=>sel.focus(),60)}
(async()=>{if(innerWidth<700)document.body.classList.add('closed');
  let st=null;try{st=await api('session')}catch{}if(st&&!st.auth)return loginPage(st);AUTHED=!!st;NC=st?.nc||'';   // pas connecté : page de connexion, rien d'autre n'est chargé
  try{S=await api('settings')}catch{}if(get('startView')==='year'||get('startView')==='bday'){view=get('startView');yrCustom=true}   // vue préférée
  if(S.sideClosed)document.body.classList.add('closed');   // volet replié la dernière fois (sur téléphone : toujours replié au départ)
  let fonts=[],ext={};try{fonts=await api('fonts')}catch{}try{ext=await api('ext')}catch{}
  $('#p-done').checked=S.showDone!==false;$('#p-ro').checked=S.showRO!==false;$('#p-dated').checked=!!S.dated;$('#p-bylist').checked=!!S.tasksByList;
  theme();tools();BS=[fonts,ext];try{buildSettings(...BS)}catch(e){console.error('[jolical] panneau Paramètres',e)}
  try{cals=await api('calendars')}catch(e){if(!await offline(e))return ldDone()}   // erreur : la pop-up s'affiche par-dessus l'écran de chargement
  try{buildSettings(...BS)}catch(e){console.error('[jolical] panneau Paramètres',e)}   // à nouveau : la liste « Liste de tâches par défaut » a besoin des calendriers
  if(view==='bday'&&!bdCal())view='month';   // vue préférée Anniversaires sans calendrier choisi
  cals.forEach(calVis);HOLCAL.on=!(S.hidden||[]).includes(HOLCAL.href);await loadExt();await loadXc();await loadDayCols();loadTasks();await load();toNow();ldDone();setTimeout(()=>document.body.classList.add('ready'),400);   // ready : animations du volet seulement après le premier affichage
  if(!TXT['@langSet']&&LANGS.length>1)langFirst();   // première ouverture : choix de la langue
  READY=true;setInterval(refresh,12e4);setInterval(()=>{if(OFF&&!document.hidden)ncRetry()},6e4);   // actualisation toutes les 2 min ; hors-ligne : nouvel essai toutes les minutes
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&Date.now()-lastLoad>15e3)refresh()})})();
