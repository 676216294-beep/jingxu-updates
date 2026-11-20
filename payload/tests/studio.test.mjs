import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,mkdir,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import http from 'node:http';
import {once} from 'node:events';
import {splitPrompts,matchAssets,estimate,validate,inferDuration} from '../core.mjs';
import {saveVideoToFolder} from '../folders.mjs';
import {referenceParts,highlightedPrompt} from '../public/references.js';
const model={id:'mock-video',name:'测试模型',min_duration:4,max_duration:30,max_images:2,supported_ratios:['9:16','16:9'],supported_resolutions:['720p'],capability_config:{duration:{mode:'range',min:4,max:30,step:1},outputs:[{code:'720p',ratios:['9:16','16:9']}],references:{images:{max_count:2}},max_prompt_chars:1000},pricing:{rules:[{resolution:'720p',billing_mode:'per_item',unit_price:25,durations:[5,10,30]}]}};
test('分镜边界不拆分正文中的镜头编号，时长覆盖默认参数',()=>{const rows=splitPrompts('{分镜 1}\n【分镜时长 10s】\n镜头1：推镜\n镜头2：转身\n{分镜 2}\n第二条','markers',5);assert.equal(rows.length,2);assert.equal(rows[0].duration,10);assert.match(rows[0].prompt,/镜头2/);assert.equal(rows[1].duration,5);assert.throws(()=>splitPrompts('无分镜标记'));assert.throws(()=>splitPrompts('{分镜 1}\n【分镜时长 5s】【分镜时长 10s】a'));});
test('素材匹配顺序稳定，并忽略成对引号中的名字',()=>{const assets=[{id:'a',name:'顾渊.png'},{id:'b',name:'书桌.png'},{id:'c',name:'茶杯.png'}];assert.deepEqual(matchAssets('书桌前顾渊说：“茶杯”',assets),['b','a']);});
test('引用高亮只标记已选素材，长名称优先，保留文本并转义 HTML',()=>{
 const assets=[{id:'one',name:'林策.png'},{id:'two',name:'林策妈妈.png'}];const text='@林策妈妈看向林策。<img onerror="x">';
 const parts=referenceParts(text,assets);assert.equal(parts.map(p=>p.text).join(''),text);assert.deepEqual(parts.filter(p=>p.asset).map(p=>p.asset.id),['two','one']);
 assert.ok(!highlightedPrompt(text,assets).includes('<img'));assert.ok(!highlightedPrompt(text,[]).includes('<mark'));assert.equal((highlightedPrompt(text,assets).match(/<mark/g)||[]).length,2);
});
test('默认读取末镜结束时间，总时长优先，小数向上取整且不误读正文秒数',()=>{
 assert.equal(inferDuration('｜镜头1｜0–5秒｜中景\n｜镜头2｜5–30秒｜近景\n【表演】\n人物停顿了一秒。',5).duration,30);
 assert.equal(inferDuration('【分镜时长 5s】\n｜镜头1｜0–27.5秒｜全景',5).duration,28);
 assert.equal(inferDuration('｜镜头1｜0–20秒｜全景\n总时间：30秒',5).duration,30);
 assert.equal(inferDuration('0-9.5s\n台词：我等了你60秒。',5).duration,10);
 assert.equal(inferDuration('无时间信息',5).duration,5);
 assert.equal(splitPrompts('{分镜 1}\n｜镜头1｜0–30秒｜全景\n{分镜 2}\n总时长：12秒')[1].duration,12);
});
test('报价只使用匹配价格，未知价格不按免费处理；能力校验正确',()=>{const t={prompt:'画面',duration:5,resolution:'720p',ratio:'9:16'};assert.equal(estimate(model,t),25);assert.equal(estimate(model,{...t,duration:6}),null);assert.deepEqual(validate(t,model,[]),[]);assert.ok(validate({...t,duration:31},model,[]).length);assert.ok(validate(t,model,[1,2,3]).length);});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('本地服务：项目持久化、鉴权隔离、提交结果丢失后用原幂等键恢复、下载和导入',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'jx-test-'));let createCalls=0,unique=0;const keys=new Map();let gotAuth='';
 const upstream=http.createServer(async(req,res)=>{
  gotAuth=req.headers.authorization;let text='';for await(const b of req)text+=b;
  const reply=b=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(b));};
  if(req.url==='/v1/models')return reply({data:[model]});if(req.url==='/v1/balance')return reply({available:1000});
  if(req.url==='/v1/videos/generations'&&req.method==='POST'){createCalls++;const key=req.headers['idempotency-key'];assert.ok(key);assert.equal(JSON.parse(text).model,model.id);if(!keys.has(key)){unique++;keys.set(key,{id:'task_123',public_id:'HM-TEST',status:'queued'});req.socket.destroy();return;}return reply(keys.get(key));}
  if(req.url==='/v1/videos/generations/task_123')return reply({id:'task_123',status:'completed',usage:{credits:25}});
  if(req.url==='/v1/videos/task_123/content'){res.setHeader('Content-Type','video/mp4');if(req.headers.range){res.writeHead(206,{'Content-Range':'bytes 0-3/14','Content-Length':4});return res.end('fake');}return res.end('fake-mp4-bytes');}res.writeHead(404);res.end();
 });upstream.listen(0,'127.0.0.1');await once(upstream,'listening');
 const child=spawn(process.execPath,['server.mjs'],{cwd:path.resolve(import.meta.dirname,'..'),env:{...process.env,PORT:'0',STUDIO_DATA:dir,STUDIO_TEST:'1'},stdio:['ignore','pipe','pipe']});let output='';child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>output+=b);
 try{
  for(let i=0;i<100&&!output.includes('http://');i++)await wait(50);const origin=output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];assert.ok(origin,output);
  const call=async(url,method='GET',body)=>{const r=await fetch(origin+url,{method,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const b=await r.json();assert.equal(r.status,200,JSON.stringify(b));return b;};
  const rejected=await fetch(origin+'/api/state',{headers:{Origin:'https://untrusted.example'}});assert.equal(rejected.status,403);
  const html=await fetch(origin);assert.equal(html.status,200);assert.match(await html.text(),/镜序/);
  // Walk the browser module graph over HTTP: Node imports alone cannot detect
  // a missing static route that prevents every UI handler from initializing.
  const pending=['/app.js'],loaded=new Set();
  while(pending.length){const url=pending.pop();if(loaded.has(url))continue;loaded.add(url);const r=await fetch(origin+url);assert.equal(r.status,200,'Missing browser module: '+url);assert.match(r.headers.get('content-type'),/javascript/);const source=await r.text();for(const match of source.matchAll(/from\s+['"]([^'"]+)['"]/g)){assert.ok(match[1].startsWith('.'),'Unexpected nonlocal browser import');pending.push(new URL(match[1],origin+url).pathname);}}
  assert.ok(loaded.has('/model-catalog.mjs'));assert.ok(loaded.has('/update-ui.js'));

  await call('/api/download-proxy','POST',{mode:'direct'});
  let state=await call('/api/connect','POST',{base:`http://127.0.0.1:${upstream.address().port}`,key:'test-key-never-export'});assert.equal(gotAuth,'Bearer test-key-never-export');assert.ok(!JSON.stringify(state).includes('test-key-never-export'));
  const endpoint='/api/projects/'+state.projects[0].id;
  await call(endpoint,'PATCH',{raw:'{分镜 1}\n测试分镜',defaults:{model:model.id,duration:5,ratio:'9:16',resolution:'720p'}});await call(endpoint+'/parse','POST',{mode:'markers'});
  await call(endpoint+'/start','POST',{concurrency:1});let task;
  for(let i=0;i<100;i++){state=await call('/api/state');task=state.projects[0].tasks[0];if(task.status==='uncertain')break;await wait(50);}assert.equal(task.status,'uncertain');
  const disk=JSON.parse(await readFile(path.join(dir,'projects.json'),'utf8'));assert.ok(disk.projects[0].tasks[0].idempotencyKey);assert.equal(unique,1);
  await call(endpoint+'/tasks/'+task.id+'/recover','POST',{});
  for(let i=0;i<180;i++){state=await call('/api/state');task=state.projects[0].tasks[0];if(task.status==='completed')break;await wait(50);}assert.equal(task.status,'completed');assert.equal(unique,1);assert.equal(createCalls,2);
  const previewUrl=endpoint+'/tasks/'+task.id+'/preview-video';let preview=await fetch(origin+previewUrl,{headers:{Range:'bytes=0-3'}});assert.equal(preview.status,206);assert.equal(await preview.text(),'fake');assert.equal((await readdir(path.join(dir,'videos'))).length,0);
  const destination=path.join(dir,'自选成片目录');await mkdir(destination);
  await call(endpoint+'/download-folder','POST',{folder:destination});
  await call(endpoint+'/tasks/'+task.id+'/download','POST',{});assert.equal(await readFile(path.join(dir,'videos',task.id+'.mp4'),'utf8'),'fake-mp4-bytes');
  const saved=(await readdir(destination))[0];assert.equal(await readFile(path.join(destination,saved),'utf8'),'fake-mp4-bytes');
  await call(endpoint+'/tasks/'+task.id+'/download','POST',{});assert.equal((await readdir(destination)).length,2);
  preview=await fetch(origin+previewUrl,{headers:{Range:'bytes=5-7'}});assert.equal(preview.status,206);assert.equal(await preview.text(),'mp4');
  const imageResponse=await fetch(origin+endpoint+'/assets',{method:'POST',headers:{'Content-Type':'image/png','X-Filename':'test.png'},body:Buffer.from('fake-image')});assert.equal(imageResponse.status,200);const image=(await imageResponse.json()).assets.at(-1);await call(endpoint+'/assets/'+image.id,'DELETE');state=await call('/api/state');assert.ok(!state.projects[0].assets.some(a=>a.id===image.id));assert.equal(state.projects[0].deletedAssetCount,1);assert.equal(state.projects[0].deletedAssets,undefined);const deletedExport=await call(endpoint+'/export');assert.equal(deletedExport.project.deletedAssets,undefined);await call(endpoint+'/restore-asset','POST',{});state=await call('/api/state');assert.ok(state.projects[0].assets.some(a=>a.id===image.id));
  const originalPrompt=task.prompt,originalId=task.remoteId;
  await call(endpoint+'/tasks/'+task.id,'PATCH',{prompt:'修改后的分镜\n｜镜头1｜0–10秒｜全景',autoDuration:true});
  state=await call('/api/state');let source=state.projects[0].tasks[0];assert.equal(source.prompt,originalPrompt);assert.equal(source.remoteId,originalId);assert.equal(source.status,'completed');assert.equal(source.revision.duration,10);
  const regenerateUrl=endpoint+'/tasks/'+task.id+'/regenerate';
  const denied=await fetch(origin+regenerateUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmed:false,confirmationId:'test-confirmation-0001',revisionVersion:source.revisionVersion})});assert.equal(denied.status,400);
  const stale=await fetch(origin+regenerateUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmed:true,confirmationId:'test-confirmation-0001',revisionVersion:0})});assert.equal(stale.status,400);
  const confirmation={confirmed:true,confirmationId:'test-confirmation-0001',revisionVersion:source.revisionVersion};
  const [first,repeat]=await Promise.all([call(regenerateUrl,'POST',confirmation),call(regenerateUrl,'POST',confirmation)]);assert.equal(first.taskId,repeat.taskId);
  state=await call('/api/state');assert.equal(state.projects[0].tasks.filter(t=>t.parentTaskId===task.id).length,1);
  const duplicate=await fetch(origin+regenerateUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...confirmation,confirmationId:'test-confirmation-0002'})});assert.equal(duplicate.status,400);
  for(let i=0;i<100;i++){state=await call('/api/state');const child=state.projects[0].tasks.find(t=>t.id===first.taskId);if(child.status==='uncertain'){assert.match(child.request.prompt,/修改后的分镜/);assert.notEqual(child.idempotencyKey,source.idempotencyKey);break;}await wait(50);}
  const bad=await fetch(origin+endpoint+'/download-folder',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({folder:path.join(dir,'不存在')})});assert.equal(bad.status,400);
  await call(endpoint,'PATCH',{raw:'{分镜 2}\n｜镜头1｜0–30秒｜中景'});await call(endpoint+'/parse','POST',{mode:'markers'});
  state=await call('/api/state');const draft=state.projects[0].tasks.at(-1);assert.equal(draft.duration,30);
  await call(endpoint+'/tasks/'+draft.id,'PATCH',{prompt:'｜镜头1｜0–27.5秒｜全景'});state=await call('/api/state');assert.equal(state.projects[0].tasks.at(-1).duration,28);
  const exported=await call(endpoint+'/export');assert.ok(!JSON.stringify(exported).includes('test-key-never-export'));const imported=await call('/api/import','POST',exported);assert.equal(imported.tasks[0].status,'draft');assert.equal(imported.tasks[0].remoteId,undefined);assert.equal(imported.tasks[0].idempotencyKey,undefined);
 }finally{child.kill();await once(child,'exit');upstream.close();await rm(dir,{recursive:true,force:true});}
});
