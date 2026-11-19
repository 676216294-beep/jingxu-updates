import {readFile,writeFile,mkdir,cp} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {execFile,fork} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
import {openDownload} from './download-proxy.mjs';
import {applyUpdate} from './update.mjs';
const exec=promisify(execFile);
export const repository='676216294-beep/jingxu-updates';
export function newer(a,b){const parse=v=>{const m=/^v?(\d+)\.(\d+)\.(\d+)$/.exec(v);if(!m)throw Error('不支持的版本号');return m.slice(1).map(Number);};const x=parse(a),y=parse(b);for(let i=0;i<3;i++)if(x[i]!==y[i])return x[i]>y[i];return false;}
export function releaseInfo(release,current){
 if(release.draft||release.prerelease)throw Error('不是正式发布版本');
 const version=String(release.tag_name||'').replace(/^v/,'');newer(version,current);
 const asset=release.assets?.find(a=>a.name===`jingxu-update-${version}.zip`),checksum=release.assets?.find(a=>a.name==='SHA256SUMS.txt');
 if(!asset||!checksum)throw Error('该版本缺少增量包或校验文件');
 const valid=url=>{const u=new URL(url);if(u.protocol!=='https:'||u.hostname!=='github.com'||!u.pathname.startsWith('/'+repository+'/releases/download/'))throw Error('更新附件来源不匹配');return u.href;};
 return {version,current,available:newer(version,current),url:valid(asset.browser_download_url),checksumUrl:valid(checksum.browser_download_url),name:asset.name,notes:String(release.body||'').slice(0,15000),page:'https://github.com/'+repository+'/releases/latest'};
}
export async function fetchBytes(url,config,{limit=256*1024*1024,onProgress=()=>{}}={}){
 const {response,close}=await openDownload(url,{config,headers:{'User-Agent':'Jingxu-Updater','Accept':'application/vnd.github+json'},timeout:30000,signal:AbortSignal.timeout(180000)});
 try{if(response.statusCode!==200)throw Error(response.statusCode===404?'仓库尚未发布可用更新':'更新服务器返回 HTTP '+response.statusCode);let size=0;const chunks=[];for await(const chunk of response){size+=chunk.length;if(size>limit)throw Error('更新文件超过大小限制');chunks.push(chunk);onProgress(size);}return Buffer.concat(chunks);}finally{response.destroy();close();}
}
export function verifyChecksum(bytes,text,name){const match=text.split(/\r?\n/).map(s=>/^([a-fA-F0-9]{64})\s+\*?(.+)$/.exec(s)).find(m=>m&&m[2]===name);if(!match||createHash('sha256').update(bytes).digest('hex')!==match[1].toLowerCase())throw Error('更新包校验失败，已停止更新');}
export async function extractPackage(zip,destination){
 await mkdir(destination,{recursive:true});
 await exec('powershell.exe',['-NoProfile','-Command',`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead($env:JX_UPDATE_ZIP); try { $total=0; foreach($e in $z.Entries){$p=$e.FullName.Replace('\\','/'); if($p.StartsWith('/') -or $p.Contains(':') -or $p.Split('/') -contains '..'){throw 'Unsafe archive path'}; $total+=$e.Length; if($total -gt 536870912 -or $z.Entries.Count -gt 5000){throw 'Archive too large'}}; [IO.Compression.ZipFileExtensions]::ExtractToDirectory($z,$env:JX_UPDATE_DIR) } finally {$z.Dispose()}`],{windowsHide:true,timeout:60000,env:{...process.env,JX_UPDATE_ZIP:zip,JX_UPDATE_DIR:destination}});
}
export class OnlineUpdate{
 constructor({root,config,restart,runnerEnv=()=>process.env}){this.root=root;this.config=config;this.restart=restart;this.runnerEnv=runnerEnv;this.state={status:'idle',repository};this.release=null;}
 async current(){return JSON.parse(await readFile(path.join(this.root,'package.json'),'utf8')).version;}
 async check(){if(['downloading','installing'].includes(this.state.status))throw Error('正在更新，请稍候');const current=await this.current();let data;try{data=JSON.parse((await fetchBytes('https://api.github.com/repos/'+repository+'/releases/latest',this.config(),{limit:1024*1024})).toString());}catch{const opened=await openDownload('https://github.com/'+repository+'/releases/latest',{config:this.config(),headers:{'User-Agent':'Jingxu-Updater'},timeout:30000,signal:AbortSignal.timeout(45000)});try{if(opened.response.statusCode!==200)throw Error('暂时无法读取 GitHub 最新版本，请检查网络或切换节点');const u=new URL(opened.url),tag=u.pathname.split('/').at(-1);if(u.hostname!=='github.com'||!u.pathname.startsWith('/'+repository+'/releases/tag/'))throw Error('仓库还没有正式发布版本');const version=tag.replace(/^v/,''),prefix='https://github.com/'+repository+'/releases/download/'+encodeURIComponent(tag)+'/';data={tag_name:tag,assets:[{name:'jingxu-update-'+version+'.zip',browser_download_url:prefix+'jingxu-update-'+version+'.zip'},{name:'SHA256SUMS.txt',browser_download_url:prefix+'SHA256SUMS.txt'}]};}finally{opened.response.destroy();opened.close();}}this.release=releaseInfo(data,current);this.state={status:'checked',...this.release,repository};return this.state;}
 async start(){if(this.starting||['downloading','installing'].includes(this.state.status))throw Error('正在更新');if(process.platform!=='win32')throw Error('当前在线安装支持 Windows 便携版');this.starting=true;try{await this.check();}finally{this.starting=false;}if(!this.release.available)throw Error('当前已经是最新版本');this.state={...this.state,status:'downloading',bytes:0,error:''};void this.prepare().catch(e=>{this.state={...this.state,status:'error',error:e.message};});return this.state;}
 async prepare(){
  const release=this.release,config=this.config(),stage=path.join(this.root,'.updates','download-'+randomUUID()),payload=path.join(stage,'payload');await mkdir(stage,{recursive:true});
  const bytes=await fetchBytes(release.url,config,{onProgress:n=>this.state.bytes=n}),checksum=await fetchBytes(release.checksumUrl,config,{limit:65536});verifyChecksum(bytes,checksum.toString(),release.name);
  const zip=path.join(stage,'update.zip');await writeFile(zip,bytes);await extractPackage(zip,payload);
  const manifest=JSON.parse(await readFile(path.join(payload,'release-manifest.json'),'utf8'));if(manifest.version!==release.version)throw Error('更新清单版本不匹配');if(manifest.files.some(f=>f.path==='runtime/node.exe'))throw Error('此版本需要更新运行环境，请使用本地更新包');
  await applyUpdate(payload,this.root,{checkRunning:false,dryRun:true});
  for(const file of ['online-install.mjs','update.mjs','folders.mjs'])await cp(path.join(this.root,file),path.join(stage,file));
  const runner=fork(path.join(stage,'online-install.mjs'),[this.root,payload,String(process.pid)],{detached:true,windowsHide:true,stdio:['ignore','ignore','ignore','ipc'],env:this.runnerEnv()});
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(Error('更新安装器未能启动')),10000);runner.once('message',message=>{clearTimeout(timeout);if(message==='ready')resolve();else reject(Error('更新安装器错误'));});runner.once('error',e=>{clearTimeout(timeout);reject(e);});});
  runner.disconnect();runner.unref();this.state={...this.state,status:'installing'};await this.restart(stage);
 }
}
