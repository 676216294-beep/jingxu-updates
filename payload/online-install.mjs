import {writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {applyUpdate} from './update.mjs';
const [root,payload,parent]=process.argv.slice(2),pause=ms=>new Promise(r=>setTimeout(r,ms));
process.send?.('ready');
const statusFile=path.join(root,'.updates','online-status.json');
async function launch(){const child=spawn(process.execPath,['--use-env-proxy',path.join(root,'launcher.mjs'),'--no-open'],{cwd:root,env:process.env,detached:true,windowsHide:true,stdio:'ignore'});child.unref();}
try{
 let exited=false;for(let i=0;i<150;i++){try{process.kill(Number(parent),0);}catch{exited=true;break;}await pause(200);}if(!exited)throw Error('工作台没有退出，更新已取消');
 const result=await applyUpdate(payload,root,{checkRunning:false});await mkdir(path.dirname(statusFile),{recursive:true});await writeFile(statusFile,JSON.stringify({status:'completed',version:result.version,completedAt:Date.now()}));await launch();
}catch(e){await writeFile(statusFile,JSON.stringify({status:'error',error:e.message})).catch(()=>{});await launch();}
