import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {familyOf,groupedTasks} from '../public/history.mjs';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fields={model:'mock',duration:5,ratio:'9:16',resolution:'720p',prompt:'original prompt',assets:[]};

for(const protocol of ['yingman','huimiao'])test(protocol+' 按编号查询及无视频确认，保留原记录并按确认重新生成',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'jx-task-recovery-'));
 let child,submissions=0;
 const reads=[];
 const upstream=http.createServer(async(req,res)=>{
  const reply=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  assert.equal(req.headers.authorization,'Bearer test-recovery-key');
  if(req.url==='/v1/models')return reply({data:[{id:'mock',name:'Seedance 2.5 Flash',capability:'video',unitPriceMicrocredits:1,supported_ratios:['9:16'],supported_resolutions:['720p'],min_duration:1,max_duration:30}]});
  if(req.url==='/v1/balance')return reply({available:100});
  if(req.method==='POST'){submissions++;return reply({id:'generated-after-confirmation',status:'queued'});}
  if(req.url.endsWith('/content')){res.writeHead(200,{'Content-Type':'video/mp4'});return res.end('recovered-video');}
  const prefix=protocol==='yingman'?'/v1/videos/':'/v1/videos/generations/';
  if(!req.url.startsWith(prefix))return reply({error:{message:'Wrong protocol route'}},404);
  const id=req.url.slice(prefix.length);reads.push(id);
  if(id==='missing')return reply({error:{message:'任务不存在'}},404);
  if(id==='invalid')return reply({id,status:'unknown-status'});
  if(id==='slow')await wait(100);
  reply({id,status:id==='running'?'in_progress':id==='failed-video'?'failed':'completed',model:'mock',seconds:'12',error:id==='failed-video'?{message:'生成失败原因'}:undefined});
 });
 upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 const base='http://127.0.0.1:'+upstream.address().port;
 const pending=id=>({...fields,id,label:id,status:'uncertain',apiProtocol:protocol,apiBase:base,request:{prompt:'original submitted prompt'},idempotencyKey:'original-'+id});
 const project={id:'p',name:'recovery',assets:[],raw:'',defaults:fields,prefix:'',suffix:'',tasks:[pending('unknown'),{...pending('known'),remoteId:'known-video'},pending('second'),pending('slow-local'),{...pending('wrong-site'),apiBase:'https://other.example'},{...pending('no-video'),remoteId:'unconfirmed-remote'}]};
 await writeFile(path.join(dir,'projects.json'),JSON.stringify({projects:[project]}));
 try{
  child=spawn(process.execPath,['server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,PORT:'0',STUDIO_TEST:'1',STUDIO_DATA:dir},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',bytes=>output+=bytes);
  for(let i=0;i<100&&!output.includes('http://');i++)await wait(30);
  const origin=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert.ok(origin,output);
  const call=async(url,method='GET',body)=>{const response=await fetch(origin+url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});return {status:response.status,data:await response.json()};};
  assert.equal((await call('/api/connect','POST',{base,key:'test-recovery-key',protocol})).status,200);
  const endpoint='/api/projects/p',recover=id=>endpoint+'/tasks/'+id+'/pull-video';
  for(const remoteId of ['missing','invalid','../videos','']){
   assert.equal((await call(recover('unknown'),'POST',{remoteId})).status,400);
   const t=(await call('/api/state')).data.projects[0].tasks.find(t=>t.id==='unknown');
   assert.equal(t.status,'uncertain');assert.equal(t.remoteId,undefined);
  }
  assert.equal((await call(recover('wrong-site'),'POST',{remoteId:'recovered'})).status,400);
  const recovered=await call(recover('unknown'),'POST',{remoteId:' recovered '});
  assert.equal(recovered.status,200);assert.equal(recovered.data.taskId,'unknown');assert.equal(recovered.data.status,'completed');
  const state=(await call('/api/state')).data,task=state.projects[0].tasks.find(t=>t.id==='unknown');
  assert.equal(task.request.prompt,'original submitted prompt');assert.equal(task.prompt,'original prompt');assert.equal(task.idempotencyKey,'original-unknown');assert.equal(task.remoteId,'recovered');assert.equal(task.apiProtocol,protocol);
  const preview=await fetch(origin+endpoint+'/tasks/unknown/preview-video');
  // The default download network is builtin until explicitly set.
  assert.equal(preview.status,400);
  await call('/api/download-proxy','POST',{mode:'direct'});
  const video=await fetch(origin+endpoint+'/tasks/unknown/preview-video');assert.equal(video.status,200);assert.equal(await video.text(),'recovered-video');
  assert.equal((await call(endpoint+'/tasks/unknown/download','POST',{})).status,200);
  assert.equal((await call(recover('second'),'POST',{remoteId:'recovered'})).status,400);
  assert.equal((await call(recover('known'),'POST',{remoteId:'another-video'})).status,400);
  assert.equal((await call(endpoint+'/tasks/known/recover','POST',{})).status,200);
  const [first,second]=await Promise.all([call(recover('slow-local'),'POST',{remoteId:'slow'}),call(recover('slow-local'),'POST',{remoteId:'slow'})]);
  assert.deepEqual([first.status,second.status].sort(),[200,400]);assert.equal(reads.filter(id=>id==='slow').length,1);
  const pulled=await call(endpoint+'/pull-video','POST',{remoteId:'standalone'});assert.equal(pulled.status,200);
  const repeat=await call(endpoint+'/pull-video','POST',{remoteId:'standalone'});assert.equal(repeat.data.taskId,pulled.data.taskId);
  const existing=await call(endpoint+'/pull-video','POST',{remoteId:'recovered'});assert.equal(existing.data.taskId,'unknown');
  const running=await call(endpoint+'/pull-video','POST',{remoteId:'running'});assert.equal(running.data.status,'in_progress');
  const failed=await call(recover('second'),'POST',{remoteId:'failed-video'});assert.equal(failed.data.status,'failed');
  const saved=JSON.parse(await readFile(path.join(dir,'projects.json'),'utf8')).projects[0];
  assert.equal(saved.tasks.filter(t=>t.remoteId==='standalone').length,1);assert.equal(saved.tasks.find(t=>t.id==='second').error,'生成失败原因');assert.equal(saved.tasks.find(t=>t.id===running.data.taskId).remoteId,'running');assert.equal(submissions,0);
  const noVideoUrl=endpoint+'/tasks/no-video/confirm-no-video';
  assert.equal((await call(noVideoUrl,'POST',{})).status,400);
  assert.equal((await call(endpoint+'/tasks/unknown/confirm-no-video','POST',{confirmed:true})).status,400);
  const [confirm,repeatConfirm]=await Promise.all([call(noVideoUrl,'POST',{confirmed:true}),call(noVideoUrl,'POST',{confirmed:true})]);
  assert.equal(confirm.status,200);assert.equal(repeatConfirm.status,200);
  const afterConfirm=(await call('/api/state')).data.projects[0];
  const original=afterConfirm.tasks.find(t=>t.id==='no-video');
  assert.equal(afterConfirm.tasks.length,saved.tasks.length);assert.equal(original.status,'failed');assert.ok(original.noVideoConfirmedAt);assert.equal(original.remoteId,'unconfirmed-remote');assert.equal(original.request.prompt,'original submitted prompt');assert.equal(submissions,0);
  const confirmation={confirmed:true,confirmationId:'no-video-regeneration',revisionVersion:0};
  const [regenerate,repeatRegenerate]=await Promise.all([call(endpoint+'/tasks/no-video/regenerate','POST',confirmation),call(endpoint+'/tasks/no-video/regenerate','POST',confirmation)]);
  assert.equal(regenerate.status,200,JSON.stringify(regenerate.data));assert.equal(repeatRegenerate.data.taskId,regenerate.data.taskId);
  for(let i=0;i<100&&!submissions;i++)await wait(30);
  assert.equal(submissions,1);
  const regenerated=(await call('/api/state')).data.projects[0];
  assert.equal(groupedTasks(regenerated.tasks).length,groupedTasks(afterConfirm.tasks).length);assert.equal(familyOf(regenerated.tasks,original).length,2);
  const newTask=regenerated.tasks.find(t=>t.id===regenerate.data.taskId);assert.equal(newTask.parentTaskId,'no-video');assert.equal(newTask.prompt,'original prompt');assert.notEqual(newTask.idempotencyKey,original.idempotencyKey);
 }finally{
  if(child){child.kill();await once(child,'exit');}
  upstream.closeAllConnections();upstream.close();await rm(dir,{recursive:true,force:true});
 }
});
