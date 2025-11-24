document.getElementById('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorDiv = document.getElementById('error');
    
    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            if (data.role === 'admin') {
                window.location.href = '/admin.html';
            } else {
                window.location.href = '/dashboard.html';
            }
        } else {
            errorDiv.textContent = data.error || 'Login failed';
        }
    } catch (error) {
        errorDiv.textContent = 'Connection error';
    }
});
