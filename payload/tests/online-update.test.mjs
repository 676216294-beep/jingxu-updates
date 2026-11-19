import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,mkdir,cp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {once} from 'node:events';
import {newer,releaseInfo,verifyChecksum,extractPackage} from '../online-update.mjs';
const root=path.resolve(import.meta.dirname,'..'),wait=ms=>new Promise(r=>setTimeout(r,ms));
test('在线更新只接受正式版本、固定仓库附件和正确 SHA256',()=>{
 assert.equal(newer('1.4.0','1.3.9'),true);assert.equal(newer('1.4.0','1.4.0'),false);
 const prefix='https://github.com/676216294-beep/jingxu-updates/releases/download/v1.4.0/';const release={tag_name:'v1.4.0',assets:[{name:'jingxu-update-1.4.0.zip',browser_download_url:prefix+'jingxu-update-1.4.0.zip'},{name:'SHA256SUMS.txt',browser_download_url:prefix+'SHA256SUMS.txt'}]};assert.equal(releaseInfo(release,'1.3.0').available,true);assert.throws(()=>releaseInfo({...release,prerelease:true},'1.3.0'),/正式/);assert.throws(()=>releaseInfo({...release,assets:[{...release.assets[0],browser_download_url:'https://other.example/update.zip'},release.assets[1]]},'1.3.0'),/来源/);
 const bytes=Buffer.from('payload'),hash=createHash('sha256').update(bytes).digest('hex');verifyChecksum(bytes,hash+'  update.zip','update.zip');assert.throws(()=>verifyChecksum(Buffer.from('tampered'),hash+'  update.zip','update.zip'),/校验失败/);
});
test('在线更新拒绝 ZIP 目录越界',async t=>{
 if(process.platform!=='win32')return t.skip();const dir=await mkdtemp(path.join(tmpdir(),'jx-safezip-'));try{
 const zip=path.join(dir,'bad.zip');await promisify(execFile)('powershell.exe',['-NoProfile','-Command',"$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression; Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::Open($env:JX_TEST_ZIP,[IO.Compression.ZipArchiveMode]::Create); $e=$z.CreateEntry('../escaped.txt'); $w=New-Object IO.StreamWriter($e.Open()); $w.Write('bad'); $w.Dispose(); $z.Dispose()"],{env:{...process.env,JX_TEST_ZIP:zip},windowsHide:true});await assert.rejects(()=>extractPackage(zip,path.join(dir,'out')));await assert.rejects(()=>readFile(path.join(dir,'escaped.txt')));
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('独立安装器等待旧进程退出，更新程序、保留 data 并自动重启',async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),'jx-restart-')),install=path.join(dir,'install'),stage=path.join(dir,'stage'),payload=path.join(dir,'payload');let parent,runner;
 try{
  for(const folder of [install,stage,payload,path.join(install,'data')])await mkdir(folder,{recursive:true});
  const marker=path.join(install,'restarted.json');await writeFile(path.join(install,'launcher.mjs'),`import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({restarted:true}));`);await writeFile(path.join(install,'server.mjs'),'old');await writeFile(path.join(install,'data','projects.json'),'original history');
  await writeFile(path.join(payload,'server.mjs'),'new');await writeFile(path.join(payload,'release-manifest.json'),JSON.stringify({format:'jingxu-update-v1',version:'1.4.0',files:[{path:'server.mjs',sha256:createHash('sha256').update('new').digest('hex')}]}));
  for(const f of ['online-install.mjs','update.mjs','folders.mjs'])await cp(path.join(root,f),path.join(stage,f));
  parent=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true});runner=spawn(process.execPath,[path.join(stage,'online-install.mjs'),install,payload,String(parent.pid)],{stdio:'ignore',windowsHide:true});
  await wait(300);assert.equal(await readFile(path.join(install,'server.mjs'),'utf8'),'old');parent.kill();await once(parent,'exit');
  await once(runner,'exit');assert.equal(await readFile(path.join(install,'server.mjs'),'utf8'),'new');assert.equal(await readFile(path.join(install,'data','projects.json'),'utf8'),'original history');for(let i=0;i<50;i++){if(await readFile(marker).catch(()=>null))break;await wait(50);}assert.equal(JSON.parse(await readFile(marker,'utf8')).restarted,true);assert.equal(JSON.parse(await readFile(path.join(install,'.updates','online-status.json'),'utf8')).status,'completed');
 }finally{parent?.kill();runner?.kill();await rm(dir,{recursive:true,force:true});}
});
