// Independent canonical JSON hash verifier; uses only standard Node libraries.
// First unzip a package to an isolated directory, then pass its evidence.json.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
let checked=0,legacy=0;
for(const e of JSON.parse(readFileSync(process.argv[2],'utf8'))){
 if(e.hashScheme!=='canonical-json-sha256-v1'){legacy++;continue;}
 const digest=createHash('sha256').update(canonical(e.payload)).digest('hex');
 if(digest!==e.sha256)throw Error('Evidence payload hash mismatch: '+e.id);
 checked++;
}
console.log(`Verified ${checked} canonical evidence payloads; ${legacy} legacy payloads require original serialization/source inspection. Hashes are not signatures.`);
