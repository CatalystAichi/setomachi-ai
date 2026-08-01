# デプロイ手順書（AWSコンソール版）

対象: 音声入力(Web Speech API)＋AI生成(Gemini経由のLambda)を本番で動かすための、
AWS Amplify Hosting（フロント配信）＋ Lambda Function URL（Gemini呼び出し）のセットアップ手順。

このマシンにAWS CLI/SAMが入っていないため、すべてAWSマネジメントコンソールでの手動操作を前提にしています。
作業は「2. Lambda」→「3. Amplify」→「4. 動作確認」の順で進めてください。

---

## 0. 前提

- `backend/lambda_function.mjs` … Geminiを呼ぶLambdaのコード（依存パッケージなし、Node.js 20.x以降のfetchのみ使用）
- `backend/.env` … `GEMINI_API_KEY=...` が入っている（このファイル自体はコミットしない・Lambdaにはアップロードしない）
- `frontend/setomachi-mobile.html` … 既存のデモ本体。`GEMINI_ENDPOINT` という変数にLambda Function URLを設定する箇所がある

---

## 1. Lambda関数を作成する

1. AWSマネジメントコンソール → **Lambda** → 「関数の作成」
2. 「一から作成」を選択
   - 関数名: 例 `setomachi-gemini-generate`
   - ランタイム: **Node.js 20.x**（またはそれ以降）
   - アーキテクチャ: `arm64` でも `x86_64` でも可（迷ったらデフォルトのままでOK）
3. 「関数の作成」を押す
4. 作成後の画面で「コード」タブを開き、`lambda_function.mjs` の中身を丸ごとコピーして、
   コンソールのコードエディタ（ファイル名を `index.mjs` にリネームして貼り付け。
   Lambdaのハンドラ設定はデフォルトの `index.handler` のままでよい）、**Deploy** を押す
   - 依存パッケージが無いので zip アップロードは不要。貼り付けだけで動く
5. 「設定」→「環境変数」→ 編集 → 追加
   - キー: `GEMINI_API_KEY`
   - 値: `backend/.env` に書いてある値をそのままコピー
6. 「設定」→「一般設定」→ 編集
   - タイムアウトを **30秒** 程度に延長（Geminiの応答待ちに数秒〜十数秒かかるため、デフォルトの3秒だと落ちる）
   - メモリはデフォルト(128MB)のままで問題なし

---

## 2. Lambda Function URLを有効化する

1. 同じ関数の「設定」→「関数URL」→ 「関数URLを作成」
2. 認証タイプ: **NONE**（ブラウザから直接叩くため。API Gatewayは使わない）
3. 「追加設定」→ CORSを構成にチェックを入れて以下を設定
   - Allow origin: 手順3でAmplifyのURLが分かってから設定（一旦 `*` で作成し、Amplifyのドメインが判明したら絞り込む）
   - Allow methods: `POST`
   - Allow headers: `content-type`
4. 「保存」すると **Function URL**（`https://xxxxxxxx.lambda-url.<region>.on.aws/` のような形）が発行される
   → このURLを控えておく（次のステップでフロントに設定する）

---

## 3. フロントにLambda URLを設定する

`frontend/setomachi-mobile.html` 内、`<script>` の中にある以下の行を、控えたFunction URLに書き換える。

```js
var GEMINI_ENDPOINT = "https://REPLACE-ME.lambda-url.ap-northeast-1.on.aws/";
```

（このURLは公開されても問題ない値です。秘密鍵はLambda側の環境変数にのみ置いてあります）

---

## 4. AWS Amplify Hostingでフロントを公開する

1. AWSマネジメントコンソール → **Amplify** → 「新しいアプリ」→「ウェブアプリをホスト」
2. GitHubを選択し、リポジトリ `CatalystAichi/setomachi-ai`、ブランチ `main` を連携
   （初回はGitHub認証・Amplify GitHub Appのインストールが必要）
3. ビルド設定（`amplify.yml` 相当）の編集画面で、以下の内容に置き換える
   （ビルドコマンドなしの静的サイトとして配信する設定）

```yaml
version: 1
frontend:
  phases:
    build:
      commands: []
  artifacts:
    baseDirectory: frontend
    files:
      - '**/*'
  cache:
    paths: []
```

4. デプロイ完了後に発行される `https://main.xxxxxxxxxx.amplifyapp.com` のようなURLを控える
5. 「リライトとリダイレクト」設定を開き、ルートを既存ファイルへ200リライトするルールを追加
   （`setomachi-mobile.html` をリネームせずそのまま配信するため）
   - ソースアドレス: `/`
   - ターゲットアドレス: `/setomachi-mobile.html`
   - タイプ: `200 (書き換え)`
6. 手順2に戻り、LambdaのFunction URLのCORS設定 **Allow origin** を、
   手順4で控えたAmplifyのURL（`https://main.xxxxxxxxxx.amplifyapp.com`）に絞り込む

---

## 5. 動作確認

1. AmplifyのURLをスマートフォン（できれば実機、特にiPhone Safari）で開く
2. 「あたらしい器をだす」→ 撮影 → しゃべる画面でマイクをタップし、実際に話す
   - ブラウザのマイク許可ダイアログが出たら許可する（HTTPS配信なので許可ダイアログが出るはず）
   - 数秒黙ると自動的に認識が止まり、AI生成画面 → 結果画面に実データが表示されればOK
3. 音声認識が使えない/失敗するブラウザでは、従来のタイプライター演出にフォールバックし、
   デモが止まらないことを確認する
4. Lambda側の動作確認は CloudWatch Logs（Lambda関数の「モニタリング」タブ）でエラーの有無を確認できる

---

## トラブルシュート

- マイクの許可ダイアログが出ない/`SpeechRecognition`が`undefined`
  → HTTPSでアクセスできているか確認（`file://`や`http://`では動かない）
- Lambda呼び出しがCORSエラーになる
  → Function URLのCORS設定のAllow originが、実際にアクセスしているAmplifyのURLと完全一致しているか確認
- Geminiから502が返る
  → CloudWatch LogsでGemini APIのエラーメッセージを確認。モデル名(`gemini-2.5-flash`)が
     手元のAPIキーで利用可能か、Google AI Studio側で確認する
