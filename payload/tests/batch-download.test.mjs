import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('全部成片并发批量下载，最新版本、缓存和失败分别处理，重复点击及单条下载共用锁',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'jx-batch-download-'));
 const destination=path.join(dir,'成片保存目录');await mkdir(destination);
 await mkdir(path.join(dir,'videos'));await writeFile(path.join(dir,'videos','cached.mp4'),'cached-video');
 await writeFile(path.join(dir,'download-settings.json'),JSON.stringify({mode:'direct'}));
 let child,peak=0;
 const requests=[],pending=new Map();
 const upstream=http.createServer((req,res)=>{
  assert.equal(req.headers.authorization,'Bearer test-download-key');
  const id=req.url.match(/^\/v1\/videos\/([^/]+)\/content$/)?.[1];
  assert.ok(id,req.url);requests.push(id);pending.set(id,res);peak=Math.max(peak,pending.size);
 });
 upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 const base='http://127.0.0.1:'+upstream.address().port;
 const task=(id,extra={})=>({id,label:id,prompt:'test',assets:[],model:'mock',duration:5,resolution:'720p',ratio:'9:16',status:'completed',remoteId:id,apiBase:base,...extra});
 const project={id:'p',name:'批量下载测试',raw:'',assets:[],prefix:'',suffix:'',defaults:{duration:5},downloadFolder:destination,tasks:[task('old'),task('new',{parentTaskId:'old'}),task('second'),task('failed-video'),task('cached',{localVideo:'cached.mp4'}),task('last'),task('draft',{status:'draft'})]};
 await writeFile(path.join(dir,'projects.json'),JSON.stringify({projects:[project,{...project,id:'empty',name:'空合集',tasks:[],downloadFolder:undefined}]}));
 const finish=id=>{const res=pending.get(id);assert.ok(res,id);pending.delete(id);if(id==='failed-video'){res.writeHead(503);res.end();}else{res.writeHead(200,{'Content-Type':'video/mp4'});res.end('video-'+id);}};
 try{
  child=spawn(process.execPath,['server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,STUDIO_TEST:'1',STUDIO_DATA:dir,PORT:'0',HUIMIAO_API_KEY:'test-download-key',HUIMIAO_BASE_URL:base},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',bytes=>output+=bytes);
  for(let i=0;i<100&&!output.includes('http://');i++)await wait(30);
  const origin=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert.ok(origin,output);
  const call=async(url,method='GET',body)=>{const r=await fetch(origin+url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
  const empty=await call('/api/projects/empty/download-all','POST',{concurrency:50});assert.equal(empty.data.total,0);assert.equal(empty.data.status,'completed');
  const endpoint='/api/projects/p';
  const [first,repeat]=await Promise.all([call(endpoint+'/download-all','POST',{concurrency:3}),call(endpoint+'/download-all','POST',{concurrency:3})]);
  assert.equal(first.status,200);assert.equal(repeat.status,200);assert.equal(first.data.id,repeat.data.id);assert.equal(first.data.total,5);assert.equal(first.data.concurrency,3);
  for(let i=0;i<100&&pending.size<3;i++)await wait(20);
  assert.equal(pending.size,3);assert.equal(peak,3);assert.ok(!requests.includes('old'));assert.ok(!requests.includes('draft'));
  const downloading=(await call('/api/state')).data.batchDownloadJobs.p;
  assert.equal(downloading.status,'running');assert.equal(downloading.active,3);
  assert.ok((await call('/api/updates')).data.blockers.includes('视频正在下载'));
  const single=call(endpoint+'/tasks/new/download','POST',{});
  await wait(30);
  finish('new');finish('second');finish('failed-video');
  for(let i=0;i<100&&!pending.has('last');i++)await wait(20);
  finish('last');assert.equal((await single).status,200);
  let state,job;
  for(let i=0;i<100;i++){state=(await call('/api/state')).data;job=state.batchDownloadJobs.p;if(job.status!=='running')break;await wait(20);}
  assert.equal(job.status,'partial');assert.equal(job.completed,4);assert.equal(job.failed,1);assert.equal(job.active,0);assert.equal(job.errors[0].taskId,'failed-video');assert.match(job.errors[0].error,/503/);
  assert.equal(requests.filter(id=>id==='new').length,1);assert.equal(requests.length,4);assert.ok(peak<=3);
  const saved=state.projects.find(p=>p.id==='p');
  assert.equal((await readdir(destination)).length,4);
  for(const id of ['new','second','cached','last']){const t=saved.tasks.find(t=>t.id===id);assert.equal(await readFile(t.savedPath,'utf8'),id==='cached'?'cached-video':'video-'+id);}
  assert.equal(saved.tasks.find(t=>t.id==='failed-video').savedPath,undefined);
  assert.ok(!(await call('/api/updates')).data.blockers.includes('视频正在下载'));
 }finally{
  if(child){child.kill();await once(child,'exit');}
  upstream.closeAllConnections();upstream.close();await rm(dir,{recursive:true,force:true});
 }
});
