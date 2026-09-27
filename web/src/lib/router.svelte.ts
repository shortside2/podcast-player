/** #/ や #/episode/<id> 形式の画面遷移（GitHub Pages でもサーバー設定なしで動く） */
export type Route = { name: 'library' } | { name: 'player'; id: string };

function parse(hash: string): Route {
  const m = hash.match(/^#\/episode\/([^/?]+)/);
  if (m) return { name: 'player', id: decodeURIComponent(m[1]) };
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
}

export const router = new Router();
