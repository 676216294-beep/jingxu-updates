import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp,writeFile,cp,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import path from 'node:path';
const exec=promisify(execFile),root=path.resolve(import.meta.dirname,'..');
test('Windows PowerShell 5.1 更新入口：ANSI 代码页解析正确，支持中文空格括号路径',async t=>{
 const source=path.join(root,'update-bootstrap.ps1'),bytes=await readFile(source);assert.ok(bytes.every(b=>b<128),'bootstrap must contain ASCII code only');
 if(process.platform!=='win32')return t.skip('Windows-specific regression');
 const workspace=path.join(root,'work');await mkdir(workspace,{recursive:true});const dir=await mkdtemp(path.join(workspace,'更新 编码回归(1)-'));
 try{
  const updateDir=path.join(dir,"财经-ai剧情's (1)"),target=path.join(dir,'原软件 镜序(2)');await mkdir(updateDir);await mkdir(path.join(target,'runtime'),{recursive:true});await writeFile(path.join(target,'runtime','node.exe'),'test-only');const copy=path.join(updateDir,'update-bootstrap.ps1');await cp(source,copy);
  const ps="$ErrorActionPreference='Stop'; foreach($cp in @(936,1252)){ $s=[Text.Encoding]::GetEncoding($cp).GetString([IO.File]::ReadAllBytes($env:JX_TEST_SCRIPT)); $tokens=$null; $errors=$null; [void][System.Management.Automation.Language.Parser]::ParseInput($s,[ref]$tokens,[ref]$errors); if($errors.Count){throw 'Parser regression'} }; [Console]::Write($PSVersionTable.PSVersion.Major)";
  const parsed=await exec('powershell.exe',['-NoProfile','-Command',ps],{env:{...process.env,JX_TEST_SCRIPT:copy},windowsHide:true});assert.equal(parsed.stdout,'5');
  const result=await exec('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-File',copy,'-Target',target,'-VerifyOnly'],{windowsHide:true,encoding:'utf8'});assert.equal(result.stdout,target);
  const unicode=await readFile(path.join(root,'package-release.ps1'));assert.ok(unicode.subarray(0,3).equals(Buffer.from([239,187,191])));
 }finally{if(!dir.startsWith(workspace+path.sep))throw Error('Cleanup outside test workspace');await rm(dir,{recursive:true,force:true});}
});
