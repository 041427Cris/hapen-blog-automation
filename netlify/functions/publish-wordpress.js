// netlify/functions/publish-wordpress.js
//
// ATENÇÃO — LEIA ANTES DE USAR
// O site da Hapen roda sobre a plataforma Rocket Imob, que expõe o wp-admin
// mas esconde recursos nativos (Plugins, Application Passwords). Por isso,
// em vez de usar a API REST do WordPress, esta função abre um navegador
// headless (Puppeteer), FAZ LOGIN COMO SE FOSSE VOCÊ e preenche a tela de
// "Adicionar novo post" manualmente, como um robô clicando na tela.
//
// Publica UM artigo por chamada (o front-end chama esta função 3 vezes, uma
// por artigo) — isso porque as "background functions" do Netlify não
// funcionaram nesse site, então cada chamada precisa terminar dentro do
// tempo normal de uma função.
//
// Usa Puppeteer (não Playwright) porque o pacote de Chromium para ambiente
// serverless (@sparticuz/chromium) é feito especificamente para Puppeteer —
// usar com Playwright causa erros de biblioteca faltando (libnspr4.so etc.).
//
// Isso é mais frágil que uma API: se a Rocket Imob mudar o layout do painel,
// os seletores abaixo (SELECTORS) provavelmente vão quebrar e vão precisar
// ser atualizados. A forma mais confiável de conseguir os seletores certos é
// abrir a página real no navegador, clicar com o botão direito nos campos
// (título, editor, botão de mídia, campos do Yoast) → Inspecionar, e conferir
// se o id/classe bate com o que está aqui embaixo.
//
// CREDENCIAIS: nunca coloque usuário/senha do WordPress neste arquivo.
// Configure como variáveis de ambiente no Netlify:
//   WP_ADMIN_URL   -> https://hapenimoveis.com.br/wp-admin
//   WP_USERNAME    -> fdtaborda
//   WP_PASSWORD    -> (a senha real, cadastrada só no painel do Netlify)

const chromium = require("@sparticuz/chromium-min");
const puppeteer = require("puppeteer-core");

// A versão "normal" de @sparticuz/chromium (binário incluso no pacote local)
// dava erro de biblioteca faltando (libnspr4.so) especificamente no ambiente
// do Netlify. A versão "-min" baixa, na primeira execução, um pacote completo
// e independente do Chromium de um link do GitHub — evita depender de
// bibliotecas do sistema operacional que o Netlify não tem instaladas.
const CHROMIUM_PACK_URL =
  "https://github.com/Sparticuz/chromium/releases/download/v123.0.1/chromium-v123.0.1-pack.tar";

const SELECTORS = {
  loginUser: "#user_login",
  loginPass: "#user_pass",
  loginSubmit: "#wp-submit",
  newPostUrl: "/wp-admin/post-new.php",
  titleField: "#title",
  textTabButton: "#content-html",
  contentTextarea: "#content",
  addMediaButton: ".insert-media, #insert-media-button",
  mediaFileInput: "input[type='file']",
  tagsInput: "#new-tag-post_tag",
  tagsAddButton: "#post_tag .tagadd",
  yoastSeoTitle: "input[placeholder*='SEO title'], input[aria-label*='SEO title']",
  yoastSlug: "input[name='slug'], #slug, input[placeholder*='Slug']",
  yoastMetaDescription: "textarea[placeholder*='Meta description'], textarea[aria-label*='Meta description']",
  yoastFocusKeyphrase: "input[placeholder*='Focus keyphrase'], input[aria-label*='Focus keyphrase']",
  saveDraftButton: "#save-post",
};

// Define o valor de um campo de forma compatível com componentes React (usado
// pelo Yoast) — assign direto (el.value = x) é ignorado pelo React se não usar
// o "setter" nativo do input antes de disparar o evento.
async function setFieldValue(page, selector, value) {
  await page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    },
    selector,
    value
  );
}

// Clica no primeiro elemento que bate com o seletor E contém o texto informado
// (Puppeteer não tem um ":has-text()" nativo como o Playwright).
async function clickByText(page, selector, text) {
  const handle = await page.evaluateHandle(
    (sel, txt) => {
      const els = Array.from(document.querySelectorAll(sel));
      return els.find((el) => el.textContent && el.textContent.trim().includes(txt)) || null;
    },
    selector,
    text
  );
  const el = handle.asElement();
  if (el) {
    await el.click();
    return true;
  }
  return false;
}

async function login(page, baseUrl) {
  await page.goto(`${baseUrl}/wp-login.php`, { waitUntil: "networkidle2" });
  await page.type(SELECTORS.loginUser, process.env.WP_USERNAME);
  await page.type(SELECTORS.loginPass, process.env.WP_PASSWORD);
  await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), page.click(SELECTORS.loginSubmit)]);
}

async function uploadFeaturedImage(page, imovel) {
  const fs = require("fs");
  const path = `/tmp/capa-${Date.now()}.jpg`;

  if (imovel.coverImageBase64) {
    fs.writeFileSync(path, Buffer.from(imovel.coverImageBase64, "base64"));
  } else if (imovel.gallery && imovel.gallery.length) {
    const response = await fetch(imovel.gallery[0]);
    fs.writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  } else {
    return;
  }

  await page.click(SELECTORS.addMediaButton);
  await clickByText(page, ".media-menu-item", "Enviar arquivos");
  await clickByText(page, ".media-menu-item", "Upload files");

  const fileInput = await page.waitForSelector(SELECTORS.mediaFileInput, { timeout: 8000 }).catch(() => null);
  if (fileInput) {
    await fileInput.uploadFile(path);
  }

  await new Promise((r) => setTimeout(r, 2500)); // aguarda o upload processar
  await clickByText(page, "button", "Definir imagem destacada");
  await clickByText(page, "button", "Set featured image");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  let article, imovel;
  try {
    ({ article, imovel } = JSON.parse(event.body || "{}"));
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Corpo da requisição inválido" }) };
  }

  if (!article || !article.title) {
    return { statusCode: 400, body: JSON.stringify({ error: "Artigo ausente" }) };
  }

  const baseUrl = (process.env.WP_ADMIN_URL || "").replace(/\/wp-admin\/?$/, "");
  let browser;

  try {
    browser = await puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(CHROMIUM_PACK_URL),
      headless: chromium.headless,
    });
    const page = await browser.newPage();

    await login(page, baseUrl);
    await page.goto(`${baseUrl}${SELECTORS.newPostUrl}`, { waitUntil: "networkidle2" });

    await setFieldValue(page, SELECTORS.titleField, article.title);

    await page.click(SELECTORS.textTabButton).catch(() => {});
    await setFieldValue(page, SELECTORS.contentTextarea, article.contentHtml);

    if ((imovel.gallery && imovel.gallery.length) || imovel.coverImageBase64) {
      await uploadFeaturedImage(page, imovel).catch((e) => {
        console.error("Falha ao definir imagem destacada:", e.message);
      });
    }

    if (imovel.suggestedCategory) {
      await clickByText(page, "label", imovel.suggestedCategory).catch(() => {});
    }

    if (imovel.tags && imovel.tags.length) {
      await setFieldValue(page, SELECTORS.tagsInput, imovel.tags.join(", ")).catch(() => {});
      await page.click(SELECTORS.tagsAddButton).catch(() => {});
    }

    await setFieldValue(page, SELECTORS.yoastSeoTitle, article.seoTitle || "").catch(() => {});
    await setFieldValue(page, SELECTORS.yoastSlug, article.slug || "").catch(() => {});
    await setFieldValue(page, SELECTORS.yoastMetaDescription, article.metaDescription || "").catch(() => {});
    await setFieldValue(page, SELECTORS.yoastFocusKeyphrase, article.focusKeyphrase || "").catch(() => {});

    // IMPORTANTE: sempre salva como rascunho, nunca publica direto.
    await Promise.all([page.waitForNavigation({ waitUntil: "networkidle2" }), page.click(SELECTORS.saveDraftButton)]);

    const draftUrl = page.url();
    await browser.close();

    return { statusCode: 200, body: JSON.stringify({ status: "ok", draftUrl }) };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    return { statusCode: 500, body: JSON.stringify({ status: "erro", error: err.message }) };
  }
};
