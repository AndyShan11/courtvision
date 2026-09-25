const root=document.getElementById('local-engine');
const frame=document.getElementById('local-engine-frame');
const state=document.getElementById('local-engine-status');
let timer;
function mode(local){
 document.body.classList.toggle('local-engine-active',local);
 document.getElementById('engine-public').setAttribute('aria-pressed',String(!local));
 document.getElementById('engine-local').setAttribute('aria-pressed',String(local));
 root.hidden=!local;
 if(!local)frame.contentWindow?.postMessage({type:'courtvision-pause'},'http://127.0.0.1:4183');
 if(local)location.hash='workspace';
}
document.getElementById('engine-public').onclick=()=>mode(false);
document.getElementById('engine-local').onclick=()=>mode(true);
window.addEventListener('hashchange',()=>{if(location.hash!=='#workspace')frame.contentWindow?.postMessage({type:'courtvision-pause'},'http://127.0.0.1:4183');});
document.getElementById('local-engine-connect').onclick=()=>{
 state.textContent='正在连接本机服务。如浏览器询问本地网络权限，请选择允许。';
 frame.hidden=false;
 frame.src='http://127.0.0.1:4183/alignment.html?embedded=1';
 clearTimeout(timer);timer=setTimeout(()=>{state.textContent='尚未连接。请先启动电脑上的分析服务，再点“连接／重试”；若已启动，请检查浏览器的本地网络权限。';},12000);
};
window.addEventListener('message',e=>{
 if(e.origin!=='http://127.0.0.1:4183'||e.source!==frame.contentWindow||e.data?.type!=='courtvision-local')return;
 if(Number.isFinite(e.data.height))frame.style.height=`${Math.max(600,Math.min(12000,e.data.height+20))}px`;
 if(e.data.state==='ready'){clearTimeout(timer);state.textContent='已连接本机分析。录像和计算留在这台电脑；下方可选择历史分析，或点击“新建分析”。';}
});
