# Player Management Website

## VPS Deployment

### 1. Upload files to VPS
```bash
scp -r * user@your-vps-ip:/path/to/website
```

### 2. On your VPS, install dependencies
```bash
cd /path/to/website
npm install
```

### 3. Run the server
```bash
npm start
```

Server will run on port 3000 by default.

### 4. Keep it running (using PM2)
```bash
npm install -g pm2
pm2 start server.js --name player-website
pm2 save
pm2 startup
```

### 5. Configure firewall
```bash
# Allow port 3000
sudo ufw allow 3000
```

Access at: `http://your-vps-ip:3000`

### Using a domain with Nginx (optional)
```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```
