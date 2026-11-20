import {modelLabel} from './model-catalog.mjs';
import {setupUpdates} from './update-ui.js';
import {familyOf,latestCompleted,groupedTasks,openHistory} from './history.mjs';
import {previewVideo} from './media-ui.js';
import {setupBuiltinProxy} from './builtin-ui.js';
import {setupDownloadProxy} from './download-ui.js';
import {taskCard,openTaskEditor,workingCopy} from './task-ui.js';
import {installReferenceTooltip} from './references.js';
const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let lastTaskSignature='',state,current=localStorage.getItem('jx-project'),activeTask=null,filter='all',search='',saveChain=Promise.resolve(),submitIds;
const statuses={draft:'未提交',pending:'本地排队',uploading:'上传素材',submitting:'正在提交',uncertain:'需恢复确认',queued:'平台排队',in_progress:'生成中',completed:'已完成',failed:'生成失败',error:'请求失败',cancelled:'已取消'};
const p=()=>state.projects.find(x=>x.id===current)||state.projects[0];
const endpoint=()=>'/api/projects/'+p().id;
const taskUrl=t=>endpoint()+'/tasks/'+t.id;
function toast(s){$('toast').textContent=s;$('toast').style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').style.display='none',5000);}
async function request(url,method='GET',data){const r=await fetch(url,{method,headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined});const b=await r.json();if(!r.ok)throw Error(b.error||'操作失败');return b;}
async function guard(fn){try{await fn();}catch(e){toast(e.message);}}
async function refresh(full=false){const next=await request('/api/state');state=next;if(!state.projects.some(x=>x.id===current))current=state.projects[0].id;render(full);}
function options(el,values,chosen){el.innerHTML=values.map(x=>typeof x==='string'?`<option value="${esc(x)}">${esc(x)}</option>`:`<option value="${esc(x.value)}">${esc(x.label)}</option>`).join('');if(values.some(x=>(typeof x==='string'?x:x.value)==String(chosen)))el.value=chosen;}
function modelOptions(chosen){const arr=state.models.map(m=>({value:m.id,label:modelLabel(m)}));if(chosen&&!arr.some(x=>x.value===chosen))arr.unshift({value:chosen,label:chosen+'（待连接确认）'});if(!chosen&&state.protocol==='yingman')arr.unshift({value:'',label:'请选择模型（核对价格、渠道及 ID）'});if(!arr.length)arr.push({value:'',label:'请先连接 API 读取模型'});return arr;}
function syncParameters(){
 options($('model'),modelOptions(p().defaults.model),p().defaults.model);
 const m=state.models.find(m=>m.id===$('model').value), c=m?.capability_config;
 options($('resolution'),(c?.outputs?.map(o=>o.code)||m?.supported_resolutions||[p().defaults.resolution]),p().defaults.resolution);
 const output=c?.outputs?.find(o=>o.code===$('resolution').value);
 options($('ratio'),output?.ratios||m?.supported_ratios||['9:16','16:9','1:1','4:3','3:4','21:9'],p().defaults.ratio);
 let durations=c?.duration?.values||[];if(c?.duration?.mode==='range')durations=Array.from({length:Math.min(600,Math.floor((c.duration.max-c.duration.min)/(c.duration.step||1))+1)},(_,i)=>c.duration.min+i*(c.duration.step||1));
 if(!durations.length)durations=Array.from({length:Math.min(120,(m?.max_duration||30)-(m?.min_duration||4)+1)},(_,i)=>(m?.min_duration||4)+i);
 options($('duration'),durations.map(d=>({value:String(d),label:d+' 秒'})),p().defaults.duration);
 const d=c?.duration,maxImages=c?.references?.images?.max_count??m?.max_images;
 const time=d?.values?.length?d.values.join('、')+' 秒':(d?.min??m?.min_duration)!==undefined&&(d?.max??m?.max_duration)!==undefined?`${d?.min??m.min_duration}–${d?.max??m.max_duration} 秒${d?.step?'，步长 '+d.step+' 秒':''}`:'时长限制待平台确认';
 $('modelInfo').textContent=m?`${modelLabel(m)} · ${time} · ${maxImages!==undefined?'参考图最多 '+maxImages+' 张':'参考图上限待平台确认'} · 提示词最多 ${c?.max_prompt_chars||m.max_prompt_chars||50000} 字。模型条件限制以平台校验为准。`:'连接后自动获取可用模型、能力与账户价格。';
}
function render(full=false){
 renderDownloadProxy(state);renderBuiltinProxy(state);const providerInfo=state.providers?.find(x=>x.base===state.base);$('apiDocsLink').href=providerInfo?.docs||'https://huimiaovip.com/docs/api';$('apiDocsLink').textContent=(providerInfo?.name||'官方')+'接口文档 ↗';
 const pr=p();if(document.activeElement!==$('downloadFolder'))$('downloadFolder').value=pr.downloadFolder||'';$('projects').innerHTML=state.projects.map(x=>`<button data-project="${esc(x.id)}" class="${x.id===pr.id?'selected':''}">▤ &nbsp;${esc(x.name)}</button>`).join('');
 $('connection').textContent=state.connected?'● 已连接 · 余额 '+(state.balance?.available??'—')+' 积分':'○ 尚未连接 API';
 const counts=[pr.tasks.length,pr.tasks.filter(t=>['uploading','submitting','queued','in_progress'].includes(t.status)).length,pr.tasks.filter(t=>t.status==='completed').length,pr.tasks.filter(t=>['failed','error','uncertain'].includes(t.status)).length];
 $('stats').innerHTML=['分镜总数','正在生成','生成完成','需要处理'].map((name,i)=>`<div class="stat"><span class="icon">${['▤','◴','✓','!'][i]}</span><div><small>${name}</small><b>${counts[i]}</b></div></div>`).join('');
 if(full){$('projectName').value=pr.name;$('raw').value=pr.raw||'';$('prefix').value=pr.prefix||'';$('suffix').value=pr.suffix||'';syncParameters();}
 $('assetCount').textContent=pr.assets.length+' 张';$('restoreAsset').hidden=!pr.deletedAssetCount;$('taskCount').textContent=pr.tasks.length+' 条';
 const selected=pr.tasks.find(t=>t.id===activeTask);
 $('assets').innerHTML=pr.assets.length?pr.assets.map(a=>`<div class="asset ${selected&&workingCopy(selected).assets.includes(a.id)?'selected':''}"><button class="asset-select" data-asset="${esc(a.id)}" title="${esc(a.name)}"><img src="/assets/${esc(a.file)}" alt="${esc(a.name)}"><small>${esc(a.name)}</small></button><button class="asset-delete" data-delete-asset="${esc(a.id)}" aria-label="删除图片 ${esc(a.name)}" title="删除图片">×</button></div>`).join(''):'<div class="empty"><b>＋ 添加你的角色、场景和物品</b>支持 PNG / JPG / WebP，图片保存在本机；生成时再上传。</div>';
 const filters=[['all','全部'],['draft','未提交'],['working','处理中'],['completed','已完成'],['failed','需处理']];
 $('filters').innerHTML=filters.map(([id,name])=>`<button data-filter="${id}" class="${filter===id?'selected':''}">${name}</button>`).join('');
 if(full||lastTaskSignature!==JSON.stringify(pr.tasks)||!$('tasks').contains(document.activeElement))renderTasks();
 const drafts=pr.tasks.filter(t=>['draft','pending'].includes(t.status));const prices=drafts.map(t=>price(t));const total=prices.every(v=>v!==null)?prices.reduce((a,b)=>a+b,0):null;
 $('quote').textContent=total!==null&&drafts.length?`待生成 ${drafts.length} 条 · 参考 ${total.toFixed(2)} 积分（实时价格可能变化）`:drafts.length?'报价不完整或含 Token 计费，以平台结算为准':'项目自动保存到本机';
 $('queueSummary').textContent=state.running?'队列正在提交…':`已保存 · ${pr.tasks.length} 个分镜`;
 $('start').textContent=state.running?'队列运行中':'▶ 批量生成';$('start').disabled=state.running;
}
async function initializeDefaults(){
 if(!state.models.some(m=>m.id===p().defaults.model))p().defaults.model=state.preferredModel||(state.protocol==='yingman'?'':state.models[0]?.id||'');
 syncParameters();p().defaults={model:$('model').value,ratio:$('ratio').value,resolution:$('resolution').value,duration:Number($('duration').value)};
 await persist({defaults:p().defaults});
}
function price(t){const m=state.models.find(m=>m.id===t.model);const rs=m?.pricing?.rules?.filter(r=>r.resolution===t.resolution&&r.durations?.includes(Number(t.duration)))||[];if(rs.length!==1||!['per_item','per_second'].includes(rs[0].billing_mode)||(m.billing_meter&&rs[0].billing_mode==='per_second'))return null;return Math.round(Number(rs[0].unit_price)*(rs[0].billing_mode==='per_second'?t.duration:1)*100)/100;}
function renderTasks(){const pr=p();lastTaskSignature=JSON.stringify(pr.tasks);const tasks=groupedTasks(pr.tasks).filter(t=>(filter==='all'||filter===t.status||(filter==='working'&&['pending','uploading','submitting','queued','in_progress'].includes(t.status))||(filter==='failed'&&['failed','error','uncertain'].includes(t.status)))&&(!search||((t.revision?.prompt||t.prompt)+t.label).includes(search)));
 $('tasks').innerHTML=tasks.length?tasks.map(t=>taskCard(t,pr,{modelOptions,price,activeTask,taskUrl,statuses})).join(''):'<div class="empty"><b>分镜准备好，创作就可以开始</b>在上方粘贴提示词，点击“解析分镜”。</div>';
}

function persist(fields){const url=endpoint();saveChain=saveChain.catch(()=>{}).then(()=>request(url,'PATCH',fields));return saveChain;}
function settings(){ $('provider').value=state.providers?.find(x=>x.base===state.base)?.id||'custom';$('providerHint').textContent=state.protocol==='yingman'?'默认使用 Seedance 2.5 Flash；请在萤漫设置 → API 密钥复制完整密钥。':'请选择接口站点并填写该站点的 API Key。';$('base').value=state.base;$('key').value='';$('connectStatus').textContent='';$('settingsDialog').showModal();}
$('provider').onchange=()=>{const item=state.providers?.find(x=>x.id===$('provider').value);if(item){$('base').value=item.base;$('key').placeholder=item.placeholder;}$('key').value='';$('providerHint').textContent=$('provider').value==='yingman'?'默认使用 Seedance 2.5 Flash，连接后从实际模型列表选择。':'填写所选站点的完整 API Key。';};
$('settings').onclick=settings;$('openSettings').onclick=settings;$('closeSettings').onclick=()=>$('settingsDialog').close();
$('connectForm').onsubmit=e=>{e.preventDefault();guard(async()=>{const b=$('connectForm').querySelector('[type=submit]');b.disabled=true;$('connectStatus').textContent='正在读取模型、价格和余额…';try{state=await request('/api/connect','POST',{base:$('base').value,key:$('key').value});await initializeDefaults();$('key').value='';$('settingsDialog').close();render(true);toast('已连接，请检查默认模型和参数；已有分镜可点击“应用到未提交分镜”');}catch(e){$('connectStatus').textContent=e.message;}finally{b.disabled=false;}});};
$('projects').onclick=e=>{const id=e.target.closest('[data-project]')?.dataset.project;if(id)guard(async()=>{await saveChain;current=id;localStorage.setItem('jx-project',id);activeTask=null;render(true);});};
$('newProject').onclick=()=>guard(async()=>{await saveChain;const pr=await request('/api/projects','POST',{});current=pr.id;await refresh(true);});
for(const [id,key]of [['projectName','name'],['raw','raw'],['prefix','prefix'],['suffix','suffix']])$(id).onchange=()=>guard(async()=>{p()[key]=$(id).value;await persist({[key]:$(id).value});});
// Save typing as well as blur, so closing or switching focus cannot silently lose edits.
for(const [id,key]of [['projectName','name'],['raw','raw'],['prefix','prefix'],['suffix','suffix']])$(id).oninput=()=>{
 const value=$(id).value,url=endpoint();p()[key]=value;clearTimeout($(id).saveTimer);
 $(id).saveTimer=setTimeout(()=>{saveChain=saveChain.catch(()=>{}).then(()=>request(url,'PATCH',{[key]:value}));guard(()=>saveChain);},350);
};
for(const id of ['model','ratio','resolution','duration'])$(id).onchange=()=>guard(async()=>{p().defaults[id]=id==='duration'?Number($(id).value):$(id).value;if(id==='model'||id==='resolution')syncParameters();p().defaults={model:$('model').value,ratio:$('ratio').value,resolution:$('resolution').value,duration:Number($('duration').value)};await persist({defaults:p().defaults});});
$('applyDefaults').onclick=()=>guard(async()=>{await saveChain;for(const t of p().tasks.filter(t=>t.status==='draft'))await request(taskUrl(t),'PATCH',{...p().defaults,autoDuration:true});await refresh();toast('已应用到全部未提交分镜');});
$('parse').onclick=()=>guard(async()=>{await persist({raw:$('raw').value});await request(endpoint()+'/parse','POST',{mode:$('splitMode').value});await refresh();toast('分镜已解析，并已自动匹配素材');});
$('uploadBtn').onclick=()=>$('images').click();$('folderBtn').onclick=()=>$('folder').click();
async function uploadFiles(files){let count=0;for(const f of files){if(!['image/png','image/jpeg','image/webp'].includes(f.type))continue;toast('正在保存图片：'+f.name);const r=await fetch(endpoint()+'/assets',{method:'POST',headers:{'Content-Type':f.type,'X-Filename':encodeURIComponent(f.name)},body:f});const data=await r.json();if(!r.ok)throw Error(data.error);count++;}await refresh();toast(`已添加 ${count} 张图片`);}
for(const id of ['images','folder'])$(id).onchange=()=>guard(async()=>{await uploadFiles($(id).files);$(id).value='';});
$('assets').ondragover=e=>e.preventDefault();$('assets').ondrop=e=>{e.preventDefault();guard(()=>uploadFiles(e.dataTransfer.files));};
$('restoreAsset').onclick=()=>guard(async()=>{await request(endpoint()+'/restore-asset','POST',{});await refresh();toast('图片已恢复，可重新匹配分镜引用');});
$('assets').onclick=e=>{const removed=e.target.closest('[data-delete-asset]')?.dataset.deleteAsset;if(removed){const asset=p().assets.find(a=>a.id===removed);if(confirm('删除图片“'+asset.name+'”？它将从合集和分镜引用中移除，已生成的视频保留。可点击“恢复上次删除”撤销。'))guard(async()=>{await saveChain;await request(endpoint()+'/assets/'+removed,'DELETE');await refresh();toast('图片已删除，可点击“恢复上次删除”撤销');});return;}const id=e.target.closest('[data-asset]')?.dataset.asset;if(!id)return;guard(async()=>{const t=p().tasks.find(t=>t.id===activeTask);if(!t)return toast('请先点击下方要分配素材的分镜');const chosen=workingCopy(t).assets;const ids=chosen.includes(id)?chosen.filter(a=>a!==id):[...chosen,id];await request(taskUrl(t),'PATCH',{assets:ids});await refresh();});};
$('match').onclick=()=>guard(async()=>{await request(endpoint()+'/match','POST',{});await refresh();toast('已按图片名称重新匹配');});
$('loadText').onclick=()=>$('textFile').click();$('textFile').onchange=()=>guard(async()=>{const f=$('textFile').files[0];if(f){$('raw').value=await f.text();await persist({raw:$('raw').value});} });
$('filters').onclick=e=>{if(e.target.dataset.filter){filter=e.target.dataset.filter;render();}};$('search').oninput=()=>{search=$('search').value;renderTasks();};
$('tasks').onclick=e=>{const article=e.target.closest('[data-task]');if(!article)return;const t=p().tasks.find(t=>t.id===article.dataset.task);activeTask=t.id;for(const el of document.querySelectorAll('.task'))el.classList.toggle('active',el===article);for(const el of document.querySelectorAll('[data-asset]'))el.classList.toggle('selected',t.assets.includes(el.dataset.asset));const op=e.target.dataset.op;if(!op)return;guard(async()=>{await saveChain;if(['history','play','download'].includes(op))await refresh();if(op==='history')return openHistory(t,{tasks:p().tasks,statuses,onPlay:playVersion,onDownload:downloadVersion});if(op==='play')return playVersion(latestCompleted(p().tasks,t)||t);if(op==='download')return downloadVersion(latestCompleted(p().tasks,t)||t);if(op==='edit')return openTaskEditor(t,{project:p(),modelOptions,request,url:taskUrl(t),onSaved:()=>refresh(),toast});if(op==='regenerate')return confirmRegenerate(t);if(op==='single')return confirmStart([t.id]);if(op==='preview'){const shown=workingCopy(t);const refs=shown.assets.map(id=>p().assets.find(a=>a.id===id)).filter(Boolean);const text=[p().prefix,refs.map((a,i)=>a.name.replace(/\.[^.]+$/,'')+'是参考图'+(i+1)).join('，'),shown.prompt,p().suffix].filter(Boolean).join('\n\n');const win=document.createElement('dialog');const ta=document.createElement('textarea');ta.value=text;ta.readOnly=true;ta.style='width:100%;height:60vh';const close=document.createElement('button');close.textContent='关闭';close.onclick=()=>{win.close();win.remove();};win.append(ta,close);document.body.append(win);return win.showModal();}if(op==='delete'){await request(taskUrl(t),'DELETE');}else{if(op==='download'){if(!await ensureDownloadFolder())return;toast('正在下载成片，请稍候…');}const result=await request(taskUrl(t)+'/'+op,'POST',{});if(op==='download')toast('已保存到：'+(result.savedPath||p().downloadFolder||'本地视频目录'));}await refresh();});};
$('tasks').onchange=e=>{const field=e.target.dataset.field;if(!field)return;const id=e.target.closest('[data-task]').dataset.task,t=p().tasks.find(x=>x.id===id);let value=e.target.value;if(field==='duration')value=Number(value);saveChain=saveChain.catch(()=>{}).then(()=>request(taskUrl(t),'PATCH',{[field]:value}));guard(async()=>{await saveChain;await refresh();});};
$('addTask').onclick=()=>guard(async()=>{const old=p().raw;await persist({raw:'{分镜 '+(p().tasks.length+1)+'}\n请输入分镜提示词'});await request(endpoint()+'/parse','POST',{mode:'markers'});await persist({raw:old});await refresh();});
async function confirmStart(ids){regeneration=null;$('confirmDialog').querySelector('h2').textContent='确认提交分镜';$('confirmSubmit').textContent='确认生成';await saveChain;submitIds=ids;const ts=p().tasks.filter(t=>(!ids||ids.includes(t.id))&&['draft','pending'].includes(t.status));if(!ts.length)return toast('没有待提交分镜');const prices=ts.map(price);const sum=prices.every(n=>n!==null)?prices.reduce((a,b)=>a+b,0).toFixed(2)+' 积分':'报价待平台确定';$('confirmContent').textContent=`本次生成 ${ts.length} 个分镜，参考费用：${sum}。接口站点：${state.base}`;$('confirmDialog').showModal();}
$('start').onclick=()=>guard(()=>confirmStart());$('cancelSubmit').onclick=()=>$('confirmDialog').close();$('confirmSubmit').onclick=()=>guard(async()=>{const button=$('confirmSubmit');if(button.disabled)return;button.disabled=true;try{if(regeneration){const result=await request(regeneration.url,'POST',regeneration.body);activeTask=result.taskId;filter='all';toast(regeneration.recover?'已恢复原请求，原任务记录保留':'已创建重新生成任务，原记录已保留');}else await request(endpoint()+'/start','POST',{ids:submitIds,concurrency:Number($('concurrency').value)});$('confirmDialog').close();await refresh();}finally{button.disabled=false;}});
$('pause').onclick=()=>guard(async()=>{await request('/api/pause','POST',{});await refresh();toast('已暂停后续提交，已经提交的平台任务继续生成');});
$('downloadAll').onclick=()=>guard(async()=>{if(!await ensureDownloadFolder())return;const ts=groupedTasks(p().tasks).map(t=>latestCompleted(p().tasks,t)).filter(Boolean);for(let i=0;i<ts.length;i++){toast(`正在下载 ${i+1}/${ts.length}`);await request(taskUrl(ts[i])+'/download','POST',{});}await refresh();toast(ts.length?'视频已保存到：'+p().downloadFolder:'没有已完成的成片');});
$('exportBtn').onclick=()=>guard(async()=>{await saveChain;location.href=endpoint()+'/export';});$('importBtn').onclick=()=>$('importFile').click();$('importFile').onchange=()=>guard(async()=>{const f=$('importFile').files[0];if(f){const pr=await request('/api/import','POST',JSON.parse(await f.text()));current=pr.id;await refresh(true);toast('项目已导入为新草稿，请重新检查后生成');}$('importFile').value='';});
async function chooseDownloadFolder(){
 const button=$('chooseDownloadFolder');button.disabled=true;toast('请选择保存文件夹，选择窗口可能在浏览器后面');
 try{const result=await request(endpoint()+'/download-folder','POST',{browse:true});await refresh();if(result.cancelled)return false;toast('保存目录已设置：'+result.folder);return true;}finally{button.disabled=false;}
}
async function ensureDownloadFolder(){
 if($('downloadFolder').value.trim()&&$('downloadFolder').value.trim()!==p().downloadFolder){await request(endpoint()+'/download-folder','POST',{folder:$('downloadFolder').value.trim()});await refresh();}
 return p().downloadFolder?true:await chooseDownloadFolder();
}
$('chooseDownloadFolder').onclick=()=>guard(chooseDownloadFolder);
$('saveDownloadFolder').onclick=()=>guard(async()=>{await request(endpoint()+'/download-folder','POST',{folder:$('downloadFolder').value});await refresh();toast('保存目录已更新');});
$('readDurations').onclick=()=>guard(async()=>{await saveChain;const result=await request(endpoint()+'/read-durations','POST',{});await refresh();toast(`已重新读取 ${result.count} 条未提交分镜的时间`);});
const renderDownloadProxy=setupDownloadProxy({request,refresh,toast});
const renderBuiltinProxy=setupBuiltinProxy({request,refresh,toast});
let regeneration=null;
function playVersion(t){return previewVideo(t,{url:taskUrl(t)+'/preview-video?version='+encodeURIComponent(t.remoteId||t.id),onDownload:()=>downloadVersion(t)});}
function downloadVersion(t){return guard(async()=>{if(!await ensureDownloadFolder())return;toast('正在下载所选版本…');const result=await request(taskUrl(t)+'/download','POST',{});toast('已保存到：'+result.savedPath);await refresh();});}
async function confirmRegenerate(t){await saveChain;await refresh();t=p().tasks.find(x=>x.id===t.id)||t;const shown=workingCopy(t);if(t.status==='uncertain'&&t.request){regeneration={url:taskUrl(t)+'/recover',body:{confirmed:true},recover:true};$('confirmDialog').querySelector('h2').textContent='确认重试原请求';$('confirmSubmit').textContent='确认重试';$('confirmContent').textContent=t.label+' 上次请求的结果尚未确认，将使用原请求标识重试并获取结果，避免重复新建任务。原请求确认失败后可以再编辑并重新生成。';$('confirmDialog').showModal();return;}regeneration={url:taskUrl(t)+'/regenerate',body:{confirmed:true,confirmationId:crypto.randomUUID(),revisionVersion:t.revisionVersion||0}};
 $('confirmDialog').querySelector('h2').textContent='确认重新生成';$('confirmSubmit').textContent='确认重新生成';
 $('confirmContent').textContent=t.label+' 将新建一个视频任务，'+(t.revision?'使用已保存的修改':'提示词保持不变')+'，时长 '+shown.duration+' 秒。'+(price(shown)!==null?'参考费用 '+price(shown)+' 积分。':'费用以平台结算为准。')+'原请求和生成记录会保留；请确认没有重复提交。';$('confirmDialog').showModal();}
setupUpdates({request,toast,beforeInstall:()=>saveChain});
installReferenceTooltip(id=>p()?.assets.find(a=>a.id===id));
await guard(()=>refresh(true));setInterval(()=>{if(!document.hidden&&state)guard(()=>refresh());},5000);
