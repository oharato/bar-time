/** Presentation-only controls. No timer state or persistence is read or changed. */
export function setupFocusMode({doc=document, notify=()=>{}}={}) {
  const root=doc.documentElement;
  const open=doc.getElementById('focus-open'), exit=doc.getElementById('focus-exit');
  const toolbar=doc.getElementById('focus-toolbar'), full=doc.getElementById('fullscreen-toggle');
  let focused=false, entering=false, exiting=false;
  const fullscreen=()=>Boolean(doc.fullscreenElement);
  const supported=typeof root.requestFullscreen==='function'&&typeof doc.exitFullscreen==='function'&&doc.fullscreenEnabled!==false;
  function syncFullscreen(){
    const active=fullscreen();
    full.setAttribute('aria-pressed',String(active));
    full.textContent=active?'全画面を解除':supported?'全画面':'全画面は非対応';
    full.disabled=!supported||entering||exiting;
    full.title=supported?'ブラウザの全画面表示を切り替えます':'このブラウザでは集中表示をご利用ください';
  }
  function setFocused(value){
    focused=value;root.dataset.focus=String(value);toolbar.hidden=!value;
    open.setAttribute('aria-pressed',String(value));
    if(value)exit.focus({preventScroll:true});else open.focus({preventScroll:true});
    syncFullscreen();
  }
  async function leaveFocus(){
    exiting=true;
    // Keep the visible exit until an in-flight browser request has settled.
    // Otherwise a late request could enter fullscreen with a hidden toolbar.
    if(entering){syncFullscreen();return;}
    if(fullscreen()){
      try {await doc.exitFullscreen();if(!fullscreen()){exiting=false;if(focused)setFocused(false);}}
      catch {exiting=false;notify('全画面を解除できませんでした。Escキーやブラウザの終了操作をお使いください。');}
      syncFullscreen();return;
    }
    exiting=false;setFocused(false);
  }
  async function toggleFullscreen(){
    if(entering||exiting)return;
    if(!supported){notify('このブラウザでは全画面にできません。集中表示はそのまま使えます。');return;}
    try {if(fullscreen())await doc.exitFullscreen();else {if(!focused)setFocused(true);entering=true;syncFullscreen();await root.requestFullscreen();}}
    catch {notify('ブラウザの全画面表示を切り替えられませんでした。集中表示はそのまま使えます。');}
    finally {entering=false;if(exiting)await leaveFocus();}
    syncFullscreen();
  }
  open.addEventListener('click',()=>setFocused(true));
  exit.addEventListener('click',leaveFocus);
  full.addEventListener('click',toggleFullscreen);
  doc.addEventListener('fullscreenchange',()=>{syncFullscreen();if(exiting&&!entering&&!fullscreen()){exiting=false;setFocused(false);}});
  doc.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||!focused)return;
    // Browser-owned fullscreen may consume Escape itself. Its change event
    // always updates the button; Escape in ordinary focus view restores menus.
    if(!fullscreen()){event.preventDefault();void leaveFocus();}
  });
  root.dataset.focus='false';toolbar.hidden=true;open.setAttribute('aria-pressed','false');syncFullscreen();
  return {enter:()=>setFocused(true),exit:leaveFocus,toggleFullscreen,isFocused:()=>focused};
}
