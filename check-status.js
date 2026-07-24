// netlify/functions/start-generate.js
//
// Dispara a geração dos 3 artigos em segundo plano (generate-articles-background)
// e devolve um jobId para o front-end consultar o andamento em check-status.js.

const { getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const jobId = `gen-${Date.now()}`;
  const store = getStore("blog-automation-jobs");
  await store.setJSON(jobId, { done: false, startedAt: new Date().toISOString() });

  const siteUrl = process.env.URL || `https://${event.headers.host}`;
  await fetch(`${siteUrl}/.netlify/functions/generate-articles-background`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jobId, ...JSON.parse(event.body || "{}") }),
  });

  return { statusCode: 200, body: JSON.stringify({ jobId }) };
};
