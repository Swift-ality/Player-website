const http = require('http');

// Change these to your Minecraft server details
const PLUGIN_IP = '127.0.0.1';  // Change to your Minecraft server IP
const PLUGIN_PORT = 8123;       // Change to your plugin port
const AUTH_TOKEN = '';          // Change to your auth token if needed

console.log(`Testing connection to ${PLUGIN_IP}:${PLUGIN_PORT}...`);

const postData = `playerName=TestPlayer&streamer=TestStreamer&action=add${AUTH_TOKEN ? '&token=' + AUTH_TOKEN : ''}`;

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

console.log('Request options:', options);
console.log('POST data:', postData);
console.log('');

const req = http.request(options, (res) => {
    console.log(`✓ Connected! Status: ${res.statusCode}`);
    let body = '';
    res.on('data', (chunk) => {
        body += chunk;
    });
    res.on('end', () => {
        console.log('Response:', body);
    });
});

req.on('error', (e) => {
    console.error(`✗ Connection failed: ${e.message}`);
    console.error('');
    console.error('Possible issues:');
    console.error('  - Minecraft server is not running');
    console.error('  - Plugin is not loaded');
    console.error('  - Wrong IP or port');
    console.error('  - Firewall is blocking the connection');
    console.error('  - Port is not forwarded (if remote server)');
});

req.on('timeout', () => {
    console.error('✗ Connection timed out');
    req.destroy();
});

req.write(postData);
req.end();
