import type { Transcript } from './transcript';

export interface TranscriptViewOptions {
  onWordTap: (wordIndex: number) => void;
  onFollowChange: (following: boolean) => void;
}

// 段落の区切り: 話者が変わる / 文の間の無音がこれ以上 / 文がこれ以上たまった
const PARAGRAPH_PAUSE_SEC = 1.5;
const PARAGRAPH_MAX_SENTENCES = 6;
// 現在の単語がこの範囲（画面高さに対する割合）から外れたときだけスクロールする。
// 範囲を広めにとって、読んでいる途中で画面が動く回数を減らす
const FOLLOW_TOP = 0.08;
const FOLLOW_BOTTOM = 0.8;
// スクロールしたあと、現在の単語を置く位置
const FOLLOW_TARGET = 0.25;
// これより遠い移動は、なめらかに動かすと時間がかかりすぎるため瞬時に移動する（画面の高さの倍数）
const SMOOTH_LIMIT_SCREENS = 6;

/**
 * スクリプトの表示を担当する。Svelte を通さず DOM を直接操作する。
 *
 * - 単語は <span class="w" data-w="番号">、文は <span class="s" data-s="番号">、段落は <p class="p">
 * - 段落には CSS の content-visibility: auto を付け、画面外の段落は描画を省かせる
 * - ハイライトは「前の単語のクラスを外して、今の単語に付ける」だけ（画面全体は描き直さない）
 */
export class TranscriptView {
  private wordEls: HTMLElement[] = [];
  private sentenceEls: HTMLElement[] = [];
  private curWord = -2;
  private curSentence = -2;
  private following = true;
  private skipScrollOnce = false;
  private offset = 0;
  private cleanup: (() => void)[] = [];

  constructor(
    private readonly scroller: HTMLElement,
    private readonly content: HTMLElement,
    private readonly transcript: Transcript,
    private readonly opts: TranscriptViewOptions,
  ) {
    this.render();
    this.bindEvents();
  }

  /** スクリプトの時刻に足す補正（秒） */
  setTimingOffset(sec: number): void {
    this.offset = sec;
  }

  /** 毎フレーム呼ばれる。音声の時刻 → ハイライト更新 → 必要ならスクロール */
  update(audioTime: number): void {
    const t = audioTime - this.offset;
    const w = this.transcript.wordAt(t);
    if (w === this.curWord) return;
    const s = w >= 0 ? this.transcript.sentenceOfWord(w) : -1;
    // 位置の読み取りは、クラスを書き換える「前」に行う（書き換え後に読むと、その場で再レイアウトが走って重くなる）
    const needScroll = this.following && !this.skipScrollOnce && w >= 0 && this.isOutsideFollowBand(this.wordEls[w]);
    this.skipScrollOnce = false;

    if (this.curWord >= 0) this.wordEls[this.curWord]?.classList.remove('cur');
    if (w >= 0) this.wordEls[w]?.classList.add('cur');
    this.curWord = w;

    if (s !== this.curSentence) {
      if (this.curSentence >= 0) this.sentenceEls[this.curSentence]?.classList.remove('cur-s');
      if (s >= 0) this.sentenceEls[s]?.classList.add('cur-s');
      this.curSentence = s;
    }

    if (needScroll) this.follow();
  }

  /**
   * 自動追従を再開する。
   * - 'ifNeeded': 現在の単語が画面の見やすい範囲にあれば動かさない（シーク・前後の文など）
   * - 'none'    : 画面は動かさない（単語をタップしたとき。タップした場所はすでに見えているため）
   * - 'always'  : 必ず現在の単語の位置までスクロールする（「現在位置に戻る」）
   */
  resumeFollow(scroll: 'ifNeeded' | 'none' | 'always' = 'ifNeeded'): void {
    this.setFollowing(true);
    if (scroll === 'none') this.skipScrollOnce = true;
    if (scroll === 'always' || (scroll === 'ifNeeded' && this.isOutsideFollowBand(this.wordEls[this.curWord]))) {
      this.follow();
    }
  }

  get currentWord(): number {
    return this.curWord;
  }

  destroy(): void {
    this.cleanup.forEach((fn) => fn());
    this.cleanup = [];
    this.content.replaceChildren();
    this.wordEls = [];
    this.sentenceEls = [];
  }

  private render(): void {
    const { words, sentences } = this.transcript;
    const frag = document.createDocumentFragment();
    this.wordEls = new Array(words.length);
    this.sentenceEls = new Array(sentences.length);

    let p: HTMLElement | null = null;
    let inParagraph = 0;
    let prevSpeaker: string | null | undefined;
    let prevEnd = 0;

    sentences.forEach((sent, si) => {
      const speakerChanged = sent.speaker != null && sent.speaker !== prevSpeaker;
      if (!p || speakerChanged || sent.start - prevEnd >= PARAGRAPH_PAUSE_SEC || inParagraph >= PARAGRAPH_MAX_SENTENCES) {
        p = document.createElement('p');
        p.className = 'p';
        if (speakerChanged) {
          const label = document.createElement('span');
          label.className = 'spk';
          label.textContent = this.speakerName(sent.speaker!);
          p.append(label);
        }
        frag.append(p);
        inParagraph = 0;
      }
      prevSpeaker = sent.speaker;
      prevEnd = sent.end;
      inParagraph++;

      const s = document.createElement('span');
      s.className = 's';
      s.dataset.s = String(si);
      for (let i = sent.firstWord; i <= sent.lastWord && i < words.length; i++) {
        const w = document.createElement('span');
        w.className = 'w';
        w.dataset.w = String(i);
        w.textContent = words[i].text;
        this.wordEls[i] = w;
        s.append(w, ' ');
      }
      this.sentenceEls[si] = s;
      p.append(s);
    });
    this.content.replaceChildren(frag);
  }

  private speakerName(id: string): string {
    const found = this.transcript.doc.speakers?.find((x) => x.id === id);
    return found?.name || id;
  }

  private bindEvents(): void {
    const onClick = (e: MouseEvent) => {
      // 長押しで文字を選択している最中のタップは「選択の解除」として扱い、再生位置は動かさない
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed) return;
      const target = (e.target as HTMLElement).closest<HTMLElement>('[data-w]');
      if (!target) return;
      this.opts.onWordTap(Number(target.dataset.w));
    };
    // 指やトラックパッドでのスクロール（＝ユーザー操作）を検知したら自動追従を止める
    const onUserScroll = () => this.setFollowing(false);

    this.content.addEventListener('click', onClick);
    this.scroller.addEventListener('touchmove', onUserScroll, { passive: true });
    this.scroller.addEventListener('wheel', onUserScroll, { passive: true });
    this.cleanup.push(
      () => this.content.removeEventListener('click', onClick),
      () => this.scroller.removeEventListener('touchmove', onUserScroll),
      () => this.scroller.removeEventListener('wheel', onUserScroll),
    );
  }

  private setFollowing(on: boolean): void {
    if (this.following === on) return;
    this.following = on;
    this.opts.onFollowChange(on);
  }

  private isOutsideFollowBand(el: HTMLElement | undefined): boolean {
    if (!el) return false;
    const box = this.scroller.getBoundingClientRect();
    const y = el.getBoundingClientRect().top - box.top;
    return y < box.height * FOLLOW_TOP || y > box.height * FOLLOW_BOTTOM;
  }

  private follow(): void {
    const el = this.wordEls[this.curWord];
    if (!el) return;
    const box = this.scroller.getBoundingClientRect();
    const y = el.getBoundingClientRect().top - box.top;
    const top = this.scroller.scrollTop + y - box.height * FOLLOW_TARGET;
    const far = Math.abs(y) > box.height * SMOOTH_LIMIT_SCREENS;
    // 基本はなめらかにスクロールして、どこからどこへ移動したかを目で追えるようにする
    this.scroller.scrollTo({ top, behavior: far ? 'auto' : 'smooth' });
    if (far) {
      // 画面外の段落は高さが推定値なので、描画後にもう一度位置を合わせる
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const y2 = el.getBoundingClientRect().top - this.scroller.getBoundingClientRect().top;
        if (Math.abs(y2 - box.height * FOLLOW_TARGET) > 4) {
          this.scroller.scrollTo({ top: this.scroller.scrollTop + y2 - box.height * FOLLOW_TARGET, behavior: 'auto' });
        }
      }));
    }
  }
}
