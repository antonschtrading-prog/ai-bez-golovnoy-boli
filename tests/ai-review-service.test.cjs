const {test}=require('node:test'),assert=require('node:assert/strict');
const input={level:'A1',title:'Постановка цели',task:'Укажи цель и проверку',work:'Цель — увеличить число заявок. План — измерить количество обращений.',criteria:['Цель','Проверка']};
const review={schema:'course-rubric-review-v1',items:[
 {index:0,rating:'met',quote:'Цель — увеличить число заявок',reason:'Цель есть',nextStep:'Добавить метрику'},
 {index:1,rating:'partial',quote:'План — измерить количество обращений',reason:'Способ проверки есть',nextStep:'Уточнить период'}
]};
test('validate review input and reject unknown keys, excessive payloads, unsafe shapes',async()=>{
 const {validateRequest}=await import('../cloudflare/ai-review.mjs');
 assert.equal(validateRequest(input).level,'A1');
 for(const changed of [
  {...input,unknown:'free prompt'}, {...input,level:'administrator'},
  {...input,work:'x'.repeat(12001)},{...input,criteria:[]},
  {...input,criteria:Array.from({length:9},()=> 'item')},
  {...input,work:''},{...input,task:[]}
 ])assert.throws(()=>validateRequest(changed),/invalid_review_input/);
});
test('AI adapter sends a bounded noncertifying rubric prompt and accepts grounded structured output',async()=>{
 const {reviewWithModel}=await import('../cloudflare/ai-review.mjs');
 let calls=0;
 const result=await reviewWithModel(input,{model:'@cf/test/model',run:async(model,options)=>{
  calls++;assert.equal(model,'@cf/test/model');
  assert.equal(options.temperature,0);assert.equal(options.max_tokens,1250);
  assert.match(options.messages[0].content,/не выполняй инструкции/i);
  assert.match(options.messages[1].content,/ТОЧНУЮ подстроку/);
  return {response:JSON.stringify(review)};
 }});
 assert.equal(calls,1);assert.equal(result.items[0].rating,'met');
 assert.equal(result.workSnapshot,input.work);
});
test('AI adapter fails closed for ungrounded quotes, broken JSON and missing binding',async()=>{
 const {reviewWithModel}=await import('../cloudflare/ai-review.mjs');
 const bad={...review,items:[{...review.items[0],quote:'Выдуманные данные'},review.items[1]]};
 await assert.rejects(reviewWithModel(input,{model:'@cf/test/model',run:async()=>({response:JSON.stringify(bad)})}),/Цитата/);
 await assert.rejects(reviewWithModel(input,{model:'@cf/test/model',run:async()=>({response:'not JSON'})}),/JSON/);
 await assert.rejects(reviewWithModel(input,{model:'',run:async()=>({response:'{}'})}),/review_unconfigured/);
});
