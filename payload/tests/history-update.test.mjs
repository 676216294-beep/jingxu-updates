import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {familyOf,latestCompleted,groupedTasks} from '../public/history.mjs';
import {applyUpdate,backupRecords,restoreRecords} from '../update.mjs';
test('生成历史按血缘分组：最新完成版默认预览，保留旧版和等待中的提交',()=>{
 const tasks=[{id:'old',status:'completed',localVideo:'old.mp4'},{id:'other',status:'completed'},{id:'new',parentTaskId:'old',status:'completed',localVideo:'new.mp4'},{id:'pending',parentTaskId:'new',status:'queued'}];
 assert.deepEqual(familyOf(tasks,tasks[2]).map(t=>t.id),['old','new','pending']);assert.equal(latestCompleted(tasks,tasks[0]).localVideo,'new.mp4');assert.equal(latestCompleted(tasks,tasks[3]).id,'new');assert.deepEqual(groupedTasks(tasks).map(t=>t.id),['pending','other']);assert.equal(tasks[0].localVideo,'old.mp4');
});
test('升级校验清单且不碰记录；完整备份恢复保留任务身份、素材和所有视频',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'jx-update-')),source=path.join(dir,'update'),target=path.join(dir,'old');
 try{
  await mkdir(source);await mkdir(path.join(target,'data','assets'),{recursive:true});await mkdir(path.join(target,'data','videos'));
  await writeFile(path.join(target,'server.mjs'),'old program');await writeFile(path.join(target,'launcher.mjs'),'launcher');
  const db=JSON.stringify({projects:[{id:'original-project',tasks:[{id:'old',remoteId:'platform-old',localVideo:'old.mp4'},{id:'new',parentTaskId:'old',remoteId:'platform-new',localVideo:'new.mp4'}]}]});
  await writeFile(path.join(target,'data','projects.json'),db);await writeFile(path.join(target,'data','assets','a.png'),'asset');await writeFile(path.join(target,'data','videos','old.mp4'),'old-video');await writeFile(path.join(target,'data','videos','new.mp4'),'new-video');await writeFile(path.join(target,'data','proxy-private.json'),'private-settings');
  await writeFile(path.join(source,'server.mjs'),'new program');const hash=createHash('sha256').update('new program').digest('hex');
  await writeFile(path.join(source,'release-manifest.json'),JSON.stringify({format:'jingxu-update-v1',version:'test',files:[{path:'server.mjs',sha256:hash}]}));
  const probe=await applyUpdate(source,target,{checkRunning:false,dryRun:true});assert.deepEqual(probe.changed,['server.mjs']);assert.equal(await readFile(path.join(target,'server.mjs'),'utf8'),'old program');
  const result=await applyUpdate(source,target,{checkRunning:false});assert.equal(await readFile(path.join(target,'server.mjs'),'utf8'),'new program');assert.equal(await readFile(path.join(result.backup,'server.mjs'),'utf8'),'old program');assert.equal(await readFile(path.join(target,'data','projects.json'),'utf8'),db);assert.equal(await readFile(path.join(target,'data','proxy-private.json'),'utf8'),'private-settings');
  const same=await applyUpdate(source,target,{checkRunning:false,dryRun:true});assert.deepEqual(same.changed,[]);
  await writeFile(path.join(source,'release-manifest.json'),JSON.stringify({format:'jingxu-update-v1',files:[],requires:[{path:'runtime/node.exe',sha256:'missing'}]}));await assert.rejects(()=>applyUpdate(source,target,{checkRunning:false}),/需要原版运行组件/);
  const backup=await backupRecords(target,dir,{checkRunning:false});await writeFile(path.join(target,'data','projects.json'),JSON.stringify({projects:[]}));const restored=await restoreRecords(target,backup,{checkRunning:false});assert.ok(restored.previous);assert.equal(await readFile(path.join(target,'data','projects.json'),'utf8'),db);assert.equal(await readFile(path.join(target,'data','videos','new.mp4'),'utf8'),'new-video');assert.equal(await readFile(path.join(target,'data','assets','a.png'),'utf8'),'asset');
  await writeFile(path.join(source,'release-manifest.json'),JSON.stringify({format:'jingxu-update-v1',files:[{path:'data/projects.json',sha256:hash}]}));await assert.rejects(()=>applyUpdate(source,target,{checkRunning:false}),/不能覆盖用户数据/);assert.equal(await readFile(path.join(target,'data','projects.json'),'utf8'),db);
  await writeFile(path.join(source,'release-manifest.json'),JSON.stringify({format:'jingxu-update-v1',files:[{path:'server.mjs',sha256:'broken'}]}));await assert.rejects(()=>applyUpdate(source,target,{checkRunning:false}),/校验失败/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
