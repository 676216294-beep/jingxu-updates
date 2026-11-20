import {reminderDue} from './update-policy.mjs';
export function setupUpdates({request,toast,beforeInstall=async()=>{}}){
 const $=id=>document.getElementById(id),dialog=$('updateDialog'),status=$('updateStatus'),install=$('installUpdate'),check=$('checkUpdate');
 let polling,waiting=false,busy=false,lastCheck=0,checking=false,latest=null,restoring=false;
 const notice=document.createElement('div');notice.id='updateNotice';notice.hidden=true;notice.setAttribute('role','status');notice.style='position:fixed;right:24px;bottom:24px;z-index:900;max-width:420px;background:#fff;border:1px solid #dce4dc;border-radius:16px;padding:20px;box-shadow:0 8px 36px #0003';
 notice.innerHTML='<b data-message></b><p>更新前自动保存当前合集和分镜编辑内容。</p><button data-now class="primary">立即更新</button> <button data-later>稍后更新</button>';
 document.body.append(notice);
 const later=document.createElement('button');later.textContent='稍后更新';$('updateDialog').querySelector('.actions').append(later);
 const snooze=()=>{try{return JSON.parse(localStorage.getItem('jx-update-snooze'));}catch{return null;}};
 const defer=()=>{waiting=false;clearInterval(polling);if(latest)localStorage.setItem('jx-update-snooze',JSON.stringify({version:latest.version,until:Date.now()+60*60*1000}));notice.hidden=true;dialog.close();toast('已稍后提醒；可随时从“软件更新”打开');};
 later.onclick=defer;notice.querySelector('[data-later]').onclick=defer;
 const draw=s=>{latest=s;status.textContent=s.error||({'idle':'点击检查更新','checked':s.available?'发现新版本 '+s.version+'（当前 '+s.current+'）':'当前已是最新版本 '+s.current,'downloading':'正在下载并校验更新包… '+Math.round((s.bytes||0)/1024)+' KB','installing':'正在更新并重启，请稍候…','completed':'更新完成 '+s.version}[s.status]||s.status);
 later.disabled=['downloading','installing'].includes(s.status);
 if(s.blockers?.length)status.textContent+='。当前：'+s.blockers.join('；');
 install.textContent=waiting?'等待工作结束后更新':'立即更新';install.disabled=busy||!s.available||['downloading','installing'].includes(s.status);check.disabled=busy||['downloading','installing'].includes(s.status);$('updateNotes').textContent=s.notes||'';
 if(waiting)status.textContent='页面已保存，等待更新：'+(s.blockers?.join('；')||'即将安装');
 };
 const watch=()=>{clearInterval(polling);polling=setInterval(async()=>{try{const s=await request('/api/updates');draw(s);if(s.status==='installing')restoring=true;if(s.status==='error'){clearInterval(polling);waiting=false;busy=false;draw(s);return;}if(restoring&&(s.status==='completed'||s.status==='idle')){clearInterval(polling);location.reload();return;}if(waiting&&!s.blockers?.length)await begin();}catch{if(!waiting){restoring=true;status.textContent='正在重启工作台，页面会自动恢复…';}}},2000);};
 async function begin(){if(busy)return;busy=true;install.disabled=true;try{
  await beforeInstall();const s=await request('/api/updates');
  if(s.blockers?.length){waiting=true;busy=false;draw(s);watch();return;}
  waiting=false;const next=await request('/api/updates/install','POST',{});notice.hidden=true;restoring=true;draw(next);watch();
 }catch(e){waiting=false;status.textContent='未更新：'+e.message;toast(status.textContent);clearInterval(polling);}finally{busy=false;if(latest)install.disabled=!latest.available||['downloading','installing'].includes(latest.status);}}
 install.onclick=begin;
 notice.querySelector('[data-now]').onclick=()=>{notice.hidden=true;dialog.showModal();void begin();};
 $('openUpdates').onclick=async()=>{dialog.showModal();try{draw(await request('/api/updates'));}catch(e){status.textContent=e.message;}};
 $('closeUpdates').onclick=()=>{if(busy||['downloading','installing'].includes(latest?.status))return toast('正在保存或更新，请等待完成');if(waiting)defer();else dialog.close();};
 dialog.addEventListener('cancel',e=>{if(busy||['downloading','installing'].includes(latest?.status)){e.preventDefault();return;}if(waiting)defer();});
 async function checkNow(manual=false){if(checking||busy||waiting)return;checking=true;lastCheck=Date.now();if(manual){check.disabled=true;status.textContent='正在连接 GitHub 检查更新…';}
 try{const s=await request('/api/updates/check','POST',{});draw(s);if(reminderDue(s,snooze())){notice.querySelector('[data-message]').textContent='发现新版本 '+s.version+'，请更新';notice.hidden=false;}}
 catch(e){if(manual)status.textContent=e.message;}finally{checking=false;if(!busy)check.disabled=false;}}
 check.onclick=()=>checkNow(true);
 setTimeout(()=>void checkNow(),15000);setInterval(()=>{if(!document.hidden)void checkNow();},5*60*1000);
 window.addEventListener('focus',()=>{if(Date.now()-lastCheck>60000)void checkNow();});
 // A new tab opened during an existing installation must also recover itself.
 void request('/api/updates').then(s=>{if(['downloading','installing'].includes(s.status)){draw(s);restoring=s.status==='installing';watch();}}).catch(()=>{});
}
