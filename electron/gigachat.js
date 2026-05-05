const https = require('https');
const crypto = require('crypto');

// GigaChat использует самоподписанный сертификат — отключаем проверку только для их хостов
const tlsAgent = new https.Agent({ rejectUnauthorized: false });

let _token = null;
let _tokenExpiry = 0;

function httpsPost(hostname, port, path, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { hostname, port, path, method: 'POST', headers, agent: tlsAgent },
      (res) => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getToken(authKey) {
  if (_token && Date.now() < _tokenExpiry - 30000) return _token;

  const body = 'scope=GIGACHAT_API_PERS';
  const { status, body: data } = await httpsPost(
    'ngw.devices.sberbank.ru', 9443, '/api/v2/oauth',
    {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
      'RqUID': crypto.randomUUID(),
      'Authorization': `Basic ${authKey}`,
      'Content-Length': Buffer.byteLength(body),
    },
    body
  );

  if (status !== 200) throw new Error(`Ошибка авторизации GigaChat (${status}): ${data}`);

  const json = JSON.parse(data);
  _token = json.access_token;
  _tokenExpiry = json.expires_at || (Date.now() + 1800000);
  return _token;
}

function streamChat(authKey, messages, model, onChunk, onDone, onError) {
  getToken(authKey)
    .then(token => {
      const body = JSON.stringify({
        model: model || 'GigaChat',
        messages,
        stream: true,
        max_tokens: 1024,
        temperature: 0.7,
      });

      let buffer = '';
      let finished = false;

      const done = () => {
        if (!finished) { finished = true; onDone(); }
      };

      const req = https.request(
        {
          hostname: 'gigachat.devices.sberbank.ru',
          path: '/api/v1/chat/completions',
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
            'Content-Length': Buffer.byteLength(body),
          },
          agent: tlsAgent,
        },
        (res) => {
          if (res.statusCode !== 200) {
            const errChunks = [];
            res.on('data', c => errChunks.push(c));
            res.on('end', () => onError(new Error(`GigaChat ${res.statusCode}: ${Buffer.concat(errChunks)}`)));
            return;
          }

          res.on('data', (chunk) => {
            buffer += chunk.toString();
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (!line.startsWith('data: ')) continue;
              const jsonStr = line.slice(6).trim();
              if (jsonStr === '[DONE]') { done(); return; }
              try {
                const parsed = JSON.parse(jsonStr);
                const choice = parsed.choices?.[0];
                if (choice?.finish_reason === 'stop') { done(); return; }
                const text = choice?.delta?.content;
                if (text) onChunk(text);
              } catch {}
            }
          });

          res.on('end', done);
          res.on('error', onError);
        }
      );

      req.on('error', onError);
      req.write(body);
      req.end();
    })
    .catch(onError);
}

function resetToken() {
  _token = null;
  _tokenExpiry = 0;
}

module.exports = { streamChat, resetToken };
