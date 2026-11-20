const numeric=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v))?Number(v):null;
const format=n=>Number(n.toFixed(6)).toLocaleString('zh-CN',{maximumFractionDigits:6});
const units={per_item:'次',fixed_request:'次',per_second:'秒',token:'百万 Token'};
export function modelPriceText(model){
 const pricing=model.pricing;
 if(typeof pricing==='string'&&pricing.trim())return pricing;
 const rules=Array.isArray(pricing?.rules)?pricing.rules:[];
 const parts=rules.map(r=>{
  const n=numeric(r.unit_price),unit=units[r.billing_mode];if(n===null||!unit)return '';
  return `${r.resolution?r.resolution+' ':''}${format(n)} 积分/${unit}`;
 }).filter(Boolean);
 if(parts.length)return [...new Set(parts)].join('；');
 const price=pricing&&typeof pricing==='object'?pricing:model;
 const mode=price.billing_mode??price.billingMode,unit=units[mode];
 const micro=numeric(price.unitPriceMicrocredits??price.unit_price_microcredits);
 const amount=micro!==null?micro/1e6:numeric(price.unit_price);
 if(amount!==null&&unit)return `${format(amount)} 积分/${unit}`;
 return '价格未提供';
}
export function modelLabel(model){
 const channel=model.channel_name??model.channelName??model.channel?.name;
 return [model.name||model.display_name||model.displayName||model.id,modelPriceText(model),channel,`ID: ${model.id}`].filter(Boolean).join(' · ');
}
