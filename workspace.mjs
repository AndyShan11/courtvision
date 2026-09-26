const $=id=>document.getElementById(id),video=$('video');
const names={three:'三分',shot:'投篮',freethrow:'罚球',rebound:'篮板',turnover:'失误',steal:'抢断',block:'盖帽',foul:'犯规',substitution:'换人',timeout:'暂停',other:'其他',jumpball:'跳球',violation:'违例'};
let rows=[],reviews={},selected=null,chosen=null,source=null,key='',ready=false,blob=null,stop=null,writable=true,revision=0;
const node=(tag,text,cls)=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
const tell=text=>{$('notice').textContent=text;};
const safe=fn=>async(...args)=>{try{await fn(...args);}catch(e){tell(e.message);}};
const time=c=>String(c??'').replace(/^PT(\d+)M([\d.]+)S$/,(_,m,s)=>`${m}:${String(Math.floor(+s)).padStart(2,'0')}`);
function status(r){return reviews[r.id]?.state||'pending';}
function label(r){return status(r)==='confirmed'?'人工已确认':status(r)==='rejected'?'人工标记不符':r.sourceGap?'原片缺段':r.status==='ambiguous'?'有歧义 · 待复核':r.candidates.length?'候选 · 待复核':'未定位 · 可人工补充';}
function all(){return [...rows,...Object.values(reviews).filter(x=>x.added).map(x=>x.added)];}
function render(){const oldScroll=$('event-list').scrollTop;const q=$('search').value.toLowerCase(),s=$('status').value,k=$('kind').value;const list=all().filter(r=>(!s||(s==='gap'?r.sourceGap:status(r)===s))&&(!k||r.kind===k)&&`${reviews[r.id]?.description??r.description} ${r.player??''}`.toLowerCase().includes(q));$('count').textContent=`${list.length} / ${all().length} 条`;
 $('event-list').replaceChildren(...list.map(r=>{const b=node('button','',`event ${status(r)}`);b.dataset.id=r.id;b.setAttribute('aria-pressed',String(selected?.id===r.id));b.append(node('span',r.period?`Q${r.period} ${time(r.clock)}`:'人工补充','clock'),node('span',reviews[r.id]?.description??r.description),node('small',label(r)));b.onclick=()=>select(r);return b;}));$('event-list').scrollTop=oldScroll;if(!list.length)$('event-list').append(node('p','没有符合条件的事件','no-events'));}
function seek(range){if(!ready||!range)return;if(!Number.isFinite(range.start)||!Number.isFinite(range.end)||range.start<0||range.end>video.duration||range.end<=range.start){tell('该时间段超出当前录像，请检查录像版本或手动修正。');return;}video.pause();video.currentTime=range.start;stop=range.end;}
function select(r){selected=r;const saved=reviews[r.id];chosen=saved?.range??r.candidates[0]??null;$('event-title').textContent=`${r.period?'Q'+r.period+' '+time(r.clock)+' · ':''}${saved?.description??r.description}`;$('evidence').textContent=r.reason||'点击候选回看；不确定时修改区间和说明，再确认保存。';$('description').value=saved?.description??r.description;$('start').value=chosen?.start??'';$('end').value=chosen?.end??'';
 const positions=[...r.candidates.map((c,i)=>({...c,label:`候选 ${i+1}`})),...(r.reviewWindows??[]).map(c=>({...c,label:c.label||'人工复核窗口'}))];if(saved?.range)positions.unshift({...saved.range,label:'我的修正'});
 $('positions').replaceChildren(...positions.map(c=>{const b=node('button',`${c.label} · ${c.start.toFixed(1)}–${c.end.toFixed(1)}秒`);b.disabled=!ready;b.onclick=()=>{seek(c);if(!r.sourceGap){chosen=c;$('start').value=c.start;$('end').value=c.end;}for(const x of $('positions').children)x.classList.toggle('positions-selected',x===b);};return b;}));
 $('confirm').disabled=!ready||!writable;$('reject').disabled=!writable;$('reset').disabled=!writable;render();const active=$('event-list').querySelector('[aria-pressed=true]');if(active){const a=active.getBoundingClientRect(),b=$('event-list').getBoundingClientRect();if(a.top<b.top||a.bottom>b.bottom)$('event-list').scrollTop+=a.top-b.top;}seek(chosen);
}
function persist(next){if(!writable)throw Error('复核记录无法读取，已禁止覆盖。请先导出备份。');try{localStorage.setItem(key,JSON.stringify(next));}catch{throw Error('保存失败：浏览器存储不可用或已满。请导出备份。');}reviews=next;$('save-state').textContent='已保存到当前浏览器 · 可导出备份';tell('复核已保存。原始候选不变，你的修改单独记录。');}
function detach(){ready=false;stop=null;video.pause();video.removeAttribute('src');video.load();if(blob)URL.revokeObjectURL(blob);blob=null;$('empty').hidden=false;}
async function load(doc,text){const raw=doc.benchmark?.rows??doc.report?.rows??doc.rows??doc.events??doc.game?.actions??doc.actions??doc;if(!Array.isArray(raw)||!raw.length||raw.length>5000)throw Error('事件表需为非空 JSON 数组或分析结果，最多5000条。');
 const ids=new Set();const parsed=raw.map((r,i)=>{const id=String(r.id??r.actionNumber??i+1);if(ids.has(id))throw Error('事件编号重复，请先修正事件表。');ids.add(id);const ranges=a=>(a??[]).map(c=>{if(!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<0||c.end<=c.start)throw Error('事件时间段格式无效');return {...c};});return {...r,id,description:String(r.description??r.playerName??'未命名事件').slice(0,500),kind:r.kind??(/3pt/i.test(r.actionType??'')?'three':'other'),candidates:ranges(r.candidates),reviewWindows:ranges(r.reviewWindows)};});
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 detach();rows=parsed;source=doc.benchmark?{size:doc.benchmark.sourceBytes,duration:doc.benchmark.duration}:doc.source??null;key='courtvision-simple-review:'+digest;reviews={};writable=true;try{const stored=localStorage.getItem(key);const obj=stored?JSON.parse(stored):(doc.reviews??{});if(!obj||typeof obj!=='object'||Array.isArray(obj))throw Error();for(const v of Object.values(obj)){if(!v||!['confirmed','rejected','pending'].includes(v.state))throw Error();if(v.range&&(!Number.isFinite(v.range.start)||!Number.isFinite(v.range.end)||v.range.start<0||v.range.end<=v.range.start))throw Error();}reviews=obj;}catch{writable=false;tell('原复核记录无效，已禁止覆盖。');}
 $('match-title').textContent=doc.benchmark?.title??source?.name??'比赛录像';$('kind').replaceChildren(new Option('全部类型',''),...[...new Set(rows.map(r=>r.kind))].map(k=>new Option(names[k]??k,k)));$('search').value='';$('status').value='';select(rows.find(r=>r.id===new URLSearchParams(location.search).get('event'))??rows.find(r=>r.candidates.length)??rows[0]);if(writable)tell('事件已载入。选择对应录像，点击事件即可跳转；没有定位的事件可手动补时间。');}
async function attach(file){if(!file)return;detach();if(source?.size&&source.size!==file.size){tell('这不是当前事件表对应的录像。请选同一原片，或先导入新比赛事件表。');select(selected);return;}blob=URL.createObjectURL(file);video.src=blob;$('empty').hidden=true;tell('正在连接本机录像…');}
video.addEventListener('loadedmetadata',()=>{if(!blob||video.src!==blob)return;if(source?.duration&&Math.abs(video.duration-source.duration)>1){tell('录像时长与事件表不符，已禁用定位。请更换对应原片。');select(selected);return;}ready=true;tell('本机录像已连接，不上传。请核对录像版本；候选位置仍需人工确认。');select(selected);});
video.addEventListener('timeupdate',()=>{if(stop!==null&&video.currentTime>=stop){video.pause();stop=null;}});
video.addEventListener('error',()=>{if(!blob)return;ready=false;const m={1:'播放被中止',2:'本地录像读取失败',3:'解码失败，文件可能损坏或编码不兼容',4:'浏览器不支持该视频格式'};tell((m[video.error?.code]||'播放失败')+'，请重新选择录像。这不等于比赛缺段。');if(selected)select(selected);});
for(const id of ['video-file','empty-file'])$(id).onchange=safe(e=>{const f=e.target.files[0];e.target.value='';return attach(f);});
$('events-file').onchange=safe(async e=>{const f=e.target.files[0];if(!f)return;if(f.size>5e6)throw Error('事件文件请小于5MB');const rev=++revision,text=await f.text();let d;try{d=JSON.parse(text);}catch{d=text.trim().split(/\r?\n/).map(s=>JSON.parse(s));}if(rev===revision)await load(d,text);});
for(const id of ['status','kind','search'])$(id).addEventListener('input',render);
$('use-start').onclick=()=>{if(ready)$('start').value=video.currentTime.toFixed(1);};$('use-end').onclick=()=>{if(ready)$('end').value=video.currentTime.toFixed(1);};
$('review').onsubmit=safe(e=>{e.preventDefault();if(!selected||!ready)throw Error('先选择对应录像和事件');const start=Number($('start').value),end=Number($('end').value);if(!$('start').value||!$('end').value||!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>video.duration)throw Error('请填写有效起止秒数，结束须晚于开始且不超过录像时长。');persist({...reviews,[selected.id]:{...reviews[selected.id],state:'confirmed',description:$('description').value.trim()||selected.description,range:{start,end},updatedAt:new Date().toISOString()}});select(selected);});
$('reject').onclick=safe(()=>{if(!selected)return;persist({...reviews,[selected.id]:{...reviews[selected.id],state:'rejected',description:$('description').value.trim()||selected.description,updatedAt:new Date().toISOString()}});select(selected);});
$('reset').onclick=safe(()=>{if(!selected)return;const added=reviews[selected.id]?.added,next={...reviews};delete next[selected.id];persist(next);select(added?rows[0]:selected);});
$('add').onclick=safe(()=>{if(!ready)throw Error('先选择录像，再补漏');const id='manual-'+crypto.randomUUID(),r={id,description:'补漏事件',kind:'other',candidates:[],reviewWindows:[]};persist({...reviews,[id]:{state:'pending',added:r,description:r.description}});$('status').value='';$('kind').value='';$('search').value='';select(r);$('start').value=video.currentTime.toFixed(1);$('end').value=Math.min(video.duration,video.currentTime+8).toFixed(1);$('description').focus();});
$('export').onclick=safe(()=>{const a=node('a',''),url=URL.createObjectURL(new Blob([JSON.stringify({version:1,source,rows,reviews,note:'人工复核与机器候选分开保存；不代表视觉识别真值'},null,2)],{type:'application/json'}));a.href=url;a.download='篮球事件与复核.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
const initial=revision;fetch('./history-data.json').then(r=>{if(!r.ok)throw Error('历史事件加载失败，请导入事件表');return r.text();}).then(text=>{if(revision===initial)return load(JSON.parse(text),text);}).catch(e=>tell(e.message));

export async function aiContext(mode){
 if(!selected)throw Error('先选择一个事件');
 const current=selected,version=key,videoBlob=blob;
 const player=String(current.player||'').trim();
 if(mode==='player'&&!player)throw Error('该事件没有球员字段，请选择有球员姓名的事件。');
 const available=all().filter(r=>status(r)!=='rejected'),subset=mode==='player'?available.filter(r=>r.player===current.player):available;
 const counts={};for(const r of subset)counts[r.kind]=(counts[r.kind]||0)+1;
 const context=JSON.stringify({title:$('match-title').textContent,scope:mode==='player'?player:'导入事件表（可能不完整）',eventCount:subset.length,eventTypeCounts:counts,note:'计数是事件条数，不是得分/出手数；不计算命中率。球员名来自事件表，并非视觉身份识别。',current:{id:current.id,description:reviews[current.id]?.description??current.description,state:status(current)},examples:subset.slice(0,20).map(r=>({id:r.id,description:reviews[r.id]?.description??r.description,state:status(r)}))}).slice(0,6400);
 const frames=[];if(ready&&videoBlob){
  const start=Number($('start').value),end=Number($('end').value);
  if(!$('start').value||!$('end').value||!(end>start)||start<0||end>video.duration)throw Error('先填写当前片段的有效起止时间。');
  if(end-start>30)throw Error('当前视觉分析请选不超过 30 秒的片段。比赛分析仍包含事件表摘要。');
  const v=document.createElement('video');v.muted=true;v.preload='auto';
  const wait=event=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{cleanup();reject(Error('录像抽帧超时'));},5000);const done=()=>{cleanup();resolve();},fail=()=>{cleanup();reject(Error('录像抽帧失败'));};function cleanup(){clearTimeout(timeout);v.removeEventListener(event,done);v.removeEventListener('error',fail);}v.addEventListener(event,done,{once:true});v.addEventListener('error',fail,{once:true});});
  try{const loaded=wait('loadeddata');v.src=videoBlob;await loaded;const canvas=document.createElement('canvas');canvas.width=512;canvas.height=Math.round(512*v.videoHeight/v.videoWidth);const ctx=canvas.getContext('2d');for(let i=0;i<4;i++){const t=start+(end-start)*(i+.5)/4;if(Math.abs(v.currentTime-t)>.001){const seeked=wait('seeked');v.currentTime=t;await seeked;}ctx.drawImage(v,0,0,canvas.width,canvas.height);frames.push({time:t,image:canvas.toDataURL('image/jpeg',.75)});}}finally{v.removeAttribute('src');v.load();}
 }
 if(version!==key||current!==selected||videoBlob!==blob)throw Error('材料已切换，请重新分析。');
 return {mode,context,frames};
}
