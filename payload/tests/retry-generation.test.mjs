import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {tmpdir} from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {taskCard} from '../public/task-ui.js';
const root=path.resolve(import.meta.dirname,'..'),wait=ms=>new Promise(r=>setTimeout(r,ms));
const fields={model:'mock',duration:5,ratio:'9:16',resolution:'720p',prompt:'test prompt',assets:[]};
test('失败和结果未知的任务均显示重新生成按钮，明确失败支持编辑',()=>{
 for(const status of ['error','failed','cancelled','uncertain']){const t={...fields,id:'t',label:'shot',status,request:{prompt:'original'}};const html=taskCard(t,{tasks:[t],assets:[]},{modelOptions:()=>[],price:()=>null,statuses:{},taskUrl:()=>''});assert.match(html,/data-op="regenerate"/);if(status!=='uncertain')assert.match(html,/data-op="edit"/);else assert.ok(!html.includes('data-op="edit"'));}
});
test('失败重生使用新任务且保留原请求，未知结果重试复用原标识并阻止重复提交',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'jx-retry-'));let child;const seen=[];
 const upstream=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;res.setHeader('Content-Type','application/json');
  if(req.url==='/v1/models')return res.end(JSON.stringify({data:[{id:'mock',min_duration:1,max_duration:30,supported_ratios:['9:16'],supported_resolutions:['720p'],max_images:3,max_prompt_chars:1000}]}));
  if(req.url==='/v1/balance')return res.end('{"available":1000}');
  if(req.url==='/v1/videos/generations'&&req.method==='POST'){seen.push({key:req.headers['idempotency-key'],body:JSON.parse(raw)});return res.end(JSON.stringify({id:'remote-'+seen.length,status:'queued'}));}
  res.end('{"status":"queued"}');
 });upstream.listen(0,'127.0.0.1');await once(upstream,'listening');const base='http://127.0.0.1:'+upstream.address().port;
 const project={id:'project',name:'test',assets:[],raw:'',defaults:{...fields},prefix:'',suffix:'',tasks:[
  {...fields,id:'error',label:'request failure',status:'error',request:{prompt:'original failed request'},idempotencyKey:'old-key',apiBase:base},
  {...fields,id:'failed',label:'platform failed',status:'failed',request:{prompt:'failed video request'},remoteId:'old-video',idempotencyKey:'old-video-key',apiBase:base},
  {...fields,id:'upload',label:'upload failure',status:'error'},
  {...fields,id:'unknown',label:'unknown result',status:'uncertain',request:{prompt:'original uncertain request'},idempotencyKey:'original-unknown-key',apiBase:base}
 ]};await writeFile(path.join(dir,'projects.json'),JSON.stringify({projects:[project]}));
 try{
  child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,PORT:'0',STUDIO_DATA:dir,STUDIO_TEST:'1'},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);for(let i=0;i<100&&!output.includes('http://');i++)await wait(30);const origin=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert.ok(origin,output);
  const request=async(url,method='GET',body)=>{const r=await fetch(origin+url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
  assert.equal((await request('/api/connect','POST',{base,key:'fake-test-key'})).status,200);
  const endpoint='/api/projects/project/tasks/';assert.equal((await request(endpoint+'error','PATCH',{prompt:'edited retry',duration:5})).status,200);
  const confirmation={confirmed:true,confirmationId:'retry-confirmation-0001',revisionVersion:1};const [first,repeat]=await Promise.all([request(endpoint+'error/regenerate','POST',confirmation),request(endpoint+'error/regenerate','POST',confirmation)]);assert.equal(first.status,200);assert.equal(first.data.taskId,repeat.data.taskId);
  for(let i=0;i<100&&!seen.length;i++)await wait(30);assert.equal(seen[0].body.prompt,'edited retry');assert.notEqual(seen[0].key,'old-key');
  const state=(await request('/api/state')).data;const old=state.projects[0].tasks.find(t=>t.id==='error');assert.equal(old.request.prompt,'original failed request');assert.equal(old.status,'error');assert.equal(state.projects[0].tasks.filter(t=>t.parentTaskId==='error').length,1);
  assert.equal((await request(endpoint+'error/regenerate','POST',{...confirmation,confirmationId:'different-confirmation'})).status,400);
  for(const id of ['failed','upload']){const r=await request(endpoint+id+'/regenerate','POST',{confirmed:true,confirmationId:'retry-'+id+'-0001',revisionVersion:0});assert.equal(r.status,200,JSON.stringify(r.data));}
  assert.equal((await request(endpoint+'unknown/regenerate','POST',{confirmed:true,confirmationId:'unknown-0001',revisionVersion:0})).status,400);
  assert.equal((await request(endpoint+'unknown/recover','POST',{})).status,200);for(let i=0;i<100&&!seen.some(r=>r.key==='original-unknown-key');i++)await wait(30);const recovered=seen.filter(r=>r.key==='original-unknown-key');assert.equal(recovered.length,1);assert.equal(recovered[0].body.prompt,'original uncertain request');
 }finally{if(child){child.kill();await once(child,'exit');}upstream.close();await rm(dir,{recursive:true,force:true});}
});
