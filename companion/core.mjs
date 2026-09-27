export const VERSION = 1;
export const STORAGE_KEY = 'courtvision-companion-v1';
export const skills = {shooting:'投篮',handle:'运球',footwork:'脚步'};
export const levels = {new:'刚开始打球',regular:'有一些基础',team:'校队 / 系统训练'};
export const focuses = {rhythm:'节奏不稳定',balance:'身体不够稳定',weak:'弱侧不熟练',routine:'想建立训练习惯',review:'需要先和教练确认'};
export const drills = [
 {id:'shoot-close',skill:'shooting',title:'近距离定点投篮',tag:'找到舒服的发力',focus:['balance','routine'],minutes:5,unit:'次投篮',steps:['选择能轻松投到的位置，先做几次舒适的准备活动。','每次出手后保持结束姿势，观察自己是否站得稳定。','记录投篮数与命中数；下次保持相同距离再比较。'],cue:'放慢一点，站稳后再开始下一次。',measure:'同一篮筐、距离和拍摄位置，记录真实命中数。'},
 {id:'shoot-rhythm',skill:'shooting',title:'接球到出手的节奏',tag:'先顺畅，再加速',focus:['rhythm'],minutes:5,unit:'次练习',steps:['在舒适的近距离，从固定站位持球开始。','用相同的准备节奏完成出手，先不追求快。','拍下连续几次动作，找出自己最顺畅的一次。'],cue:'找到自己的节奏，动作顺畅比速度重要。',measure:'由自己或教练提前定义“顺畅完成”，不要把动作评分当命中率。'},
 {id:'handle-base',skill:'handle',title:'左右手基础控球',tag:'左右都照顾到',focus:['routine','balance','rhythm'],minutes:4,unit:'次运球',steps:['在平整、空旷的场地原地运球。','按自己能控制的节奏，左右手分别练一组。','记录连续控球次数；球失控后重新开始。'],cue:'先控制住球，再尝试抬头观察。',measure:'固定手侧和练习时长，再比较连续控球次数。'},
 {id:'handle-weak',skill:'handle',title:'给弱侧一点时间',tag:'专注你的薄弱环节',focus:['weak'],minutes:5,unit:'次运球',steps:['选较不熟练的一只手，用舒适节奏原地运球。','先完成短组练习，失控就停下来重新准备。','每组之间休息，记录最佳连续控球次数。'],cue:'短一点、稳一点，把注意力留给不熟练的那只手。',measure:'记录手侧和时长；左右手的成绩分别比较。'},
 {id:'foot-stop',skill:'footwork',title:'启动与平稳停步',tag:'把动作做清楚',focus:['balance','routine','rhythm'],minutes:4,unit:'次练习',steps:['选一小段无障碍的空地，从步行速度开始。','向前移动后平稳停住，观察是否需要额外一步调整。','先慢速完成，具体步法和规则请教练确认。'],cue:'慢速开始，停稳后再做下一次。',measure:'保持相同距离和速度，由教练确认完成标准。'},
 {id:'watch-repeat',skill:'all',title:'看一次，再试一次',tag:'观察 → 尝试 → 复看',focus:['review'],minutes:3,unit:'次练习',steps:['回看刚才的录像，只选一个想改善的地方。','用自己的话说出下一次要注意什么。','再拍一次，用同样视角比较；不确定时保存给教练。'],cue:'这一次，只专注一个小变化。',measure:'记录一个具体观察，不要同时纠正很多地方。'}
];
export function freshState(){return {version:VERSION,profile:{name:'球友',level:'new',skill:'shooting',minutes:15},sessions:[],observations:[],challenge:null};}
const text=(x,max=500)=>typeof x==='string'?x.slice(0,max):'';
export function validateState(value){
 if(!value||value.version!==VERSION||!value.profile||!Array.isArray(value.sessions)||!Array.isArray(value.observations))throw Error('这不是篮球伙伴的有效备份。');
 const p=value.profile;
 if(!skills[p.skill]||!levels[p.level]||![10,15,20,30].includes(p.minutes))throw Error('备份中的训练档案无效。');
 if(value.sessions.length>5000||value.observations.length>5000)throw Error('备份记录数量过多。');
 const seen=new Set();
 const sessions=value.sessions.map(s=>{
  if(!s||typeof s.id!=='string'||seen.has(s.id)||!drills.some(d=>d.id===s.drillId)||!Number.isFinite(Date.parse(s.date))||!Number.isInteger(s.attempts)||s.attempts<1||s.attempts>10000||!Number.isInteger(s.successes)||s.successes<0||s.successes>s.attempts||!Number.isFinite(s.minutes)||s.minutes<=0||s.minutes>180||![1,2,3,4,5].includes(s.effort))throw Error('训练记录有重复编号或无效数据，未导入。');
  seen.add(s.id);return {id:text(s.id,100),date:s.date,drillId:s.drillId,attempts:s.attempts,successes:s.successes,minutes:s.minutes,effort:s.effort,condition:text(s.condition,120),note:text(s.note),planId:text(s.planId,100)};
 });
 const observations=value.observations.map(o=>{
  if(!o||typeof o.id!=='string'||seen.has(o.id)||!Number.isFinite(Date.parse(o.date))||!skills[o.skill]||!focuses[o.focus]||!Number.isFinite(o.time)||o.time<0)throw Error('观察记录无效，未导入。');
  seen.add(o.id);return {id:text(o.id,100),date:o.date,skill:o.skill,focus:o.focus,time:o.time,note:text(o.note),source:text(o.source,120),reference:text(o.reference,120),author:o.author==='coach'?'coach':'self',measurements:text(o.measurements,400)};
 });
 const c=value.challenge;
 if(c && (!skills[c.skill]||!Number.isFinite(Date.parse(c.start))||typeof c.id!=='string'||![3,5,7].includes(c.target)))throw Error('挑战数据无效。');
 return {version:VERSION,profile:{name:text(p.name,24).trim()||'球友',skill:p.skill,level:p.level,minutes:p.minutes},sessions,observations,challenge:c?{id:text(c.id,100),skill:c.skill,start:c.start,target:c.target}:null};
}
export function makePlan(state,focus){
 const {profile,sessions,observations}=state;
 const observation=[...observations].reverse().find(o=>o.skill===profile.skill);
 const chosen=focus||observation?.focus||'routine';
 const primary=drills.filter(d=>d.skill===profile.skill).find(d=>d.focus.includes(chosen))||drills.find(d=>d.skill===profile.skill);
 const recent=sessions.filter(s=>drills.find(d=>d.id===s.drillId)?.skill===profile.skill).slice(-3);
 const easy=profile.level==='new'||recent.some(s=>s.effort>=4);
 const active=chosen==='review'?[drills.at(-1),primary]:[primary,drills.at(-1)];
 const practice=Math.max(2,Math.floor((profile.minutes-4)/2));
 return {focus:chosen,reason:observation?`根据你${observation.author==='coach'?'的教练':'最近'}记录的「${focuses[chosen]}」，先练一个问题。`:`根据「${levels[profile.level]} · ${skills[profile.skill]} · ${profile.minutes} 分钟」安排。`,easy,steps:active.map(d=>({...d,minutes:Math.min(d.minutes+(profile.level==='team'?2:0),practice),sets:easy?2:3})),note:easy?'先用舒适速度练习，组间充分休息。':'保持能控制的节奏，质量稳定后再增加难度。'};
}
export function localDay(date){const d=new Date(date);return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
export function stats(sessions){return {count:sessions.length,minutes:Math.round(sessions.reduce((a,s)=>a+s.minutes,0)),days:new Set(sessions.map(s=>localDay(s.date))).size};}
export function challengeProgress(state){if(!state.challenge)return 0;return new Set(state.sessions.filter(s=>s.date>=state.challenge.start&&drills.find(d=>d.id===s.drillId)?.skill===state.challenge.skill).map(s=>localDay(s.date))).size;}
export function comparison(sessions,drillId,condition){
 const rows=sessions.filter(s=>s.drillId===drillId&&s.condition===condition).sort((a,b)=>a.date.localeCompare(b.date));
 if(rows.length<2)return {rows,delta:null};
 const first=rows[0],last=rows.at(-1);return {rows,delta:100*(last.successes/last.attempts-first.successes/first.attempts)};
}
export function angle(a,b,c){if(!a||!b||!c)return null;const u=[a.x-b.x,a.y-b.y],v=[c.x-b.x,c.y-b.y];const n=Math.hypot(...u)*Math.hypot(...v);return n<1e-8?null:Math.acos(Math.max(-1,Math.min(1,(u[0]*v[0]+u[1]*v[1])/n)))*180/Math.PI;}
export function poseMetrics(points,aspect=1){if(!points?.length)return {};const p=points.map(v=>({...v,x:v.x*aspect}));const triples={leftElbow:[11,13,15],rightElbow:[12,14,16],leftKnee:[23,25,27],rightKnee:[24,26,28]};return Object.fromEntries(Object.entries(triples).map(([k,ids])=>[k,ids.every(i=>(p[i]?.visibility??0)>=.65)?angle(...ids.map(i=>p[i])):null]));}
export const metricNames={leftElbow:'左肘',rightElbow:'右肘',leftKnee:'左膝',rightKnee:'右膝'};
export function coachBrief(state){return JSON.stringify({profile:state.profile,observations:state.observations.slice(-5),sessions:state.sessions.slice(-5),suggestedPlan:makePlan(state)},null,2);}
