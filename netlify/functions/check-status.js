// netlify/functions/check-status.js
// Consulta o andamento de um job (geração de artigos ou publicação no WordPress).
// Se o job ainda não tiver nenhum registro (a função em segundo plano ainda não
// rodou a primeira escrita), devolve done:false em vez de erro, pra não travar
// o front-end enquanto ele fica tentando de novo a cada poucos segundos.

const { getJobStore } = require("./lib/blob-store");

exports.handler = async (event) => {
  const jobId = event.queryStringParameters?.jobId;
  if (!jobId) {
    return { statusCode: 400, body: JSON.stringify({ error: "jobId ausente" }) };
  }

  const store = getJobStore();
  const job = await store.get(jobId, { type: "json" }).catch(() => null);

  if (!job) {
    return { statusCode: 200, body: JSON.stringify({ done: false, pending: true }) };
  }

  return { statusCode: 200, body: JSON.stringify(job) };
};
