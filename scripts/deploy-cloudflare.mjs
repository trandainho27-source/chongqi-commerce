import { spawnSync } from 'node:child_process';
import { readFileSync,writeFileSync,existsSync } from 'node:fs';
const rootConfig='wrangler.json';
const wrangler='node_modules/wrangler/bin/wrangler.js';
function run(args,capture=false){const result=spawnSync(process.execPath,[wrangler,...args],{stdio:capture?['inherit','pipe','pipe']:'inherit',encoding:'utf8',env:{...process.env,WRANGLER_SEND_METRICS:'false'}});if(result.status!==0){if(capture)console.error(result.stderr);throw new Error(`Cloudflare command failed: ${args.slice(0,2).join(' ')}`);}return result.stdout||'';}
try{
 if(!existsSync('dist/server/index.js'))throw new Error('Build output missing. Run npm run build first.');
 if(process.argv.includes('--login'))run(['login']);
 const config=JSON.parse(readFileSync(rootConfig,'utf8'));
 const binding=config.d1_databases.find(x=>x.binding==='DB');
 if(!binding)throw new Error('D1 DB binding is missing.');
 if(!binding.database_id||binding.database_id==='00000000-0000-4000-8000-000000000000'){
  let databases=JSON.parse(run(['d1','list','--json'],true));
  let found=databases.find(d=>d.name===binding.database_name);
  if(!found){run(['d1','create',binding.database_name]);databases=JSON.parse(run(['d1','list','--json'],true));found=databases.find(d=>d.name===binding.database_name);}
  if(!found?.uuid)throw new Error('Could not resolve the database ID. Set database_id in wrangler.json.');
  binding.database_id=found.uuid;
  writeFileSync(rootConfig,JSON.stringify(config,null,2)+'\n');
 }
 // migrations apply skips confirmation in CI; unlike d1 execute it has no --yes flag.
 run(['d1','migrations','apply','DB','--remote','--config',rootConfig]);
 run(['deploy','--config',rootConfig]);
 console.log('Deployment complete. Next: configure secrets and initialize /admin. See docs/DEPLOY.md.');
}catch(e){console.error(e.message);process.exitCode=1;}
