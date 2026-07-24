// netlify/functions/start-publish.js
//
// Como a publicação usa um navegador headless e pode levar mais de 10 segundos
// (login + 3 posts + upload de imagem), ela roda como "background function"
// (publish-wordpress-background), que não devolve resposta na hora. Esta
// função cria um jobId, dispara o processo em segundo plano e devolve o
// jobId pro front-end poder consultar o andamento em check-status.js.

const { getJobStore } = require("./lib/blob-store");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const jobId = `job-${Date.now()}`;
  const store = getJobStore();
  await store.setJSON(jobId, { done: false, startedAt: new Date().toISOString() });

  const siteUrl = process.env.URL || `https://${event.headers.host}`;
  await fetch(`${siteUrl}/.netlify/functions/publish-wordpress-background`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, ...JSON.parse(event.body || "{}") }),
  });

  return { statusCode: 200, body: JSON.stringify({ jobId }) };
};
