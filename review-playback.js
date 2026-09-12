// Conservative playback evidence, not a claim of human attention.
export function reviewPlaybackStep(previous,sample,range){
  const {time,wallMs,rate,active,visible,playing,seeking}=sample;
  if(!active||!visible||!playing||seeking||!Number.isFinite(time)||!Number.isFinite(wallMs)||!Number.isFinite(rate)||rate<=0)return {previous:null,interval:null};
  const next={time,wallMs,rate};
  if(!previous||previous.rate!==rate)return {previous:next,interval:null};
  const delta=time-previous.time,elapsed=(wallMs-previous.wallMs)/1000;
  if(delta<=0||delta>2||elapsed<=0||elapsed>2||delta>elapsed*rate+.15)return {previous:next,interval:null};
  const start=Math.max(range.start,previous.time),end=Math.min(range.end,time);
  return {previous:next,interval:end>start?{start,end}:null};
}
