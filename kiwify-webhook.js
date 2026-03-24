export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('OK', { status: 200 });
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    // Verifica token de segurança
    const url = new URL(request.url);
    const token = url.searchParams.get('token');
    if (env.KIWIFY_TOKEN && token !== env.KIWIFY_TOKEN) {
      return new Response('Unauthorized', { status: 401 });
    }

    // Verifica se pagamento foi aprovado
    const status = payload?.order_status || payload?.status;
    const aprovado = status === 'paid' || status === 'approved' || status === 'complete';
    if (!aprovado) {
      return new Response(JSON.stringify({ ok: true, msg: 'Ignorado: ' + status }), { status: 200 });
    }

    // Dados do comprador
    const nomeCliente = payload?.Customer?.full_name || payload?.customer?.name || 'Cliente';
    const email       = payload?.Customer?.email     || payload?.customer?.email;
    const whatsapp    = payload?.Customer?.mobile    || payload?.customer?.mobile || '';
    const plano       = payload?.Product?.name       || payload?.product?.name   || 'Profissional';
    const valor       = payload?.order_value ? String(payload.order_value / 100) : '';

    if (!email) {
      return new Response('Email não encontrado', { status: 400 });
    }

    const FIREBASE_URL = `https://firestore.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_ID}/databases/(default)/documents`;

    // Gera token Firebase
    async function getFirebaseToken() {
      const now = Math.floor(Date.now() / 1000);
      const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const payload_jwt = btoa(JSON.stringify({
        iss: env.FIREBASE_CLIENT_EMAIL,
        sub: env.FIREBASE_CLIENT_EMAIL,
        aud: 'https://oauth2.googleapis.com/token',
        iat: now,
        exp: now + 3600,
        scope: 'https://www.googleapis.com/auth/datastore',
      }));
      const privateKey = env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n');
      const keyData = privateKey.replace('-----BEGIN PRIVATE KEY-----', '').replace('-----END PRIVATE KEY-----', '').replace(/\s/g, '');
      const binaryKey = Uint8Array.from(atob(keyData), c => c.charCodeAt(0));
      const cryptoKey = await crypto.subtle.importKey('pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
      const signingInput = `${header}.${payload_jwt}`;
      const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(signingInput));
      const jwt = `${signingInput}.${btoa(String.fromCharCode(...new Uint8Array(signature)))}`;
      const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
      });
      const tokenData = await tokenRes.json();
      return tokenData.access_token;
    }

    try {
      const token_fb = await getFirebaseToken();

      // Verifica se cliente já existe
      const checkRes = await fetch(
        `${FIREBASE_URL}/clientes?pageSize=1&orderBy=email&transaction=&where.fieldFilter.field.fieldPath=email&where.fieldFilter.op=EQUAL&where.fieldFilter.value.stringValue=${encodeURIComponent(email)}`,
        { headers: { Authorization: `Bearer ${token_fb}` } }
      );
      const checkData = await checkRes.json();
      if (checkData.documents?.length > 0) {
        return new Response(JSON.stringify({ ok: true, msg: 'Cliente já existe' }), { status: 200 });
      }

      // Gera código único
      const letra = String.fromCharCode(65 + Math.floor(Math.random() * 26));
      const nums = Math.floor(1000000 + Math.random() * 9000000).toString();
      const codigo = letra + nums;

      // Data de expiração (30 dias)
      const expiraEm = new Date();
      expiraEm.setDate(expiraEm.getDate() + 30);

      // Salva no Firebase
      await fetch(`${FIREBASE_URL}/clientes/${codigo}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token_fb}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fields: {
            nome:      { stringValue: nomeCliente },
            email:     { stringValue: email },
            whatsapp:  { stringValue: whatsapp },
            plano:     { stringValue: plano },
            valor:     { stringValue: valor },
            pagamento: { stringValue: 'Kiwify' },
            empresa:   { stringValue: '' },
            obs:       { stringValue: 'Gerado via Kiwify' },
            dias:      { integerValue: 30 },
            bloqueado: { booleanValue: false },
            expiraEm:  { timestampValue: expiraEm.toISOString() },
          }
        }),
      });

      // Envia e-mail via Resend
      const appUrl = env.APP_URL || 'https://instagram-cloudflare.princexxxusa.workers.dev';
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'Gerador de Posts <onboarding@resend.dev>',
          to: [email],
          subject: `🎉 Seu código de acesso: ${codigo}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:32px">
            <h1 style="color:#00e5a0">Gerador de Posts 📸</h1>
            <p>Olá, <b>${nomeCliente}</b>! Seu acesso está pronto!</p>
            <div style="background:#f5f5f5;border-radius:12px;padding:20px;text-align:center;margin:20px 0">
              <p style="color:#666;font-size:12px;margin:0">SEU CÓDIGO DE ACESSO</p>
              <div style="font-size:32px;font-weight:900;color:#00e5a0;letter-spacing:4px">${codigo}</div>
              <p style="color:#666;font-size:12px">Válido até ${expiraEm.toLocaleDateString('pt-BR')}</p>
            </div>
            <a href="${appUrl}" style="display:block;background:#00e5a0;color:#000;text-decoration:none;text-align:center;padding:14px;border-radius:10px;font-weight:800">Acessar o App</a>
          </div>`,
        }),
      });

      return new Response(JSON.stringify({ ok: true, codigo, email }), { status: 200 });

    } catch (err) {
      return new Response('Erro: ' + err.message, { status: 500 });
    }
  }
};
