export function updateBlockers({running,active=0,downloads=0,previews=0,testing=false,projects=[]}){
 const reasons=[];
 if(running||active||projects.some(p=>p.tasks.some(t=>['pending','uploading','submitting','queued','in_progress'].includes(t.status))))reasons.push('视频生成或队列尚未结束');
 if(downloads)reasons.push('视频正在下载');if(previews)reasons.push('请关闭成片预览');if(testing)reasons.push('节点检测尚未结束');return reasons;
}
export function reminderDue(state,snooze,now=Date.now()){
 return !!state.available&& !['downloading','installing'].includes(state.status)&&!(snooze?.version===state.version&&snooze.until>now);
}
export async function saveUpdateCheckpoint({snapshot,flush,save,editors=[],remember}){
 const value=snapshot();await flush();await save(value);
 for(const editor of editors)await editor();await remember();
}
