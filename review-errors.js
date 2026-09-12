export function reviewErrorEvidence(evaluation){
  if(!evaluation)return [];
  const rows=[];
  for(const e of evaluation.matchingAmbiguities??[])rows.push({kind:'ambiguous',title:`时间匹配待核对：${e.side==='prediction'?'标记':'参考'}有${e.candidates}个候选`,time:e.time,label:e.label});
  for(const e of evaluation.falseNegatives)rows.push({kind:'miss',title:'漏标（参考事件）',time:e.time,label:e.label});
  for(const e of evaluation.falsePositives)rows.push({kind:'unmatched',title:'未匹配标记',time:e.time,label:e.label});
  for(const pair of evaluation.pairs)if(pair.reference.result!=='unknown'&&pair.prediction.result!==pair.reference.result)rows.push({kind:'result',title:`结果核对：${pair.prediction.result} → ${pair.reference.result}`,time:pair.prediction.time,referenceTime:pair.reference.time,label:pair.prediction.label});
  return rows.sort((a,b)=>a.time-b.time||a.kind.localeCompare(b.kind));
}
