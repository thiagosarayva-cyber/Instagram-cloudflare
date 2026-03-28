export async function onRequestPost(context) {
  const { senha } = await context.request.json();
  const senhaCorreta = context.env.ADMIN_SENHA;

  if (!senhaCorreta) {
    return new Response(JSON.stringify({ ok: false, erro: 'Não configurado' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }

  if (senha === senhaCorreta) {
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ ok: false }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  });
}
