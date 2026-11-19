import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,access} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import {once} from 'node:events';
import {randomUUID} from 'node:crypto';
import {parseSubscription} from '../subscriptions.mjs';
import {BuiltinProxy,makeCoreConfig} from '../builtin-proxy.mjs';
import {openDownload,streamDownload} from '../download-proxy.mjs';
const root=path.resolve(import.meta.dirname,'..');
test('订阅解析支持 Base64、常见节点与 Clash YAML，忽略外部配置指令',()=>{
 const ss='ss://'+Buffer.from('aes-128-gcm:secret').toString('base64')+'@example.com:1234#香港';
 const vm='vmess://'+Buffer.from(JSON.stringify({add:'example.net',port:443,id:randomUUID(),ps:'日本',net:'ws',tls:'tls',host:'example.net',path:'/ws'})).toString('base64');
 const parsed=parseSubscription(Buffer.from(ss+'\n'+vm).toString('base64'));assert.equal(parsed.nodes.length,2);assert.equal(parsed.nodes[0].outbound.password,'secret');assert.equal(parsed.nodes[1].outbound.transport.type,'ws');
 const yaml=parseSubscription('mixed-port: 9999\nexternal-controller: 0.0.0.0:9090\nproxies:\n  - name: SS\n    type: ss\n    server: example.com\n    port: 1234\n    cipher: aes-128-gcm\n    password: secret\n');assert.equal(yaml.nodes.length,1);assert.equal(yaml.nodes[0].outbound.method,'aes-128-gcm');assert.equal(yaml.nodes[0].outbound['external-controller'],undefined);
 assert.throws(()=>parseSubscription('<html>login</html>'),/网页内容/);
 assert.throws(()=>parseSubscription('trojan://secret@example.com:443?allowInsecure=1'),/没有可用节点/);
 for(const uri of ['vless://'+randomUUID()+'@example.com:443?security=tls&type=grpc&serviceName=test','trojan://secret@example.com:443','hysteria2://secret@example.com:443','tuic://'+randomUUID()+':secret@example.com:443'])assert.equal(parseSubscription(uri).nodes.length,1);
});
async function freePort(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const port=s.address().port;await new Promise(r=>s.close(r));return port;}
const wait=ms=>new Promise(r=>setTimeout(r,ms));
test('自带内核校验 VMess/VLESS/Reality/Trojan/Hysteria2/TUIC 配置',async t=>{
 const binary=path.join(root,'runtime','sing-box',process.platform==='win32'?'sing-box.exe':'sing-box');try{await access(binary);}catch{t.skip('无当前平台内核');return;}
 const dir=await mkdtemp(path.join(tmpdir(),'jx-config-')),id=randomUUID(),key=Buffer.alloc(32,1).toString('base64url');
 const uris=['vmess://'+Buffer.from(JSON.stringify({add:'example.com',port:443,id,ps:'test',net:'ws',tls:'tls',path:'/socket'})).toString('base64'),'vless://'+id+'@example.com:443?security=tls&type=grpc&serviceName=test','vless://'+id+'@example.com:443?security=reality&pbk='+key+'&sid=ab&flow=xtls-rprx-vision','trojan://secret@example.com:443','hy2://secret@example.com:443','tuic://'+id+':secret@example.com:443'];
 try{for(let i=0;i<uris.length;i++){const config=path.join(dir,i+'.json');await writeFile(config,JSON.stringify(makeCoreConfig(parseSubscription(uris[i]).nodes[0].outbound,12345)));await promisify(execFile)(binary,['check','-c',config],{windowsHide:true});}}finally{await rm(dir,{recursive:true,force:true});}
});
test('真实内置内核：无需系统代理，通过自带 SS 节点下载并清理进程',async t=>{
 const binary=path.join(root,'runtime','sing-box',process.platform==='win32'?'sing-box.exe':'sing-box');try{await access(binary);}catch{t.skip('当前系统未附带对应内核');return;}
 const dir=await mkdtemp(path.join(tmpdir(),'jx-builtin-')),password=randomUUID(),ssPort=await freePort();let inboundHits=0;
 const origin=http.createServer((req,res)=>{inboundHits++;res.end('download-through-owned-core');});origin.listen(0,'127.0.0.1');await once(origin,'listening');
 const serverConfig=path.join(dir,'test-server.json');await writeFile(serverConfig,JSON.stringify({log:{disabled:true},inbounds:[{type:'shadowsocks',listen:'127.0.0.1',listen_port:ssPort,method:'aes-128-gcm',password}],outbounds:[{type:'direct',tag:'direct'}],route:{final:'direct'}}));
 const remote=spawn(binary,['run','-c',serverConfig],{windowsHide:true,stdio:'ignore'});const manager=await new BuiltinProxy({root,dir}).init();
 try{
  const source='ss://'+Buffer.from('aes-128-gcm:'+password).toString('base64')+'@127.0.0.1:'+ssPort+'#测试专用节点';
  const summary=await manager.import({text:source});assert.equal(summary.nodes.length,1);assert.ok(!JSON.stringify(summary).includes(password));
  await wait(300);await manager.connect(summary.nodes[0].id);assert.equal(manager.status,'running');
  const file=path.join(dir,'video.mp4');await streamDownload('http://127.0.0.1:'+origin.address().port+'/video',file,{allowHttp:true,config:manager.config(),env:{HTTP_PROXY:'http://127.0.0.1:1',HTTPS_PROXY:'http://127.0.0.1:1'}});
  assert.equal(await readFile(file,'utf8'),'download-through-owned-core');assert.equal(inboundHits,1);
  const stablePort=manager.port;manager.probe=async options=>{const {response,close}=await openDownload('http://127.0.0.1:'+origin.address().port+'/check',{...options,allowHttp:true});const result={milliseconds:10,status:response.statusCode};response.destroy();close();assert.equal(result.status,200);return result;};
  const offline={...manager.nodes[0],id:'offline',name:'offline',outbound:{...manager.nodes[0].outbound,server_port:await freePort()}};manager.nodes.push(offline);manager.startTests();await manager.testPromise;assert.equal(manager.checks[summary.nodes[0].id].status,'reachable');assert.equal(manager.checks.offline.status,'failed');assert.equal(manager.port,stablePort);assert.equal(manager.status,'running');manager.nodes.pop();
  const localPort=manager.port;await manager.stop();assert.throws(()=>manager.config(),/请在/);
  const probe=await new Promise(resolve=>{const socket=net.connect(localPort,'127.0.0.1');socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));});assert.equal(probe,false);
  const restored=await new BuiltinProxy({root,dir}).init();assert.equal(restored.nodes.length,1);assert.equal(restored.selectedId,summary.nodes[0].id);
  await manager.connect(summary.nodes[0].id);const orphanPort=manager.port;manager.runner.disconnect();await wait(600);
  const stillRunning=await new Promise(resolve=>{const socket=net.connect(orphanPort,'127.0.0.1');socket.once('connect',()=>{socket.destroy();resolve(true);});socket.once('error',()=>resolve(false));});assert.equal(stillRunning,false);
 }finally{await manager.stop();remote.kill();await once(remote,'exit');origin.closeAllConnections();origin.close();await rm(dir,{recursive:true,force:true});}
});
