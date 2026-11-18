const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const code=fs.readFileSync(path.join(__dirname,'../assessment-evidence.js'),'utf8');
const ctx={};vm.runInNewContext(code,ctx);
const evaluate=ctx.CourseAssessmentEvidence.evaluate;
const base={questions:[{correct:1},{correct:0}],answers:{0:1,1:0},criteria:['Обозначена цель','Проверены факты'],rubric:[0,1],evidence:{0:'Обоснование A',1:'Обоснование B'},work:'Есть содержательное решение'};
test('knowledge and practice are separate statuses; self-reported practice is never independently certified',()=>{
 const result=evaluate(base);
 assert.equal(result.knowledge,'verified');assert.equal(result.practice,'self-reviewed');
 assert(result.actions.some(x=>/независимая проверка/.test(x)));
});
test('a one-word answer and a long answer have identical evidence status when supplied criteria match',()=>{
 const one=evaluate({...base,work:'Цель'});
 const long=evaluate({...base,work:'Цель '+ 'много '.repeat(400)});
 assert.equal(one.practice,long.practice);assert.equal(one.knowledge,long.knowledge);
});
test('a checked criterion without explanation remains missing evidence, not a passing score',()=>{
 const r=evaluate({...base,evidence:{0:'',1:'Пример'}});
 assert.equal(r.practice,'in-progress');assert.equal(r.details[0].status,'missing-evidence');
 assert(r.actions.some(x=>x.includes('Обозначена цель')));
});
test('no checkboxes and a wrong quiz answer remain visible as distinct limitations',()=>{
 const r=evaluate({...base,answers:{0:0},rubric:[],work:''});
 assert.equal(r.knowledge,'incomplete');assert.equal(r.practice,'not-started');
 assert(r.actions.some(x=>/вопросы/.test(x)));
});
test('answered but incorrect question requires review even with a self-reviewed practice',()=>{
 const r=evaluate({...base,answers:{0:0,1:0}});
 assert.equal(r.knowledge,'review');assert.equal(r.practice,'self-reviewed');
});
test('empty practice never becomes complete solely through checked checkboxes',()=>{
 const r=evaluate({...base,work:''});
 assert.equal(r.practice,'not-started');
});
