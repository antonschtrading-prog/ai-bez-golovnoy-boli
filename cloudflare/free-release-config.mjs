/* Render a release configuration for the EXISTING Worker, without any secrets.
 * AI is bound but deliberately disabled until real calibration proves it safe.
 * No Cloudflare calls. Never create or rename a Worker or D1.
 */
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE_NAMESPACE=/^[1-9][0-9]{0,8}$/;
export function renderFreeReleaseConfig(template,{databaseId,rateNamespace='81427'}={}){
 if(typeof template!=='string'||typeof databaseId!=='string'||!ID.test(databaseId)||
    typeof rateNamespace!=='string'||!RATE_NAMESPACE.test(rateNamespace))throw Error('invalid_release_configuration');
 const placeholder='database_id = "REPLACE_WITH_REAL_D1_DATABASE_ID"';
 if(template.split(placeholder).length!==2)throw Error('unexpected_d1_template');
 if(!template.includes('name = "ai-course-progress"')||
    !template.includes('main = "cloudflare/worker.mjs"')||
    !template.includes('binding = "DB"')||
    !template.includes('database_name = "ai-course-progress"')||
    !template.includes('COURSE_ORIGINS = "https://antonschtrading-prog.github.io"'))throw Error('release_must_use_existing_resources');
 const rendered=template.replace(placeholder,'database_id = "'+databaseId+'"');
 const aiConfig=`
# Prepared binding is inert. No review is possible without separate calibration.
[ai]
binding = "AI"

[[ratelimits]]
name = "AI_REVIEW_LIMITER"
namespace_id = "${rateNamespace}"
[ratelimits.simple]
limit = 2
period = 60
`;
 // The defaults in worker.mjs remain fail-closed; make this explicit for release.
 return rendered.replace('COURSE_ORIGINS = "https://antonschtrading-prog.github.io"',
  'COURSE_ORIGINS = "https://antonschtrading-prog.github.io"\\nAI_REVIEW_ENABLED = "false"\\nAI_REVIEW_CALIBRATED = "false"\\nAI_REVIEW_FREE_PLAN_CONFIRMED = "false"\\nAI_REVIEW_MODEL = "@cf/meta/llama-3.1-8b-instruct-fp8-fast"')
  + '\\n'+aiConfig;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const databaseId=process.env.CLOUDFLARE_D1_DATABASE_ID||'';
 const rateNamespace=process.env.AI_REVIEW_RATE_NAMESPACE||'81427';
 const template=readFileSync('cloudflare/wrangler.example.toml','utf8');
 writeFileSync('wrangler.toml',renderFreeReleaseConfig(template,{databaseId,rateNamespace}),{flag:'wx',mode:0o600});
 console.log('Prepared existing ai-course-progress Worker config. AI review remains DISABLED.');
}
