import {validateStoredReview,reviewSummary,reviewReportComplete} from './review-session.js';
import {validateTrialMetadata} from './review-trial.js';
import {evaluateReview} from './review-evaluation.js';

// Recompute from events + reference; never trust imported summary metrics.
export function compareReviewTrials(first,second){
  const rows=[first,second].map(bundle=>{
    const s=validateStoredReview(bundle.session,bundle.session?.videoIdentity);
    if(s.status!=='finished')throw Error('只比较已锁定任务');
    const trial=validateTrialMetadata(s.trial??{},s.mode);
    return {session:s,trial,summary:reviewSummary(s),evaluation:bundle.reference?evaluateReview(s,bundle.reference):null};
  });
  const manual=rows.find(r=>r.session.mode==='manual'),assisted=rows.find(r=>r.session.mode==='assisted');
  if(!manual||!assisted)throw Error('需要一份纯人工和一份工具辅助任务');
  const reasons=[];
  if(manual.trial.pairId!==assisted.trial.pairId)reasons.push('对照组编号不同');
  if(manual.trial.deliveryStandard!==assisted.trial.deliveryStandard)reasons.push('交付标准不同');
  if(manual.session.range.end-manual.session.range.start!==assisted.session.range.end-assisted.session.range.start)reasons.push('录像时长不同');
  if(manual.trial.operator!==assisted.trial.operator)reasons.push('操作者不同，技能差异可能影响结果');
  if(manual.trial.order===assisted.trial.order)reasons.push('实验次序重复');
  if(manual.session.videoIdentity===assisted.session.videoIdentity&&Math.max(manual.session.range.start,assisted.session.range.start)<Math.min(manual.session.range.end,assisted.session.range.end))reasons.push('两次录像区间重叠，存在记忆偏差');
  for(const r of rows){
    const name=r.session.mode==='manual'?'纯人工':'工具辅助';
    if(r.session.mediaEvidence?.kind!=='content-sha256')reasons.push(`${name}录像未按内容指纹绑定`);
    if(r.trial.performer!=='human')reasons.push(`${name}不是声明的真人实验`);
    if(r.trial.familiarity!=='unseen')reasons.push(`${name}未声明录像陌生`);
    if(r.summary.pending||r.summary.coverageFraction<.99)reasons.push(`${name}复核未完成`);
    if(!reviewReportComplete(r.session))reasons.push(`${name}报告未填写完整`);
    if(!r.evaluation)reasons.push(`${name}缺少独立参考答案`);
    else if(!r.evaluation.exhaustiveClaim)reasons.push(`${name}参考答案未声明完整`);
  }
  if(manual.evaluation&&assisted.evaluation&&[...manual.evaluation.scope].sort().join('|')!==[...assisted.evaluation.scope].sort().join('|'))reasons.push('核验标签范围不同');
  if(assisted.trial.algorithmWaitMs===null)reasons.push('辅助模式算法等待时间未测');
  const activeDifferenceMs=manual.summary.activeMs-assisted.summary.activeMs;
  return {manual,assisted,reasons,activeDifferenceMs,
    activeReductionFraction:manual.summary.activeMs>0?activeDifferenceMs/manual.summary.activeMs:null,
    assistedActivePlusPreWaitMs:assisted.trial.algorithmWaitMs===null?null:assisted.summary.activeMs+assisted.trial.algorithmWaitMs,
    identityPreparationMs:{manual:manual.session.identityPreparationMs??null,assisted:assisted.session.identityPreparationMs??null},
    interpretation:reasons.length?'只展示原始差异，条件不齐，不能据此认定省时。':'仅为单组描述性差异；片段难度、参考独立性和真人声明未核实，不能外推总体省时。',
    humanEfficiencyProven:false};
}
