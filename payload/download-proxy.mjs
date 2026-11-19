import http from 'node:http';
import https from 'node:https';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
import {createWriteStream} from 'node:fs';
export function validateProxyConfig(config){
 if(!['builtin','system','custom','direct'].includes(config.mode))throw Error('请选择有效的下载方式');
 if(config.mode!=='custom')return {mode:config.mode,url:''};
 let url;try{url=new URL(String(config.url||'').trim());}catch{throw Error('请填写完整代理地址，例如 http://127.0.0.1:10808');}
 if(!['http:','https:'].includes(url.protocol))throw Error('当前支持 HTTP / HTTPS 代理，请使用代理软件的 HTTP 或混合端口');
 if(url.username||url.password)throw Error('请使用无认证的本机 HTTP 代理端口；此版本不保存代理账号密码');
 if(url.pathname!=='/'||url.search||url.hash)throw Error('代理地址只需协议、主机和端口');
 return {mode:'custom',url:url.origin};
}
export function proxyEnvironment(config,env=process.env){
 config=validateProxyConfig(config);
 if(config.mode==='builtin')throw Error('请先连接内置订阅节点');
 if(config.mode==='direct')return {};
 if(config.mode==='custom')return {HTTP_PROXY:config.url,HTTPS_PROXY:config.url,NO_PROXY:''};
 return {...env};
}
export function publicProxyConfig(config,env=process.env){
 const raw=env.https_proxy||env.HTTPS_PROXY||env.http_proxy||env.HTTP_PROXY;let systemUrl='';
 try{const url=new URL(raw);systemUrl=url.origin;}catch{}
 return {...config,systemUrl};
}
export async function openDownload(url,{headers={},config={mode:'system'},env=process.env,allowHttp=false,timeout=60000,signal,ca}={}){
 const proxyEnv=proxyEnvironment(config,env);
 const agents={http:new http.Agent({keepAlive:true,proxyEnv}),https:new https.Agent({keepAlive:true,proxyEnv,ca})};
 const close=()=>{agents.http.destroy();agents.https.destroy();};
 try{
  for(let hop=0;hop<7;hop++){
   const target=new URL(url);
   if(target.username||target.password||(!allowHttp&&target.protocol!=='https:')||!['http:','https:'].includes(target.protocol))throw Error('视频下载地址必须使用 HTTPS');
   const response=await new Promise((resolve,reject)=>{
    const req=(target.protocol==='https:'?https:http).get(target,{agent:target.protocol==='https:'?agents.https:agents.http,headers,signal},resolve);
    req.setTimeout(timeout,()=>req.destroy(Error('视频连接或传输超时，请检查下载代理')));req.on('error',reject);
   });
   if([301,302,303,307,308].includes(response.statusCode)){
    const location=response.headers.location;response.resume();if(!location)throw Error('下载跳转缺少目标地址');
    const next=new URL(location,target);if(next.origin!==target.origin)headers={};url=next.href;continue;
   }
   return {response,close,url:target.href};
  }
  throw Error('视频下载跳转次数过多');
 }catch(error){close();const prefix=config.mode==='custom'?'指定下载代理请求失败':'视频下载连接失败';throw Error(`${prefix}：${error.code||error.message}`);}
}
export async function streamDownload(url,file,{onProgress=()=>{},...options}={}){
 const {response,close}=await openDownload(url,{...options,signal:AbortSignal.timeout(30*60*1000)});
 try{
  if(response.statusCode<200||response.statusCode>=300){response.resume();throw Error('视频下载失败 HTTP '+response.statusCode);}
  let bytes=0;const total=Number(response.headers['content-length'])||0,start=Date.now();onProgress({bytes,total,speed:0});
  const meter=new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;onProgress({bytes,total,speed:Math.round(bytes/Math.max(.1,(Date.now()-start)/1000))});callback(null,chunk);}});
  await pipeline(response,meter,createWriteStream(file));return {bytes,total};
 }finally{close();}
}
export async function testDownloadConnection(options={}){
 const start=Date.now(),{response,close}=await openDownload('https://huimiaovip.com/',{...options,timeout:options.timeout||15000,signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(16000)]):AbortSignal.timeout(20000)});
 const status=response.statusCode;response.destroy();close();return {reachable:true,milliseconds:Date.now()-start,status};
}
