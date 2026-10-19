import test from 'node:test';
import assert from 'node:assert/strict';
import {setupFocusMode} from '../dist/focus.mjs';
function setup({supported=true,rejectEnter=false,rejectExit=false}={}){
 const messages=[],events={},els={};let enters=0,exits=0;
 for(const id of ['focus-open','focus-exit','focus-toolbar','fullscreen-toggle'])els[id]={attrs:{},events:{},hidden:false,disabled:false,focusCount:0,setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,f){this.events[k]=f;},focus(){this.focusCount++;}};
 const doc={documentElement:{dataset:{}},fullscreenElement:null,fullscreenEnabled:supported,getElementById:id=>els[id],addEventListener:(e,f)=>events[e]=f};
 if(supported){doc.documentElement.requestFullscreen=async()=>{enters++;if(rejectEnter)throw Error('denied');doc.fullscreenElement=doc.documentElement;events.fullscreenchange();};doc.exitFullscreen=async()=>{exits++;if(rejectExit)throw Error('denied');doc.fullscreenElement=null;events.fullscreenchange();};}
 const control=setupFocusMode({doc,notify:s=>messages.push(s)});
 return {doc,els,events,messages,control,counts:()=>({enters,exits})};
}
test('focus enter and visible exit change presentation only without forcing fullscreen',async()=>{
 const h=setup();assert.equal(h.doc.documentElement.dataset.focus,'false');assert.equal(h.els['focus-toolbar'].hidden,true);h.els['focus-open'].events.click();assert.equal(h.doc.documentElement.dataset.focus,'true');assert.equal(h.els['focus-toolbar'].hidden,false);assert.equal(h.els['focus-open'].attrs['aria-pressed'],'true');assert.equal(h.els['focus-exit'].focusCount,1);assert.deepEqual(h.counts(),{enters:0,exits:0});await h.els['focus-exit'].events.click();assert.equal(h.control.isFocused(),false);assert.equal(h.els['focus-toolbar'].hidden,true);assert.equal(h.els['focus-open'].focusCount,1);
});
test('actual fullscreen is requested only from its separate user action and stays synchronized',async()=>{
 const h=setup();h.control.enter();assert.equal(h.counts().enters,0);await h.els['fullscreen-toggle'].events.click();assert.equal(h.counts().enters,1);assert.equal(h.els['fullscreen-toggle'].attrs['aria-pressed'],'true');assert.equal(h.els['fullscreen-toggle'].textContent,'全画面を解除');h.doc.fullscreenElement=null;h.events.fullscreenchange();assert.equal(h.els['fullscreen-toggle'].attrs['aria-pressed'],'false');assert.equal(h.els['fullscreen-toggle'].textContent,'全画面');assert.equal(h.control.isFocused(),true);
});
test('unsupported fullscreen retains focus mode and explains the fallback',async()=>{
 const h=setup({supported:false});h.control.enter();assert.equal(h.els['fullscreen-toggle'].disabled,true);await h.control.toggleFullscreen();assert.equal(h.control.isFocused(),true);assert.match(h.messages[0],/集中表示/);assert.deepEqual(h.counts(),{enters:0,exits:0});
});
test('denied fullscreen request does not lose focus view or claim fullscreen',async()=>{
 const h=setup({rejectEnter:true});h.control.enter();await h.control.toggleFullscreen();assert.equal(h.control.isFocused(),true);assert.equal(h.doc.fullscreenElement,null);assert.equal(h.els['fullscreen-toggle'].attrs['aria-pressed'],'false');assert.match(h.messages[0],/切り替えられません/);
});
test('visible exit exits browser fullscreen before restoring menus',async()=>{
 const h=setup();h.control.enter();await h.control.toggleFullscreen();await h.control.exit();assert.equal(h.doc.fullscreenElement,null);assert.equal(h.control.isFocused(),false);assert.equal(h.els['focus-toolbar'].hidden,true);assert.equal(h.counts().exits,1);
});
test('failed fullscreen exit keeps a visible exit and clear recovery instruction',async()=>{
 const h=setup({rejectExit:true});h.control.enter();await h.control.toggleFullscreen();await h.control.exit();assert.equal(h.control.isFocused(),true);assert.equal(h.els['focus-toolbar'].hidden,false);assert.equal(h.els['fullscreen-toggle'].attrs['aria-pressed'],'true');assert.match(h.messages[0],/Esc/);
});
test('Escape exits ordinary focus mode; native fullscreen changes update the button',()=>{
 const h=setup();let prevented=false;h.control.enter();h.events.keydown({key:'Escape',preventDefault(){prevented=true;}});assert.equal(h.control.isFocused(),false);assert.equal(prevented,true);
});
test('exit during pending fullscreen entry keeps controls visible then cancels native fullscreen',async()=>{
 const h=setup();let finishEntry;h.doc.documentElement.requestFullscreen=()=>new Promise(resolve=>{finishEntry=()=>{h.doc.fullscreenElement=h.doc.documentElement;h.events.fullscreenchange();resolve();};});
 h.control.enter();const pending=h.control.toggleFullscreen();await h.control.exit();assert.equal(h.control.isFocused(),true);assert.equal(h.els['focus-toolbar'].hidden,false);assert.equal(h.els['fullscreen-toggle'].disabled,true);
 finishEntry();await pending;assert.equal(h.doc.fullscreenElement,null);assert.equal(h.control.isFocused(),false);assert.equal(h.els['focus-toolbar'].hidden,true);assert.equal(h.els['fullscreen-toggle'].disabled,false);
});
test('Escape during pending entry retains a visible exit if native cancellation fails',async()=>{
 const h=setup({rejectExit:true});let finishEntry;h.doc.documentElement.requestFullscreen=()=>new Promise(resolve=>{finishEntry=()=>{h.doc.fullscreenElement=h.doc.documentElement;h.events.fullscreenchange();resolve();};});
 h.control.enter();const pending=h.control.toggleFullscreen();h.events.keydown({key:'Escape',preventDefault(){}});finishEntry();await pending;assert.equal(h.control.isFocused(),true);assert.equal(h.els['focus-toolbar'].hidden,false);assert.equal(h.els['fullscreen-toggle'].attrs['aria-pressed'],'true');assert.match(h.messages.at(-1),/Esc/);
});
