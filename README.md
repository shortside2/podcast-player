# ListenLoop — ポッドキャスト英語の聞き取り学習プレイヤー

```
podcast-player/
├── mac-tool/   Mac 側ツール: mp3 → スクリプト JSON + m4a（→ mac-tool/README.md）
├── web/        iPhone 向け Web アプリ（PWA）: Vite + TypeScript + Svelte 5
├── docs/       JSON の仕様
└── .github/    GitHub Pages への自動公開の設定
```

音声・スクリプト・マークなどの学習データは **iPhone の中（IndexedDB）にだけ** 保存されます。GitHub に公開するのはアプリ本体のプログラムだけです。

---

## 1. Mac のブラウザで動かす（開発用）

Node.js（v24）はこの Mac に入っています。

```bash
cd ~/"Documents/Claude Code/podcast-player/web"
npm install        # 最初の 1 回だけ
npm run dev
```

表示された `http://localhost:5173/` を Safari か Chrome で開きます。

- Mac のブラウザでは「取り込む」で m4a と json を選べます
- キーボード操作: スペース＝再生／停止、←→＝5 秒戻し・送り、↑↓＝前後の文
- 止めるときはターミナルで `Ctrl + C`

## 2. iPhone で動かす（開発中の確認）

### 方法 A: 同じ Wi-Fi で開く（手軽）

```bash
npm run dev:phone
```

`Network: http://192.168.x.x:5173/` のようなアドレスが表示されるので、それを iPhone の Safari で開きます。

- 再生・ハイライト・スクロール・速度変更などは確認できます
- ただし https ではないため、**オフライン起動・画面オン維持・クリップボード・録音は動きません**（これらは GitHub Pages で確認します）

### 方法 B: iPhone のエラーを Mac で見る

1. iPhone: 設定 → アプリ → Safari → 詳細 → 「Web インスペクタ」をオン
2. iPhone を USB ケーブルで Mac につなぐ
3. Mac の Safari: 設定 → 詳細 → 「メニューバーに"開発"メニューを表示」をオン
4. Mac の Safari の「開発」メニュー → iPhone の名前 → 開いているページを選ぶ

---

## 3. GitHub Pages で公開する（最初の 1 回）

GitHub Pages（無料のWebサイト置き場、https 対応）にアプリを置きます。アプリのコードは誰でも見られる状態（public）になりますが、学習データは含まれません。

### 3-1. GitHub のアカウントを作る

1. https://github.com/signup を開き、メールアドレス・パスワード・ユーザー名を登録
   （ユーザー名はアプリの URL に入ります: `https://ユーザー名.github.io/podcast-player/`）
2. 届いたメールのコードで認証

### 3-2. GitHub Desktop を入れる（アップロード用のアプリ）

ターミナルでの認証設定が不要で、初めてでも扱いやすいです。

1. https://desktop.github.com/ からダウンロードして、アプリケーションフォルダに入れる
2. 起動して「Sign in to GitHub.com」→ ブラウザで許可

### 3-3. リポジトリ（プロジェクトの置き場所）を作ってアップロード

1. GitHub Desktop のメニュー「File」→「Add Local Repository…」
2. `Documents/Claude Code/podcast-player` フォルダを選ぶ
3. 「This directory does not appear to be a Git repository」と出たら「**create a repository**」をクリック → そのまま「Create Repository」
4. 右上の「**Publish repository**」をクリック
   - Name: `podcast-player`
   - **「Keep this code private」のチェックを外す**（無料プランの GitHub Pages は public のみ）
   - 「Publish Repository」

### 3-4. GitHub Pages を有効にする

1. ブラウザで `https://github.com/ユーザー名/podcast-player` を開く
2. 「Settings」→ 左の「Pages」
3. 「Build and deployment」の Source を「**GitHub Actions**」にする
4. 「Actions」タブを開き、「Deploy to GitHub Pages」を選んで「Run workflow」
5. 1〜2 分で緑のチェックが付けば完了。`https://ユーザー名.github.io/podcast-player/` で開けます

### 以降の更新

コードを変更したら、GitHub Desktop で左下に変更内容のメモを書いて「Commit to main」→ 上の「Push origin」。数分で自動的に公開サイトが更新されます。

---

## 4. iPhone のホーム画面に追加する

1. iPhone の **Safari** で `https://ユーザー名.github.io/podcast-player/` を開く
2. 下の共有ボタン（□に↑）→「**ホーム画面に追加**」→「追加」
3. ホーム画面の ListenLoop アイコンから開く

注意:

- **Safari で開いたページと、ホーム画面のアプリは保存場所が別です。** 取り込みは必ずホーム画面のアプリから行ってください
- 一度開けば、オフラインでも起動します
- アプリを更新したときは、ホーム画面のアプリを一度閉じて（上にスワイプ）開き直すと新しい版になります

## 5. エピソードを取り込む

1. Mac で `make_transcript.py` を実行して `.m4a` と `.json` を作る
2. 2 つのファイルを AirDrop で iPhone に送り、「ファイル」アプリに保存（iCloud Drive 経由でも可）
3. ホーム画面の ListenLoop →「取り込む」→ 2 つのファイルを選択（長押し→「選択」で複数選べます）
