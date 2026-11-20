import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {serveLocalVideo,relayVideo} from '../video-stream.mjs';
import {removeAsset,restoreAsset} from '../asset-library.mjs';
import {previewSource} from '../public/media-ui.js';

test('直连预览使用萤漫成片 URL，缓存、代理模式及同站鉴权仍走本机接口',()=>{
 const task={apiBase:'https://yingman.xlapis.com',remote:{url:'https://media.example/video.mp4?signature=test'}};
 const options={url:'/api/projects/p/tasks/t/preview-video',mode:'direct'};
 assert.equal(previewSource(task,options),task.remote.url);
 assert.equal(previewSource({...task,localVideo:'t.mp4'},options),options.url);
 for(const mode of ['builtin','system','custom'])assert.equal(previewSource(task,{...options,mode}),options.url);
 for(const url of ['http://media.example/video.mp4','https://yingman.xlapis.com/v1/videos/t/content','https://user:secret@media.example/video.mp4','invalid'])assert.equal(previewSource({...task,remote:{url}},options),options.url);
 assert.equal(previewSource({...task,remote:{download_url:'https://media.example/download.mp4'}},options),'https://media.example/download.mp4');
});
test('删除素材阻止在途引用，移除草稿与重生引用，可恢复图片且保留已提交请求',()=>{
 const p={assets:[{id:'a',file:'a.png'}],tasks:[{id:'t',status:'queued',assets:['a']}]};
 assert.throws(()=>removeAsset(p,'a'),/生成中/);assert.equal(p.assets.length,1);
 p.tasks[0]={id:'t',status:'completed',assets:['a'],request:{asset_keys:['original']},revision:{assets:['a']},revisionVersion:1};
 removeAsset(p,'a');assert.equal(p.assets.length,0);assert.deepEqual(p.tasks[0].assets,[]);assert.deepEqual(p.tasks[0].revision.assets,[]);assert.deepEqual(p.tasks[0].request.asset_keys,['original']);assert.equal(p.tasks[0].revisionVersion,2);
 restoreAsset(p);assert.equal(p.assets[0].id,'a');assert.equal(p.deletedAssets.length,0);
});
test('在线播放：远端 Range 转发、过期直链回退、缓存分段与取消流清理',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'jx-media-'));const bytes=Buffer.from('0123456789');const file=path.join(dir,'cached.mp4');await writeFile(file,bytes);let range='',auth='',closed=false;
 const upstream=http.createServer((req,res)=>{
  if(req.url==='/expired'){res.writeHead(403);return res.end();}
  if(req.url==='/slow'){res.writeHead(200,{'Content-Type':'video/mp4'});const timer=setInterval(()=>res.write('chunk'),15);res.once('close',()=>{clearInterval(timer);closed=true;});return;}
  range=req.headers.range;auth=req.headers.authorization;
  if(range){res.writeHead(206,{'Content-Length':3,'Content-Range':'bytes 2-4/10','Accept-Ranges':'bytes'});res.end(bytes.subarray(2,5));}else res.end(bytes);
 });upstream.listen(0,'127.0.0.1');await once(upstream,'listening');const source='http://127.0.0.1:'+upstream.address().port;
 const server=http.createServer(async(req,res)=>{try{
  if(req.url==='/cached')return await serveLocalVideo(req,res,file);
  return await relayVideo(req,res,{direct:req.url==='/remote'?source+'/expired':undefined,fallback:source+(req.url==='/slow'?'/slow':'/content'),authorization:'Bearer test',config:{mode:'direct'},allowHttp:true});
 }catch{res.destroy();}});server.listen(0,'127.0.0.1');await once(server,'listening');const origin='http://127.0.0.1:'+server.address().port;
 try{
  let r=await fetch(origin+'/remote',{headers:{Range:'bytes=2-4'}});assert.equal(r.status,206);assert.equal(await r.text(),'234');assert.equal(range,'bytes=2-4');assert.equal(auth,'Bearer test');assert.equal(r.headers.get('content-disposition'),'inline');
  for(const [range,expected] of [['bytes=2-4','234'],['bytes=-3','789'],['bytes=8-','89']]){r=await fetch(origin+'/cached',{headers:{Range:range}});assert.equal(r.status,206);assert.equal(await r.text(),expected);}
  r=await fetch(origin+'/cached',{headers:{Range:'bytes=99-'}});assert.equal(r.status,416);assert.equal(r.headers.get('content-range'),'bytes */10');
  r=await fetch(origin+'/cached',{method:'HEAD',headers:{Range:'bytes=0-1'}});assert.equal(r.status,206);assert.equal(r.headers.get('content-length'),'2');assert.equal(await r.text(),'');
  const abort=new AbortController();r=await fetch(origin+'/slow',{signal:abort.signal});await r.body.getReader().read();abort.abort();for(let i=0;i<50&&!closed;i++)await new Promise(r=>setTimeout(r,20));assert.equal(closed,true);
 }finally{server.closeAllConnections();server.close();upstream.closeAllConnections();upstream.close();await rm(dir,{recursive:true,force:true});}
});
