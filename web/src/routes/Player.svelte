<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import Icon from '../components/Icon.svelte';
  import { dialog } from '../lib/dialog.svelte';
  import RangeEditor from '../components/RangeEditor.svelte';
  import RangesSheet from '../components/RangesSheet.svelte';
  import MarkEditor from '../components/MarkEditor.svelte';
  import { liveQuery } from 'dexie';
  import { addMark, buildMark, isLive, loadPlaylistSettings, markColor, withAlpha } from '../lib/marks';
  import { MarkPlayer } from '../lib/playback/markPlayer.svelte';
  import { db, newId, type Episode, type Mark, type SavedRange } from '../lib/db/db';
  import { formatTime, formatTimePrecise } from '../lib/format';
  import { PlaybackEngine } from '../lib/playback/engine.svelte';
  import { LoopController, type ActiveRange, type RangeKind } from '../lib/playback/loop.svelte';
  import { connectMediaSession } from '../lib/playback/mediaSession';
  import { wakeLock } from '../lib/playback/wakeLock.svelte';
  import { router } from '../lib/router.svelte';
  import { Transcript } from '../lib/transcript/transcript';
  import { TranscriptView } from '../lib/transcript/view';

  let { id, startAt = null, playIds = null }: { id: string; startAt?: number | null; playIds?: string[] | null } = $props();

  // 単語の頭が欠けないよう、少しだけ手前から再生する
  const PREROLL = 0.05;
  const SAVE_INTERVAL_MS = 5000;
  const NEW_SECTION_SEC = 120;
  const AB_DEFAULTS_KEY = 'listenloop.abDefaults';
  const SHOW_JA_KEY = 'listenloop.showJa';

  type Panel = 'none' | 'speed' | 'settings' | 'ranges' | 'ab' | 'section' | 'mark';
  const AUTO_MARK_KEY = 'listenloop.autoMarkAB';

  const engine = new PlaybackEngine();
  const loop = new LoopController(engine, () => timingOffset, onRangeReleased);
  let episode = $state<Episode | null>(null);
  let transcript = $state.raw<Transcript | null>(null);
  let view: TranscriptView | null = null;
  let loadError = $state<string | null>(null);
  let following = $state(true);
  let panel = $state<Panel>('none');
  let timingOffset = $state(0);
  let scrubbing = $state(false);
  let scrubValue = $state(0);
  /** 長押しで選択している単語の範囲 */
  let selWords = $state<[number, number] | null>(null);
  /** メモを編集中のマーク */
  let editingMark = $state<Mark | null>(null);
  let autoMarkAB = $state(readFlag(AUTO_MARK_KEY));
  /** マーク箇所の連続再生 */
  const markPlayer = new MarkPlayer(engine, loop, () => transcript, () => timingOffset, () =>
    showToast('マーク箇所の連続再生が終わりました'),
  );
  // svelte-ignore state_referenced_locally
  const episodeMarks = liveQuery(() => db.marks.where('episodeId').equals(id).toArray());
  let toast = $state<string | null>(null);
  /** 調整パネルを開いているとき、テキストのタップで動かす点 */
  let editTarget = $state<'A' | 'B'>('A');
  /** 区間の始まりだけ決めて、終わりを待っている（単語番号） */
  let pendingSecStart = $state<number | null>(null);
  let showJa = $state(readShowJa());
  const hasJa = $derived(!!transcript?.doc.paragraphs?.some((p) => p.ja));
  let toastTimer: ReturnType<typeof setTimeout> | null = null;

  let scroller: HTMLElement;
  let content: HTMLElement;
  const disposers: (() => void)[] = [];

  onMount(() => {
    void load();
  });

  async function load() {
    const [ep, tr, audio] = await Promise.all([
      db.episodes.get(id),
      db.transcripts.get(id),
      db.audioBlobs.get(id),
    ]);
    if (!ep || !tr || !audio) {
      loadError = 'エピソードが見つかりません';
      return;
    }
    episode = ep;
    timingOffset = ep.timingOffset;
    const tx = new Transcript(tr.doc);
    transcript = tx;
    view = new TranscriptView(scroller, content, tx, {
      onWordTap: (i) => {
        // 調整パネルを開いているときは、タップした位置に A / B を置く（再生位置は動かさない）
        if (panel === 'ab' || panel === 'section') return placePoint(i);
        const t = tx.words[i].start - PREROLL;
        if (!loop.contains(t)) {
          showToast(`${loop.inner?.kind === 'ab' ? 'AB リピート' : '区間'}の外です。× で解除すると移動できます`);
          return;
        }
        // 先に「画面を動かさない」と伝えてからシークする
        view?.resumeFollow('none');
        seekTo(t, false);
        if (!engine.playing) void engine.play();
      },
      onFollowChange: (f) => (following = f),
      onTopicTap: (ti) => selectTopic(ti),
    });
    view.setTimingOffset(timingOffset);
    view.setShowJa(showJa);
    // 先に音声を読み込んで、最初のハイライトが「続きの位置」から始まるようにする
    engine.load(audio.blob, startAt ?? ep.lastPosition, ep.rate);
    disposers.push(engine.onFrame((t) => view?.update(t)));
    disposers.push(
      connectMediaSession(engine, {
        title: ep.title,
        artworkUrl: new URL('icon-512.png', document.baseURI).href,
        onPrevSentence: prevSentence,
        onNextSentence: nextSentence,
        onSkip: skip,
        onSeekTo: (t) => seekTo(t - timingOffset),
      }),
    );

    // 再生位置の保存: 再生中は 5 秒ごと、一時停止・アプリ切り替え・画面を離れるときにも保存
    const timer = setInterval(() => {
      if (engine.playing) void savePosition();
    }, SAVE_INTERVAL_MS);
    const onHide = () => {
      if (document.visibilityState === 'hidden') void savePosition();
    };
    const onPause = () => void savePosition();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPause);
    engine.audio.addEventListener('pause', onPause);

    // 長押しでテキストを選択したら、下に操作バーを出す
    let selTimer: ReturnType<typeof setTimeout> | null = null;
    const onSelection = () => {
      if (selTimer) clearTimeout(selTimer);
      selTimer = setTimeout(readSelection, 120);
    };
    document.addEventListener('selectionchange', onSelection);

    disposers.push(
      () => clearInterval(timer),
      () => document.removeEventListener('visibilitychange', onHide),
      () => window.removeEventListener('pagehide', onPause),
      () => engine.audio.removeEventListener('pause', onPause),
      () => document.removeEventListener('selectionchange', onSelection),
    );

    if (wakeLock.enabled) void wakeLock.acquire();
    if (playIds?.length) void preparePlaylist(playIds);
  }

  async function savePosition() {
    if (!episode || !engine.ready) return;
    await db.episodes.update(id, {
      lastPosition: engine.currentTime,
      lastPlayedAt: Date.now(),
      rate: engine.rate,
    });
  }

  // マークした単語に下線（習得済みは除く）
  $effect(() => {
    const list = $episodeMarks;
    const tx = transcript;
    if (!list || !tx || !view) return;
    view.setMarks(
      list
        .filter((m) => isLive(m) && !m.mastered)
        .map((m) => ({ range: tx.wordRangeForTimes(m.start, m.end), color: withAlpha(markColor(m), 0.42) }))
        .filter((x): x is { range: [number, number]; color: string } => !!x.range),
    );
  });

  onDestroy(() => {
    markPlayer.destroy();
    void savePosition();
    disposers.forEach((d) => d());
    loop.destroy();
    view?.destroy();
    engine.unload();
    void wakeLock.release();
  });

  // ---- 範囲の表示（AB は青、区間の外は薄く） ----
  $effect(() => {
    const tx = transcript;
    const ab = loop.ab;
    const sec = loop.section;
    if (!tx || !view) return;
    view.setRanges(ab ? tx.wordRangeForTimes(ab.start, ab.end) : null, sec ? tx.wordRangeForTimes(sec.start, sec.end) : null);
  });

  // AB の回数・間隔は、次に作るときの初期値として覚えておく
  $effect(() => {
    const ab = loop.ab;
    if (!ab) return;
    try {
      localStorage.setItem(AB_DEFAULTS_KEY, JSON.stringify({ repeatCount: ab.repeatCount, gapSec: ab.gapSec }));
    } catch {
      /* 無視 */
    }
  });

  function abDefaults(): { repeatCount: number; gapSec: number } {
    try {
      const v = JSON.parse(localStorage.getItem(AB_DEFAULTS_KEY) ?? '');
      if (typeof v?.repeatCount === 'number' && typeof v?.gapSec === 'number') return v;
    } catch {
      /* 無視 */
    }
    return { repeatCount: 0, gapSec: 0 };
  }

  // ---- 位置の移動 ----
  /** 現在の再生位置（スクリプトの時刻） */
  function tNow(): number {
    return engine.currentTime - timingOffset;
  }

  /** スクリプトの時刻 t へ移動する（AB・区間を設定中は、その中に収める） */
  function seekTo(t: number, follow = true) {
    loop.interrupt();
    const target = loop.resolveSeek(t);
    engine.seek(target + timingOffset);
    if (follow) view?.resumeFollow();
  }

  function skip(delta: number) {
    seekTo(tNow() + delta);
  }

  function prevSentence() {
    if (!transcript) return;
    const t = tNow() + PREROLL + 0.01;
    const si = transcript.sentenceAt(t);
    if (si < 0) return seekTo(0);
    // 文の途中（1 秒以上経過）なら文頭へ、文頭付近なら前の文へ
    const target = t - transcript.sentences[si].start > 1 || si === 0 ? si : si - 1;
    seekTo(transcript.sentences[target].start - PREROLL);
  }

  function nextSentence() {
    if (!transcript) return;
    // 文頭より少し手前（PREROLL）から再生しているので、その分を足して「今の文」を判定する
    const si = transcript.sentenceAt(tNow() + PREROLL + 0.01);
    const target = Math.min(si + 1, transcript.sentences.length - 1);
    seekTo(transcript.sentences[target].start - PREROLL);
  }

  function changeRate(delta: number) {
    engine.setRate(engine.rate + delta);
    void savePosition();
  }

  function changeOffset(deltaMs: number) {
    timingOffset = Math.round((timingOffset + deltaMs / 1000) * 1000) / 1000;
    view?.setTimingOffset(timingOffset);
    view?.update(engine.currentTime);
    void db.episodes.update(id, { timingOffset });
  }

  // ---- テキスト選択 → 操作バー ----
  function readSelection() {
    const sel = window.getSelection();
    if (!view || !sel || sel.isCollapsed || sel.rangeCount === 0 || !content?.contains(sel.anchorNode)) {
      selWords = null;
      view?.setSelection(null);
      return;
    }
    const r = sel.getRangeAt(0);
    const a = view.wordAtBoundary(r.startContainer, r.startOffset, true);
    const b = view.wordAtBoundary(r.endContainer, r.endOffset, false);
    selWords = a != null && b != null && b >= a ? [a, b] : null;
    view.setSelection(selWords);
  }

  function clearSelection() {
    window.getSelection()?.removeAllRanges();
    view?.setSelection(null);
    selWords = null;
  }

  /** 選んだ単語を、それを含む文全体に広げる */
  function expandToSentences([a, b]: [number, number]): [number, number] {
    const tx = transcript!;
    return [tx.sentences[tx.sentenceOfWord(a)].firstWord, tx.sentences[tx.sentenceOfWord(b)].lastWord];
  }

  function startAB([a, b]: [number, number]) {
    const tx = transcript!;
    markPlayer.stop();
    loop.setAB({ start: tx.aPointForWord(a), end: tx.bPointForWord(b), ...abDefaults() });
    // 設定で「AB 開始時に自動でマーク」がオンなら、そのままマーク一覧にも入れる
    if (autoMarkAB) void markWords([a, b], false);
    engine.seek(loop.ab!.start + timingOffset);
    view?.resumeFollow();
    void engine.play();
  }

  function startSection([a, b]: [number, number]) {
    const tx = transcript!;
    loop.setSection({ start: tx.aPointForWord(a), end: tx.bPointForWord(b) });
    // 今の位置が区間の外なら、区間の最初へ移動する（再生・停止の状態はそのまま）
    if (!loop.contains(tNow())) engine.seek(loop.section!.start + timingOffset);
    view?.resumeFollow();
    showToast(`区間を作りました（${formatTime(loop.section!.start)}–${formatTime(loop.section!.end)}）`);
  }

  function onSelectionAction(action: 'sentenceAB' | 'rangeAB' | 'secStart' | 'secEnd') {
    if (!selWords || !transcript) return;
    const words = action === 'rangeAB' ? selWords : expandToSentences(selWords);
    clearSelection();
    if (action === 'secStart') {
      pendingSecStart = words[0];
      view?.setPendingSectionStart(words[0]);
    } else if (action === 'secEnd' && pendingSecStart != null) {
      const a = Math.min(pendingSecStart, words[0]);
      const b = Math.max(pendingSecStart, words[1]);
      cancelPendingSection();
      startSection([expandToSentences([a, a])[0], b]);
    } else {
      startAB(words);
    }
  }

  function cancelPendingSection() {
    pendingSecStart = null;
    view?.setPendingSectionStart(null);
  }

  /** 調整パネルを開いているときに、タップした単語へ A または B を置く */
  function placePoint(i: number) {
    const tx = transcript!;
    const kind: RangeKind = panel === 'ab' ? 'ab' : 'section';
    const r = kind === 'ab' ? loop.ab : loop.section;
    if (!r) return;
    // 区間は文単位でそろえる
    const s = tx.sentences[tx.sentenceOfWord(i)];
    const first = kind === 'ab' ? i : s.firstWord;
    const last = kind === 'ab' ? i : s.lastWord;
    if (editTarget === 'A') {
      const start = tx.aPointForWord(first);
      loop.update(kind, start < r.end - 0.3 ? { start } : { start, end: tx.bPointForWord(last) });
      editTarget = 'B';
    } else {
      const end = tx.bPointForWord(last);
      loop.update(kind, end > r.start + 0.3 ? { end } : { end, start: tx.aPointForWord(first) });
    }
  }

  function sentenceABHere() {
    if (!transcript) return;
    const si = Math.max(0, transcript.sentenceAt(tNow() + PREROLL + 0.01));
    const s = transcript.sentences[si];
    panel = 'none';
    startAB([s.firstWord, s.lastWord]);
  }

  function newSection() {
    if (!transcript) return;
    const tx = transcript;
    const s0 = tx.sentences[Math.max(0, tx.sentenceAt(tNow() + PREROLL + 0.01))];
    const s1 = tx.sentences[Math.max(0, tx.sentenceAt(tx.words[s0.firstWord].start + NEW_SECTION_SEC))];
    loop.setSection({ start: tx.aPointForWord(s0.firstWord), end: tx.bPointForWord(s1.lastWord) });
    panel = 'section';
  }

  // ---- 話題・日本語訳 ----
  function readShowJa(): boolean {
    try {
      return localStorage.getItem(SHOW_JA_KEY) === '1';
    } catch {
      return false;
    }
  }

  function toggleJa() {
    showJa = !showJa;
    view?.setShowJa(showJa);
    try {
      localStorage.setItem(SHOW_JA_KEY, showJa ? '1' : '0');
    } catch {
      /* 無視 */
    }
  }

  /** 話題の範囲を区間にする */
  function selectTopic(ti: number) {
    const tx = transcript;
    const t = tx?.doc.topics?.[ti];
    if (!tx || !t) return;
    loop.setSection({ start: tx.aPointForWord(t.firstWord), end: tx.bPointForWord(t.lastWord), name: t.titleEn ?? t.titleJa ?? null });
    if (!loop.contains(tNow())) engine.seek(loop.section!.start + timingOffset);
    panel = 'none';
    view?.resumeFollow();
    showToast(`区間：${t.titleJa || t.titleEn}`);
  }

  // ---- 範囲の保存・呼び出し ----
  function defaultName(r: ActiveRange): string {
    if (r.kind === 'section') return `区間 ${formatTime(r.start)}–${formatTime(r.end)}`;
    const tx = transcript!;
    const a = tx.wordForAPoint(r.start);
    const b = Math.min(tx.wordForBPoint(r.end), a + 5);
    return tx.words.slice(a, b + 1).map((w) => w.text).join(' ') + (b < tx.wordForBPoint(r.end) ? ' …' : '');
  }

  async function saveRange(kind: RangeKind) {
    const r = kind === 'ab' ? loop.ab : loop.section;
    if (!r) return;
    const fields = { start: r.start, end: r.end, repeatCount: r.repeatCount, gapSec: r.gapSec };
    if (r.savedId) {
      await db.ranges.update(r.savedId, fields);
      showToast('上書き保存しました');
      return;
    }
    const name = await dialog.prompt(kind === 'ab' ? 'AB リピートの名前' : '区間の名前', defaultName(r), { okLabel: '保存' });
    if (name == null) return;
    const saved: SavedRange = {
      id: newId(),
      episodeId: id,
      name: name.trim() || defaultName(r),
      kind,
      ...fields,
      parentId: kind === 'ab' ? (loop.section?.savedId ?? null) : null,
      createdAt: Date.now(),
    };
    await db.ranges.add(saved);
    loop.update(kind, { savedId: saved.id, name: saved.name });
    showToast('保存しました（「範囲」から呼び出せます）');
  }

  function openSaved(r: SavedRange, parent: SavedRange | null) {
    const fields = (x: SavedRange) => ({ start: x.start, end: x.end, repeatCount: x.repeatCount, gapSec: x.gapSec, savedId: x.id, name: x.name });
    if (r.kind === 'section') {
      loop.setSection(fields(r));
    } else {
      if (parent) loop.setSection(fields(parent));
      else if (loop.section && !(r.start >= loop.section.start && r.end <= loop.section.end)) loop.clear();
      loop.setAB(fields(r));
    }
    panel = 'none';
    engine.seek(r.start + timingOffset);
    view?.resumeFollow();
    void engine.play();
  }

  // ---- マーク ----
  function readFlag(key: string): boolean {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  }

  function setAutoMark(on: boolean) {
    autoMarkAB = on;
    try {
      localStorage.setItem(AUTO_MARK_KEY, on ? '1' : '0');
    } catch {
      /* 無視 */
    }
  }

  /** 単語 a〜b をマークする。openEditor ならメモ欄を開く */
  async function markWords(words: [number, number], openEditor = true) {
    if (!transcript) return;
    const { mark, created } = await addMark(buildMark(transcript, id, words));
    if (openEditor) {
      editingMark = mark;
      panel = 'mark';
    }
    showToast(created ? 'マークしました' : 'すでにマークしてあります');
  }

  /** 今の AB リピートの範囲をマークする（リピートは続けたまま） */
  function markAB() {
    const ab = loop.ab;
    if (!ab || !transcript) return;
    void markWords([transcript.wordForAPoint(ab.start), transcript.wordForBPoint(ab.end)]);
  }


  // ---- マーク箇所の連続再生 ----
  async function preparePlaylist(ids: string[]) {
    const found = (await db.marks.bulkGet(ids)).filter((m): m is Mark => !!m && m.episodeId === id);
    if (!found.length) return;
    found.sort((a, b) => a.start - b.start);
    markPlayer.start(found, loadPlaylistSettings(), 0, false);
    view?.resumeFollow();
    showToast(`${found.length} 箇所を連続再生します（▶ で開始）`);
  }

  function onRangeReleased(r: ActiveRange) {
    if (markPlayer.active && r.kind === 'ab') return markPlayer.onRepeatDone();
    showToast(`${r.kind === 'ab' ? 'AB リピート' : '区間'}を ${r.repeatCount} 回再生しました`);
    if (panel === r.kind) panel = 'none';
  }

  function showToast(text: string) {
    toast = text;
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (toast = null), 2500);
  }

  function togglePanel(p: Panel) {
    panel = panel === p ? 'none' : p;
    if (panel === 'ab' || panel === 'section') {
      editTarget = 'A';
      // 調整する範囲がどこにあるか分かるよう、範囲の始まりを画面に出す
      const r = panel === 'ab' ? loop.ab : loop.section;
      if (r && transcript) view?.reveal(transcript.wordForAPoint(r.start));
    }
  }

  function onKey(e: KeyboardEvent) {
    // Mac のブラウザで確認するときのショートカット
    if ((e.target as HTMLElement).closest('input, textarea')) return;
    if (e.key === ' ') {
      e.preventDefault();
      engine.toggle();
    } else if (e.key === 'ArrowLeft') skip(-5);
    else if (e.key === 'ArrowRight') skip(5);
    else if (e.key === 'ArrowUp') prevSentence();
    else if (e.key === 'ArrowDown') nextSentence();
    else if (e.key === 'Escape') {
      if (loop.ab) loop.release('ab');
      else if (loop.section) loop.release('section');
    }
  }

  const shownTime = $derived(scrubbing ? scrubValue : engine.time);
  const activeIds = $derived(loop.stack.map((r) => r.savedId));
</script>

<svelte:window onkeydown={onKey} />

<div class="player">
  <header>
    <button class="icon-btn" aria-label="一覧に戻る" onclick={() => router.go('#/')}><Icon name="chevron-left" /></button>
    <h1>{episode?.title ?? ''}</h1>
    <button class="icon-btn" aria-label="マーク一覧" onclick={() => router.go(`#/marks/${id}`)}><Icon name="bookmark" /></button>
    {#if hasJa}
      <button class="icon-btn ja-btn" class:active={showJa} aria-label="日本語訳の表示" onclick={toggleJa}>訳</button>
    {/if}
    <button
      class="icon-btn"
      class:active={panel === 'settings'}
      aria-label="設定"
      onclick={() => (panel = panel === 'settings' ? 'none' : 'settings')}><Icon name="more" /></button>
  </header>

  <div class="scroller" bind:this={scroller}>
    {#if loadError}
      <p class="error">{loadError}</p>
    {/if}
    <div class="transcript" bind:this={content}></div>
  </div>

  <footer>
    <div class="floating">
      {#if toast}
        <div class="toast" role="status">{toast}</div>
      {/if}
      {#if selWords}
        <!-- 長押しで選択したときの操作バー（コピーは iOS 標準のメニューから） -->
        <div class="selbar">
          {#if selWords}
            <div class="selrow">
              <button onclick={() => onSelectionAction('sentenceAB')}><Icon name="repeat" />この文でAB</button>
              <button onclick={() => onSelectionAction('rangeAB')}><Icon name="repeat" />選択範囲でAB</button>
              {#if pendingSecStart == null}
                <button onclick={() => onSelectionAction('secStart')}>区間の始まり</button>
              {:else}
                <button class="accent" onclick={() => onSelectionAction('secEnd')}>区間の終わり</button>
              {/if}
            </div>
          {/if}
          {#if selWords}
            <div class="selrow">
              <button onclick={() => { const w = selWords!; clearSelection(); void markWords(w); }}><Icon name="marker" />マーク</button>
            </div>
          {/if}
        </div>
      {:else if pendingSecStart != null}
        <div class="pending">
          <span>区間の始まりを置きました。終わりにしたい文を長押し →［区間の終わり］</span>
          <button class="icon-btn" aria-label="区間の作成をやめる" onclick={cancelPendingSection}><Icon name="close" /></button>
        </div>
      {:else if !following}
        <button class="pill primary" onclick={() => view?.resumeFollow('always')}>
          <Icon name="locate" />現在位置に戻る
        </button>
      {/if}
    </div>
    {#if engine.error}<p class="error">{engine.error}</p>{/if}

    {#if panel === 'speed'}
      <div class="panel">
        <div class="speed-row">
          <button class="icon-btn" aria-label="遅く" onclick={() => changeRate(-0.05)} disabled={engine.rate <= 0.5}><Icon name="minus" /></button>
          <input
            type="range"
            min="0.5"
            max="1.5"
            step="0.05"
            value={engine.rate}
            oninput={(e) => engine.setRate(Number(e.currentTarget.value))}
            onchange={() => void savePosition()}
            aria-label="再生速度" />
          <button class="icon-btn" aria-label="速く" onclick={() => changeRate(0.05)} disabled={engine.rate >= 1.5}><Icon name="plus" /></button>
        </div>
        <div class="presets">
          {#each [0.7, 0.8, 0.9, 1, 1.2] as r}
            <button class="pill" class:on={Math.abs(engine.rate - r) < 0.001} onclick={() => { engine.setRate(r); void savePosition(); }}>{r.toFixed(2)}</button>
          {/each}
        </div>
      </div>
    {:else if panel === 'ranges'}
      <div class="panel">
        <RangesSheet
          episodeId={id}
          {activeIds}
          topics={transcript?.doc.topics ?? []}
          onTopic={selectTopic}
          onOpen={openSaved}
          onNewSection={newSection}
          onSentenceAB={sentenceABHere} />
      </div>
    {:else if (panel === 'ab' || panel === 'section') && transcript}
      <div class="panel">
        <RangeEditor
          {loop}
          kind={panel}
          {transcript}
          bind:target={editTarget}
          onPreview={(t) => {
            engine.seek(t + timingOffset);
            if (!engine.playing) void engine.play();
          }}
          onSave={() => saveRange(panel as RangeKind)} />
      </div>
    {:else if panel === 'mark' && editingMark}
      <div class="panel">
        {#key editingMark.id}
          <MarkEditor mark={editingMark} {transcript} onClose={() => { panel = 'none'; editingMark = null; }} onMessage={showToast} />
        {/key}
      </div>
    {:else if panel === 'settings'}
      <div class="panel">
        <div class="setting">
          <div>
            <div class="label">AB リピート開始時に自動でマーク</div>
            <div class="hint">繰り返した箇所が、そのままマーク一覧にたまります</div>
          </div>
          <button class="pill" class:on={autoMarkAB} onclick={() => setAutoMark(!autoMarkAB)}>{autoMarkAB ? 'オン' : 'オフ'}</button>
        </div>
        <div class="setting">
          <div>
            <div class="label">ハイライトのずれ補正</div>
            <div class="hint">ハイライトが音より早いときは＋、遅いときは−</div>
          </div>
          <div class="offset">
            <button class="icon-btn" aria-label="10ミリ秒減らす" onclick={() => changeOffset(-10)}><Icon name="minus" /></button>
            <span>{timingOffset >= 0 ? '+' : ''}{Math.round(timingOffset * 1000)}ms</span>
            <button class="icon-btn" aria-label="10ミリ秒増やす" onclick={() => changeOffset(10)}><Icon name="plus" /></button>
          </div>
        </div>
      </div>
    {/if}

    {#if markPlayer.active}
      <div class="rangebar playlist">
        <button class="icon-btn rb-x" aria-label="前の箇所" onclick={() => markPlayer.step(-1)} disabled={markPlayer.index === 0}><Icon name="prevSentence" /></button>
        <div class="rb-main static">
          <span class="rb-tag">マーク</span>
          <span class="rb-time">{markPlayer.index + 1}/{markPlayer.queue.length}</span>
          <span class="rb-count">{markPlayer.waiting || loop.waiting ? '間隔…' : `${(loop.ab?.played ?? 0) + 1}/${markPlayer.settings.repeat}回`}</span>
          <span class="rb-name">{markPlayer.current?.text}</span>
        </div>
        <button class="icon-btn rb-x" aria-label="次の箇所" onclick={() => markPlayer.step(1)} disabled={markPlayer.index >= markPlayer.queue.length - 1}><Icon name="nextSentence" /></button>
        <button class="icon-btn rb-x" aria-label="連続再生をやめる" onclick={() => markPlayer.stop()}><Icon name="close" /></button>
      </div>
    {/if}

    {#each markPlayer.active ? [] : loop.stack as r (r.kind)}
      <div class="rangebar" class:ab={r.kind === 'ab'}>
        <button class="rb-main" class:open={panel === r.kind} onclick={() => togglePanel(r.kind)}>
          <span class="rb-tag">{r.kind === 'ab' ? 'AB' : '区間'}</span>
          <span class="rb-time">{formatTimePrecise(r.start)}–{formatTimePrecise(r.end)}</span>
          <span class="rb-count">
            {#if loop.waiting && loop.inner === r}間隔…{:else}{r.played + 1}/{r.repeatCount === 0 ? '∞' : r.repeatCount}{/if}
          </span>
          {#if r.name}<span class="rb-name">{r.name}</span>{/if}
          <span class="rb-edit">{panel === r.kind ? '閉じる' : '調整'}</span>
        </button>
        {#if r.kind === 'ab'}
          <button class="icon-btn rb-x" aria-label="この範囲をマーク" onclick={markAB}><Icon name="marker" /></button>
        {/if}
        <button class="icon-btn rb-x" aria-label={r.kind === 'ab' ? 'ABリピートを解除' : '区間を解除'} onclick={() => loop.release(r.kind)}><Icon name="close" /></button>
      </div>
    {/each}

    <div class="seek">
      <span class="time">{formatTime(shownTime)}</span>
      <input
        type="range"
        min="0"
        max={engine.duration || episode?.duration || 0}
        step="0.1"
        value={shownTime}
        oninput={(e) => {
          scrubbing = true;
          scrubValue = Number(e.currentTarget.value);
        }}
        onchange={(e) => {
          scrubbing = false;
          seekTo(Number(e.currentTarget.value) - timingOffset);
        }}
        aria-label="再生位置" />
      <span class="time">-{formatTime((engine.duration || 0) - shownTime)}</span>
    </div>

    <div class="controls">
      <button class="icon-btn" aria-label="前の文" onclick={prevSentence}><Icon name="prevSentence" /></button>
      <button class="icon-btn" aria-label="5秒戻す" onclick={() => skip(-5)}><Icon name="back5" /></button>
      <button class="play" aria-label={engine.playing ? '一時停止' : '再生'} onclick={() => engine.toggle()} disabled={!engine.ready}>
        <Icon name={engine.playing ? 'pause' : 'play'} />
      </button>
      <button class="icon-btn" aria-label="5秒送る" onclick={() => skip(5)}><Icon name="fwd5" /></button>
      <button class="icon-btn" aria-label="次の文" onclick={nextSentence}><Icon name="nextSentence" /></button>
    </div>

    <div class="sub">
      <button class="pill" class:on={panel === 'speed'} onclick={() => togglePanel('speed')}>
        {engine.rate.toFixed(2)}×
      </button>
      <button class="pill" class:on={panel === 'ranges'} onclick={() => togglePanel('ranges')}>
        <Icon name="repeat" />範囲
      </button>
      <button class="pill" class:on={wakeLock.enabled} disabled={!wakeLock.supported} onclick={() => wakeLock.setEnabled(!wakeLock.enabled)}>
        <Icon name="sun" />画面を消さない
      </button>
    </div>
  </footer>
</div>

<style>
  .player {
    height: 100%;
    display: flex;
    flex-direction: column;
    position: relative;
  }
  header {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: calc(var(--safe-top) + 4px) 8px 4px;
    border-bottom: 1px solid var(--line);
  }
  header h1 {
    flex: 1;
    min-width: 0;
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .icon-btn.active {
    color: var(--accent);
  }
  .ja-btn {
    font-size: 15px;
    font-weight: 700;
  }
  .scroller {
    flex: 1;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    max-width: 760px;
    width: 100%;
    margin: 0 auto;
  }
  .error {
    color: var(--danger);
    font-size: 14px;
    padding: 0 16px;
  }
  .floating {
    position: absolute;
    left: 0;
    right: 0;
    bottom: calc(100% + 12px);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    pointer-events: none;
    z-index: 2;
    padding: 0 12px;
  }
  .floating > :global(*) {
    pointer-events: auto;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.6);
  }
  .toast {
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 18px;
    padding: 8px 14px;
    font-size: 13px;
  }
  .selbar {
    display: grid;
    background: var(--surface-2);
    border: 1px solid var(--line);
    border-radius: 14px;
    overflow: hidden;
  }
  .selrow {
    display: flex;
  }
  .selrow + .selrow {
    border-top: 1px solid var(--line);
  }
  .selrow button {
    flex: 1;
    justify-content: center;
  }
  .selbar button {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 10px 12px;
    font-size: 13px;
    white-space: nowrap;
  }
  .selrow button + button {
    border-left: 1px solid var(--line);
  }
  .selbar button:active {
    background: var(--line);
  }
  .selbar .accent {
    color: var(--accent);
    font-weight: 600;
  }
  .pending {
    display: flex;
    align-items: center;
    gap: 4px;
    background: var(--surface-2);
    border: 1px solid rgba(245, 185, 66, 0.5);
    border-radius: 14px;
    padding: 4px 4px 4px 12px;
    font-size: 12px;
    line-height: 1.4;
  }
  .pending .icon-btn {
    width: 32px;
    height: 32px;
    flex: none;
  }
  .selbar :global(svg) {
    width: 16px;
    height: 16px;
  }
  .rangebar {
    display: flex;
    align-items: center;
    margin-bottom: 6px;
    border-radius: 10px;
    background: var(--accent-soft);
  }
  .rangebar.ab {
    background: rgba(110, 170, 255, 0.14);
  }
  .rb-main {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 10px;
    font-size: 13px;
    text-align: left;
  }
  .rb-tag {
    font-weight: 700;
    color: var(--accent);
  }
  .rangebar.ab .rb-tag {
    color: #8ab8ff;
  }
  .rb-time,
  .rb-count {
    font-variant-numeric: tabular-nums;
  }
  .rb-count {
    color: var(--text-dim);
  }
  .rb-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-dim);
  }
  .rb-edit {
    margin-left: auto;
    color: var(--accent);
    font-size: 12px;
  }
  .rangebar.ab .rb-edit {
    color: #8ab8ff;
  }
  .rangebar.playlist {
    background: rgba(255, 158, 203, 0.14);
  }
  .rangebar.playlist .rb-tag {
    color: #ff9ecb;
  }
  .rb-main.static {
    padding: 6px 4px;
  }
  .rb-x {
    width: 36px;
    height: 36px;
  }
  .rb-x :global(svg) {
    width: 18px;
    height: 18px;
  }
  footer {
    position: relative;
    border-top: 1px solid var(--line);
    background: var(--bg);
    padding: 8px 16px calc(var(--safe-bottom) + 10px);
  }
  .panel {
    background: var(--surface);
    border-radius: var(--radius);
    padding: 8px 12px;
    margin-bottom: 8px;
  }
  .speed-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .presets {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    justify-content: center;
    padding: 4px 0 6px;
  }
  .setting {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 0;
  }
  .label {
    font-size: 15px;
  }
  .hint {
    font-size: 12px;
    color: var(--text-dim);
    margin-top: 2px;
  }
  .offset {
    display: flex;
    align-items: center;
    font-variant-numeric: tabular-nums;
    font-size: 14px;
  }
  .offset span {
    min-width: 60px;
    text-align: center;
  }
  .seek {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .time {
    font-size: 12px;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
    min-width: 48px;
  }
  .time:last-child {
    text-align: right;
  }
  .controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
    max-width: 360px;
    margin: 4px auto 6px;
  }
  .play {
    width: 64px;
    height: 64px;
    border-radius: 50%;
    background: var(--text);
    color: #000;
    display: grid;
    place-items: center;
  }
  .play :global(svg) {
    width: 28px;
    height: 28px;
  }
  .sub {
    display: flex;
    justify-content: center;
    gap: 8px;
  }
</style>
