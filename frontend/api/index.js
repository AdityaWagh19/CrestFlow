import server from '../dist/server/server.js';

export const config = {
  runtime: 'edge',
};

export default async function handler(request, context) {
  return server.fetch(request, process.env, context);
}
