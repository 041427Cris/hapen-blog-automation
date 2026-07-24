// netlify/functions/start-generate.js
//
// Dispara a geração dos 3 artigos em segundo plano (generate-articles-background)
// e devolve um jobId para o front-end consultar o andamento em check-status.js.

const { getJobStore } = require("./lib/blob-store");

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const jobId = `gen-${Date.now()}`;
  const store = getJobStore();
  await store.setJSON(jobId, { done: false, startedAt: new Date().toISOString() });

  const siteUrl = process.env.URL || `https://${event.headers.host}`;
  const targetUrl = `${siteUrl}/.netlify/functions/generate-articles-background`;
  console.log("Disparando background function em:", targetUrl);

  try {
    const triggerRes = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobId, ...JSON.parse(event.body || "{}") }),
    });
    console.log("Resposta do disparo:", triggerRes.status, await triggerRes.text().catch(() => ""));
  } catch (err) {
    console.error("Falha ao disparar background function:", err.message);
    return { statusCode: 500, body: JSON.stringify({ error: "Falha ao disparar geração: " + err.message }) };
  }

  return { statusCode: 200, body: JSON.stringify({ jobId }) };
};
