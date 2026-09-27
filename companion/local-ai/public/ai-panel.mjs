const $=id=>document.getElementById(id);
const allowed=['https://andyshan11.github.io','http://127.0.0.1:4183'];
let origin;
let pending=null,timer;
$('run').disabled=!origin;
if(!origin)$('state').textContent='请从篮球网站内打开此面板。';
addEventListener('message',e=>{if(e.source===parent&&allowed.includes(e.origin)&&e.data?.type==='courtvision-ai-init'){origin=e.origin;$('run').disabled=false;$('state').textContent='选择右侧事件；球员分析以该事件球员为对象。';}});
$('run').onclick=()=>{pending=crypto.randomUUID();$('run').disabled=true;$('result').textContent='';$('state').textContent='正在提取本机材料…';parent.postMessage({type:'courtvision-ai-context',id:pending,mode:$('mode').value},origin);timer=setTimeout(()=>{pending=null;$('run').disabled=false;$('state').textContent='材料提取超时，请重试。';},25000);};
addEventListener('message',async e=>{
 if(e.source!==parent||e.origin!==origin||!pending||e.data?.id!==pending||e.data.type!=='courtvision-ai-data')return;
 clearTimeout(timer);pending=null;
 try{
  if(e.data.error)throw Error(e.data.error);
  let material;try{const c=JSON.parse(e.data.payload.context);material=`${c.scope} · ${c.eventCount} 条事件 · 当前事件 ${c.current.id}：${c.current.description}`;}catch{material='当前提交的材料';}
  $('state').textContent=material+'\nQwen3.5 正在本机分析，最多等待 3 分钟…';
  const {token}=await(await fetch('/session')).json();
  const r=await fetch('/analyze',{method:'POST',headers:{'Content-Type':'application/json','X-Courtvision-Token':token},body:JSON.stringify(e.data.payload),signal:AbortSignal.timeout(190000)}),out=await r.json();
  if(!r.ok)throw Error(out.error||'分析失败');
  $('result').textContent='AI 草稿：模型可能错认动作、号码和身份，不作为正式技术统计。\n\n'+out.text;$('state').textContent=`${material}\n${out.model} · 本次读取 ${out.frames} 帧 · AI 结论待人工核实${out.truncated?' · 输出达到长度上限，可能不完整':''}`;
 }catch(e){$('state').textContent=e.message;}finally{$('run').disabled=false;}
});
