# 最近の Copilot Chat ID

<p align="center">
	<strong>直近に保存された Copilot Chat セッションを参照・コピーし、任意でバックエンド報告の AI Credits を明示操作時に分析します。</strong>
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

- 専用の **最近の Chat セッション** Activity Bar ビュー
- 各行にローカルタイトルまたは VS Code タイトル、短縮 ID、相対保存時刻を表示
- 行を展開すると完全な ID、保存日時、タイトルの取得元を確認可能
- 行内/右クリックからタイトルと ID の一括コピー、メタデータ確認、ローカルタイトルの設定・削除
- セッション行を、表示タイトルと `Session ID: <UUID>` の2行形式でコピー
- VS Code が提供する範囲限定の時刻、応答状態、変更行数をscript-freeのセッションインスペクターで確認
- 選択した1セッションについて、バックエンド報告の AI Credits、リクエスト数、モデル別トークン数を明示的に分析
- 展開したセッション ID 詳細行またはグローバルの **最近の ID をコピー** コマンドからUUIDだけをコピー
- ステータスバー表示: `最近: <タイトルまたは短縮 UUID>`。選択すると一覧の該当セッションを表示
- ツールチップにウィンドウ内の保存済みセッション ID 件数を表示
- 直近の UUID 全体をコピー
- 保存済みセッションをタイトル、完全/短縮 ID、保存時刻で検索してコピー
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

> [!NOTE]
> ローカル開発版と Marketplace 版は同じ拡張機能 ID を使用します。通常プロファイルへローカル 0.2.0 VSIX をインストールすると、インストール済みの 0.1.0 公開版を置き換えます。分離検証には `npm run verify:install` を使用し、通常プロファイルでの手動確認後は必要に応じて Marketplace 版を再インストールしてください。

## 有効化

ファイル名の走査は既定で無効です。初回アクティベーション時にプロファイル単位で 1 回だけ有効化を案内します。任意のコマンドを実行して **有効にする** を選ぶか、ユーザー設定で `agShowSessionId.enabled` を設定しても有効化できます。

有効化後は、現在のウィンドウのローカル `chatSessions` 保存領域から `.json` と `.jsonl` の **ファイル名のみ** を読み取ります。並び替えのためにファイルの更新時刻も参照します。
この opt-in 設定は端末固有で、ほかのデバイスには同期されません。

セッションタイトルは別の opt-in です。ビューのtoolbarまたは設定から `agShowSessionId.readTitles` を有効にすると、VS Code のローカルread-only state databaseから `chat.ChatSessionStore.index` 1件だけを読み取ります。タイトルはチャット内容から派生する場合がありますが、メモリ内だけに保持し、ログには記録しません。この設定ではチャットメッセージやJSONL本文を読み取りません。

AI Credits の分析も端末固有の別 opt-in です。セッション行の **AI Credits を分析** を実行すると、選択した1セッションの `.jsonl` または旧 `.json` ファイルだけを読み取ります。セッションファイルにはチャット本文が含まれますが、拡張機能がメモリ内に保持するのはセッション ID、リクエスト数、バックエンド報告の AI Credits、モデル別トークン数の概要だけです。プロンプトと応答は表示、ログ記録、永続化、キャッシュ、送信しません。`agShowSessionId.readUsage` を無効にするとcacheを消去し、開いているセッションインスペクターを直ちに閉じます。

表示タイトルの優先順位は **ローカルタイトル > VS Code メタデータのタイトル > Session `<短縮 ID>`** です。ローカルタイトルはセッション ID 単位でローカルの VS Code profile に保存され、空ウィンドウとworkspace windowの移動後も引き継がれます。同期はされず、Copilot Chatの保存領域も変更しません。初期0.1開発版の別名は自動移行します。

## コマンド

| コマンド                                             | 用途                                   |
| ---------------------------------------------------- | -------------------------------------- |
| `最近の Copilot Chat ID: 再スキャン`                 | 保存済みセッションのファイル名を再走査 |
| `最近の Copilot Chat ID: 最近の ID をコピー`         | 直近に保存された UUID をコピー         |
| `最近の Copilot Chat ID: 保存済み ID を表示`         | 保存済み UUID を一覧表示してコピー     |
| `最近の Copilot Chat ID: ログを表示`                 | 診断用の出力チャネルを開く             |
| `最近の Copilot Chat ID: セッションブラウザーを開く` | Activity Barで直近セッションを表示     |
| `最近の Copilot Chat ID: セッションインスペクターを開く` | 選択したセッションの限定メタデータを表示 |
| `最近の Copilot Chat ID: AI Credits を分析` | 選択した1セッションの使用量を分析 |
| `最近の Copilot Chat ID: 詳細を表示`                 | 選択したセッションを表示して展開       |
| `最近の Copilot Chat ID: ローカルタイトルを設定`     | ローカル専用タイトルを追加・変更       |

グローバルコマンドはコマンドパレットの **最近の Copilot Chat ID** カテゴリに表示されます。セッション固有のコピー、インスペクター、AI Credits 分析、詳細、ローカルタイトル操作はActivity Barの各セッション行に表示されます。展開したセッション ID 詳細には、UUIDのみをコピーする独立した操作があります。

## ステータスバーの状態

| 状態         | 意味                                             | 選択したときの動作         |
| ------------ | ------------------------------------------------ | -------------------------- |
| `<タイトル>` | 直近に保存されたセッションが 1 件に特定できた    | セッションブラウザーに表示 |
| `特定不可`   | 複数のセッションの最新保存時刻が同じ             | セッションブラウザーを開く |
| `なし`       | 保存済みセッションのファイル名が見つからない     | セッションブラウザーを開く |
| `取得不可`   | このウィンドウではローカル保存領域を読み取れない | ログを開く                 |

## プライバシー

- テレメトリおよびネットワークアクセスなし
- 既定ではチャットの JSON / JSONL 本文を読み取らない。任意の AI Credits 分析では明示的に選択したセッションファイルだけを読み取る
- デバッグログを読み取らない
- セッションファイルへ書き込まない
- 使用量分析ではプロンプト、応答、参照、path、tool payloadを表示、ログ記録、永続化、cache、送信しない
- 診断ログには短縮した ID 接頭辞だけを記録し、完全なセッション ID は記録しない
- 任意のメタデータ取得では限定index 1件だけを読み、許可したセッション ID・タイトル・時刻・応答状態・変更行数の概要だけをメモリ内に保持
- 任意の使用量分析は範囲を限定した概要だけをメモリ内に保持し、設定を無効にすると消去してInspectorを閉じる
- セッションインスペクターはscript-freeを維持し、escape済みtextだけを表示する

## 互換性

- 宣言している最小 VS Code バージョン: 1.125.0
- 動作確認済みの開発環境: Windows 11 上の VS Code 1.131.0
- デスクトップのローカルウィンドウのみ対応
- 空のウィンドウ（フォルダー未オープン）では、グローバル側のチャットセッション保存領域を参照
- 仮想ワークスペース、VS Code for the Web、一部の Remote / WSL 構成では `取得不可` になることがある
- この拡張機能は文書化されていない内部保存場所に依存しており、その構成が利用できない場合はデータを変更せずに機能を縮退させる
- 組み込みCopilot Chatのセッション行へ操作を追加するstable APIはないため、独自Activity Barビューを使用する

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
