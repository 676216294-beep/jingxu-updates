export const providers=[
 {id:'huimiao',name:'Huimiao',base:'https://huimiaovip.com',docs:'https://huimiaovip.com/docs/api',placeholder:'hm_live_…'},
 {id:'yingman',name:'萤漫',base:'https://yingman.xlapis.com',docs:'https://yingman.xlapis.com/settings?section=api-docs',placeholder:'sk-mc-…'}
];
export const protocolFor=base=>{try{return new URL(base).hostname==='yingman.xlapis.com'?'yingman':'huimiao';}catch{return 'huimiao';}};
export const taskProtocol=(task,current)=>task.apiProtocol||protocolFor(task.apiBase||current);
export const videoRoute=(protocol,id)=>protocol==='yingman'?'/v1/videos'+(id?'/'+encodeURIComponent(id):''):'/v1/videos/generations'+(id?'/'+encodeURIComponent(id):'');
const compact=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');
export function preferredModel(models,protocol){
 if(protocol!=='yingman')return '';
 return models.find(m=>[m.name,m.display_name,m.displayName,m.id].some(value=>{const key=compact(value);return key==='seedance25flash'||key==='agnesvideo25flash'||key.includes('seedance25flash');}))?.id||'';
}
export function normalizeModels(input,protocol){
 if(protocol!=='yingman')return input;
 return input.filter(m=>!m.capability||typeof m.capability!=='string'||m.capability==='video').map(m=>{
  if(m.capability_config)return {...m,name:m.name||m.display_name||m.displayName||m.id};
  const v=m.capabilities?.video||m.capabilityConfig?.video||{},flash=!!preferredModel([m],'yingman');
  const ratios=v.ratios||m.supported_ratios||['21:9','16:9','4:3','1:1','3:4','9:16'];
  const resolutions=(v.resolutions||m.supported_resolutions||['720p']).map(x=>String(x).toLowerCase());
  const duration=v.duration||{},min=duration.min||m.min_duration||4,max=duration.max||m.max_duration||(flash?12:12),values=duration.values;
  return {...m,name:m.name||m.display_name||m.displayName||m.id,supported_ratios:ratios,supported_resolutions:resolutions,min_duration:min,max_duration:max,
   capability_config:{duration:values?{mode:'values',values}:{mode:'range',min,max,step:duration.step||1},outputs:resolutions.map(code=>({code,ratios})),references:{images:{max_count:v.references?.maxImages??m.max_images??(flash?5:0)}},max_prompt_chars:v.references?.promptMaxChars||m.max_prompt_chars||32000}};
 });
}
export function pixelSize(resolution,ratio){
 const short=({'480p':480,'720p':720,'768p':768,'960p':960,'1080p':1080,'2k':1440,'4k':2160})[String(resolution).toLowerCase()];
 const m=/^(\d+):(\d+)$/.exec(ratio);if(!short||!m)throw Error('萤漫不支持此分辨率或画面比例');const a=Number(m[1]),b=Number(m[2]);if(!a||!b)throw Error('画面比例无效');
 const even=n=>Math.round(n/2)*2;return a>=b?`${even(short*a/b)}x${short}`:`${short}x${even(short*b/a)}`;
}
export function yingmanPayload(task,assets,prompt){return {model:task.model,prompt,seconds:Number(task.duration),size:pixelSize(task.resolution,task.ratio),references:assets.map(a=>({file:a.file,name:a.name,type:a.type}))};}
export async function yingmanForm(payload,readAsset){
 const form=new FormData();for(const key of ['model','prompt','seconds','size'])form.set(key,String(payload[key]));
 for(const asset of payload.references||[]){if(!/^[a-zA-Z0-9.-]+$/.test(asset.file))throw Error('素材路径无效');form.append('input_reference',new Blob([await readAsset(asset.file)],{type:asset.type}),asset.name);}
 return form;
}
