let detector;
self.onmessage=async({data})=>{
 try{
  if(data.type==='init'){
   const {FilesetResolver,PoseLandmarker}=await import('./vendor/vision_bundle.mjs');
   const files=await FilesetResolver.forVisionTasks(new URL('./vendor/wasm/',self.location.href).href.replace(/\/$/,''));
   detector=await PoseLandmarker.createFromOptions(files,{baseOptions:{modelAssetPath:new URL('./vendor/pose_landmarker_lite.task',self.location.href).href,delegate:'CPU'},runningMode:'IMAGE',numPoses:2,minPoseDetectionConfidence:.6,minPosePresenceConfidence:.6});
   self.postMessage({type:'ready'});
  }else if(data.type==='frame'){
   try{const r=detector.detect(data.bitmap);self.postMessage({type:'result',id:data.id,time:data.time,landmarks:r.landmarks});}finally{data.bitmap.close();}
  }
 }catch(e){self.postMessage({type:'error',message:e.message,id:data.id});}
};
