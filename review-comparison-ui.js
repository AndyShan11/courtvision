import {compareReviewTrials} from './review-comparison.js';
import {reviewErrorRateText} from './review-evaluation.js';
export function comparisonText(result){
  const seconds=v=>v===null?'未测':`${(v/1000).toFixed(1)}秒`;
  const lines=['纯人工／工具辅助对照（单组描述）'];
  for(const [name,r] of [['纯人工',result.manual],['工具辅助',result.assisted]]){
    lines.push(`\n${name}：${r.session.id}`,`审核 ${seconds(r.summary.timingMs.review)}；补漏 ${seconds(r.summary.timingMs.sweep)}；报告 ${seconds(r.summary.timingMs.report)}`,`主动合计 ${seconds(r.summary.activeMs)}；任务墙钟 ${seconds(r.summary.wallMs)}；任务前算法等待 ${seconds(r.trial.algorithmWaitMs)}`);
    const e=r.evaluation;
    lines.push(e?`匹配 ${e.truePositives}；未匹配标记 ${e.falsePositiveCount}；漏标 ${e.falseNegativeCount}；已匹配项结果错误 ${e.resultWrong}，未知 ${e.resultUnknown}`:'没有参考答案，错误率未知');
    if(e)lines.push(reviewErrorRateText(e));
  }
  lines.push(`\n主动时间差（人工−辅助）：${seconds(result.activeDifferenceMs)}`,`辅助主动时间＋任务前等待：${seconds(result.assistedActivePlusPreWaitMs)}（不是总墙钟时间）`,result.interpretation,...result.reasons.map(r=>`注意：${r}`));
  lines.push(`身份准备耗时另列：人工 ${seconds(result.identityPreparationMs.manual)}；辅助 ${seconds(result.identityPreparationMs.assisted)}。不包含在上述主动合计。`);
  return lines.join('\n');
}
export function mountReviewComparison(parent){
  const section=document.createElement('details');
  section.innerHTML='<summary>导入两份任务，对比时间与错误</summary><p>先结束当前任务再查看对照，避免答案泄漏。选择一份纯人工、一份辅助任务的导出JSON；文件仅在本机处理。</p><input type="file" accept=".json,application/json" multiple><button disabled>导出对比报告</button><pre role="status">尚未导入</pre>';
  parent.append(section);
  const input=section.querySelector('input'),button=section.querySelector('button'),output=section.querySelector('pre');let report=null,revision=0;
  input.onchange=async()=>{
    const current=++revision;report=null;button.disabled=true;output.textContent='检查中…';
    try{
      // Current-task gate supplied by the workbench via DOM state; no task data exposed.
      if(!parent.querySelector('[data-finish]').disabled)throw Error('请先结束当前复核任务，防止查看答案影响盲测');
      const files=[...input.files];if(files.length!==2)throw Error('请一次选择两份任务文件');
      const bundles=[];
      for(const file of files){
        if(file.size>8*1024*1024)throw Error('每份任务文件不得超过8MB');
        const bundle=JSON.parse(await file.text());
        if(!bundle.session||typeof bundle.lockSha256!=='string')throw Error('文件缺少任务或锁定摘要');
        const bytes=new TextEncoder().encode(JSON.stringify(bundle.session));
        const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(b=>b.toString(16).padStart(2,'0')).join('');
        if(hash!==bundle.lockSha256)throw Error('任务摘要不匹配，无法比较');
        bundles.push(bundle);
      }
      if(current!==revision)return;
      if(!parent.querySelector('[data-finish]').disabled)throw Error('已开始新任务，对照结果不显示');
      report=comparisonText(compareReviewTrials(...bundles));output.textContent=report;button.disabled=false;
    }catch(error){if(current===revision)output.textContent=error.message;}
    finally{if(current===revision)input.value='';}
  };
  button.onclick=()=>{if(!report)return;const url=URL.createObjectURL(new Blob([report],{type:'text/plain;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='review-comparison.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return {clear(){revision++;report=null;output.textContent='尚未导入';button.disabled=true;input.value='';}};
}
