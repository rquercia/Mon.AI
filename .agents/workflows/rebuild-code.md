---
description: Reconstruye solo el código de la aplicación (frontend/backend) manteniendo los datos de pacientes (DB/PACS)
---

Este workflow debe ejecutarse cuando se necesite ver cambios en la interfaz o en el API sin afectar los estudios del PACS o la base de datos PostgreSQL.

// turbo-all
1. Ejecuta el comando de reconstrucción selectiva:
   `docker compose up -d --build frontend backend`

2. Verifica que los contenedores estén corriendo:
   `docker ps --format "table {{.Names}}\t{{.Status}}"`
