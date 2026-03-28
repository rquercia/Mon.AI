const express = require('express');
const cors = require('cors');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json({ limit: '1GB' }));
app.use(express.urlencoded({ limit: '1GB', extended: true }));

const { exec, spawn } = require('child_process');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');

// Configuración de multer para subida de archivos pesados
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const uploadPath = '/app/uploads';
    if (!fs.existsSync(uploadPath)) {
      fs.mkdirSync(uploadPath, { recursive: true });
    }
    cb(null, uploadPath);
  },
  filename: function (req, file, cb) {
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 1024 * 1024 * 1024 } // 1GB limit
});

// Main Health Check Route
app.get('/api/health', async (req, res) => {
  try {
    const result = await db.query('SELECT NOW()');
    res.json({
      status: 'OK',
      message: 'Backend is running correctly',
      db_time: result.rows[0].now,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Database connection error:', error);
    res.status(500).json({ status: 'ERROR', message: 'Database connection failed' });
  }
});

// Endpoint para subir archivos DICOM (Zip o archivos individuales)
app.post('/api/upload-dicom', upload.array('files'), (req, res) => {
  try {
    const files = req.files;
    const inputDir = '/app/data/input'; // Ruta mapeada en docker-compose

    if (!fs.existsSync(inputDir)) {
      fs.mkdirSync(inputDir, { recursive: true });
    } else {
      // LIMPIEZA: Borrar archivos previos para evitar mezclar estudios
      const existingFiles = fs.readdirSync(inputDir);
      for (const file of existingFiles) {
        const fullPath = path.join(inputDir, file);
        if (fs.lstatSync(fullPath).isDirectory()) {
          fs.rmSync(fullPath, { recursive: true });
        } else {
          fs.unlinkSync(fullPath);
        }
      }
      
      const outputDir = '/app/data/output';
      if (fs.existsSync(outputDir)) {
        const outFiles = fs.readdirSync(outputDir);
        for (const file of outFiles) {
          const fullPath = path.join(outputDir, file);
          if (fs.lstatSync(fullPath).isDirectory()) {
            fs.rmSync(fullPath, { recursive: true });
          } else {
            fs.unlinkSync(fullPath);
          }
        }
      }
      console.log('Carpetas de input y output limpiadas antes de nueva subida.');
    }

    files.forEach(file => {
      if (file.mimetype === 'application/zip' || file.originalname.endsWith('.zip')) {
        // Si es un ZIP, lo extraemos
        const zip = new AdmZip(file.path);
        zip.extractAllTo(inputDir, true);
        console.log(`Zip extraído en ${inputDir}`);

        // Limpiamos el zip temporal
        fs.unlinkSync(file.path);
      } else {
        // Si es un archivo individual (DCM), lo movemos
        const destPath = path.join(inputDir, file.originalname);
        fs.renameSync(file.path, destPath);
        console.log(`Archivo movido a ${destPath}`);
      }
    });

    res.json({ message: 'Archivos subidos y carpeta preparada' });
  } catch (error) {
    console.error('Error al procesar subida:', error);
    res.status(500).json({ error: 'Error al procesar los archivos' });
  }
});

// Endpoint para convertir DICOM a NIfTI
app.post('/api/convert-dicom', (req, res) => {
  const { inputFolder, outputFile } = req.body;

  // Usamos docker exec para correr el script en el contenedor de MONAI
  const command = `docker exec monai_lung_detection python /opt/monai/scripts/convert_dicom.py ${inputFolder} ${outputFile}`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error de ejecución: ${error}`);
      console.error(`Stderr: ${stderr}`);
      return res.status(500).json({
        error: 'Fallo en la conversión DICOM',
        details: stderr || error.message,
        output: stdout
      });
    }
    console.log(`Conversión exitosa: ${stdout}`);
    res.json({ message: 'Conversión exitosa', output: stdout });
  });
});

// Endpoint para ejecutar el modelo de Inferencia IA
app.post('/api/run-inference', (req, res) => {
  const { modelType } = req.body;

  // Ejecuta inference.py en el contenedor GPU con el parámetro del modelo
  const command = `docker exec monai_lung_detection python /opt/monai/scripts/inference.py --model ${modelType || 'segmentation'}`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error de ejecución: ${error}`);
      console.error(`Stderr: ${stderr}`);
      return res.status(500).json({
        error: 'Fallo en la inferencia',
        details: stderr || error.message,
        output: stdout
      });
    }
    console.log(`Inferencia finalizada: ${stdout}`);
    res.json({ message: 'Inferencia ejecutada correctamente', output: stdout });
  });
});

// Endpoint para convertir NIfTI a DICOM Zip
app.post('/api/convert-to-dicom', (req, res) => {
  const { niftiFile, outputZip } = req.body;

  // Envolvemos rutas en comillas simples para evitar errores con nombres que contengan paréntesis
  // Usamos el script de bundle completo para incluir originales + máscara
  const command = `docker exec monai_lung_detection python /opt/monai/scripts/export_full_dicom.py '/opt/monai/output/${niftiFile}' '/opt/monai/data' '/opt/monai/output/${outputZip}'`;

  exec(command, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error de ejecución: ${error}`);
      console.error(`Stderr: ${stderr}`);
      return res.status(500).json({
        error: 'Fallo al convertir NIfTI a DICOM',
        details: stderr || error.message,
        output: stdout
      });
    }
    console.log(`DICOM convertido exitosamente: ${stdout}`);
    res.json({ message: 'DICOM ZIP generado exitosamente', output: stdout });
  });
});

// Endpoint para generar informe con IA (MedGemma)
app.post('/api/generate-ai-report', (req, res) => {
  const { jsonFile } = req.body;
  if (!jsonFile) return res.status(400).json({ error: 'Falta el archivo JSON' });

  // Rutas en el contenedor MONAI - asumimos filePath (e.g., jsonFile_det.json) desde la UI
  const fullJsonPath = `/opt/monai/output/${path.basename(jsonFile)}`;
  console.log(`Solicitando Reporte IA para: ${fullJsonPath}...`);
  
  const command = `docker exec monai_lung_detection python /opt/monai/scripts/generate_ai_report.py '${fullJsonPath}'`;

  // Aumentamos el timeout a 3 minutos ya que MedGemma 1.5 F16 puede ser lenta en procesar
  exec(command, { maxBuffer: 1024 * 1024 * 10, timeout: 180000 }, (error, stdout, stderr) => {
    if (error) {
      console.error(`Error procesando reporte MedGemma: ${stderr || error.message}`);
      return res.status(500).json({ error: 'Fallo en MedGemma', details: stderr || error.message });
    }
    console.log(`Reporte generado exitosamente para ${jsonFile}`);
    res.json({ report: stdout.trim() });
  });
});

// Endpoint para borrar todos los resultados del output
app.post('/api/delete-all', (req, res) => {
  const outputDir = '/app/data/output';
  try {
    if (fs.existsSync(outputDir)) {
      const files = fs.readdirSync(outputDir);
      for (const file of files) {
        const fullPath = path.join(outputDir, file);
        if (fs.lstatSync(fullPath).isDirectory()) {
          fs.rmSync(fullPath, { recursive: true });
        } else {
          fs.unlinkSync(fullPath);
        }
      }
    }
    console.log('Directorio output vaciado completamente.');
    res.json({ message: 'Resultados borrados correctamente' });
  } catch (error) {
    console.error('Error al vaciar directorio:', error);
    res.status(500).json({ error: 'Fallo al borrar resultados' });
  }
});

// Endpoint para obtener la lista de resultados en la carpeta output
app.get('/api/results', (req, res) => {
  const outputDir = '/app/data/output';
  try {
    if (!fs.existsSync(outputDir)) {
      return res.json({ files: [] });
    }

    // Función para buscar archivos recursivamente
    const getAllFiles = (dir, fileList = []) => {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
          getAllFiles(fullPath, fileList);
        } else if (file.endsWith('.nii.gz') || file.endsWith('.nii') || file.endsWith('.zip') || file.endsWith('.json')) {
          fileList.push(fullPath);
        }
      }
      return fileList;
    };

    const filePaths = getAllFiles(outputDir);

    // Mapear info básica (nombre, fecha de creación)
    const filesInfo = filePaths.map(fullPath => {
      const stats = fs.statSync(fullPath);
      // to serve correctly via static, we need the path relative to outputDir
      const relativePath = path.relative(outputDir, fullPath).replace(/\\/g, '/');
      return {
        name: path.basename(fullPath),
        downloadPath: relativePath,
        size: (stats.size / (1024 * 1024)).toFixed(2) + ' MB',
        date: stats.mtime
      }
    });

    // Ordenar por más reciente primero
    filesInfo.sort((a, b) => b.date - a.date);
    res.json({ files: filesInfo });
  } catch (error) {
    console.error('Error al leer el directorio de resultados:', error);
    res.status(500).json({ error: 'No se pudieron leer los resultados' });
  }
});

// Endpoint para descargar archivos estáticos de output e input
app.use('/api/download', express.static('/app/data/output'));
app.use('/api/download-input', express.static('/app/data/input'));

// --- INICIO CÓDIGO ESPINOGRAFÍAS ---
// Endpoint to generate a quick preview for a single DICOM
app.post('/api/preview', upload.single('image'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded.' });
  }

  // Mover archivo temporal a carpeta compartida de input para que el container MONAI lo vea
  const tempPath = req.file.path;
  const sharedInputPath = path.join('/app/data/input', req.file.filename);
  fs.copyFileSync(tempPath, sharedInputPath);
  fs.unlinkSync(tempPath);

  const outputPrefix = `preview_${Date.now()}`;
  // En node, la ruta de output (para servir) es /app/data/output
  // En MONAI, la ruta de output es /opt/monai/output
  const monaiOutputFileBase = `/opt/monai/output/${outputPrefix}`;
  const monaiInputFile = `/opt/monai/data/${req.file.filename}`;

  const pythonProcess = spawn('docker', [
    'exec', 'monai_lung_detection', 'python',
    '/opt/monai/scripts/process_panorama.py',
    '--output_prefix', monaiOutputFileBase,
    '--images', monaiInputFile
  ]);

  let pythonOutput = '';
  let pythonError = '';

  pythonProcess.stdout.on('data', (data) => {
    pythonOutput += data.toString();
  });

  pythonProcess.stderr.on('data', (data) => {
    pythonError += data.toString();
    console.error(`Preview Python stderr: ${data}`);
  });

  pythonProcess.on('close', (code) => {
    // Cleanup shared input file
    if (fs.existsSync(sharedInputPath)) fs.unlinkSync(sharedInputPath);

    if (code === 0) {
      console.log(`Preview generated: ${outputPrefix}.jpg`);
      res.json({
        status: 'success',
        // Servimos el output desde la API (app.use('/api/download', express.static('/app/data/output')))
        previewUrl: `/api/download/${outputPrefix}.jpg`
      });
    } else {
      console.error(`Preview failed. Code ${code}. Error: ${pythonError}`);
      res.status(500).json({ error: 'Error generating preview' });
    }
  });
});

// Endpoint to process panorama (Espinografías)
app.post('/api/process-panorama', upload.array('images', 10), (req, res) => {
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: 'No files uploaded.' });
  }

  const outputPrefix = `panorama_${Date.now()}`;
  const monaiOutputFileBase = `/opt/monai/output/${outputPrefix}`;
  const manualOffsets = req.body.manualOffsets || null;

  // Move files to shared directory
  const sharedPaths = req.files.map(file => {
    const dest = path.join('/app/data/input', file.filename);
    fs.copyFileSync(file.path, dest);
    fs.unlinkSync(file.path);
    return dest;
  });

  // Convert Node paths to MONAI container paths
  const monaiFilePaths = req.files.map(file => `/opt/monai/data/${file.filename}`);

  const pythonArgs = [
    'exec', 'monai_lung_detection', 'python',
    '/opt/monai/scripts/process_panorama.py',
    '--output_prefix', monaiOutputFileBase,
    '--images', ...monaiFilePaths
  ];

  if (manualOffsets) {
    pythonArgs.push('--manual_offsets', manualOffsets);
  }

  const pythonProcess = spawn('docker', pythonArgs);

  let calculatedOffsets = [];
  let pythonOutput = '';

  pythonProcess.stdout.on('data', (data) => {
    pythonOutput += data.toString();
  });

  pythonProcess.stderr.on('data', (data) => {
    console.error(`Python stderr: ${data}`);
  });

  pythonProcess.on('close', (code) => {
    console.log(`Python process closed with code ${code}`);

    if (pythonOutput.includes('---OFFSETS_JSON---:')) {
      try {
        const jsonPart = pythonOutput.split('---OFFSETS_JSON---:')[1].trim().split('\n')[0];
        calculatedOffsets = JSON.parse(jsonPart);
      } catch (e) {
        console.error("Error parsing offsets:", e);
      }
    }

    // Cleanup shared input files
    sharedPaths.forEach(fp => {
      if(fs.existsSync(fp)) fs.unlinkSync(fp);
    });

    if (code === 0) {
      res.json({
        status: 'success',
        resultUrl: `/api/download/${outputPrefix}.jpg`,
        resultDicomUrl: `/api/download/${outputPrefix}.dcm`,
        offsets: calculatedOffsets
      });
    } else {
      res.status(500).json({ error: 'Error processing panoramic image in Python script' });
    }
  });
});
// --- FIN CÓDIGO ESPINOGRAFÍAS ---

// --- PACS INTEGRATION ---
app.post('/api/pacs/push', async (req, res) => {
  const { filePath } = req.body;
  if (!filePath) return res.status(400).json({ error: 'No file path provided' });
  const absolutePath = path.join('/app/data/output', filePath);
  if (!fs.existsSync(absolutePath)) return res.status(404).json({ error: 'File not found' });

  try {
    const fileBuffer = fs.readFileSync(absolutePath);
    const response = await fetch('http://orthanc:8042/instances', {
      method: 'POST',
      body: fileBuffer,
      headers: {
        'Authorization': 'Basic ' + Buffer.from('admin:admin').toString('base64'),
        'Content-Type': 'application/dicom'
      }
    });
    if (response.ok) res.json({ status: 'success' });
    else res.status(500).json({ error: 'Error sending to PACS' });
  } catch (error) {
    res.status(500).json({ error: 'PACS connection error' });
  }
});

app.get('/api/pacs/studies', async (req, res) => {
  const { date } = req.query;
  
  try {
    const authHeader = { 'Authorization': 'Basic ' + Buffer.from('admin:admin').toString('base64') };
    
    // Perform search
    const searchBody = {
      "Level": "Study",
      "Query": {},
      "Expand": true
    };
    if (date && date.trim() !== "") {
      searchBody.Query.StudyDate = date;
    }
    // Optional: Add PatientName support if provided in query
    if (req.query.patientName) {
      searchBody.Query.PatientName = `*${req.query.patientName}*`;
    }

    const findResponse = await fetch('http://orthanc:8042/tools/find', {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify(searchBody)
    });
    
    let studies = await findResponse.json();

    // Enrich studies with Modalities if missing
    // Orthanc usually has a "MainDicomTags" but we need "ModalitiesInStudy"
    // We can get it via /studies/{id} which calculated it
    const enrichedStudies = await Promise.all(studies.map(async (study) => {
      try {
        const detailResp = await fetch(`http://orthanc:8042/studies/${study.ID}`, { headers: authHeader });
        const detail = await detailResp.json();
        return {
          ...study,
          ModalitiesInStudy: detail.MainDicomTags.ModalitiesInStudy || ""
        };
      } catch (e) {
        return study;
      }
    }));

    res.json(enrichedStudies);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Error fetching studies' });
  }
});

// Endpoint filtrado para RX (DX o CR)
app.get('/api/pacs/studies-rx', async (req, res) => {
  const { patientName } = req.query;
  
  try {
    const authHeader = { 'Authorization': 'Basic ' + Buffer.from('admin:admin').toString('base64') };
    
    // 1. Traemos todos los estudios para no perder nada
    const findResponse = await fetch('http://orthanc:8042/tools/find', {
      method: 'POST',
      headers: { ...authHeader, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        "Level": "Study",
        "Query": patientName ? { "PatientName": `*${patientName}*` } : {},
        "Expand": true
      })
    });
    
    let studies = await findResponse.json();
    const filteredStudies = [];

    // 2. Inspección profunda por Series
    for (const study of studies) {
      try {
        // Obtenemos todas las series de este estudio con sus tags
        const seriesResp = await fetch(`http://orthanc:8042/studies/${study.ID}/series?expand`, { headers: authHeader });
        const seriesList = await seriesResp.json();
        
        // Verificamos si alguna serie es DX o CR
        const modalities = seriesList.map(s => s.MainDicomTags.Modality);
        const hasRx = modalities.some(m => m === 'DX' || m === 'CR');
        
        if (hasRx) {
          // Re-inyectamos la modalidad calculada para que el UI la muestre
          study.MainDicomTags.ModalitiesInStudy = [...new Set(modalities)].join('/');
          filteredStudies.push(study);
        }
      } catch (e) {
        console.warn("Fallo en inspección de estudio:", study.ID);
      }
    }

    console.log(`[RX_DEBUG] Encontrados ${studies.length} estudios totales. Tras filtrar series DX/CR, quedan: ${filteredStudies.length}`);
    res.json(filteredStudies);
  } catch (error) {
    console.error("Error en buscador RX:", error);
    res.status(500).json({ error: 'Fallo en la comunicación con el PACS' });
  }
});

app.get('/api/pacs/study-instances/:id', async (req, res) => {
  try {
    const authHeader = { 'Authorization': 'Basic ' + Buffer.from('admin:admin').toString('base64') };
    const instancesResp = await fetch(`http://orthanc:8042/studies/${req.params.id}/instances?expand`, { headers: authHeader });
    const instances = await instancesResp.json();
    
    // Sort logic (Infer instance ordering from InstanceNumber)
    instances.sort((a, b) => {
        const numA = parseInt(a.MainDicomTags.InstanceNumber || "0", 10);
        const numB = parseInt(b.MainDicomTags.InstanceNumber || "0", 10);
        return numA - numB;
    });
    
    res.json(instances.map(i => i.ID));
  } catch (error) {
    res.status(500).json({ error: 'Error fetching instances' });
  }
});

app.get('/api/pacs/study-series/:id', async (req, res) => {
  try {
    const authHeader = { 'Authorization': 'Basic ' + Buffer.from('admin:admin').toString('base64') };
    const seriesResp = await fetch(`http://orthanc:8042/studies/${req.params.id}/series?expand`, { headers: authHeader });
    const series = await seriesResp.json();
    
    // Sort series by number if possible
    series.sort((a, b) => {
        const numA = parseInt(a.MainDicomTags.SeriesNumber || "0", 10);
        const numB = parseInt(b.MainDicomTags.SeriesNumber || "0", 10);
        return numA - numB;
    });
    
    res.json(series);
  } catch (error) {
    res.status(500).json({ error: 'Error fetching series' });
  }
});

app.post('/api/pacs/import-series/:id', async (req, res) => {
    try {
        const authHeader = { 'Authorization': 'Basic ' + Buffer.from('admin:admin').toString('base64') };
        const inputDir = '/app/data/input';
        
        // 1. Clean input folder
        if (!fs.existsSync(inputDir)) {
            fs.mkdirSync(inputDir, { recursive: true });
        } else {
            const files = fs.readdirSync(inputDir);
            for (const file of files) {
                const fullPath = path.join(inputDir, file);
                if (fs.lstatSync(fullPath).isDirectory()) fs.rmSync(fullPath, { recursive: true });
                else fs.unlinkSync(fullPath);
            }
            
            // Clean output too
            const outputDir = '/app/data/output';
            if (fs.existsSync(outputDir)) {
                const outFiles = fs.readdirSync(outputDir);
                for (const file of outFiles) {
                    const fullPath = path.join(outputDir, file);
                    if (fs.lstatSync(fullPath).isDirectory()) fs.rmSync(fullPath, { recursive: true });
                    else fs.unlinkSync(fullPath);
                }
            }
        }

        // 2. Get instances IDs for this series
        const seriesResp = await fetch(`http://orthanc:8042/series/${req.params.id}`, { headers: authHeader });
        const seriesData = await seriesResp.json();
        const instanceIds = seriesData.Instances;

        console.log(`Importing ${instanceIds.length} instances for series ${req.params.id}`);

        // 3. Download each instance
        for (let i = 0; i < instanceIds.length; i++) {
            const instId = instanceIds[i];
            const fileResp = await fetch(`http://orthanc:8042/instances/${instId}/file`, { headers: authHeader });
            const arrayBuffer = await fileResp.arrayBuffer();
            fs.writeFileSync(path.join(inputDir, `${instId}.dcm`), Buffer.from(arrayBuffer));
        }

        res.json({ status: 'success', count: instanceIds.length });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error importing series' });
    }
});

app.get('/api/pacs/download/:id', async (req, res) => {
  try {
    const authHeader = { 'Authorization': 'Basic ' + Buffer.from('admin:admin').toString('base64') };
    const fileResp = await fetch(`http://orthanc:8042/instances/${req.params.id}/file`, { headers: authHeader });
    const arrayBuffer = await fileResp.arrayBuffer();
    
    res.setHeader('Content-Type', 'application/dicom');
    res.setHeader('Content-Disposition', `attachment; filename="${req.params.id}.dcm"`);
    res.send(Buffer.from(arrayBuffer));
  } catch (error) {
    res.status(500).json({ error: 'Error downloading instance file' });
  }
});

app.post('/api/pacs/push-inference', async (req, res) => {
    // 1. Identificar el archivo NIfTI de salida (especificado o el más reciente)
    const { filePath } = req.body;
    const outputDir = '/app/data/output';
    const inputDir = '/app/data/input';
    
    try {
        let maskFile;
        
        if (filePath) {
            // filePath viene como relativo a outputDir (ej: session_X_seg.nii.gz)
            maskFile = path.basename(filePath);
        } else {
            const files = fs.readdirSync(outputDir);
            maskFile = files.find(f => f.endsWith('_seg.nii.gz') || f.endsWith('_det.nii.gz'));
        }
        
        if (!maskFile) {
            return res.status(404).json({ error: 'No se encontró archivo de inferencia para exportar' });
        }

        const maskPath = path.join('/opt/monai/output', maskFile);
        const monaiInputDir = '/opt/monai/data'; // Ruta dentro del contenedor monai_lung_detection
        const monaiOutBundle = '/opt/monai/output/push_bundle.zip';
        
        console.log(`Iniciando exportación sincronizada de ${maskFile} hacia PACS...`);
        
        // 2. Ejecutar script de sincronización DICOM (usamos la carpeta real de DICOM descargados como referencia)
        const command = `docker exec monai_lung_detection python /opt/monai/scripts/export_full_dicom.py ${maskPath} ${monaiInputDir} ${monaiOutBundle}`;

        exec(command, async (error, stdout, stderr) => {
            if (error) {
                console.error(error);
                return res.status(500).json({ error: 'Error convirtiendo a DICOM sincronizado', details: stderr });
            }
            
            // 3. Extraer el ZIP y pushear solo la carpeta de máscaras a Orthanc
            const zipPath = path.join('/app/data/output', 'push_bundle.zip');
            const extractPath = path.join('/app/data/output', 'temp_extract');
            
            if (fs.existsSync(extractPath)) fs.rmSync(extractPath, { recursive: true });
            fs.mkdirSync(extractPath, { recursive: true });
            
            const zip = new AdmZip(zipPath);
            zip.extractAllTo(extractPath, true);
            
            const segDir = path.join(extractPath, 'SEG_AI_LABELS');
            const dcmFiles = fs.readdirSync(segDir).filter(f => f.endsWith('.dcm'));
            
            console.log(`Subiendo ${dcmFiles.length} instancias de segmentación a Orthanc...`);
            
            let successCount = 0;
            const authHeader = { 'Authorization': 'Basic ' + Buffer.from('admin:admin').toString('base64') };

            for (const dcm of dcmFiles) {
                const buffer = fs.readFileSync(path.join(segDir, dcm));
                const pushResp = await fetch('http://orthanc:8042/instances', {
                    method: 'POST',
                    body: buffer,
                    headers: { ...authHeader, 'Content-Type': 'application/dicom' }
                });
                if (pushResp.ok) successCount++;
            }
            
            // Limpiar
            fs.rmSync(extractPath, { recursive: true });
            fs.unlinkSync(zipPath);
            
            res.json({ status: 'success', uploaded: successCount });
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error interno en el proceso de Push' });
    }
});

app.post('/api/pacs/push-medical-object', async (req, res) => {
    const { filePath } = req.body;
    const outputDir = '/app/data/output';
    const inputDir = '/app/data/input';
    const authHeader = { 'Authorization': 'Basic ' + Buffer.from('admin:admin').toString('base64') };
    
    try {
        let maskFile;
        if (filePath) {
            maskFile = path.basename(filePath);
        } else {
            const files = fs.readdirSync(outputDir);
            maskFile = files.find(f => f.endsWith('_seg.nii.gz') || f.endsWith('_det.nii.gz'));
        }
        
        if (!maskFile) {
            return res.status(404).json({ error: 'No se encontró archivo de inferencia' });
        }

        const maskPath = path.join('/opt/monai/output', maskFile);
        const monaiInputDir = '/opt/monai/data';
        const dcmSegOutput = '/opt/monai/output/result_seg.dcm';
        
        console.log(`Generando Objeto Médico DICOM-SEG formal para ${maskFile}...`);
        
        const command = `docker exec monai_lung_detection python /opt/monai/scripts/create_dicom_seg.py ${maskPath} ${monaiInputDir} ${dcmSegOutput}`;

        exec(command, async (error, stdout, stderr) => {
            if (error) {
                console.error(`Error en script DICOM-SEG: ${stderr}`);
                return res.status(500).json({ error: 'Fallo al generar objeto DICOM-SEG' });
            }

            const segFilePathHost = path.join(outputDir, 'result_seg.dcm');
            if (fs.existsSync(segFilePathHost)) {
                const buffer = fs.readFileSync(segFilePathHost);
                const pushResp = await fetch('http://orthanc:8042/instances', {
                    method: 'POST',
                    body: buffer,
                    headers: { ...authHeader, 'Content-Type': 'application/dicom' }
                });

                if (pushResp.ok) {
                    const data = await pushResp.json();
                    res.json({ success: true, message: 'Objeto DICOM-SEG enviado correctamente al PACS', details: data });
                } else {
                    res.status(500).json({ error: 'Fallo al inyectar DICOM-SEG en Orthanc' });
                }
            } else {
                res.status(500).json({ error: 'No se generó el archivo DICOM-SEG esperado' });
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error interno de servidor' });
    }
});

// Endpoint para Analizar RX (Ventaneo + MedGemma)
app.post('/api/analyze-rx', (req, res) => {
  const { seriesId, customPrompt } = req.body;
  console.log(`[BACKEND_DEBUG] RECIBIDA PETICIÓN DE ANÁLISIS PARA SERIE: ${seriesId}`);
  
  if (!seriesId) return res.status(400).json({ error: 'Falta el ID de la serie RX' });

  const inputDir = '/app/data/input';
  if (!fs.existsSync(inputDir)) fs.mkdirSync(inputDir, { recursive: true });
  const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.dcm'));
  
  console.log(`[BACKEND_DEBUG] Archivos en input:`, files);

  if (files.length === 0) {
    console.error(`[BACKEND_DEBUG] Carpeta vacía. No hay nada que analizar.`);
    return res.status(404).json({ error: 'No se encontró la imagen DICOM importada (carpeta vacía).' });
  }

  // Guardamos el System Prompt Custom en un archivo temporal para que Python lo lea
  const promptPath = '/app/data/input/custom_prompt.txt';
  fs.writeFileSync(promptPath, customPrompt || "Actúa como un médico radiólogo.");

  const dcmPath = `/opt/monai/data/${files[0]}`;
  const outputDir = `/opt/monai/output`;
  const monaiPromptPath = `/opt/monai/data/custom_prompt.txt`;
  
  console.log(`[BACKEND_DEBUG] Ejecutando: docker exec monai_lung_detection python /opt/monai/scripts/analyze_rx.py "${dcmPath}" "${outputDir}" "${monaiPromptPath}"`);
  
  const command = `docker exec monai_lung_detection python /opt/monai/scripts/analyze_rx.py "${dcmPath}" "${outputDir}" "${monaiPromptPath}"`;

  exec(command, { maxBuffer: 1024 * 1024 * 10, timeout: 240000 }, (error, stdout, stderr) => {
    try {
      const output = stdout ? stdout.toString() : "";
      const errOutput = stderr ? stderr.toString() : "";
      
      console.log(`[BACKEND_DEBUG] STEP 1: Script finalizado. Output length: ${output.length}`);
      
      if (error) {
        console.error(`[BACKEND_DEBUG] STEP 1.ERROR (Code ${error.code}):`, error.message);
        return res.status(500).json({ error: 'Fallo en MedGemma RX', details: errOutput || error.message });
      }
      
      console.log(`[BACKEND_DEBUG] STEP 2: Iniciando Regex match...`);
      const reportMatch = output.match(/---RADIOLOGY_REPORT_START---([\s\S]*?)---RADIOLOGY_REPORT_END---/);
      const imagesMatch = output.match(/---IMAGES_GENERATED---:(.*)/);
      
      console.log(`[BACKEND_DEBUG] STEP 3: Matches listos. Report: ${!!reportMatch}, Images: ${!!imagesMatch}`);

      const report = (reportMatch && reportMatch[1]) ? reportMatch[1].trim() : "No se pudo extraer el reporte por una inconsistencia.";
      const imagesRaw = (imagesMatch && imagesMatch[1]) ? imagesMatch[1].trim() : "[]";
      
      console.log(`[BACKEND_DEBUG] STEP 4: Parseando JSON de imágenes: ${imagesRaw}`);
      let images = [];
      try {
          images = JSON.parse(imagesRaw);
      } catch(e) {
          console.error("[BACKEND_DEBUG] STEP 4.ERROR: Fallo al parsear JSON:", e.message);
      }

      console.log(`[BACKEND_DEBUG] STEP 5: Mapeando URLs de imágenes (${images.length} detectadas)`);
      const imageUrls = Array.isArray(images) ? images.map(img => `/api/download/${img}`) : [];

      console.log(`[BACKEND_DEBUG] STEP 6: Enviando respuesta final JSON al cliente...`);
      res.json({ 
        report, 
        images: imageUrls
      });
    } catch (criticalErr) {
      console.error("[BACKEND_DEBUG] !!! ERROR CRÍTICO NO CONTROLADO:", criticalErr);
      if (!res.headersSent) {
          res.status(500).json({ error: 'Error interno de procesamiento', details: criticalErr.message });
      }
    }
  });
});

// Endpoint para forzar descarga de modelos de la memoria IA (Ollama)
app.post('/api/ai-clear', async (req, res) => {
    try {
        console.log("[BACKEND_DEBUG] Iniciando limpieza de memoria IA...");
        // 1. Obtener lista de modelos locales en Ollama
        const tagsResp = await fetch('http://monai_llm:11434/api/tags');
        const tagsData = await tagsResp.json();
        
        if (tagsData.models) {
            // 2. Mandar señal de descarga (keep_alive: 0) para cada modelo
            // Esto libera la VRAM inmediatamente
            for (const m of tagsData.models) {
                await fetch('http://monai_llm:11434/api/generate', {
                    method: 'POST',
                    body: JSON.stringify({ model: m.name, keep_alive: 0 })
                });
            }
        }
        
        res.json({ status: 'success', message: 'Memoria IA liberada' });
    } catch (error) {
        console.error("[BACKEND_DEBUG] Error limpiando memoria IA:", error);
        res.status(500).json({ error: 'Fallo al purgar memoria de IA' });
    }
});

// Nuevo endpoint para pre-cargar el modelo (Warming up)
app.post('/api/ai-load', async (req, res) => {
    try {
        const { model } = req.body;
        console.log(`[BACKEND_DEBUG] Cargando modelo en memoria: ${model}`);
        // Forzamos carga con una cadena vacía y keep_alive persistente
        await fetch('http://monai_llm:11434/api/generate', {
            method: 'POST',
            body: JSON.stringify({ model, prompt: "", keep_alive: '10m' })
        });
        res.json({ status: 'success', message: `Modelo ${model} cargado en VRAM` });
    } catch (error) {
        res.status(500).json({ error: 'Fallo al cargar modelo' });
    }
});

app.listen(PORT, () => {
  console.log(`Server started on port ${PORT}`);
});
