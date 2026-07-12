# Launchpad Othello

Novation Launchpad X の 8x8 パッドグリッドをそのままオセロ盤にする専用アプリ (Electron + TypeScript)。
[launchpad-studio](https://github.com/bruiselea/launchpad-studio) からオセロモードだけを切り出してフォーク。

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
- 8x8 グリッドがそのままオセロ盤。黒(紫)/白(グレー) の2人対戦、実機で交互に押す
- 合法手のマスはうっすら光ってヒント表示。着手すると挟んだ石が一瞬オレンジで
  光ってひっくり返る
- 合法手が無いプレイヤーは自動パス。両者パス、または盤面が埋まったらゲーム終了、
  勝敗をログに表示 (画面下部)
- 「新規対局」ボタンでいつでもリセット可能
- ウィンドウを閉じてもタスクトレイに常駐し、MIDI 処理は動き続ける。終了はトレイの「終了」
  (終了時に Launchpad は Live モードへ復帰する)
- ポート自動検出に失敗する場合はヘッダーのポート選択 + 「再接続」で手動選択

## アーキテクチャ

```
src/main/       Electron メイン: トレイ常駐, WebMIDI 権限付与
src/preload/    contextBridge (window.api)
src/renderer/
  src/midi/launchpad.ts   デバイス層: ポート検出, Programmer モード, SysEx LED 制御
  src/core/frame.ts       9x9 仮想フレームバッファ (差分だけ実機+画面ミラーへ flush)
  src/core/modes.ts       モードプラグイン基盤 + rAF フレームループ (現状オセロのみ登録)
  src/modes/othello.ts    オセロのゲームロジック・描画
  src/main.ts             UI 配線 (グリッドミラー, 新規対局ボタン, ログ)
```

## Launchpad X プロトコルメモ (Programmer's Reference Manual 準拠)

- SysEx ヘッダ: `F0 00 20 29 02 0C ... F7`
- Programmer モード切替: `... 0E 01` (01=programmer, 00=live)
- RGB LED 一括更新: `... 03 (03 <pad> <R> <G> <B>)...` 各 0-127、1 メッセージ最大 81 エントリ
- パッド ID: `row*10 + col` (row/col とも 1-9)。8x8 パッド=11-88、右列=19-89、
  最上段ボタン= CC 91-98、ロゴ LED=99
- 入力: パッドは Note On/Off (ch1, velocity 付き)、最上段は CC
- オセロ盤は x,y: 0-7 (pad 11-88) のみ使用。右列・最上段は未使用

## 今後の拡張候補

- CPU 対戦 (簡易 AI)
- 得点表示を LED でも見せる演出
- 対局ログの棋譜保存
