// netlify/functions/lib/blob-store.js
//
// Em alguns sites o Netlify não injeta automaticamente as credenciais do
// Netlify Blobs nas funções (erro "MissingBlobsEnvironmentError"). Este
// helper contorna isso configurando manualmente com o Site ID e um Token
// de acesso, guardados como variáveis de ambiente.
//
// Como conseguir os dois valores:
//   NETLIFY_SITE_ID    -> Site configuration → General → Site details → Site ID
//   NETLIFY_BLOBS_TOKEN -> User settings (ícone do seu usuário) → Applications
//                          → Personal access tokens → New access token

const { getStore } = require("@netlify/blobs");

function getJobStore() {
  const siteID = process.env.NETLIFY_SITE_ID;
  const token = process.env.NETLIFY_BLOBS_TOKEN;

  if (siteID && token) {
    return getStore({ name: "blog-automation-jobs", siteID, token });
  }
  // Tenta o modo automático (funciona em alguns sites/planos sem precisar das duas variáveis acima)
  return getStore("blog-automation-jobs");
}

module.exports = { getJobStore };
