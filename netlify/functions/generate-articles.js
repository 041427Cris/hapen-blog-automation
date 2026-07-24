// netlify/functions/generate-articles.js
//
// Recebe os dados extraídos do imóvel e gera 3 artigos com ângulos diferentes,
// cada um já com título, corpo em HTML, e os campos de SEO do Yoast
// (SEO title, slug, meta description, focus keyphrase).
//
// Função SÍNCRONA comum (não usa mais "background function" nem Netlify
// Blobs — nesse site em específico as funções em segundo plano não estavam
// respondendo corretamente). Para caber dentro do limite de tempo de uma
// função normal, os artigos ficam um pouco mais enxutos (400-550 palavras
// em vez de 600-900). Dá pra pedir pra Claude expandir um artigo específico
// depois, direto na tela de revisão, se quiser mais conteúdo.
//
// A chave da API fica em uma variável de ambiente no Netlify (ANTHROPIC_API_KEY),
// nunca no código nem no front-end.

const ANGLES = [
  {
    id: "bairro",
    label: "Bairro e localização",
    brief:
      "Escreva um artigo com foco no bairro/região onde o imóvel está localizado. " +
      "O ângulo é 'por que morar em [bairro]', usando o imóvel como exemplo prático. " +
      "Responda de forma direta e completa já no primeiro parágrafo (bom para SEO e para " +
      "motores de busca por IA/GEO).",
  },
  {
    id: "produto",
    label: "Empreendimento e diferenciais",
    brief:
      "Escreva um artigo com foco técnico-comercial no empreendimento/imóvel em si: plantas, " +
      "diferenciais construtivos, área de lazer, especificações, acabamentos.",
  },
  {
    id: "investimento",
    label: "Investimento e estilo de vida",
    brief:
      "Escreva um artigo com foco em valorização e perfil de quem compra: potencial de " +
      "investimento, custo-benefício, e o estilo de vida que o imóvel proporciona.",
  },
];

const SYSTEM_PROMPT = `Você é redator especializado em conteúdo imobiliário para a Hapen Imóveis, imobiliária de alto padrão em Curitiba.
Escreva sempre em português do Brasil, tom consultivo e premium (nunca apelativo ou "vendedor demais").
Cada artigo deve ter 400-550 palavras (seja direto, sem enrolação), HTML simples (h2, h3, p, ul/li — sem head/body/html), pronto para colar no editor do WordPress.
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
Link original: ${imovel.sourceUrl || ""}

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
      max_tokens: 2200,
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
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: "ANTHROPIC_API_KEY não configurada no Netlify" }) };
  }

  let imovel;
  try {
    ({ imovel } = JSON.parse(event.body || "{}"));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Corpo da requisição inválido" }) };
  }

  if (!imovel || !imovel.title) {
    return { statusCode: 400, body: JSON.stringify({ error: "Dados do imóvel ausentes" }) };
  }

  try {
    const articles = await Promise.all(ANGLES.map((angle) => callClaude(apiKey, imovel, angle)));
    return { statusCode: 200, body: JSON.stringify({ articles }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
