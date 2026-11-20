import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
test('并发下拉框支持 1 到 50，默认 2',async()=>{
 const html=await readFile(new URL('../public/index.html',import.meta.url),'utf8');
 const select=html.match(/<select id="concurrency"[^>]*>(.*?)<\/select>/)[1];
 assert.deepEqual([...select.matchAll(/<option[^>]*>(\d+)<\/option>/g)].map(m=>Number(m[1])),Array.from({length:50},(_,i)=>i+1));
 assert.match(select,/<option selected>2<\/option>/);
});

for(const concurrency of [50,500])test('批量提交并发 '+concurrency+'，最多保持 50 个同时提交',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'jx-concurrency-'));
 const pending=[];let child;
 const upstream=http.createServer(async(req,res)=>{
  const reply=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  if(req.url==='/v1/models')return reply({data:[{id:'mock',min_duration:1,max_duration:30,supported_ratios:['9:16'],supported_resolutions:['720p'],max_images:3,max_prompt_chars:1000}]});
  if(req.url==='/v1/balance')return reply({available:1000});
  if(req.method==='POST'&&req.url==='/v1/videos/generations'){for await(const chunk of req){}pending.push(res);return;}
  reply({status:'queued'});
 });upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 const base='http://127.0.0.1:'+upstream.address().port;
 const defaults={model:'mock',duration:5,resolution:'720p',ratio:'9:16'};
 const tasks=Array.from({length:52},(_,i)=>({...defaults,id:'t'+i,label:'shot '+i,prompt:'Test shot',assets:[],status:'draft'}));
 await writeFile(path.join(dir,'projects.json'),JSON.stringify({projects:[{id:'p',name:'concurrency',assets:[],raw:'',defaults,prefix:'',suffix:'',tasks}]}));
 try{
  child=spawn(process.execPath,['server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,STUDIO_TEST:'1',STUDIO_DATA:dir,PORT:'0'},stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',bytes=>output+=bytes);
  for(let i=0;i<100&&!output.includes('http://');i++)await wait(30);
  const origin=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert.ok(origin,output);
  const call=async(url,body)=>{const r=await fetch(origin+url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
  assert.equal((await call('/api/connect',{base,key:'test-concurrency-key'})).status,200);
  assert.equal((await call('/api/projects/p/start',{concurrency})).status,200);
  for(let i=0;i<150&&pending.length<50;i++)await wait(30);
  assert.equal(pending.length,50);
  const state=(await call('/api/state')).data;
  assert.equal(state.concurrency,50);assert.equal(state.projects[0].tasks.filter(t=>t.status==='pending').length,2);
  await call('/api/pause',{});
 }finally{
  if(child){child.kill();await once(child,'exit');}
  upstream.closeAllConnections();upstream.close();await rm(dir,{recursive:true,force:true});
 }
});
