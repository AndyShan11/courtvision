import {validateStoredReview} from './review-session.js';
export const REVIEW_ARCHIVE_PREFIX='courtvision-review-archive:';
export function listReviewArchives(storage,videoIdentity){
  const entries=[],invalid=[];
  for(let i=0;i<storage.length;i++){
    const key=storage.key(i);if(!key?.startsWith(REVIEW_ARCHIVE_PREFIX))continue;
    try{const bundle=JSON.parse(storage.getItem(key)),raw=bundle?.session??bundle;
      if(raw?.videoIdentity!==videoIdentity)continue;
      const s=validateStoredReview(raw,videoIdentity);
      entries.push({key,id:s.id,mode:s.mode,status:s.status,createdAt:s.createdAt,range:s.range});
    }catch{invalid.push(key);}
  }
  return {entries:entries.sort((a,b)=>b.createdAt-a.createdAt),invalid};
}
