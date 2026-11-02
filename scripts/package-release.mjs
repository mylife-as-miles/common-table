import {existsSync,mkdirSync} from 'node:fs';
import {dirname,isAbsolute,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';

// Keep the root Drizzle journal/SQL in addition to the framework's emitted
// metadata: hosted migration discovery reads the root schema directory.
const [archive,...extra]=process.argv.slice(2);
if(!archive||extra.length||!isAbsolute(archive))throw new Error('Provide one absolute release archive path.');
const root=process.cwd();
for(const file of ['.openai/hosting.json','dist/.openai/hosting.json','dist/server/index.js','dist/client','drizzle/meta/_journal.json']){
  if(!existsSync(resolve(root,file)))throw new Error(`Build output is missing: ${file}`);
}
const git=spawnSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'});
if(git.status!==0||git.stdout.trim())throw new Error('Commit the release source before packaging.');
mkdirSync(dirname(archive),{recursive:true});
const packed=spawnSync('tar',["--transform=s,^dist/.openai,.openai,",'-cf',archive,'dist/.openai','dist/client','dist/server','drizzle'],{cwd:root,stdio:'inherit'});
if(packed.status!==0)process.exit(packed.status??1);
const head=spawnSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'});
if(head.status!==0)throw new Error('Cannot identify release source.');
console.log(JSON.stringify({commit_sha:head.stdout.trim(),archive}));
