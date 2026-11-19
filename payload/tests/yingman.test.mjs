import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {normalizeModels,preferredModel,pixelSize,videoRoute,yingmanForm,yingmanPayload} from '../providers.mjs';
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('萤漫默认模型按名称匹配真实 ID，过滤文本模型并映射参考图和尺寸',async()=>{
 const models=normalizeModels([{id:'text',capability:'text'},{id:'opaque-video-id',name:'Seedance 2.5 Flash',capability:'video'}],'yingman');assert.equal(models.length,1);assert.equal(preferredModel(models,'yingman'),'opaque-video-id');assert.equal(models[0].capability_config.references.images.max_count,5);assert.equal(pixelSize('720p','9:16'),'720x1280');assert.equal(pixelSize('720p','16:9'),'1280x720');assert.equal(videoRoute('yingman','video-id'),'/v1/videos/video-id');assert.equal(videoRoute('huimiao','video-id'),'/v1/videos/generations/video-id');
 const model=normalizeModels([{id:'Seedance 2.5 Flash',capabilities:{video:{duration:{min:5,max:10},references:{maxImages:3},resolutions:['1080P'],ratios:['1:1']}}}],'yingman')[0];assert.equal(model.capability_config.duration.max,10);assert.equal(model.supported_resolutions[0],'1080p');
 const payload=yingmanPayload({model:'m',duration:5,resolution:'720p',ratio:'9:16'},[{file:'a.png',name:'角色.png',type:'image/png'}],'prompt');const form=await yingmanForm(payload,async()=>Buffer.from('real-image'));assert.equal(form.get('seconds'),'5');assert.equal(form.get('size'),'720x1280');assert.equal(await form.get('input_reference').text(),'real-image');assert.equal(form.has('asset_keys'),false);
});
test('萤漫接入：模型余额、图片 multipart、异步轮询、预览下载及未知请求保护',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'jx-yingman-'));let child,missingModel=false,loseResponse=false,calls=0;const submitted=[];
 const upstream=http.createServer(async(req,res)=>{const reply=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(data));};
  assert.equal(req.headers.authorization,'Bearer test-yingman-private-key');
  if(req.url==='/v1/models')return reply({data:missingModel?[]:[{id:'actual-flash-id',name:'Seedance 2.5 Flash',capability:'video'}]});
  if(req.url==='/v1/balance')return reply({available:500,frozen:0});
  if(req.url==='/v1/videos'&&req.method==='POST'){calls++;const chunks=[];for await(const b of req)chunks.push(b);const parsed=await new Request('http://local.test',{method:'POST',headers:req.headers,body:Buffer.concat(chunks)}).formData();submitted.push(parsed);if(loseResponse)return req.socket.destroy();return reply({id:'video-first',status:'queued'});}
  if(req.url==='/v1/videos/video-first')return reply({id:'video-first',status:'completed'});
  if(req.url==='/v1/videos/video-first/content'){res.setHeader('Content-Type','video/mp4');return res.end('yingman-video-bytes');}
  res.writeHead(404);res.end();
 });upstream.listen(0,'127.0.0.1');await once(upstream,'listening');const base='http://127.0.0.1:'+upstream.address().port;
 try{
  child=spawn(process.execPath,['server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,STUDIO_TEST:'1',STUDIO_DATA:dir,PORT:'0'},stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',b=>log+=b);for(let i=0;i<100&&!log.includes('http://');i++)await wait(30);const origin=log.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert.ok(origin,log);
  const call=async(url,method='GET',body)=>{const r=await fetch(origin+url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const data=await r.json();return {status:r.status,data};};
  const connect=await call('/api/connect','POST',{base,key:'test-yingman-private-key',protocol:'yingman'});assert.equal(connect.status,200,JSON.stringify(connect.data));assert.equal(connect.data.preferredModel,'actual-flash-id');assert.equal(connect.data.protocol,'yingman');assert.ok(!JSON.stringify(connect.data).includes('test-yingman-private-key'));
  const saved=await readFile(path.join(dir,'api-settings.json'),'utf8');assert.ok(!saved.includes('test-yingman-private-key'));assert.equal(JSON.parse(saved).protocol,'yingman');
  const noKeySwitch=await call('/api/connect','POST',{base:'https://yingman.xlapis.com',key:''});assert.equal(noKeySwitch.status,400);assert.match(noKeySwitch.data.error,/Key/);
  const created=await call('/api/projects','POST',{});assert.equal(created.data.defaults.model,'actual-flash-id');
  const endpoint='/api/projects/'+connect.data.projects[0].id;
  const image=await fetch(origin+endpoint+'/assets',{method:'POST',headers:{'Content-Type':'image/png','X-Filename':encodeURIComponent('林策.png')},body:Buffer.from('image-data')});assert.equal(image.status,200);
  await call(endpoint,'PATCH',{raw:'{分镜 1}\n林策走到窗边，总时长5秒',defaults:{model:'actual-flash-id',ratio:'9:16',resolution:'720p',duration:5}});await call(endpoint+'/parse','POST',{mode:'markers'});assert.equal((await call(endpoint+'/start','POST',{})).status,200);
  let state,task;for(let i=0;i<180;i++){state=(await call('/api/state')).data;task=state.projects[0].tasks[0];if(task.status==='completed')break;await wait(50);}assert.equal(task.status,'completed');assert.equal(task.apiProtocol,'yingman');assert.equal(calls,1);assert.equal(submitted[0].get('model'),'actual-flash-id');assert.match(submitted[0].get('prompt'),/林策是@图片1/);assert.equal(await submitted[0].get('input_reference').text(),'image-data');assert.equal(submitted[0].get('seconds'),'5');assert.equal(submitted[0].get('size'),'720x1280');
  await call('/api/download-proxy','POST',{mode:'direct'});const preview=await fetch(origin+endpoint+'/tasks/'+task.id+'/preview-video');assert.equal(preview.status,200);assert.equal(await preview.text(),'yingman-video-bytes');assert.equal((await call(endpoint+'/tasks/'+task.id+'/download','POST',{})).status,200);
  missingModel=true;assert.equal((await call('/api/connect','POST',{base,key:'test-yingman-private-key',protocol:'yingman'})).status,400);assert.equal((await call('/api/state')).data.models[0].id,'actual-flash-id');missingModel=false;
  loseResponse=true;const retry=await call(endpoint+'/tasks/'+task.id+'/regenerate','POST',{confirmed:true,confirmationId:'yingman-regeneration-0001',revisionVersion:0});assert.equal(retry.status,200);
  let uncertain;for(let i=0;i<100;i++){state=(await call('/api/state')).data;uncertain=state.projects[0].tasks.find(t=>t.id===retry.data.taskId);if(uncertain.status==='uncertain')break;await wait(30);}assert.equal(uncertain.status,'uncertain');const before=calls;const recover=await call(endpoint+'/tasks/'+uncertain.id+'/recover','POST',{});assert.equal(recover.status,400);assert.match(recover.data.error,/幂等/);assert.equal(calls,before);
 }finally{if(child){child.kill();await once(child,'exit');}upstream.close();await rm(dir,{recursive:true,force:true});}
});
