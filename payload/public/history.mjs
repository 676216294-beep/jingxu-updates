export function familyOf(tasks,task){
 const byId=new Map(tasks.map(t=>[t.id,t]));
 const rootOf=t=>{const seen=new Set();while(t.parentTaskId&&byId.has(t.parentTaskId)&&!seen.has(t.id)){seen.add(t.id);t=byId.get(t.parentTaskId);}return t.id;};
 const root=rootOf(task);return tasks.filter(t=>rootOf(t)===root);
}
export const latestCompleted=(tasks,task)=>familyOf(tasks,task).filter(t=>t.status==='completed').at(-1);
export function groupedTasks(tasks){const seen=new Set();return tasks.flatMap(t=>{if(seen.has(t.id))return [];const family=familyOf(tasks,t);family.forEach(v=>seen.add(v.id));return [family.at(-1)];});}
export function openHistory(task,{tasks,statuses,onPlay,onDownload,onRecover}){
 const family=familyOf(tasks,task),dialog=document.createElement('dialog');dialog.className='generation-history';
 const title=document.createElement('h2');title.textContent=family[0].label+' · 生成记录（'+family.length+' 版）';
 const close=document.createElement('button');close.textContent='关闭';close.onclick=()=>dialog.close();
 const head=document.createElement('div');head.className='section-head';head.append(title,close);dialog.append(head);
 [...family].reverse().forEach((v,i)=>{const row=document.createElement('section');row.className='history-row';
  const label=document.createElement('strong');label.textContent='第 '+(family.length-i)+' 版'+(i===0?' · 最新提交':'')+' · '+(statuses[v.status]||v.status);
  const info=document.createElement('p');info.className='hint';info.textContent=[v.createdAt?new Date(v.createdAt).toLocaleString():'早期记录（未记录提交时间）',v.remote?.public_id||v.remoteId||'尚无平台编号',v.duration+' 秒',v.resolution].join(' · ');
  const details=document.createElement('details'),summary=document.createElement('summary'),prompt=document.createElement('pre');summary.textContent='查看本版提交内容';prompt.textContent=v.request?.prompt||v.preparedPrompt||v.prompt;details.append(summary,prompt);row.append(label,info,details);
  if(v.status==='completed'){const actions=document.createElement('div');actions.className='actions';const play=document.createElement('button'),download=document.createElement('button');play.textContent='▶ 预览此版';download.textContent='下载此版';play.onclick=()=>onPlay(v);download.onclick=()=>onDownload(v);actions.append(play,download);row.append(actions);}
  if(onRecover&&(v.status==='uncertain'||v.status==='error'&&v.request)){const recover=document.createElement('button');recover.textContent='恢复确认';recover.onclick=()=>{dialog.close();onRecover(v);};row.append(recover);}
  if(v.error){const error=document.createElement('p');error.className='error-msg';error.textContent=v.error;row.append(error);}dialog.append(row);
 });dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();
}
