const http = require("http");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..", "site");
const mime = { ".html":"text/html; charset=utf-8", ".js":"application/javascript; charset=utf-8", ".css":"text/css; charset=utf-8", ".json":"application/json; charset=utf-8", ".png":"image/png", ".jpg":"image/jpeg", ".svg":"image/svg+xml" };
http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/") url = "/index.html";
  const file = path.join(root, url);
  if (!file.startsWith(root)) { res.writeHead(403); return res.end("forbidden"); }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("not found " + url); }
    res.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
    res.end(buf);
  });
}).listen(5173, "127.0.0.1", () => console.log("serving site on http://127.0.0.1:5173"));
