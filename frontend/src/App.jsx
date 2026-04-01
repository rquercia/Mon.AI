import React, { useState } from 'react';
import {
    FileBox,
    UploadCloud,
    Activity,
    Settings,
    FileSearch,
    Cpu,
    CheckCircle2,
    AlertCircle,
    Layers,
    Database,
    Stethoscope,
    Server,
    ChevronLeft,
    Eye,
    Trash,
    Edit,
    User,
    FileText,
    ChevronUp,
    ChevronDown,
    Copy
} from 'lucide-react';
import { DicomProvider } from './context/DicomContext';
import EspinografiaSidebar from './components/EspinografiaSidebar';
import Viewer from './components/Viewer';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error("ErrorBoundary caught:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: '40px', background: 'red', color: 'white', flex: 1, zIndex: 9999 }}>
          <h1>Component Error</h1>
          <p>{this.state.error && this.state.error.toString()}</p>
          <pre style={{ background: '#000', padding: '10px' }}>{this.state.errorInfo && this.state.errorInfo.componentStack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function App() {

    const [activeTab, setActiveTab] = useState('dicom');
    const [isConverting, setIsConverting] = useState(false);
    const [isUploading, setIsUploading] = useState(false);
    const [message, setMessage] = useState({ type: '', text: '' });
    const [results, setResults] = useState([]);
    const [modelType, setModelType] = useState('segmentation'); // 'segmentation' o 'detection'
    const [lastConvertedFile, setLastConvertedFile] = useState(null);
    const [selectedJson, setSelectedJson] = useState(null);
    const [aiReportText, setAiReportText] = useState('');
    const [isGeneratingReport, setIsGeneratingReport] = useState(false);
    
    // MS Word Frame Modal States
    const [showFrameModal, setShowFrameModal] = useState(false);
    const [frameReportData, setFrameReportData] = useState('');

    // RX Tab States
    const [rxResults, setRxResults] = useState({ report: '', images: [] });
    const [isAnalyzingRx, setIsAnalyzingRx] = useState(false);
    const [selectedRxImage, setSelectedRxImage] = useState(null);
    const [customSystemPrompt, setCustomSystemPrompt] = useState('Actúa como un Especialista en Radiodiagnóstico Digital. Analiza el tríptico para identificar hallazgos que no se vean en una placa simple. Inforne en español.');

    // PACS Modal States for DICOM Converter
    const [showPacsModal, setShowPacsModal] = useState(false);
    const [pacsSearchDate, setPacsSearchDate] = useState(new Date().toISOString().split('T')[0].replace(/-/g, ''));
    const [pacsSearchPatient, setPacsSearchPatient] = useState("");
    const [pacsStudies, setPacsStudies] = useState([]);
    const [pacsSeries, setPacsSeries] = useState([]);
    const [selectedStudy, setSelectedStudy] = useState(null);
    const [pacsLoading, setPacsLoading] = useState(false);
    const [selectedSeriesInfo, setSelectedSeriesInfo] = useState(null);
    const [progress, setProgress] = useState(0);
    const [gitLogs, setGitLogs] = useState('');
    const [showGitLogModal, setShowGitLogModal] = useState(false);
    const [isGitLoading, setIsGitLoading] = useState(false);
    const [githubToken, setGithubToken] = useState(localStorage.getItem('github_token') || '');

    // Vantio PACS States
    const [vantioStudies, setVantioStudies] = useState([]);
    const [vantioLoading, setVantioLoading] = useState(false);
    const [vantioSearch, setVantioSearch] = useState({ 
        patientName: '', 
        patientId: '', 
        patientBirthDate: '', 
        studyDate: '', 
        studyDescription: '', 
        modality: '', 
        accessionNumber: '' 
    });
    const [selectedVantioStudy, setSelectedVantioStudy] = useState(null);
    const [vantioSeries, setVantioSeries] = useState([]);

    const fetchResults = async () => {
        try {
            const response = await fetch(`http://${window.location.hostname}:809/api/results`);
            if (response.ok) {
                const data = await response.json();
                setResults(data.files || []);
            }
        } catch (error) {
            console.error('Error fetching results:', error);
        }
    };

    // Refrescar resultados cuando se cambia a la pestaña de resultados o PACS
    React.useEffect(() => {
        if (activeTab === 'resultados') {
            fetchResults();
        }
        if (activeTab === 'pacs-vantio') {
            handleSearchVantio();
        }
    }, [activeTab]);

    const handleSearchVantio = async () => {
        setVantioLoading(true);
        try {
            const params = new URLSearchParams({
                _t: Date.now(),
                patientName: vantioSearch.patientName,
                patientId: vantioSearch.patientId,
                patientBirthDate: vantioSearch.patientBirthDate.replace(/-/g, ''),
                studyDate: vantioSearch.studyDate.replace(/-/g, ''),
                studyDescription: vantioSearch.studyDescription,
                modality: vantioSearch.modality,
                accessionNumber: vantioSearch.accessionNumber
            });

            const response = await fetch(`http://${window.location.hostname}:809/api/pacs/studies?${params.toString()}`);
            if (response.ok) {
                const data = await response.json();
                setVantioStudies(data);
            }
        } catch (error) {
            console.error('Error fetching Vantio PACS:', error);
        } finally {
            setVantioLoading(false);
        }
    };

    const handleSelectVantioStudy = async (study) => {
        if (selectedVantioStudy?.ID === study.ID) {
            setSelectedVantioStudy(null);
            setVantioSeries([]);
            return;
        }
        setSelectedVantioStudy(study);
        setVantioLoading(true);
        try {
            const response = await fetch(`http://${window.location.hostname}:809/api/pacs/study-series/${study.ID}`);
            if (response.ok) {
                const data = await response.json();
                setVantioSeries(data);
            }
        } catch (error) {
            console.error("Error loading Vantio series:", error);
        } finally {
            setVantioLoading(false);
        }
    };

    const handleFileUpload = async (event) => {
        const files = event.target.files;
        if (!files.length) return;

        setIsUploading(true);
        setMessage({ type: 'neutral', text: 'Subiendo archivos...' });

        const formData = new FormData();
        for (let i = 0; i < files.length; i++) {
            formData.append('files', files[i]);
        }

        try {
            const response = await fetch(`http://${window.location.hostname}:809/api/upload-dicom`, {
                method: 'POST',
                body: formData,
            });

            if (response.ok) {
                setMessage({ type: 'success', text: 'Archivos subidos y extraídos correctamente en data/input' });
            } else {
                setMessage({ type: 'error', text: 'Error al subir los archivos' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Error de conexión con el servidor' });
        } finally {
            setIsUploading(false);
        }
    };

    const startProgressTimer = (maxProgress = 95, duration = 10000) => {
        setProgress(0);
        const steps = 50;
        const interval = duration / steps;
        const increment = maxProgress / steps;
        
        const timer = setInterval(() => {
            setProgress(prev => {
                const next = prev + increment;
                if (next >= maxProgress) {
                    clearInterval(timer);
                    return maxProgress;
                }
                return next;
            });
        }, interval);
        return timer;
    };

    const handleConvert = async () => {
        setIsConverting(true);
        setMessage({ type: 'neutral', text: 'Iniciando conversión de DICOM a NIfTI (médico)...' });
        const timer = startProgressTimer(95, 8000);

        try {
            const fileName = `session_${Date.now()}.nii.gz`;
            const response = await fetch(`http://${window.location.hostname}:809/api/convert-dicom`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    inputFolder: '/opt/monai/data',
                    outputFile: `/opt/monai/data/${fileName}`
                }),
            });

            if (response.ok) {
                setProgress(100);
                setMessage({ type: 'success', text: 'Conversión exitosa.' });
                setLastConvertedFile(fileName);
            } else {
                setMessage({ type: 'error', text: 'Fallo en la conversión' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Error al conectar' });
        } finally {
            clearInterval(timer);
            setIsConverting(false);
            setTimeout(() => setProgress(0), 1000);
        }
    };

    const handleInference = async () => {
        setIsConverting(true);
        setMessage({ type: 'neutral', text: `Despertando GPU y ejecutando modelo MONAI (${modelType === 'detection' ? 'RetinaNet' : 'Swin-UNETR'})...` });
        const timer = startProgressTimer(98, 25000); 

        try {
            const response = await fetch(`http://${window.location.hostname}:809/api/run-inference`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ modelType }),
            });

            if (response.ok) {
                setProgress(100);
                setMessage({ type: 'success', text: '¡Inferencia finalizada exitosamente!' });
                setTimeout(() => setActiveTab('resultados'), 2000);
            } else {
                setMessage({ type: 'error', text: 'Error durante la inferencia en GPU' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'No se pudo contactar con el contenedor MONAI' });
        } finally {
            clearInterval(timer);
            setIsConverting(false);
            setTimeout(() => setProgress(0), 1500);
        }
    };

    const handleConvertToDicom = async (fileDownloadPath) => {
        setMessage({ type: 'neutral', text: `Empaquetando NIfTI a DICOM Zip...` });
        try {
            const outputZipName = fileDownloadPath.replace('.nii.gz', '.zip').replace('.nii', '.zip');

            const response = await fetch(`http://${window.location.hostname}:809/api/convert-to-dicom`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    niftiFile: fileDownloadPath,
                    outputZip: outputZipName
                }),
            });

            if (response.ok) {
                setMessage({ type: 'success', text: `¡DICOM ZIP generado exitosamente!` });
                // Refrescar lista de resultados para ver el nuevo zip
                fetchResults();
            } else {
                setMessage({ type: 'error', text: 'Error al convertir NIfTI a DICOM' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Fallo de conexión con el backend' });
        }
    };

    const handleViewJson = async (fileDownloadPath) => {
        setAiReportText(''); // Reset AI report when opening new JSON
        try {
            const response = await fetch(`http://${window.location.hostname}:809/api/download/${fileDownloadPath}`);
            if (response.ok) {
                const data = await response.json();
                setSelectedJson({ fileName: fileDownloadPath, ...data });
            }
        } catch (error) {
            console.error('Error fetching JSON data:', error);
        }
    };

    const handleGenerateAiReport = async (fileName) => {
        setIsGeneratingReport(true);
        setAiReportText('Generando reporte con MedGemma estructurado, por favor espera...');
        try {
            const response = await fetch(`http://${window.location.hostname}:809/api/generate-ai-report`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonFile: fileName }),
            });
            const data = await response.json();
            if (response.ok) {
                setAiReportText(data.report);
            } else {
                setAiReportText(`Error: ${data.error || 'No se pudo generar'}`);
            }
        } catch (error) {
            setAiReportText('Error de conexión con el backend.');
            console.error(error);
        } finally {
            setIsGeneratingReport(false);
        }
    };

    const handleGenerateWordReport = async (fileName) => {
        setFrameReportData('');
        setShowFrameModal(true);
        setIsGeneratingReport(true);
        try {
            const response = await fetch(`http://${window.location.hostname}:809/api/generate-ai-report`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ jsonFile: fileName }),
            });
            const data = await response.json();
            if (response.ok) {
                setFrameReportData(data.report);
            } else {
                setFrameReportData(`Error: ${data.error || 'No se pudo generar'}`);
            }
        } catch (error) {
            setFrameReportData('Error de conexión con el backend.');
            console.error(error);
        } finally {
            setIsGeneratingReport(false);
        }
    };

    const formatMarkdownToHtml = (text) => {
        if (!text) return { __html: '' };
        let html = text
            // Headers
            .replace(/^#### (.*$)/gim, '<h4>$1</h4>')
            .replace(/^### (.*$)/gim, '<h3>$1</h3>')
            .replace(/^## (.*$)/gim, '<h2>$1</h2>')
            .replace(/^# (.*$)/gim, '<h1>$1</h1>')
            // Bold
            .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
            // Italic
            .replace(/\*(.*?)\*/gim, '<em>$1</em>')
            // Lists
            .replace(/^\* (.*$)/gim, '<ul><li>$1</li></ul>')
            // Newlines to BR
            .replace(/\n$/gim, '<br/>')
            .replace(/\n/gim, '<br/>');

        // Fix adjacent ULs
        html = html.replace(/<\/ul><br\/><ul>/gim, '');
        html = html.replace(/<\/ul><ul>/gim, '');

        return { __html: html };
    };

    const handleDeleteAll = async () => {
        if (!window.confirm('¿Estás seguro de que quieres borrar todos los procesamientos generados?')) return;

        try {
            const response = await fetch(`http://${window.location.hostname}:809/api/delete-all`, {
                method: 'POST',
            });
            if (response.ok) {
                setMessage({ type: 'success', text: 'Historial de resultados vaciado' });
                fetchResults();
            }
        } catch (error) {
            console.error('Error deleting results:', error);
        }
    };

    const handleSearchPacs = async (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        setPacsLoading(true);
        try {
            const dateQuery = pacsSearchDate ? `&date=${pacsSearchDate}` : '';
            const nameQuery = pacsSearchPatient ? `&patientName=${pacsSearchPatient}` : '';
            const response = await fetch(`http://${window.location.hostname}:809/api/pacs/studies?_t=${Date.now()}${dateQuery}${nameQuery}`);
            if (response.ok) {
                const data = await response.json();
                // Don't filter, just show all to debug and let user choose
                setPacsStudies(data);
            } else {
                alert("Error en la respuesta del PACS");
            }
        } catch (error) {
            console.error(error);
            alert("Error conectando con el servidor");
        } finally {
            setPacsLoading(false);
        }
    };

    const handleSearchRxPacs = async (e) => {
        if (e) { e.preventDefault(); e.stopPropagation(); }
        setPacsLoading(true);
        try {
            const dateQuery = pacsSearchDate ? `&date=${pacsSearchDate}` : '';
            const nameQuery = pacsSearchPatient ? `&patientName=${pacsSearchPatient}` : '';
            const response = await fetch(`http://${window.location.hostname}:809/api/pacs/studies-rx?_t=${Date.now()}${dateQuery}${nameQuery}`);
            if (response.ok) {
                const data = await response.json();
                setPacsStudies(data);
            }
        } catch (error) {
            console.error(error);
        } finally {
            setPacsLoading(false);
        }
    };

    const handleAnalyzeRxWithMedGemma = async (series) => {
        console.log("[GUI_DEBUG] 1. Inicio handleAnalyze.");
        setIsAnalyzingRx(true);
        setMessage({ type: 'neutral', text: 'Analizando... revisa consola (F12)' });
        setRxResults({ report: '', images: [] });
        setAiWorkflowStatus('analyzing');
        
        try {
            console.log("[GUI_DEBUG] 2. Llamando importación para:", series.ID);
            const importResp = await fetch(`http://${window.location.hostname}:809/api/pacs/import-series/${series.ID}`, { method: 'POST' });

            if (!importResp.ok) {
                const errData = await importResp.json();
                console.error("[GUI_DEBUG] Error en Importación:", errData);
                throw new Error(errData.error || "Fallo en la importación de la serie.");
            }

            console.log("[GUI_DEBUG] 3. Importación exitosa. Llamando a IA...");

            // 2. Analizar RX con MedGemma
            const analyzeResp = await fetch(`http://${window.location.hostname}:809/api/analyze-rx`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    seriesId: series.ID, 
                    customPrompt: customSystemPrompt 
                })
            });

            console.log("[GUI_DEBUG] 4. Recibida respuesta de IA con status:", analyzeResp.status);

            if (analyzeResp.ok) {
                const data = await analyzeResp.json();
                console.log("[GUI_DEBUG] 5. Datos de IA cargados con éxito:", data);
                setRxResults(data);
                setMessage({ type: 'success', text: 'Análisis de RX completado.' });
                setSelectedRxImage(null);
            } else {
                const errData = await analyzeResp.json();
                console.error("[GUI_DEBUG] 6. Error devuelto por el servidor de IA:", errData);
                setRxResults({ report: `⚠️ **ERROR EN IA:** ${errData.error}\n\nDetalles: ${errData.details || 'Ver logs del servidor.'}`, images: [] });
                setMessage({ type: 'error', text: 'Error en el análisis de IA.' });
            }
        } catch (error) {
            console.error("[GUI_DEBUG] X. FALLO DURANTE EL PROCESO:", error);
            setRxResults({ report: `❌ **ERROR DE SISTEMA:** ${error.message}`, images: [] });
            setMessage({ type: 'error', text: `Error de red o servidor: ${error.message}` });
        } finally {
            console.log("[GUI_DEBUG] END. Finalizando estado de carga.");
            setIsAnalyzingRx(false);
            setAiWorkflowStatus('idle');
        }
    };

    const [aiWorkflowStatus, setAiWorkflowStatus] = useState('idle'); // 'idle', 'loading', 'ready', 'analyzing', 'clearing'

    const handleClearAiMemory = async (showMsg = true) => {
        setAiWorkflowStatus('clearing');
        if (showMsg) setMessage({ type: 'neutral', text: 'Liberando memoria GPU (Ollama)...' });
        try {
            const resp = await fetch(`http://${window.location.hostname}:809/api/ai-clear`, { method: 'POST' });
            if (resp.ok) {
                if (showMsg) setMessage({ type: 'success', text: 'Memoria IA liberada.' });
                setAiWorkflowStatus('idle');
                return true;
            }
        } catch (error) {
            console.error(error);
            setMessage({ type: 'error', text: 'Fallo al purgar memoria' });
        }
        setAiWorkflowStatus('idle');
        return false;
    };

    const handlePrewarmAi = async () => {
        // 1. Unload FIRST
        await handleClearAiMemory(false);
        
        setAiWorkflowStatus('loading');
        setMessage({ type: 'neutral', text: 'Paso 1: Cargando MedGemma 1.5 en VRAM...' });
        
        try {
            const resp = await fetch(`http://${window.location.hostname}:809/api/ai-load`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model: 'dcarrascosa/medgemma-1.5-4b-it:q8_0' })
            });
            if (resp.ok) {
                setAiWorkflowStatus('ready');
                setMessage({ type: 'success', text: 'Paso 1 Completado: IA lista para análisis.' });
            }
        } catch (error) {
            setMessage({ type: 'error', text: 'Error al pre-cargar modelo' });
            setAiWorkflowStatus('idle');
        }
    };

    const handleSelectStudy = async (study) => {
        setSelectedStudy(study);
        setPacsLoading(true);
        try {
            // Buscamos tanto las series (para identificar proyecciones) como las instancias (imágenes reales)
            const [seriesResp, instancesResp] = await Promise.all([
                fetch(`http://${window.location.hostname}:809/api/pacs/study-series/${study.ID}`),
                fetch(`http://${window.location.hostname}:809/api/pacs/study-instances/${study.ID}`)
            ]);
            
            if (seriesResp.ok && instancesResp.ok) {
                const seriesData = await seriesResp.json();
                const instancesData = await instancesResp.json();
                
                setPacsSeries(seriesData);
                // Mapeamos las instancias para tener una lista visual
                setPacsInstances(instancesData);
            }
        } catch (error) {
            console.error("[GUI_ERROR] Error cargando detalle del estudio:", error);
        } finally {
            setPacsLoading(false);
        }
    };

    const [pacsInstances, setPacsInstances] = useState([]);

    const handleAnalyzeInstance = async (instanceId) => {
        setIsAnalyzingRx(true);
        setMessage({ type: 'neutral', text: 'Importando imagen específica...' });
        setRxResults({ report: '', images: [] });
        setAiWorkflowStatus('analyzing');
        
        try {
            // 1. Importar la instancia única
            const importResp = await fetch(`http://${window.location.hostname}:809/api/pacs/import-instance/${instanceId}`, { method: 'POST' });
            if (!importResp.ok) throw new Error("Fallo al importar imagen.");

            setMessage({ type: 'neutral', text: 'Analizando con MedGemma... espera unos segundos.' });
            
            // 2. Analizar con el endpoint existente
            const analyzeResp = await fetch(`http://${window.location.hostname}:809/api/analyze-rx`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    seriesId: instanceId, // Usamos el ID como identificador para logs
                    customPrompt: customSystemPrompt 
                })
            });

            if (analyzeResp.ok) {
                const data = await analyzeResp.json();
                setRxResults(data);
                setMessage({ type: 'success', text: 'Análisis completado exitosamente.' });
            } else {
                const err = await analyzeResp.json();
                setRxResults({ report: `⚠️ **ERROR IA:** ${err.error}\n${err.details}`, images: [] });
                setMessage({ type: 'error', text: 'Error en respuesta de IA.' });
            }
        } catch (error) {
            console.error(error);
            setMessage({ type: 'error', text: `Error: ${error.message}` });
        } finally {
            setIsAnalyzingRx(false);
            setAiWorkflowStatus('idle');
        }
    };
    
    const handleAnalyzeFullStudy = async () => {
        if (!selectedStudy || pacsInstances.length === 0) return;
        
        setIsAnalyzingRx(true);
        setMessage({ type: 'neutral', text: `Iniciando Informe Integral del Estudio (${pacsInstances.length} placas)...` });
        setRxResults({ report: '', images: [] });
        setAiWorkflowStatus('analyzing');
        
        try {
            // 1. Importar TODAS las imágenes del estudio primero
            // Reutilizamos el endpoint de importar serie del estudio completo
            const importResp = await fetch(`http://${window.location.hostname}:809/api/pacs/import-series/${pacsSeries[0].ID}`, { method: 'POST' });
            if (!importResp.ok) throw new Error("Fallo al importar el set completo de imágenes.");

            setMessage({ type: 'neutral', text: 'Generando Mosaico Clínico y analizando... esto tardará un poco más.' });
            
            // 2. Analizar Estudio Completo con MedGemma
            const analyzeResp = await fetch(`http://${window.location.hostname}:809/api/analyze-full-study`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    studyId: selectedStudy.ID,
                    patientName: selectedStudy.PatientMainDicomTags?.PatientName || selectedStudy.MainDicomTags?.PatientName,
                    customPrompt: customSystemPrompt 
                })
            });

            if (analyzeResp.ok) {
                const data = await analyzeResp.json();
                setRxResults(data);
                setMessage({ type: 'success', text: 'Informe Integral completado.' });
            } else {
                const err = await analyzeResp.json();
                setRxResults({ report: `⚠️ **ERROR INTEGRAL:** ${err.error}\n${err.details}`, images: [] });
                setMessage({ type: 'error', text: 'Error en análisis integral.' });
            }
        } catch (error) {
            console.error(error);
            setMessage({ type: 'error', text: `Error: ${error.message}` });
        } finally {
            setIsAnalyzingRx(false);
            setAiWorkflowStatus('idle');
        }
    };

    const [zoomFactor, setZoomFactor] = useState(1.0);
    const [winGral, setWinGral] = useState([0, 2000]);
    const [winLung, setWinLung] = useState([-600, 600]);
    const [winBone, setWinBone] = useState([400, 3000]);
    const [previewUrls, setPreviewUrls] = useState([]);
    const [isPreviewLoading, setIsPreviewLoading] = useState(false);

    const ejecutarSincronizacionGit = async (action) => {
        console.log(`[GIT_SYNC] Iniciando: ${action}`);
        localStorage.setItem('github_token', githubToken);
        setGitLogs(`> INICIANDO PROCESO DE SINCRONIZACIÓN (${action})\n> Conectando con servidor Mon.AI...\n`);
        setShowGitLogModal(true);
        setIsGitLoading(true);
        
        try {
            const resp = await fetch(`http://${window.location.hostname}:809/api/git/${action}`, { 
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token: githubToken })
            });
            const data = await resp.json();
            
            if (resp.ok) {
                setGitLogs(prev => prev + `\n> [ÉXITO] GitHub actualizado correctamente.\n\nSISTEMA:\n${data.output || 'Finalizado.'}`);
            } else {
                setGitLogs(prev => prev + `\n> [ERROR] El servidor respondió con fallo.\n\nDETALLES:\n${data.details || data.error}`);
            }
        } catch (error) {
            setGitLogs(prev => prev + `\n> [FALLO_TOTAL] No hay conexión con el backend.\nVerifica Docker.`);
        } finally {
            setIsGitLoading(false);
        }
    };

    const handleGeneratePreview = async () => {
        setIsPreviewLoading(true);
        try {
            // Importar primero si no hay nada
            if (pacsInstances.length > 0) {
                await fetch(`http://${window.location.hostname}:809/api/pacs/import-series/${pacsSeries[0].ID}`, { method: 'POST' });
            }

            const resp = await fetch(`http://${window.location.hostname}:809/api/preview-mosaico-lmstudio`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    patientName: selectedStudy?.PatientMainDicomTags?.PatientName || selectedStudy?.MainDicomTags?.PatientName || "Paciente",
                    patientAge: selectedStudy?.PatientMainDicomTags?.PatientAge,
                    patientSex: selectedStudy?.PatientMainDicomTags?.PatientSex,
                    studyDescription: selectedStudy?.MainDicomTags?.StudyDescription,
                    zoomFactor,
                    winGral,
                    winLung,
                    winBone
                })
            });
            if (resp.ok) {
                const data = await resp.json();
                setPreviewUrls(data.previewUrls.map(url => `http://${window.location.hostname}:809${url}`));
            }
        } catch (error) {
            console.error(error);
        } finally {
            setIsPreviewLoading(false);
        }
    };

    const handleAnalyzeLMStudio = async (instanceId = null) => {
        setIsAnalyzingRx(true);
        setMessage({ type: 'neutral', text: 'Enviando a LM Studio con zoom personalizado...' });
        setRxResults({ report: '', images: [] });
        setAiWorkflowStatus('analyzing');
        
        try {
            // 1. Importar la(s) imagen(es)
            let importUrl = `http://${window.location.hostname}:809/api/pacs/import-series/${pacsSeries[0].ID}`;
            if (instanceId) {
                importUrl = `http://${window.location.hostname}:809/api/pacs/import-instance/${instanceId}`;
            }
            const importResp = await fetch(importUrl, { method: 'POST' });
            if (!importResp.ok) throw new Error("Fallo al importar imágenes.");

            setMessage({ type: 'neutral', text: 'Análisis en curso en LM Studio...' });
            
            const analyzeResp = await fetch(`http://${window.location.hostname}:809/api/analyze-rx-lmstudio`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    patientName: selectedStudy?.PatientMainDicomTags?.PatientName || selectedStudy?.MainDicomTags?.PatientName || "Paciente",
                    patientAge: selectedStudy?.PatientMainDicomTags?.PatientAge,
                    patientSex: selectedStudy?.PatientMainDicomTags?.PatientSex,
                    studyDescription: selectedStudy?.MainDicomTags?.StudyDescription,
                    zoomFactor: zoomFactor,
                    customPrompt: customSystemPrompt,
                    winGral,
                    winLung,
                    winBone
                })
            });

            if (analyzeResp.ok) {
                const data = await analyzeResp.json();
                setRxResults(data);
                setMessage({ type: 'success', text: 'Análisis LM Studio completado.' });
            } else {
                const err = await analyzeResp.json();
                setRxResults({ report: `⚠️ **ERROR LM STUDIO:** ${err.error}\n${err.details}`, images: [] });
                setMessage({ type: 'error', text: 'Error en respuesta de LM Studio.' });
            }
        } catch (error) {
            console.error(error);
            setMessage({ type: 'error', text: `Error: ${error.message}` });
        } finally {
            setIsAnalyzingRx(false);
            setAiWorkflowStatus('idle');
        }
    };

    const handleImportSeries = async (series) => {
        setPacsLoading(true);
        setMessage({ type: 'neutral', text: `Importando serie ${series.MainDicomTags.SeriesNumber} desde PACS...` });
        try {
            const response = await fetch(`http://${window.location.hostname}:809/api/pacs/import-series/${series.ID}`, {
                method: 'POST'
            });
            if (response.ok) {
                setMessage({ type: 'success', text: 'Serie importada correctamente. Lista para convertir.' });
                setSelectedSeriesInfo({
                    id: series.ID,
                    number: series.MainDicomTags.SeriesNumber,
                    description: series.MainDicomTags.SeriesDescription,
                    count: series.Instances.length
                });
                setShowPacsModal(false);
                setSelectedStudy(null);
                setPacsSeries([]);
                setLastConvertedFile(null); // Clear previous if any
            } else {
                setMessage({ type: 'error', text: 'Error al importar desde PACS' });
            }
        } catch (error) {
            console.error(error);
            setMessage({ type: 'error', text: 'Error de conexión con el PACS' });
        } finally {
            setPacsLoading(false);
        }
    };

    const handlePushToPacs = async (filePath) => {
        setIsConverting(true);
        setMessage({ type: 'neutral', text: 'Sincronizando y enviando inferencia al PACS Orthanc...' });
        const timer = startProgressTimer(95, 12000);
        try {
            const response = await fetch(`http://${window.location.hostname}:809/api/pacs/push-inference`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath })
            });
            if (response.ok) {
                setProgress(100);
                const data = await response.json();
                setMessage({ type: 'success', text: `¡Éxito! Se enviaron ${data.uploaded} imágenes al PACS.` });
            } else {
                setMessage({ type: 'error', text: 'Fallo al enviar al PACS.' });
            }
        } catch (error) {
            console.error(error);
            setMessage({ type: 'error', text: 'Error de conexión.' });
        } finally {
            clearInterval(timer);
            setIsConverting(false);
            setTimeout(() => setProgress(0), 1000);
        }
    };

    const handlePushMedicalObject = async (filePath) => {
        setIsConverting(true);
        setMessage({ type: 'neutral', text: 'Generando y enviando objeto médico DICOM-SEG...' });
        const timer = startProgressTimer(95, 5000);
        try {
            const response = await fetch(`http://${window.location.hostname}:809/api/pacs/push-medical-object`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath })
            });
            if (response.ok) {
                setProgress(100);
                const data = await response.json();
                setMessage({ type: 'success', text: '¡Éxito! Objeto DICOM-SEG enviado al PACS.' });
            } else {
                setMessage({ type: 'error', text: 'Fallo al enviar objeto médico al PACS.' });
            }
        } catch (error) {
            console.error(error);
            setMessage({ type: 'error', text: 'Error de conexión.' });
        } finally {
            clearInterval(timer);
            setIsConverting(false);
            setTimeout(() => setProgress(0), 1000);
        }
    };


    return (
        <DicomProvider>
            <div className="app-container" style={{ display: 'flex', minHeight: '100vh', width: '100vw', overflow: 'hidden' }}>
                {/* Global Minimalist Sidebar */}
                <div className="bg-slate-900 border-r border-slate-700/50 flex flex-col items-center py-6 gap-6 w-[70px] shrink-0 z-20 shadow-2xl h-screen">
                    <div className="mb-4">
                        <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-500/20">
                            <Activity size={22} color="white" />
                        </div>
                    </div>
                    
                    <nav className="flex flex-col gap-4">
                        {[
                            { id: 'dicom', icon: UploadCloud, title: 'Importar DICOM' },
                            { id: 'inferencia', icon: Cpu, title: 'Inferencia AI' },
                            { id: 'resultados', icon: FileSearch, title: 'Resultados' },
                            { id: 'radiografia', icon: Stethoscope, title: 'Radiografías (MedGemma)' },
                            { id: 'pacs-vantio', icon: Server, title: 'PACS Vantio' },
                            { id: 'espinografia', icon: Layers, title: 'Espinografías RX' },
                            { id: 'orthanc', icon: Database, title: 'PACS Orthanc' }
                        ].map((item) => (
                            <button 
                                key={item.id}
                                onClick={() => setActiveTab(item.id)} 
                                title={item.title}
                                className={`p-3 rounded-xl transition-all duration-300 group ${activeTab === item.id ? 'bg-indigo-600 text-white shadow-[0_0_15px_rgba(79,70,229,0.4)] scale-110' : 'text-slate-500 hover:text-white hover:bg-slate-800'}`}
                            >
                                <item.icon size={24} className={activeTab === item.id ? '' : 'group-hover:scale-110 transition-transform'} />
                            </button>
                        ))}
                    </nav>

                    <div className="mt-auto flex flex-col gap-4">
                        <button 
                            onClick={() => setActiveTab('config')} 
                            title="Configuración"
                            className={`p-3 rounded-xl transition-all duration-300 group ${activeTab === 'config' ? 'bg-slate-700 text-white' : 'text-slate-500 hover:text-white hover:bg-slate-800'}`}
                        >
                            <Settings size={22} />
                        </button>
                    </div>
                </div>

                {/* Second Level Sidebar (For Espinografías slots) */}
                {activeTab === 'espinografia' && (
                    <ErrorBoundary>
                        <EspinografiaSidebar />
                    </ErrorBoundary>
                )}

                {/* Main View Area */}
                {activeTab === 'orthanc' ? (
                    <div className="flex-1 bg-white h-screen">
                        <iframe 
                            src={`http://${window.location.hostname}:8282/ui/app/`} 
                            style={{ width: '100%', height: '100%', border: 'none' }}
                            title="Orthanc Explorer 2"
                        />
                    </div>
                ) : activeTab === 'espinografia' ? (
                    <ErrorBoundary>
                        <Viewer />
                    </ErrorBoundary>
                ) : (
                    <main className="main-content flex-1 h-screen overflow-y-auto" style={{ position: 'relative' }}>
                        {progress > 0 && (
                            <div style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                width: '100%',
                                height: '4px',
                                backgroundColor: '#e2e8f0',
                                zIndex: 1000
                            }}>
                                <div style={{
                                    width: `${progress}%`,
                                    height: '100%',
                                    backgroundColor: '#4f46e5',
                                    backgroundImage: 'linear-gradient(90deg, #4f46e5, #818cf8)',
                                    transition: 'width 0.3s ease-out',
                                    boxShadow: '0 0 10px rgba(79, 70, 229, 0.5)'
                                }}></div>
                            </div>
                        )}
                        {/* Header y navegación general eliminados */}

                <section className="content-body">
                    {activeTab === 'dicom' && (
                        <div className="card">
                            <h3>Convertidor de Series DICOM</h3>
                            <p>Selecciona una serie tomográfica para convertirla al formato estándar de medicina NIfTI (.nii.gz) para procesamiento con MONAI.</p>

                            {selectedSeriesInfo && (
                                <div style={{ backgroundColor: '#f0f9ff', border: '1px solid #bae6fd', padding: '10px', borderRadius: '8px', marginBottom: '15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <div className="text-[10px] font-bold text-blue-600 uppercase">Serie Seleccionada</div>
                                        <div className="font-bold"># {selectedSeriesInfo.number} - {selectedSeriesInfo.description}</div>
                                        <div className="text-xs text-slate-500">{selectedSeriesInfo.count} imágenes listas para procesar</div>
                                    </div>
                                    <button onClick={() => setSelectedSeriesInfo(null)} className="text-slate-400 hover:text-red-500">&times;</button>
                                </div>
                            )}

                            <div className="import-zone">
                                <FileBox size={48} color="#64748b" />
                                <p>Arrastra tu serie DICOM (.zip o archivos .dcm) o haz clic abajo.</p>

                                <input
                                    type="file"
                                    id="dicom-upload"
                                    style={{ display: 'none' }}
                                    multiple
                                    onChange={handleFileUpload}
                                    accept="*"
                                />

                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <button
                                        className="btn btn-secondary"
                                        onClick={() => document.getElementById('dicom-upload').click()}
                                        disabled={isUploading}
                                    >
                                        {isUploading ? 'Subiendo...' : 'Seleccionar Archivos'}
                                    </button>

                                    <button
                                        className="btn btn-secondary"
                                        onClick={() => {
                                            setShowPacsModal(true);
                                            handleSearchPacs();
                                        }}
                                        style={{ backgroundColor: '#ebf5ff', color: '#1e40af', border: '1px solid #bfdbfe' }}
                                    >
                                        <Database size={18} style={{ marginRight: '6px' }} /> Traer de PACS
                                    </button>

                                    <button
                                        className="btn btn-primary"
                                        onClick={handleConvert}
                                        disabled={isConverting || isUploading}
                                    >
                                        {isConverting ? 'Procesando...' : 'Convertir a NIfTI'}
                                    </button>

                                    {lastConvertedFile && (
                                        <a
                                            href={`http://${window.location.hostname}:809/api/download-input/${lastConvertedFile}`}
                                            download
                                            className="btn btn-secondary"
                                            style={{ backgroundColor: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', textDecoration: 'none' }}
                                        >
                                            <UploadCloud size={18} style={{ transform: 'rotate(180deg)' }} /> Descargar .nii.gz
                                        </a>
                                    )}
                                </div>
                            </div>

                            {message.text && activeTab === 'dicom' && (
                                <div className={`badge badge-${message.type}`} style={{ display: 'flex', marginTop: '20px', padding: '12px', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                        {message.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                                        <span style={{ marginLeft: '8px' }}>{message.text}</span>
                                    </div>
                                    {progress > 0 && progress < 100 && (
                                        <div style={{ fontSize: '11px', fontWeight: 'bold', backgroundColor: 'rgba(255,255,255,0.15)', padding: '2px 6px', borderRadius: '4px' }}>
                                            {Math.round(progress)}%
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'pacs-vantio' && (
                        <div className="vantio-pacs-container animate-in fade-in duration-500">
                            <div className="flex justify-between items-center mb-6">
                                <div>
                                    <h2 className="text-2xl font-black text-slate-800 tracking-tight flex items-center gap-2">
                                        <Database className="text-blue-600" size={24} /> PACS Vantio Clinical Explorer
                                    </h2>
                                    <p className="text-slate-500 text-sm">Gestiona y analiza estudios directamente desde el archivo central de imágenes</p>
                                </div>
                                <div className="flex gap-2">
                                    <button onClick={handleSearchVantio} className="btn-icon bg-white shadow-sm border border-slate-200 p-2 rounded-lg hover:bg-blue-50 text-blue-600 transition-all">
                                        <Activity size={20} className={vantioLoading ? 'animate-spin' : ''} />
                                    </button>
                                </div>
                            </div>

                            <div className="bg-white rounded-2xl shadow-xl shadow-slate-200/50 border border-slate-200 overflow-hidden min-h-[600px] transition-all duration-500">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm border-collapse">
                                        <thead>
                                            {/* Encabezados Principales */}
                                            <tr className="bg-slate-50 text-slate-500 text-[11px] font-black uppercase tracking-wider border-b border-slate-200">
                                                <th className="px-3 py-3 w-10 text-center"></th>
                                                <th className="px-3 py-3">Nombre del paciente</th>
                                                <th className="px-3 py-3">ID del paciente</th>
                                                <th className="px-3 py-3">Fecha estudio</th>
                                                <th className="px-3 py-3">Descripción</th>
                                                <th className="px-3 py-3">Modalidad</th>
                                                <th className="px-3 py-3 text-center">Series/Imag.</th>
                                                <th className="px-3 py-3"></th>
                                            </tr>
                                            {/* Fila de Filtros */}
                                            <tr className="bg-slate-100/50 border-b border-slate-200">
                                                <th className="p-2 border-r border-slate-200/50">
                                                    <button onClick={() => { setVantioSearch({patientName:'', patientId:'', patientBirthDate:'', studyDate:'', studyDescription:'', modality:'', accessionNumber:''}); setTimeout(handleSearchVantio, 0); }} className="w-6 h-6 rounded-full bg-white border border-slate-200 flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors shadow-sm">&times;</button>
                                                </th>
                                                <th className="p-2 border-r border-slate-200/50"><input type="text" placeholder="Nombre..." className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs outline-none" value={vantioSearch.patientName} onChange={(e) => setVantioSearch({...vantioSearch, patientName: e.target.value})} onKeyDown={(e) => e.key === 'Enter' && handleSearchVantio()} /></th>
                                                <th className="p-2 border-r border-slate-200/50"><input type="text" placeholder="ID..." className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs outline-none" value={vantioSearch.patientId} onChange={(e) => setVantioSearch({...vantioSearch, patientId: e.target.value})} onKeyDown={(e) => e.key === 'Enter' && handleSearchVantio()} /></th>
                                                <th className="p-2 border-r border-slate-200/50"><input type="text" placeholder="Fecha..." className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs outline-none" value={vantioSearch.studyDate} onChange={(e) => setVantioSearch({...vantioSearch, studyDate: e.target.value})} onKeyDown={(e) => e.key === 'Enter' && handleSearchVantio()} /></th>
                                                <th className="p-2 border-r border-slate-200/50"><input type="text" placeholder="Descr..." className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs outline-none" value={vantioSearch.studyDescription} onChange={(e) => setVantioSearch({...vantioSearch, studyDescription: e.target.value})} onKeyDown={(e) => e.key === 'Enter' && handleSearchVantio()} /></th>
                                                <th className="p-2 border-r border-slate-200/50">
                                                    <select className="w-full bg-white border border-slate-200 rounded px-2 py-1 text-xs outline-none" value={vantioSearch.modality} onChange={(e) => { setVantioSearch({...vantioSearch, modality: e.target.value}); setTimeout(handleSearchVantio, 0); }}>
                                                        <option value="">Todas</option><option value="CT">CT</option><option value="DX">DX</option><option value="MR">MR</option>
                                                    </select>
                                                </th>
                                                <th colSpan="2" className="p-2">
                                                    <button onClick={handleSearchVantio} className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-1 px-2 rounded text-[10px] uppercase shadow-md transition-all active:scale-95">Buscar</button>
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {vantioStudies.length === 0 ? (
                                                <tr><td colSpan="8" className="px-6 py-20 text-center text-slate-400 italic">Buscando estudios...</td></tr>
                                            ) : (
                                                vantioStudies.map((study) => (
                                                    <React.Fragment key={study.ID}>
                                                        {/* Fila del Estudio */}
                                                        <tr 
                                                            onClick={() => handleSelectVantioStudy(study)} 
                                                            className={`group border-l-4 transition-all hover:bg-blue-50/20 cursor-pointer ${selectedVantioStudy?.ID === study.ID ? 'bg-blue-50/50 border-blue-500 shadow-sm' : 'border-transparent'}`}
                                                        >
                                                            <td className="px-2 py-3 text-center">
                                                                <input type="checkbox" className="rounded" checked={selectedVantioStudy?.ID === study.ID} readOnly />
                                                            </td>
                                                            <td className="px-3 py-3 font-bold text-slate-900">{study.PatientMainDicomTags?.PatientName || 'Unknown'}</td>
                                                            <td className="px-3 py-3 font-mono text-xs text-blue-600">{study.PatientMainDicomTags?.PatientID || 'S/ID'}</td>
                                                            <td className="px-3 py-3 text-slate-600 text-[11px] font-bold">{study.MainDicomTags?.StudyDate || 'N/A'}</td>
                                                            <td className="px-3 py-3 text-slate-600 truncate max-w-[150px]">{study.MainDicomTags?.StudyDescription || '--'}</td>
                                                            <td className="px-3 py-3">
                                                                <span className="bg-blue-100/50 text-blue-700 px-1.5 py-0.5 rounded text-[9px] font-black">{study.ModalitiesInStudy || "UN"}</span>
                                                            </td>
                                                            <td className="px-3 py-3 text-center text-xs font-bold text-slate-500">{study.Series?.length || 0} / {study.Instances?.length || 0}</td>
                                                            <td className="px-3 py-3 text-right">
                                                                {selectedVantioStudy?.ID === study.ID ? <ChevronUp size={16} className="text-blue-600" /> : <ChevronDown size={16} className="text-slate-400" />}
                                                            </td>
                                                        </tr>

                                                        {/* FRAME DE DETALLE (INYECTADO ABAJO) */}
                                                        {selectedVantioStudy?.ID === study.ID && (
                                                            <tr className="bg-[#E9E9E9] animate-in slide-in-from-top duration-500">
                                                                <td colSpan="8" className="p-0 border-y border-slate-300">
                                                                    <div className="flex flex-col shadow-inner">
                                                                        {/* Contenido del Detalle del Estudio */}
                                                                        <div className="p-0">

                                                                                <div className="grid grid-cols-12 gap-8 items-start">
                                                                                    <div className="col-span-11 bg-white p-6 rounded-xl border border-slate-200 shadow-sm grid grid-cols-2 gap-x-12 gap-y-1.5 text-[12px]">
                                                                                        {/* Columna Izquierda */}
                                                                                        <div className="space-y-1.5 pr-4 border-r border-slate-100">
                                                                                            {[
                                                                                                { label: "Fecha del estudio:", value: selectedVantioStudy.MainDicomTags?.StudyDate },
                                                                                                { label: "Hora de estudio:", value: selectedVantioStudy.MainDicomTags?.StudyTime },
                                                                                                { label: "Descripción del estudio:", value: selectedVantioStudy.MainDicomTags?.StudyDescription },
                                                                                                { label: "Número de acceso:", value: selectedVantioStudy.MainDicomTags?.AccessionNumber },
                                                                                                { label: "Identificación del estudio:", value: selectedVantioStudy.MainDicomTags?.StudyID },
                                                                                                { label: "Study Instance UID:", value: selectedVantioStudy.MainDicomTags?.StudyInstanceUID },
                                                                                                { label: "Médico solicitante:", value: selectedVantioStudy.MainDicomTags?.RequestingPhysician || "--" },
                                                                                                { label: "Nombre del médico de referencia:", value: selectedVantioStudy.MainDicomTags?.ReferringPhysicianName || "--" },
                                                                                                { label: "Nombre de la Institucion:", value: selectedVantioStudy.MainDicomTags?.InstitutionName || "CLINICA DEL VALLE" },
                                                                                            ].map((row, i) => (
                                                                                                <div key={i} className="flex justify-between items-center group/row py-0.5">
                                                                                                    <span className="text-slate-800 font-bold whitespace-nowrap">{row.label}</span>
                                                                                                    <div className="flex items-center gap-1.5 overflow-hidden">
                                                                                                        <span className="text-slate-600 font-medium truncate">{row.value}</span>
                                                                                                        <Copy 
                                                                                                            size={11} 
                                                                                                            className="text-slate-300 opacity-0 group-hover/row:opacity-100 cursor-pointer hover:text-blue-500 transition-all" 
                                                                                                            onClick={() => navigator.clipboard.writeText(row.value)}
                                                                                                        />
                                                                                                    </div>
                                                                                                </div>
                                                                                            ))}
                                                                                        </div>

                                                                                        {/* Columna Derecha */}
                                                                                        <div className="space-y-1.5 pl-4">
                                                                                             <div className="flex flex-col h-full">
                                                                                                {[
                                                                                                    { label: "ID del paciente:", value: selectedVantioStudy.PatientMainDicomTags?.PatientID },
                                                                                                    { label: "Nombre del paciente:", value: selectedVantioStudy.PatientMainDicomTags?.PatientName },
                                                                                                    { label: "Fecha de nacimiento del paciente:", value: selectedVantioStudy.PatientMainDicomTags?.PatientBirthDate },
                                                                                                    { label: "Sexo del paciente:", value: selectedVantioStudy.PatientMainDicomTags?.PatientSex || "F" },
                                                                                                    { label: "OtherPatientIDs:", value: selectedVantioStudy.PatientMainDicomTags?.OtherPatientIDs || "--" },
                                                                                                ].map((row, i) => (
                                                                                                    <div key={i} className="flex justify-between items-center group/row py-0.5">
                                                                                                        <span className="text-slate-800 font-bold whitespace-nowrap">{row.label}</span>
                                                                                                        <div className="flex items-center gap-1.5 overflow-hidden">
                                                                                                            <span className="text-slate-600 font-medium truncate">{row.value}</span>
                                                                                                            <Copy 
                                                                                                                size={11} 
                                                                                                                className="text-slate-300 opacity-0 group-hover/row:opacity-100 cursor-pointer hover:text-blue-500 transition-all" 
                                                                                                                onClick={() => navigator.clipboard.writeText(row.value)}
                                                                                                            />
                                                                                                        </div>
                                                                                                    </div>
                                                                                                ))}
                                                                                                <p className="text-slate-500 text-[11px] mt-auto italic pt-4 border-t border-slate-100">Este paciente no tiene otros estudios.</p>
                                                                                             </div>
                                                                                        </div>
                                                                                    </div>

                                                                                    {/* Buttons Area on the Right - Simplified to 3 */}
                                                                                    <div className="col-span-1 mt-6 flex flex-row gap-2 justify-center">
                                                                                        {[Eye, FileText, Activity].map((Icon, idx) => (
                                                                                            <button 
                                                                                                key={idx} 
                                                                                                onClick={(e) => {
                                                                                                    if (Icon === Eye) {
                                                                                                        e.stopPropagation();
                                                                                                        const studyUID = selectedVantioStudy.MainDicomTags?.StudyInstanceUID;
                                                                                                        window.open(`http://${window.location.hostname}:8282/ohif/viewer?StudyInstanceUIDs=${studyUID}`, '_blank');
                                                                                                    }
                                                                                                }}
                                                                                                className="w-10 h-10 flex items-center justify-center rounded bg-slate-700 hover:bg-blue-600 text-white shadow-sm transition-all active:scale-95"
                                                                                            >
                                                                                                <Icon size={18} />
                                                                                            </button>
                                                                                        ))}
                                                                                    </div>
                                                                                    </div>
                                                                                </div>

                                                                            {/* Tabla de Series */}
                                                                            <div className="mt-4 bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                                                                                <table className="w-full text-xs">
                                                                                    <thead>
                                                                                        <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 font-bold">
                                                                                            <th className="px-4 py-2 text-left">Número de serie</th>
                                                                                            <th className="px-4 py-2 text-left">Descripción de la serie</th>
                                                                                            <th className="px-4 py-2 text-center">Modalidad</th>
                                                                                            <th className="px-4 py-2 text-right"># Elementos</th>
                                                                                            <th className="px-4 py-2"></th>
                                                                                        </tr>
                                                                                    </thead>
                                                                                    <tbody className="divide-y divide-slate-100">
                                                                                        {vantioSeries.map(series => (
                                                                                            <tr key={series.ID} className="hover:bg-blue-50/30 transition-colors group">
                                                                                                <td className="px-4 py-3 font-mono text-slate-400">{series.MainDicomTags?.SeriesNumber || '--'}</td>
                                                                                                <td className="px-4 py-3 font-bold text-slate-800 uppercase">{series.MainDicomTags?.SeriesDescription || 'Untitled Series'}</td>
                                                                                                <td className="px-4 py-3 text-center"><span className="bg-slate-100 px-2 py-0.5 rounded font-black">{series.MainDicomTags?.Modality}</span></td>
                                                                                                <td className="px-4 py-3 text-right font-mono font-bold text-blue-600">{series.Instances?.length}</td>
                                                                                                <td className="px-4 py-3 text-right">
                                                                                                    <div className="flex gap-2 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                                                                                                        <button onClick={() => { handleImportSeries(series); setActiveTab('dicom'); }} className="bg-blue-600 hover:bg-blue-700 text-white text-[10px] font-bold px-3 py-1 rounded-lg">Importar</button>
                                                                                                        <button onClick={() => { handleSelectStudy(selectedVantioStudy); setActiveTab('resultados'); }} className="bg-slate-800 hover:bg-black text-white text-[10px] font-bold px-3 py-1 rounded-lg">Analizar IA</button>
                                                                                                    </div>
                                                                                                </td>
                                                                                            </tr>
                                                                                        ))}
                                                                                    </tbody>
                                                                                </table>
                                                                            </div>
                                                                        </div>
                                                                </td>
                                                            </tr>
                                                        )}
                                                    </React.Fragment>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'radiografia' && (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="card h-fit">
                                <div className="flex justify-between items-center mb-4">
                                    <h3>Buscador PACS (DX/CR)</h3>
                                    <button 
                                        className="btn btn-primary btn-sm"
                                        onClick={() => handleSearchRxPacs()}
                                        disabled={pacsLoading}
                                    >
                                        Actualizar Lista
                                    </button>
                                </div>
                                <div style={{ display: 'flex', gap: '8px', marginBottom: '15px' }}>
                                    <input 
                                        type="text" 
                                        className="input flex-1" 
                                        placeholder="Nombre del paciente..."
                                        value={pacsSearchPatient}
                                        onChange={(e) => setPacsSearchPatient(e.target.value.toUpperCase())}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSearchRxPacs()}
                                    />
                                    <input 
                                        type="text" 
                                        className="input w-32" 
                                        placeholder="AAAAMMDD"
                                        value={pacsSearchDate}
                                        onChange={(e) => setPacsSearchDate(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleSearchRxPacs()}
                                    />
                                </div>

                                <div className="max-h-[500px] overflow-y-auto border border-slate-200 rounded-lg">
                                    <table className="w-full text-sm">
                                        <thead className="bg-slate-50 sticky top-0">
                                            <tr>
                                                <th className="p-3 text-left">Paciente / Fecha</th>
                                                <th className="p-3 text-left">Estudio</th>
                                                <th className="p-3 text-right">Acción</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {pacsStudies.length === 0 ? (
                                                <tr><td colSpan="3" className="p-8 text-center text-slate-400 italic">No hay estudios RX cargados hoy</td></tr>
                                            ) : (
                                                pacsStudies.map(study => (
                                                    <tr key={study.ID} className="border-t hover:bg-slate-50 transition-colors" onClick={() => handleSelectStudy(study)} style={{ cursor: 'pointer' }}>
                                                        <td className="p-3">
                                                            <div className="font-bold text-indigo-700">
                                                                {study.PatientMainDicomTags?.PatientName || study.MainDicomTags?.PatientName || study.ID.substring(0,8)}
                                                            </div>
                                                            <div className="text-[10px] text-slate-500 flex flex-col gap-0.5">
                                                                <div className="flex items-center gap-1.5">
                                                                    <span className="bg-slate-100 px-1 rounded font-medium text-slate-600">ID: {study.PatientMainDicomTags?.PatientID || study.MainDicomTags?.PatientID || "S/N"}</span>
                                                                    <span>•</span>
                                                                    <span>{study.MainDicomTags?.StudyDate || "Sin Fecha"}</span>
                                                                </div>
                                                                <div className="flex items-center gap-1.5 opacity-80">
                                                                    <span className="uppercase">{study.PatientMainDicomTags?.PatientSex || "S/X"}</span>
                                                                    <span>•</span>
                                                                    <span>{study.PatientMainDicomTags?.PatientAge || "Edad N/A"}</span>
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="p-3">
                                                            <div className="truncate max-w-[200px]">{study.MainDicomTags.StudyDescription}</div>
                                                            <div className="text-[10px] text-blue-600 font-bold">{study.MainDicomTags.ModalitiesInStudy}</div>
                                                        </td>
                                                        <td className="p-3 text-right">
                                                            {selectedStudy?.ID === study.ID ? (
                                                                <span className="text-blue-600 font-bold text-xs">Seleccionado</span>
                                                            ) : (
                                                                <button className="btn btn-secondary btn-sm">Ver Series</button>
                                                            )}
                                                        </td>
                                                    </tr>
                                                ))
                                            )}
                                        </tbody>
                                    </table>
                                </div>

                                {selectedStudy && (
                                    <div className="mt-4 p-4 bg-blue-50/50 border border-blue-100 rounded-xl">
                                        <div className="flex justify-between items-center mb-3">
                                            <h4 className="text-blue-800 text-sm font-bold">Imágenes del Estudio</h4>
                                            <div className="flex gap-2">
                                                <button 
                                                    className="bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] px-3 py-1 rounded-full font-bold shadow-lg shadow-indigo-200 transition-all flex items-center gap-1"
                                                    onClick={handleAnalyzeFullStudy}
                                                    disabled={isAnalyzingRx || pacsInstances.length === 0}
                                                >
                                                    <Activity size={12} /> INFORME INTEGRAL
                                                </button>
                                                <button 
                                                    className="bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] px-3 py-1 rounded-full font-bold shadow-lg shadow-emerald-200 transition-all flex items-center gap-1"
                                                    onClick={() => handleAnalyzeLMStudio()}
                                                    disabled={isAnalyzingRx || pacsInstances.length === 0}
                                                >
                                                    <Server size={12} /> LM STUDIO
                                                </button>
                                                <span className="text-[10px] bg-blue-100 text-blue-600 px-2 py-1 rounded-full font-bold">
                                                    {pacsInstances.length} RX
                                                </span>
                                            </div>
                                        </div>
                                        
                                        {/* PREVIEW SIN ZOOM */}
                                        <div className="bg-gray-50 border-t border-gray-100 p-4 rounded-xl mb-4">
                                            <div className="flex justify-between items-center">
                                                <span className="text-[10px] font-bold text-gray-500 uppercase flex items-center gap-1">
                                                    <Activity size={12} /> Análisis de Ventanas (Ventanéo)
                                                </span>
                                                <button 
                                                    className="text-[10px] bg-emerald-600 border border-emerald-500 px-4 py-1.5 rounded-md font-bold text-white hover:bg-emerald-700 flex items-center gap-1 shadow-sm transition-all"
                                                    onClick={handleGeneratePreview}
                                                    disabled={isPreviewLoading}
                                                >
                                                    {isPreviewLoading ? 'GENERANDO...' : 'REVISAR VENTANAS (PREVIEW)'}
                                                </button>
                                            </div>

                                            {previewUrls.length > 0 && (
                                                <div className="space-y-4 mt-6 pt-4 border-t border-gray-200">
                                                    <div className="grid grid-cols-3 gap-2">
                                                        {previewUrls.map((url, idx) => (
                                                            <div key={idx} className="relative group rounded-lg overflow-hidden border border-emerald-100 shadow-sm bg-black">
                                                                <img 
                                                                    src={url} 
                                                                    alt={`Preview Windows ${idx}`} 
                                                                    className="w-full h-auto object-contain max-h-[250px] transition-all hover:scale-105"
                                                                    loading="lazy"
                                                                />
                                                                <div className="absolute bottom-0 inset-x-0 bg-black/60 text-white text-[7px] font-bold py-1 text-center uppercase tracking-widest">
                                                                    {idx === 0 ? 'General' : idx === 1 ? 'Pulmón' : 'Hueso'}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>

                                                    {/* CONTROLES DE VENTANA (HU) */}
                                                    <div className="grid grid-cols-3 gap-4 bg-white p-3 rounded-xl border border-gray-100 shadow-sm">
                                                        {[
                                                            { label: 'Visión Gral (HU)', state: winGral, set: setWinGral, def: [0, 2000] },
                                                            { label: 'Ventana Pulmón (HU)', state: winLung, set: setWinLung, def: [-600, 600] },
                                                            { label: 'Ventana Hueso (HU)', state: winBone, set: setWinBone, def: [400, 3000] }
                                                        ].map((cfg, i) => (
                                                            <div key={i} className="flex flex-col gap-2">
                                                                <span className="text-[9px] font-bold text-gray-400 uppercase tracking-tighter">{cfg.label}</span>
                                                                <div className="space-y-1">
                                                                    <div className="flex justify-between text-[8px] font-mono text-emerald-600">
                                                                        <div className="flex flex-col">
                                                                            <span>Low:</span>
                                                                            <input 
                                                                                type="number" value={cfg.state[0]} 
                                                                                className="w-12 bg-gray-50 border-none p-0 text-[10px] focus:ring-0"
                                                                                onChange={(e) => cfg.set([parseInt(e.target.value) || 0, cfg.state[1]])}
                                                                            />
                                                                        </div>
                                                                        <div className="flex flex-col items-end">
                                                                            <span>High:</span>
                                                                            <input 
                                                                                type="number" value={cfg.state[1]} 
                                                                                className="w-12 bg-gray-50 border-none p-0 text-[10px] text-right focus:ring-0"
                                                                                onChange={(e) => cfg.set([cfg.state[0], parseInt(e.target.value) || 0])}
                                                                            />
                                                                        </div>
                                                                    </div>
                                                                    <input 
                                                                        type="range" min="-1000" max="4000" step="50" value={cfg.state[0]} 
                                                                        onChange={(e) => cfg.set([parseInt(e.target.value), cfg.state[1]])}
                                                                        className="w-full h-1 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-emerald-400"
                                                                    />
                                                                    <input 
                                                                        type="range" min="-1000" max="4000" step="50" value={cfg.state[1]} 
                                                                        onChange={(e) => cfg.set([cfg.state[0], parseInt(e.target.value)])}
                                                                        className="w-full h-1 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-emerald-600"
                                                                    />
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                            {pacsInstances.map((instId, index) => (
                                                <div key={instId} className="bg-white p-2 rounded-lg border border-blue-100 shadow-sm flex flex-col group hover:ring-2 hover:ring-blue-400 transition-all">
                                                    <div className="aspect-square bg-black rounded overflow-hidden relative mb-2">
                                                        <img 
                                                            src={`http://${window.location.hostname}:8282/instances/${instId}/preview`} 
                                                            alt={`Img ${index}`} 
                                                            className="w-full h-full object-contain opacity-90 group-hover:opacity-100 transition-opacity"
                                                            loading="lazy"
                                                        />
                                                        <div className="absolute top-1 left-1 bg-black/60 text-white text-[9px] px-1.5 py-0.5 rounded font-mono">
                                                            IMG {index + 1}
                                                        </div>
                                                    </div>
                                                    <button 
                                                        className="btn btn-primary btn-sm w-full py-1.5 text-[11px]"
                                                        onClick={() => handleAnalyzeInstance(instId)}
                                                        disabled={isAnalyzingRx}
                                                    >
                                                        {isAnalyzingRx ? '...' : 'Analizar RX'}
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="card">
                                <div className="border-b border-slate-100 pb-4 mb-4">
                                    <div className="flex justify-between items-center mb-3">
                                        <h3 style={{ margin: 0 }}>Workflow de Análisis IA</h3>
                                        <div className={`text-[10px] px-2 py-1 rounded font-bold uppercase ${
                                            aiWorkflowStatus === 'idle' ? 'bg-slate-100 text-slate-500' :
                                            aiWorkflowStatus === 'ready' ? 'bg-green-100 text-green-600' :
                                            'bg-blue-100 text-blue-600 animate-pulse'
                                        }`}>
                                            Status: {aiWorkflowStatus}
                                        </div>
                                    </div>
                                    
                                    <div className="flex flex-wrap gap-2">
                                        {/* PASO 1: PREPARAR */}
                                        <button 
                                            onClick={handlePrewarmAi}
                                            disabled={aiWorkflowStatus !== 'idle'}
                                            className={`flex-1 py-3 px-2 rounded-xl border flex flex-col items-center gap-1 transition-all ${
                                                aiWorkflowStatus === 'idle' 
                                                ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100' 
                                                : 'bg-slate-50 border-slate-100 text-slate-400 opacity-50'
                                            }`}
                                        >
                                            <span className="text-xs font-bold font-mono">PASO 1</span>
                                            <span className="text-[10px] uppercase font-bold">Preparar IA (Cargar Model)</span>
                                        </button>

                                        {/* PASO 2: ANALIZAR (Este se activa desde la tabla, pero aquí ponemos el status si hay algo seleccionado) */}
                                        <button 
                                            disabled={true}
                                            className={`flex-1 py-3 px-2 rounded-xl border flex flex-col items-center gap-1 opacity-50 bg-slate-50 border-slate-100 text-slate-400`}
                                        >
                                            <span className="text-xs font-bold font-mono">PASO 2</span>
                                            <span className="text-[10px] uppercase font-bold">Ejecutar (vía Tabla PACS)</span>
                                        </button>

                                        {/* PASO 3: LIBERAR */}
                                        <button 
                                            onClick={() => handleClearAiMemory(true)}
                                            className={`flex-1 py-3 px-2 rounded-xl border flex flex-col items-center gap-1 transition-all bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100`}
                                        >
                                            <span className="text-xs font-bold font-mono">PASO 3</span>
                                            <span className="text-[10px] uppercase font-bold">Liberar / Cerrar Sesión</span>
                                        </button>
                                    </div>

                                    <div className="mt-4">
                                        <div className="flex items-center gap-2 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                                            <Settings size={12} /> Directrices del Sistema (System Prompt)
                                        </div>
                                        <textarea 
                                            className="w-full h-24 p-3 bg-white border border-slate-200 rounded-xl text-xs text-slate-600 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 transition-all outline-none resize-none shadow-sm font-medium"
                                            placeholder="Escribe aquí las instrucciones específicas para la IA (p.ej: 'Analiza silueta cardíaca')..."
                                            value={customSystemPrompt}
                                            onChange={(e) => setCustomSystemPrompt(e.target.value)}
                                        />
                                    </div>
                                </div>
                                {!rxResults.report && !isAnalyzingRx ? (
                                    <div className="flex flex-col items-center justify-center p-20 text-slate-300">
                                        <Stethoscope size={64} className="mb-4 opacity-20" />
                                        <p>Selecciona una placa de tórax del PACS para iniciar el análisis clínico automatizado.</p>
                                    </div>
                                ) : isAnalyzingRx ? (
                                    <div className="space-y-6">
                                        <div className="flex flex-col items-center py-10">
                                            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
                                            <p className="text-blue-600 font-medium">{message.text}</p>
                                        </div>
                                        <div className="grid grid-cols-3 gap-2 opacity-30">
                                            <div className="aspect-[3/4] bg-slate-200 rounded animate-pulse"></div>
                                            <div className="aspect-[3/4] bg-slate-200 rounded animate-pulse"></div>
                                            <div className="aspect-[3/4] bg-slate-200 rounded animate-pulse"></div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
                                        {/* Vista previa de ventanas */}
                                        <div className="grid grid-cols-3 gap-2">
                                            {rxResults.images.map((img, idx) => (
                                                <div key={idx} className="relative group cursor-zoom-in">
                                                    <img 
                                                        src={`http://${window.location.hostname}:809${img}`} 
                                                        alt={`Ventaneo ${idx}`}
                                                        className="w-full rounded border border-slate-200 shadow-sm"
                                                    />
                                                    <div className="absolute bottom-1 left-1 bg-black/50 text-[8px] text-white px-1 rounded">
                                                        {idx === 0 ? 'GENERAL' : idx === 1 ? 'PULMÓN' : 'ÓSEA'}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        <div className="p-6 bg-slate-50 border border-slate-200 rounded-xl relative overflow-hidden">
                                            <div className="absolute top-0 right-0 p-4 opacity-5">
                                                <Activity size={120} />
                                            </div>
                                            <div className="prose prose-sm max-w-none text-slate-700 leading-relaxed markdown-content" 
                                                 dangerouslySetInnerHTML={formatMarkdownToHtml(rxResults.report)}>
                                            </div>
                                        </div>

                                        <div className="flex gap-2">
                                            <button className="btn btn-secondary flex-1" onClick={() => window.print()}>Imprimir Informe</button>
                                            <button className="btn btn-primary flex-1" onClick={() => handlePushMedicalObject()}>Sincronizar a PACS</button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Modal Traer de PACS */}
                    {showPacsModal && (
                        <div className="modal-overlay" onClick={(e) => { 
                            if (e.target === e.currentTarget) { 
                                setShowPacsModal(false); 
                                setSelectedStudy(null); 
                                setPacsSeries([]); 
                            } 
                        }}>
                            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '900px' }}>
                                <div className="modal-header">
                                    <h3>Importar Estudio desde PACS Orthanc</h3>
                                    <button className="close-btn" onClick={() => { setShowPacsModal(false); setSelectedStudy(null); setPacsSeries([]); }}>&times;</button>
                                </div>
                                <div className="modal-body">
                                    <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
                                        <div style={{ flex: 1 }}>
                                            <label className="text-[10px] uppercase font-bold text-slate-400 ml-1">Paciente</label>
                                            <input 
                                                type="text" 
                                                className="input w-full" 
                                                placeholder="Ej: JUAN PEREZ" 
                                                value={pacsSearchPatient}
                                                onChange={(e) => setPacsSearchPatient(e.target.value.toUpperCase())}
                                                style={{ padding: '8px', borderRadius: '8px', border: '1px solid #e2e8f0', width: '100%' }}
                                                onKeyDown={(e) => e.key === 'Enter' && handleSearchPacs()}
                                            />
                                        </div>
                                        <div style={{ width: '150px' }}>
                                            <label className="text-[10px] uppercase font-bold text-slate-400 ml-1">Fecha</label>
                                            <input 
                                                type="text" 
                                                className="input w-full" 
                                                placeholder="AAAAMMDD" 
                                                value={pacsSearchDate}
                                                onChange={(e) => setPacsSearchDate(e.target.value)}
                                                style={{ padding: '8px', borderRadius: '8px', border: '1px solid #e2e8f0', width: '100%' }}
                                                onKeyDown={(e) => e.key === 'Enter' && handleSearchPacs()}
                                            />
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                                            <button className="btn btn-primary" onClick={(e) => handleSearchPacs(e)} disabled={pacsLoading}>
                                                {pacsLoading ? '...' : 'Buscar'}
                                            </button>
                                        </div>
                                    </div>

                                    {!selectedStudy ? (
                                        <div className="table-container" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                <thead>
                                                    <tr style={{ position: 'sticky', top: 0, backgroundColor: 'white', zIndex: 1, borderBottom: '2px solid #e2e8f0' }}>
                                                        <th style={{ textAlign: 'left', padding: '12px' }}>Paciente</th>
                                                        <th style={{ textAlign: 'left', padding: '12px' }}>ID</th>
                                                        <th style={{ textAlign: 'left', padding: '12px' }}>Fecha</th>
                                                        <th style={{ textAlign: 'left', padding: '12px' }}>Descripción</th>
                                                        <th style={{ textAlign: 'left', padding: '12px' }}>Mod</th>
                                                        <th style={{ textAlign: 'left', padding: '12px' }}>Acción</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {pacsStudies.length === 0 ? (
                                                        <tr><td colSpan="6" style={{ textAlign: 'center', padding: '40px', color: '#64748b' }}>
                                                            {pacsLoading ? 'Buscando estudios...' : 'No se encontraron estudios. Prueba con otra fecha o nombre.'}
                                                        </td></tr>
                                                    ) : (
                                                        pacsStudies.map(study => (
                                                            <tr key={study.ID} style={{ borderBottom: '1px solid #f1f5f9' }} className="hover:bg-slate-50 transition-colors">
                                                                <td style={{ padding: '12px' }}>
                                                                    <div style={{ fontWeight: 'bold', color: '#4338ca' }}>
                                                                        {study.PatientMainDicomTags?.PatientName || study.MainDicomTags?.PatientName || "N/A"}
                                                                    </div>
                                                                    <div style={{ fontSize: '10px', color: '#64748b', display: 'flex', gap: '6px' }}>
                                                                        <span>{study.PatientMainDicomTags?.PatientSex || "S/X"}</span>
                                                                        <span>|</span>
                                                                        <span>{study.PatientMainDicomTags?.PatientAge || "Edad N/A"}</span>
                                                                    </div>
                                                                </td>
                                                                <td style={{ padding: '12px', fontSize: '11px', color: '#64748b' }}>{study.PatientMainDicomTags?.PatientID || study.MainDicomTags?.PatientID || "N/A"}</td>
                                                                <td style={{ padding: '12px' }}>{study.MainDicomTags?.StudyDate || "N/A"}</td>
                                                                <td style={{ padding: '12px', fontSize: '12px' }}>{study.MainDicomTags?.StudyDescription || "N/A"}</td>
                                                                <td style={{ padding: '12px' }}>
                                                                    <span className="badge badge-neutral" style={{ fontSize: '10px' }}>
                                                                        {study.ModalitiesInStudy || study.MainDicomTags?.ModalitiesInStudy || "???"}
                                                                    </span>
                                                                </td>
                                                                <td style={{ padding: '12px' }}>
                                                                    <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); handleSelectStudy(study); }}>
                                                                        Ver Series
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        ))
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <div>
                                            <div style={{ marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <button className="btn btn-secondary btn-sm" onClick={() => { setSelectedStudy(null); setPacsSeries([]); }}>&larr; Volver</button>
                                                <span style={{ fontWeight: 'bold' }}>Series para: {selectedStudy.MainDicomTags.PatientName}</span>
                                            </div>
                                            <div className="table-container" style={{ maxHeight: '400px', overflowY: 'auto' }}>
                                                <table style={{ width: '100%' }}>
                                                    <thead>
                                                        <tr>
                                                            <th># Serie</th>
                                                            <th>Descripción</th>
                                                            <th>Mod</th>
                                                            <th>Imágenes</th>
                                                            <th>Acción</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {pacsSeries.map(series => {
                                                            const isRecommended = series.Instances.length === Math.max(...pacsSeries.map(s => s.Instances.length));
                                                            return (
                                                                <tr key={series.ID} style={{ backgroundColor: isRecommended ? '#f0f9ff' : 'transparent' }}>
                                                                    <td>{series.MainDicomTags.SeriesNumber} {isRecommended && <span style={{ fontSize: '9px', backgroundColor: '#3b82f6', color: 'white', padding: '2px 4px', borderRadius: '4px', marginLeft: '4px' }}>REC</span>}</td>
                                                                    <td>{series.MainDicomTags.SeriesDescription || 'Sin descripción'}</td>
                                                                    <td><span className="badge badge-neutral">{series.MainDicomTags.Modality}</span></td>
                                                                    <td>{series.Instances.length}</td>
                                                                    <td>
                                                                        <button 
                                                                            className="btn btn-primary btn-sm" 
                                                                            onClick={() => handleImportSeries(series)}
                                                                            disabled={pacsLoading}
                                                                        >
                                                                            Importar Serie
                                                                        </button>
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'config' && (
                        <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
                            <div className="card" style={{ 
                                background: 'white', 
                                border: '1px solid #e2e8f0',
                                padding: '40px',
                                borderRadius: '24px',
                                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '20px', marginBottom: '30px', borderBottom: '1px solid #f1f5f9', paddingBottom: '20px' }}>
                                    <div style={{ backgroundColor: '#eff6ff', padding: '15px', borderRadius: '16px', color: '#3b82f6' }}>
                                        <Server size={32} />
                                    </div>
                                    <div>
                                        <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: '800', color: '#0f172a' }}>Sincronización con GitHub</h2>
                                        <p style={{ margin: 0, color: '#64748b', fontSize: '0.95rem' }}>Ecosistema de desarrollo Mon.AI Cloud</p>
                                    </div>
                                </div>

                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '30px', marginBottom: '30px' }}>
                                    <div style={{ backgroundColor: '#f8fafc', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                                        <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: '#64748b', marginBottom: '8px', letterSpacing: '0.5px' }}>Repositorio Remoto</div>
                                        <div style={{ fontFamily: 'monospace', fontSize: '1rem', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', backgroundColor: '#10b981' }}></div>
                                            https://github.com/rquercia/Mon.AI
                                        </div>
                                    </div>

                                    <div style={{ backgroundColor: '#f8fafc', padding: '20px', borderRadius: '16px', border: '1px solid #e2e8f0' }}>
                                        <div style={{ fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', color: '#64748b', marginBottom: '8px', letterSpacing: '0.5px' }}>OAuth Identity</div>
                                        <div style={{ fontSize: '1rem', color: '#0f172a', fontWeight: '600' }}>rquercia</div>
                                    </div>
                                </div>

                                <div style={{ marginBottom: '35px', maxWidth: '600px' }}>
                                    <label style={{ fontSize: '12px', fontWeight: '700', color: '#1e293b', display: 'block', marginBottom: '10px' }}>GitHub Personal Access Token (PAT)</label>
                                    <div style={{ position: 'relative' }}>
                                        <input 
                                            type="password" 
                                            value={githubToken}
                                            onChange={(e) => setGithubToken(e.target.value)}
                                            placeholder="Introduce tu token ghp_..."
                                            style={{
                                                width: '100%',
                                                padding: '14px 16px',
                                                borderRadius: '12px',
                                                border: '1px solid #cbd5e1',
                                                backgroundColor: 'white',
                                                color: '#0f172a',
                                                outline: 'none',
                                                fontSize: '14px',
                                                boxShadow: 'inset 0 2px 4px rgba(0,0,0,0.05)'
                                            }}
                                        />
                                    </div>
                                    <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '8px' }}>
                                        Este token se utiliza únicamente para autorizar la subida de código al repositorio Mon.AI.
                                    </p>
                                </div>

                                <div style={{ display: 'flex', gap: '15px' }}>
                                    <button 
                                        onClick={() => ejecutarSincronizacionGit('push')}
                                        className="btn btn-primary"
                                        style={{ 
                                            flex: 1, 
                                            padding: '18px',
                                            borderRadius: '12px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '12px',
                                            fontWeight: '700',
                                            fontSize: '1rem',
                                            backgroundColor: '#3b82f6',
                                            boxShadow: '0 4px 14px 0 rgba(59, 130, 246, 0.3)'
                                        }}
                                    >
                                        <UploadCloud size={20} /> Enviar Cambios a GitHub
                                    </button>
                                    <button 
                                        onClick={() => ejecutarSincronizacionGit('pull')}
                                        className="btn btn-secondary"
                                        style={{ 
                                            flex: 1, 
                                            padding: '18px',
                                            borderRadius: '12px',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '12px',
                                            fontWeight: '700',
                                            fontSize: '1rem',
                                            backgroundColor: '#f1f5f9',
                                            color: '#1e293b',
                                            border: '1px solid #e2e8f0'
                                        }}
                                    >
                                        <Activity size={20} style={{ transform: 'rotate(180deg)' }} /> Descargar Actualizaciones
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {activeTab === 'inferencia' && (
                        <div className="card">
                            <h3>Inferencia MONAI 3D GPU</h3>
                            <p>El estudio tomográfico en formato NIfTI está listo. Selecciona el tipo de análisis que prefieres ejecutar con la RTX 3080.</p>

                            <div className="model-selector" style={{ display: 'flex', gap: '15px', marginBottom: '25px', marginTop: '20px' }}>
                                <div
                                    className={`card model-card ${modelType === 'segmentation' ? 'selected' : ''}`}
                                    onClick={() => setModelType('segmentation')}
                                    style={{
                                        flex: 1,
                                        cursor: 'pointer',
                                        border: modelType === 'segmentation' ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                                        backgroundColor: modelType === 'segmentation' ? '#eff6ff' : 'white',
                                        padding: '15px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    <Activity size={32} color={modelType === 'segmentation' ? '#3b82f6' : '#64748b'} />
                                    <h4 style={{ marginTop: '10px' }}>Segmentación</h4>
                                    <p style={{ fontSize: '0.75rem', textAlign: 'center', color: '#64748b' }}>Contorno exacto del nódulo (Swin UNETR)</p>
                                </div>
                                <div
                                    className={`card model-card ${modelType === 'detection' ? 'selected' : ''}`}
                                    onClick={() => setModelType('detection')}
                                    style={{
                                        flex: 1,
                                        cursor: 'pointer',
                                        border: modelType === 'detection' ? '2px solid #3b82f6' : '1px solid #e2e8f0',
                                        backgroundColor: modelType === 'detection' ? '#eff6ff' : 'white',
                                        padding: '15px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    <FileSearch size={32} color={modelType === 'detection' ? '#3b82f6' : '#64748b'} />
                                    <h4 style={{ marginTop: '10px' }}>Detección</h4>
                                    <p style={{ fontSize: '0.75rem', textAlign: 'center', color: '#64748b' }}>Localización con cajas (RetinaNet)</p>
                                </div>
                            </div>

                            <div className="import-zone">
                                <Cpu size={48} color="#3b82f6" />
                                <p>Ejecutando {modelType === 'detection' ? 'RetinaNet 3D' : 'Swin-UNETR 3D'} habilitado para CUDA</p>

                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <button
                                        className="btn btn-primary"
                                        onClick={handleInference}
                                        disabled={isConverting}
                                    >
                                        {isConverting ? 'Evaluando con GPU...' : `Iniciar ${modelType === 'detection' ? 'Detección' : 'Segmentación'}`}
                                    </button>
                                </div>
                            </div>

                            {message.text && activeTab === 'inferencia' && (
                                <div className={`badge badge-${message.type}`} style={{ display: 'flex', marginTop: '20px', padding: '12px', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div style={{ display: 'flex', alignItems: 'center' }}>
                                        {message.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
                                        <span style={{ marginLeft: '8px' }}>{message.text}</span>
                                    </div>
                                    {progress > 0 && progress < 100 && (
                                        <div style={{ fontSize: '11px', fontWeight: 'bold', backgroundColor: 'rgba(255,255,255,0.15)', padding: '2px 6px', borderRadius: '4px' }}>
                                            {Math.round(progress)}%
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {activeTab === 'resultados' && (
                        <div className="card" style={{ marginTop: '20px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                                <div>
                                    <h3>Resultados (Archivos NIfTI)</h3>
                                    <p style={{ fontSize: '0.85rem', color: '#64748b', marginTop: '4px' }}>
                                        Puedes abrir estos archivos descargados utilizando software médico como <strong>ITK-SNAP</strong> o <strong>3D Slicer</strong>.
                                    </p>
                                </div>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <button className="btn btn-secondary" onClick={fetchResults}>Actualizar Lista</button>
                                    <button className="btn btn-secondary" style={{ backgroundColor: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca' }} onClick={handleDeleteAll}>Borrar Todo</button>
                                </div>
                            </div>

                            <div className="table-container">
                                <table>
                                    <thead>
                                        <tr>
                                            <th>Archivo</th>
                                            <th>Formato</th>
                                            <th>Tamaño</th>
                                            <th>Acciones</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {results.length === 0 ? (
                                            <tr>
                                                <td colSpan="4" style={{ textAlign: 'center', padding: '20px' }}>
                                                    No hay resultados generados aún.
                                                </td>
                                            </tr>
                                        ) : (
                                            results.map((file, index) => (
                                                <tr key={index}>
                                                    <td>
                                                        <span className="td-title">{file.name}</span>
                                                    </td>
                                                    <td>
                                                        <span className={`badge ${file.name.endsWith('.json') ? 'badge-neutral' : 'badge-success'}`}>
                                                            {file.name.endsWith('.zip') ? 'DICOM (ZIP)' : file.name.endsWith('.json') ? 'REPORTE (JSON)' : 'NIfTI (3D)'}
                                                        </span>
                                                    </td>
                                                    <td>{file.size}</td>
                                                    <td style={{ display: 'flex', gap: '8px' }}>
                                                        {file.name.endsWith('.json') ? (
                                                            <>
                                                                <button 
                                                                    className="btn btn-primary btn-sm"
                                                                    onClick={() => handleViewJson(file.downloadPath)}
                                                                    style={{ backgroundColor: '#4f46e5' }}
                                                                >
                                                                    Ver Extraído
                                                                </button>
                                                                <button 
                                                                    className="btn btn-primary btn-sm"
                                                                    onClick={() => handleGenerateWordReport(file.downloadPath)}
                                                                    style={{ backgroundColor: '#0ea5e9', display: 'flex', alignItems: 'center', gap: '4px' }}
                                                                >
                                                                    <Cpu size={14} /> Reporte MedGemma
                                                                </button>
                                                            </>
                                                        ) : (
                                                            <a
                                                                href={`http://${window.location.hostname}:809/api/download/${file.downloadPath}`}
                                                                download
                                                                className="btn btn-primary btn-sm"
                                                                style={{ textDecoration: 'none', display: 'inline-block' }}
                                                            >
                                                                Descargar
                                                            </a>
                                                        )}
                                                        
                                                        {(file.name.includes('_seg.nii.gz') || file.name.includes('_det.nii.gz')) && (
                                                            <div style={{ display: 'flex', gap: '4px' }}>
                                                                <button
                                                                    className="btn btn-primary btn-sm"
                                                                    style={{ backgroundColor: '#7c3aed', color: 'white', fontWeight: 'bold' }}
                                                                    onClick={() => handlePushMedicalObject(file.downloadPath)}
                                                                    disabled={isConverting}
                                                                    title="Envía un objeto DICOM-SEG de anotación nativa"
                                                                >
                                                                    Hacia PACS (SEG)
                                                                </button>
                                                            </div>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>

                            {/* Visor de Reporte Médico JSON */}
                            {selectedJson && (
                                <div className="modal-overlay" onClick={() => setSelectedJson(null)}>
                                    <div className="modal-content" onClick={e => e.stopPropagation()}>
                                        <div className="modal-header">
                                            <h3>Reporte Clínico de Detección de Nódulos</h3>
                                            <button className="close-btn" onClick={() => setSelectedJson(null)}>&times;</button>
                                        </div>
                                        <div className="modal-body">
                                            <div className="report-summary">
                                                <div className={`summary-card ${selectedJson.num_detections > 0 ? 'warning' : 'success'}`}>
                                                    <h4>{selectedJson.num_detections} Nódulos Detectados</h4>
                                                    <p>{selectedJson.num_detections > 0 ? 'Se recomienda revisión inmediata por un especialista.' : 'No se detectaron hallazgos significativos.'}</p>
                                                </div>
                                            </div>

                                            <div className="detections-list">
                                                <h4>Detalle de Hallazgos</h4>
                                                <table>
                                                    <thead>
                                                        <tr>
                                                            <th>#</th>
                                                            <th>Confianza (IA)</th>
                                                            <th>Imagen (Corte)</th>
                                                            <th>Estado</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {selectedJson.detections.map((det, idx) => (
                                                            <tr key={idx} className={det.score > 0.8 ? 'high-confidence' : ''}>
                                                                <td>{det.id}</td>
                                                                <td>
                                                                    <div className="score-meter">
                                                                        <div className="score-fill" style={{ width: `${det.score * 100}%`, backgroundColor: det.score > 0.8 ? '#ef4444' : '#f59e0b' }}></div>
                                                                        <span>{(det.score * 100).toFixed(1)}%</span>
                                                                    </div>
                                                                </td>
                                                                <td style={{ fontWeight: 'bold', color: '#1e40af' }}>
                                                                    {det.slice_number || 'Ver visor'}
                                                                </td>
                                                                <td>
                                                                    <span className={`label-status ${det.score > 0.8 ? 'urgent' : 'prob'}`}>
                                                                        {det.score > 0.8 ? 'Crítico' : 'Probable'}
                                                                    </span>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>

                                            {/* SECCIÓN IA MEDGEMMA */}
                                            <div className="ai-report-section" style={{ marginTop: '25px', padding: '15px', backgroundColor: '#fafafa', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
                                                    <h4 style={{ margin: 0, color: '#3b82f6', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        <Cpu size={18} /> Informe Clínico IA (MedGemma-4B-IT-Q8)
                                                    </h4>
                                                    <button 
                                                        className="btn btn-primary btn-sm"
                                                        onClick={() => handleGenerateAiReport(selectedJson.fileName)}
                                                        disabled={isGeneratingReport}
                                                    >
                                                        {isGeneratingReport ? 'Procesando...' : 'Generar Informe IA'}
                                                    </button>
                                                </div>
                                                
                                                {aiReportText && (
                                                    <div style={{ padding: '15px', backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: '13px', lineHeight: '1.6' }}>
                                                        {aiReportText}
                                                    </div>
                                                )}
                                            </div>
                                            
                                            <div className="report-footer">
                                                <p>Generado por Modelo: <strong>{selectedJson.model || 'MONAI Detection'}</strong></p>
                                                <p>Estudio: {selectedJson.study || 'Detección Estándar'}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* GIT LOG MODAL */}
                            {showGitLogModal && (
                                <div className="modal-overlay" style={{ zIndex: 99999, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={() => !isGitLoading && setShowGitLogModal(false)}>
                                    <div className="modal-content" style={{ maxWidth: '700px', width: '90%', backgroundColor: '#020617', border: '1px solid #1e293b', boxShadow: '0 0 50px rgba(0,0,0,0.8)' }} onClick={e => e.stopPropagation()}>
                                        <div className="modal-header" style={{ backgroundColor: '#0f172a', borderBottom: '1px solid #1e293b', color: '#94a3b8', padding: '15px 25px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                                <div className={`w-2 h-2 rounded-full ${isGitLoading ? 'bg-orange-500 animate-ping' : 'bg-emerald-500'}`}></div>
                                                <span style={{ fontSize: '10px', fontWeight: '900', letterSpacing: '2px', color: '#38bdf8' }}>TERMINAL DE SINCRONIZACIÓN</span>
                                            </div>
                                            {!isGitLoading && <button className="close-btn" style={{ color: '#475569', fontSize: '28px' }} onClick={() => setShowGitLogModal(false)}>&times;</button>}
                                        </div>
                                        <div className="modal-body" style={{ padding: '0', backgroundColor: '#000' }}>
                                            <div style={{ 
                                                padding: '30px', 
                                                fontFamily: '"Fira Code", monospace', 
                                                fontSize: '13px', 
                                                color: '#f8fafc', 
                                                minHeight: '250px',
                                                maxHeight: '500px',
                                                overflowY: 'auto',
                                                whiteSpace: 'pre-wrap',
                                                lineHeight: '1.6'
                                            }}>
                                                {gitLogs}
                                                {isGitLoading && <span style={{ color: '#38bdf8' }} className="animate-pulse">_</span>}
                                            </div>
                                            
                                            {isGitLoading && (
                                                <div style={{ height: '2px', width: '100%', backgroundColor: '#0f172a', position: 'relative', overflow: 'hidden' }}>
                                                    <div className="absolute top-0 h-full bg-blue-500" style={{ 
                                                        width: '40%', 
                                                        animation: 'shimmer 2s infinite linear' 
                                                    }}></div>
                                                </div>
                                            )}
                                        </div>
                                        <div className="modal-footer" style={{ padding: '15px 25px', backgroundColor: '#0f172a', borderTop: '1px solid #1e293b', display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                                            {!isGitLoading && (
                                                <button 
                                                    className="btn btn-primary btn-sm" 
                                                    onClick={() => setShowGitLogModal(false)}
                                                    style={{ backgroundColor: '#0ea5e9' }}
                                                >
                                                    Entendido
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* DOCUMENT FRAME MODAL: REPORTE MEDGEMMA */}
                            {showFrameModal && (
                                <div className="modal-overlay" style={{ zIndex: 9999, backgroundColor: 'rgba(0,0,0,0.6)' }} onClick={() => setShowFrameModal(false)}>
                                    <div 
                                        onClick={e => e.stopPropagation()} 
                                        style={{
                                            backgroundColor: '#f1f5f9',
                                            width: '90%',
                                            maxWidth: '900px',
                                            height: '90vh',
                                            borderRadius: '12px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            overflow: 'hidden',
                                            boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)'
                                        }}
                                    >
                                        <div style={{ backgroundColor: '#1e293b', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'white' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                <div style={{ backgroundColor: '#3b82f6', width: '24px', height: '24px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                    <span style={{ fontWeight: 'bold', fontSize: '14px' }}>W</span>
                                                </div>
                                                <span style={{ fontWeight: '500', fontSize: '14px' }}>Documento de Informe Médico - Lectura Solo AI</span>
                                            </div>
                                            <div style={{ display: 'flex', gap: '10px' }}>
                                                <button className="btn btn-primary btn-sm" style={{ backgroundColor: '#3b82f6', border: 'none' }} onClick={() => window.print()}>Guardar PDF</button>
                                                <button style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', fontSize: '20px' }} onClick={() => setShowFrameModal(false)}>&times;</button>
                                            </div>
                                        </div>

                                        <div style={{ flex: 1, padding: '40px', overflowY: 'auto', display: 'flex', justifyContent: 'center' }}>
                                            {/* Hoja estilo A4 (MS Word) */}
                                            <div style={{
                                                backgroundColor: 'white',
                                                width: '100%',
                                                maxWidth: '210mm',
                                                minHeight: '297mm',
                                                padding: '25mm 20mm',
                                                boxShadow: '0 1px 10px rgba(0,0,0,0.1)',
                                                border: '1px solid #cbd5e1',
                                                color: '#0f172a',
                                                fontFamily: '"Times New Roman", Times, serif',
                                                position: 'relative'
                                            }}>
                                                {/* Cabecera / Membrete Hospital */}
                                                <div style={{ borderBottom: '2px solid #1e293b', paddingBottom: '15px', marginBottom: '25px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                                    <div>
                                                        <h2 style={{ margin: 0, fontSize: '24px', fontFamily: 'Arial, sans-serif', color: '#1e293b', textTransform: 'uppercase' }}>Centro Médico Radiológico</h2>
                                                        <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#64748b', fontFamily: 'Arial, sans-serif' }}>Av. Especialidades 1234, Ciudad • Clínica de Tórax IA</p>
                                                    </div>
                                                    <div style={{ textAlign: 'right' }}>
                                                        <h3 style={{ margin: 0, fontSize: '16px', color: '#3b82f6', fontFamily: 'Arial, sans-serif' }}>INFORME RADIOLÓGICO IA</h3>
                                                        <p style={{ margin: '4px 0 0 0', fontSize: '12px', fontFamily: 'Arial, sans-serif', color: '#64748b' }}>Fecha: {new Date().toLocaleDateString('es-ES')}</p>
                                                    </div>
                                                </div>

                                                {/* Datos del Paciente (Simulados/Template) */}
                                                <div style={{ border: '1px solid #e2e8f0', borderRadius: '4px', padding: '15px', marginBottom: '30px', fontFamily: 'Arial, sans-serif', fontSize: '12px', backgroundColor: '#f8fafc' }}>
                                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '10px' }}>
                                                        <div><strong>PACIENTE:</strong> Muestra Clínica Anónima</div>
                                                        <div><strong>EDAD/SEXO:</strong> 58 años / N/A</div>
                                                        <div><strong>ESTUDIO:</strong> Tomografía Computarizada (TAC) de Tórax Sin Contraste</div>
                                                        <div><strong>MEDGEMMA MODEL:</strong> google/medgemma-4b-it-Q8</div>
                                                    </div>
                                                </div>

                                                {/* Contenido del Reporte */}
                                                {isGeneratingReport ? (
                                                    <div style={{ textAlign: 'center', padding: '50px', color: '#64748b' }}>
                                                        <Cpu size={48} className="animate-spin text-blue-500 mx-auto mb-4" />
                                                        <h3 style={{ fontFamily: 'Arial, sans-serif' }}>MedGemma está analizando los hallazgos y redactando el informe profesional...</h3>
                                                        <p style={{ fontFamily: 'Arial, sans-serif', fontStyle: 'italic' }}>Este proceso puede tomar unos segundos.</p>
                                                    </div>
                                                ) : (
                                                    <div className="medical-document-body" style={{ fontSize: '14px', lineHeight: '1.6', textAlign: 'justify' }} dangerouslySetInnerHTML={formatMarkdownToHtml(frameReportData)} />
                                                )}

                                                {/* Firma Médica (Footer A4) */}
                                                <div style={{ marginTop: '80px', display: 'flex', justifyContent: 'flex-end' }}>
                                                    <div style={{ textAlign: 'center', width: '250px' }}>
                                                        <div style={{ borderTop: '1px solid #94a3b8', paddingTop: '10px' }}>
                                                            <strong>Dra. / Dr. Especialista Supervisor</strong><br/>
                                                            <span style={{ fontSize: '12px', color: '#64748b' }}>MN: -- / Reporte Borrador IA</span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                        </div>
                    )}
                </section>
            </main>
        )}
    </div>

            <style>{`
        .app-container {
          display: flex;
          min-height: 100vh;
        }
        .sidebar {
          width: 260px;
          background-color: #ffffff;
          border-right: 1px solid #e2e8f0;
          padding: 24px;
        }
        .logo {
          display: flex;
          align-items: center;
          gap: 12px;
          font-weight: 800;
          font-size: 1.25rem;
          margin-bottom: 40px;
        }
        nav {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .nav-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          border-radius: 12px;
          border: none;
          background: transparent;
          color: #64748b;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
          text-align: left;
        }
        .nav-item:hover {
          background-color: #f8fafc;
          color: #0f172a;
        }
        .nav-item.active {
          background-color: #eff6ff;
          color: #3b82f6;
        }
        .main-content {
          flex: 1;
          padding: 40px;
          background-color: #f8fafc;
        }
        .content-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 30px;
        }
        .import-zone {
          border: 2px dashed #e2e8f0;
          border-radius: 16px;
          padding: 40px;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          margin: 20px 0;
          text-align: center;
        }
        .btn-sm {
          padding: 6px 12px;
          font-size: 0.75rem;
        }

        /* Modal Styles */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0,0,0,0.5);
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1000;
          backdrop-filter: blur(4px);
        }
        .modal-content {
          background: white;
          width: 90%;
          max-width: 800px;
          max-height: 90vh;
          border-radius: 20px;
          display: flex;
          flex-direction: column;
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
          overflow: hidden;
        }
        .modal-header {
          padding: 20px 24px;
          border-bottom: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          align-items: center;
          background: #f8fafc;
        }
        .close-btn {
          background: none;
          border: none;
          font-size: 24px;
          cursor: pointer;
          color: #64748b;
        }
        .modal-body {
          padding: 24px;
          overflow-y: auto;
        }
        .summary-card {
          padding: 20px;
          border-radius: 12px;
          margin-bottom: 24px;
          text-align: center;
        }
        .summary-card.warning {
          background: #fff1f2;
          border: 1px solid #fecaca;
          color: #991b1b;
        }
        .summary-card.success {
          background: #f0fdf4;
          border: 1px solid #bbf7d0;
          color: #166534;
        }
        .score-meter {
          width: 100%;
          height: 8px;
          background: #e2e8f0;
          border-radius: 4px;
          position: relative;
          margin-top: 4px;
        }
        .score-fill {
          height: 100%;
          border-radius: 4px;
        }
        .score-meter span {
          position: absolute;
          right: 0;
          top: -18px;
          font-size: 0.65rem;
          font-weight: bold;
        }
        .label-status {
          font-size: 0.65rem;
          padding: 2px 8px;
          border-radius: 99px;
          font-weight: bold;
          text-transform: uppercase;
        }
        .label-status.urgent {
          background: #fee2e2;
          color: #ef4444;
        }
        .label-status.prob {
          background: #fef3c7;
          color: #d97706;
        }
        .high-confidence {
          background-color: #fff1f2;
        }
        .report-footer {
          margin-top: 30px;
          padding-top: 20px;
          border-top: 1px solid #e2e8f0;
          font-size: 0.75rem;
          color: #64748b;
          display: flex;
          justify-content: space-between;
        }
        @keyframes shimmer {
          0% { left: -100%; }
          100% { left: 100%; }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes slideInRight {
          from { transform: translateX(20px); opacity: 0; }
          to { transform: translateX(0); opacity: 1; }
        }
        .animate-in {
          animation-duration: 400ms;
          animation-fill-mode: both;
        }
        .fade-in {
          animation-name: fadeIn;
        }
        .slide-in-from-right {
          animation-name: slideInRight;
        }
      `}</style>
        </DicomProvider>
    );
}

export default App;
