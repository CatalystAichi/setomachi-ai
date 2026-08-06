// Gemini APIを呼び出し、店主の音声認識テキストから
// 商品タイトル・紹介文・編集メモ・客への通知文を生成するLambdaハンドラ。
// AWS Lambda Function URLから直接呼び出される想定（API Gatewayは使わない）。
// Node.js 20.x以降のグローバルfetchのみを使い、外部依存パッケージは無し。
// （仕様書8-3: バックエンドはPython 3.12またはNode.js 20許容のため、依存ゼロで
//   デプロイが最速なNode.js 20を採用）
//
// 必須の環境変数（Lambdaコンソールで設定。コードには書かない）:
//   GEMINI_API_KEY  … backend/.env の値をそのままLambdaの環境変数に設定する

const GEMINI_MODEL = "gemini-3.5-flash"; // 仕様書8-4: 2026年8月時点でgemini-2.5-flashが新規アカウントで404のためgemini-3.5-flashを使用
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// type: "listing"（出品・3-3〜3-5、デフォルト）
const LISTING_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    description: { type: "STRING" },
    note: { type: "STRING" },
    notice: { type: "STRING" }
  },
  required: ["title", "description", "note", "notice"],
  propertyOrdering: ["title", "description", "note", "notice"]
};

function buildListingPrompt(transcript) {
  return `あなたは瀬戸焼の商店街で働く「デジタルの店員さん」です。
高齢の陶器店主が、自分の作った器について話した内容から、器の商品ページに載せる文章を作ります。

店主が話した内容（音声認識のそのままの書き起こし）:
「${transcript}」

以下のルールを必ず守り、JSONで出力してください。
- title: 器のタイトル。20文字前後。商品名として自然な一文。
- description: 紹介文。2〜3文。店主が話した口調・方言・語尾（例:「〜だよ」「〜でね」）はそのまま活かし、
  機械的な標準語に直さない。読みやすく整える程度にとどめる。専門用語は使わない。
- note: 「加藤さんが話した『(店主の言葉から実際に抜き出した短い引用)』をそのまま活かしています。
  方言や言い回しは残したまま整えました。」という形式の一文。引用部分は必ず店主が実際に話した言葉から選ぶこと。
- notice: この新作をパスポートでつながっているお客さんに送る、短いお知らせ文。店主の口調を残しつつ、やさしい言葉で。

出力は日本語のみ。指定した4項目以外は含めないこと。`;
}

// type: "reply"（返信・3-8〜3-9、A2で追加）
const REPLY_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    reply: { type: "STRING" }
  },
  required: ["reply"],
  propertyOrdering: ["reply"]
};

function buildReplyPrompt(inquiry, transcript) {
  return `あなたは瀬戸焼の商店街で働く「デジタルの店員さん」です。
高齢の陶器店主が、お客さんからの問い合わせに口頭で返事をしました。
その内容を、お客さんに送る返信メッセージとして整えてください。

お客さんからの問い合わせ:
「${inquiry}」

店主が話した返事（音声認識のそのままの書き起こし）:
「${transcript}」

以下のルールを必ず守り、JSONで出力してください。
- reply: お客さんに送る返信メッセージを1つだけ。店主が話した口調・方言・語尾
  （例:「〜だよ」「〜でね」）はそのまま活かし、機械的な標準語に直さない。
  失礼のない形には整えるが、標準語化はしない。その人らしさを残すこと（P5）。
  専門用語は使わない。

出力は日本語のみ。指定した1項目以外は含めないこと。`;
}

function jsonResponse(statusCode, payload) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(payload)
  };
}

export const handler = async (event) => {
  try {
    const method = event?.requestContext?.http?.method;
    if (method === "OPTIONS") {
      // 通常はFunction URL側のCORS設定でOPTIONSは処理されるが、保険で残す
      return { statusCode: 204, headers: {} };
    }

    let body = {};
    if (event.body) {
      const raw = event.isBase64Encoded
        ? Buffer.from(event.body, "base64").toString("utf-8")
        : event.body;
      body = JSON.parse(raw);
    }

    const transcript = (body.transcript || "").trim();
    if (!transcript) {
      return jsonResponse(400, { error: "transcript is required" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return jsonResponse(500, { error: "GEMINI_API_KEY is not configured" });
    }

    const isReply = body.type === "reply";
    const prompt = isReply
      ? buildReplyPrompt((body.inquiry || "").trim(), transcript)
      : buildListingPrompt(transcript);
    const schema = isReply ? REPLY_RESPONSE_SCHEMA : LISTING_RESPONSE_SCHEMA;

    const geminiRes = await fetch(`${GEMINI_URL}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0.7
        }
      })
    });

    if (!geminiRes.ok) {
      const detail = await geminiRes.text();
      return jsonResponse(502, { error: "gemini request failed", detail });
    }

    const geminiJson = await geminiRes.json();
    const text = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      return jsonResponse(502, { error: "empty gemini response" });
    }

    const generated = JSON.parse(text);
    return jsonResponse(200, generated);
  } catch (err) {
    return jsonResponse(500, { error: String((err && err.message) || err) });
  }
};
