/* Reveal a newly selected lesson on narrow screens.
 * Called only after an explicit navigation action; never on ordinary typing.
 */
(function(root){'use strict';
 function reveal(id='content'){
  const element=root.document.getElementById(id);
  if(!element)return false;
  element.setAttribute('tabindex','-1');
  element.focus({preventScroll:true});
  element.scrollIntoView({behavior:'instant',block:'start'});
  return true;
 }
 root.CourseMobileFocus=Object.freeze({reveal});
})(typeof window!=='undefined'?window:globalThis);
