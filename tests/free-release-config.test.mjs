import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {strict as assert} from 'node:assert';
import {renderFreeReleaseConfig} from '../cloudflare/free-release-config.mjs';
const template=readFileSync('cloudflare/wrangler.example.toml','utf8');
const databaseId='f0b048d0-ffeb-4542-9b43-5e32e4fa6e24';

test('release config targets the existing Worker and D1, AI is inert',()=>{
 const config=renderFreeReleaseConfig(template,{databaseId});
 assert.match(config,/name = "ai-course-progress"/);
 assert.match(config,/database_name = "ai-course-progress"/);
 assert.match(config,/database_id = "f0b048d0-ffeb-4542-9b43-5e32e4fa6e24"/);
 assert.match(config,/AI_REVIEW_ENABLED = "false"/);
 assert.match(config,/AI_REVIEW_CALIBRATED = "false"/);
 assert.match(config,/AI_REVIEW_FREE_PLAN_CONFIRMED = "false"/);
 assert.match(config,/\[ai\]\nbinding = "AI"/);
 assert.match(config,/\[\[ratelimits\]\]/);
 assert.doesNotMatch(config,/^AI_REVIEW_ENABLED = "true"$/m);
 assert.doesNotMatch(config,/REPLACE_WITH_REAL_D1_DATABASE_ID/);
});
test('fail closed on malformed or unexpected IDs and templates',()=>{
 for(const id of ['', 'abc', 'a"\n[unsafe]', '00000000-0000-0000-0000-000000000000;']) {
  assert.throws(()=>renderFreeReleaseConfig(template,{databaseId:id}));
 }
 assert.throws(()=>renderFreeReleaseConfig(template.replace('name = "ai-course-progress"','name = "other"'),{databaseId}));
 assert.throws(()=>renderFreeReleaseConfig(template,{databaseId,rateNamespace:'0'}));
 assert.throws(()=>renderFreeReleaseConfig(template,{databaseId,rateNamespace:'123\n[vars]'}));
});
