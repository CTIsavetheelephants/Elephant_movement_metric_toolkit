// Tiny static server for testing the built page in a browser during development:
//   node serve.js [port]   -> http://localhost:8765/
// (Partners never need this: they use the GitHub Pages link or a saved copy.)
const http = require("http");
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..", "docs");
const port = +process.argv[2] || 8765;
const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json" };
http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html");
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end("not found"); }
  res.writeHead(200, { "Content-Type": TYPES[path.extname(p)] || "application/octet-stream", "Access-Control-Allow-Origin": "*" });
  fs.createReadStream(p).pipe(res);
}).listen(port, () => console.log(`calculator at http://localhost:${port}/`));
