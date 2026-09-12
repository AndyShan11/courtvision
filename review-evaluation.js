import {REVIEW_PROTOCOL,reviewEventIssues} from './review-protocol.js';
import {validateReviewEvent,reviewSummary,uncoveredReviewRanges} from './review-session.js';
// Fixed before evaluation; never adapt tolerance to improve the reported score.
export const REVIEW_MATCH_SECONDS=1;
export function reviewErrorRates(evaluation){
  const e=evaluation;
  return {missRate:e.referenceEvents?e.falseNegativeCount/e.referenceEvents:null,unmatchedPredictionRate:e.predictions?e.falsePositiveCount/e.predictions:null,resultErrorRate:e.resultChecked?(e.resultWrong+e.resultUnknown)/e.resultChecked:null,completeReference:e.exhaustiveClaim===true};
}
export function reviewErrorRateText(evaluation){
  const r=reviewErrorRates(evaluation),pct=x=>x===null?'无分母，未计算':`${(x*100).toFixed(1)}%`;
  const outside=Math.max(0,(evaluation.summary?.confirmed??evaluation.predictions)-evaluation.predictions);
  return `核验标签：${evaluation.scope?.join('、')??'未声明'}。漏标率（漏标/参考事件）${pct(r.missRate)}；未匹配标记占比（未匹配/范围内确认标记）${pct(r.unmatchedPredictionRate)}；结果错误率（错填+未知/已匹配且参考结果已知）${pct(r.resultErrorRate)}。${r.completeReference?'':'参考不完整，仅对已知参考计算，不能代表整段真实错误率。'}${outside?`另有${outside}条已确认事件不在参考标签范围内，未核验。`:''}`;
}
export function validateReviewReference(reference,session){
  if(reference.schemaVersion!==1||reference.protocol!==REVIEW_PROTOCOL.version)throw Error('参考答案协议版本不一致');
  if(reference.videoIdentity!==session.videoIdentity||reference.range?.start!==session.range.start||reference.range?.end!==session.range.end)throw Error('参考答案录像或区间不一致');
  if(!Array.isArray(reference.scope)||!reference.scope.length||new Set(reference.scope).size!==reference.scope.length||reference.scope.some(l=>!REVIEW_PROTOCOL.labels.some(d=>d.id===l)))throw Error('参考答案标签范围无效');
  if(!Array.isArray(reference.events)||reference.events.length>10000)throw Error('参考答案事件列表无效');
  if(new Set(reference.events.map(e=>`${e?.label}:${e?.time}`)).size!==reference.events.length)throw Error('参考答案包含同标签同时间的重复事件');
  if(typeof reference.exhaustive!=='boolean'||typeof reference.provenance!=='string'||!reference.provenance.trim())throw Error('参考答案缺少完整性声明或来源');
  for(const e of reference.events){validateReviewEvent(e,session.range);if(reviewEventIssues(e).length)throw Error('参考事件标签与结果矛盾');if(!reference.scope.includes(e.label))throw Error('参考事件超出声明标签范围');}
  return reference;
}
export function evaluateReview(session,reference){
  if(session.status!=='finished')throw Error('必须先结束并锁定任务，才能查看参考答案');
  validateReviewReference(reference,session);
  // Preserve original reference for reproducible export and re-evaluation.
  const referenceCopy=JSON.parse(JSON.stringify(reference));
  const predictions=session.events.filter(e=>e.status==='confirmed'&&reference.scope.includes(e.label));
  const pairs=[],falsePositives=[],falseNegatives=[],matchingAmbiguities=[];
  function noteMultipleCandidates(items,others,side){
    let left=0,right=0;
    for(const item of items){
      while(left<others.length&&others[left].time<item.time-REVIEW_MATCH_SECONDS)left++;
      while(right<others.length&&others[right].time<=item.time+REVIEW_MATCH_SECONDS)right++;
      if(right-left>1)matchingAmbiguities.push({side,time:item.time,label:item.label,candidates:right-left});
    }
  }
  for(const label of reference.scope){
    const p=predictions.filter(e=>e.label===label).sort((a,b)=>a.time-b.time);
    const g=reference.events.map((e,index)=>({...e,referenceIndex:index})).filter(e=>e.label===label).sort((a,b)=>a.time-b.time);
    noteMultipleCandidates(p,g,'prediction');noteMultipleCandidates(g,p,'reference');
    let i=0,j=0;
    while(i<p.length&&j<g.length){
      if(p[i].time<g[j].time-REVIEW_MATCH_SECONDS){falsePositives.push(p[i++]);}
      else if(g[j].time<p[i].time-REVIEW_MATCH_SECONDS){falseNegatives.push(g[j++]);}
      else{pairs.push({predictionId:p[i].id,referenceIndex:g[j].referenceIndex,errorSeconds:p[i].time-g[j].time,prediction:p[i++],reference:g[j++]});}
    }
    falsePositives.push(...p.slice(i));falseNegatives.push(...g.slice(j));
  }
  const checked=pairs.filter(p=>p.reference.result!=='unknown');
  const wrongResults=checked.filter(p=>p.prediction.result!=='unknown'&&p.prediction.result!==p.reference.result);
  const unknownResults=checked.filter(p=>p.prediction.result==='unknown');
  const tp=pairs.length,fp=falsePositives.length,fn=falseNegatives.length;
  const matchingWarnings=matchingAmbiguities.length?[`${matchingAmbiguities.length}个事件在±1秒内有多个时间匹配候选；当前按时间顺序配对，需回看核对，不代表标注必错。`]:[];
  return {matchingAmbiguities,reference:referenceCopy,protocol:REVIEW_PROTOCOL.version,toleranceSeconds:REVIEW_MATCH_SECONDS,scope:reference.scope,referenceProvenance:reference.provenance,referenceIndependence:'来源由导入者声明，系统未独立证实',exhaustiveClaim:reference.exhaustive,predictions:predictions.length,referenceEvents:reference.events.length,truePositives:tp,falsePositiveCount:fp,falseNegativeCount:fn,precision:predictions.length?tp/predictions.length:null,recall:reference.events.length?tp/reference.events.length:null,f1:2*tp+fp+fn?2*tp/(2*tp+fp+fn):null,resultChecked:checked.length,resultWrong:wrongResults.length,resultUnknown:unknownResults.length,resultErrorRate:checked.length?(wrongResults.length+unknownResults.length)/checked.length:null,pairs,falsePositives,falseNegatives,summary:reviewSummary(session),warnings:[...matchingWarnings,...(session.completionWarnings??[]),...(!reference.exhaustive?['参考答案不完整：未匹配标记只能称为未匹配，不能确定为误报；召回仅针对已知事件']:[])]};
}
export function reviewReportText(session,evaluation=null){
  const s=reviewSummary(session),pct=x=>x==null?'未计算':`${(x*100).toFixed(1)}%`;
  const lines=['# 篮球录像人工复核报告',`任务：${session.id}`,`模式：${session.mode==='manual'?'纯人工':'工具辅助'}；状态：${session.status==='finished'?'结果已锁定':'尚未结束'}`,`录像身份：${session.videoIdentity}`,`范围：${s.range.start}–${s.range.end}秒；协议：${session.protocol}`,'', '## 时间与检查范围',`候选审核：${(s.timingMs.review/1000).toFixed(1)}秒；全段补漏：${(s.timingMs.sweep/1000).toFixed(1)}秒；报告整理：${(s.timingMs.report/1000).toFixed(1)}秒。`,`主动工作合计：${(s.activeMs/1000).toFixed(1)}秒；墙钟：${(s.wallMs/1000).toFixed(1)}秒。`,`播放覆盖：${pct(s.coverageFraction)}；不能证明操作者全程注意。`,`确认：${s.confirmed}；待确认：${s.pending}；删除：${s.deleted}；人工新增：${s.manualAdditions}。`,'','## 交付事件'];
  for(const e of session.events.filter(e=>e.status==='confirmed').sort((a,b)=>a.time-b.time))lines.push(`- ${e.time.toFixed(3)}秒 | ${REVIEW_PROTOCOL.labels.find(l=>l.id===e.label).name} | ${e.result} | ${e.team||'球队未知'} / ${e.player||'球员未知'} | ${e.note||'无备注'}`);
  lines.push('','## 尚无补漏播放记录的区间');
  if(session.unmeasuredGapMs)lines.push(`注意：计时器出现${(session.unmeasuredGapMs/1000).toFixed(1)}秒长间隔，不能判断是否在工作，未计主动时间；请补充原因。`);
  const gaps=uncoveredReviewRanges(session);
  lines.push(...(gaps.length?gaps.map(r=>`- ${r.start.toFixed(3)}–${r.end.toFixed(3)}秒`):['无；播放记录完整仍不代表标注没有漏检。']));
  lines.push('','## 尚未确认的事件');
  const pending=session.events.filter(e=>e.status==='pending');
  lines.push(...(pending.length?pending.map(e=>`- ${e.time.toFixed(3)}秒 | ${e.label} | ${e.note||'待复核'}`):['无。']));
  lines.push('','## 独立答案核验');
  if(session.mode==='assisted')lines.push(`候选来源：${session.candidateProvenance?.kind??'未记录'}；${session.candidateProvenance?.warning??'来源独立性未知'}`,`原始整次扫描耗时：${Number.isFinite(session.candidateProvenance?.scanElapsedMs)?(session.candidateProvenance.scanElapsedMs/1000).toFixed(1)+'秒':'未记录'}（单列证据，不与登记等待重复相加）。`);
  lines.push(`录像身份：${session.mediaEvidence?.kind==='content-sha256'?'按文件内容SHA-256绑定；不代表录像来源或标注可信':'未核验文件内容，来源标识可能错配'}`,`打开工作台前身份准备耗时：${Number.isFinite(session.identityPreparationMs)?(session.identityPreparationMs/1000).toFixed(1)+'秒':'未记录'}（不包含在主动复核时间内）。`);
  if(session.trial){const t=session.trial;lines.push(`实验登记：操作者${t.operator}；对照组${t.pairId}；次序${t.order}；熟悉度${t.familiarity}；来源${t.performer}（均为声明）。`,`交付标准：${t.deliveryStandard}`,`任务开始前算法等待：${t.algorithmWaitMs===null?'未测，不能当作0':(t.algorithmWaitMs/1000).toFixed(1)+'秒（人工登记）'}。`);}
  if(!evaluation)lines.push('未导入参考答案，不能声称错误率或省时效果。');
  else lines.push(`参考来源：${evaluation.referenceProvenance}（独立性未经系统核实）。`,`事件时间匹配：±${evaluation.toleranceSeconds}秒，按标签一对一。`,`匹配${evaluation.truePositives}；未匹配标记${evaluation.falsePositiveCount}；漏标${evaluation.falseNegativeCount}。`,`精确率${pct(evaluation.precision)}；召回率${pct(evaluation.recall)}；F1 ${pct(evaluation.f1)}。`,`可核对结果${evaluation.resultChecked}项，错结果${evaluation.resultWrong}项，结果未知${evaluation.resultUnknown}项。`,...evaluation.warnings.map(w=>`注意：${w}`));
  lines.push('','## 教练复盘（人工填写）',`1. 观察到的主要问题：${session.report?.observation||'未填写'}`,`2. 支持该判断的事件时间：${session.report?.evidence||'未填写'}`,`3. 建议训练动作：${session.report?.training||'未填写'}`,`4. 下一场要核验的指标：${session.report?.followUp||'未填写'}`,'','限制：样本标注不是整场官方统计；没有独立真人对照试验，不生成总体省时结论。');
  if(evaluation)lines.push('',reviewErrorRateText(evaluation));
  return lines.join('\n');
}
