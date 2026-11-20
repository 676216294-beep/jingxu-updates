import {providers,protocolFor,taskProtocol,videoRoute,preferredModel,enrichModelDetails,normalizeModels,yingmanPayload,yingmanForm} from './providers.mjs';
import {familyOf} from './public/history.mjs';
import {OnlineUpdate} from './online-update.mjs';
import http from 'node:http';
import {readFile,writeFile,mkdir,rename,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {splitPrompts,matchAssets,estimate,validate,inferDuration} from './core.mjs';
import {pickFolder,checkFolder,saveVideoToFolder} from './folders.mjs';
import {validateProxyConfig,publicProxyConfig,streamDownload,testDownloadConnection} from './download-proxy.mjs';
import {BuiltinProxy} from './builtin-proxy.mjs';
import {serveLocalVideo,relayVideo} from './video-stream.mjs';
import {removeAsset,restoreAsset} from './asset-library.mjs';
const root=path.dirname(fileURLToPath(import.meta.url)), dir=path.resolve(process.env.STUDIO_DATA||path.join(root,'data'));
await mkdir(path.join(dir,'assets'),{recursive:true}); await mkdir(path.join(dir,'videos'),{recursive:true});
const initial=()=>({projects:[{id:randomUUID(),name:'我的第一个视频合集',assets:[],tasks:[],raw:'',defaults:{model:'',ratio:'9:16',resolution:'720p',duration:5},prefix:'',suffix:''}]});
let db;try{db=JSON.parse(await readFile(path.join(dir,'projects.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;db=initial();}
let downloadProxy={mode:'builtin',url:''};try{downloadProxy=validateProxyConfig(JSON.parse(await readFile(path.join(dir,'download-settings.json'),'utf8')));}catch{}
const builtinProxy=await new BuiltinProxy({root,dir}).init();
const resolvedProxy=config=>config.mode==='builtin'?builtinProxy.config():config;
const downloadJobs={},downloadLocks=new Map(),previewStreams=new Set();
const mediaBusy=()=>previewStreams.size||Object.values(downloadJobs).some(j=>j.status==='downloading');
let apiKey=process.env.HUIMIAO_API_KEY||'', base=process.env.HUIMIAO_BASE_URL||'https://huimiaovip.com', models=[], balance=null;
let protocol=protocolFor(base);try{const saved=JSON.parse(await readFile(path.join(dir,'api-settings.json'),'utf8'));if(!process.env.HUIMIAO_BASE_URL){base=saved.base;protocol=saved.protocol||protocolFor(base);}}catch{}
let writing=Promise.resolve(), running=false, concurrency=2, ticking=false;const active=new Set(), assetLocks=new Map();
function save(){const value=JSON.stringify(db,null,2);writing=writing.then(async()=>{await writeFile(path.join(dir,'projects.tmp'),value);await rename(path.join(dir,'projects.tmp'),path.join(dir,'projects.json'));});return writing;}
// A restart never creates new tasks automatically. Known remote tasks can still be queried.
for(const p of db.projects)for(const t of p.tasks){if(t.status==='uploading')t.status='draft';if(t.status==='submitting')t.status='uncertain';if(t.status==='draft'&&!t.request&&!t.durationSource)Object.assign(t,inferDuration(t.prompt,t.duration));}
await save();
const pause=ms=>new Promise(r=>setTimeout(r,ms));
function safeError(e){return String(e.message||e).replaceAll(apiKey||'__no_key__','[密钥已隐藏]');}
async function api(endpoint,{method='GET',body,key,timeout}={}){
 if(!apiKey)throw Error('请先在接口设置中填写 API Key');
 const headers={Authorization:`Bearer ${apiKey}`};const multipart=body instanceof FormData;if(body&&!multipart)headers['Content-Type']='application/json; charset=utf-8';if(key)headers['Idempotency-Key']=key;
 const r=await fetch(base+endpoint,{method,headers,body:body?(multipart?body:JSON.stringify(body)):undefined,signal:AbortSignal.timeout(timeout||(multipart?180000:60000)),redirect:'error'});
 const data=await r.json().catch(()=>({}));
 if(!r.ok){const e=Error(`${data.error?.message||'接口请求失败'} (${data.error?.code||r.status})${r.headers.get('x-request-id')?' · 请求号 '+r.headers.get('x-request-id'):''}`);e.status=r.status;e.retryAfter=r.headers.get('retry-after');throw e;}return data;
}
async function retryRead(endpoint,options){for(let n=0;;n++){try{return await api(endpoint,options);}catch(e){if(n>=3||!(e.status===429||e.status>=500))throw e; const val=Number(e.retryAfter);await pause(Math.min(60000,Number.isFinite(val)&&val>0?val*1000:2000*2**n));}}}
function finalPrompt(p,t){const names=t.assets.map(id=>p.assets.find(a=>a.id===id)).filter(Boolean).map((a,i)=>`${a.name.replace(/\.[^.]+$/,'')}是${protocol==='yingman'?'@图片':'参考图'}${i+1}`).join('，');return [p.prefix,names,t.prompt,p.suffix].filter(Boolean).join('\n\n');}
function payload(p,t){if(protocol==='yingman')return yingmanPayload(t,t.assets.map(id=>p.assets.find(a=>a.id===id)).filter(Boolean),t.preparedPrompt||finalPrompt(p,t));return {model:t.model,prompt:t.preparedPrompt||finalPrompt(p,t),ratio:t.ratio,duration:Number(t.duration),resolution:t.resolution,asset_keys:t.assets.map(id=>p.assets.find(a=>a.id===id)?.objectKey).filter(Boolean)};}
async function upload(a){
 if(a.objectKey&&a.uploadBase===base)return a.objectKey;
 if(assetLocks.has(a.id))return assetLocks.get(a.id);
 const job=(async()=>{const bytes=await readFile(path.join(dir,'assets',a.file));
  const pre=await api('/v1/uploads/presign',{method:'POST',body:{filename:a.name,content_type:a.type,size:bytes.length}});
  if(!pre.put_url||!pre.object_key)throw Error('上传授权缺少 put_url 或 object_key');
  if(new URL(pre.put_url).protocol!=='https:')throw Error('平台返回了非 HTTPS 上传地址');
  // Signed storage headers only; never forward the platform API key.
  const put=await fetch(pre.put_url,{method:'PUT',headers:pre.headers,body:bytes,redirect:'error',signal:AbortSignal.timeout(180000)});
  if(!put.ok && put.status!==412)throw Error(`素材直传失败 HTTP ${put.status}`);
  const done=await retryRead('/v1/uploads/complete',{method:'POST',body:{object_key:pre.object_key}});
  if(done.verified!==true)throw Error('素材未通过平台校验');a.objectKey=pre.object_key;a.uploadBase=base;await save();return a.objectKey;
 })();assetLocks.set(a.id,job);try{return await job;}finally{assetLocks.delete(a.id);}
}
async function submit(p,t){
 active.add(t.id);try{
  if(!t.request){t.apiProtocol=protocol;t.status='uploading';await save();if(protocol!=='yingman')for(const id of t.assets){const a=p.assets.find(a=>a.id===id);if(!a)throw Error('引用的素材已丢失');await upload(a);}t.request=payload(p,t);t.idempotencyKey ||=randomUUID();}
  // Persist exact request and idempotency key before making the chargeable call.
  t.status='submitting';t.apiBase=base;await save();
  let result;
  try{const proto=taskProtocol(t,base);const requestBody=proto==='yingman'?await yingmanForm(t.request,file=>readFile(path.join(dir,'assets',file))):t.request;result=await api(videoRoute(proto),{method:'POST',body:requestBody,key:t.idempotencyKey});}
  catch(e){t.status=e.status&&e.status<500&&e.status!==429?'error':'uncertain';throw e;}
  if(!result.id){t.status='uncertain';throw Error('未返回任务编号，请复用原请求查询');}
  t.remoteId=String(result.id);t.remote=result;t.status=result.status||'queued';t.error='';t.nextPoll=Date.now()+5000;
 }catch(e){t.error=safeError(e);if(t.status==='uploading')t.status='error';}finally{active.delete(t.id);await save();}
}
async function poll(t){active.add(t.id);try{
 if(t.apiBase&&t.apiBase!==base)throw Error('该任务属于其他站点，请切换到原 API 地址');
 t.remote=await api(videoRoute(taskProtocol(t,base),t.remoteId));t.status=t.remote.status;t.error=t.status==='failed'?(t.remote.error?.message||t.remote.failure_reason||'平台生成失败'):'';
 t.nextPoll=Date.now()+Math.min(20000,(t.pollCount=(t.pollCount||0)+1)<12?5000:15000);
 }catch(e){t.error=safeError(e);t.nextPoll=Date.now()+30000;}finally{active.delete(t.id);await save();}}
async function tick(){if(ticking||!apiKey)return;ticking=true;try{
 const all=db.projects.flatMap(p=>p.tasks.map(t=>({p,t})));
 const checking=all.filter(({t})=>t.remoteId&&['queued','in_progress'].includes(t.status)&&!active.has(t.id)&&(!t.nextPoll||t.nextPoll<=Date.now())).slice(0,2);
 for(const {t}of checking)void poll(t);
 if(running)for(const {p,t}of all){if(active.size>=concurrency)break;if(t.status==='pending'&&!active.has(t.id))void submit(p,t);}
 if(!all.some(({t})=>['pending','uploading','submitting'].includes(t.status)))running=false;
 }finally{ticking=false;}}
const timer=setInterval(tick,1000);
function view(){return {...db,projects:db.projects.map(({deletedAssets,...p})=>({...p,deletedAssetCount:deletedAssets?.length||0})),connected:!!apiKey,base,models,balance,running,concurrency,providers,protocol,preferredModel:preferredModel(models,protocol),downloadProxy:publicProxyConfig(downloadProxy),builtinProxy:builtinProxy.view(),downloadJobs};}
const onlineUpdate=new OnlineUpdate({root,config:()=>{try{return resolvedProxy(downloadProxy);}catch{return {mode:'direct'};}},runnerEnv:()=>({...process.env,HUIMIAO_API_KEY:apiKey,HUIMIAO_BASE_URL:base,STUDIO_DATA:dir}),restart:async()=>{await save();await builtinProxy.stop();clearInterval(timer);setTimeout(()=>{server.closeAllConnections();server.close();process.exit(42);},700);}});
const json=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));};
async function body(req,limit=1024*1024){let parts=[],n=0;for await(const b of req){n+=b.length;if(n>limit)throw Error('文件或请求超过大小限制');parts.push(b);}return Buffer.concat(parts);}
async function readJson(req,limit){return JSON.parse((await body(req,limit)).toString('utf8')||'{}');}
const project=id=>{const p=db.projects.find(p=>p.id===id);if(!p)throw Error('合集不存在');return p;};
function editable(t){return ['draft','error','failed','cancelled'].includes(t.status)&&!t.request&&!active.has(t.id);}
async function performDownload(t){
 if(t.status!=='completed')throw Error('视频尚未完成');
 if(t.localVideo){const cached=path.join(dir,'videos',t.localVideo);try{await stat(cached);return cached;}catch{}}
 if(t.apiBase!==base)throw Error('请切换到任务原站点下载');
 const filename=t.id+'.mp4',file=path.join(dir,'videos',filename);
 const config=resolvedProxy({...downloadProxy});downloadJobs[t.id]={status:'downloading',bytes:0,total:0,speed:0,mode:downloadProxy.mode};
 const onProgress=progress=>Object.assign(downloadJobs[t.id],progress);
 const fallback=base+'/v1/videos/'+encodeURIComponent(t.remoteId)+'/content';
 let direct;try{const candidate=new URL(t.remote?.download_url||(taskProtocol(t,base)==='yingman'?t.remote?.url:undefined));if(candidate.protocol==='https:')direct=candidate.href;}catch{}
 const options={config,allowHttp:process.env.STUDIO_TEST==='1',onProgress};
 try{
  if(direct){try{await streamDownload(direct,file+'.part',{...options,headers:new URL(direct).origin===base?{Authorization:`Bearer ${apiKey}`}:{}});}catch(error){
   // Refresh expired signed URLs through the content endpoint, retaining the same proxy.
   if(!/HTTP (401|403|404|410)/.test(error.message))throw error;
   await streamDownload(fallback,file+'.part',{...options,headers:{Authorization:`Bearer ${apiKey}`}});
  }}else await streamDownload(fallback,file+'.part',{...options,headers:{Authorization:`Bearer ${apiKey}`}});
  await rename(file+'.part',file);t.localVideo=filename;downloadJobs[t.id].status='completed';await save();return file;
 }catch(error){downloadJobs[t.id].status='error';downloadJobs[t.id].error=safeError(error);throw error;}
}
async function download(t){if(downloadLocks.has(t.id))return downloadLocks.get(t.id);const job=performDownload(t);downloadLocks.set(t.id,job);try{return await job;}finally{downloadLocks.delete(t.id);}}
export const server=http.createServer(async(req,res)=>{try{
 const url=new URL(req.url,'http://localhost');
 const host=req.headers.host;if(!host||!['127.0.0.1','localhost','[::1]'].includes(host.replace(/:\d+$/,''))){res.writeHead(403);return res.end();}
 if(req.headers.origin&&req.headers.origin!==`http://${host}`){res.writeHead(403);return res.end('Origin rejected');}
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
 if(req.method==='GET'&&url.pathname==='/api/updates'){let value=onlineUpdate.state;if(value.status==='idle'){try{value=JSON.parse(await readFile(path.join(root,'.updates','online-status.json'),'utf8'));}catch{}}return json(res,{...value,current:await onlineUpdate.current()});}
 if(req.method==='POST'&&url.pathname==='/api/updates/check')return json(res,await onlineUpdate.check());
 if(req.method==='POST'&&url.pathname==='/api/updates/install'){
  if(running||active.size||downloadLocks.size||previewStreams.size||builtinProxy.testRun.running||db.projects.some(p=>p.tasks.some(t=>['pending','uploading','submitting','queued','in_progress'].includes(t.status))))throw Error('请等待生成与下载完成，关闭视频预览并停止节点检测后更新');
  return json(res,await onlineUpdate.start());
 }
 if(!['GET','HEAD'].includes(req.method)&&['downloading','installing'].includes(onlineUpdate.state.status))throw Error('正在更新软件，请稍候再操作');
 if(url.pathname==='/api/installation')return json(res,{root,dataDir:dir,version:await onlineUpdate.current()});
 if(url.pathname==='/api/state')return json(res,view());
 if(req.method==='POST'&&url.pathname.startsWith('/api/builtin-proxy/')){
  const action=url.pathname.slice('/api/builtin-proxy/'.length),b=await readJson(req,5*1024*1024);
  if(action==='test'){builtinProxy.startTests(b.ids);return json(res,builtinProxy.view());}
  if(action==='cancel-tests'){builtinProxy.cancelTests();return json(res,builtinProxy.view());}
  if(mediaBusy())throw Error('请先关闭成片预览并等待视频下载完成，再切换内置节点');
  if(action==='import')return json(res,await builtinProxy.import(b));
  if(action==='connect'){const result=await builtinProxy.connect(b.nodeId);downloadProxy={mode:'builtin',url:''};await writeFile(path.join(dir,'download-settings.json'),JSON.stringify(downloadProxy));return json(res,result);}
  if(action==='stop'){if(builtinProxy.busy)throw Error('内置代理正在切换，请稍候');await builtinProxy.stop();return json(res,builtinProxy.view());}
  throw Error('未知的内置代理操作');
 }
 if(req.method==='POST'&&url.pathname==='/api/download-proxy'){
  const config=validateProxyConfig(await readJson(req));
  await writeFile(path.join(dir,'download-settings.json'),JSON.stringify(config,null,2));downloadProxy=config;return json(res,publicProxyConfig(config));
 }
 if(req.method==='POST'&&url.pathname==='/api/download-proxy/test'){
  const b=await readJson(req);const config=resolvedProxy(validateProxyConfig(b));return json(res,await testDownloadConnection({config}));
 }
 if(req.method==='POST'&&url.pathname==='/api/connect'){
  if(active.size||running)throw Error('请先暂停队列并等待当前请求完成后切换接口');
  const b=await readJson(req);const u=new URL(b.base||base);if(u.protocol!=='https:' && !(process.env.STUDIO_TEST==='1'&&u.hostname==='127.0.0.1'))throw Error('接口地址必须使用 HTTPS');
  if(u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('只填写站点根地址，例如 https://huimiaovip.com');
  const nextKey=String(b.key||(u.origin===base?apiKey:'')).trim();if(!nextKey)throw Error('请填写 API Key');
  const old={apiKey,base,protocol,models,balance};apiKey=nextKey;base=u.origin;protocol=process.env.STUDIO_TEST==='1'&&b.protocol?b.protocol:protocolFor(base);try{const m=await api('/v1/models');models=normalizeModels(protocol==='yingman'?await enrichModelDetails(m.data||[],endpoint=>api(endpoint,{timeout:8000})):m.data||[],protocol);balance=await api('/v1/balance');}catch(e){({apiKey,base,protocol,models,balance}=old);throw e;}await writeFile(path.join(dir,'api-settings.json'),JSON.stringify({base,protocol}));
  if(old.apiKey!==apiKey||old.base!==base){for(const pr of db.projects)for(const a of pr.assets){delete a.objectKey;delete a.uploadBase;}await save();}
  return json(res,view());
 }
 if(req.method==='POST'&&url.pathname==='/api/projects'){const p=initial().projects[0];p.defaults.model=preferredModel(models,protocol)||p.defaults.model;p.name='新建合集';db.projects.push(p);await save();return json(res,p);}
 if(req.method==='POST'&&url.pathname==='/api/pause'){running=false;await save();return json(res,view());}
 const m=url.pathname.match(/^\/api\/projects\/([^/]+)(?:\/(.*))?$/);
 if(m){const p=project(m[1]),action=m[2]||'';
  if(req.method==='PATCH'&&!action){const b=await readJson(req);for(const k of ['name','raw','defaults','prefix','suffix'])if(b[k]!==undefined)p[k]=b[k];await save();return json(res,p);}
  if(req.method==='POST'&&action==='download-folder'){
   const b=await readJson(req);let folder=b.browse?await pickFolder():await checkFolder(b.folder);
   if(folder){p.downloadFolder=folder;await save();}return json(res,{folder:p.downloadFolder||'',cancelled:!folder});
  }
  if(req.method==='POST'&&action==='read-durations'){
   let count=0;for(const t of p.tasks)if(editable(t)){Object.assign(t,inferDuration(t.prompt,t.duration||p.defaults.duration));count++;}await save();return json(res,{count});
  }
  if(req.method==='POST'&&action==='parse'){const b=await readJson(req);const rows=splitPrompts(p.raw,b.mode,p.defaults.duration);p.tasks.push(...rows.map(t=>({...p.defaults,...t,id:randomUUID(),createdAt:Date.now(),status:'draft',assets:matchAssets(t.prompt,p.assets)})));await save();return json(res,p);}
  if(req.method==='POST'&&action==='assets'){
   const type=String(req.headers['content-type']||'').split(';')[0], exts={'image/png':'.png','image/jpeg':'.jpg','image/webp':'.webp'};
   if(!exts[type])throw Error('本版本支持 PNG、JPG、WebP 资产图');const bytes=await body(req,20*1024*1024);if(!bytes.length)throw Error('图片为空');
   const id=randomUUID(),name=path.basename(decodeURIComponent(req.headers['x-filename']||'素材'+exts[type]));const file=id+exts[type];await writeFile(path.join(dir,'assets',file),bytes);p.assets.push({id,name,file,type,size:bytes.length});await save();return json(res,p);
  }
  const assetMatch=action.match(/^assets\/([^/]+)$/);
  if(req.method==='DELETE'&&assetMatch){const removed=removeAsset(p,assetMatch[1],{active,uploading:assetLocks});await save();return json(res,{removedId:removed.id});}
  if(req.method==='POST'&&action==='restore-asset'){const restored=restoreAsset(p);await save();return json(res,{restoredId:restored.id});}
  if(req.method==='POST'&&action==='match'){for(const t of p.tasks)if(editable(t))t.assets=matchAssets(t.prompt,p.assets);await save();return json(res,p);}
  if(req.method==='POST'&&action==='start'){
   if(!apiKey||!models.length)throw Error('请先连接 API');const b=await readJson(req);concurrency=Math.max(1,Math.min(6,Number(b.concurrency)||2));
   const tasks=p.tasks.filter(t=>(!b.ids||b.ids.includes(t.id))&&['draft','pending'].includes(t.status));if(!tasks.length)throw Error('没有未提交分镜');
   for(const t of tasks){const errors=validate(t,models.find(m=>m.id===t.model),t.assets.map(id=>p.assets.find(a=>a.id===id)).filter(Boolean),finalPrompt(p,t));if(errors.length)throw Error(`${t.label}：${errors.join('；')}`);}
   for(const t of tasks){t.preparedPrompt=finalPrompt(p,t);t.status='pending';}running=true;await save();void tick();return json(res,view());
  }
  if(req.method==='GET'&&action==='export'){const out=structuredClone(p);delete out.downloadFolder;delete out.deletedAssets;for(const a of out.assets){a.bytes=(await readFile(path.join(dir,'assets',a.file))).toString('base64');delete a.objectKey;delete a.uploadBase;}res.setHeader('Content-Disposition','attachment; filename="huimiao-project.json"');return json(res,{format:'huimiao-local-v1',project:out});}
  const tm=action.match(/^tasks\/([^/]+)(?:\/(.*))?$/);
  if(tm){const t=p.tasks.find(t=>t.id===tm[1]);if(!t)throw Error('任务不存在');const op=tm[2]||'';
   if(req.method==='PATCH'&&!op){
    if(active.has(t.id)||!['draft','completed','error','failed','cancelled'].includes(t.status))throw Error('此任务正在处理或结果尚未确认，当前不可编辑');
    const b=await readJson(req),target={...(t.revision||t)};
    for(const k of ['prompt','assets','model','duration','ratio','resolution'])if(b[k]!==undefined)target[k]=b[k];
    if(typeof target.prompt!=='string'||!target.prompt.trim())throw Error('提示词不能为空');
    if(!Array.isArray(target.assets)||target.assets.some(id=>!p.assets.some(a=>a.id===id)))throw Error('引用的素材不存在');
    if(b.autoDuration||('prompt' in b&&!('duration' in b)))Object.assign(target,inferDuration(target.prompt,target.duration||p.defaults.duration));else if('duration' in b)target.durationSource='手动设置';
    const fields=['prompt','assets','model','duration','ratio','resolution','durationSource','detectedDuration'];
    if(t.request||t.remoteId||t.status==='completed'){t.revision=Object.fromEntries(fields.map(k=>[k,target[k]]));t.revisionVersion=(t.revisionVersion||0)+1;}
    else for(const k of fields)t[k]=target[k];
    await save();return json(res,t);
   }
   if(req.method==='POST'&&op==='regenerate'){
    const b=await readJson(req);
    if(b.confirmed!==true||typeof b.confirmationId!=='string'||!/^[-a-zA-Z0-9_]{8,80}$/.test(b.confirmationId))throw Error('请在弹窗中确认重新生成');
    const previous=t.regenerations?.find(r=>r.confirmationId===b.confirmationId);
    if(previous)return json(res,{taskId:previous.taskId,reused:true});
    if(active.has(t.id)||!['completed','error','failed','cancelled'].includes(t.status))throw Error('请先恢复确认原请求结果，再重新生成');
    if(familyOf(p.tasks,t).some(x=>x.id!==t.id&&['pending','uploading','submitting','uncertain','queued','in_progress'].includes(x.status)))throw Error('此分镜已有任务正在处理或等待确认，请勿重复生成');
    if(t.regenerations?.some(r=>{const task=p.tasks.find(x=>x.id===r.taskId);return task&&['pending','uploading','submitting','uncertain','queued','in_progress'].includes(task.status);}))throw Error('此分镜已有重新生成任务正在处理，请等待完成，避免重复提交');
    if(Number(b.revisionVersion)!==(t.revisionVersion||0))throw Error('分镜内容已变化，请重新检查后确认');
    if(!apiKey||!models.length)throw Error('请先连接 API');
    const source=t.revision||t;
    const copy={id:randomUUID(),createdAt:Date.now(),parentTaskId:t.id,label:t.label+' 重生 '+((t.regenerations?.length||0)+1),prompt:source.prompt,assets:[...source.assets],model:source.model,duration:source.duration,ratio:source.ratio,resolution:source.resolution,durationSource:source.durationSource,status:'pending'};
    const errors=validate(copy,models.find(m=>m.id===copy.model),copy.assets.map(id=>p.assets.find(a=>a.id===id)).filter(Boolean),finalPrompt(p,copy));if(errors.length)throw Error(errors.join('；'));
    copy.preparedPrompt=finalPrompt(p,copy);
    t.regenerations||=[];t.regenerations.push({confirmationId:b.confirmationId,taskId:copy.id});p.tasks.push(copy);
    // Commit the confirmation-to-task mapping before starting a chargeable request.
    await save();running=true;void tick();return json(res,{taskId:copy.id,reused:false});
   }
   if(req.method==='DELETE'&&!op){if(!editable(t)||t.request)throw Error('此任务已提交或正在处理中，不能删除');p.tasks=p.tasks.filter(x=>x!==t);await save();return json(res,p);}
   if(req.method==='POST'&&op==='duplicate'){const source=t.revision||t;const copy={...p.defaults,prompt:source.prompt,label:t.label+' 副本',assets:[...source.assets],model:source.model,duration:source.duration,ratio:source.ratio,resolution:source.resolution,id:randomUUID(),status:'draft'};p.tasks.push(copy);await save();return json(res,p);}
   if(req.method==='POST'&&op==='recover'){if(!['uncertain','error'].includes(t.status)||!t.request||active.has(t.id))throw Error('此任务无需恢复或正在重试');if(!apiKey)throw Error('请先连接 API');if(t.apiBase&&t.apiBase!==base)throw Error('请切换到任务原 API 站点恢复');if(taskProtocol(t,base)==='yingman'&&t.status==='uncertain'){if(t.remoteId){void poll(t);return json(res,{taskId:t.id,recovered:true});}throw Error('萤漫未明确保证视频重复提交的幂等性，请先到萤漫任务页确认结果，确认未生成后再复制分镜提交');}if(!t.idempotencyKey)throw Error('缺少原请求标识，无法安全恢复，请先到平台确认结果');void submit(p,t);return json(res,{taskId:t.id,recovered:true});}
   if(req.method==='POST'&&op==='cancel'){if(t.status==='pending'){t.status='draft';}else if(t.status==='queued'){if(taskProtocol(t,base)==='yingman')throw Error('萤漫文档未提供取消接口，请到萤漫任务页操作');t.remote=await api('/v1/videos/generations/'+encodeURIComponent(t.remoteId),{method:'DELETE'});t.status=t.remote.status||'cancelled';}else throw Error('只可撤回本地排队或取消平台排队任务');await save();return json(res,t);}
   if(req.method==='POST'&&op==='download'){
    // Check the user-selected folder before retrieving any remote video.
    const folder=p.downloadFolder?await checkFolder(p.downloadFolder):null;
    const file=await download(t);if(folder){t.savedPath=await saveVideoToFolder(file,folder,t.label,t.remote?.public_id||t.id);await save();}return json(res,t);
   }
   if(['GET','HEAD'].includes(req.method)&&['preview-video','video'].includes(op)){
    if(op==='video'){if(!t.localVideo)throw Error('请先下载视频');return await serveLocalVideo(req,res,path.join(dir,'videos',t.localVideo),{attachment:true});}
    if(t.status!=='completed')throw Error('视频尚未生成完成');
    if(t.localVideo){const file=path.join(dir,'videos',t.localVideo);if(await stat(file).catch(()=>null))return await serveLocalVideo(req,res,file);}
    if(t.apiBase!==base)throw Error('请切换到任务原站点预览');
    let direct;try{const u=new URL(t.remote?.download_url);if(u.protocol==='https:')direct=u.href;}catch{}
    const streamId=randomUUID();previewStreams.add(streamId);
    try{return await relayVideo(req,res,{direct,fallback:base+'/v1/videos/'+encodeURIComponent(t.remoteId)+'/content',authorization:'Bearer '+apiKey,config:resolvedProxy({...downloadProxy}),allowHttp:process.env.STUDIO_TEST==='1'});}finally{previewStreams.delete(streamId);}
   }
  }
 }
 if(req.method==='POST'&&url.pathname==='/api/import'){
  const b=await readJson(req,300*1024*1024);if(b.format!=='huimiao-local-v1'||!b.project||!Array.isArray(b.project.tasks)||!Array.isArray(b.project.assets))throw Error('项目文件格式错误');
  const p=b.project;p.id=randomUUID();p.name=String(p.name||'导入合集')+'（导入）';delete p.downloadFolder;delete p.deletedAssets;
  for(const a of p.assets){const file=randomUUID()+'.asset';const bytes=Buffer.from(a.bytes||'','base64');if(bytes.length>20*1024*1024)throw Error('导入素材过大');await writeFile(path.join(dir,'assets',file),bytes);a.file=file;delete a.bytes;delete a.objectKey;delete a.uploadBase;}
  // Import as drafts: a portable project never reuses another computer's billing state.
  p.tasks=p.tasks.map(t=>{const source=t.revision||t;return {id:randomUUID(),label:t.label,prompt:source.prompt,assets:source.assets,model:source.model,duration:source.duration,ratio:source.ratio,resolution:source.resolution,status:'draft'};});db.projects.push(p);await save();return json(res,p);
 }
 const am=url.pathname.match(/^\/assets\/([a-zA-Z0-9.-]+)$/);if(am){const a=db.projects.flatMap(p=>p.assets).find(a=>a.file===am[1]);if(!a)throw Error('素材不存在');res.writeHead(200,{'Content-Type':a.type});return res.end(await readFile(path.join(dir,'assets',a.file)));}
 const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css','/task-ui.js':'task-ui.js','/references.js':'references.js','/download-ui.js':'download-ui.js','/builtin-ui.js':'builtin-ui.js','/media-ui.js':'media-ui.js','/model-catalog.mjs':'model-catalog.mjs','/history.mjs':'history.mjs','/update-ui.js':'update-ui.js'};if(files[url.pathname]){const file=files[url.pathname];res.writeHead(200,{'Content-Type':file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.css')?'text/css':'text/javascript; charset=utf-8','Cache-Control':'no-store'});return res.end(await readFile(path.join(root,'public',file)));}
 json(res,{error:'找不到页面'},404);
 }catch(e){if(res.headersSent||res.destroyed)return res.destroy();json(res,{error:safeError(e)},400);}});
server.listen(Number(process.env.PORT||4318),'127.0.0.1',()=>console.log(`镜序 · Huimiao 本地工作台 http://127.0.0.1:${server.address().port}`));
if(process.env.STUDIO_TEST!=='1')void (async()=>{try{if(!builtinProxy.nodes.length&&builtinProxy.subscriptionUrl)await builtinProxy.import({update:true});if(downloadProxy.mode==='builtin'&&builtinProxy.selectedId&&builtinProxy.available)await builtinProxy.connect(builtinProxy.selectedId);}catch(e){builtinProxy.status='error';builtinProxy.error=e.message;}})();
process.on('exit',()=>{if(builtinProxy.runner?.connected)builtinProxy.runner.disconnect();});
process.on('SIGTERM',()=>{clearInterval(timer);builtinProxy.cancelTests();void builtinProxy.stop().finally(()=>{server.close();});});
