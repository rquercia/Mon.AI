# Script para reconstruir solo el código (Front + Back)
# Mantiene los datos de pacientes (PACS/DB) intactos.
Write-Host "Reconstruyendo solo Frontend y Backend... (Pacientes y DB intactos)" -ForegroundColor Green
docker compose up -d --build frontend backend
Write-Host "¡Hecho! Recuerda hacer Hard Refresh (Ctrl+F5) en el navegador." -ForegroundColor Blue
