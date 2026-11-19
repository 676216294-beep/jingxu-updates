import {spawn,execFile,execFileSync} from 'node:child_process';
import {appendFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const root=path.dirname(fileURLToPath(import.meta.url));
const logFile=path.join(root,'startup.log');
function log(message){console.log(message);try{appendFileSync(logFile,`[${new Date().toISOString()}] ${message}\n`);}catch{}}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function openBrowser(url){
 if(process.argv.includes('--no-open'))return;
 try{await new Promise((resolve,reject)=>{
  const command=process.platform==='win32'?'rundll32.exe':process.platform==='darwin'?'open':'xdg-open';
  const args=process.platform==='win32'?['url.dll,FileProtocolHandler',url]:[url];
  execFile(command,args,{windowsHide:true},error=>error?reject(error):resolve());
 });}catch(error){log(`浏览器未能自动打开：${error.message}`);}
 log(`如果浏览器没有打开，请手动访问：${url}`);
}
async function healthy(url){try{
 const response=await fetch(url+'/api/state',{signal:AbortSignal.timeout(800)});
 if(!response.ok)return false;const state=await response.json();return Array.isArray(state.projects)&&typeof state.connected==='boolean';
}catch{return false;}}
async function main(){
 log(`镜序启动 · Node ${process.versions.node} · ${root}`);
 const [major,minor]=process.versions.node.split('.').map(Number);
 if(major<24||(major===24&&minor<5))throw Error('需要 Node.js 24.5 或更新版本，请使用便携包自带的 runtime/node.exe。');
 const env={...process.env,NO_PROXY:'127.0.0.1,localhost,::1'};
 if(process.platform==='win32'&&!env.HTTPS_PROXY){try{
  const text=execFileSync('reg.exe',['query','HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],{encoding:'utf8',windowsHide:true});
  if(/ProxyEnable\s+REG_DWORD\s+0x1/.test(text)){
   let proxy=text.match(/ProxyServer\s+REG_SZ\s+([^\r\n]+)/)?.[1]?.trim();
   if(proxy?.includes('='))proxy=proxy.match(/(?:^|;)https=([^;]+)/)?.[1]||proxy.match(/(?:^|;)http=([^;]+)/)?.[1];
   if(proxy){env.HTTPS_PROXY=/^https?:\/\//.test(proxy)?proxy:'http://'+proxy;env.HTTP_PROXY=env.HTTPS_PROXY;log('已使用 Windows 系统代理');}
  }
 }catch{}}
 const port=Number(env.PORT||4318);if(!Number.isInteger(port)||port<1||port>65535)throw Error('PORT 必须为 1–65535 的整数');
 const url=`http://127.0.0.1:${port}`;
 if(await healthy(url)){log('工作台已经运行：'+url);await openBrowser(url);return;}
 const child=spawn(process.execPath,['--use-env-proxy',path.join(root,'server.mjs')],{cwd:root,env,stdio:['inherit','pipe','pipe'],windowsHide:true});
 let exited=false,spawnError;
 const forward=chunk=>{const text=chunk.toString();process.stdout.write(text);try{appendFileSync(logFile,text);}catch{}};
 child.stdout.on('data',forward);child.stderr.on('data',forward);
 const ended=new Promise(resolve=>{child.once('error',error=>{spawnError=error;exited=true;resolve(1);});child.once('exit',(code,signal)=>{exited=true;resolve(code??(signal?1:0));});});
 const stop=()=>child.kill('SIGTERM');process.once('SIGINT',stop);process.once('SIGTERM',stop);
 let ready=false;
 for(let attempt=0;attempt<50&&!exited;attempt++){if(await healthy(url)){ready=true;break;}await delay(200);}
 if(!ready){stop();throw Error(spawnError?.message||`本地服务没有成功启动。请查看 ${logFile}，并检查端口 ${port} 是否已被其他程序占用。`);}
 log('工作台启动成功：'+url);await openBrowser(url);
 log('请保留此启动窗口。关闭窗口会停止本地工作台。');
 const code=await ended;process.exitCode=code===42?0:code;process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
}
try{await main();}catch(error){log('启动失败：'+error.message);process.exitCode=1;}
