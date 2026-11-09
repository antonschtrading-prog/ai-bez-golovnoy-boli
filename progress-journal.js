/* Журнал локальных контрольных точек.
 * Не содержит тексты занятий, ответы, имена, конфиденциальные материалы.
 * Не используется как источник истины при восстановлении — прогресс хранится в прежних разделах.
 */
(function(root){'use strict';
const KEY='ai-course-journal-v1';
const KNOWN=new Set(['ai-no-headache-v1','ai-course-assessment-v1','ai-course-deep-workshop-v1','ai-course-study-lab-v1','ai-course-review-v1','ai-course-platform-choice-v1','ai-course-compare-v1']);
const WINDOW_MS=15000,MAX_EVENTS=250;
const obj=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const safeId=id=>typeof id==='string'&&id.length<=90&&/^[a-zA-Z0-9_.:+-]*$/.test(id);
function read(storage){
 try{
 const raw=storage.getItem(KEY);if(raw===null)return{format:KEY,revision:0,events:[]};
 const o=JSON.parse(raw);
 if(!obj(o)||o.format!==KEY||!Number.isSafeInteger(o.revision)||o.revision<0||!Array.isArray(o.events)||o.events.length>MAX_EVENTS)return{format:KEY,revision:0,events:[],warning:'Журнал повреждён. Старый сохранён без изменений'};
 for(const e of o.events)if(!obj(e)||!KNOWN.has(e.section)||typeof e.at!=='string'||!Number.isSafeInteger(e.count)||e.count<1||!safeId(e.context)||!Number.isSafeInteger(e.revision))return{format:KEY,revision:0,events:[],warning:'Некорректная запись журнала'};
 return o;
 }catch(e){return{format:KEY,revision:0,events:[],warning:'Журнал не читается'}}
}
function checkpoint(storage,section,context='',clock=Date.now()){
 if(!KNOWN.has(section)||!safeId(context)||!Number.isFinite(clock))return{ok:false,reason:'Недопустимое событие'};
 const state=read(storage);
 if(state.warning)return{ok:false,reason:state.warning};
 const last=state.events[state.events.length-1];
 // При быстрой печати обновляется одна контрольная точка, не создаётся запись на каждый символ.
 if(last&&last.section===section&&last.context===context&&clock-Date.parse(last.at)>=0&&clock-Date.parse(last.at)<WINDOW_MS){
  last.at=new Date(clock).toISOString();last.count++;last.revision=++state.revision;
 }else{
  state.events.push({section,context,at:new Date(clock).toISOString(),count:1,revision:++state.revision});
 }
 if(state.events.length>MAX_EVENTS)state.events=state.events.slice(-MAX_EVENTS);
 try{storage.setItem(KEY,JSON.stringify(state));return{ok:true,revision:state.revision}}
 catch(e){return{ok:false,reason:'Журнал недоступен; основное сохранение не отменяется'}}
}
root.CourseJournal=Object.freeze({KEY,read,checkpoint,MAX_EVENTS});
})(typeof window!=='undefined'?window:globalThis);
