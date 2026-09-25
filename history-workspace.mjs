const $=id=>document.getElementById(id),el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
const statuses={candidate:'定位候选 · 待复核',ambiguous:'有歧义',unmatched:'未定位',outside:'观察范围外'};
const kinds={three:'三分',shot:'投篮',freethrow:'罚球',rebound:'篮板',turnover:'失误',steal:'抢断',block:'盖帽',foul:'犯规',substitution:'换人',timeout:'暂停',other:'其他',jumpball:'跳球',violation:'违例'};
const clock=s=>s.replace(/^PT(\d+)M([\d.]+)S$/,(_,m,s)=>`${m}:${String(Math.floor(+s)).padStart(2,'0')}`);
export function mountHistoryWorkspace(host){
 let data,active=false,ready=false,selected,stop=null,expected=null;
 const video=$('video'),selection=el('div','');selection.id='history-selection';selection.hidden=true;selection.style.padding='20px';
 const title=el('h3',''),evidence=el('p',''),windows=el('div',''),media=el('p','');windows.className='header-actions';windows.id='history-windows';media.id='history-media-status';media.setAttribute('role','status');selection.append(title,evidence,windows,media);document.querySelector('.video-panel').append(selection);
 const results=el('section','');results.id='history-results';results.className='panel';results.style.padding='20px';results.hidden=true;$('workspace').after(results);
 function close(){active=false;ready=false;expected=null;stop=null;video.pause();document.body.classList.remove('history-mode');$('history-events-panel').hidden=true;selection.hidden=true;results.hidden=true;}
 function select(row){selected=row;title.textContent=`Q${row.period} ${clock(row.clock)} · ${row.description}`;evidence.textContent=`${statuses[row.status]}。${row.reason}`;
 windows.replaceChildren(...[...row.candidates.map(c=>({...c,label:'候选'})),...row.reviewWindows.map(c=>({...c,label:'人工复核窗口'}))].map(c=>{const b=el('button',`${c.label} ${c.start.toFixed(1)}–${c.end.toFixed(1)}秒`);b.className='button ghost small';b.disabled=!ready;b.onclick=()=>{if(!active||!ready||video.src!==expected)return;video.pause();video.currentTime=c.start;stop=c.end;};return b;}));
 for(const b of $('history-events').children)b.setAttribute('aria-pressed',String(b.dataset.id===row.id));}
 function render(){const q=$('history-search').value.toLowerCase();const rows=data.benchmark.rows.filter(r=>(!$('history-status').value||r.status===$('history-status').value)&&(!$('history-kind').value||r.kind===$('history-kind').value)&&`${r.team} ${r.player} ${r.description}`.toLowerCase().includes(q));$('history-count').textContent=`${rows.length} / 699 条事件`;
 $('history-events').replaceChildren(...rows.map(r=>{const b=el('button',`Q${r.period} ${clock(r.clock)} · ${r.description}`);b.className='history-event';b.dataset.id=r.id;b.append(el('small',statuses[r.status]));b.onclick=()=>select(r);return b;}));}
 function open(){if(!data)return;host.prepare();active=true;document.body.classList.add('history-mode');$('history-events-panel').hidden=false;selection.hidden=false;results.hidden=false;$('videoTitle').textContent=data.benchmark.title;$('videoMeta').textContent='168.8分钟 · 已保存结果 · 原片未公开托管';media.textContent='NBA原片未公开托管。使用原播放器的“选择本地录像”连接同一实验原片；文件不上传。';render();select(data.benchmark.rows.find(r=>r.id===new URLSearchParams(location.search).get('event'))??data.benchmark.rows.find(r=>r.status==='candidate'));}
 async function connect(file){ready=false;stop=null;expected=null;host.clearVideo();select(selected);if(file.size!==data.benchmark.sourceBytes){media.textContent='文件大小不匹配，已拒绝套用时间点。请选择当时使用的同一原片。';return;}media.textContent='正在本机连接原片…';expected=URL.createObjectURL(file);await host.attach(expected,file);}
 video.addEventListener('loadedmetadata',()=>{if(!active||video.src!==expected)return;ready=Math.abs(video.duration-data.benchmark.duration)<1;media.textContent=ready?'已连接本机原片，未上传。大小和时长匹配，但未做内容哈希验证，请核对录像版本。':'时长不符，已禁用事件跳转。';select(selected);});
 video.addEventListener('timeupdate',()=>{if(active&&stop!==null&&video.currentTime>=stop){video.pause();stop=null;}});
 video.addEventListener('error',()=>{if(active){ready=false;media.textContent='此录像无法播放，已保存结果仍可查看。';select(selected);}});
 $('history-status').onchange=render;$('history-kind').onchange=render;$('history-search').oninput=render;
 fetch('./history-data.json').then(r=>{if(!r.ok)throw Error('历史记录加载失败');return r.json();}).then(d=>{data=d;$('history-load-status').textContent='已保存的真实实验结果，不是云端重新推理。';for(const k of new Set(d.benchmark.rows.map(r=>r.kind)))$('history-kind').append(new Option(kinds[k]??k,k));
 results.append(el('h2','这次实验与后续质量检查'),el('p',d.notice),el('h3','号码识别'),el('p',d.numbers.note));for(const [key,name] of [['oldNumber','旧模型'],['prediction','篮球专训模型'],['gatedPrediction','篮球模型＋过滤']]){const m=d.numbers.metrics[key];results.append(el('p',`${name}：可读号码答对 ${m.readableCorrect}/${m.readable}；负样本误报 ${m.negativeFalseReads}/${m.negative}。`));}results.append(el('h3','战术实验：未通过验收'),el('p',d.tactics.note));for(const [key,name] of [['lowConfidence','低分检测'],['higherFps','提高帧率'],['crossGame','另一场比赛']]){const [a,b]=d.tactics[key];results.append(el('p',`${name}：身份关系正确 ${a.correct}/${a.total} → ${b.correct}/${b.total}；缺失 ${a.missing} → ${b.missing}。`));}const download=el('a','下载已保存结果 JSON');download.href='./history-data.json';download.download='history-data.json';results.append(download);
 if(host.canAutoOpen())open();
 }).catch(e=>{$('history-load-status').textContent=e.message;});
 return {get active(){return active;},close,connect};
}
