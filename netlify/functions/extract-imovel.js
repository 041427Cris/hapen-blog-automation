// netlify/functions/extract-imovel.js
//
// Recebe o link de uma página de imóvel/empreendimento do site da Hapen e
// extrai os dados estruturados usados para gerar os artigos: título, bairro,
// preço, metragem, quartos, diferenciais, descrição e fotos da galeria.
//
// IMPORTANTE: os seletores CSS abaixo (SELECTORS) são um ponto de partida
// baseado em padrões comuns de sites Rocket Imob. Como cada tema pode variar
// um pouco o HTML, confira a página real de um imóvel (botão direito > Inspecionar)
// e ajuste os seletores se algum campo vier vazio. Deixei tudo em um objeto só,
// no topo do arquivo, pra ser rápido de ajustar.

const cheerio = require("cheerio");

const SELECTORS = {
  title: "h1, .imovel-titulo, .property-title",
  price: ".preco, .imovel-preco, .property-price, [class*='valor']",
  address: ".endereco, .imovel-endereco, .property-address, [class*='bairro']",
  description: ".descricao, .imovel-descricao, .property-description, #descricao",
  features: ".caracteristicas li, .diferenciais li, .amenities li, [class*='feature'] li",
  gallery: ".galeria img, .property-gallery img, .slick-slide img, [class*='gallery'] img",
};

function absolutize(url, base) {
  try {
    return new URL(url, base).href;
  } catch {
    return url;
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const { url } = JSON.parse(event.body || "{}");
  if (!url || !url.includes("hapenimoveis.com.br")) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "Envie um link de hapenimoveis.com.br" }),
    };
  }

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; HapenBlogBot/1.0)" },
    });
    if (!res.ok) {
      return {
        statusCode: 502,
        body: JSON.stringify({ error: `Não consegui acessar a página (status ${res.status})` }),
      };
    }
    const html = await res.text();
    const $ = cheerio.load(html);

    const title = $(SELECTORS.title).first().text().trim();
    const price = $(SELECTORS.price).first().text().trim();
    const address = $(SELECTORS.address).first().text().trim();
    const description = $(SELECTORS.description)
      .map((_, el) => $(el).text().trim())
      .get()
      .join("\n")
      .trim();

    const features = $(SELECTORS.features)
      .map((_, el) => $(el).text().trim())
      .get()
      .filter(Boolean);

    const gallery = $(SELECTORS.gallery)
      .map((_, el) => {
        const src = $(el).attr("data-src") || $(el).attr("src");
        return src ? absolutize(src, url) : null;
      })
      .get()
      .filter(Boolean)
      // remove duplicadas e ícones pequenos comuns (logo, placeholder)
      .filter((src, i, arr) => arr.indexOf(src) === i)
      .filter((src) => !/logo|placeholder|icon/i.test(src));

    // Fallback: se algum campo veio vazio, usar meta tags OpenGraph (quase sempre existem)
    const ogTitle = $('meta[property="og:title"]').attr("content");
    const ogDescription = $('meta[property="og:description"]').attr("content");
    const ogImage = $('meta[property="og:image"]').attr("content");

    const data = {
      sourceUrl: url,
      title: title || ogTitle || "",
      price: price || "",
      address: address || "",
      description: description || ogDescription || "",
      features,
      gallery: gallery.length ? gallery : ogImage ? [absolutize(ogImage, url)] : [],
    };

    const missing = Object.entries(data)
      .filter(([k, v]) => k !== "sourceUrl" && (!v || (Array.isArray(v) && v.length === 0)))
      .map(([k]) => k);

    return {
      statusCode: 200,
      body: JSON.stringify({ data, missing }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message }),
    };
  }
};
