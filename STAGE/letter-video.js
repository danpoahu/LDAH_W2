/* ─────────────────────────────────────────────────────────────
   letter-video.js — animated "Dear Friend of LDAH" player.

   Injects an illustrated SVG presenter into #letterVideo and narrates
   the membership letter from pre-rendered clips in ./letter-audio/.

   One clip per caption line, played in sequence. Captions and the
   mouth animation are driven by real <audio> events, so they cannot
   drift the way a guessed timeline does.

   Progressive enhancement: if this script doesn't run, the browser
   can't play AAC, or the clips 404, the container is left empty and
   the written letter below it carries the page. The letter is never
   removed.

   The narration is a macOS system voice standing in until the real
   staff recording is available; swapping it is a matter of replacing
   the files in ./letter-audio/ and re-checking the LINES captions.
   ───────────────────────────────────────────────────────────── */
(function () {
    'use strict';

    var HOST = document.getElementById('letterVideo');
    if (!HOST) return;

    // `d` is each clip's duration in seconds, measured at render time. Baked in
    // so the progress bar and total are known immediately, without fetching
    // metadata for twelve files on page load. If the audio is re-rendered with
    // a different voice, update these to match or the scrub bar will drift.
    var LINES = [
        { f: 'l00.m4a', d: 3.93, greet: true, cap: '' },
        { f: 'l01.m4a', d: 6.93, cap: 'For more than five decades, LDAH has been helping families navigate complex educational systems,' },
        { f: 'l02.m4a', d: 5.92, cap: 'access critical resources, and advocate for children with disabilities and developmental concerns.' },
        { f: 'l03.m4a', d: 7.37, cap: 'Every day, parents turn to LDAH for trusted guidance, training, case advocacy, and support' },
        { f: 'l04.m4a', d: 4.23, cap: 'during some of the most important decisions affecting their child’s future.' },
        { f: 'l05.m4a', d: 8.19, cap: 'As a nonprofit organization, we rely on the generosity of individuals, families, businesses, and community partners' },
        { f: 'l06.m4a', d: 4.54, cap: 'to ensure these services remain available throughout Hawai‘i and the Pacific.' },
        { f: 'l07.m4a', d: 7.18, cap: 'LDAH is revamping our membership program — offering parents, professionals, and community members' },
        { f: 'l08.m4a', d: 6.43, cap: 'an opportunity to stay connected with the Parent Center network of over 100 parent centers across the nation.' },
        { f: 'l09.m4a', d: 2.98, cap: 'We invite you to become a member of LDAH' },
        { f: 'l10.m4a', d: 4.95, cap: 'and invest in stronger families, informed advocates, and brighter futures.' },
        { f: 'l11.m4a', d: 2.94, cap: 'Mahalo — from all of us at LDAH. 🤙' }
    ];
    var DIR = 'letter-audio/';
    var GAP = 260; // ms between clips

    // Bail out quietly on browsers that can't play the format at all.
    var probe = document.createElement('audio');
    if (!probe.canPlayType || !probe.canPlayType('audio/mp4')) return;

    var SCENE =
    '<svg class="lv-scene" viewBox="0 0 640 360" role="img" aria-label="An illustrated presenter reading the LDAH membership letter">'
    + '<defs>'
    + '<linearGradient id="lvSky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#DFF6FE"/><stop offset="100%" stop-color="#F7FCFE"/></linearGradient>'
    + '<linearGradient id="lvBlouse" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#0E7490"/><stop offset="58%" stop-color="#0891B2"/><stop offset="100%" stop-color="#22D3EE"/></linearGradient>'
    + '<linearGradient id="lvHair" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#3B2417"/><stop offset="100%" stop-color="#241309"/></linearGradient>'
    + '<radialGradient id="lvCheek"><stop offset="0%" stop-color="#F0A48C" stop-opacity=".55"/><stop offset="100%" stop-color="#F0A48C" stop-opacity="0"/></radialGradient>'
    + '</defs>'
    + '<rect width="640" height="360" fill="url(#lvSky)"/>'
    + '<path d="M0 300 C 90 268, 168 292, 244 276 C 322 260, 392 288, 470 274 C 546 261, 596 284, 640 272 L640 360 L0 360 Z" fill="#BFEAF6" opacity=".55"/>'
    + '<path d="M0 318 C 104 296, 200 316, 296 304 C 400 291, 486 314, 566 302 C 600 297, 622 304, 640 300 L640 360 L0 360 Z" fill="#A5E0F2" opacity=".5"/>'
    + '<circle cx="527" cy="96" r="30" fill="#FBBF24" opacity=".26"/>'
    + '<g opacity=".33" fill="#3F7D33">'
    +   '<rect x="560" y="176" width="7" height="128" rx="3.5" fill="#7C5A3A"/>'
    +   '<path d="M563 178 C 536 160, 512 160, 496 172 C 520 168, 546 174, 563 186 Z"/>'
    +   '<path d="M563 178 C 590 160, 614 160, 630 172 C 606 168, 580 174, 563 186 Z"/>'
    +   '<path d="M563 176 C 552 152, 556 132, 572 120 C 566 140, 566 158, 568 178 Z"/>'
    +   '<path d="M563 180 C 588 174, 606 186, 612 202 C 596 190, 578 186, 563 188 Z"/>'
    + '</g>'
    + '<g transform="translate(112,16)"><g class="lv-breathe">'
    +   '<path d="M210 258 C 168 262, 136 288, 128 330 L128 360 L292 360 L292 330 C 284 288, 252 262, 210 258 Z" fill="url(#lvBlouse)"/>'
    +   '<path d="M210 258 L188 268 L210 300 L232 268 Z" fill="#FEFDFB" opacity=".95"/>'
    +   '<path d="M188 268 L210 300 L196 264 Z" fill="#E4F5FA"/>'
    +   '<path d="M232 268 L210 300 L224 264 Z" fill="#E4F5FA"/>'
    +   '<g transform="translate(252,304)" opacity=".9">'
    +     '<circle r="3.2" cx="0" cy="-4.4" fill="#FEF3C7"/><circle r="3.2" cx="4.2" cy="-1.4" fill="#FEF3C7"/>'
    +     '<circle r="3.2" cx="2.6" cy="3.6" fill="#FEF3C7"/><circle r="3.2" cx="-2.6" cy="3.6" fill="#FEF3C7"/>'
    +     '<circle r="3.2" cx="-4.2" cy="-1.4" fill="#FEF3C7"/><circle r="1.9" fill="#FBBF24"/>'
    +   '</g>'
    +   '<g class="lv-hand-l"><path d="M150 306 C 138 318, 132 334, 132 348" stroke="#0E7490" stroke-width="15" stroke-linecap="round" fill="none"/><ellipse cx="131" cy="350" rx="12" ry="10" fill="#E8B08D"/></g>'
    +   '<g class="lv-hand-r"><path d="M270 306 C 282 318, 288 334, 288 348" stroke="#0E7490" stroke-width="15" stroke-linecap="round" fill="none"/><ellipse cx="289" cy="350" rx="12" ry="10" fill="#E8B08D"/></g>'
    +   '<g class="lv-sway">'
    +     '<path d="M196 240 L196 264 C 202 272, 218 272, 224 264 L224 240 Z" fill="#DFA07E"/>'
    +     '<path d="M210 128 C 160 128, 148 170, 152 208 C 154 234, 148 254, 144 272 C 160 262, 168 246, 168 226 L252 226 C 252 246, 260 262, 276 272 C 272 254, 266 234, 268 208 C 272 170, 260 128, 210 128 Z" fill="url(#lvHair)"/>'
    +     '<ellipse cx="210" cy="196" rx="53" ry="63" fill="#E8B08D"/>'
    +     '<ellipse cx="157" cy="200" rx="8" ry="12" fill="#E0A17F"/><ellipse cx="263" cy="200" rx="8" ry="12" fill="#E0A17F"/>'
    +     '<circle cx="157" cy="212" r="3" fill="#FBBF24"/><circle cx="263" cy="212" r="3" fill="#FBBF24"/>'
    +     '<circle cx="181" cy="212" r="15" fill="url(#lvCheek)"/><circle cx="239" cy="212" r="15" fill="url(#lvCheek)"/>'
    +     '<g class="lv-brow">'
    +       '<path d="M180 176 C 188 170, 200 170, 207 175" stroke="#2E1A0F" stroke-width="4.2" stroke-linecap="round" fill="none"/>'
    +       '<path d="M213 175 C 220 170, 232 170, 240 176" stroke="#2E1A0F" stroke-width="4.2" stroke-linecap="round" fill="none"/>'
    +     '</g>'
    +     '<g><ellipse cx="192" cy="192" rx="10" ry="7.4" fill="#fff"/><circle cx="193" cy="192.6" r="4.6" fill="#4A2C17"/><circle cx="194.6" cy="190.8" r="1.5" fill="#fff"/>'
    +       '<ellipse class="lv-blink" cx="192" cy="192" rx="10.6" ry="7.8" fill="#E8B08D" style="transform-origin:192px 192px"/></g>'
    +     '<g><ellipse cx="228" cy="192" rx="10" ry="7.4" fill="#fff"/><circle cx="229" cy="192.6" r="4.6" fill="#4A2C17"/><circle cx="230.6" cy="190.8" r="1.5" fill="#fff"/>'
    +       '<ellipse class="lv-blink b2" cx="228" cy="192" rx="10.6" ry="7.8" fill="#E8B08D" style="transform-origin:228px 192px"/></g>'
    +     '<path d="M210 198 C 207 208, 205 214, 211 216" stroke="#CE8E6E" stroke-width="3" stroke-linecap="round" fill="none"/>'
    +     '<g>'
    +       '<path class="lv-viseme rest" d="M197 232 C 204 237, 216 237, 223 232" stroke="#9B3F45" stroke-width="3.4" stroke-linecap="round" fill="none"/>'
    +       '<ellipse class="lv-viseme lv-v1" cx="210" cy="233" rx="10" ry="7" fill="#8E353C"/>'
    +       '<ellipse class="lv-viseme lv-v2" cx="210" cy="233" rx="6" ry="4" fill="#8E353C"/>'
    +       '<ellipse class="lv-viseme lv-v3" cx="210" cy="233" rx="13" ry="4" fill="#8E353C"/>'
    +       '<ellipse class="lv-viseme lv-v4" cx="210" cy="234" rx="7.5" ry="8.5" fill="#8E353C"/>'
    +       '<path class="lv-viseme lv-v5" d="M198 231 C 205 236, 215 236, 222 231" stroke="#9B3F45" stroke-width="4" stroke-linecap="round" fill="none"/>'
    +     '</g>'
    +     '<path d="M210 128 C 168 128, 154 158, 158 188 C 166 168, 182 156, 210 156 C 238 156, 254 168, 262 188 C 266 158, 252 128, 210 128 Z" fill="url(#lvHair)"/>'
    +     '<g transform="translate(258,164)">'
    +       '<circle r="5.4" cx="0" cy="-7.4" fill="#FFFDF5"/><circle r="5.4" cx="7" cy="-2.3" fill="#FFFDF5"/>'
    +       '<circle r="5.4" cx="4.3" cy="6" fill="#FFFDF5"/><circle r="5.4" cx="-4.3" cy="6" fill="#FFFDF5"/>'
    +       '<circle r="5.4" cx="-7" cy="-2.3" fill="#FFFDF5"/><circle r="3.2" fill="#FBBF24"/>'
    +     '</g>'
    +   '</g>'
    + '</g></g></svg>';

    HOST.innerHTML =
      '<div class="lv">'
    + '  <div class="lv-stage" id="lvStage">'
    +      SCENE
    + '    <div class="lv-greet" id="lvGreet"><div class="lv-eyebrow">A message from LDAH</div>'
    + '      <h3>Dear Friend of Leadership in Disabilities &amp; Achievement of Hawai‘i</h3></div>'
    + '    <div class="lv-cap" aria-live="polite"><p id="lvCap"></p></div>'
    + '    <button class="lv-soundcue" id="lvSoundCue">'
    + '      <svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>'
    + '      Tap for sound</button>'
    + '    <button class="lv-poster" id="lvPoster" aria-label="Play the message from LDAH">'
    + '      <span><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span></button>'
    + '  </div>'
    + '  <div class="lv-bar">'
    + '    <button class="lv-btn" id="lvPlay" aria-label="Play">'
    + '      <svg id="lvPlayIcon" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'
    + '      <svg id="lvPauseIcon" viewBox="0 0 24 24" style="display:none"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg></button>'
    + '    <div class="lv-prog" id="lvProg" role="progressbar" aria-label="Progress"><i id="lvFill"></i></div>'
    + '    <span class="lv-time" id="lvTime">0:00 / 0:00</span>'
    + '    <button class="lv-mute" id="lvMute" aria-label="Mute" aria-pressed="false">'
    + '      <svg id="lvSndOn" viewBox="0 0 24 24"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4z"/></svg>'
    + '      <svg id="lvSndOff" viewBox="0 0 24 24" style="display:none"><path d="M3 9v6h4l5 5V4L7 9H3zm18 .4L19.6 8 17 10.6 14.4 8 13 9.4l2.6 2.6L13 14.6 14.4 16 17 13.4 19.6 16 21 14.6 18.4 12 21 9.4z"/></svg></button>'
    + '  </div>'
    + '</div>'
    + '<p class="lv-below">Prefer to read? The full letter is just below.</p>';

    function id(x) { return document.getElementById(x); }
    var stage = id('lvStage'), cap = id('lvCap'), greet = id('lvGreet'), playBtn = id('lvPlay'),
        playIcon = id('lvPlayIcon'), pauseIcon = id('lvPauseIcon'), prog = id('lvProg'),
        fill = id('lvFill'), timeEl = id('lvTime'), poster = id('lvPoster'), muteBtn = id('lvMute'),
        sndOn = id('lvSndOn'), sndOff = id('lvSndOff'), soundCue = id('lvSoundCue');

    // ONE audio element, whose src is swapped per line. Twelve separate Audio
    // objects each need their own unlock from a user gesture, so playback died
    // at the second clip once the gesture window lapsed. A single element stays
    // unlocked for the whole sequence — the same reason this is the standard
    // approach on iOS.
    var player = new Audio();
    player.preload = 'auto';

    var cur = 0, playing = false, muted = false, gapTimer = null, offsets = [], total = 0;

    function computeOffsets() {
        offsets = []; total = 0;
        for (var i = 0; i < LINES.length; i++) {
            offsets.push(total);
            total += LINES[i].d + GAP / 1000;
        }
    }
    function fmt(s) { s = Math.max(0, Math.floor(s || 0)); return Math.floor(s / 60) + ':' + ('0' + (s % 60)).slice(-2); }
    function paint() {
        var into = isFinite(player.currentTime) ? Math.min(player.currentTime, LINES[cur].d) : 0;
        var e = offsets[cur] + into;
        fill.style.width = (total ? e / total * 100 : 0).toFixed(2) + '%';
        timeEl.textContent = fmt(e) + ' / ' + fmt(total);
    }
    function setCaption(i) {
        var L = LINES[i];
        greet.classList.toggle('on', !!L.greet);
        cap.classList.remove('on');
        window.setTimeout(function () {
            cap.textContent = L.cap || '';
            if (L.cap) cap.classList.add('on');
        }, 120);
    }
    function speaking(on) { stage.classList.toggle('playing', on); }

    // Returns the play() promise. Pass ownErrorHandling when the caller wants
    // to react to a rejection itself instead of just pausing (see autoStart).
    function playFrom(i, ownErrorHandling) {
        cur = i; setCaption(i);
        player.src = DIR + LINES[i].f;
        player.muted = muted;
        var p = player.play();
        speaking(true);
        if (!ownErrorHandling && p && p.catch) p.catch(function () { pause(); });
        return p;
    }
    function advance() {
        speaking(false);
        if (cur + 1 >= LINES.length) { pause(); return; }
        gapTimer = window.setTimeout(function () { if (playing) playFrom(cur + 1); }, GAP);
    }
    function start() {
        playing = true;
        autoStarted = true;   // a manual start also satisfies the autoplay path
        poster.classList.add('gone');
        playIcon.style.display = 'none'; pauseIcon.style.display = '';
        playBtn.setAttribute('aria-label', 'Pause');
        if (player.src && player.currentTime > 0 && !player.ended) {
            player.muted = muted; player.play(); speaking(true); setCaption(cur);
        } else playFrom(cur);
    }
    function pause() {
        playing = false;
        if (gapTimer) window.clearTimeout(gapTimer);
        player.pause();
        speaking(false);
        playIcon.style.display = ''; pauseIcon.style.display = 'none';
        playBtn.setAttribute('aria-label', 'Play');
    }

    player.addEventListener('ended', function () { if (playing) advance(); });
    player.addEventListener('timeupdate', paint);

    playBtn.addEventListener('click', function () { playing ? pause() : start(); });
    poster.addEventListener('click', start);

    prog.addEventListener('click', function (e) {
        if (!total) return;
        var r = prog.getBoundingClientRect();
        var target = Math.min(total, Math.max(0, (e.clientX - r.left) / r.width * total));
        var i = 0;
        while (i < offsets.length - 1 && offsets[i + 1] <= target) i++;
        var was = playing;
        var into = Math.max(0, Math.min(target - offsets[i], LINES[i].d - 0.05));
        if (gapTimer) window.clearTimeout(gapTimer);
        player.pause();
        cur = i; setCaption(i);
        player.src = DIR + LINES[i].f;
        player.muted = muted;
        // Can't seek until the new src reports a duration.
        player.addEventListener('loadedmetadata', function seek() {
            player.removeEventListener('loadedmetadata', seek);
            player.currentTime = into;
            paint();
            if (was) { player.play(); speaking(true); }
        });
        player.load();
    });

    function setMuted(m) {
        muted = m;
        player.muted = m;
        sndOn.style.display = m ? 'none' : '';
        sndOff.style.display = m ? '' : 'none';
        muteBtn.setAttribute('aria-pressed', m ? 'true' : 'false');
        muteBtn.setAttribute('aria-label', m ? 'Unmute' : 'Mute');
    }
    function showSoundCue(on) { soundCue.classList.toggle('on', !!on); }

    muteBtn.addEventListener('click', function () { showSoundCue(false); setMuted(!muted); });

    // Turning sound on restarts from the top, so nothing is missed while muted.
    soundCue.addEventListener('click', function () {
        showSoundCue(false);
        setMuted(false);
        if (gapTimer) window.clearTimeout(gapTimer);
        player.pause();
        playing = true;
        playFrom(0);
    });

    // ── Autoplay ────────────────────────────────────────────────
    // Browsers refuse to start audio without a prior user gesture, so try
    // with sound first and fall back to a muted autoplay (which is always
    // permitted) plus a one-tap unmute. If even that is refused, hand back
    // to the poster button — the page still works, it just waits for a click.
    var autoStarted = false;
    function autoStart() {
        if (autoStarted) return;
        autoStarted = true;
        poster.classList.add('gone');
        playing = true;
        playIcon.style.display = 'none'; pauseIcon.style.display = '';
        playBtn.setAttribute('aria-label', 'Pause');
        setMuted(false);
        var p = playFrom(0, true);
        if (!p || !p.catch) return;

        p.catch(function () {
            setMuted(true);
            var p2 = player.play();
            if (p2 && p2.catch) {
                p2.catch(function () {
                    // Muted autoplay refused too — revert to click-to-play.
                    autoStarted = false; playing = false;
                    setMuted(false);
                    poster.classList.remove('gone');
                    playIcon.style.display = ''; pauseIcon.style.display = 'none';
                    playBtn.setAttribute('aria-label', 'Play');
                    speaking(false);
                });
            }
            showSoundCue(true);
        });
    }

    // Autoplay needs BOTH conditions before the browser will allow it:
    //   visible  — the player has scrolled into view (it sits below the fold,
    //              and starting off-screen would waste the opening)
    //   armed    — the visitor has interacted with the page at least once.
    //              Browsers reject play() outright before any gesture, and
    //              muting does NOT exempt <audio> the way it does <video>.
    // Until both hold, the poster button is the way in. Never autoplay for
    // visitors who asked for reduced motion.
    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var visible = false, armed = false;

    function maybeAutoStart() {
        if (autoStarted || reduceMotion || !visible || !armed) return;
        autoStart();
    }

    function arm(e) {
        armed = true;
        // A click on the player itself is handled by its own controls —
        // don't also fire the autostart path and double-trigger playback.
        if (e && e.target && (stage.contains(e.target) || playBtn.contains(e.target))) return;
        maybeAutoStart();
    }
    document.addEventListener('pointerdown', arm, true);
    document.addEventListener('keydown', arm, true);

    if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (entries) {
            var e = entries[0];
            if (!e) return;
            visible = e.isIntersecting && e.intersectionRatio >= 0.4;
            if (visible) maybeAutoStart();
            else if (!e.isIntersecting && playing) pause();
        }, { threshold: [0, 0.4] }).observe(stage);
    }

    computeOffsets(); setCaption(0); paint();
})();
