const $=id=>document.getElementById(id),allowed=['https://andyshan11.github.io','http://127.0.0.1:4189'];let origin,pending,timer;
addEventListener('message',async e=>{
 if(e.source!==parent)return;
 if(e.data?.type==='basketball-coach-init'&&allowed.includes(e.origin)){origin=e.origin;$('generate').disabled=false;$('status').textContent='已连接。生成前请确认训练档案与记录是你希望分享给本机助手的内容。';parent.postMessage({type:'basketball-coach-ready'},origin);return;}
 if(e.origin!==origin||e.data?.type!=='basketball-coach-data'||!pending||e.data.id!==pending)return;
 pending=null;clearTimeout(timer);
 try{
  if(typeof e.data.context!=='string')throw Error('无法读取训练摘要');
  const context=JSON.parse(e.data.context);$('status').textContent=`已读取 ${context.observations.length} 条观察、${context.sessions.length} 次练习。本机模型生成中…`;
  const {token}=await(await fetch('/session')).json();const response=await fetch('/coach-plan',{method:'POST',headers:{'Content-Type':'application/json','X-Courtvision-Token':token},body:JSON.stringify({context:e.data.context}),signal:AbortSignal.timeout(190000)});const result=await response.json();if(!response.ok)throw Error(result.error||'生成失败');$('result').textContent=result.text;$('status').textContent=result.model+' · 建议草稿，请核实'+(result.truncated?' · 输出可能未完整':'');$('copy').hidden=false;
 }catch(err){$('status').textContent=err.name==='TimeoutError'?'生成超时，请稍后重试。':err.message;}finally{$('generate').disabled=false;}
});
$('generate').onclick=()=>{if(!origin)return;pending=crypto.randomUUID();$('generate').disabled=true;$('copy').hidden=true;$('result').textContent='';$('status').textContent='正在读取你的训练摘要…';parent.postMessage({type:'basketball-coach-context',id:pending},origin);timer=setTimeout(()=>{pending=null;$('generate').disabled=false;$('status').textContent='训练摘要读取超时，请重新连接。';},15000);};
$('copy').onclick=async()=>{try{await navigator.clipboard.writeText($('result').textContent);$('status').textContent='建议已复制，可与教练一起核对。';}catch{$('status').textContent='浏览器不允许复制，请直接选中文字复制。';}};
