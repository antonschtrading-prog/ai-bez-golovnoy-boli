/* Единая навигация для статического учебного сайта. Без внешних зависимостей. */
(()=>{'use strict';
const pages=[
 ['index.html','Основной курс'],['my-route.html','Учебный маршрут'],['adaptive-route.html','Что повторить'],
 ['study-lab.html','Термины и задания'],['deep-practice.html','Большой практикум'],
 ['assessment.html','Оценка A1–C1'],['review.html','Работа над ошибками'],
 ['any-ai.html','Любой ИИ'],['compare-ai.html','Сравнить ИИ']
];
const style=document.createElement('style');
style.textContent=`
.course-shortcuts{position:relative;z-index:30;margin:0 auto 15px;max-width:1100px;padding:0 16px}
.course-shortcuts details{background:#15253c;color:#eef5ff;border:1px solid #46617e;border-radius:12px;padding:10px 14px;font:15px/1.5 system-ui,sans-serif}
.course-shortcuts summary{cursor:pointer;font-weight:650;list-style-position:inside}
.course-shortcuts summary:focus-visible,.course-shortcuts a:focus-visible{outline:3px solid #eedaa2;outline-offset:3px}
.course-shortcuts nav{display:grid;grid-template-columns:repeat(auto-fit,minmax(165px,1fr));gap:8px;padding:13px 0 4px}
.course-shortcuts nav a{display:block;text-decoration:none;color:#e9f4ff;background:#253c58;border:1px solid #46617e;border-radius:9px;padding:9px 11px}
.course-shortcuts nav a[aria-current=page]{background:#acebc1;color:#102c1b;font-weight:750}
.course-shortcuts nav a:hover{border-color:#a9e7be}
@media(max-width:560px){.course-shortcuts{padding:0 12px;margin-top:10px}.course-shortcuts nav{grid-template-columns:1fr 1fr}.course-shortcuts nav a{font-size:13px;padding:10px}}
`;
document.head.append(style);
const current=location.pathname.split('/').pop()||'index.html';
const holder=document.createElement('div');holder.className='course-shortcuts';
const details=document.createElement('details');
const summary=document.createElement('summary');summary.textContent='Разделы курса · '+(pages.find(x=>x[0]===current)?.[1]||'Навигация');
const nav=document.createElement('nav');nav.setAttribute('aria-label','Навигация по курсу');
for(const [page,title] of pages){const a=document.createElement('a');a.href='./'+page;a.textContent=title;if(page===current)a.setAttribute('aria-current','page');nav.append(a)}
details.append(summary,nav);holder.append(details);
document.body.prepend(holder);
})();