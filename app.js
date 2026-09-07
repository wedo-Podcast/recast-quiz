/* לכל אחד יש מה לשמוע ברימקס — quiz engine. All data lives in data/*.json; nothing here is content. */
(function () {
  'use strict';
  const AXES = ['type', 'stage', 'style', 'tone', 'world'];
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = { quiz: null, episodes: [], shows: {}, name: '', answers: [], world: null, qi: 0, pool: [], pick: 0, seed: 0 };

  // ---------- scoring (mirror of simulate_balance.py option_score / rank) ----------
  function optionScore(o, ep) {
    const ax = ep.axes; let s = 0;
    for (const axis of AXES) {
      const w = (o.w && o.w[axis]) || {};
      for (const k in w) s += w[k] * (ax[axis][k] || 0);
    }
    for (const p of o.pains || []) if (ax.pains.includes(p)) s += 3;
    if (o.guest && o.guest === ax.guest_kind) s += 4;
    if (o.hh !== undefined) s += Math.max(0, 2 - Math.abs(o.hh - ax.hh));
    return s;
  }
  function rank(chosen) {
    const bias = state.quiz.calibration.show_bias || {};
    return state.episodes
      .map((ep) => ({ ep, s: chosen.reduce((a, o) => a + optionScore(o, ep), 0) * (bias[ep.client_id] || 1), r: (ep.perf && ep.perf.retention) || 0 }))
      .sort((a, b) => b.s - a.s || b.r - a.r);
  }
  function personType(chosen) {
    const sum = {};
    for (const o of chosen) for (const k in (o.w && o.w.type) || {}) sum[k] = (sum[k] || 0) + o.w.type[k];
    const keys = Object.keys(state.quiz.types);
    return keys.reduce((best, k) => ((sum[k] || 0) > (sum[best] || 0) ? k : best), keys[0]);
  }
  function hash(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) >>> 0; return h; }

  // ---------- flow ----------
  function questionList() {
    const qs = state.quiz.questions;
    return qs.filter((q) => !q.world || q.world === state.world);
  }
  function chosenOptions() { return state.answers.map((a) => a.option); }
  function show(id) {
    for (const s of document.querySelectorAll('.screen')) s.hidden = s.id !== id;
    window.scrollTo(0, 0);
  }
  function renderProgress() {
    const n = state.quiz.meta.per_person, el = $('progress');
    el.hidden = false;
    el.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < state.qi ? 'done' : i === state.qi ? 'on' : ''}"></i>`).join('');
  }
  function lead(q) {
    if (!q.lead) return '';
    let ok = true;
    const text = q.lead.replace(/\{(q\d+)\}/g, (_, qid) => {
      const a = state.answers.find((x) => x.qid === qid);
      if (!a || !a.option.phrase) { ok = false; return ''; }
      return a.option.phrase;
    });
    return ok ? text : '';
  }
  function renderQuestion() {
    const list = questionList(), q = list[state.qi];
    if (!q) return renderResult();
    renderProgress();
    $('q-num').textContent = `שאלה ${state.qi + 1} מתוך ${state.quiz.meta.per_person}`;
    const l = lead(q); $('q-lead').hidden = !l; $('q-lead').textContent = l;
    $('q-text').textContent = q.text;
    $('options').innerHTML = q.options.map((o, i) => `<button class="opt" data-i="${i}"><span class="k">${'אבגד'[i]}.</span>${esc(o.label)}</button>`).join('');
    $('btn-back').hidden = state.qi === 0;
    show('s-q');
  }
  function answer(i) {
    const q = questionList()[state.qi], o = q.options[i];
    state.answers = state.answers.slice(0, state.qi).concat([{ qid: q.id, option: o }]);
    if (q.selects_world) state.world = o.world;
    const btn = $('options').children[i]; btn.classList.add('picked');
    setTimeout(() => { state.qi += 1; renderQuestion(); }, 160);
  }
  function back() {
    if (state.qi === 0) return;
    state.qi -= 1;
    const removed = state.answers[state.qi];
    state.answers = state.answers.slice(0, state.qi);
    if (removed && removed.option.world) state.world = null;
    renderQuestion();
  }

  // ---------- result ----------
  function because(chosen, ep) {
    const ranked = chosen.map((o) => ({ o, s: optionScore(o, ep) })).filter((x) => x.o.because && x.s > 0).sort((a, b) => b.s - a.s);
    const out = [];
    for (const x of ranked) {   // two reasons, but not two that say the same thing ("רוצה כלים…" twice)
      const head = x.o.because.split(' ').slice(0, 3).join(' ');
      if (!out.some((b) => b.split(' ').slice(0, 3).join(' ') === head)) out.push(x.o.because);
      if (out.length === 2) break;
    }
    return out;
  }
  function renderResult() {
    const chosen = chosenOptions();
    state.seed = hash(state.name.trim().toLowerCase() + '|' + Math.floor(Date.now() / 3600000));
    const pool = rank(chosen).slice(0, state.quiz.calibration.pool_size || 3);
    state.pool = pool; state.pick = state.seed % pool.length;
    state.type = personType(chosen);
    renderCard();
    $('progress').hidden = true;
    show('s-result');
  }
  function renderCard() {
    const { ep } = state.pool[state.pick], sh = state.shows[ep.client_id] || {}, t = state.quiz.types[state.type];
    const qi = (state.seed >>> 4) % ep.quotes.length, quote = ep.quotes[(qi + state.pick) % ep.quotes.length];
    const bec = because(chosenOptions(), ep);
    const link = (cls, href, label) => `<a class="${cls}${href ? '' : ' off'}" href="${esc(href || '#')}" target="_blank" rel="noopener">${label}</a>`;
    $('card').innerHTML = `
      <div class="band">
        <div class="hello">${esc(state.name)}, אתה</div>
        <div class="type">${esc(t.name)}</div>
        <div class="typeline">${esc(t.line)}</div>
      </div>
      <div class="body">
        <span class="chip" style="background:${esc(sh.color || '#003DA5')}">${esc(sh.name || ep.show)} · ${esc(sh.host || ep.host)}</span>
        <div class="ep-num">הפרק שלך · פרק ${ep.ep} עם ${esc(ep.guest)}</div>
        <div class="ep-title">${esc(ep.title)}</div>
        <div class="ep-guest">${esc(ep.guest_line)}</div>
        ${ep.why ? `<p class="why">${esc(ep.why)}</p>` : ''}
        ${bec.length ? `<p class="because">כי אמרת ש${esc(bec[0])}${bec[1] ? ', וש' + esc(bec[1]) : ''}.</p>` : ''}
        <blockquote class="quote"><p>„${esc(quote.text)}”</p><span class="who">${esc(quote.speaker)}, מתוך הפרק</span></blockquote>
      </div>
      <div class="listen">
        ${link('', ep.links.youtube, '<span class="ic yt">▶</span>יוטיוב')}
        ${link('', ep.links.spotify, '<span class="ic sp">♪</span>ספוטיפיי')}
        ${link('', ep.links.apple, '<span class="ic ap">♫</span>אפל')}
      </div>
      <div class="follow">
        <div class="lbl">עקוב אחרי ${esc(sh.name || ep.show)}:</div>
        <div class="row">${link('yt', sh.youtube, 'יוטיוב')}${link('sp', sh.spotify_show, 'ספוטיפיי')}${link('ap', sh.apple_show, 'אפל')}</div>
      </div>`;
  }
  function another() {
    state.pick = (state.pick + 1) % state.pool.length;
    renderCard(); window.scrollTo(0, 0);
    toast(state.pick === 0 ? 'חזרנו לפרק הראשון שבחרנו לך' : 'עוד פרק שמתאים לך');
  }
  function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._t); t._t = setTimeout(() => { t.hidden = true; }, 2200); }
  async function share() {
    const { ep } = state.pool[state.pick], t = state.quiz.types[state.type];
    const text = `${state.name}, ${t.name}. הפרק שלי: „${ep.title}” (${ep.show}, פרק ${ep.ep} עם ${ep.guest}).`;
    try {
      if (navigator.share) { await navigator.share({ title: state.quiz.meta.title, text, url: location.href }); return; }
      await navigator.clipboard.writeText(`${text}\n${location.href}`); toast('הועתק. צלם מסך ושתף לשולחן');
    } catch (e) { toast('צלם מסך ושתף לשולחן'); }
  }
  function restart() { state.answers = []; state.world = null; state.qi = 0; state.pool = []; show('s-name'); $('name').focus(); }

  // ---------- boot ----------
  async function boot() {
    try {
      const v = Date.now().toString(36).slice(0, 6);
      const [quiz, episodes, shows] = await Promise.all(['quiz', 'episodes', 'shows'].map((n) => fetch(`data/${n}.json?v=${v}`).then((r) => { if (!r.ok) throw new Error(n); return r.json(); })));
      state.quiz = quiz; state.episodes = episodes.filter((e) => e.quotes && e.quotes.length); state.shows = shows;
      $('intro-meta').textContent = `${state.episodes.length} פרקים · 4 תוכניות · ${quiz.meta.version}`;
      $('foot-meta').textContent = quiz.meta.version;
    } catch (e) {
      $('intro-meta').textContent = 'לא הצלחנו לטעון את הפרקים. נסה לרענן.';
      return;
    }
    $('btn-start').addEventListener('click', () => { show('s-name'); setTimeout(() => $('name').focus(), 50); });
    $('btn-name').addEventListener('click', () => { state.name = $('name').value.trim() || 'חבר'; state.qi = 0; renderQuestion(); });
    $('name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btn-name').click(); });
    $('options').addEventListener('click', (e) => { const b = e.target.closest('.opt'); if (b) answer(Number(b.dataset.i)); });
    $('btn-back').addEventListener('click', back);
    $('btn-share').addEventListener('click', share);
    $('btn-another').addEventListener('click', another);
    $('btn-restart').addEventListener('click', restart);
  }
  boot();
})();
