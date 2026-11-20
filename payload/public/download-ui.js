export function setupDownloadProxy({request,refresh,toast}){
 const $=id=>document.getElementById(id);let dirty=false;
 const mode=$('downloadProxyMode'),address=$('downloadProxyUrl'),save=$('saveDownloadProxy'),test=$('testDownloadProxy');
 const selected=()=>({mode:mode.value,url:address.value.trim()});
 const showMode=()=>{address.disabled=mode.value!=='custom';};
 mode.onchange=()=>{dirty=true;showMode();};address.oninput=()=>dirty=true;
 save.onclick=async()=>{save.disabled=true;try{await request('/api/download-proxy','POST',selected());dirty=false;await refresh();toast('下载网络设置已保存，下一次下载生效');}catch(e){toast(e.message);}finally{save.disabled=false;}};
 test.onclick=async()=>{test.disabled=true;$('downloadProxyStatus').textContent='正在测试到 Huimiao 的连接…';try{const r=await request('/api/download-proxy/test','POST',selected());$('downloadProxyStatus').textContent=`连接已建立 · 响应 ${r.milliseconds} ms · HTTP ${r.status}（实际视频速度以下载时显示为准）`;}catch(e){$('downloadProxyStatus').textContent=e.message;}finally{test.disabled=false;}};
 const size=n=>n>=1024*1024?(n/1024/1024).toFixed(1)+' MB':(n/1024).toFixed(0)+' KB';
 return function render(state){
  const cfg=state.downloadProxy||{mode:'system',url:''};
  if(!dirty&&document.activeElement!==address&&document.activeElement!==mode){mode.value=cfg.mode;address.value=cfg.url||cfg.systemUrl||'';showMode();}
  $('systemDownloadProxy').textContent=cfg.systemUrl?'当前系统代理：'+cfg.systemUrl:'未检测到启动时的系统代理；可选择指定代理并填写 HTTP 端口。';
  const jobs=Object.values(state.downloadJobs||{}),active=jobs.filter(j=>j.status==='downloading');
  $('downloadProgress').replaceChildren();
  for(const batch of Object.values(state.batchDownloadJobs||{})){
   const row=document.createElement('p');row.className='hint';row.textContent=`${batch.projectName} · ${batch.status==='running'?'批量下载中':'批量下载结束'} · 成功 ${batch.completed}/${batch.total} · 失败 ${batch.failed} · 正在下载 ${batch.active} 条`;$('downloadProgress').append(row);
   for(const item of batch.errors){const error=document.createElement('p');error.className='error-msg';error.textContent=item.label+' · '+item.error;$('downloadProgress').append(error);}
   if(batch.error){const error=document.createElement('p');error.className='error-msg';error.textContent=batch.error;$('downloadProgress').append(error);}
  }
  for(const job of active){const row=document.createElement('div');row.className='download-progress-row';const bar=document.createElement('progress');bar.max=job.total||1;if(job.total)bar.value=job.bytes;row.textContent=`${job.label||'正在保存视频'} · ${size(job.bytes)}${job.total?' / '+size(job.total):''} · ${size(job.speed)}/s `;row.append(bar);$('downloadProgress').append(row);}
  const failed=jobs.filter(j=>j.status==='error').at(-1);if(!active.length&&failed){const row=document.createElement('p');row.className='error-msg';row.textContent=failed.error;$('downloadProgress').append(row);}
 };
}
