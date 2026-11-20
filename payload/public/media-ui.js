export function previewSource(t,{url,mode}){
 if(mode!=='direct'||t.localVideo)return url;
 try{
  const candidate=new URL(t.remote?.download_url||t.remote?.url);
  if(candidate.protocol==='https:'&&candidate.origin!==new URL(t.apiBase).origin&&!candidate.username&&!candidate.password)return candidate.href;
 }catch{}
 return url;
}
export function previewVideo(t,{url,mode,onDownload}){
 const dialog=document.createElement('dialog');dialog.className='video-preview';
 const top=document.createElement('div');top.className='section-head';
 const title=document.createElement('h2');title.textContent=t.label+' · 成片预览';
 const close=document.createElement('button');close.textContent='关闭';top.append(title,close);
 const video=document.createElement('video');video.controls=true;video.playsInline=true;video.preload='metadata';video.setAttribute('aria-label','成片视频播放器');
 const message=document.createElement('p');message.className='hint';message.textContent='正在连接视频…在线播放使用当前下载网络，不会保存到成片目录。';
 const actions=document.createElement('div');actions.className='actions';
 const retry=document.createElement('button');retry.textContent='重新加载';
 const download=document.createElement('button');download.className='primary';download.textContent='满意，下载成片';actions.append(retry,download);
 const cleanup=()=>{video.pause();video.removeAttribute('src');video.load();dialog.remove();};
 close.onclick=()=>dialog.close();dialog.addEventListener('close',cleanup);dialog.addEventListener('cancel',()=>dialog.close());
 let source=previewSource(t,{url,mode});
 const load=()=>{message.textContent='正在连接视频…';video.src=source;video.load();};
 video.onloadedmetadata=()=>{message.textContent=`视频 ${Math.round(video.duration*10)/10} 秒 · 可拖动进度、调音量或全屏检查。在线播放不会保存到成片目录。`;};
 video.onerror=()=>{if(source!==url){source=url;load();return;}message.textContent='视频暂时无法播放，请检查节点连通性或切换节点后重新加载。';};
 retry.onclick=()=>{source=previewSource(t,{url,mode});load();};download.onclick=()=>{dialog.close();onDownload();};
 dialog.append(top,video,message,actions);document.body.append(dialog);dialog.showModal();load();
}
