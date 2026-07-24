// netlify/functions/publish-wordpress.js
//
// ATENÇÃO — LEIA ANTES DE USAR
// O site da Hapen roda sobre a plataforma Rocket Imob, que expõe o wp-admin
// mas esconde recursos nativos (Plugins, Application Passwords). Por isso,
// em vez de usar a API REST do WordPress, esta função abre um navegador
// headless (Playwright), FAZ LOGIN COMO SE FOSSE VOCÊ e preenche a tela de
// "Adicionar novo post" manualmente, como um robô clicando na tela.
//
// Publica UM artigo por chamada (o front-end chama esta função 3 vezes, uma
// por artigo) — isso porque as "background functions" do Netlify não
// funcionaram nesse site, então cada chamada precisa terminar dentro do
// tempo normal de uma função (por isso login + 1 post, não login + 3 posts).
//
// Isso é mais frágil que uma API: se a Rocket Imob mudar o layout do painel,
// os seletores abaixo (SELECTORS) provavelmente vão quebrar e vão precisar
// ser atualizados. A forma mais rápida de conseguir os seletores certos é
// rodar isso localmente uma vez com o Playwright Codegen, que grava os
// cliques que você faz e gera o código pronto:
//
//   npx playwright codegen https://hapenimoveis.com.br/wp-login.php
//
// Faça login manualmente na janela que abrir, clique em "Adicionar novo post",
// preencha um post de teste e copie os seletores que o Codegen gerar para
// dentro do objeto SELECTORS abaixo.
//
// CREDENCIAIS: nunca coloque usuário/senha do WordPress neste arquivo.
// Configure como variáveis de ambiente no Netlify:
//   WP_ADMIN_URL   -> https://hapenimoveis.com.br/wp-admin
//   WP_USERNAME    -> fdtaborda
//   WP_PASSWORD    -> (a senha real, cadastrada só no painel do Netlify)

const chromium = require("@sparticuz/chromium");
const playwright = require("playwright-core");

const SELECTORS = {
  loginUser: "#user_login",
  loginPass: "#user_pass",
  loginSubmit: "#wp-submit",
  newPostUrl: "/wp-admin/post-new.php",
  titleField: "#title",
  textTabButton: "#content-html",
  contentTextarea: "#content",
  addMediaButton: ".insert-media, #insert-media-button",
  mediaModalUploadTab: ".media-menu-item:has-text('Enviar arquivos'), .media-menu-item:has-text('Upload files')",
  mediaFileInput: "input[type='file']",
  mediaSetFeaturedButton: "button:has-text('Definir imagem destacada'), button:has-text('Set featured image')",
  categoryCheckboxByLabel: (label) => `label:has-text('${label}') input[type='checkbox']`,
  tagsInput: "#new-tag-post_tag",
  tagsAddButton: "#post_tag .tagadd",
  yoastSeoTitle: "input[placeholder*='SEO title'], input[aria-label*='SEO title']",
  yoastSlug: "input[name='slug'], #slug, input[placeholder*='Slug']",
  yoastMetaDescription: "textarea[placeholder*='Meta description'], textarea[aria-label*='Meta description']",
  yoastFocusKeyphrase: "input[placeholder*='Focus keyphrase'], input[aria-label*='Focus keyphrase']",
  saveDraftButton: "#save-post",
};

async function login(page, baseUrl) {
  await page.goto(`${baseUrl}/wp-login.php`, { waitUntil: "networkidle" });
  await page.fill(SELECTORS.loginUser, process.env.WP_USERNAME);
  await page.fill(SELECTORS.loginPass, process.env.WP_PASSWORD);
  await page.click(SELECTORS.loginSubmit);
  await page.waitForLoadState("networkidle");
}

async function uploadFeaturedImage(page, imovel) {
  const fs = require("fs");
  const fileName = "capa-" + Date.now() + ".jpg";
  const path = `/tmp/${fileName}`;

  if (imovel.coverImageBase64) {
    fs.writeFileSync(path, Buffer.from(imovel.coverImageBase64, "base64"));
  } else if (imovel.gallery && imovel.gallery.length) {
    const response = await fetch(imovel.gallery[0]);
    fs.writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  } else {
    return;
  }

  await page.click(SELECTORS.addMediaButton);
  await page.waitForSelector(SELECTORS.mediaModalUploadTab, { timeout: 8000 }).catch(() => {});
  await page.click(SELECTORS.mediaModalUploadTab).catch(() => {});

  const fileChooserPromise = page.waitForEvent("filechooser").catch(() => null);
  await page.click(SELECTORS.mediaFileInput).catch(() => {});
  const fileChooser = await fileChooserPromise;
  if (fileChooser) {
    await fileChooser.setFiles(path);
  }

  await page.waitForTimeout(2500);
  await page.click(SELECTORS.mediaSetFeaturedButton);
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
    browser = await playwright.chromium.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    });
    const context = await browser.newContext();
    const page = await context.newPage();

    await login(page, baseUrl);
    await page.goto(`${baseUrl}${SELECTORS.newPostUrl}`, { waitUntil: "networkidle" });

    await page.fill(SELECTORS.titleField, article.title);
    await page.click(SELECTORS.textTabButton).catch(() => {});
    await page.fill(SELECTORS.contentTextarea, article.contentHtml);

    if ((imovel.gallery && imovel.gallery.length) || imovel.coverImageBase64) {
      await uploadFeaturedImage(page, imovel).catch((e) => {
        console.error("Falha ao definir imagem destacada:", e.message);
      });
    }

    if (imovel.suggestedCategory) {
      await page.click(SELECTORS.categoryCheckboxByLabel(imovel.suggestedCategory)).catch(() => {});
    }

    if (imovel.tags && imovel.tags.length) {
      await page.fill(SELECTORS.tagsInput, imovel.tags.join(", ")).catch(() => {});
      await page.click(SELECTORS.tagsAddButton).catch(() => {});
    }

    await page.fill(SELECTORS.yoastSeoTitle, article.seoTitle || "").catch(() => {});
    await page.fill(SELECTORS.yoastSlug, article.slug || "").catch(() => {});
    await page.fill(SELECTORS.yoastMetaDescription, article.metaDescription || "").catch(() => {});
    await page.fill(SELECTORS.yoastFocusKeyphrase, article.focusKeyphrase || "").catch(() => {});

    // IMPORTANTE: sempre salva como rascunho, nunca publica direto.
    await page.click(SELECTORS.saveDraftButton);
    await page.waitForLoadState("networkidle");

    const draftUrl = page.url();
    await browser.close();

    return { statusCode: 200, body: JSON.stringify({ status: "ok", draftUrl }) };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    return { statusCode: 500, body: JSON.stringify({ status: "erro", error: err.message }) };
  }
};
