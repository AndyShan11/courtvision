import {STORAGE_KEY,freshState,validateState,skills,levels,focuses,drills,makePlan,stats,challengeProgress,comparison,localDay,poseMetrics,metricNames,coachBrief} from './core.mjs';
import {exportClip} from './clip-export.mjs';
const $=id=>document.getElementById(id), el=(tag,text='',cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
const labels={today:'今日训练',studio:'动作实验室',plan:'我的练习',progress:'成长记录',challenge:'挑战自己'};
let state=freshState(),raw=null,storageBroken=false,toastTimer,activeDrill=null,timerEnd=null,remaining=0;
function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').hidden=false;toastTimer=setTimeout(()=>$('toast').hidden=true,6500);}
try{raw=localStorage.getItem(STORAGE_KEY);if(raw)state=validateState(JSON.parse(raw));}catch{storageBroken=true;setTimeout(()=>toast('本机记录读取失败。原始数据没有覆盖，请先备份，再导入有效备份恢复。'),300);}
function commit(fn){
 try{
  if(storageBroken)throw Error('原始记录暂不可读，请先备份并导入有效文件恢复。');
  if(localStorage.getItem(STORAGE_KEY)!==raw)throw Error('另一窗口更新了记录。请刷新本页后再保存。');
  const next=structuredClone(state);fn(next);const valid=validateState(next),value=JSON.stringify(valid);localStorage.setItem(STORAGE_KEY,value);raw=value;state=valid;render();return true;
 }catch(e){toast(e.message||'保存失败，请备份记录后重试。');return false;}
}
addEventListener('storage',e=>{if(e.key===STORAGE_KEY)toast('另一窗口的记录已更新，请刷新后继续填写，避免覆盖。');});
function download(content,name,type='application/json'){const url=URL.createObjectURL(content instanceof Blob?content:new Blob([content],{type}));const a=el('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
const stamp=()=>localDay(new Date()), uid=()=>crypto.randomUUID(), pretty=d=>new Date(d).toLocaleDateString('zh-CN',{month:'long',day:'numeric'});
const formatTime=s=>`${String(Math.floor(Math.max(0,s)/60)).padStart(2,'0')}:${String(Math.floor(Math.max(0,s)%60)).padStart(2,'0')}`;
function go(name){if(location.hash==='#'+name)route();else location.hash=name;}
function route(){
 const hash=location.hash.slice(1),name=labels[hash]?hash:'today';
 if(['workspace','segments','report'].includes(hash)||new URLSearchParams(location.search).has('history')){location.replace('./film.html'+location.search);return;}
 for(const n of document.querySelectorAll('[data-page]'))n.hidden=n.dataset.page!==name;
 for(const n of document.querySelectorAll('[data-view]')){n.classList.toggle('active',n.dataset.view===name);if(n.dataset.view===name)n.setAttribute('aria-current','page');else n.removeAttribute('aria-current');}
 $('page-label').textContent=labels[name];document.title=labels[name]+' · 篮球伙伴';
 if(name!=='studio'){clipAbort?.abort();pauseVideos();stopCamera();stopPose();}
 render();window.scrollTo({top:0,behavior:'instant'});
}
for(const n of document.querySelectorAll('[data-go]'))n.onclick=()=>go(n.dataset.go);
addEventListener('hashchange',route);
function openProfile(){const p=state.profile;for(const key of ['name','level','skill','minutes'])$('profile-'+key).value=p[key];$('profile-dialog').showModal();}
for(const id of ['open-profile','edit-goal','plan-profile'])$(id).onclick=openProfile;
$('close-profile').onclick=()=>$('profile-dialog').close();
$('profile-form').onsubmit=e=>{e.preventDefault();const p={name:$('profile-name').value.trim()||'球友',level:$('profile-level').value,skill:$('profile-skill').value,minutes:Number($('profile-minutes').value)};if(commit(s=>s.profile=p)){$('profile-dialog').close();$('observation-skill').value=p.skill;toast('目标已保存，练习建议也更新了。');}};
function renderStats(target){const s=stats(state.sessions);$(target).replaceChildren(...[['◷','累计练习',s.minutes,'分钟'],['✓','完成练习',s.count,'次'],['↗','上场日',s.days,'天']].map(([icon,title,value,unit])=>{const box=el('article','','stat'),text=el('div'),strong=el('strong',String(value));strong.append(el('span',unit,'unit'));text.append(el('small',title),strong);box.append(el('span',icon,'stat-icon'),text,el('span',value?'继续保持':'从今天开始','stat-hint'));return box;}));}
function renderPlan(){const plan=makePlan(state);$('plan-title').textContent=`${state.profile.minutes} 分钟，专注${skills[state.profile.skill]}。`;$('plan-reason').textContent=plan.reason;$('plan-note').textContent=plan.note;$('today-plan-copy').textContent=`今天留 ${state.profile.minutes} 分钟给${skills[state.profile.skill]}，先关注「${focuses[plan.focus]}」。`;
 $('drill-list').replaceChildren(...plan.steps.map((d,i)=>{const n=el('article','','drill-card'),steps=el('ol'),row=el('div','','form-footer'),button=el('button','开始这个练习 →','button quiet');button.dataset.drill=d.id;button.onclick=()=>selectDrill(d);steps.append(...d.steps.map(s=>el('li',s)));row.append(el('span',`${d.minutes} 分钟 · 建议 ${d.sets} 组，组间休息`,'muted'),button);n.append(el('span',`0${i+1} / ${d.tag}`,'tag'),el('h3',d.title),steps,row);return n;}));
}
function empty(target,title,desc){const n=el('div','','empty-state');n.append(el('strong',title),el('p',desc));$(target).replaceChildren(n);}
function renderRecords(){
 $('session-count').textContent=state.sessions.length+' 条';$('observation-count').textContent=state.observations.length+' 条';
 const makeRecord=(r,type)=>{const n=el('article','','record'),head=el('div','','record-head'),remove=el('button','删除');remove.setAttribute('aria-label','删除此条'+(type==='sessions'?'训练':'观察'));remove.onclick=()=>{if(confirm('删除这一条记录？此操作不会删除原视频。'))commit(s=>s[type]=s[type].filter(x=>x.id!==r.id));};head.append(el('h3',type==='sessions'?drills.find(d=>d.id===r.drillId).title:`${skills[r.skill]} · ${focuses[r.focus]}`),remove);n.append(head,el('small',pretty(r.date)+(type==='observations'?` · ${r.author==='coach'?'教练填写':'自主观察'} · ${formatTime(r.time)}`:'')));
  if(type==='sessions')n.append(el('p',`${r.successes} / ${r.attempts} 次完成 · ${r.minutes} 分钟\n${r.condition}`));else n.append(el('p',`${r.source}${r.measurements?'\n'+r.measurements:''}`));
  if(r.note)n.append(el('p',r.note));return n;};
 if(state.sessions.length)$('session-list').replaceChildren(...state.sessions.slice().reverse().map(r=>makeRecord(r,'sessions')));else empty('session-list','每一次开始，都值得记下来','完成一次练习后，这里会出现你的真实记录。');
 if(state.observations.length)$('observation-list').replaceChildren(...state.observations.slice().reverse().map(r=>makeRecord(r,'observations')));else empty('observation-list','先发现一个小细节','在动作实验室保存观察，也可以请教练一起填写。');
 const old=$('trend-group').value,groups=new Map();for(const r of state.sessions){const k=JSON.stringify([r.drillId,r.condition]);groups.set(k,`${drills.find(d=>d.id===r.drillId).title} · ${r.condition}`);}
 $('trend-group').replaceChildren(...[...groups].map(([key,title])=>new Option(title,key)));if(groups.has(old))$('trend-group').value=old;renderTrend();
}
function renderTrend(){
 if(!$('trend-group').value){empty('trend-chart','还没有可比较的训练','记录相同条件下的练习，就能看到自己的变化。');$('trend-summary').textContent='下一次练完，记下练习条件和尝试次数。';return;}
 const [id,condition]=JSON.parse($('trend-group').value),result=comparison(state.sessions,id,condition),rows=result.rows.slice(-12),w=760,h=190,pad=42;
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox',`0 0 ${w} ${h}`);svg.setAttribute('role','img');svg.setAttribute('aria-label',rows.map(r=>`${pretty(r.date)}，完成${r.successes}/${r.attempts}`).join('；'));
 const shape=(tag,attrs,text)=>{const n=document.createElementNS(svg.namespaceURI,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;svg.append(n);return n;};
 for(const v of [0,50,100]){const y=155-v*1.2;shape('line',{x1:pad,x2:w-pad,y1:y,y2:y,stroke:'#e3e5da','stroke-dasharray':'3 4'});shape('text',{x:0,y:y+4},v+'%');}
 const points=rows.map((r,i)=>({x:rows.length===1?w/2:pad+i*(w-pad*2)/(rows.length-1),y:155-120*r.successes/r.attempts,r}));
 if(points.length>1)shape('polyline',{points:points.map(p=>`${p.x},${p.y}`).join(' '),fill:'none',stroke:'#9c88b5','stroke-width':3});
 for(const p of points){shape('circle',{cx:p.x,cy:p.y,r:5,fill:'#78648e'});shape('text',{x:p.x,y:Math.max(15,p.y-12),'text-anchor':'middle'},`${p.r.successes}/${p.r.attempts}`);shape('text',{x:p.x,y:182,'text-anchor':'middle'},new Date(p.r.date).toLocaleDateString('zh-CN',{month:'numeric',day:'numeric'}));}
 $('trend-chart').replaceChildren(svg);$('trend-summary').textContent=result.delta===null?'已有一次记录，下一次请保持相同条件。':`最近一次完成比例 ${(rows.at(-1).successes/rows.at(-1).attempts*100).toFixed(0)}%，较首次${result.delta>=0?'增加':'减少'} ${Math.abs(result.delta).toFixed(1)} 个百分点。共 ${result.rows.length} 次记录${result.rows.length>12?'，图中显示最近 12 次':''}。`;
}
$('trend-group').onchange=renderTrend;
function renderChallenge(){
 const c=state.challenge,n=challengeProgress(state),target=c?.target||3,skill=c?.skill||state.profile.skill;
 $('challenge-fraction').textContent=`${Math.min(n,target)} / ${target}`;$('challenge-title').textContent=`完成 ${target} 天${skills[skill]}练习`;$('challenge-progress').max=target;$('challenge-progress').value=n;
 $('join-challenge').textContent=c?'重新设定挑战 →':'开启我的挑战 →';$('challenge-status').textContent=c?(n>=target?'挑战达成！可以下载成长卡片，或开始下一次挑战。':`从 ${pretty(c.start)} 开始，已记录 ${n} 个训练日。`):'开启后，新完成的练习才会计入挑战。';
 const s=stats(state.sessions);$('badges').replaceChildren(...[['✓','第一次上场','完成一次练习',s.count>=1],['↗','看见自己','保存一次动作观察',state.observations.length>=1],['✦','稳步前进','在三个不同日期练习',s.days>=3],['⚑','挑战达成','完成当前个人挑战',!!c&&n>=target]].map(([icon,title,desc,done])=>{const n=el('div','','milestone'+(done?' unlocked':'')),t=el('div');t.append(el('h3',title+(done?' · 已解锁':'')),el('p',desc));n.append(el('span',icon),t);return n;}));
}
function render(){
 $('greeting').textContent=`你好，${state.profile.name}`;$('side-name').textContent=state.profile.name;$('today-date').textContent=new Date().toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'})+' / YOUR DAILY COURT';
 renderStats('overview-stats');renderStats('progress-stats');renderPlan();renderRecords();renderChallenge();
}
function speak(text){if(!$('voice').checked)return;if(!('speechSynthesis'in window)){toast('此浏览器不支持语音提示，计时仍可使用。');return;}speechSynthesis.cancel();const utterance=new SpeechSynthesisUtterance(text);utterance.lang='zh-CN';utterance.rate=.92;speechSynthesis.speak(utterance);}
function selectDrill(drill){activeDrill=drill;timerEnd=null;remaining=drill.minutes*60;$('active-drill-title').textContent=drill.title;$('active-drill-cue').textContent=drill.cue;$('timer-readout').textContent=formatTime(remaining);$('timer-start').disabled=false;$('timer-reset').disabled=false;$('timer-start').textContent='开始计时';$('session-drill').value=drill.id;updateMeasure();$('session-minutes').value=drill.minutes;$('practice-panel').scrollIntoView({behavior:'smooth',block:'center'});}
$('timer-start').onclick=()=>{if(timerEnd){remaining=Math.max(0,(timerEnd-Date.now())/1000);timerEnd=null;$('timer-start').textContent='继续';}else{if(remaining<=0)remaining=activeDrill.minutes*60;timerEnd=Date.now()+remaining*1000;$('timer-start').textContent='暂停';speak(activeDrill.cue);}};
$('timer-reset').onclick=()=>{if(activeDrill)selectDrill(activeDrill);};
setInterval(()=>{if(timerEnd){remaining=Math.max(0,Math.ceil((timerEnd-Date.now())/1000));$('timer-readout').textContent=formatTime(remaining);if(remaining===0){timerEnd=null;$('timer-start').textContent='再练一次';speak('这一组结束了，休息一下。记下刚才的练习。');toast('这一组结束了，休息一下，再记下真实完成次数。');}}},250);
$('session-drill').replaceChildren(...drills.map(d=>new Option(d.title,d.id)));
function updateMeasure(){const d=drills.find(d=>d.id===$('session-drill').value);$('measure-hint').textContent=d.measure;const last=state.sessions.filter(s=>s.drillId===d.id).at(-1);$('condition').value=last?.condition||'';}
$('session-drill').onchange=updateMeasure;
$('session-form').onsubmit=e=>{e.preventDefault();const s={id:uid(),date:new Date().toISOString(),drillId:$('session-drill').value,attempts:Number($('attempts').value),successes:Number($('successes').value),minutes:Number($('session-minutes').value),effort:Number($('effort').value),condition:$('condition').value.trim(),note:$('session-note').value.trim(),planId:activeDrill?.id||''};
 if(s.successes>s.attempts){$('session-status').textContent='完成次数不能超过尝试次数。';return;}if(!s.condition){$('session-status').textContent='请写下练习条件，方便下次比较。';return;}
 if(commit(st=>st.sessions.push(s))){$('attempts').value='';$('successes').value='';$('session-note').value='';$('session-status').textContent='已保存。下次在相同条件下再试一次。';toast('又完成了一次练习，成长记录已更新。');}
};
$('challenge-form').onsubmit=e=>{e.preventDefault();if(state.challenge&&!confirm('重新开始挑战？历史训练会保留，新挑战从现在开始计数。'))return;if(commit(s=>s.challenge={id:uid(),skill:$('challenge-skill').value,target:Number($('challenge-target').value),start:new Date().toISOString()}))toast('挑战已开启。完成练习后记下来，就会自动计入。');};
function backup(){download(storageBroken?(raw||''):JSON.stringify(state,null,2),`篮球伙伴-${stamp()}${storageBroken?'-原始记录':''}.json`);}
$('backup').onclick=backup;
// Backup remains reachable on narrow screens where the top bar is simplified.
const mobileBackup=el('button','备份记录 ↓','button quiet');mobileBackup.onclick=backup;$('import-data').closest('.bottom-strip').append(mobileBackup);
$('import-data').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{if(f.size>8e6)throw Error('备份过大，请选择小于 8 MB 的记录文件。');const imported=validateState(JSON.parse(await f.text()));if((state.sessions.length||state.observations.length||storageBroken)&&!confirm('导入将替换当前训练档案和记录。建议先点“备份记录”。确定导入？'))return;const next=JSON.stringify(imported);localStorage.setItem(STORAGE_KEY,next);raw=next;state=imported;storageBroken=false;render();toast('备份已导入。录像需要重新选择，文件不会随记录上传。');}catch(err){toast(err.message||'导入失败，原记录没有改变。');}finally{e.target.value='';}};
function reportText(){const p=state.profile;return [`篮球伙伴 · 训练交流记录\n生成日期：${stamp()}\n昵称：${p.name}\n方向：${skills[p.skill]}\n阶段：${levels[p.level]}\n每次可用：${p.minutes} 分钟\n\n数据由使用者/教练手动填写，非自动技术诊断。`,...state.observations.map(o=>`\n观察 ${pretty(o.date)} / ${o.author==='coach'?'教练填写':'自主观察'}\n${o.source} 第 ${o.time.toFixed(1)} 秒\n${focuses[o.focus]}：${o.note}\n${o.measurements}`),...state.sessions.map(s=>`\n练习 ${pretty(s.date)}：${drills.find(d=>d.id===s.drillId).title}\n${s.condition}\n完成 ${s.successes}/${s.attempts}，${s.minutes} 分钟，主观吃力程度 ${s.effort}/5\n${s.note}`),'\n想请教教练：我的观察是否准确？下一次最该专注什么？怎样判断已经改善？'].join('\n');}
$('export-report').onclick=()=>download(reportText(),`篮球伙伴-教练报告-${stamp()}.txt`,'text/plain;charset=utf-8');
$('copy-brief').onclick=async()=>{const text=reportText()+'\n\n当前建议\n'+makePlan(state).steps.map(d=>d.title).join(' → ');try{await navigator.clipboard.writeText(text);toast('已复制训练摘要，可以发给教练或你的 AI 助手。');}catch{download(text,'篮球伙伴-训练摘要.txt','text/plain;charset=utf-8');toast('浏览器无法复制，已导出摘要文件。');}};
$('share-card').onclick=()=>{if(!state.sessions.length){toast('先完成一次真实练习，再生成你的成长卡片。');return;}const c=document.createElement('canvas');c.width=1080;c.height=1350;const ctx=c.getContext('2d'),s=stats(state.sessions);ctx.fillStyle='#e8e1f3';ctx.fillRect(0,0,1080,1350);ctx.strokeStyle='#cec4df';for(let i=0;i<1350;i+=54){ctx.beginPath();ctx.moveTo(0,i);ctx.lineTo(1080,i);ctx.stroke();}ctx.fillStyle='#fffdf6';ctx.fillRect(65,65,950,1220);ctx.fillStyle='#294e42';ctx.font='30px sans-serif';ctx.fillText('篮球伙伴 / COURTVISION',120,150);ctx.font='bold 68px sans-serif';ctx.fillText('今天，也上场。',120,300);ctx.fillStyle='#85719e';ctx.font='40px sans-serif';ctx.fillText(state.profile.name.slice(0,18),120,385);ctx.font='110px sans-serif';ctx.fillText(String(s.days),120,570);ctx.font='28px sans-serif';ctx.fillText('个训练日 · 和昨天的自己比',120,640);ctx.fillStyle='#294e42';ctx.font='45px sans-serif';ctx.fillText(`${s.count} 次练习`,120,800);ctx.fillText(`${s.minutes} 分钟专注`,120,875);ctx.font='27px sans-serif';ctx.fillStyle='#85937b';ctx.fillText('每一次练习，都有方向。',120,1070);ctx.font='22px sans-serif';ctx.fillText(`${stamp()} · 根据本机手动训练记录生成`,120,1170);c.toBlob(blob=>download(blob,`我的篮球成长-${stamp()}.png`),'image/png');};

const video=$('training-video'),reference=$('reference-video'),canvas=$('pose-canvas');
let clipAbort=null;
const exportButton=el('button','导出片段 ↓','button quiet compact'),cancelExport=el('button','取消导出','button quiet compact');cancelExport.hidden=true;
document.querySelector('.transport').append(exportButton,cancelExport);cancelExport.onclick=()=>clipAbort?.abort();
exportButton.onclick=async()=>{
 if(!ready()||stream||start===null||end===null){tell('先载入录像，并设置片段的起点、终点。导出为带标题的无声 WebM 视频。');return;}
 if(end-start>60){tell('请把导出片段控制在 60 秒以内。');return;}
 pauseVideos();const wasLoop=$('loop').checked;$('loop').checked=false;clipAbort=new AbortController();exportButton.disabled=true;cancelExport.hidden=false;
 const controls=[...document.querySelectorAll('#video-grid input,#video-grid button,.transport button,.transport input,#sample,#pose-toggle,#speed')].filter(n=>n!==cancelExport&&n!==exportButton);controls.forEach(n=>n.disabled=true);video.controls=false;reference.controls=false;
 try{const blob=await exportClip({video,start,end,title:`篮球伙伴 · ${mainName.startsWith('公开示例')?'3×3 示例 / Honza Nový CC BY 3.0':state.profile.name+'的练习'}`,signal:clipAbort.signal,onProgress:p=>tell(`正在导出 ${Math.round(p*100)}% · 请保持页面在前台 · 导出为无声 WebM`)});download(blob,`篮球练习片段-${stamp()}.webm`);tell('片段已导出：无声 WebM 视频。由你决定分享给谁。');}catch(e){tell(e.message);}finally{clipAbort=null;controls.forEach(n=>n.disabled=false);video.controls=true;reference.controls=true;exportButton.disabled=false;cancelExport.hidden=true;$('loop').checked=wasLoop;}
};
let mainURL=null,refURL=null,stream=null,mainName='',referenceName='',sync=false,offset=0,start=null,end=null,poseWorker=null,poseEnabled=false,poseReady=false,poseBusy=false,poseGeneration=0,lastPoseTime=-1,lastSend=0,currentMetrics={},lastPoseAt=-1,lastPoints=null;
function tell(t){$('studio-status').textContent=t;}
function pauseVideos(){video.pause();reference.pause();sync=false;$('play-together').textContent='同步播放';}
function clearPose(){canvas.getContext('2d').clearRect(0,0,canvas.width,canvas.height);currentMetrics={};lastPoseAt=-1;lastPoints=null;renderMetrics();}
function stopPose(){poseEnabled=false;poseReady=false;poseBusy=false;poseWorker?.terminate();poseWorker=null;poseGeneration++;clearPose();$('pose-toggle').disabled=false;$('pose-toggle').textContent='开启人体关键点';$('pose-status').textContent='点击开启后，在设备上识别当前画面。';}
function stopCamera(){if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;video.srcObject=null;video.muted=false;$('stop-camera').hidden=true;$('camera').hidden=false;$('video-placeholder').hidden=false;mainName='';$('source-name').textContent='尚未选择录像';stopPose();}}
function resetMain(){pauseVideos();stopCamera();stopPose();if(mainURL)URL.revokeObjectURL(mainURL);mainURL=null;video.removeAttribute('src');start=null;end=null;offset=0;lastPoseTime=-1;$('loop').checked=false;$('clip-range').textContent='尚未设置片段';}
function loadFile(f,isRef=false){if(!f)return;if(!f.type.startsWith('video/')&&!/\.(mp4|webm|mov|m4v)$/i.test(f.name)){toast('请选择可播放的 MP4 / WebM 录像。');return;}if(isRef){reference.pause();if(refURL)URL.revokeObjectURL(refURL);refURL=URL.createObjectURL(f);reference.src=refURL;referenceName=f.name;$('reference-name').textContent=f.name;$('reference-placeholder').hidden=true;offset=0;}else{resetMain();mainURL=URL.createObjectURL(f);video.src=mainURL;mainName=f.name;$('source-name').textContent=f.name;$('video-placeholder').hidden=true;}tell('录像仅在本机播放。找到一个动作阶段，再慢放或和参考录像对齐。');}
for(const id of ['training-file','replace-file'])$(id).onchange=e=>{loadFile(e.target.files[0]);e.target.value='';};
for(const id of ['reference-file','replace-reference'])$(id).onchange=e=>{loadFile(e.target.files[0],true);e.target.value='';};
function sample(){go('studio');resetMain();video.src='./samples/basketball-3x3.webm';mainName='公开示例：3×3比赛（非标准教学）';$('source-name').textContent=mainName;$('video-placeholder').hidden=true;tell('操作示例：这是一段公开比赛录像，可体验慢放和观察。并非你的训练成绩，也不是标准动作。');}
$('sample').onclick=sample;$('demo-today').onclick=sample;
video.onerror=()=>{tell('录像无法播放。请换用浏览器支持的 MP4（H.264）或 WebM 文件。');clearPose();};reference.onerror=()=>tell('参考录像无法播放，请换用支持的 MP4 或 WebM。');
video.onloadedmetadata=()=>{video.playbackRate=Number($('speed').value);clearPose();};reference.onloadedmetadata=()=>reference.playbackRate=Number($('speed').value);
const ready=()=>video.readyState>=2;
function refSeek(){if(reference.readyState>=2){const t=video.currentTime+offset;if(t<0||t>reference.duration){reference.pause();return false;}reference.currentTime=t;return true;}return false;}
$('align').onclick=()=>{if(!ready()||reference.readyState<2){tell('先选择两段录像，并分别找到相同动作阶段。');return;}offset=reference.currentTime-video.currentTime;tell(`已对齐当前画面，参考时间偏移 ${offset.toFixed(1)} 秒。同步播放会保留这一偏移。`);};
$('clear-reference').onclick=()=>{reference.pause();if(refURL)URL.revokeObjectURL(refURL);refURL=null;referenceName='';reference.removeAttribute('src');reference.load();$('reference-placeholder').hidden=false;$('reference-name').textContent='教练示范 / 上次训练';offset=0;setMode(false);};
function setMode(overlay){if(overlay&&reference.readyState<2){tell('先选择一段参考录像，再开启叠加对比。');return;}$('video-grid').classList.toggle('overlay',overlay);$('mode-side').setAttribute('aria-pressed',String(!overlay));$('mode-overlay').setAttribute('aria-pressed',String(overlay));$('stage-reference').style.opacity=overlay?Number($('opacity').value)/100:'';}
$('mode-side').onclick=()=>setMode(false);$('mode-overlay').onclick=()=>setMode(true);$('opacity').oninput=()=>{if($('video-grid').classList.contains('overlay'))$('stage-reference').style.opacity=Number($('opacity').value)/100;};
$('speed').onchange=()=>{video.playbackRate=reference.playbackRate=Number($('speed').value);};
$('play-together').onclick=async()=>{if(!ready()){tell('请先选择录像。');return;}if(stream){tell('摄像头正在实时取景，无需回放。');return;}if(!video.paused){pauseVideos();return;}try{if(start!==null&&end!==null&&$('loop').checked&&(video.currentTime<start||video.currentTime>=end))video.currentTime=start;sync=true;const rr=refSeek();await video.play();if(rr)await reference.play();$('play-together').textContent='暂停';}catch{tell('无法开始播放，请在播放器中点击播放。');pauseVideos();}};
for(const [id,delta]of [['step-back',-.1],['step-next',.1]])$(id).onclick=()=>{if(!ready()||stream)return;pauseVideos();video.currentTime=Math.min(video.duration,Math.max(0,video.currentTime+delta));refSeek();};
$('mark-in').onclick=()=>{if(!ready()||stream){tell('请先选择可以回看的录像。');return;}start=video.currentTime;if(end!==null&&end<=start)end=null;range();};
$('mark-out').onclick=()=>{if(!ready()||stream)return;if(start===null||video.currentTime<=start){tell('请先设起点，再在更晚的画面设终点。');return;}end=video.currentTime;range();};
function range(){$('clip-range').textContent=`${start===null?'—':start.toFixed(1)} → ${end===null?'—':end.toFixed(1)} 秒`;}
$('loop').onchange=()=>{if($('loop').checked&&(start===null||end===null)){$('loop').checked=false;tell('先设好片段起点与终点，再启用循环。');}};
video.addEventListener('pause',()=>{if(!stream){reference.pause();$('play-together').textContent='同步播放';}});
video.addEventListener('seeked',()=>{clearPose();lastPoseTime=-1;if(sync)refSeek();});
video.addEventListener('ended',()=>{if($('loop').checked&&start!==null&&end!==null){video.currentTime=start;video.play().catch(()=>{});if(sync&&refSeek())reference.play().catch(()=>{});}else pauseVideos();});
video.addEventListener('timeupdate',()=>{$('video-time').textContent=formatTime(video.currentTime);if($('loop').checked&&end!==null&&video.currentTime>=end&&!video.paused){video.currentTime=start;if(sync&&refSeek())reference.play().catch(()=>{});}if(sync&&!video.paused&&reference.readyState>=2){const t=video.currentTime+offset;if(t<0||t>reference.duration)reference.pause();else{if(Math.abs(reference.currentTime-t)>.25)reference.currentTime=t;if(reference.paused)reference.play().catch(()=>{});}}});
$('camera').onclick=async()=>{try{if(!navigator.mediaDevices?.getUserMedia)throw Error('此浏览器无法使用摄像头，请选择录像。');const next=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment',width:{ideal:1280}},audio:false});if(location.hash!=='#studio'){next.getTracks().forEach(t=>t.stop());return;}resetMain();stream=next;video.srcObject=stream;video.muted=true;await video.play();mainName='摄像头实时观察';$('source-name').textContent=mainName;$('video-placeholder').hidden=true;$('camera').hidden=true;$('stop-camera').hidden=false;tell('摄像头已开启。只在本机取景，不录制。可以开启关键点，观察身体位置。');}catch(e){stopCamera();tell(e.name==='NotAllowedError'?'未获得摄像头权限。你仍可以选择本地录像。':e.message);}};
$('stop-camera').onclick=()=>{stopCamera();tell('摄像头已关闭。');};
function renderMetrics(){const root=$('pose-metrics');root.replaceChildren(...Object.entries(metricNames).map(([key,title])=>{const n=el('div');n.append(el('strong',Number.isFinite(currentMetrics[key])?Math.round(currentMetrics[key])+'°':'—'),el('span',title));return n;}));}
function drawPose(points){const rect=video.getBoundingClientRect();canvas.width=Math.round(rect.width*devicePixelRatio);canvas.height=Math.round(rect.height*devicePixelRatio);const c=canvas.getContext('2d');c.clearRect(0,0,canvas.width,canvas.height);if(!points)return;const ratio=Math.min(canvas.width/video.videoWidth,canvas.height/video.videoHeight),w=ratio*video.videoWidth,h=ratio*video.videoHeight,x=(canvas.width-w)/2,y=(canvas.height-h)/2;const connections=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[28,30],[30,32]];c.lineWidth=2.5*devicePixelRatio;c.strokeStyle='#cbd9ac';for(const [a,b]of connections){if(points[a].visibility<.65||points[b].visibility<.65)continue;c.beginPath();c.moveTo(x+points[a].x*w,y+points[a].y*h);c.lineTo(x+points[b].x*w,y+points[b].y*h);c.stroke();}c.fillStyle='#f4c293';for(const p of points){if(p.visibility<.65)continue;c.beginPath();c.arc(x+p.x*w,y+p.y*h,3.2*devicePixelRatio,0,Math.PI*2);c.fill();}}
$('pose-toggle').onclick=()=>{if(poseEnabled){stopPose();return;}if(!ready()){tell('请先载入录像或开启摄像头。');return;}poseEnabled=true;poseGeneration++;const generation=poseGeneration;$('pose-toggle').textContent='关闭关键点';$('pose-status').textContent='正在加载本机识别组件，请稍等…';
 try{poseWorker=new Worker(new URL('./pose-worker.mjs',import.meta.url));const timeout=setTimeout(()=>{if(poseGeneration===generation&&!poseReady){stopPose();$('pose-status').textContent='模型加载超时，请检查网络后点击重试。';}},60000);
 poseWorker.onerror=()=>{clearTimeout(timeout);stopPose();$('pose-status').textContent='无法加载识别组件，请稍后重试，或用双画面继续观察。';};
 poseWorker.onmessage=({data})=>{if(generation!==poseGeneration)return;if(data.type==='ready'){clearTimeout(timeout);poseReady=true;lastPoseTime=-1;$('pose-status').textContent='已就绪，正在本机识别画面。';}else if(data.type==='result'){poseBusy=false;if(Math.abs(data.time-video.currentTime)>1){clearPose();return;}if(data.landmarks.length!==1){clearPose();$('pose-status').textContent=data.landmarks.length>1?'画面中有多人，请换用单人训练录像，避免把别人当作你。':'没有清楚识别到全身，请调整机位或换一个画面。';return;}const points=data.landmarks[0];lastPoints=points;drawPose(points);currentMetrics=poseMetrics(points,video.videoWidth/video.videoHeight);lastPoseAt=data.time;renderMetrics();$('pose-status').textContent=`当前 ${data.time.toFixed(1)} 秒 · 已识别人体关键点 · 角度仅供观察`;}else{clearTimeout(timeout);stopPose();$('pose-status').textContent='识别失败，请重新开启。录像回看和记录仍可使用。';}};
 poseWorker.postMessage({type:'init'});
 }catch{stopPose();$('pose-status').textContent='此浏览器不支持本机识别组件，请使用新版 Chrome 或 Edge。';}
};
async function tick(now){requestAnimationFrame(tick);if(!poseEnabled||!poseReady||poseBusy||!ready()||document.hidden||location.hash!=='#studio'||now-lastSend<250||lastPoseTime===video.currentTime)return;poseBusy=true;lastSend=now;const time=video.currentTime,generation=poseGeneration;lastPoseTime=time;try{const bitmap=await createImageBitmap(video);if(generation!==poseGeneration||!poseWorker){bitmap.close();return;}poseWorker.postMessage({type:'frame',id:generation,time,bitmap},[bitmap]);}catch{poseBusy=false;clearPose();$('pose-status').textContent='无法读取这一帧，试试换一个画面。';}}
requestAnimationFrame(tick);
addEventListener('resize',()=>{if(lastPoints)drawPose(lastPoints);lastPoseTime=-1;});
$('observation-form').onsubmit=e=>{e.preventDefault();if(!mainName||!ready()){tell('先选择录像或开启摄像头，再保存对应画面的观察。');return;}const note=$('observation-note').value.trim();if(!note){toast('请记录一个具体观察。');return;}const metrics=Math.abs(lastPoseAt-video.currentTime)<.5?Object.entries(currentMetrics).filter(([,v])=>Number.isFinite(v)).map(([k,v])=>`${metricNames[k]} ${Math.round(v)}°`).join(' / '):'';const o={id:uid(),date:new Date().toISOString(),skill:$('observation-skill').value,focus:$('observation-focus').value,time:video.currentTime,note,source:mainName,reference:referenceName,author:$('observation-author').value,measurements:metrics?`画面内角度（非质量评分）：${metrics}`:''};if(commit(s=>{s.observations.push(o);s.profile.skill=o.skill;})){$('observation-note').value='';go('plan');toast('观察已保存。下面的练习已按这次关注点调整。');}};
addEventListener('pagehide',()=>{stream?.getTracks().forEach(t=>t.stop());poseWorker?.terminate();if('speechSynthesis'in window)speechSynthesis.cancel();});

const aiOrigin='http://127.0.0.1:4191';let coachFrame;
$('connect-coach').onclick=()=>{coachFrame?.remove();coachFrame=document.createElement('iframe');coachFrame.title='本机篮球学习助手';coachFrame.src=aiOrigin+'/coach';coachFrame.onload=()=>coachFrame.contentWindow.postMessage({type:'basketball-coach-init'},aiOrigin);$('coach-frame').append(coachFrame);$('coach-status').textContent='若无法连接，请先运行更新后的本机启动程序，再重试。其他设备也需安装本机模型。';};
addEventListener('message',e=>{if(!coachFrame||e.source!==coachFrame.contentWindow||e.origin!==aiOrigin)return;if(e.data?.type==='basketball-coach-ready'){$('coach-status').textContent='已连接本机学习助手。点击下方生成，才会读取你的训练档案。';}if(e.data?.type==='basketball-coach-context'&&typeof e.data.id==='string')e.source.postMessage({type:'basketball-coach-data',id:e.data.id,context:coachBrief(state)},aiOrigin);});
updateMeasure();$('observation-skill').value=state.profile.skill;route();
