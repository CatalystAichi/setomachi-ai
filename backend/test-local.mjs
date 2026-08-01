// ローカルでLambdaのGemini呼び出し部分だけを試すための確認用スクリプト。
// AWSアカウント不要。デプロイ物には含めない（.gitignoreでbackend/*.local.mjs等を
// 除外したい場合は別途追加してもよいが、秘密情報は含まないためコミットされても実害はない）。
import { handler } from './lambda_function.mjs';

const testEvent = {
  body: JSON.stringify({
    transcript: "これは織部の小鉢でね。煮物でも、ちょっとしたおつまみでも合うよ。手にすっと馴染む大きさにしたんだ。"
  })
};

const result = await handler(testEvent);
console.log('statusCode:', result.statusCode);
console.log('body:', JSON.stringify(JSON.parse(result.body), null, 2));