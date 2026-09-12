import {REVIEW_PROTOCOL,reviewEventIssues} from './review-protocol.js';
import {createReviewSession,tickReview,changeReviewPhase,reviewAction,addReviewCoverage,reviewSummary,finishReview,validateStoredReview,updateReviewReport} from './review-session.js';
import {evaluateReview,reviewReportText,reviewErrorRateText} from './review-evaluation.js';
import {escapeHtml,formatTime} from './core.js';
import {validateTrialMetadata} from './review-trial.js';
import {mountReviewComparison} from './review-comparison-ui.js';
import {listReviewArchives} from './review-storage.js';
import {reviewPlaybackStep} from './review-playback.js';
import {reviewMediaIdentity} from './review-media.js';
import {reviewErrorEvidence} from './review-errors.js';
import {reviewCandidateProvenance} from './review-candidates.js';

export function mountReviewWorkbench(getContext){
  const launch=document.createElement('button');launch.className='button primary';launch.textContent='人工复核与计时';launch.type='button';
  document.querySelector('.header-actions').prepend(launch);
  const dialog=document.createElement('dialog');dialog.className='review-dialog';
  dialog.innerHTML=`<header><h2>人工复核工作台</h2><button data-close>保存并退出</button></header>
  <p>独立任务，不修改原标注。纯人工不载入机器候选。此处不显示参考答案。 <a href="./review-guide.html" target="_blank" rel="noopener">实验与计时说明</a></p>
  <div class="review-setup"><label>模式<select data-mode><option value="manual">纯人工</option><option value="assisted">工具辅助</option></select></label><label>开始秒<input data-start type="number" min="0" value="0"></label><label>结束秒<input data-end type="number" min="0"></label><button data-begin>开始新任务</button><button data-resume>恢复上次任务</button></div>
  <div class="review-setup"><button data-archive-list>刷新本录像归档</button><select data-archive aria-label="已归档的复核任务"></select><button data-archive-restore>恢复所选归档</button></div>
  <p data-trial-saved>未登记任务</p>
  <p data-candidate-status></p>
  <p data-save-status role="alert"></p><button data-legacy-export hidden>原样导出旧版任务（未核验内容）</button>
  <label>导入任务备份（当前录像）<input data-task-import type="file" accept=".json,application/json"></label>
  <details open><summary>新任务的对照实验登记（当前任务采用开始时的登记值）</summary><div class="review-setup">
  <label>匿名操作者编号<input data-operator maxlength="80" placeholder="例如 P01"></label>
  <label>对照组编号<input data-pair maxlength="80" placeholder="例如 pair01"></label>
  <label>本人的实验次序<input data-order type="number" min="1" value="1"></label>
  <label>看过该录像吗<select data-familiarity><option value="unknown">不确定</option><option value="unseen">从未看过</option><option value="seen">看过</option></select></label>
  <label>实际操作来源<select data-performer><option value="unknown">尚未声明</option><option value="human">真人操作</option><option value="automation">自动化测试</option></select></label>
  <label>辅助模式开始前的算法等待秒<input data-wait type="number" min="0" step="0.1" placeholder="空白表示未测，不能当0"></label>
  <label>统一交付标准<input data-standard maxlength="200" value="review-1：投篮动作/时间/结果/球队与球员（未知可留空）/完整补漏/报告"></label>
  </div><p>纯人工等待为0。辅助等待为人工登记，不与墙钟时间混加；两种模式须使用同一交付标准。真人声明不等于系统验证。</p></details>
  <div class="review-grid"><div><video data-video controls playsinline></video><p data-position></p><div class="review-toolbar"><button data-phase="review">1 候选审核</button><button data-phase="sweep">2 全段补漏</button><button data-phase="report">3 整理报告</button><button data-pause>暂停计时</button></div>
  <p data-clock>尚未开始</p><p data-coverage>播放覆盖不是注意力证明；跳转不算观看。</p>
  <fieldset><legend>当前事件</legend><label>动作时间（秒）<input data-time type="number" step="0.01"></label><button data-now>使用当前画面时间</button><label>标签<select data-label>${REVIEW_PROTOCOL.labels.map(l=>`<option value="${l.id}">${l.name}</option>`).join('')}</select></label><label>结果<select data-result><option value="unknown">未知／看不清</option><option value="made">命中</option><option value="missed">未中</option><option value="not-applicable">不适用</option></select></label><label>球队<input data-team maxlength="60"></label><label>球员<input data-player maxlength="60"></label><label>备注<input data-note maxlength="500"></label></fieldset>
  <div class="review-toolbar"><button data-confirm>C 确认</button><button data-edit>E 保存修改</button><button data-delete>D 删除</button><button data-add>M 补漏／新增</button><button data-undo>U 撤销</button><button data-prev>J 上一条</button><button data-next>K 下一条</button></div>
  <p role="status" data-status></p><div class="review-toolbar"><button data-finish>结束并锁定结果</button><button data-reference-template>下载参考答案格式</button><label>导入独立参考答案<input data-reference type="file" accept="application/json,.json" disabled></label><button data-report>导出复核报告</button><button data-export>导出任务与计时 JSON</button></div><pre data-evaluation>未核验正确率</pre></div><aside><h3>事件列表</h3><div data-list></div><details><summary>标签定义和复核清单</summary>${REVIEW_PROTOCOL.labels.map(l=>`<p><strong>${l.name}</strong>：${l.definition}</p>`).join('')}<ol>${REVIEW_PROTOCOL.checklist.map(s=>`<li>${s}</li>`).join('')}</ol><p>本版本记录录像动作，不自动生成官方技术统计。</p></details></aside></div>`;
  document.body.append(dialog);
  const errorPanel=document.createElement('section');
  errorPanel.innerHTML='<h3>核验差异回看（锁定后）</h3><p>按参考答案定位，不自动修改已锁定结果。参考也可能有错。</p><div data-error-list></div><button data-error-prev>上一页差异</button><span data-error-page></span><button data-error-next>下一页差异</button>';
  dialog.querySelector('[data-evaluation]').after(errorPanel);
  const reportForm=document.createElement('fieldset');
  reportForm.innerHTML='<legend>教练报告（填写时切换为报告计时）</legend><label>观察到的主要问题<textarea data-report-field="observation" maxlength="3000"></textarea></label><label>支持判断的录像时间与事件<textarea data-report-field="evidence" maxlength="3000"></textarea></label><label>建议训练动作<textarea data-report-field="training" maxlength="3000"></textarea></label><label>下一场核验指标<textarea data-report-field="followUp" maxlength="3000"></textarea></label>';
  dialog.querySelector('[data-status]').before(reportForm);
  const comparison=mountReviewComparison(dialog);
  const q=s=>dialog.querySelector(s),player=q('[data-video]');let session=null,selected=null,playback=null,context=null,evaluation=null,lockSha256=null,revision=0,errorPage=0;
  const digest=async data=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',data))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const download=(name,data,type='application/json')=>{const url=URL.createObjectURL(new Blob([data],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const now=()=>Date.now();
  let previousVisibility=!document.hidden;
  const key=()=>`courtvision-review-task:${context.videoIdentity}`;
  const message=s=>{q('[data-status]').textContent=s;};
  function persist(){
    if(!session)return true;
    if(session.status==='finished'&&!lockSha256){q('[data-save-status]').textContent='正在生成锁定摘要；此时请勿刷新页面。';return false;}
    try{localStorage.setItem(key(),JSON.stringify({session,evaluation,lockSha256}));q('[data-save-status]').textContent='当前任务已保存到本浏览器；仍建议导出备份。';return true;}
    catch{q('[data-save-status]').textContent='⚠ 本地保存失败！当前修改仅在内存，请立即导出任务，勿关闭或刷新。';return false;}
  }
  function tick(visible=!document.hidden&&dialog.open){if(!session)return;session=tickReview(session,Math.max(now(),session.lastTick),{visible});}
  function stats(){if(!session)return;const s=reviewSummary(session);q('[data-clock]').textContent=`${session.paused?'已暂停':'计时中'} · ${session.phase} · 审核 ${(s.timingMs.review/1000).toFixed(1)}秒 / 补漏 ${(s.timingMs.sweep/1000).toFixed(1)}秒 / 报告 ${(s.timingMs.report/1000).toFixed(1)}秒`;q('[data-coverage]').textContent=`全段补漏播放覆盖 ${(s.coverageFraction*100).toFixed(1)}% · 待确认 ${s.pending} · 人工新增 ${s.manualAdditions}；覆盖不是注意力证明。`;q('[data-pause]').textContent=session.paused?'继续计时':'暂停计时';}
  function render(){
    stats();
    q('[data-candidate-status]').textContent=session?.mode==='assisted'?`候选来源：${session.candidateProvenance?.kind??'未记录'}。${session.candidateProvenance?.warning??''}`:'';
    q('[data-trial-saved]').textContent=session?.trial?`当前任务登记：${session.trial.operator} / ${session.trial.pairId} / 次序${session.trial.order} / 熟悉度${session.trial.familiarity} / ${session.trial.performer}；标准：${session.trial.deliveryStandard}`:'当前没有已登记任务；下方字段只用于开始新任务。';
    const active=session?.status==='active';
    for(const input of dialog.querySelectorAll('[data-report-field]')){input.disabled=!active||session.paused;if(document.activeElement!==input)input.value=session?.report?.[input.dataset.reportField]??'';}
    for(const name of ['confirm','edit','delete','add','undo','pause','finish'])q(`[data-${name}]`).disabled=!active;
    for(const name of ['confirm','edit','delete','add','undo'])q(`[data-${name}]`).disabled=!active||session.paused;
    for(const b of dialog.querySelectorAll('[data-phase]'))b.disabled=!active||(session.mode==='manual'&&b.dataset.phase==='review');
    q('[data-reference]').disabled=session?.status!=='finished'||!lockSha256;
    if(!session){q('[data-clock]').textContent='尚未开始';q('[data-coverage]').textContent='播放覆盖不是注意力证明；跳转不算观看。';}
    else if(!active)q('[data-clock]').textContent='结果已锁定 · '+q('[data-clock]').textContent;
    q('[data-evaluation]').textContent=evaluation?`匹配 ${evaluation.truePositives} / 参考 ${evaluation.referenceEvents}\n未匹配标记 ${evaluation.falsePositiveCount}；漏标 ${evaluation.falseNegativeCount}\n精确率 ${evaluation.precision==null?'—':(evaluation.precision*100).toFixed(1)+'%'}；召回率 ${evaluation.recall==null?'—':(evaluation.recall*100).toFixed(1)+'%'}\n${evaluation.warnings.join('\n')}\n参考独立性由导入者声明。`:'未核验正确率';
    q('[data-list]').innerHTML=session?[...session.events].sort((a,b)=>a.time-b.time).map(e=>`<button class="review-event ${e.id===selected?'selected':''}" data-event="${escapeHtml(e.id)}">${formatTime(e.time)} · ${escapeHtml(REVIEW_PROTOCOL.labels.find(l=>l.id===e.label)?.name)} · ${escapeHtml({pending:'待确认',confirmed:'已确认',deleted:'已删除'}[e.status])}${e.origin==='manual'?' · 人工新增':''}</button>`).join(''):'';
    if(evaluation)q('[data-evaluation]').textContent+='\n'+reviewErrorRateText(evaluation);
    renderErrors();
  }
  function renderErrors(){
    const rows=reviewErrorEvidence(evaluation),pages=Math.max(1,Math.ceil(rows.length/50));errorPage=Math.min(errorPage,pages-1);
    q('[data-error-list]').innerHTML=rows.slice(errorPage*50,errorPage*50+50).map(row=>`<button type="button" data-error-time="${row.time}">${escapeHtml(row.title)} · ${formatTime(row.time)} · ${escapeHtml(row.label)}</button>`).join('');
    q('[data-error-page]').textContent=rows.length?` ${errorPage+1}/${pages}页 · 共${rows.length}项 `:' 尚无核验差异 ';
    q('[data-error-prev]').disabled=errorPage===0;q('[data-error-next]').disabled=errorPage>=pages-1;
  }
  function clearEventForm(){
    selected=null;errorPage=0;
    for(const field of ['time','team','player','note'])q(`[data-${field}]`).value='';
    q('[data-label]').value='shot';q('[data-result]').value='unknown';q('[data-reference]').value='';
  }
  q('[data-error-prev]').onclick=()=>{errorPage--;renderErrors();};q('[data-error-next]').onclick=()=>{errorPage++;renderErrors();};
  q('[data-error-list]').onclick=event=>{const button=event.target.closest('[data-error-time]');if(!button||!session||session.status!=='finished')return;const time=Number(button.dataset.errorTime);if(!Number.isFinite(time)||time<session.range.start||time>=session.range.end)return;player.pause();playback=null;player.currentTime=Math.max(session.range.start,time-2);message('已定位差异前2秒；回看不会改动锁定数据或计时。');};
  function select(id){const e=session?.events.find(e=>e.id===id);if(!e)return;selected=id;for(const f of ['time','label','result','team','player','note'])q(`[data-${f}]`).value=e[f]??'';player.currentTime=Math.max(session.range.start,e.time-2);playback=null;render();}
  function move(direction){const a=session?.events.filter(e=>e.status!=='deleted').sort((a,b)=>a.time-b.time)??[];if(!a.length)return;const i=a.findIndex(e=>e.id===selected);select(a[i<0?(direction<0?a.length-1:0):(i+direction+a.length)%a.length].id);}
  function mutate(action){try{
    if(!session)throw Error('请先开始任务');
    const target=action.type==='add'?action.event:action.type==='edit'?{...session.events.find(e=>e.id===action.id),...action.changes}:action.type==='confirm'?session.events.find(e=>e.id===action.id):null;
    if(target&&reviewEventIssues(target).length)throw Error(reviewEventIssues(target).join('；'));
    tick();session=reviewAction(session,action,session.lastTick);persist();render();message('已记录，可撤销。');
  }catch(e){message(e.message);}}
  const fields=()=>({time:q('[data-time]').value.trim()===''?NaN:Number(q('[data-time]').value),label:q('[data-label]').value,result:q('[data-result]').value,team:q('[data-team]').value.trim(),player:q('[data-player]').value.trim(),note:q('[data-note]').value.trim()});
  launch.onclick=async()=>{
    const request=++revision,snapshot=getContext(),started=performance.now();
    if(!snapshot.src||!Number.isFinite(snapshot.duration)||snapshot.duration<=0){alert('请先载入一段可播放录像。');return;}
    launch.disabled=true;snapshot.pause();
    try{
      const assertCurrent=()=>{if(request!==revision||getContext().src!==snapshot.src)throw Error('录像已切换，身份核验已取消');};
      const identity=await reviewMediaIdentity(snapshot,{assertCurrent,onProgress:(done,total)=>{launch.textContent=`录像指纹 ${(done/total*100).toFixed(0)}%`;}});
      assertCurrent();context={...snapshot,...identity,identityPreparationMs:performance.now()-started};
      q('[data-save-status]').textContent='';
      try{q('[data-legacy-export]').hidden=context.mediaEvidence.logicalKey===context.videoIdentity||!localStorage.getItem(`courtvision-review-task:${context.mediaEvidence.logicalKey}`);}catch{q('[data-legacy-export]').hidden=true;}
      player.crossOrigin=context.crossOrigin||null;if(!context.crossOrigin)player.removeAttribute('crossorigin');player.src=context.src;
      q('[data-end]').value=Math.min(context.duration,300);session=null;selected=null;evaluation=null;lockSha256=null;playback=null;comparison.clear();
      clearEventForm();q('[data-archive]').innerHTML='';
      message(identity.mediaEvidence.warning??'录像内容指纹核验完成');render();dialog.showModal();
    }catch(error){alert(error.message);}finally{launch.disabled=false;launch.textContent='人工复核与计时';}
  };
  q('[data-begin]').onclick=()=>{try{
    revision++;
    if(localStorage.getItem(key())&&!confirm('开始新任务会替换当前保存位置。旧任务将留在本机归档，但建议先导出。继续？'))return;
    if(!q('[data-start]').value.trim()||!q('[data-end]').value.trim())throw Error('请填写完整区间');
    const start=Number(q('[data-start]').value),end=Number(q('[data-end]').value);
    if(end>context.duration)throw Error('区间超过录像长度');
    const next=createReviewSession({id:crypto.randomUUID(),mode:q('[data-mode]').value,videoIdentity:context.videoIdentity,start,end,candidates:context.candidates.filter(c=>c.time>=start&&c.time<end)},now());
    next.mediaEvidence=context.mediaEvidence;next.identityPreparationMs=context.identityPreparationMs;
    next.candidateProvenance=reviewCandidateProvenance(context.candidateRun,next.range,next.mode);
    next.trial=validateTrialMetadata({operator:q('[data-operator]').value,pairId:q('[data-pair]').value,order:Number(q('[data-order]').value),familiarity:q('[data-familiarity]').value,performer:q('[data-performer]').value,deliveryStandard:q('[data-standard]').value,algorithmWaitMs:next.mode==='manual'?0:q('[data-wait]').value.trim()===''?null:Number(q('[data-wait]').value)*1000},next.mode);
    const old=localStorage.getItem(key());
    if(old){const saved=JSON.parse(old),oldSession=saved.session??saved;localStorage.setItem(`courtvision-review-archive:${oldSession.id}`,old);}
    comparison.clear();
    clearEventForm();
    session=next;session.operator=next.trial.operator;evaluation=null;lockSha256=null;selected=null;playback=null;player.pause();player.currentTime=start;persist();render();message('任务已开始；从审核到补漏的所有主动操作都会计时。');
  }catch(e){message(e.message);}};
  async function restore(storageKey,imported=null){const request=++revision;try{
    tick();persist();
    const saved=imported??JSON.parse(localStorage.getItem(storageKey));
    const restored=validateStoredReview(saved?.session??saved,context.videoIdentity);
    comparison.clear();
    if(restored.range.end>context.duration)throw Error('已保存区间超过当前录像长度');
    const hash=restored.status==='finished'?await digest(new TextEncoder().encode(JSON.stringify(restored))):null;
    if(request!==revision||!dialog.open)return;
    if(restored.status==='finished'&&saved.lockSha256!==hash)throw Error('锁定摘要不匹配，请保留原文件排查');
    const reference=saved.reference??saved.evaluation?.reference;
    const restoredEvaluation=restored.status==='finished'&&reference?evaluateReview(restored,reference):null;
    if(session&&(session.id!==restored.id||imported)){tick();localStorage.setItem(`courtvision-review-archive:${session.id}:${crypto.randomUUID()}`,JSON.stringify({session,evaluation,lockSha256}));}
    session=restored;if(session.status==='active'){session.lastTick=Math.max(now(),session.lastTick);session.paused=true;}
    clearEventForm();
    evaluation=restoredEvaluation;lockSha256=hash;selected=null;playback=null;player.pause();render();message(session.status==='finished'?'已恢复锁定结果；核验分数已重新计算。':'已恢复，当前暂停；点击继续计时。');
    persist();
  }catch(e){if(request===revision)message(e.message);}}
  q('[data-resume]').onclick=()=>restore(key());
  q('[data-task-import]').onchange=async event=>{
    const request=++revision;
    try{
      const file=event.target.files[0];if(!file)return;
      if(file.size>8*1024*1024)throw Error('备份超过8MB，请保留原文件');
      const raw=await file.text();if(request!==revision||!dialog.open)return;
      const saved=JSON.parse(raw);
      if(session&&!confirm('恢复备份会切换当前任务，当前记录先归档。继续？'))return;
      await restore(null,saved);
    }catch(error){if(request===revision)message(error.message);}finally{event.target.value='';}
  };
  q('[data-archive-list]').onclick=()=>{try{const result=listReviewArchives(localStorage,context.videoIdentity);q('[data-archive]').innerHTML=result.entries.map(e=>`<option value="${escapeHtml(e.key)}">${escapeHtml(e.id)} · ${e.mode} · ${e.range.start}–${e.range.end}秒 · ${e.status}</option>`).join('');message(`找到${result.entries.length}份归档；${result.invalid.length}份损坏记录未展示，未删除任何文件。`);}catch(e){message(e.message);}};
  q('[data-archive-restore]').onclick=()=>{const selectedKey=q('[data-archive]').value;if(!selectedKey){message('请先刷新并选择归档');return;}restore(selectedKey);};
  q('[data-legacy-export]').onclick=()=>{try{
    const raw=localStorage.getItem(`courtvision-review-task:${context.mediaEvidence.logicalKey}`);
    if(!raw)throw Error('没有旧版保存记录');
    download('legacy-review-unverified.json',raw);message('已原样导出旧记录；未修改其录像身份，也未删除原数据。');
  }catch(e){message(e.message);}};
  for(const b of dialog.querySelectorAll('[data-phase]'))b.onclick=()=>{try{if(!session)throw Error('请先开始任务');tick();session=changeReviewPhase(session,b.dataset.phase,session.lastTick);playback=null;persist();render();}catch(e){message(e.message);}};
  q('[data-pause]').onclick=()=>{if(session?.status!=='active')return;tick();session.paused=!session.paused;player.pause();playback=null;persist();render();};
  q('[data-now]').onclick=()=>{q('[data-time]').value=player.currentTime.toFixed(3);};
  q('[data-label]').onchange=()=>{if(reviewEventIssues({label:q('[data-label]').value,result:q('[data-result]').value}).length){q('[data-result]').value=['shot','free-throw'].includes(q('[data-label]').value)?'unknown':'not-applicable';message('已按标签调整结果选项，请再次核对。');}};
  q('[data-confirm]').onclick=()=>mutate({type:'confirm',id:selected});
  q('[data-edit]').onclick=()=>mutate({type:'edit',id:selected,changes:fields()});
  q('[data-delete]').onclick=()=>mutate({type:'delete',id:selected});
  q('[data-add]').onclick=()=>{const id=crypto.randomUUID();mutate({type:'add',id,event:fields()});if(session?.events.some(e=>e.id===id))selected=id;render();};
  q('[data-undo]').onclick=()=>mutate({type:'undo'});q('[data-prev]').onclick=()=>move(-1);q('[data-next]').onclick=()=>move(1);
  q('[data-list]').onclick=e=>{const b=e.target.closest('[data-event]');if(b)select(b.dataset.event);};
  q('[data-export]').onclick=()=>{if(!session)return;tick();persist();download(`review-${session.id}.json`,JSON.stringify({session,summary:reviewSummary(session),reference:evaluation?.reference??null,evaluation,lockSha256,warning:'真实人工效率需对照试验；锁定摘要用于追溯，不是防篡改认证'},null,2));};
  q('[data-finish]').onclick=async()=>{try{
    if(!session)throw Error('请先开始任务');
    if(!confirm('结束后不能修改本次结果。补漏检查是否已完成？未完成也会保留警告。'))return;
    tick();persist();const request=++revision;
    session=finishReview(session,session.lastTick);player.pause();playback=null;render();
    const id=session.id,hash=await digest(new TextEncoder().encode(JSON.stringify(session)));
    if(request!==revision||session?.id!==id)return;
    lockSha256=hash;persist();render();message('结果已锁定，可导入参考答案。'+session.completionWarnings.join('；'));
  }catch(e){message(e.message);}};
  q('[data-reference-template]').onclick=()=>{if(!session)return;download(`reference-template-${session.id}.json`,JSON.stringify({schemaVersion:1,protocol:session.protocol,videoIdentity:session.videoIdentity,range:session.range,scope:['shot'],exhaustive:false,provenance:'请填写独立标注来源；此文件本身不是答案',events:[]},null,2));};
  q('[data-reference]').onchange=async e=>{const request=++revision;try{
    if(session?.status!=='finished'||!lockSha256)throw Error('请先锁定任务');
    const file=e.target.files[0];if(!file)return;if(file.size>2*1024*1024)throw Error('参考答案超过2MB');
    const id=session.id,bytes=await file.arrayBuffer();
    if(request!==revision||session?.id!==id)return;
    const result=evaluateReview(session,JSON.parse(new TextDecoder().decode(bytes)));
    result.referenceSha256=await digest(bytes);
    if(request!==revision||session?.id!==id)return;
    evaluation=result;persist();render();message('参考核验完成，原复核结果保持锁定。');
  }catch(error){if(request===revision)message(error.message);}finally{if(request===revision)e.target.value='';}};
  q('[data-report]').onclick=()=>{if(session){tick();download(`report-${session.id}.md`,reviewReportText(session,evaluation),'text/markdown;charset=utf-8');}};
  for(const input of dialog.querySelectorAll('[data-report-field]'))input.oninput=()=>{try{
    if(session?.status!=='active')throw Error('请先开始任务');
    tick();if(session.phase!=='report'){session=changeReviewPhase(session,'report',session.lastTick);playback=null;}
    session=updateReviewReport(session,input.dataset.reportField,input.value,session.lastTick);persist();stats();
  }catch(error){message(error.message);}};
  function close(){tick();if(session)session.paused=true;player.pause();playback=null;if(!persist()){message('为避免丢失数据，暂不退出。请先导出任务或等待摘要完成。');return;}revision++;dialog.close();}
  q('[data-close]').onclick=close;dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
  document.addEventListener('visibilitychange',()=>{tick(previousVisibility&&dialog.open);previousVisibility=!document.hidden;playback=null;if(document.hidden)player.pause();persist();});
  for(const event of ['seeking','pause','waiting','ratechange','playing'])player.addEventListener(event,()=>{playback=null;});
  player.addEventListener('timeupdate',()=>{
    q('[data-position]').textContent=`录像 ${formatTime(player.currentTime)}`;
    if(!session){playback=null;return;}
    const step=reviewPlaybackStep(playback,{time:player.currentTime,wallMs:performance.now(),rate:player.playbackRate,active:session.status==='active'&&session.phase==='sweep'&&!session.paused,visible:!document.hidden&&dialog.open,playing:!player.paused,seeking:player.seeking},session.range);
    playback=step.previous;
    if(step.interval)session=addReviewCoverage(session,step.interval.start,step.interval.end);
    if(player.currentTime>=session.range.end)player.pause();
  });
  setInterval(()=>{if(dialog.open&&session){tick();stats();persist();}},1000);
  document.addEventListener('keydown',e=>{if(!dialog.open)return;e.stopImmediatePropagation();if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)||e.ctrlKey||e.metaKey||e.altKey)return;const map={c:'confirm',e:'edit',d:'delete',m:'add',u:'undo',j:'prev',k:'next'};if(map[e.key.toLowerCase()]){e.preventDefault();q(`[data-${map[e.key.toLowerCase()]}]`).click();}if(e.code==='Space'){e.preventDefault();player.paused?player.play().catch(err=>message(err.message)):player.pause();}},true);
}
