// Simulated DOM integration checks, not a substitute for real browser QA.
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import fs from 'node:fs';import * as engine from '../dist/engine.mjs';import * as alarm from '../dist/alarm.mjs';import * as focus from '../dist/focus.mjs';import * as digits from '../dist/digits.mjs';
class Element {
  constructor(id='',data={}){this.id=id;this.dataset=data;this.textContent='';this.value='';this.hidden=false;this.disabled=false;this.tagName='DIV';this.events={};this.attrs={};this.children=[];this.classes=new Set();this.classList={toggle:(key,on)=>on?this.classes.add(key):this.classes.delete(key)};this.style={setProperty(){}};}
  addEventListener(k,cb){this.events[k]=cb;} setAttribute(k,v){this.attrs[k]=v;} append(e){this.children.push(e);} querySelector(){return this.child ||= new Element();} focus(){} click(){if(!this.disabled)this.events.click?.({});} showModal(){this.open=true;}close(){this.open=false;}
}
function setup(saved,preferences,href='https://timer.example/',nav={}){
  const prefix=`bar-time:${new URL('./',href).pathname}:`;
  let now=10000;const docEvents={},winEvents={},ticks=[],storage=new Map(saved ? [[`${prefix}state-v1`,JSON.stringify(saved)]] : []),elements=new Map();
  if(preferences)storage.set(`${prefix}prefs-v1`,JSON.stringify(preferences));
  const html=fs.readFileSync('dist/index.html','utf8');for(const m of html.matchAll(/<[^>]*\bid="([^"]+)"[^>]*>/g)){const element=new Element(m[1]);element.hidden=/\bhidden(?:[ >])/.test(m[0]);elements.set(m[1],element);}
  const modes=['down','up','repeat'].map(mode=>{const e=elements.get('tab-'+mode);e.dataset.mode=mode;return e;});
  const presets=[300,600,1500,2700].map(n=>new Element('',{preset:String(n)}));const colors=['lemon','mint','marine','ice'].map(n=>new Element('',{color:n}));const increments=[600,60,10].map((n,i)=>{const e=i===1?elements.get('minute-key'):i===2?elements.get('second-key'):new Element();e.dataset.increment=String(n);return e;});const tabs=new Element();
  const document={getElementById:id=>elements.get(id)||null,createElement:()=>new Element(),querySelectorAll:s=>s==='[data-mode]'?modes:s==='[data-preset]'?presets:s==='[data-color]'?colors:s==='[data-increment]'?increments:[],querySelector:()=>tabs,documentElement:{dataset:{}},activeElement:{tagName:'BODY'},addEventListener:(e,f)=>docEvents[e]=f,visibilityState:'visible',title:''};
  const window={addEventListener:(e,f)=>winEvents[e]=f,matchMedia:()=>({matches:false}),navigator:{},confirm:()=>true,isSecureContext:false};
  class FakeDate extends Date{static now(){return now;}}
  const ctx={...engine,...alarm,...focus,...digits,document,window,navigator:{onLine:true,...nav},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},Date:FakeDate,setInterval:f=>ticks.push(f),setTimeout:()=>1,clearTimeout(){},URL,location:{href},console};
  vm.runInNewContext(fs.readFileSync('dist/app.mjs','utf8').replace(/^import .*?;\n/gm,''),ctx);
  return {elements,storage,modes,presets,colors,increments,document,winEvents,docEvents,click:id=>elements.get(id).click(),advance:ms=>{now+=ms;ticks.forEach(f=>f());},view:()=>JSON.parse(storage.get(`${prefix}state-v1`)||'null'),change:(id,value)=>{const e=elements.get(id);e.value=value;e.events.change?.();},el:id=>elements.get(id)};
}
test('UI initializes, presets work, countdown pauses/resumes and reset unlocks configuration',()=>{
  const ui=setup();assert.equal(ui.el('digit-min').textContent,'25');ui.presets[0].click();assert.equal(ui.el('digit-min').textContent,'05');ui.click('main-action');assert.equal(ui.el('action-label').textContent,'ストップ');assert.equal(ui.el('duration-min').disabled,true);ui.advance(1100);assert.equal(ui.el('digit-sec').textContent,'59');ui.click('main-action');ui.advance(5000);assert.equal(ui.el('digit-sec').textContent,'59');ui.click('main-action');ui.advance(1000);assert.equal(ui.el('digit-sec').textContent,'58');ui.click('reset');assert.equal(ui.el('digit-min').textContent,'05');assert.equal(ui.el('duration-min').disabled,false);
});
test('UI completion and reload show persisted expiry without replaying alarms',()=>{
  const s=engine.start(engine.createState({duration:1}),5000);const ui=setup(s);assert.equal(ui.el('completion').hidden,false);assert.equal(ui.el('action-label').textContent,'スタート');assert.equal(ui.el('digit-sec').textContent,'01');assert.equal(ui.el('alarm-status').hidden,true);ui.click('main-action');assert.equal(ui.el('completion').hidden,true);ui.advance(1000);assert.equal(ui.el('completion').hidden,false);
});
test('UI stopwatch counts up and mode changes reset the correct display',()=>{
  const ui=setup();ui.modes[1].click();assert.equal(ui.el('digit-min').textContent,'00');assert.equal(ui.el('up-settings').hidden,false);ui.click('main-action');ui.advance(3200);assert.equal(ui.el('digit-sec').textContent,'03');assert.equal(ui.el('screen-label').textContent,'経過時間');ui.click('reset');ui.modes[0].click();assert.equal(ui.el('digit-min').textContent,'25');
});
test('UI repeat progresses through work/rest and ends after final work',()=>{
  const ui=setup();ui.modes[2].click();ui.change('work-min',0);ui.change('work-sec',2);ui.change('rest-min',0);ui.change('rest-sec',1);ui.change('cycles',2);ui.click('main-action');ui.advance(2000);assert.equal(ui.el('phase-text').textContent,'BREAK');ui.advance(1000);assert.equal(ui.el('cycle-label').textContent,'残り 01回');ui.advance(2000);assert.equal(ui.el('completion').hidden,false);assert.equal(ui.el('completion-title').textContent,'2回の作業が終わりました。');
});
test('UI preferences persist, help opens, and unsupported wake lock is explained',()=>{
  const ui=setup();ui.colors[2].click();assert.equal(ui.document.documentElement.dataset.theme,'marine');ui.click('sound-toggle');assert.equal(ui.el('sound-toggle').attrs['aria-checked'],'true');assert.equal(ui.el('sound-quick').attrs['aria-pressed'],'true');ui.click('install-open');assert.equal(ui.el('guide').open,true);assert.equal(ui.el('wake-toggle').disabled,true);assert.match(ui.el('wake-description').textContent,/非対応/);assert.equal(JSON.parse(ui.storage.get('bar-time:/:prefs-v1')).theme,'marine');
});

test('muted completion flashes LED for ten seconds then restores the preset',()=>{
  const ui=setup();ui.change('duration-min',0);ui.change('duration-sec',2);ui.click('main-action');ui.advance(2000);assert.equal(ui.el('sound-toggle').attrs['aria-checked'],'false');assert.equal(ui.el('alarm-status').hidden,false);assert.equal(ui.el('led').classes.has('on'),true);assert.equal(ui.el('digit-sec').textContent,'00');
  ui.advance(500);assert.equal(ui.el('led').classes.has('on'),false);assert.equal(ui.el('device').classes.has('alarm-blink'),true);ui.advance(500);assert.equal(ui.el('led').classes.has('on'),true);
  for(let i=0;i<8;i++)ui.advance(1000);assert.equal(ui.el('alarm-status').hidden,false);ui.advance(1000);assert.equal(ui.el('alarm-status').hidden,true);assert.equal(ui.el('led').classes.has('on'),false);assert.equal(ui.el('digit-sec').textContent,'02');assert.equal(ui.view().status,'idle');assert.equal(ui.el('completion').hidden,false);
});
test('repeat transition visual alert lasts three seconds while counting continues',()=>{
 const ui=setup();ui.modes[2].click();ui.change('work-min',0);ui.change('work-sec',2);ui.change('rest-min',0);ui.change('rest-sec',5);ui.change('cycles',2);ui.click('main-action');ui.advance(2000);assert.equal(ui.el('alarm-status').hidden,false);for(let i=0;i<2;i++)ui.advance(1000);assert.equal(ui.el('alarm-status').hidden,false);ui.advance(1000);assert.equal(ui.el('alarm-status').hidden,true);assert.equal(ui.el('digit-sec').textContent,'02');assert.equal(ui.view().status,'running');
});
test('start-stop dismisses completion without starting another timer',()=>{
 const ui=setup();ui.change('duration-min',0);ui.change('duration-sec',1);ui.click('main-action');ui.advance(1000);assert.equal(ui.el('alarm-status').hidden,false);ui.click('main-action');assert.equal(ui.el('alarm-status').hidden,true);assert.equal(ui.view().status,'idle');assert.equal(ui.el('digit-sec').textContent,'01');
});
test('late completion and missed repeat phases do not replay alarms',()=>{
 const ui=setup();ui.change('duration-min',0);ui.change('duration-sec',2);ui.click('main-action');ui.advance(60000);assert.equal(ui.el('alarm-status').hidden,true);assert.equal(ui.el('digit-sec').textContent,'02');assert.equal(ui.view().status,'idle');assert.equal(ui.el('completion').hidden,false);
 const r=setup();r.modes[2].click();r.change('work-min',0);r.change('work-sec',2);r.change('rest-min',0);r.change('rest-sec',1);r.change('cycles',99);r.click('main-action');r.advance(100000);assert.equal(r.el('alarm-status').hidden,true);assert.equal(r.el('cycle-label').textContent,'残り 66回');
});
test('legacy settings migrate colors while timer settings and sound persist',()=>{
 const state=engine.createState({duration:1800,work:1200,rest:180,cycles:6});const ui=setup(state,{theme:'ink',sound:true,wake:false});assert.equal(ui.document.documentElement.dataset.theme,'marine');assert.equal(ui.el('color-label').textContent,'マリンブルー');assert.equal(ui.el('digit-min').textContent,'30');assert.equal(ui.el('cycles').value,6);assert.equal(ui.el('sound-toggle').attrs['aria-checked'],'true');
});
test('physical-order increment keys and simultaneous reset keep timer limits',()=>{
 const ui=setup();ui.increments[0].click();assert.equal(ui.el('digit-min').textContent,'35');ui.increments[1].click();assert.equal(ui.el('digit-min').textContent,'36');ui.increments[2].click();assert.equal(ui.el('digit-sec').textContent,'10');ui.change('duration-min',99);ui.change('duration-sec',50);ui.increments[0].click();assert.equal(ui.el('digit-min').textContent,'99');assert.equal(ui.el('digit-sec').textContent,'50');ui.click('main-action');ui.advance(1000);assert.equal(ui.el('minute-key').disabled,false);assert.equal(ui.el('second-key').disabled,false);ui.el('minute-key').events.pointerdown();ui.el('second-key').events.pointerdown();assert.equal(ui.view().status,'idle');assert.equal(ui.el('digit-sec').textContent,'50');
});
test('screen power pauses safely and keeps settings without granting background alarms',()=>{
 const ui=setup();ui.click('main-action');ui.advance(1000);ui.click('power');assert.equal(ui.el('device').classes.has('is-off'),true);assert.equal(ui.el('main-action').disabled,true);assert.equal(ui.view().status,'paused');ui.advance(5000);ui.click('power');assert.equal(ui.el('main-action').disabled,false);assert.equal(ui.el('digit-sec').textContent,'59');
});

test('a zero-rest repeat announces the next work interval, never a fictitious break',()=>{
 const ui=setup();ui.modes[2].click();ui.change('work-min',0);ui.change('work-sec',2);ui.change('rest-min',0);ui.change('rest-sec',0);ui.change('cycles',2);ui.click('main-action');ui.advance(2000);assert.match(ui.el('alarm-message').textContent,/作業を開始/);assert.equal(ui.el('screen-label').textContent,'◷ 作業');
});

test('entering and exiting focus display never resets or pauses the running timer',async()=>{
 const ui=setup();ui.click('main-action');ui.advance(1000);const started=ui.view().startedAt;ui.click('focus-open');assert.equal(ui.document.documentElement.dataset.focus,'true');assert.equal(ui.el('focus-toolbar').hidden,false);ui.advance(2000);assert.equal(ui.el('digit-sec').textContent,'57');assert.equal(ui.view().startedAt,started);assert.equal(ui.view().status,'running');await ui.el('focus-exit').events.click();assert.equal(ui.document.documentElement.dataset.focus,'false');assert.equal(ui.el('focus-toolbar').hidden,true);ui.advance(1000);assert.equal(ui.el('digit-sec').textContent,'56');assert.equal(ui.view().status,'running');
});

test('LCD uses one fixed-layout SVG for all four digits across changing values',()=>{
 const ui=setup();assert.equal((ui.el('digital-display').innerHTML.match(/<svg /g)||[]).length,1);assert.match(ui.el('digital-display').innerHTML,/viewBox="0 0 220 76"/);ui.click('main-action');ui.advance(1000);assert.equal((ui.el('digital-display').innerHTML.match(/<svg /g)||[]).length,1);assert.match(ui.el('digital-display').innerHTML,/viewBox="0 0 220 76"/);
});

test('Pages settings and timer state are scoped to the deployment path',()=>{
 const ui=setup(null,null,'https://timer.example/bar-time/');ui.colors[2].click();ui.click('main-action');ui.advance(1000);
 assert(ui.storage.has('bar-time:/bar-time/:prefs-v1'));assert(ui.storage.has('bar-time:/bar-time/:state-v1'));
 assert(!ui.storage.has('bar-time:/:prefs-v1'));assert(!ui.storage.has('bar-time:/:state-v1'));
});

const withVibration=(preferences,nav={})=>{const calls=[];const ui=setup(null,preferences,'https://timer.example/bar-time/',{vibrate:p=>{calls.push(p);return true;},...nav});return {ui,calls};};
const positive=calls=>calls.filter(p=>Array.isArray(p)||p>0);
function shortTimer(ui){ui.change('duration-min',0);ui.change('duration-sec',1);ui.click('main-action');ui.advance(1000);}
test('vibration defaults off, is independent of sound and persists by path',()=>{
 const {ui,calls}=withVibration();assert.equal(ui.el('vibration-toggle').attrs['aria-checked'],'false');shortTimer(ui);assert.equal(positive(calls).length,0);ui.click('vibration-toggle');
 const prefs=JSON.parse(ui.storage.get('bar-time:/bar-time/:prefs-v1'));assert.equal(prefs.vibration,true);assert.equal(prefs.sound,false);ui.click('sound-toggle');assert.equal(ui.el('vibration-toggle').attrs['aria-checked'],'true');ui.click('sound-toggle');assert.equal(ui.el('vibration-toggle').attrs['aria-checked'],'true');
 ui.click('vibration-test');assert.equal(positive(calls).at(-1),200);assert.match(ui.el('toast').textContent,/リクエスト/);ui.click('vibration-toggle');assert.equal(calls.at(-1),0);assert.equal(ui.el('vibration-test').disabled,true);
});
test('saved vibration preference survives reload and completion is bounded and cancellable',()=>{
 const {ui,calls}=withVibration({vibration:true});assert.equal(ui.el('vibration-toggle').attrs['aria-checked'],'true');shortTimer(ui);assert.deepEqual(Array.from(positive(calls).at(-1)),[300,150,300,150,300]);ui.advance(1000);assert.equal(positive(calls).length,1);ui.click('alarm-stop');assert.equal(calls.at(-1),0);
 shortTimer(ui);ui.click('reset');assert.equal(calls.at(-1),0);assert.equal(ui.el('alarm-status').hidden,true);
});
test('work and rest transitions vibrate once each without altering sound or LED',()=>{
 const {ui,calls}=withVibration({vibration:true,sound:false});ui.modes[2].click();ui.change('work-min',0);ui.change('work-sec',1);ui.change('rest-min',0);ui.change('rest-sec',1);ui.change('cycles',2);ui.click('main-action');ui.advance(1000);assert.deepEqual(Array.from(positive(calls)[0]),[200,100,200]);assert.equal(ui.el('led').classes.has('on'),true);ui.advance(1000);assert.equal(positive(calls).length,2);ui.advance(1000);assert.deepEqual(Array.from(positive(calls)[2]),[300,150,300,150,300]);assert.equal(ui.el('sound-toggle').attrs['aria-checked'],'false');
});
test('unsupported vibration API disables controls and explains availability',()=>{
 const ui=setup();assert.equal(ui.el('vibration-toggle').disabled,true);assert.equal(ui.el('vibration-test').disabled,true);assert.match(ui.el('vibration-description').textContent,/対応していません/);shortTimer(ui);assert.equal(ui.el('alarm-status').hidden,false);
});
test('false and throwing vibration results remain safe and do not claim success',()=>{
 for(const vibrate of [()=>false,()=>{throw Error('blocked');}]){const {ui}=withVibration({vibration:true},{vibrate});ui.click('vibration-test');assert.match(ui.el('toast').textContent,/開始できません/);assert.doesNotThrow(()=>shortTimer(ui));assert.doesNotThrow(()=>ui.click('reset'));}
});
test('browser activation restriction prevents vibration requests',()=>{
 const {ui,calls}=withVibration({vibration:true},{userActivation:{hasBeenActive:false}});shortTimer(ui);ui.click('vibration-test');assert.equal(positive(calls).length,0);
});
test('background, delayed ticks and page exit cancel without catch-up vibration',()=>{
 const {ui,calls}=withVibration({vibration:true});shortTimer(ui);ui.document.visibilityState='hidden';ui.docEvents.visibilitychange();assert.equal(calls.at(-1),0);const before=positive(calls).length;ui.advance(20000);ui.document.visibilityState='visible';ui.docEvents.visibilitychange();assert.equal(positive(calls).length,before);
 ui.click('reset');ui.click('main-action');ui.advance(10000);assert.equal(positive(calls).length,before);ui.winEvents.pagehide();assert.equal(calls.at(-1),0);
});
test('restored running timer waits for interaction before vibration',()=>{
 const state=engine.start(engine.createState({duration:1}),10000);const calls=[];const ui=setup(state,{vibration:true},'https://timer.example/',{vibrate:p=>{calls.push(p);return true;}});ui.advance(1000);assert.equal(positive(calls).length,0);
});
