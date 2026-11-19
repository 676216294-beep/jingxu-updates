export function inferDuration(prompt, fallback=5) {
  const text=prompt.normalize('NFKC');
  const totals=[...text.matchAll(/(?:总时长|总时间|总计时长|合计时长|总长|总计|合计)\s*[：:=]?\s*(\d+(?:\.\d+)?)\s*(?:秒|s\b)/gi)];
  const ranges=[...text.matchAll(/(?:^|\n)\s*(?:[|｜]?\s*镜头\s*\d+\s*[|｜:：]\s*)?(\d+(?:\.\d+)?)\s*(?:秒|s)?\s*[–—\-~～至到]+\s*(\d+(?:\.\d+)?)\s*(?:秒|s\b)/gi)];
  const tags=[...text.matchAll(/【分镜时长\s+(\d+(?:\.\d+)?)s】/g)];
  const chosen=totals.at(-1)||ranges.at(-1)||tags.at(-1);
  const detected=chosen?Number(chosen===ranges.at(-1)?chosen[2]:chosen[1]):Number(fallback);
  const source=totals.length?'末尾总时长':ranges.length?'末镜结束时间':tags.length?'时长标签':'默认时长';
  if(!Number.isFinite(detected)||detected<=0)throw Error('无法读取有效的生成时长');
  return {duration:Math.ceil(detected),detectedDuration:detected,durationSource:source};
}
export function splitPrompts(text, mode='markers', duration=5) {
  text = text.replace(/\r\n?/g,'\n').trim();
  if (!text) return [];
  let parts;
  if(mode==='lines') parts=text.split('\n').filter(x=>x.trim()).map((prompt,i)=>({label:`分镜 ${i+1}`,prompt}));
  else if(mode==='blank') parts=text.split(/\n\s*\n/).filter(x=>x.trim()).map((prompt,i)=>({label:`分镜 ${i+1}`,prompt}));
  else {
    const re=/^\s*(?:\{分镜\s*(\d+)\}|【分镜\s*(\d+)】|#{1,4}\s*分镜\s*(\d+))\s*$/gm;
    const marks=[...text.matchAll(re)];
    if(!marks.length) throw Error('没有找到独占一行的 {分镜 N} 标记。也可选择每行一条或空行分隔。');
    parts=marks.map((m,i)=>({label:`分镜 ${m[1]||m[2]||m[3]}`,prompt:text.slice(m.index+m[0].length,marks[i+1]?.index??text.length).trim()}));
  }
  return parts.map(p=>{const tags=[...p.prompt.matchAll(/【分镜时长\s+(\d+(?:\.\d+)?)s】/g)]; if(tags.length>1) throw Error(`${p.label} 存在多个时长标签`); return {...p,...inferDuration(p.prompt,duration),prompt:p.prompt.replace(/【分镜时长\s+\d+(?:\.\d+)?s】/g,'').trim()};}).filter(x=>x.prompt);
}
const normal=s=>s.normalize('NFKC').replace(/[，。]/g,x=>x==='，'?',':'.');
export function matchAssets(prompt, assets) {
  const plain=normal(prompt.replace(/“[^”]*”|「[^」]*」|"[^"\n]*"/g,''));
  return assets.map(a=>({a,pos:plain.indexOf(normal(a.name.replace(/\.[^.]+$/,'')))})).filter(x=>x.pos>=0).sort((a,b)=>a.pos-b.pos || b.a.name.length-a.a.name.length).map(x=>x.a.id);
}
export function estimate(model, task) {
  const rules=model?.pricing?.rules?.filter(r=>r.resolution===task.resolution && r.durations?.includes(Number(task.duration)))||[];
  if(rules.length!==1 || !['per_item','per_second'].includes(rules[0].billing_mode) || (model.billing_meter && rules[0].billing_mode==='per_second')) return null;
  const r=rules[0];return Math.round(Number(r.unit_price)*(r.billing_mode==='per_second'?task.duration:1)*100)/100;
}
export function validate(task,model,assets,prompt=task.prompt) {
  const errors=[]; if(!model) return ['请先连接 API 并选择当前可用模型'];
  const c=model.capability_config||{}; const refs=c.references||{};
  if(!prompt.trim())errors.push('提示词不能为空');
  if([...prompt].length>(c.max_prompt_chars||model.max_prompt_chars||50000))errors.push('提示词超过模型字数上限');
  const d=Number(task.duration), conf=c.duration;
  if(!Number.isInteger(d)||d<=0)errors.push('时长必须为正整数');
  if(conf?.mode==='range' && (d<conf.min||d>conf.max||(d-(conf.min??0))%(conf.step||1)))errors.push(`当前时长 ${d} 秒；模型允许 ${conf.min??'未提供下限'}–${conf.max??'未提供上限'} 秒，步长 ${conf.step||1} 秒，请编辑分镜调整`);
  if(conf && conf.mode!=='range' && Array.isArray(conf.values) && !conf.values.includes(d))errors.push(`当前时长 ${d} 秒；模型允许 ${conf.values.join('、')} 秒，请编辑分镜调整`);
  if(!conf && (d<model.min_duration||d>model.max_duration))errors.push(`当前时长 ${d} 秒；模型允许 ${model.min_duration??'未提供下限'}–${model.max_duration??'未提供上限'} 秒，请编辑分镜调整`);
  const outputs=c.outputs||[];const output=outputs.find(o=>o.code===task.resolution);
  if(outputs.length&&!output)errors.push('不支持此分辨率');
  if(!(output?.ratios||model.supported_ratios||[]).includes(task.ratio))errors.push('不支持此画面比例');
  if(assets.length < (refs.images?.min_count||0))errors.push(`至少需要 ${refs.images.min_count} 张图片`);
  const maxImages=refs.images?.max_count??model.max_images;
  if(maxImages!==undefined&&assets.length>maxImages)errors.push(`当前引用 ${assets.length} 张参考图；模型最多允许 ${maxImages} 张，请编辑分镜取消多余引用或切换模型`);
  if(assets.length>(refs.max_total_count??model.max_reference_materials??Infinity))errors.push('素材总数超过上限');
  return errors;
}
