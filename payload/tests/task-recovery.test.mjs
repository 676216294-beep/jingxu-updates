import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const fields={model:'mock',duration:5,ratio:'9:16',resolution:'720p',prompt:'original prompt',assets:[]};

for(const protocol of ['yingman','huimiao'])test(protocol+' 按任务编号恢复和拉取，查询失败保持原记录，全程不提交生成',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'jx-task-recovery-'));
 let child,submissions=0;
 const reads=[];
 const upstream=http.createServer(async(req,res)=>{
  const reply=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  assert.equal(req.headers.authorization,'Bearer test-recovery-key');
  if(req.url==='/v1/models')return reply({data:[{id:'mock',name:'Seedance 2.5 Flash',capability:'video',unitPriceMicrocredits:1}]});
  if(req.url==='/v1/balance')return reply({available:100});
  if(req.method==='POST'){submissions++;return reply({error:{message:'Unexpected generation request'}},400);}
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
 const project={id:'p',name:'recovery',assets:[],raw:'',defaults:fields,prefix:'',suffix:'',tasks:[pending('unknown'),{...pending('known'),remoteId:'known-video'},pending('second'),pending('slow-local'),{...pending('wrong-site'),apiBase:'https://other.example'}]};
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
 }finally{
  if(child){child.kill();await once(child,'exit');}
  upstream.closeAllConnections();upstream.close();await rm(dir,{recursive:true,force:true});
 }
});
