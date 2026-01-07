const http = require('http');

const PLUGIN_IP = '143.20.122.58';
const PLUGIN_PORT = 50497;

console.log(`Testing ${PLUGIN_IP}:${PLUGIN_PORT}/action`);

const postData = 'playerName=TestPlayer&streamer=TestStreamer&action=add';

const options = {
    hostname: PLUGIN_IP,
    port: PLUGIN_PORT,
    path: '/action',
    method: 'POST',
    headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData)
    },
    timeout: 5000
};

const req = http.request(options, (res) => {
    console.log(`✓ Status: ${res.statusCode}`);
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
        console.log('Response:', body);
    });
});

req.on('error', (e) => {
    console.error(`✗ Error: ${e.message}`);
});

req.on('timeout', () => {
    console.error('✗ Timeout');
    req.destroy();
});

req.write(postData);
req.end();
