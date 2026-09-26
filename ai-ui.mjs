import {aiContext} from './workspace.mjs';
const origin='http://127.0.0.1:4191';let frame;
document.getElementById('ai-connect').onclick=()=>{
 frame?.remove();frame=document.createElement('iframe');frame.title='本机 Qwen3.5 球员与比赛分析';frame.src=origin+'/';frame.style.cssText='width:100%;height:480px;border:1px solid #303339;border-radius:6px;margin-top:12px';
 frame.onload=()=>frame.contentWindow.postMessage({type:'courtvision-ai-init'},origin);
 document.getElementById('ai-container').append(frame);
 document.getElementById('ai-connection').textContent='若下方无法连接，请先运行本机启动程序，并允许浏览器的本地网络访问。其他人的电脑也需要安装模型，GitHub 不运行模型。';
};
addEventListener('message',async e=>{
 if(!frame||e.source!==frame.contentWindow||e.origin!==origin||e.data?.type!=='courtvision-ai-context'||typeof e.data.id!=='string'||!['player','game'].includes(e.data.mode))return;
 const target=e.source,id=e.data.id;
 try{const payload=await aiContext(e.data.mode);target.postMessage({type:'courtvision-ai-data',id,payload},origin);}catch(error){target.postMessage({type:'courtvision-ai-data',id,error:error.message},origin);}
});
