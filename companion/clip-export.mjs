// Browser-only, real-time export. No original video is sent to a server.
export async function exportClip({video,start,end,title,signal,onProgress}){
 if(typeof MediaRecorder==='undefined'||!HTMLCanvasElement.prototype.captureStream)throw Error('此浏览器无法导出视频，请使用新版 Chrome 或 Edge。');
 if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end>video.duration||end<=start||end-start>60)throw Error('先设置一个不超过 60 秒的有效片段。');
 const mime=['video/webm;codecs=vp8','video/webm;codecs=vp9','video/webm'].find(x=>MediaRecorder.isTypeSupported(x));if(!mime)throw Error('此浏览器不支持 WebM 导出。');
 const canvas=document.createElement('canvas');canvas.width=Math.min(960,video.videoWidth);canvas.height=Math.round(canvas.width/video.videoWidth*video.videoHeight);const ctx=canvas.getContext('2d');canvas.setAttribute('aria-label','正在导出的片段预览');canvas.style.cssText='position:fixed;right:20px;bottom:100px;width:240px;max-width:65vw;z-index:40;border:3px solid #e8e1f3;border-radius:8px;box-shadow:0 8px 30px #0003';document.body.append(canvas);
 const original={time:video.currentTime,rate:video.playbackRate,muted:video.muted};video.pause();video.playbackRate=1;video.muted=true;
 let animation,stream,recorder,timeout;const chunks=[];
 const waitSeek=()=>new Promise((resolve,reject)=>{let t;const cleanup=()=>{clearTimeout(t);video.removeEventListener('seeked',done);video.removeEventListener('error',fail);signal.removeEventListener('abort',abort);};const done=()=>{cleanup();resolve();},fail=()=>{cleanup();reject(Error('无法读取片段画面。'));},abort=()=>{cleanup();reject(Error('已取消视频导出。'));};if(signal.aborted){abort();return;}t=setTimeout(()=>{cleanup();reject(Error('读取片段超时。'));},10000);video.addEventListener('seeked',done,{once:true});video.addEventListener('error',fail,{once:true});signal.addEventListener('abort',abort,{once:true});video.currentTime=start;if(Math.abs(video.currentTime-start)<.001&&!video.seeking)done();});
 try{
  await waitSeek();
  const draw=()=>{ctx.drawImage(video,0,0,canvas.width,canvas.height);const h=Math.max(32,Math.round(canvas.height*.1));ctx.fillStyle='#233b31d9';ctx.fillRect(0,canvas.height-h,canvas.width,h);ctx.fillStyle='#fffdf4';ctx.font=`${Math.max(12,Math.round(h*.34))}px sans-serif`;ctx.fillText(title.slice(0,40),16,canvas.height-h*.37);};draw();stream=canvas.captureStream(0);recorder=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:2000000});
  const blob=await new Promise((resolve,reject)=>{
   let failure,finished=false;
   const finish=err=>{if(finished)return;finished=true;failure=err;cancelAnimationFrame(animation);video.pause();signal.removeEventListener('abort',abort);if(recorder.state!=='inactive')recorder.stop();else reject(err||Error('视频导出未启动。'));};
   const abort=()=>finish(Error('已取消视频导出。'));signal.addEventListener('abort',abort,{once:true});
   recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};recorder.onerror=()=>finish(Error('浏览器编码失败，请缩短片段后重试。'));
   recorder.onstop=()=>failure?reject(failure):resolve(new Blob(chunks,{type:'video/webm'}));
   let lastFrame=0;const loop=now=>{try{if(now-lastFrame>=32){draw();stream.getVideoTracks()[0].requestFrame();lastFrame=now;}onProgress(Math.min(1,(video.currentTime-start)/(end-start)));if(video.currentTime>=end||video.ended){video.pause();setTimeout(()=>finish(),180);return;}animation=requestAnimationFrame(loop);}catch{finish(Error('无法读取录像画面，请使用本地视频。'));}};
   timeout=setTimeout(()=>finish(Error('导出超时，请保持页面在前台并重试。')),(end-start)*2000+15000);
   recorder.start(250);video.play().then(()=>{animation=requestAnimationFrame(loop);}).catch(()=>finish(Error('无法播放这一片段。')));
  });if(blob.size<500)throw Error('导出文件为空，请重试。');return blob;
 }finally{clearTimeout(timeout);cancelAnimationFrame(animation);stream?.getTracks().forEach(t=>t.stop());canvas.remove();video.pause();video.playbackRate=original.rate;video.muted=original.muted;if(Number.isFinite(video.duration))video.currentTime=Math.min(original.time,video.duration);}
}
