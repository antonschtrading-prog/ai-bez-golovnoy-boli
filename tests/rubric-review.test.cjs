const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../rubric-review.js'),'utf8');
const ctx={};vm.runInNewContext(source,ctx);
const api=ctx.CourseRubricReview;
const work='Цель — повысить качество заявок. Данные о конверсии не подтверждены. План: измерить обращения и сравнить результаты.';
const criteria=['Цель сформулирована','Допущения отражены','Проверка предусмотрена'];
function payload(){return {schema:'course-rubric-review-v1',items:[
 {index:0,rating:'met',quote:'Цель — повысить качество заявок',reason:'Есть цель, но нет измерителя.',nextStep:'Укажи метрику.'},
 {index:1,rating:'partial',quote:'Данные о конверсии не подтверждены',reason:'Отмечен пробел.',nextStep:'Перечисли источники.'},
 {index:2,rating:'not-demonstrated',quote:'',reason:'Внешняя проверка отсутствует.',nextStep:'Сверь результаты с данными.'}
]}}
const params={work,criteria};
test('a valid reviewer response is imported with exact quote references and ordered rubric',()=>{
 const parsed=api.parse(JSON.stringify(payload()),params);
 assert.equal(parsed.items[0].rating,'met');assert.equal(parsed.items[2].rating,'not-demonstrated');
 assert.equal(api.isCurrent(parsed,work,criteria),true);
 assert.equal(api.isCurrent(parsed,work+' изменено',criteria),false);
 assert.equal(api.isCurrent(parsed,work,['другой критерий']),false);
 const counts=api.counts(parsed);assert.equal(counts.met,1);assert.equal(counts.partial,1);
});
test('a plausible but fabricated quote cannot support an external grade',()=>{
 const x=payload();x.items[0].quote='Ученику гарантирован результат';
 assert.throws(()=>api.parse(JSON.stringify(x),params),/Цитата/);
});
test('the reviewer cannot add criteria, skip criteria, or repeat an index',()=>{
 const x=payload();x.items.push({...x.items[0],index:4});
 assert.throws(()=>api.parse(JSON.stringify(x),params),/формат|количество/);
 const y=payload();y.items[1].index=0;
 assert.throws(()=>api.parse(JSON.stringify(y),params),/повторяется/);
});
test('invalid rating, markdown fences, unbounded fields and forged keys are rejected',()=>{
 const x=payload();x.items[0].rating='perfect';assert.throws(()=>api.parse(JSON.stringify(x),params));
 assert.throws(()=>api.parse('\\`\\`\\`json\\n'+JSON.stringify(payload())+'\\n\\`\\`\\`',params),/JSON/);
 const y=payload();y.items[0].reason='x'.repeat(2000);assert.throws(()=>api.parse(JSON.stringify(y),params));
 const z=payload();z.items[0].admin=true;assert.throws(()=>api.parse(JSON.stringify(z),params));
});
test('no quote may be used for a criterion marked not demonstrated',()=>{
 const x=payload();x.items[2].quote='План: измерить обращения';
 assert.throws(()=>api.parse(JSON.stringify(x),params),/невыполненный/);
});
test('untrusted text is not used to certify a student or run network requests',()=>{
 const p=api.prompt({level:'A1',title:'Практика',task:'Задание',work,criteria});
 assert.match(p,/ТОЧНУЮ подстроку/);
 assert.match(p,/не аттестация/i);
 assert.match(p,/course-rubric-review-v1/);
});
