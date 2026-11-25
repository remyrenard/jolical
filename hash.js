// Génère l'empreinte du mot de passe de Jolical (à copier dans config.secret).
// Usage : docker compose run --rm jolical node hash.js
// Le mot de passe est demandé deux fois, sans s'afficher. Rien n'est enregistré : la ligne affichée est à copier soi-même.
const crypto=require('crypto');
const N=16384,R=8,P=1,LEN=32;   // coût de scrypt : environ 0,1 s et 16 Mo par essai (mêmes valeurs que celles lues par server.js)

// 1. Lecture masquée : en terminal, chaque caractère est remplacé par « • » ; sans terminal (tube), lecture ligne par ligne
const lines=[];let wait=null;
if(!process.stdin.isTTY){let buf='';process.stdin.setEncoding('utf8');
  process.stdin.on('data',d=>{buf+=d;let i;while((i=buf.indexOf('\n'))>=0){lines.push(buf.slice(0,i).replace(/\r$/,''));buf=buf.slice(i+1);if(wait){const w=wait;wait=null;w(lines.shift())}}});
  process.stdin.on('end',()=>{if(buf)lines.push(buf);if(wait){const w=wait;wait=null;w(lines.shift()??'')}})}
function ask(q){process.stdout.write(q);
  if(!process.stdin.isTTY)return new Promise(ok=>{if(lines.length)ok(lines.shift());else wait=ok});
  return new Promise(ok=>{let s='';process.stdin.setRawMode(true);process.stdin.resume();process.stdin.setEncoding('utf8');
    const on=d=>{for(const c of d){
      if(c==='\r'||c==='\n'){process.stdin.setRawMode(false);process.stdin.pause();process.stdin.off('data',on);process.stdout.write('\n');return ok(s)}
      if(c==='\u0003'){process.stdout.write('\nAnnulé.\n');process.exit(130)}                    // Ctrl+C
      if(c==='\u007f'||c==='\b'){if(s){s=[...s].slice(0,-1).join('');process.stdout.write('\b \b')}continue}   // effacement
      if(c>=' '){s+=c;process.stdout.write('•')}}};
    process.stdin.on('data',on)})}

// 2. Saisie, vérification, calcul
(async()=>{
  const a=await ask('Nouveau mot de passe : ');
  if([...a].length<8){console.error('Trop court : 8 caractères minimum (une phrase de 4 ou 5 mots est idéale).');process.exit(1)}
  const b=await ask('Confirmer le mot de passe : ');
  if(a!==b){console.error('Les deux saisies sont différentes : rien n\'a été généré.');process.exit(1)}
  const salt=crypto.randomBytes(16),key=crypto.scryptSync(a.normalize('NFC'),salt,LEN,{N,r:R,p:P,maxmem:256*N*R});
  console.log('\nLigne à copier dans config.secret (remplace l\'ancienne ligne APP_PASSWORD_HASH) :\n');
  console.log(`APP_PASSWORD_HASH=scrypt:${N}:${R}:${P}:${salt.toString('base64url')}:${key.toString('base64url')}`);
  console.log('\nPuis : docker compose up -d --force-recreate   (tous les appareils devront se reconnecter)');
  process.exit(0)})();
