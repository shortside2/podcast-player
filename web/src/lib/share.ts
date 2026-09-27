/**
 * 「Claude に送る」: テキストをクリップボードにコピーし、同時に共有シートを開く。
 * 必ずボタンのタップの中から呼ぶこと（iOS ではユーザー操作がないと両方とも動かない）。
 * 戻り値: 画面に出すメッセージ
 */
export async function sendToClaude(text: string): Promise<string> {
  const plain = text.trim();
  if (!plain) return '送る内容がありません';
  // クリップボードへのコピーを先に始める（共有シートを閉じても貼り付けられるように）
  const copied = navigator.clipboard?.writeText(plain).then(
    () => true,
    () => false,
  ) ?? Promise.resolve(false);
  if (navigator.share) {
    try {
      await navigator.share({ text: plain });
      return (await copied) ? 'コピーしました' : '';
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return (await copied) ? 'コピーしました（共有はキャンセル）' : '';
    }
  }
  return (await copied) ? 'コピーしました（Claude のアプリに貼り付けてください）' : 'コピーできませんでした';
}

/** ファイルを保存する。iPhone では共有シートの「"ファイル"に保存」、Mac ではダウンロードになる */
export async function saveFile(name: string, text: string, type = 'application/json'): Promise<void> {
  await saveBlob(name, new Blob([text], { type }));
}

/**
 * Blob をファイルとして保存・送信する。
 * iPhone では共有シートが開き、「"ファイル"に保存」・AirDrop・メッセージなどを選べる。
 */
export async function saveBlob(name: string, blob: Blob): Promise<void> {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
