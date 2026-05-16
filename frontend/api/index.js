export default async function handler(request, context) {
  try {
    const server = (await import('../dist/server/server.js')).default;
    return await server.fetch(request, process.env, context);
  } catch (error) {
    return new Response(JSON.stringify({
      error: error.message || String(error),
      stack: error.stack,
      name: error.name
    }), {
      status: 500,
      headers: { 'content-type': 'application/json' }
    });
  }
}
