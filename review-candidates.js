export function captureReviewCandidates(scan,candidates){
  if(scan?.status!=='complete'||!Number.isFinite(scan.elapsedSeconds)||scan.elapsedSeconds<0)throw Error('扫描未完整结束');
  return {kind:'raw-scan-snapshot',runId:scan.runId,algorithm:scan.algorithm,videoSource:scan.videoSource,start:scan.start,end:scan.end,scanElapsedMs:scan.elapsedSeconds*1000,
    candidates:candidates.map(e=>({time:e.peakTime,label:'shot',result:'unknown',note:`机器候选：${e.source}`}))};
}
export function reviewCandidateProvenance(run,range,mode){
  if(mode==='manual')return {kind:'none',warning:null};
  if(!run)return {kind:'legacy-pending-only',warning:'仅载入现存待确认候选，可能经过人工筛选；请重新扫描后做严格对照'};
  const covered=run.start<=range.start&&run.end>=range.end;
  return {kind:run.kind,runId:run.runId,algorithm:run.algorithm,scanRange:{start:run.start,end:run.end},scanElapsedMs:run.scanElapsedMs,rangeCovered:covered,warning:covered?'扫描耗时为整次扫描实测，不包含扫描前手工标定等准备工作':'本任务超出原始扫描区间，部分录像没有机器候选覆盖'};
}
