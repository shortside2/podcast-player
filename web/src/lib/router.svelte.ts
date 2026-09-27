/**
 * #/ や #/episode/<id> 形式の画面遷移（GitHub Pages でもサーバー設定なしで動く）
 *
 *   #/                         エピソード一覧
 *   #/episode/<id>             プレイヤー
 *   #/episode/<id>?t=12.3      プレイヤー（その時刻から）
 *   #/episode/<id>?play=a,b,c  プレイヤー（マーク a, b, c を連続再生）
 *   #/marks                    全エピソードのマーク一覧
 *   #/marks/<id>               エピソードのマーク一覧
 */
export type Route =
  | { name: 'library' }
  | { name: 'player'; id: string; t: number | null; play: string[] | null }
  | { name: 'marks'; episodeId: string | null };

function parse(hash: string): Route {
  const [path, query = ''] = hash.replace(/^#/, '').split('?');
  const params = new URLSearchParams(query);
  const ep = path.match(/^\/episode\/([^/]+)/);
  if (ep) {
    const t = params.get('t');
    const play = params.get('play');
    return {
      name: 'player',
      id: decodeURIComponent(ep[1]),
      t: t != null && !isNaN(Number(t)) ? Number(t) : null,
      play: play ? play.split(',').filter(Boolean) : null,
    };
  }
  const marks = path.match(/^\/marks(?:\/([^/]+))?/);
  if (marks) return { name: 'marks', episodeId: marks[1] ? decodeURIComponent(marks[1]) : null };
  return { name: 'library' };
}

class Router {
  route = $state<Route>(parse(location.hash));

  constructor() {
    window.addEventListener('hashchange', () => (this.route = parse(location.hash)));
  }

  go(hash: string): void {
    location.hash = hash;
  }

  /** 前の画面に戻る（履歴がなければ一覧へ） */
  back(fallback = '#/'): void {
    if (history.length > 1) history.back();
    else this.go(fallback);
  }
}

export const router = new Router();
