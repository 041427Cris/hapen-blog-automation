// netlify/functions/publish-wordpress-background.js
//
// ATENÇÃO — LEIA ANTES DE USAR
// O site da Hapen roda sobre a plataforma Rocket Imob, que expõe o wp-admin
// mas esconde recursos nativos (Plugins, Application Passwords). Por isso,
// em vez de usar a API REST do WordPress, esta função abre um navegador
// headless (Playwright), FAZ LOGIN COMO SE FOSSE VOCÊ e preenche a tela de
// "Adicionar novo post" manualmente, como um robô clicando na tela.
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
const { getStore } = require("@netlify/blobs");

const SELECTORS = {
  loginUser: "#user_login",
  loginPass: "#user_pass",
  loginSubmit: "#wp-submit",
  newPostUrl: "/wp-admin/post-new.php",
  titleField: "#title",
  // O editor clássico tem duas abas: "Visual" e "Texto". A aba "Texto" é um
  // <textarea> simples, muito mais fácil de preencher via automação do que
  // o iframe do TinyMCE (aba "Visual").
  textTabButton: "#content-html",
  contentTextarea: "#content",
  addMediaButton: ".insert-media, #insert-media-button",
  mediaModalUploadTab: ".media-menu-item:has-text('Enviar arquivos'), .media-menu-item:has-text('Upload files')",
  mediaFileInput: "input[type='file']",
  mediaSetFeaturedButton: "button:has-text('Definir imagem destacada'), button:has-text('Set featured image')",
  categoryCheckboxByLabel: (label) => `label:has-text('${label}') input[type='checkbox']`,
  tagsInput: "#new-tag-post_tag",
  tagsAddButton: "#post_tag .tagadd",
  // Campos do Yoast — se o Yoast estiver na versão nova (React), estes
  // seletores por placeholder tendem a ser mais estáveis que ids internos.
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
  // Prioridade: imagem enviada manualmente (base64) > primeira foto da galeria extraída do link.
  const fs = require("fs");
  const fileName = "capa-" + Date.now() + ".jpg";
  const path = `/tmp/${fileName}`;

  if (imovel.coverImageBase64) {
    fs.writeFileSync(path, Buffer.from(imovel.coverImageBase64, "base64"));
  } else if (imovel.gallery && imovel.gallery.length) {
    const response = await fetch(imovel.gallery[0]);
    fs.writeFileSync(path, Buffer.from(await response.arrayBuffer()));
  } else {
    return; // sem imagem disponível, segue sem definir capa
  }

  await page.click(SELECTORS.addMediaButton);
  await page.waitForSelector(SELECTORS.mediaModalUploadTab, { timeout: 10000 }).catch(() => {});
  await page.click(SELECTORS.mediaModalUploadTab).catch(() => {});

  const fileChooserPromise = page.waitForEvent("filechooser").catch(() => null);
  await page.click(SELECTORS.mediaFileInput).catch(() => {});
  const fileChooser = await fileChooserPromise;
  if (fileChooser) {
    await fileChooser.setFiles(path);
  }

  await page.waitForTimeout(3000); // aguarda o upload processar
  await page.click(SELECTORS.mediaSetFeaturedButton);
}

async function publishOne(page, baseUrl, article, imovel) {
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

  // Campos de SEO (Yoast) — ficam num painel que às vezes exige scroll/clique
  // para abrir. Ajuste se a automação não encontrar os campos.
  await page.fill(SELECTORS.yoastSeoTitle, article.seoTitle).catch(() => {});
  await page.fill(SELECTORS.yoastSlug, article.slug).catch(() => {});
  await page.fill(SELECTORS.yoastMetaDescription, article.metaDescription).catch(() => {});
  await page.fill(SELECTORS.yoastFocusKeyphrase, article.focusKeyphrase).catch(() => {});

  // IMPORTANTE: sempre salva como rascunho, nunca publica direto.
  await page.click(SELECTORS.saveDraftButton);
  await page.waitForLoadState("networkidle");

  return page.url();
}

exports.handler = async (event) => {
  const { jobId, articles, imovel } = JSON.parse(event.body || "{}");
  const store = getStore("blog-automation-jobs");

  const baseUrl = (process.env.WP_ADMIN_URL || "").replace(/\/wp-admin\/?$/, "");
  const results = [];

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

    for (const article of articles) {
      try {
        const draftUrl = await publishOne(page, baseUrl, article, imovel);
        results.push({ angle: article.angleLabel, status: "ok", draftUrl });
      } catch (err) {
        results.push({ angle: article.angleLabel, status: "erro", error: err.message });
      }
    }
  } catch (err) {
    results.push({ status: "erro_geral", error: err.message });
  } finally {
    if (browser) await browser.close();
  }

  await store.setJSON(jobId, { done: true, results, finishedAt: new Date().toISOString() });
};
