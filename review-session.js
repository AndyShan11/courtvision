import {REVIEW_PROTOCOL} from './review-protocol.js';
const clone=x=>JSON.parse(JSON.stringify(x));
const finite=(v,label)=>{if(!Number.isFinite(v))throw Error(`无效${label}`);return v;};
export function validateReviewEvent(event,range){
  if(!event||typeof event!=='object')throw Error('事件格式无效');
  if(!REVIEW_PROTOCOL.labels.some(l=>l.id===event.label))throw Error('未知事件类型');
  if(!REVIEW_PROTOCOL.results.includes(event.result))throw Error('未知事件结果');
  finite(event.time,'事件时间');
  if(event.time<range.start||event.time>=range.end)throw Error('事件不在任务区间');
  for(const [field,limit] of [['team',60],['player',60],['note',500]])if(event[field]!==undefined&&(typeof event[field]!=='string'||event[field].length>limit))throw Error(`事件${field}格式无效或过长`);
  return clone(event);
}
export function createReviewSession({id,mode,videoIdentity,start,end,candidates=[]},now){
  finite(now,'时钟');finite(start,'开始');finite(end,'结束');
  if(!id||!videoIdentity||!['manual','assisted'].includes(mode)||start<0||end<=start)throw Error('无效复核任务');
  const range={start,end},events=mode==='manual'?[]:candidates.map((c,i)=>({...validateReviewEvent(c,range),id:`candidate-${i}`,origin:'candidate',status:'pending'}));
  return {schemaVersion:1,protocol:REVIEW_PROTOCOL.version,id,mode,videoIdentity,range,events,createdAt:now,lastTick:now,phase:mode==='manual'?'sweep':'review',paused:false,status:'active',timing:{review:0,sweep:0,report:0},audit:[],undo:[],coverage:[]};
}
export function tickReview(session,now,{visible=true}={}){
  finite(now,'时钟');if(now<session.lastTick)throw Error('时钟倒退');
  if(session.status==='finished')return clone(session);
  const next=clone(session),delta=now-session.lastTick;
  // Long gaps indicate suspension; never silently charge them as active work.
  if(next.status==='active'&&!next.paused&&visible&&delta<=5000)next.timing[next.phase]+=delta;
  next.lastTick=now;return next;
}
export function changeReviewPhase(session,phase,now){
  if(session.status!=='active')throw Error('任务已结束');
  if(!['review','sweep','report'].includes(phase))throw Error('未知阶段');
  if(session.mode==='manual'&&phase==='review')throw Error('纯人工任务没有候选审核阶段');
  const next=tickReview(session,now);next.phase=phase;next.audit.push({action:'phase',phase,at:now});return next;
}
export function reviewAction(session,action,now){
  if(session.status!=='active')throw Error('任务已结束');
  if(session.paused)throw Error('请先继续计时，再修改事件');
  const next=tickReview(session,now);
  if(action.type==='undo'){
    const previous=next.undo.pop();if(!previous)throw Error('没有可撤销操作');
    if(Array.isArray(previous))next.events=previous; // Preserve legacy snapshot undo.
    else if(previous.kind==='remove'){
      const index=next.events.findIndex(e=>e.id===previous.id);if(index<0)throw Error('撤销目标不存在');next.events.splice(index,1);
    }else if(previous.kind==='restore'){
      const index=next.events.findIndex(e=>e.id===previous.event?.id);if(index<0)throw Error('撤销目标不存在');
      next.events[index]=validateReviewEvent(previous.event,next.range);
    }else throw Error('撤销记录无效');
  }else{
    const i=next.events.findIndex(e=>e.id===action.id);
    if(action.type==='add'){
      if(!action.id||i>=0)throw Error('事件编号重复或缺失');
      next.events.push({...validateReviewEvent(action.event,next.range),id:action.id,origin:'manual',status:'confirmed'});
      next.undo.push({kind:'remove',id:action.id});
    }else{
      if(i<0)throw Error('事件不存在');
      const previous=clone(next.events[i]);
      if(action.type==='confirm')next.events[i].status='confirmed';
      else if(action.type==='delete')next.events[i].status='deleted';
      else if(action.type==='edit')next.events[i]={...next.events[i],...validateReviewEvent({...next.events[i],...action.changes},next.range),id:next.events[i].id,origin:next.events[i].origin,status:'confirmed'};
      else throw Error('未知复核操作');
      next.undo.push({kind:'restore',event:previous});
    }
  }
  next.audit.push({action:clone(action),at:now,phase:next.phase});return next;
}
export function addReviewCoverage(session,start,end){
  if(session.status!=='active')throw Error('任务已结束');
  finite(start,'播放开始');finite(end,'播放结束');
  if(end<=start||start<session.range.start||end>session.range.end)throw Error('无效播放覆盖');
  const next=clone(session),ranges=[...next.coverage,{start,end}].sort((a,b)=>a.start-b.start),merged=[];
  for(const r of ranges){const last=merged.at(-1);if(last&&r.start<=last.end+1e-6)last.end=Math.max(last.end,r.end);else merged.push({...r});}
  next.coverage=merged;return next;
}
export function reviewSummary(session){
  const covered=session.coverage.reduce((s,r)=>s+r.end-r.start,0),duration=session.range.end-session.range.start;
  return {mode:session.mode,range:session.range,timingMs:clone(session.timing),activeMs:Object.values(session.timing).reduce((a,b)=>a+b,0),wallMs:(session.completedAt??session.lastTick)-session.createdAt,coverageSeconds:covered,coverageFraction:covered/duration,pending:session.events.filter(e=>e.status==='pending').length,confirmed:session.events.filter(e=>e.status==='confirmed').length,deleted:session.events.filter(e=>e.status==='deleted').length,manualAdditions:session.events.filter(e=>e.origin==='manual'&&e.status==='confirmed').length,accuracy:null,accuracyNote:'未导入独立参考答案；不能以确认率代替准确率'};
}
export function uncoveredReviewRanges(session){
  const gaps=[];let cursor=session.range.start;
  for(const r of session.coverage){if(r.start>cursor)gaps.push({start:cursor,end:r.start});cursor=Math.max(cursor,r.end);}
  if(cursor<session.range.end)gaps.push({start:cursor,end:session.range.end});
  return gaps;
}
export function finishReview(session,now){
  if(session.status!=='active')throw Error('任务已结束');
  const next=tickReview(session,now),summary=reviewSummary(next);
  next.status='finished';next.paused=true;next.completedAt=now;
  next.completionWarnings=[];
  if(summary.pending)next.completionWarnings.push(`还有${summary.pending}条待确认`);
  if(summary.coverageFraction<.99)next.completionWarnings.push('全段补漏播放覆盖不足99%');
  if(!reviewReportComplete(next))next.completionWarnings.push('教练报告四项尚未填写完整');
  next.audit.push({action:'finish',at:now,warnings:[...next.completionWarnings]});return next;
}
export function updateReviewReport(session,field,value,now){
  if(session.status!=='active')throw Error('任务已结束');
  if(session.paused)throw Error('请先继续计时，再填写报告');
  if(!['observation','evidence','training','followUp'].includes(field)||typeof value!=='string'||value.length>3000)throw Error('报告字段无效或超过3000字');
  const next=tickReview(session,now);
  next.report={...(next.report??{}),[field]:value};
  next.audit.push({action:'report-edit',field,at:now});return next;
}
export function reviewReportComplete(session){return ['observation','evidence','training','followUp'].every(field=>typeof session.report?.[field]==='string'&&session.report[field].trim().length>0);}
export function validateStoredReview(s,videoIdentity){
  if(!s||s.schemaVersion!==1||s.protocol!==REVIEW_PROTOCOL.version||s.videoIdentity!==videoIdentity||!['manual','assisted'].includes(s.mode)||!['active','finished'].includes(s.status)||!['review','sweep','report'].includes(s.phase)||typeof s.paused!=='boolean'||typeof s.id!=='string'||!s.id)throw Error('保存的复核任务格式不兼容');
  if(!s.range||!Number.isFinite(s.range.start)||!Number.isFinite(s.range.end)||s.range.start<0||s.range.end<=s.range.start)throw Error('保存的任务区间无效');
  if(s.mediaEvidence?.kind==='content-sha256'&&(!/^[a-f0-9]{64}$/.test(s.mediaEvidence.sha256)||s.videoIdentity!==`sha256:${s.mediaEvidence.sha256}`||!Number.isSafeInteger(s.mediaEvidence.bytes)||s.mediaEvidence.bytes<0))throw Error('保存的录像指纹无效');
  if(s.identityPreparationMs!==undefined&&(!Number.isFinite(s.identityPreparationMs)||s.identityPreparationMs<0))throw Error('身份准备时间无效');
  if(s.mode==='manual'&&(s.phase==='review'||s.timing?.review!==0||s.events?.some(e=>e.origin==='candidate')))throw Error('纯人工任务包含机器审核记录');
  if(!Array.isArray(s.events)||s.events.length>10000||new Set(s.events.map(e=>e.id)).size!==s.events.length||!Array.isArray(s.audit)||!Array.isArray(s.undo)||!Array.isArray(s.coverage))throw Error('保存的任务记录无效');
  const checkEvent=e=>{validateReviewEvent(e,s.range);if(typeof e.id!=='string'||!e.id||!['pending','confirmed','deleted'].includes(e.status)||!['manual','candidate'].includes(e.origin)||(s.mode==='manual'&&e.origin!=='manual'))throw Error('保存的事件状态无效');};
  for(const e of s.events)checkEvent(e);
  for(const undo of s.undo){
    if(Array.isArray(undo)){if(new Set(undo.map(e=>e.id)).size!==undo.length)throw Error('撤销快照编号重复');for(const e of undo)checkEvent(e);}
    else if(undo?.kind==='restore')checkEvent(undo.event);
    else if(undo?.kind!=='remove'||typeof undo.id!=='string'||!undo.id)throw Error('保存的撤销记录无效');
  }
  if(s.report!==undefined){if(!s.report||typeof s.report!=='object'||Array.isArray(s.report))throw Error('保存的报告无效');for(const [field,value] of Object.entries(s.report))if(!['observation','evidence','training','followUp'].includes(field)||typeof value!=='string'||value.length>3000)throw Error('保存的报告字段无效');}
  for(const t of ['createdAt','lastTick'])finite(s[t],'保存时间');
  if(s.lastTick<s.createdAt||!s.timing||['review','sweep','report'].some(k=>!Number.isFinite(s.timing[k])||s.timing[k]<0))throw Error('保存的计时无效');
  if(['review','sweep','report'].reduce((sum,k)=>sum+s.timing[k],0)>s.lastTick-s.createdAt+1e-6)throw Error('主动时间超过任务墙钟时间');
  let end=s.range.start;for(const c of s.coverage){if(!Number.isFinite(c.start)||!Number.isFinite(c.end)||c.start<end||c.end<=c.start||c.end>s.range.end)throw Error('保存的播放覆盖无效');end=c.end;}
  if(s.status==='finished'&&(!Number.isFinite(s.completedAt)||s.completedAt!==s.lastTick||s.completedAt<s.createdAt||!s.paused||!Array.isArray(s.completionWarnings)))throw Error('保存的锁定状态无效');
  return clone(s);
}
