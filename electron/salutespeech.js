const https = require('https');
const crypto = require('crypto');

const tlsAgent = new https.Agent({ rejectUnauthorized: false });

let _token = null;
let _tokenExpiry = 0;

function getToken(authKey) {
  if (_token && Date.now() < _tokenExpiry - 30000) return Promise.resolve(_token);

  const body = 'scope=SALUTE_SPEECH_PERS';
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'ngw.devices.sberbank.ru',
        port: 9443,
        path: '/api/v2/oauth',
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
          'RqUID': crypto.randomUUID(),
          'Authorization': `Basic ${authKey}`,
          'Content-Length': Buffer.byteLength(body),
        },
        agent: tlsAgent,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString();
          if (res.statusCode !== 200) {
            reject(new Error(`SaluteSpeech авторизация (${res.statusCode}): ${data}`));
            return;
          }
          try {
            const json = JSON.parse(data);
            _token = json.access_token;
            _tokenExpiry = json.expires_at || Date.now() + 1800000;
            resolve(_token);
          } catch (e) { reject(e); }
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function recognize(authKey, pcmBuffer, lang) {
  const token = await getToken(authKey);
  const language = (lang || 'ru-RU').split(' ')[0];

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'smartspeech.sber.ru',
        path: `/rest/v1/speech:recognize?language=${encodeURIComponent(language)}`,
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'audio/x-pcm;bit=16;rate=16000',
          'Content-Length': pcmBuffer.length,
        },
        agent: tlsAgent,
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString();
          if (res.statusCode !== 200) {
            reject(new Error(`SaluteSpeech (${res.statusCode}): ${data}`));
            return;
          }
          try {
            const json = JSON.parse(data);
            const text = (json.result || []).join(' ').trim();
            resolve(text);
          } catch (e) { reject(e); }
        });
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.write(pcmBuffer);
    req.end();
  });
}

function resetToken() {
  _token = null;
  _tokenExpiry = 0;
}

module.exports = { recognize, resetToken };
