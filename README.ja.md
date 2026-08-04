# 最近の Copilot Chat ID

<p align="center">
	<strong>チャット本文を読み取らずに、直近に保存された Copilot Chat セッション UUID を表示・コピーします。</strong>
</p>

<p align="center">
	<a href="https://marketplace.visualstudio.com/items?itemName=yamapan.ag-show-session-id"><img alt="状態: プレビュー" src="https://badgen.net/badge/Status/Preview/orange"></a>
	<a href="https://marketplace.visualstudio.com/items?itemName=yamapan.ag-show-session-id"><img alt="VS Marketplace バージョン" src="https://badgen.net/vs-marketplace/v/yamapan.ag-show-session-id"></a>
	<a href="https://marketplace.visualstudio.com/items?itemName=yamapan.ag-show-session-id"><img alt="VS Marketplace インストール数" src="https://badgen.net/vs-marketplace/i/yamapan.ag-show-session-id"></a>
	<a href="#互換性"><img alt="VS Code 1.125 以降" src="https://badgen.net/badge/VS%20Code/%3E%3D%201.125/blue"></a>
	<a href="#プライバシー"><img alt="プライバシー: ローカルのみ" src="https://badgen.net/badge/Privacy/Local%20Only/green"></a>
	<a href="README.md"><img alt="言語: 英語と日本語" src="https://badgen.net/badge/Languages/EN%20%7C%20JA/blue"></a>
	<a href="LICENSE"><img alt="ライセンス: CC BY-NC-SA 4.0" src="https://badgen.net/badge/License/CC%20BY-NC-SA%204.0/gray"></a>
	<a href="https://github.com/aktsmm/vscode-recent-copilot-chat-id"><img alt="GitHub ソース" src="https://badgen.net/badge/GitHub/Source/black"></a>
	<a href="https://github.com/aktsmm/vscode-recent-copilot-chat-id"><img alt="GitHub スター" src="https://badgen.net/github/stars/aktsmm/vscode-recent-copilot-chat-id"></a>
</p>

<p align="center">
	<a href="https://marketplace.visualstudio.com/items?itemName=yamapan.ag-show-session-id"><b>Marketplace からインストール</b></a> •
	<a href="#機能">機能</a> •
	<a href="#コマンド">コマンド</a> •
	<a href="#プライバシー">プライバシー</a> •
	<a href="README.md">English</a>
</p>

---

## 重要な制限

この拡張機能が表示するのは **直近に保存された** セッション ID です。現在アクティブなチャットセッションを特定するものではありません。VS Code は安定版 Extension API でその情報を公開していません。

## 機能

- ステータスバー表示: `最近の Chat: <短縮 UUID>`（全状態にスクリーンリーダー用ラベルあり）
- ツールチップにウィンドウ内の保存済みセッション ID 件数を表示
- 直近の UUID 全体をコピー
- 保存済み UUID を一覧表示し、保存時刻でも検索してコピー
- ファイル名の走査を手動で再実行
- セッションファイルの変更を検知して自動更新
- 診断ログを `Recent Copilot Chat ID` 出力チャネルへ記録
- VS Code の表示言語が `ja` のときは日本語 UI

## インストール

[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=yamapan.ag-show-session-id) からインストールするか、次のコマンドを実行します。

```text
ext install yamapan.ag-show-session-id
```

ローカルビルドの場合:

1. このリポジトリで `npm install` を実行します。
2. `npm test` を実行して拡張機能をローカル検証します。
3. `npm run package` を実行して VSIX を生成します。
4. VS Code のコマンドパレットから **拡張機能: VSIX からのインストール...** を実行します。
5. 生成された `artifacts/vsix/ag-show-session-id-<version>.vsix` を選び、案内に従って VS Code を再読み込みします。

## 有効化

ファイル名の走査は既定で無効です。初回アクティベーション時にプロファイル単位で 1 回だけ有効化を案内します。任意のコマンドを実行して **有効にする** を選ぶか、ユーザー設定で `agShowSessionId.enabled` を設定しても有効化できます。

有効化後は、現在のウィンドウのローカル `chatSessions` 保存領域から `.json` と `.jsonl` の **ファイル名のみ** を読み取ります。並び替えのためにファイルの更新時刻も参照します。
この opt-in 設定は端末固有で、ほかのデバイスには同期されません。

## コマンド

| コマンド                                     | 用途                                   |
| -------------------------------------------- | -------------------------------------- |
| `最近の Copilot Chat ID: 再スキャン`         | 保存済みセッションのファイル名を再走査 |
| `最近の Copilot Chat ID: 最近の ID をコピー` | 直近に保存された UUID をコピー         |
| `最近の Copilot Chat ID: 保存済み ID を表示` | 保存済み UUID を一覧表示してコピー     |
| `最近の Copilot Chat ID: ログを表示`         | 診断用の出力チャネルを開く             |

すべてのコマンドはコマンドパレットの **最近の Copilot Chat ID** カテゴリに表示されます。

## ステータスバーの状態

| 状態          | 意味                                             | 選択したときの動作   |
| ------------- | ------------------------------------------------ | -------------------- |
| `<短縮 UUID>` | 直近に保存されたセッションが 1 件に特定できた    | 完全な ID をコピー   |
| `特定不可`    | 複数のセッションの最新保存時刻が同じ             | コピーする ID を選択 |
| `なし`        | 保存済みセッションのファイル名が見つからない     | 保存済み ID を確認   |
| `取得不可`    | このウィンドウではローカル保存領域を読み取れない | ログを開く           |

## プライバシー

- テレメトリおよびネットワークアクセスなし
- チャットの JSON / JSONL 本文を読み取らない
- デバッグログや `state.vscdb` を読み取らない
- セッションファイルへ書き込まない
- プロンプト、応答、タイトル、参照、コードを収集しない
- 診断ログには短縮した ID 接頭辞だけを記録し、完全なセッション ID は記録しない

## 互換性

- 宣言している最小 VS Code バージョン: 1.125.0
- 動作確認済みの開発環境: Windows 11 上の VS Code 1.131.0
- デスクトップのローカルウィンドウのみ対応
- 空のウィンドウ（フォルダー未オープン）では、グローバル側のチャットセッション保存領域を参照
- 仮想ワークスペース、VS Code for the Web、一部の Remote / WSL 構成では `取得不可` になることがある
- この PoC は文書化されていない内部保存場所に依存しており、その構成が利用できない場合はデータを変更せずに機能を縮退させる

API と保存領域の調査結果は、ソースワークスペースの `research/20260805-copilot-chat-session-id-extension.md` にあります。

## 開発

```powershell
npm install
npm test
npm run package
npm run verify:install
npm run verify:release
```

VSIX は `artifacts/vsix/` に出力されます。`verify:install` はその VSIX を分離された `.vscode-test` プロファイルへインストールし、通常利用している VS Code を変更せずに拡張 ID とバージョンを確認します。`verify:release` は、依存監査、単体・Extension Host テスト、パッケージ検査、分離インストールをまとめて実行する完全なローカル gate です。
