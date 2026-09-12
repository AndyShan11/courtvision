import {sha256Blob} from './sha256-stream.js';
const hashes=new WeakMap();
export async function reviewMediaIdentity(context,{assertCurrent=()=>{},onProgress=()=>{}}={}){
  if(context.blob){
    assertCurrent();let hash=hashes.get(context.blob);
    if(!hash){hash=await sha256Blob(context.blob,{assertCurrent,onProgress});hashes.set(context.blob,hash);}
    assertCurrent();
    return {videoIdentity:`sha256:${hash}`,mediaEvidence:{kind:'content-sha256',sha256:hash,bytes:context.blob.size,logicalKey:context.videoIdentity}};
  }
  return {videoIdentity:context.videoIdentity,mediaEvidence:{kind:'unverified-source',logicalKey:context.videoIdentity,warning:'仅按来源标识，未核验录像字节；同名或外链变化可能导致参考错配'}};
}
