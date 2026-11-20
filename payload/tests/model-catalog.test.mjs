import test from 'node:test';
import assert from 'node:assert/strict';
import {modelLabel,modelPriceText} from '../public/model-catalog.mjs';
import {preferredModel,enrichModelDetails} from '../providers.mjs';
test('同名模型显示价格、单位、渠道及真实 ID，不自动猜选重名默认模型',()=>{
 const a={id:'cheap',name:'Seedance 2.5 Flash',channelName:'特价渠道',billingMode:'fixed_request',unitPriceMicrocredits:250000000};
 const b={...a,id:'expensive',channelName:'另一渠道',unitPriceMicrocredits:300000000};
 assert.match(modelLabel(a),/250 积分\/次.*特价渠道.*ID: cheap/);
 assert.notEqual(modelLabel(a),modelLabel(b));assert.equal(preferredModel([a,b],'yingman'),'');assert.equal(preferredModel([b],'yingman'),'expensive');
 assert.equal(modelPriceText({...a,unitPriceMicrocredits:0}),'0 积分/次');
 assert.equal(modelPriceText({id:'unknown'}),'价格未提供');
 assert.equal(modelPriceText({unitPriceMicrocredits:250000000}),'价格未提供');
 assert.equal(modelPriceText({pricing:{rules:[{resolution:'720p',billing_mode:'per_second',unit_price:10}]}}),'720p 10 积分/秒');
});
test('模型详情读取价格，失败保留列表，拒绝混入其他模型 ID',async()=>{
 const models=[{id:'a',capability:'video'},{id:'b',capability:'video'},{id:'c',capability:'video'},{id:'text',capability:'text'}],calls=[];
 const output=await enrichModelDetails(models,async route=>{calls.push(route);if(route.endsWith('/a'))return {id:'a',billingMode:'fixed_request',unitPriceMicrocredits:250000000};if(route.endsWith('/b'))throw Error('not supported');return {id:'wrong-id',pricing:'incorrect'};});
 assert.equal(modelPriceText(output[0]),'250 积分/次');assert.deepEqual(output[1],models[1]);assert.deepEqual(output[2],models[2]);assert.equal(calls.length,3);assert.equal(models[0].unitPriceMicrocredits,undefined);
});
