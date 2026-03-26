export async function onRequest(context) {
  const { request } = context;

  // Libera CORS
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "*"
      }
    });
  }

  try {
    const response = await fetch("https://api.mercadopago.com", {
      method: request.method,
      headers: {
        "Authorization": request.headers.get("Authorization"),
        "Content-Type": "application/json"
      },
      body: request.method !== "GET" ? await request.text() : undefined
    });

    const data = await response.text();

    return new Response(data, {
      status: response.status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    });

  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500
    });
  }
}
