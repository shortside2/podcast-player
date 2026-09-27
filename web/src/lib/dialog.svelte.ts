/**
 * アプリ内の確認・入力ダイアログ。
 * iOS 標準の confirm / prompt は、何度か出すと「今後ダイアログを表示しない」が選べてしまい、
 * それを押すと以降は確認が常に「いいえ」扱いになって操作できなくなるため使わない。
 */
interface DialogRequest {
  title: string;
  message?: string;
  /** 入力欄を出すときの初期値（出さないときは undefined） */
  input?: string;
  okLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: (value: string | null) => void;
}

class DialogStore {
  current = $state<DialogRequest | null>(null);

  private open(req: Omit<DialogRequest, 'resolve'>): Promise<string | null> {
    this.current?.resolve(null);
    return new Promise((resolve) => {
      this.current = { ...req, resolve };
    });
  }

  async confirm(title: string, opts: { message?: string; okLabel?: string; danger?: boolean } = {}): Promise<boolean> {
    const v = await this.open({ title, message: opts.message, okLabel: opts.okLabel ?? 'OK', cancelLabel: 'キャンセル', danger: !!opts.danger });
    return v !== null;
  }

  prompt(title: string, value = '', opts: { message?: string; okLabel?: string } = {}): Promise<string | null> {
    return this.open({ title, message: opts.message, input: value, okLabel: opts.okLabel ?? 'OK', cancelLabel: 'キャンセル', danger: false });
  }

  async alert(title: string, message?: string): Promise<void> {
    await this.open({ title, message, okLabel: 'OK', cancelLabel: '', danger: false });
  }

  close(value: string | null): void {
    const c = this.current;
    this.current = null;
    c?.resolve(value);
  }
}

export const dialog = new DialogStore();
