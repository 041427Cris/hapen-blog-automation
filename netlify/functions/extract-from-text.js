// netlify/functions/extract-from-text.js
//
// Alternativa ao extract-imovel.js (que tenta raspar a página automaticamente).
// Aqui o usuário simplesmente cola o texto do imóvel/empreendimento (copiado
// do site, de um material comercial, etc.) e a Claude organiza isso nos
// mesmos campos usados no resto do fluxo. Muito mais confiável do que tentar
// adivinhar a estrutura de HTML de terceiros.

const SYSTEM_PROMPT = `Você extrai dados estruturados de textos sobre imóveis/empreendimentos da Hapen Imóveis.
Responda SOMENTE em JSON válido, sem markdown, sem texto antes ou depois, no formato:
{
  "title": "string - nome do imóvel/empreendimento",
  "address": "string - bairro e cidade",
  "price": "string - preço ou faixa de preço, como está no texto",
  "description": "string - resumo de 2-4 frases com base no texto",
  "features": ["lista de diferenciais/características, um item por string"]
}
Se alguma informação não estiver no texto, deixe a string vazia ou a lista vazia — não invente dados.`;

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "ANTHROPIC_API_KEY não configurada no Netlify" }) };
  }

  const { text } = JSON.parse(event.body || "{}");
  if (!text || !text.trim()) {
    return { statusCode: 400, body: JSON.stringify({ error: "Cole o texto do imóvel/empreendimento" }) };
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: text }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Erro na API da Claude (${res.status}): ${errText}`);
    }

    const data = await res.json();
    const raw = data.content.find((b) => b.type === "text")?.text || "{}";
    const cleaned = raw.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(cleaned);

    return {
      statusCode: 200,
      body: JSON.stringify({ data: { ...parsed, sourceUrl: "", gallery: [] } }),
    };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
