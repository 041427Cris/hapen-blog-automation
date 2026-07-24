// netlify/functions/generate-articles-background.js
//
// Recebe os dados extraídos do imóvel e gera 3 artigos com ângulos diferentes,
// cada um já com título, corpo em HTML, e os campos de SEO do Yoast
// (SEO title, slug, meta description, focus keyphrase).
//
// Roda como "background function" (aviso no nome termina em -background)
// porque gerar 3 artigos via IA costuma passar dos 10s de limite das funções
// normais do Netlify. O resultado é salvo no Netlify Blobs com um jobId, e o
// front-end consulta o andamento via check-status.js (mesmo esquema usado na
// publicação no WordPress).
//
// A chave da API fica em uma variável de ambiente no Netlify (ANTHROPIC_API_KEY),
// nunca no código nem no front-end.

const { getJobStore } = require("./lib/blob-store");

const ANGLES = [
  {
    id: "bairro",
    label: "Bairro e localização",
    brief:
      "Escreva um artigo com foco no bairro/região onde o imóvel está localizado. " +
      "O ângulo é 'por que morar em [bairro]', usando o imóvel como exemplo prático. " +
      "Pense em como alguém perguntaria isso a uma IA de busca (ex: 'quais os melhores bairros para viver em Curitiba', " +
      "'como é morar no [bairro]') e responda de forma direta e completa nos primeiros parágrafos, para otimizar tanto " +
      "para Google quanto para motores de busca por IA (GEO).",
  },
  {
    id: "produto",
    label: "Empreendimento e diferenciais",
    brief:
      "Escreva um artigo com foco técnico-comercial no empreendimento/imóvel em si: plantas, diferenciais construtivos, " +
      "área de lazer, especificações, acabamentos. Ideal para quem já está comparando opções e busca detalhes concretos.",
  },
  {
    id: "investimento",
    label: "Investimento e estilo de vida",
    brief:
      "Escreva um artigo com foco em valorização e perfil de quem compra: potencial de investimento, comparação de " +
      "custo-benefício, e o estilo de vida que o imóvel proporciona.",
  },
];

const SYSTEM_PROMPT = `Você é redator especializado em conteúdo imobiliário para a Hapen Imóveis, imobiliária de alto padrão em Curitiba.
Escreva sempre em português do Brasil, tom consultivo e premium (nunca apelativo ou "vendedor demais").
Cada artigo deve ter 600-900 palavras, HTML simples (h2, h3, p, ul/li — sem head/body/html), pronto para colar no editor do WordPress.
Otimize para SEO tradicional (palavra-chave no primeiro parágrafo, subtítulos com variações da palavra-chave) e para GEO
(motores de busca por IA como ChatGPT/Perplexity): responda a pergunta central de forma clara e extraível logo no início,
use dados concretos (bairro, metragem, preço quando fizer sentido) em vez de frases vagas.
Responda SOMENTE em JSON válido, sem markdown, sem texto antes ou depois, no formato:
{
  "title": "string",
  "contentHtml": "string",
  "seoTitle": "string (até 60 caracteres)",
  "slug": "string (kebab-case, sem acentos)",
  "metaDescription": "string (até 155 caracteres)",
  "focusKeyphrase": "string (2-4 palavras)"
}`;

async function callClaude(apiKey, imovel, angle) {
  const userPrompt = `Dados do imóvel:
Título: ${imovel.title}
Endereço/bairro: ${imovel.address}
Preço: ${imovel.price}
Descrição: ${imovel.description}
Diferenciais: ${(imovel.features || []).join(", ")}
Link original: ${imovel.sourceUrl}

Ângulo do artigo: ${angle.label}
${angle.brief}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 3000,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Erro na API da Claude (${res.status}): ${text}`);
  }

  const data = await res.json();
  const raw = data.content.find((b) => b.type === "text")?.text || "{}";
  const cleaned = raw.replace(/```json|```/g, "").trim();
  return { angleId: angle.id, angleLabel: angle.label, ...JSON.parse(cleaned) };
}

exports.handler = async (event) => {
  const { jobId, imovel } = JSON.parse(event.body || "{}");
  const store = getJobStore();

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    await store.setJSON(jobId, {
      done: true,
      error: "ANTHROPIC_API_KEY não configurada no Netlify",
    });
    return;
  }

  if (!imovel || !imovel.title) {
    await store.setJSON(jobId, { done: true, error: "Dados do imóvel ausentes" });
    return;
  }

  try {
    const articles = await Promise.all(ANGLES.map((angle) => callClaude(apiKey, imovel, angle)));
    await store.setJSON(jobId, { done: true, articles, finishedAt: new Date().toISOString() });
  } catch (err) {
    await store.setJSON(jobId, { done: true, error: err.message });
  }
};
