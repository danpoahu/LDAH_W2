// LDAH training deck engine - extracted verbatim from taking-attendance.html (2026-09-22).
// A deck defines, BEFORE loading this file: const DECK_ID='...'; const SC=[ ...scenes... ];

const IMG={};
const $=id=>document.getElementById(id);
const stage=$('stage');let scale=1;
function fit(){const v=$('view');scale=Math.min(v.clientWidth/1280,v.clientHeight/720);stage.style.transform='scale('+scale+')'}
addEventListener('resize',fit);fit();
let FAST=false;
const D=ms=>FAST?0:ms;
const wait=ms=>new Promise(r=>setTimeout(r,D(ms)));
function pos(el){const r=el.getBoundingClientRect(),s=stage.getBoundingClientRect();return{x:(r.left-s.left)/scale,y:(r.top-s.top)/scale,w:r.width/scale,h:r.height/scale}}
function q(s){return document.querySelector('.scene.on '+s)}
function imgRect(img,b){const p=pos(img),k=p.w/(+img.dataset.w);return{x:p.x+b[0]*k,y:p.y+b[1]*k,w:b[2]*k,h:b[3]*k}}
// cursor
const cur$=$('cursor');let cx=640,cy=760;
function place(x,y,ms){cx=x;cy=y;cur$.style.transition=`transform ${D(ms)}ms cubic-bezier(.45,.05,.25,1),opacity .3s`;cur$.style.transform=`translate(${x}px,${y}px)`}
async function move(t,ms=900,ox=.5,oy=.55){cur$.classList.add('on');const p=t.nodeType?pos(t):t;await wait(20);place(p.x+(p.w||0)*ox,p.y+(p.h||0)*oy,ms);await wait(ms)}
async function click(el){const r=document.createElement('div');r.className='ripple';r.style.left=cx+'px';r.style.top=cy+'px';stage.appendChild(r);setTimeout(()=>r.remove(),700);
 if(el){el.classList.add('press');await wait(150);el.classList.remove('press')}else await wait(150)}
function hideCursor(){cur$.classList.remove('on')}
// spotlight
function spot(t,pad=6){const s=$('spot');if(!t){s.classList.remove('on');return}const p=t.nodeType?pos(t):t;s.style.left=(p.x-pad)+'px';s.style.top=(p.y-pad)+'px';s.style.width=(p.w+pad*2)+'px';s.style.height=(p.h+pad*2)+'px';s.classList.add('on')}
async function type(el,text,ms=35){el.classList.remove('ph');el.textContent='';el.classList.add('typing');for(const c of text){el.textContent+=c;await wait(ms)}el.classList.remove('typing')}
function anim(el,kf,ms,ease='cubic-bezier(.3,1.3,.5,1)',delay=0){return el.animate(kf,{duration:D(ms)||1,delay:D(delay),easing:ease,fill:'forwards'}).finished}
function confetti(x,y,n=90){if(FAST)return;const cols=['#D63384','#0891B2','#F59E0B','#22C55E','#7C3AED','#F9A8D4','#7DD3FC'];
 for(let i=0;i<n;i++){const c=document.createElement('div');c.className='conf';c.style.background=cols[i%cols.length];c.style.left=x+'px';c.style.top=y+'px';stage.appendChild(c);
  const a=Math.random()*Math.PI*2,v=180+Math.random()*320,dx=Math.cos(a)*v,dy=Math.sin(a)*v-220;
  c.animate([{transform:'translate(0,0) rotate(0)',opacity:1},{transform:`translate(${dx*.7}px,${dy*.7}px) rotate(${Math.random()*540}deg)`,opacity:1,offset:.5},{transform:`translate(${dx}px,${dy+420}px) rotate(${Math.random()*900}deg)`,opacity:0}],{duration:1800+Math.random()*900,easing:'cubic-bezier(.2,.6,.4,1)',fill:'forwards'}).finished.then(()=>c.remove())}}
function el(html){const t=document.createElement('template');t.innerHTML=html.trim();return t.content.firstChild}
function add(html,parent){const e=el(html);(parent||document.querySelector('.scene.on')||stage).appendChild(e);return e}
const pop=e=>anim(e,[{opacity:0,transform:(e.dataset.rot||'')+' scale(.3)'},{opacity:1,transform:(e.dataset.rot||'')+' scale(1)'}],550);
const WAVES='<div class="waves"><svg class="w1" viewBox="0 0 2560 150" preserveAspectRatio="none"><path fill="#fff" d="M0 90 Q160 50 320 90 T640 90 T960 90 T1280 90 T1600 90 T1920 90 T2240 90 T2560 90 V150 H0Z"/></svg><svg class="w2" viewBox="0 0 2560 150" preserveAspectRatio="none"><path fill="#F9A8D4" d="M0 110 Q220 80 440 110 T880 110 T1320 110 T1760 110 T2200 110 T2640 110 V150 H0Z"/></svg></div>';
const SPARK='<svg viewBox="0 0 34 34"><path d="M17 1 L20 14 L33 17 L20 20 L17 33 L14 20 L1 17 L14 14 Z" fill="#FDE68A"/></svg>';
const HEAD=(k,h)=>`<header><div class="kicker">${k}</div><h2>${h}</h2></header>`;
async function countTo(el,to,suf='',ms=900){const s=+el.textContent.replace('%','')||0;const n=Math.max(1,Math.round(ms/40));for(let i=1;i<=n;i++){el.textContent=Math.round(s+(to-s)*i/n)+suf;await wait(40)}el.textContent=to+suf}


// ---------------- ENGINE ----------------
const CFG={id:(typeof DECK_ID!=='undefined'?DECK_ID:'ldah-training')};
let cur=0,idx=0,run=0,playing=false,started=false,voiceOn='speechSynthesis' in window,name='',voiceObj=null;
const inFrame=window.parent!==window;
function post(type,extra){if(!inFrame)return;try{window.parent.postMessage(Object.assign({source:'ldah-training',id:CFG.id,type},extra||{}),'*')}catch(e){}}
function pickVoice(){const vs=speechSynthesis.getVoices();if(!vs.length)return null;
 const pref=[v=>v.name==='Google US English',v=>/Ava/.test(v.name)&&/(Premium|Enhanced)/.test(v.name),v=>/Microsoft (Aria|Jenny|Ava).*Natural/.test(v.name),v=>/Samantha/.test(v.name)&&/(Premium|Enhanced)/.test(v.name),v=>/^Ava/.test(v.name),v=>/Karen/.test(v.name),v=>/Samantha/.test(v.name),v=>v.lang==='en-US',v=>/^en/.test(v.lang)];
 for(const f of pref){const m=vs.find(f);if(m)return m}return null}
if('speechSynthesis' in window){voiceObj=pickVoice();speechSynthesis.onvoiceschanged=()=>{voiceObj=pickVoice()}}
/* iPad/iPhone Safari only lets speech start from inside a tap. The first line is
   spoken 60ms after a timer, so it was silent there. On the first tap anywhere,
   speak a silent blank inside that tap to unlock the voice for the whole deck. */
let voiceUnlocked=false,voicePrimed=false;function unlockVoice(){if(voiceUnlocked||!('speechSynthesis' in window))return;voiceUnlocked=true;
 try{const u=new SpeechSynthesisUtterance(' ');u.volume=0;speechSynthesis.speak(u)}catch(e){}if(!voiceObj)voiceObj=pickVoice()}
['touchend','pointerup','click','keydown'].forEach(ev=>addEventListener(ev,unlockVoice,{capture:true,passive:true}));
const fillName=t=>t.replace(/\{name\}/g,name||'there');
function speak(text,token){return new Promise(res=>{const t0s=fillName(text),t=t0s.replace(/\[([^\]|]+)\|([^\]]+)\]/g,'$2');const c=$('cap');c.textContent=t0s.replace(/\[([^\]|]+)\|([^\]]+)\]/g,'$1');c.classList.add('has');
 const words=t.split(/\s+/).length;const t0=Date.now();const guard=setTimeout(done,words*520+4000);
 function done(){clearTimeout(guard);const min=words*280,e=Date.now()-t0;if(e<min)setTimeout(res,min-e);else res()}
 if(!voiceOn){clearTimeout(guard);setTimeout(res,words*330+900);return}
 const u=new SpeechSynthesisUtterance(t);if(voiceObj){u.voice=voiceObj;u.lang=voiceObj.lang}else u.lang='en-US';
 u.rate=(voiceObj&&/Google/.test(voiceObj.name))?0.98:1.0;u.onend=done;u.onerror=done;if(!voicePrimed){voicePrimed=true;try{speechSynthesis.speak(u)}catch(e){done()}return}
 speechSynthesis.cancel();setTimeout(()=>{if(token===run){if(speechSynthesis.paused)speechSynthesis.resume();speechSynthesis.speak(u)}else done()},60)})}
/* The very first line is spoken straight away, with no cancel() and no timer, so on
   iPad it is still inside the Play tap (begin -> playLoop -> speak run synchronously). */
const host=$('scenes');
SC.forEach((s,i)=>{const d=document.createElement('section');d.className='scene '+(s.cls||'');d.dataset.i=i;host.appendChild(d);s.el=d});
function render(i){const s=SC[i];s.el.innerHTML=s.html()+(s.cls?'':`<div class="pgno">${i+1} / ${SC.length}</div>`);
 s.el.querySelectorAll('.nm').forEach(e=>e.textContent=name);if(started&&i===0){const g=s.el.querySelector('.gate');if(g)g.style.visibility='hidden'}s.el.querySelectorAll('.nmc').forEach(e=>e.textContent=name?', '+name:'');wire(s.el)}
function li(i){const s=SC[cur];const ls=s.el.querySelectorAll('.pts li');ls.forEach((l,j)=>{l.classList.toggle('shown',j<=i);l.classList.toggle('now',j===i)})}
function dots(){const d=$('dots');d.innerHTML='';SC.forEach((_,i)=>{const b=document.createElement('button');b.setAttribute('aria-label','Scene '+(i+1));if(i===cur)b.className='on';else if(i<cur)b.className='seen';b.onclick=()=>{if(started)enter(i,true)};d.appendChild(b)})}
function nbar(f){$('nbar').firstChild.style.width=(f*100)+'%'}
function stop(){run++;if('speechSynthesis' in window)speechSynthesis.cancel()}
function clean(){spot(null);hideCursor();document.querySelectorAll('.dragghost,.ripple,.conf').forEach(e=>e.remove());$('cap').classList.remove('has')}
async function enter(i,autoplay){stop();clean();SC[cur].el.classList.remove('on');cur=i;render(i);const s=SC[i];s.el.classList.add('on');if(s.init)s.init();
 idx=0;nbar(0);dots();$('prev').disabled=!started||i===0;$('next').disabled=!started||i===SC.length-1;post('progress',{scene:i+1,total:SC.length});if(i===SC.length-1)post('complete',{name});
 if(autoplay){playing=true;setPlay()}if(playing){const t=++run;await wait(450);if(t===run)playLoop(t)}}
async function playLoop(t){const s=SC[cur];for(;idx<s.steps.length;idx++){if(t!==run)return;const st=s.steps[idx];nbar((idx+1)/s.steps.length);if(st.li!=null)li(st.li);
  const a=st.act?Promise.resolve().then(()=>st.act()).catch(e=>console.warn(e)):Promise.resolve();await Promise.all([a,speak(st.say,t)]);if(t!==run)return;await wait(350)}
 if(t!==run)return;$('cap').classList.remove('has');if(cur<SC.length-1){await wait(900);if(t===run&&playing)enter(cur+1)}else{playing=false;setPlay()}}
async function resumeAt(k){// rebuild scene, fast-forward steps before k
 const t=++run;const s=SC[cur];clean();render(cur);s.el.classList.add('on');if(s.init)s.init();FAST=true;
 for(let j=0;j<k;j++){const st=s.steps[j];if(st.li!=null)li(st.li);try{if(st.act)await st.act()}catch(e){}}FAST=false;clean();if(t!==run)return;idx=k;playLoop(t)}
function setPlay(){$('play').textContent=!started?'Start':playing?'Pause':'Play'}
$('play').onclick=()=>{if(!started)return begin();playing=!playing;setPlay();if(playing)resumeAt(idx);else{stop()}};
$('next').onclick=()=>enter(Math.min(cur+1,SC.length-1),true);$('prev').onclick=()=>enter(Math.max(cur-1,0),true);
$('voice').onclick=()=>{voiceOn=!voiceOn&&('speechSynthesis' in window);$('voice').textContent=voiceOn?'Voice on':'Voice off';$('voice').setAttribute('aria-pressed',voiceOn);document.body.classList.toggle('caps',!voiceOn||$('capbtn').getAttribute('aria-pressed')==='true');if(!voiceOn&&'speechSynthesis' in window)speechSynthesis.cancel()};
$('capbtn').onclick=()=>{const on=$('capbtn').getAttribute('aria-pressed')!=='true';$('capbtn').setAttribute('aria-pressed',on);document.body.classList.toggle('caps',on||!voiceOn)};
addEventListener('keydown',e=>{if(!started){if(e.key==='Enter')begin();return}if(e.key==='ArrowRight')$('next').click();else if(e.key==='ArrowLeft')$('prev').click();else if(e.key===' '){e.preventDefault();$('play').click()}});
function setName(n){name=(n||'').trim().split(/\s+/)[0]||'';document.querySelectorAll('.nm').forEach(e=>e.textContent=name);document.querySelectorAll('.nmc').forEach(e=>e.textContent=name?', '+name:'')}
function goFull(){if(inFrame||!(navigator.maxTouchPoints>1))return;const d=document.documentElement,f=d.requestFullscreen||d.webkitRequestFullscreen;
 if(f&&!(document.fullscreenElement||document.webkitFullscreenElement)){try{const r=f.call(d);if(r&&r.catch)r.catch(()=>{})}catch(e){}}}
function begin(){if(started)return;goFull();const vc=$('voiceChk');if(vc)voiceOn=vc.checked&&('speechSynthesis' in window);$('voice').textContent=voiceOn?'Voice on':'Voice off';document.body.classList.toggle('caps',!voiceOn);
 if(voiceOn&&!voiceObj)voiceObj=pickVoice();started=true;playing=true;setPlay();post('started',{name});const g=SC[0].el.querySelector('.gate');if(g)g.style.visibility='hidden';$('next').disabled=false;dots();idx=0;const t=++run;playLoop(t)}
function wire(root){root.querySelectorAll('[data-go=start]').forEach(b=>b.onclick=begin);
 root.querySelectorAll('[data-go=skip]').forEach(b=>{if(!inFrame)b.style.display='none';b.onclick=()=>{stop();post('skip',{name})}});
 root.querySelectorAll('[data-go=again]').forEach(b=>b.onclick=()=>{started=true;enter(0,true)});
 root.querySelectorAll('[data-go=close]').forEach(b=>{if(!inFrame)b.style.display='none';b.onclick=()=>{stop();post('close',{name})}})}
const qp=new URLSearchParams(location.search).get('name');if(qp)setName(qp);
addEventListener('message',e=>{const d=e.data||{};if(d.type==='ldah-training:init'){if(d.name)setName(d.name);if(d.voice===false){voiceOn=false;const vc=$('voiceChk');if(vc)vc.checked=false;$('voice').textContent='Voice off'}}});
render(0);SC[0].el.classList.add('on');setName(name);$('prev').disabled=true;$('next').disabled=true;dots();setPlay();post('ready',{total:SC.length});
