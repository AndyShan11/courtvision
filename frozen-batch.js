// Sequential evidence collection: never overlap scans or hide failed attempts.
export async function collectFrozenBatch({entries,load,scan,save,assertCurrent,shouldStop,onProgress=()=>{}}) {
  const files=[];
  for (const entry of entries) {
    for (let repeat=1;repeat<=2;repeat++) {
      if (shouldStop()) return {stopped:true,files};
      assertCurrent();
      if (!await load(entry)) throw new Error('冻结区间载入失败');
      assertCurrent();
      const result=await scan(entry);
      assertCurrent();
      const filename=await save(result,entry);
      files.push(filename);
      onProgress({entry,repeat,completed:files.length,total:entries.length*2,filename});
      if (result.status!=='complete') throw new Error(`扫描失败，失败记录已保存：${filename}`);
    }
  }
  return {stopped:false,files};
}
