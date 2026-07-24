// netlify/functions/check-status.js
// Consulta o andamento de um job de publicação criado por start-publish.js.

const { getJobStore } = require("./lib/blob-store");

exports.handler = async (event) => {
  const jobId = event.queryStringParameters?.jobId;
  if (!jobId) {
    return { statusCode: 400, body: JSON.stringify({ error: "jobId ausente" }) };
  }

  const store = getJobStore();
  const job = await store.get(jobId, { type: "json" });

  if (!job) {
    return { statusCode: 404, body: JSON.stringify({ error: "job não encontrado" }) };
  }

  return { statusCode: 200, body: JSON.stringify(job) };
};
