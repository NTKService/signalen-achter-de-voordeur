// Eenvoudige webserver voor het prototype "Signalen achter de voordeur".
// Er worden geen gegevens ontvangen of opgeslagen: het formulier werkt alleen in de browser.
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const page = fs.readFileSync(path.join(__dirname, 'public', 'index.html'));

http.createServer((req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(page);
}).listen(PORT, () => console.log('Prototype draait op poort ' + PORT));
