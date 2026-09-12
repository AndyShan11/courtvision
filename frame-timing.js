import { seekDecodedFrame } from './frame-sampling.js';
import { sha256Blob } from './sha256-stream.js';

export function validateFrameTimeline(index) {
  const [n,d] = index.timeBase || [];
  if (![n,d].every(x=>Number.isSafeInteger(x) && x>0) || !Array.isArray(index.presentationTicks)
      || index.presentationTicks[0]!==0 || index.presentationTicks.some((t,i,a)=>!Number.isSafeInteger(t) || (i>0 && t<=a[i-1]))) {
    throw new Error('无效视频帧时间索引');
  }
  return index;
}

export function presentationTimeAt(index, target) {
  if (!Number.isFinite(target) || target<0) throw new Error('无效采样时间');
  const [n,d] = index.timeBase, ticks=index.presentationTicks;
  const targetTick=(target+1e-7)*d/n;
  let low=0,high=ticks.length;
  while(low<high) {
    const mid=(low+high)>>>1;
    if(ticks[mid]<=targetTick) low=mid+1; else high=mid;
  }
  return ticks[Math.max(0,low-1)]*n/d;
}

export function createIndexedFrameSeeker(video, origin, fetcher=fetch) {
  const cache=new Map();
  let catalogPromise;
  const sha256=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)), b=>b.toString(16).padStart(2,'0')).join('');
  async function load(source) {
    // A same-named remote encoding is not the frozen local media.
    const url=new URL(source,origin);
    if(url.origin!==origin || !url.pathname.startsWith('/courtvision/samples/') || url.search || url.hash) return null;
    catalogPromise ??= fetcher('/courtvision/samples/frame-timing-catalog.json').then(async r=>{
      if(!r.ok) throw new Error('无法读取帧时间目录');
      return r.json();
    });
    const entry=(await catalogPromise).find(e=>new URL(`/courtvision/samples/${e.video}`,origin).href===source);
    if(!entry) return null;
    const response=await fetcher(entry.path);
    if(!response.ok) throw new Error('无法读取视频帧时间');
    const bytes=await response.arrayBuffer();
    if(await sha256(bytes)!==entry.sha256) throw new Error('帧时间文件校验失败');
    const index=validateFrameTimeline(JSON.parse(new TextDecoder().decode(bytes)));
    if(index.video!==entry.video || index.videoSha256!==entry.videoSha256) throw new Error('帧时间与录像身份不一致');
    return {index,entry};
  }
  let lastEvidence={mode:'unindexed-tolerance'};
  return {
    evidence:()=>({...lastEvidence}),
    forget(source) { cache.delete(source); },
    async bindVerifiedBlob(source, blob, originalSource, options={}) {
      if (!source.startsWith(`blob:${origin}/`) || !(blob instanceof Blob)) throw new Error('无效录像对象');
      const timing=await load(new URL(originalSource,origin).href);
      if (!timing) return false;
      // Hash the assembled bytes, not just a filename or claimed manifest identity.
      const actualVideoSha256=await sha256Blob(blob,options);
      if (actualVideoSha256!==timing.entry.videoSha256) throw new Error('录像内容与帧时间索引不一致');
      cache.set(source,Promise.resolve({...timing,actualVideoSha256}));
      return true;
    },
    async seek(target) {
      const source=video.currentSrc;
      if(!cache.has(source)) cache.set(source,load(source));
      const timing=await cache.get(source);
      if(video.currentSrc!==source) throw new Error('录像已切换，取消取帧');
      lastEvidence=timing ? {mode:'source-pts-v1',indexSha256:timing.entry.sha256,declaredVideoSha256:timing.entry.videoSha256,
        ...(timing.actualVideoSha256 ? {verifiedVideoSha256:timing.actualVideoSha256} : {})}
        : {mode:'unindexed-tolerance'};
      return seekDecodedFrame(video,target,10000,{expectedMediaTime:timing ? presentationTimeAt(timing.index,target):null});
    }
  };
}
