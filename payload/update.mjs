import {readFile,writeFile,mkdir,cp,stat,realpath,lstat,rename,unlink} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {pickFolder} from './folders.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const exists=async file=>!!await stat(file).catch(()=>null);
const within=(root,name)=>{const file=path.resolve(root,name);if(!file.startsWith(root+path.sep))throw Error('文件路径超出软件目录');return file;};
async function stopped(){try{const r=await fetch('http://127.0.0.1:4318/api/state',{signal:AbortSignal.timeout(800)});if(r.ok){const s=await r.json();if(Array.isArray(s.projects))throw Error('请先关闭正在运行的工作台启动窗口，然后重新运行此工具。');}}catch(e){if(e.message.startsWith('请先'))throw e;}}
async function installation(target){const root=await realpath(target);if(!await exists(path.join(root,'server.mjs'))||!await exists(path.join(root,'launcher.mjs')))throw Error('请选择原来包含“启动工作台.cmd”的软件文件夹');return root;}
async function regularPath(root,file){let cursor=root;for(const part of path.relative(root,file).split(path.sep)){cursor=path.join(cursor,part);const info=await lstat(cursor).catch(()=>null);if(info?.isSymbolicLink())throw Error('更新路径不能包含符号链接或目录联接');}}
export async function applyUpdate(source,target,{checkRunning=true,dryRun=false}={}){
 source=await realpath(source);target=await installation(target);if(source===target)throw Error('请将升级包解压到单独文件夹，再选择原软件文件夹');if(checkRunning)await stopped();
 const manifest=JSON.parse(await readFile(path.join(source,'release-manifest.json'),'utf8'));
 if(manifest.format!=='jingxu-update-v1'||!Array.isArray(manifest.files))throw Error('升级包清单无效');
 for(const entry of manifest.requires||[]){const dst=within(target,entry.path);await regularPath(target,dst);const bytes=await readFile(dst).catch(()=>null);if(!bytes||createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('此增量包需要原版运行组件：'+entry.path+'，请选择原便携目录或使用匹配版本升级包');}
 const verified=[];for(const entry of manifest.files){
  const name=entry.path;if(typeof name!=='string'||name.includes('\\')||name.split('/').some(p=>!p||p==='.'||p==='..')||/^(data|\.updates|startup\.log)(\/|$)/i.test(name))throw Error('升级包不能覆盖用户数据');
  const src=within(source,name),dst=within(target,name);await regularPath(source,src);await regularPath(target,dst);
  const bytes=await readFile(src);if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw Error('升级包文件校验失败：'+name);const existing=await readFile(dst).catch(()=>null);if(!existing||createHash('sha256').update(existing).digest('hex')!==entry.sha256)verified.push({src,dst,name});
 }
 if(dryRun)return {version:manifest.version,changed:verified.map(f=>f.name)};
 const backup=path.join(target,'.updates',Date.now()+'-'+randomUUID());await mkdir(backup,{recursive:true});
 // Back up changed program files before replacing any, leaving data entirely untouched.
 for(const file of verified)if(await exists(file.dst)){const dest=within(backup,file.name);await mkdir(path.dirname(dest),{recursive:true});await cp(file.dst,dest);}
 try{for(const file of verified){await mkdir(path.dirname(file.dst),{recursive:true});const temp=file.dst+'.update-'+randomUUID();await cp(file.src,temp);await rename(temp,file.dst);}}catch(error){for(const file of verified){const previous=within(backup,file.name);if(await exists(previous))await cp(previous,file.dst).catch(()=>{});else await unlink(file.dst).catch(()=>{});}throw Error('程序替换失败，已尝试恢复旧程序，请查看备份：'+backup+' · '+(error.code||'写入失败'));}
 await writeFile(path.join(backup,'update-info.json'),JSON.stringify({version:manifest.version,updatedAt:Date.now()}));
 return {version:manifest.version,backup,target};
}
export async function backupRecords(root,destination,{checkRunning=true}={}){
 root=await installation(root);if(checkRunning)await stopped();destination=await realpath(destination);
 const data=path.join(root,'data');if(!await exists(path.join(data,'projects.json')))throw Error('本机还没有可备份的生成记录');
 if(destination===data||destination.startsWith(data+path.sep))throw Error('请把备份放到 data 文件夹以外');
 const output=path.join(destination,'镜序记录-'+Date.now()+'-'+randomUUID().slice(0,8));await mkdir(output);await cp(data,path.join(output,'data'),{recursive:true,dereference:false});
 await writeFile(path.join(output,'records-backup.json'),JSON.stringify({format:'jingxu-records-v1',createdAt:Date.now()}));return output;
}
export async function restoreRecords(root,source,{checkRunning=true}={}){
 root=await installation(root);if(checkRunning)await stopped();source=await realpath(source);const data=path.join(source,'data');
 const marker=JSON.parse(await readFile(path.join(source,'records-backup.json'),'utf8'));if(marker.format!=='jingxu-records-v1')throw Error('请选择“备份本机记录”生成的记录备份文件夹');
 const db=JSON.parse(await readFile(path.join(data,'projects.json'),'utf8'));if(!Array.isArray(db.projects))throw Error('备份中的记录无效');
 const target=path.join(root,'data');if(source===target||source.startsWith(target+path.sep))throw Error('备份来源不能在当前 data 目录中');
 const previous=await exists(path.join(target,'projects.json'))?await backupRecords(root,path.join(root),{checkRunning:false}):null;
 await mkdir(target,{recursive:true});await cp(data,target,{recursive:true,dereference:false});return {previous};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const mode=process.argv.includes('--backup')?'backup':process.argv.includes('--restore')?'restore':'update';
  console.log(mode==='update'?'请选择【原软件文件夹】，只更新软件，保留其中的 data 记录。':mode==='backup'?'请先关闭工作台，然后选择备份保存位置。':'请选择完整记录备份文件夹；当前记录会先自动备份。');
  const selected=process.argv.includes('--target')?process.argv[process.argv.indexOf('--target')+1]:await pickFolder();if(!selected)throw Error('已取消，未改动任何文件');
  const result=mode==='update'?await applyUpdate(here,selected):mode==='backup'?await backupRecords(here,selected):await restoreRecords(here,selected);
  console.log('操作完成：',JSON.stringify(result,null,2));
 }catch(e){console.error('操作未完成：'+e.message);process.exitCode=1;}
}
