import { Readable } from 'stream';

export default async function handler(req, res) {
  try {
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const url = new URL(req.url, `${protocol}://${host}`);
    
    const requestOptions = {
      method: req.method,
      headers: req.headers,
    };
    
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      requestOptions.body = Readable.toWeb(req);
      requestOptions.duplex = 'half';
    }
    
    const webRequest = new Request(url.toString(), requestOptions);
    
    // Dynamically import the TanStack Start server handler
    const serverModule = await import('../dist/server/server.js');
    const fetchHandler = serverModule.default.fetch;
    
    // Execute handler
    const webResponse = await fetchHandler(webRequest, process.env, {});
    
    // Stream response back to Vercel Node res
    res.statusCode = webResponse.status;
    webResponse.headers.forEach((value, key) => {
      res.setHeader(key, value);
    });
    
    if (webResponse.body) {
      const reader = webResponse.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(value);
      }
    }
    res.end();
  } catch (error) {
    console.error(error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: String(error), stack: error?.stack }));
  }
}
