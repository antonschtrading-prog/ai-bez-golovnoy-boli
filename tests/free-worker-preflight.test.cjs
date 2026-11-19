const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const flow=readFileSync('.github/workflows/free-worker-release.yml','utf8');

test('free-only Cloudflare release verifies remote Worker and D1 independently',()=>{
 assert.match(flow,/id: worker_inspect\s+continue-on-error: true\s+run: npx --yes wrangler@4 deployments list --name ai-course-progress/);
 assert.match(flow,/id: d1_inspect\s+continue-on-error: true\s+run: npx --yes wrangler@4 d1 migrations list ai-course-progress --remote/);
 assert.match(flow,/WORKER_RESULT: \$\{\{ steps.worker_inspect.outcome \}\}/);
 assert.match(flow,/D1_RESULT: \$\{\{ steps.d1_inspect.outcome \}\}/);
 assert.match(flow,/GITHUB_STEP_SUMMARY/);
});
test('a blocked remote preflight cannot trigger production deployment',()=>{
 assert.match(flow,/if: inputs.operation == 'deploy-disabled-ai' && steps.worker_inspect.outcome == 'success' && steps.d1_inspect.outcome == 'success'/);
 assert.match(flow,/if: steps.worker_inspect.outcome != 'success' \|\| steps.d1_inspect.outcome != 'success'/);
 assert.match(flow,/exit 1/);
 assert.match(flow,/run: npx --yes wrangler@4 deploy --dry-run/);
 assert.doesNotMatch(flow,/d1 migrations apply|AI_REVIEW_ENABLED = "true"/);
});
