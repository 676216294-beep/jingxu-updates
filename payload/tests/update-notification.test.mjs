import test from 'node:test';
import assert from 'node:assert/strict';
import {reminderDue,updateBlockers,saveUpdateCheckpoint} from '../public/update-policy.mjs';
test('新版提醒可稍后，同版一小时内不重复；新版本立即可提醒',()=>{
 const state={status:'checked',available:true,version:'1.6.1'};
 assert.equal(reminderDue(state,null,100),true);
 assert.equal(reminderDue(state,{version:'1.6.1',until:200},100),false);
 assert.equal(reminderDue(state,{version:'1.6.1',until:200},201),true);
 assert.equal(reminderDue({...state,version:'1.6.2'},{version:'1.6.1',until:200},100),true);
 assert.equal(reminderDue({...state,status:'installing'},null),false);
});
test('阻止更新的活动逐项提示，草稿和已完成文档不阻止',()=>{
 assert.deepEqual(updateBlockers({projects:[{tasks:[{status:'draft'},{status:'completed'}]}]}),[]);
 assert.equal(updateBlockers({projects:[{tasks:[{status:'queued'}]}],downloads:1,previews:1,testing:true}).length,4);
});
test('更新先捕获未失焦内容，等旧保存结束，再保存页面及编辑弹窗；失败阻止后续更新',async()=>{
 let typed='尚未失焦的提示词';const order=[];
 await saveUpdateCheckpoint({snapshot:()=>typed,flush:async()=>{order.push('old');typed='old';},save:async v=>{order.push(v);},editors:[async()=>order.push('editor')],remember:()=>order.push('view')});
 assert.deepEqual(order,['old','尚未失焦的提示词','editor','view']);
 let remembered=false;await assert.rejects(()=>saveUpdateCheckpoint({snapshot:()=>'',flush:async()=>{},save:async()=>{throw Error('磁盘写入失败');},remember:()=>remembered=true}),/磁盘/);assert.equal(remembered,false);
});
