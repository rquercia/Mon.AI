const fs = require('fs');
const files = ['frontend/src/App.jsx', 'frontend/src/components/EspinografiaSidebar.jsx', 'frontend/src/components/Viewer.jsx'];

files.forEach(f => {
    if (!fs.existsSync(f)) return;
    let content = fs.readFileSync(f, 'utf8');
    
    // 1. First, make sure any http://${...} is wrapped in backticks properly
    // Find strings in '...' or "..." that contain ${window.location.hostname}
    content = content.replace(/(['"])(http:\/\/)?\$\{window\.location\.hostname\}:(809|8282)(.*?)\1/g, '`http://${window.location.hostname}:$3$4`');
    
    fs.writeFileSync(f, content);
});
