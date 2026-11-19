import path from 'node:path';
import {stat,copyFile,constants,readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
const exec=promisify(execFile);
export async function checkFolder(folder){
 if(typeof folder!=='string'||!path.isAbsolute(folder.trim()))throw Error('请填写已存在的绝对文件夹路径');
 const resolved=path.resolve(folder.trim());if(!(await stat(resolved)).isDirectory())throw Error('所选路径不是文件夹');return resolved;
}
export async function pickFolder(){
 try{
  let result;
  if(process.platform==='win32')result=await exec('powershell.exe',['-NoProfile','-STA','-Command',await readFile(new URL('./choose-folder.ps1',import.meta.url),'utf8')],{windowsHide:true,timeout:300000,encoding:'utf8'});
  else if(process.platform==='darwin')result=await exec('osascript',['-e','POSIX path of (choose folder with prompt "选择视频保存文件夹")'],{timeout:300000});
  else result=await exec('zenity',['--file-selection','--directory','--title=选择视频保存文件夹'],{timeout:300000});
  const folder=result.stdout.trim();return folder?await checkFolder(folder):null;
 }catch(e){if(e.code===1||e.code===-128||String(e.stderr).includes('(-128)'))return null;throw Error('无法打开文件夹选择器，可以在保存目录中直接填写路径。'+(e.code||''));}
}
export async function saveVideoToFolder(file,folder,label,identifier){
 folder=await checkFolder(folder);
 const clean=s=>String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').replace(/[. ]+$/,'').slice(0,70)||'video';
 const stem=clean(label)+'_'+clean(identifier);
 // Never overwrite an existing file, including a video saved by another process.
 for(let i=0;i<10000;i++){const target=path.join(folder,stem+(i?'_'+i:'')+'.mp4');try{await copyFile(file,target,constants.COPYFILE_EXCL);return target;}catch(e){if(e.code!=='EEXIST')throw e;}}
 throw Error('同名文件过多，请选择其他保存目录');
}
