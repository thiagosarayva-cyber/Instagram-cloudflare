// ═══════════════════════════════════════════════════════
// CLOUDFLARE WORKER — Proxy Mercado Pago
// Instruções:
// 1. Acesse dash.cloudflare.com → Workers & Pages → Create Worker
// 2. Cole este código inteiro
// 3. Clique em "Deploy"
// 4. Copie a URL do worker (ex: mp-proxy.seusite.workers.dev)
// 5. No painel admin → ⚙️ Config → cole essa URL no campo "URL do Worker"
// ═══════════════════════════════════════════════════════

const MP_API = 'https://api.mercadopago.com';

// Domínios permitidos (adicione o seu site aqui)
const ALLOWED_ORIGINS = [
  'https://princexxxusa.workers.dev',
  'https://princexxxusa.pages.dev',
  'http://localhost',
  'null', // arquivo local para testes
];

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // Verificar origem permitida
    const allowed = ALLOWED_ORIGINS.some(o => origin.startsWith(o)) || origin === '';

    // Headers CORS
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowed ? (origin || '*') : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Idempotency-Key',
      'Access-Control-Max-Age': '86400',
    };

    // Responder preflight OPTIONS
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);

    // Rota de health check
    if (url.pathname === '/' || url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', worker: 'mp-proxy' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Extrair token do header Authorization
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Authorization header obrigatório' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Montar URL da API do MP
    // Ex: /mp/v1/payments → https://api.mercadopago.com/v1/payments
    const mpPath = url.pathname.replace(/^\/mp/, '');
    if (!mpPath || mpPath === '/') {
      return new Response(JSON.stringify({ error: 'Rota inválida' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const mpUrl = MP_API + mpPath + url.search;

    // Montar headers para o MP
    const mpHeaders = {
      'Content-Type': 'application/json',
      'Authorization': authHeader,
    };

    const idempotency = request.headers.get('X-Idempotency-Key');
    if (idempotency) mpHeaders['X-Idempotency-Key'] = idempotency;

    // Fazer requisição para o MP
    try {
      const body = request.method !== 'GET' && request.method !== 'HEAD'
        ? await request.text()
        : undefined;

      const mpResponse = await fetch(mpUrl, {
        method: request.method,
        headers: mpHeaders,
        body: body || undefined,
      });

      const responseBody = await mpResponse.text();

      return new Response(responseBody, {
        status: mpResponse.status,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
  },
};
