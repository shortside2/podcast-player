/** 秒 → "1:02:03" / "2:03" */
export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return `${h > 0 ? `${h}:` : ''}${mm}:${String(r).padStart(2, '0')}`;
}

export function formatBytes(n: number): string {
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDate(ms: number | null): string {
  if (!ms) return '未再生';
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 秒 → "1:02.3"（0.1 秒単位） */
export function formatTimePrecise(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const tenths = Math.round(sec * 10);
  const whole = Math.floor(tenths / 10);
  return `${formatTime(whole)}.${tenths % 10}`;
}

/** "1:02" "1:02.5" "62" "1:02:03" → 秒。読めなければ null */
export function parseTime(text: string): number | null {
  const parts = text.trim().split(':');
  if (parts.length === 0 || parts.length > 3 || parts.some((p) => p === '' || isNaN(Number(p)))) return null;
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0);
}
