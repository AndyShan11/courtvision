// Trial metadata are declarations, not evidence that a real person performed a task.
export function validateTrialMetadata(input,mode){
  const text=(key,max=80)=>{if(typeof input[key]!=='string'||!input[key].trim()||input[key].length>max)throw Error(`请填写有效的${key}`);return input[key].trim();};
  const operator=text('operator'),pairId=text('pairId'),deliveryStandard=text('deliveryStandard',200);
  if(!Number.isInteger(input.order)||input.order<1||input.order>10000)throw Error('实验次序须为正整数');
  if(!['unseen','seen','unknown'].includes(input.familiarity))throw Error('录像熟悉程度无效');
  if(!['human','automation','unknown'].includes(input.performer))throw Error('操作来源无效');
  if(input.algorithmWaitMs!==null&&(!Number.isFinite(input.algorithmWaitMs)||input.algorithmWaitMs<0))throw Error('算法等待时间无效');
  if(mode==='manual'&&input.algorithmWaitMs!==0)throw Error('纯人工任务算法等待应为0');
  return {operator,pairId,deliveryStandard,order:input.order,familiarity:input.familiarity,performer:input.performer,algorithmWaitMs:input.algorithmWaitMs,waitSource:'operator-declared',independence:'未核实，实验信息由操作者声明'};
}
