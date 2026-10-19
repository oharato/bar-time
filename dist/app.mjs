import {createState, normalizeConfig, start, pause, reset, snapshot, hydrate, MAX_DOWN, barCount} from './engine.mjs?v=3';
import {createAlert, alertView, cancelAlert} from './alarm.mjs?v=3';
import {setupFocusMode} from './focus.mjs?v=3';
import {renderDigitalDisplay} from './digits.mjs?v=3';

const $ = id => document.getElementById(id);
const DEPLOY_PATH = new URL('./', location.href).pathname;
const CACHE_PREFIX = `bar-time:${DEPLOY_PATH}:`;
const KEY = `${CACHE_PREFIX}state-v1`, PREF_KEY = `${CACHE_PREFIX}prefs-v1`;
let storageWarning = false, clearedLocal = false;
function readJSON(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } }
function writeJSON(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { if (!storageWarning) { storageWarning = true; notify('このブラウザでは保存できません。ページを閉じると設定が失われます。'); } } }
let state = hydrate(readJSON(KEY), Date.now());
const THEME_NAMES={lemon:'レモンイエロー',mint:'ミントグリーン',marine:'マリンブルー',ice:'アイスホワイト'};
const migrateTheme=value=>Object.hasOwn(THEME_NAMES,value)?value:({clay:'lemon',sage:'mint',ink:'marine',plum:'ice'}[value]||'lemon');
const rawPrefs = readJSON(PREF_KEY) || {};
let prefs = {sound:rawPrefs.sound === true, theme:migrateTheme(rawPrefs.theme), wake:rawPrefs.wake === true};
let previous = snapshot(state, Date.now());
let activeAlert=null, lastAlarmPulse=-1, completionShown=false, powered=true, editingTime='work', suppressIncrementUntil=0;
const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)');
let lastTick = Date.now(), audioContext, wakeLock, installEvent, toastTimer, lastSecond = -1, wakeRequestPending = false;
const segments = Array.from({length:10}, () => { const e = document.createElement('span'); e.className='bar-segment'; e.setAttribute('aria-hidden','true'); $('bars').append(e); return e; });
const inputs = ['duration-min','duration-sec','work-min','work-sec','rest-min','rest-sec','cycles'];
const configButtons = [...document.querySelectorAll('[data-preset]'),...document.querySelectorAll('[data-increment]'),$('device-mode'),$('cycle-minus'),$('cycle-plus')];
const modeNames = {down:'カウントダウン',up:'カウントアップ',repeat:'リピート'};
const pad = n => String(n).padStart(2, '0');
function drawDigits(seconds){$('digital-display').innerHTML=renderDigitalDisplay(seconds);}
function save() { if (!clearedLocal) writeJSON(KEY, state); }
function savePrefs() { clearedLocal=false; writeJSON(PREF_KEY, prefs); }
function notify(text) { $('toast').textContent=text; $('toast').hidden=false; clearTimeout(toastTimer); toastTimer=setTimeout(() => $('toast').hidden=true,5000); }
function durationWords(seconds) { const m=Math.floor(seconds/60),s=seconds%60; return (m ? m+'分' : '')+(s ? s+'秒' : '') || '0秒'; }
function setFieldTime(prefix,seconds) { $(prefix+'-min').value=Math.floor(seconds/60); $(prefix+'-sec').value=seconds%60; }
function syncConfigUI() {
  const c=state.config;
  $('mode-description').textContent=c.mode==='repeat'?'作業 → 休憩':'通常計測';
  $('edit-target').textContent=c.mode==='repeat'?(editingTime==='rest'?'休憩時間を設定':'作業時間を設定'):'時間設定';
  setFieldTime('duration',c.duration); setFieldTime('work',c.work); setFieldTime('rest',c.rest); $('cycles').value=c.cycles;
  for(const e of document.querySelectorAll('[data-mode]')) { const selected=e.dataset.mode===c.mode; e.setAttribute('aria-selected',String(selected)); e.tabIndex=selected ? 0 : -1; }
  $('timer-panel').setAttribute('aria-labelledby','tab-'+c.mode);
  for(const mode of ['down','up','repeat']) $(mode+'-settings').hidden=mode!==c.mode;
  for(const e of document.querySelectorAll('[data-preset]')) e.setAttribute('aria-pressed',String(Number(e.dataset.preset)===c.duration));
  const total=c.work*c.cycles+c.rest*(c.cycles-1);
  $('repeat-total').textContent='合計'+(total>=3600 ? Math.floor(total/3600)+'時間' : '')+durationWords(total%3600)+' · 最後の休憩なし';
}
function applyPreferences() {
  document.documentElement.dataset.theme=prefs.theme;
  $('color-label').textContent=THEME_NAMES[prefs.theme];
  for(const e of document.querySelectorAll('[data-color]')) e.setAttribute('aria-pressed',String(e.dataset.color===prefs.theme));
  $('sound-toggle').setAttribute('aria-checked',String(prefs.sound));
  $('sound-quick').setAttribute('aria-pressed',String(prefs.sound));
  $('sound-quick').setAttribute('aria-label',prefs.sound ? '終了音をオフにする' : '終了音をオンにする');
  $('sound-display').textContent=prefs.sound ? '♪' : '消音';
  $('sound-quick-label').textContent=prefs.sound?'音あり':'消音';
  $('sound-icon-lines').setAttribute('d', prefs.sound ? 'M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14' : 'm16 9 6 6m0-6-6 6');
  $('wake-toggle').setAttribute('aria-checked',String(prefs.wake));
  if (!('wakeLock' in navigator)) { $('wake-toggle').disabled=true; $('wake-description').textContent='このブラウザでは非対応です'; }
}
function render(view=snapshot(state,Date.now())) {
  const s=view.displaySeconds;
  if (s!==lastSecond) {
    drawDigits(s);
    $('digit-min').textContent=pad(Math.floor(s/60)); $('digit-sec').textContent=pad(s%60);
    $('digits').setAttribute('aria-label',(view.mode==='up' ? '経過' : '残り')+Math.floor(s/60)+'分'+s%60+'秒');
    document.title=(view.status==='idle' ? 'BAR TIME' : pad(Math.floor(s/60))+':'+pad(s%60)+' · BAR TIME'); lastSecond=s;
  }
  const filled=barCount(view);
  segments.forEach((e,i) => {e.setAttribute('data-on',String(i<filled));});
  $('bars').setAttribute('aria-valuenow',String(filled));
  $('bars').setAttribute('aria-valuetext',filled+' / 10目盛り');
  $('bars').setAttribute('aria-label',view.mode==='up' ? '最大時間に対する経過時間の割合' : '残り時間の割合');
  $('screen-label').textContent=view.mode==='up' ? '経過時間' : view.phase==='rest' ? '☕ 休憩' : view.mode==='repeat' ? '◷ 作業' : '残り時間';
  $('cycle-label').textContent=view.mode==='repeat' ? (view.phase==='rest'?'休憩':`残り ${pad(view.totalCycles-view.cycle+(view.completed?0:1))}回`) : view.mode==='up' ? 'UP' : 'DOWN';
  $('phase-text').textContent=view.completed ? 'COMPLETE' : view.status==='paused' ? 'PAUSED' : view.status==='idle' ? 'READY' : view.phase==='rest' ? 'BREAK' : 'FOCUS';
  $('device').classList.toggle('running',view.status==='running'); $('device').classList.toggle('done',view.completed);
  $('action-label').textContent=activeAlert?'アラーム停止':view.status==='running'?'ストップ':view.status==='paused'?'つづける':'スタート';
  $('main-action').disabled=!powered;
  $('device').classList.toggle('is-off',!powered);
  $('power').setAttribute('aria-pressed',String(powered));
  $('power').setAttribute('aria-label',powered?'画面をオフにする':'画面をオンにする');
  const locked=!powered||view.status==='running'||view.status==='paused';
  for(const id of inputs) $(id).disabled=locked;
  configButtons.forEach(e=>e.disabled=locked);
  // These two hardware keys remain usable for the simultaneous-reset gesture.
  $('minute-key').disabled=!powered;$('second-key').disabled=!powered;
  document.querySelectorAll('[data-mode]').forEach(e=>e.disabled=locked);
  $('locked-help').hidden=!locked;
  const phaseDuration=view.mode==='repeat'?(view.phase==='rest'?state.config.rest:state.config.work):state.config.duration;
  $('screen-footnote').textContent=!powered?'画面OFF · 設定は保存されています':view.mode==='up'?'1目盛り ≈ 10分':'1目盛り = '+durationWords(Math.round(phaseDuration*10)/100);
  $('completion').hidden=!(view.completed||completionShown);
  const completionTitle=view.mode==='repeat' ? `${view.totalCycles}回の作業が終わりました。` : view.mode==='up' ? '99分59秒になりました。' : '時間になりました。';
  if($('completion-title').textContent!==completionTitle)$('completion-title').textContent=completionTitle;
}
function unlockAudio() {
  try { const A=window.AudioContext||window.webkitAudioContext; if(!A)return; audioContext ||= new A(); if(audioContext.state==='suspended') audioContext.resume().catch(()=>{}); } catch {}
}
function beep(preview=false) {
  if(!prefs.sound||document.visibilityState!=='visible'||!audioContext||audioContext.state!=='running')return;
  try {const oscillator=audioContext.createOscillator(),gain=audioContext.createGain();oscillator.connect(gain);gain.connect(audioContext.destination);oscillator.type='sine';oscillator.frequency.value=preview?1150:1600;const t=audioContext.currentTime;gain.gain.setValueAtTime(0,t);gain.gain.linearRampToValueAtTime(.11,t+.006);gain.gain.setValueAtTime(.11,t+.075);gain.gain.exponentialRampToValueAtTime(.001,t+.11);oscillator.start(t);oscillator.stop(t+.12);}catch{}
}
function beginAlert(kind,eventTime,phase){activeAlert=createAlert(kind,eventTime);lastAlarmPulse=-1;if(kind==='complete')completionShown=true;$('alarm-message').textContent=kind==='complete'?'計測完了 · 約10秒お知らせ':phase==='rest'?'休憩を開始 · 約3秒お知らせ':'作業を開始 · 約3秒お知らせ';}
function restoreAfterCompletion(){state=reset(state,Date.now());previous=snapshot(state,Date.now());lastSecond=-1;save();syncConfigUI();manageWake();}
function stopAlert(restore=true){const complete=activeAlert?.kind==='complete';activeAlert=cancelAlert();lastAlarmPulse=-1;$('led').classList.toggle('on',false);$('device').classList.toggle('alarm-blink',false);$('alarm-status').hidden=true;if(complete&&restore)restoreAfterCompletion();}
function renderAlert(now,allowSound=true){
  if(!activeAlert)return;
  const view=alertView(activeAlert,now);
  if(!view.active){stopAlert();return;}
  $('alarm-status').hidden=false;$('led').classList.toggle('on',reducedMotion.matches||view.ledOn);$('device').classList.toggle('alarm-blink',!reducedMotion.matches&&!view.ledOn);
  if(view.pulseIndex!==lastAlarmPulse){if(allowSound&&view.ledOn)beep();lastAlarmPulse=view.pulseIndex;}
}
async function manageWake() {
  if(!('wakeLock' in navigator)) return;
  const should=prefs.wake && snapshot(state,Date.now()).status==='running' && document.visibilityState==='visible';
  if(!should && wakeLock){const lock=wakeLock;wakeLock=null;try{await lock.release();}catch{} }
  if(should && !wakeLock && !wakeRequestPending){
    wakeRequestPending=true;
    try { const lock=await navigator.wakeLock.request('screen');
      if(!prefs.wake||snapshot(state,Date.now()).status!=='running'||document.visibilityState!=='visible'){await lock.release();return;}
      wakeLock=lock; lock.addEventListener('release',()=>{if(wakeLock===lock)wakeLock=null;$('wake-description').textContent='画面保持が解除されました';}); $('wake-description').textContent='画面をつけたままにしています'; }
    catch { $('wake-description').textContent='端末設定により画面を保持できません'; }
    finally {wakeRequestPending=false;}
  }
  if(!should) $('wake-description').textContent='タイマー動作中のスリープを防ぐ';
}
function changeConfig(patch) {
  const current=snapshot(state,Date.now()); if(!powered||current.status==='running'||current.status==='paused')return;
  stopAlert(false);completionShown=false;
  clearedLocal=false; state=createState({...state.config,...patch}); previous=snapshot(state,Date.now()); lastSecond=-1;save();syncConfigUI();render();$('notice').hidden=true;
}
function readFields() {
  const number=id=>Math.max(0,Math.floor(Number($(id).value)||0));
  const raw={...state.config,duration:number('duration-min')*60+Math.min(59,number('duration-sec')),work:number('work-min')*60+Math.min(59,number('work-sec')),rest:number('rest-min')*60+Math.min(59,number('rest-sec')),cycles:number('cycles')};
  const normalized=normalizeConfig(raw);
  if(raw.duration!==normalized.duration||raw.work!==normalized.work||raw.rest!==normalized.rest||raw.cycles!==normalized.cycles)notify('時間は1秒〜99分50秒、回数は1〜99回です。休憩は0秒にできます。');
  changeConfig(normalized);
}
function mainAction() {
  if(!powered)return;
  if(activeAlert){stopAlert();render();return;}
  completionShown=false;
  clearedLocal=false; unlockAudio(); beep(true); const now=Date.now(), view=snapshot(state,now);
  state=view.status==='running' ? pause(state,now) : start(state,now);
  previous=snapshot(state,now);lastTick=now;save();render(previous);manageWake();$('notice').hidden=true;
}
function resetAction() {stopAlert(false);completionShown=false;clearedLocal=false;state=reset(state,Date.now());previous=snapshot(state,Date.now());lastSecond=-1;save();render(previous);manageWake();$('notice').hidden=true;}
function toggleSound(){prefs.sound=!prefs.sound;unlockAudio();savePrefs();applyPreferences();if(prefs.sound)beep(true);}
$('main-action').addEventListener('click',mainAction);
$('alarm-stop').addEventListener('click',()=>{stopAlert();render();});
$('power').addEventListener('click',()=>{stopAlert();powered=!powered;if(!powered)state=pause(state,Date.now());previous=snapshot(state,Date.now());save();render();manageWake();});
$('device-mode').addEventListener('click',()=>{const modes=['down','up','repeat'];changeConfig({mode:modes[(modes.indexOf(state.config.mode)+1)%3]});});
for(const e of document.querySelectorAll('[data-increment]'))e.addEventListener('click',()=>{if(Date.now()<suppressIncrementUntil)return;const field=state.config.mode==='repeat'?editingTime:'duration';changeConfig({[field]:Math.min(MAX_DOWN,state.config[field]+Number(e.dataset.increment)),...(state.config.mode==='up'?{mode:'down'}:{})});});
const pressedTimeKeys=new Set();
for(const id of ['minute-key','second-key']){const key=$(id);key.addEventListener('pointerdown',()=>{pressedTimeKeys.add(id);if(pressedTimeKeys.size===2){suppressIncrementUntil=Date.now()+700;resetAction();}});for(const event of ['pointerup','pointercancel','pointerleave'])key.addEventListener(event,()=>pressedTimeKeys.delete(id));}
for(const id of ['work-min','work-sec','rest-min','rest-sec'])$(id).addEventListener('focus',()=>{editingTime=id.startsWith('rest')?'rest':'work';$('edit-target').textContent=editingTime==='rest'?'休憩時間を設定':'作業時間を設定';});$('reset').addEventListener('click',resetAction);
$('sound-quick').addEventListener('click',toggleSound);$('sound-toggle').addEventListener('click',toggleSound);
$('wake-toggle').addEventListener('click',()=>{prefs.wake=!prefs.wake;savePrefs();applyPreferences();manageWake();});
for(const id of inputs)$(id).addEventListener('change',readFields);
for(const e of document.querySelectorAll('[data-preset]'))e.addEventListener('click',()=>changeConfig({duration:Number(e.dataset.preset)}));
for(const e of document.querySelectorAll('[data-mode]'))e.addEventListener('click',()=>changeConfig({mode:e.dataset.mode}));
$('cycle-minus').addEventListener('click',()=>changeConfig({cycles:Math.max(1,state.config.cycles-1)}));
$('cycle-plus').addEventListener('click',()=>changeConfig({cycles:Math.min(99,state.config.cycles+1)}));
for(const e of document.querySelectorAll('[data-color]'))e.addEventListener('click',()=>{prefs.theme=e.dataset.color;savePrefs();applyPreferences();});
document.querySelector('.mode-tabs').addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;const tabs=[...document.querySelectorAll('[data-mode]')];if(tabs.some(t=>t.disabled))return;e.preventDefault();let i=tabs.indexOf(document.activeElement);i=e.key==='Home'?0:e.key==='End'?2:(i+(e.key==='ArrowRight'?1:2))%3;changeConfig({mode:tabs[i].dataset.mode});tabs[i].focus();});
document.addEventListener('click',e=>{if(e.target?.closest?.('button')){unlockAudio();if(e.target.closest('#main-action,#sound-toggle,#sound-quick,#alarm-stop'))return;beep(true);}});
document.addEventListener('keydown',e=>{if(e.repeat||$('guide').open||/INPUT|TEXTAREA|SELECT|BUTTON|A/.test(document.activeElement.tagName)||e.ctrlKey||e.metaKey||e.altKey)return;if(e.code==='Space'){e.preventDefault();mainAction();}if(e.key.toLowerCase()==='r'){e.preventDefault();resetAction();}});
function tick() {
  const now=Date.now(), view=snapshot(state,now), longGap=now-lastTick>2500;
  if(longGap&&activeAlert)stopAlert();
  if(previous.status==='running' && (view.completed || view.phaseKey!==previous.phaseKey)) {
    // Anchor each alert to the real boundary, not a delayed render. Never replay missed phases.
    const eventTime=view.completed ? now-Math.max(0,(state.elapsedMs+Math.max(0,now-state.startedAt))-view.totalElapsedMs) : now-view.elapsedMs;
    if(document.visibilityState==='visible'&&!longGap&&powered)beginAlert(view.completed?'complete':'transition',eventTime,view.phase);
    if(longGap||document.visibilityState!=='visible'){$('notice').textContent=view.completed?'画面を閉じている間に終了しました。':'経過した時間を反映しました。現在は'+(view.phase==='rest'?'休憩':'作業')+` ${view.cycle}回目です。`;$('notice').hidden=false;completionShown=view.completed;}
    state=hydrate(state,now);
    if(view.completed&&(longGap||document.visibilityState!=='visible'))restoreAfterCompletion();
    save();manageWake();
  }
  previous=view;lastTick=now;renderAlert(now,!longGap);render(snapshot(state,now));
}
setInterval(tick,200);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){tick();manageWake();}else {stopAlert();state=hydrate(state,Date.now());save();manageWake();}});
window.addEventListener('pagehide',()=>{stopAlert();state=hydrate(state,Date.now());save();});
window.addEventListener('storage',e=>{if(e.key===KEY){stopAlert(false);completionShown=false;state=hydrate(readJSON(KEY),Date.now());previous=snapshot(state,Date.now());lastSecond=-1;syncConfigUI();render(previous);manageWake();}if(e.key===PREF_KEY){const p=readJSON(PREF_KEY);if(p){prefs={sound:p.sound===true,wake:p.wake===true,theme:migrateTheme(p.theme)};applyPreferences();manageWake();}}});

function openGuide(){ $('guide').showModal(); }
$('install-open').addEventListener('click',openGuide);$('help-open').addEventListener('click',openGuide);$('guide-close').addEventListener('click',()=>$('guide').close());
$('guide').addEventListener('click',e=>{if(e.target===$('guide')){const r=$('guide').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('guide').close();}});
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEvent=e;$('install-native').hidden=false;});
$('install-native').addEventListener('click',async()=>{if(!installEvent)return;const event=installEvent;installEvent=null;await event.prompt();const result=await event.userChoice;$('install-native').hidden=true;if(result.outcome==='accepted')notify('インストール操作を受け付けました。');});
function markInstalled(){const installed=window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;$('installed-message').hidden=!installed;if(installed){$('install-native').hidden=true;$('install-open').querySelector('span').textContent='アプリについて';}}
window.addEventListener('appinstalled',()=>{installEvent=null;$('install-native').hidden=true;notify('ホーム画面に追加しました。');});
markInstalled();
$('clear-local').addEventListener('click',async()=>{
  if(!window.confirm('この端末のタイマー・設定・オフラインキャッシュを削除します。実行しますか？'))return;
  try{stopAlert(false);completionShown=false;powered=true;clearedLocal=true;localStorage.removeItem(KEY);localStorage.removeItem(PREF_KEY);state=createState();prefs={sound:false,theme:'lemon',wake:false};previous=snapshot(state,Date.now());lastSecond=-1;
    if('caches'in window)for(const key of await caches.keys())if(key.startsWith(CACHE_PREFIX))await caches.delete(key);
    if('serviceWorker'in navigator)for(const reg of await navigator.serviceWorker.getRegistrations())if(reg.scope===new URL('./',location.href).href)await reg.unregister();
    syncConfigUI();applyPreferences();render();manageWake();$('offline-status').textContent='保存データを削除しました';notify('削除しました。次に開くとオフライン用データを再保存します。');
  }catch{notify('一部を削除できませんでした。ブラウザのサイト設定から削除できます。');}
});
async function offlineStatus(){if(!navigator.onLine){$('offline-status').textContent='オフラインで利用中';return;}try{const ready='caches'in window&&await caches.has(`${CACHE_PREFIX}shell-v3`);$('offline-status').textContent=ready?'オフライン対応 · この端末に保存':'端末内に保存 · アカウント同期なし';}catch{}}
window.addEventListener('online',offlineStatus);window.addEventListener('offline',offlineStatus);
if('serviceWorker'in navigator && window.isSecureContext){navigator.serviceWorker.register('./sw.js',{scope:'./'}).then(()=>navigator.serviceWorker.ready).then(offlineStatus).catch(()=>{$('offline-status').textContent='オフライン保存は利用できません';});}
if(state.status==='done' && readJSON(KEY)?.status==='running'){$('notice').textContent='前回のタイマーは、画面を閉じている間に終了しました。';$('notice').hidden=false;}
if(state.status==='running' && state.elapsedMs>0){$('notice').textContent='前回のタイマーを引き継いでいます。';$('notice').hidden=false;}
if(state.status==='done'){completionShown=true;state=reset(state,Date.now());previous=snapshot(state,Date.now());save();}
setupFocusMode({doc:document,notify});
syncConfigUI();applyPreferences();render(previous);manageWake();offlineStatus();
