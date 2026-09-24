const $=id=>document.getElementById(id);
const el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
const labels={candidate:'定位候选 · 待复核',ambiguous:'有歧义',unmatched:'未定位',outside:'观察范围外'};
const kinds={three:'三分',shot:'投篮',freethrow:'罚球',rebound:'篮板',turnover:'失误',steal:'抢断',block:'盖帽',assist:'助攻',foul:'犯规',substitution:'换人',timeout:'暂停',violation:'违例',jumpball:'跳球',other:'其他'};
const time=s=>`${Math.floor(s/60)}:${(s%60).toFixed(1).padStart(4,'0')}`;
const clock=value=>value.replace(/^PT(\d+)M([\d.]+)S$/,(_,m,s)=>`${m}:${String(Math.floor(Number(s))).padStart(2,'0')}`);
const video=$('video');let active=null,stop=null,blobUrl=null,ready=false;
video.addEventListener('timeupdate',()=>{if(stop!==null&&video.currentTime>=stop){video.pause();stop=null;}});
function select(row){active=row;$('selection').textContent=`Q${row.period} ${clock(row.clock)} · ${row.description}`;$('evidence').textContent=`${labels[row.status]}。${row.reason}`;
  $('windows').replaceChildren(...[...row.candidates.map(c=>({...c,label:'定位候选'})),...row.reviewWindows.map(c=>({...c,label:'人工复核窗口'}))].map(c=>{const b=el('button',`${c.label} ${time(c.start)}–${time(c.end)}`);b.disabled=!ready;b.onclick=()=>{video.pause();video.currentTime=c.start;stop=c.end;};return b;}));
  for(const b of $('events').children)b.setAttribute('aria-pressed',String(b.dataset.id===row.id));
}
try{
 const r=await fetch('./history-data.json');if(!r.ok)throw Error('历史结果读取失败，请稍后刷新');const data=await r.json(),game=data.benchmark;
 $('notice').textContent=data.notice;$('game-title').textContent=game.title;
 for(const [label,value] of [['录像长度',`${(game.duration/60).toFixed(1)} 分钟`],['输入事件',game.eventCount],['定位候选',game.counts.candidate],['有歧义',game.counts.ambiguous]]){const n=el('div','');n.className='metric';n.append(el('span',label),el('strong',value));$('metrics').append(n);}
 for(const kind of [...new Set(game.rows.map(r=>r.kind))])$('kind').append(new Option(kinds[kind]??kind,kind));
 function render(){const q=$('search').value.toLowerCase();const rows=game.rows.filter(r=>(!$('status').value||r.status===$('status').value)&&(!$('kind').value||r.kind===$('kind').value)&&`${r.player} ${r.team} ${r.description}`.toLowerCase().includes(q));$('count').textContent=`${rows.length} / ${game.rows.length} 条事件`;
 $('events').replaceChildren(...rows.map(r=>{const b=el('button',`Q${r.period} · ${clock(r.clock)} · ${kinds[r.kind]??r.kind}`);b.className='event';b.dataset.id=r.id;b.setAttribute('aria-pressed',String(active?.id===r.id));b.append(el('small',r.description),el('small',labels[r.status]));b.onclick=()=>select(r);return b;}));}
 $('status').onchange=render;$('kind').onchange=render;$('search').oninput=render;render();
 const initial=game.rows.find(r=>r.id===new URLSearchParams(location.search).get('event'))??game.rows.find(r=>r.status==='candidate');if(initial)select(initial);
 $('local-video').onchange=()=>{ready=false;video.pause();stop=null;if(blobUrl)URL.revokeObjectURL(blobUrl);video.removeAttribute('src');video.hidden=true;if(active)select(active);const f=$('local-video').files[0];if(!f)return;
  if(f.size!==game.sourceBytes){$('media-status').textContent='文件大小与实验原片不一致，已拒绝套用时间点。请使用当时的同一录像版本。';return;}
  blobUrl=URL.createObjectURL(f);video.onloadedmetadata=()=>{if(Math.abs(video.duration-game.duration)>1){$('media-status').textContent='录像时长不匹配，不能套用时间点。';return;}ready=true;video.hidden=false;$('media-status').textContent='已在本机连接录像，未上传。大小和时长匹配，但未做内容哈希验证；请核对比赛及剪辑版本。';if(active)select(active);};video.onerror=()=>{$('media-status').textContent='浏览器无法解码此录像。分析记录仍可查看。';};video.src=blobUrl;
 };
 for(const t of game.box){$('box').append(el('h3',t.team));const table=el('table','');const head=el('tr','');for(const x of ['指标','事件表','技术统计','差值'])head.append(el('th',x));table.append(head);for(const m of t.metrics){const row=el('tr','');for(const x of [m.metric,m.pbp,m.box,m.difference])row.append(el('td',x));table.append(row);}$('box').append(table);}
 $('number-note').textContent=data.numbers.note;
 for(const [key,name] of [['oldNumber','旧号码模型'],['prediction','篮球专训模型'],['gatedPrediction','篮球模型＋过滤']]){const m=data.numbers.metrics[key],row=el('tr','');for(const x of [name,`${m.readableCorrect} / ${m.readable}`,`${m.negativeFalseReads} / ${m.negative}`])row.append(el('td',x));$('number-metrics').append(row);}
 for(const s of data.numbers.segments)$('number-segments').append(el('p',`${s.source} · ${s.start}–${s.end}秒 · ${s.tracks}条检测轨迹（不是已确认球员）`));
 $('tactic-note').textContent=data.tactics.note;
 for(const [key,title] of [['lowConfidence','加入低分检测'],['higherFps','8帧 → 24帧'],['crossGame','另一场比赛回归']]){const [a,b]=data.tactics[key],card=el('article','');card.className='card';card.append(el('h3',title),el('p',`身份关系正确：${a.correct}/${a.total} → ${b.correct}/${b.total}`),el('p',`缺失：${a.missing} → ${b.missing}`));$('tactic-metrics').append(card);}
}catch(e){$('error').textContent=e.message;$('notice').textContent='历史记录加载失败，请刷新或返回工作台。';}
