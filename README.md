# Launchpad Studio

Novation Launchpad X を自由にいじるための常駐型プレイグラウンドアプリ (Electron + TypeScript)。

## 起動

```
npm install
npm run dev      # 開発モード (ホットリロード付き)
npm run build    # プロダクションビルド (out/ に出力)
npm run typecheck
```

※ VSCode 内蔵ターミナルから起動する場合、`ELECTRON_RUN_AS_NODE` が環境に漏れていると
Electron が Node モードで起動して落ちる。その場合は
`Remove-Item Env:\ELECTRON_RUN_AS_NODE` してから `npm run dev`。

## 使い方

- Launchpad X を USB 接続すると自動検出され、起動時に Programmer モードへ切り替わる
  (抜き差しにも追従)。接続時は白い波が走る接続確認デモが出る
- ウィンドウを閉じてもタスクトレイに常駐し、MIDI 処理は動き続ける。終了はトレイの「終了」
  (終了時に Launchpad は Live モードへ復帰する)
- ポート自動検出に失敗する場合はヘッダーのポート選択 + 「再接続」で手動選択

### モード

| モード | 内容 |
|---|---|
| 入力モニタ | 押したパッドがベロシティに応じて光り、イベントがログに流れる |
| ペイント | パレットで色を選び、実機/画面どちらからでもパッドを塗れる |
| レインボー | 虹色の波アニメーション。パッドを押すと波紋が広がる |
| マクロパッド | パッドにアプリ起動/URL/フォルダを割当。実機で押すと実行 (画面クリックは編集対象の選択) |

## アーキテクチャ

```
src/main/       Electron メイン: トレイ常駐, WebMIDI 権限付与, マクロアクション実行 (IPC)
src/preload/    contextBridge (window.api)
src/renderer/
  src/midi/launchpad.ts   デバイス層: ポート検出, Programmer モード, SysEx LED 制御
  src/core/frame.ts       9x9 仮想フレームバッファ (差分だけ実機+画面ミラーへ flush)
  src/core/modes.ts       モードプラグイン基盤 + rAF フレームループ
  src/modes/*.ts          各モード (monitor / paint / rainbow / macro)
  src/main.ts             UI 配線 (グリッドミラー, タブ, パレット, マクロ編集, ログ)
```

新しい遊び方を追加するときは `Mode` インターフェース
(`onActivate / onPadDown / onPadUp / onFrame`) を実装して `main.ts` で register するだけ。
描画は `ctx.frame` (FrameBuffer) に書けば、実機への SysEx 送信と画面ミラーは基盤側がやる。

## Launchpad X プロトコルメモ (Programmer's Reference Manual 準拠)

- SysEx ヘッダ: `F0 00 20 29 02 0C ... F7`
- Programmer モード切替: `... 0E 01` (01=programmer, 00=live)
- RGB LED 一括更新: `... 03 (03 <pad> <R> <G> <B>)...` 各 0-127、1 メッセージ最大 81 エントリ
- パッド ID: `row*10 + col` (row/col とも 1-9)。8x8 パッド=11-88、右列=19-89、
  最上段ボタン= CC 91-98、ロゴ LED=99
- 入力: パッドは Note On/Off (ch1, velocity 付き)、最上段は CC

## 今後の拡張候補

- キーストローク送出マクロ (nut.js など)
- loopMIDI 併用の MIDI ルーティング/リマップ (DAW 用途)
- オーディオビジュアライザーモード
- プロファイル切替をパッドに割当、ゲーム系モード
