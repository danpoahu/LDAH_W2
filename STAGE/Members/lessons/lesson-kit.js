/* Shared helpers for the member lesson decks. Load BEFORE the deck's own
   script and BEFORE deck-engine.js. Uses engine globals (q, move, click, speak,
   confetti, wait, pos, FAST, run, HEAD, WAVES, SPARK) only at run time. */
const tap=async(s,ms=850)=>{const e=typeof s==='string'?q(s):s;await move(e,ms);await click(e);return e};
function all(s){return[...document.querySelectorAll('.scene.on '+s)]}
const show=(e,ms=500)=>anim(e,[{opacity:0,transform:'translateY(16px)'},{opacity:1,transform:'none'}],ms,'ease-out').then(()=>{e.style.opacity=1});
const PTS=(items,top=140,left=790,w=440)=>`<div class="abs" style="left:${left}px;top:${top}px;width:${w}px"><ul class="pts">${items.map(t=>`<li>${t}</li>`).join('')}</ul></div>`;
const reveal=async(sel)=>{for(const e of all(sel)){e.classList.add('on');await wait(180)}};

/* quiz: 3 options, first answer counts, retry until right */
function ask(Q,i,sec){const w=q('.qwrap');
 w.innerHTML=`<div class="qcard"><div class="qn">Question ${i+1}</div><div class="qq">${Q.q}</div>${Q.o.map((o,j)=>`<button class="qo" data-j="${j}"><span class="L">${'ABC'[j]}</span><span>${o}</span></button>`).join('')}<div class="qfb"></div></div>`;
 const card=w.firstChild,fb=card.querySelector('.qfb'),btns=[...card.querySelectorAll('.qo')];
 const finish=()=>{btns.forEach(b=>b.disabled=true);btns[Q.a].classList.add('yes');const st=all('.stars i')[i];if(st)st.classList.add('on');fb.className='qfb good';fb.textContent='Yes! '+Q.y};
 if(FAST){finish();return Promise.resolve()}
 return new Promise(res=>{btns.forEach((b,j)=>b.onclick=async()=>{
  if(b.disabled)return;
  if(j===Q.a){finish();const p=pos(b);confetti(p.x+60,p.y+20,70);await speak('Yes! '+Q.y,run);await wait(700);res()}
  else{b.disabled=true;b.classList.add('no');fb.className='qfb bad';fb.textContent='Not quite. '+Q.n+' Try again.';speak('Not quite. '+Q.n+' Try again.',run)}})})}
const QUIZ=(qs)=>({cls:'quiz',html:()=>HEAD('Check yourself','Your turn!')+`<div class="stars">${qs.map(()=>'<i></i>').join('')}</div><div class="qwrap"><div class="qintro">${qs.length} quick questions.<small>Click the answer you think is right. If you miss, you can try again. These don't count toward your certificate; the quizzes on the lesson page do.</small></div></div><div class="qhelp">Take your time. The next question waits for you.</div>`,
 steps:[{say:`Let's check what stuck. ${qs.length} quick questions. Click the answer you think is right. If you miss, just try again.`},
  ...qs.map((Q,i)=>({say:`Question ${i+1}. ${Q.q}`,act:()=>ask(Q,i,'check')}))]});

/* cover, recap and closing scenes */
const COVER=(o)=>({cls:'cover',html:()=>`<span class="tier ${o.tier}">${({bronze:'Bronze · Foundations',silver:'Silver · Advocate',gold:'Gold · Leadership'})[o.tier]||''}</span><div class="brand">Leadership in Disabilities &amp; Achievement of Hawaiʻi · Certification Program</div><div class="hello">${o.lesson}</div>
 <h1>${o.title}</h1><p class="sub">${o.sub}</p>${o.art||''}
 <div class="spark" style="left:1190px;top:96px">${SPARK}</div><div class="spark" style="left:770px;top:560px;animation-delay:1s">${SPARK}</div>
 <div class="gate"><button class="btn" data-go="start">Start the lesson</button><label><input type="checkbox" id="voiceChk" checked> Read it out loud to me</label></div>${WAVES}`,
 steps:[{say:o.say}]});
const RECAP=(items,says)=>({html:()=>HEAD('Recap','What to remember')+`<div class="cl" style="top:126px">${items.map(t=>`<div class="ci"><div class="bx"><svg viewBox="0 0 24 24"><path d="M5 12 L10 17 L19 7"/></svg></div><div>${t}</div></div>`).join('')}</div>`,
 steps:[{say:"Let's recap.",act:async()=>{for(const c of all('.ci')){c.classList.add('on');await wait(160)}}},
  ...says.map((s,i)=>({say:s,act:async()=>{const c=all('.ci')[i];c.classList.add('done');spot(c,4)}}))]});
const CLOSE=(o)=>({cls:'cover',html:()=>`<span class="tier ${o.tier}">${({bronze:'Bronze · Foundations',silver:'Silver · Advocate',gold:'Gold · Leadership'})[o.tier]||''}</span><div class="brand">${o.lesson} · ${o.title}</div><div class="hello">Lesson finished</div><h1>Mahalo!</h1><p class="sub">${o.sub}</p>
 <div class="gate" style="top:460px"><button class="btn ghost" data-go="again">Watch again</button></div>${WAVES}`,
 steps:[{say:o.say,act:async()=>{spot(null);await wait(400);confetti(640,300,160)}}]});
