import React, { useState, useEffect, useCallback } from 'react';
import { UploadCloud, Image as ImageIcon, X, Loader2, Database, Search, ArrowUp, ArrowDown } from 'lucide-react';
import { useDicom } from '../context/DicomContext';

const BACKEND_URL = `http://${window.location.hostname}:809`;

const DicomUploader = ({ label, id, file, setFile, onPreviewGenerated, onMoveUp, onMoveDown, isFirst, isLast }) => {
    const [preview, setPreview] = useState(null);
    const [loadingPreview, setLoadingPreview] = useState(false);

    // Only fetch preview if file changes and we don't have a preview for it yet
    useEffect(() => {
        if (!file) {
            setPreview(null);
            return;
        }

        // Avoid re-fetching if we already have the preview for this specific file object
        if (preview && preview.includes(file.name)) return;

        const getPreview = async () => {
            setLoadingPreview(true);
            try {
                const formData = new FormData();
                formData.append('image', file);
                const response = await fetch(`${BACKEND_URL}/api/preview`, {
                    method: 'POST',
                    body: formData,
                });
                if (!response.ok) throw new Error('Preview error');
                const data = await response.json();
                if (data.status === 'success') {
                    const fullUrl = data.previewUrl.startsWith('http') ? data.previewUrl : `${BACKEND_URL}${data.previewUrl}`;
                    setPreview(fullUrl);
                    // Crucial: Use a functional update or stable ref to avoid infinite loops if Sidebar re-renders
                    if (onPreviewGenerated) onPreviewGenerated(fullUrl);
                }
            } catch (err) {
                console.error(err);
            } finally {
                setLoadingPreview(false);
            }
        };

        getPreview();
    }, [file]); // ONLY depend on the file object itself

    return (
        <div className="mb-4">
            <label className="block text-[0.65rem] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
                {label}
            </label>
            {!file ? (
                <div
                    className="border-2 border-dashed border-slate-100 rounded-xl p-3 text-center hover:bg-slate-50 hover:border-indigo-200 transition-all cursor-pointer group bg-slate-50/20"
                    onClick={() => document.getElementById(id).click()}
                >
                    <input type="file" id={id} className="hidden" accept=".dcm,image/dicom" onChange={(e) => setFile(e.target.files[0])} />
                    <UploadCloud className="w-5 h-5 text-slate-300 mx-auto mb-1 group-hover:text-indigo-400" />
                    <p className="text-[0.65rem] text-slate-400 group-hover:text-indigo-500 font-medium">Añadir DICOM</p>
                </div>
            ) : (
                <div className="relative group overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm hover:border-indigo-400 transition-all">
                    <div className="aspect-[4/3] w-full bg-slate-100 flex items-center justify-center overflow-hidden">
                        {loadingPreview ? (
                            <div className="flex flex-col items-center gap-2">
                                <Loader2 className="w-5 h-5 animate-spin text-indigo-500" />
                                <span className="text-[0.6rem] text-slate-400 font-medium">Generando...</span>
                            </div>
                        ) : preview ? (
                            <img src={preview} alt="Preview" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" />
                        ) : (
                            <ImageIcon className="w-8 h-8 text-slate-200" />
                        )}
                    </div>
                    <button
                        onClick={(e) => { e.stopPropagation(); setFile(null); }}
                        className="absolute top-1 right-1 bg-black/40 hover:bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition-all"
                    >
                        <X className="w-3.5 h-3.5" />
                    </button>
                    <div className="absolute top-1 left-1 bg-indigo-600/80 text-[8px] text-white px-1.5 py-0.5 rounded-full font-bold uppercase tracking-wider backdrop-blur-sm">OK</div>
                    <div className="absolute bottom-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                        {!isFirst && (
                            <button 
                                onClick={(e) => { e.stopPropagation(); onMoveUp(); }} 
                                className="bg-black/40 hover:bg-slate-700 text-white rounded-md p-1 backdrop-blur-sm"
                            >
                                <ArrowUp className="w-3.5 h-3.5" />
                            </button>
                        )}
                        {!isLast && (
                            <button 
                                onClick={(e) => { e.stopPropagation(); onMoveDown(); }} 
                                className="bg-black/40 hover:bg-slate-700 text-white rounded-md p-1 backdrop-blur-sm"
                            >
                                <ArrowDown className="w-3.5 h-3.5" />
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default function Sidebar() {
    const [images, setImages] = useState({ sup: null, medSup: null, medInf: null, inf: null });
    const [previews, setPreviews] = useState({ sup: null, medSup: null, medInf: null, inf: null });
    const [loading, setLoading] = useState(false);
    const [studies, setStudies] = useState([]);
    const [showPacsList, setShowPacsList] = useState(false);
    const [dateFilter, setDateFilter] = useState(new Date().toISOString().split('T')[0]);
    
    const fetchStudies = async () => {
        setLoading(true);
        try {
            // Re-format YYYY-MM-DD to YYYYMMDD for DICOM
            const dicomDate = dateFilter ? dateFilter.replace(/-/g, '') : '';
            const queryParam = dicomDate ? `?date=${dicomDate}` : '';
            const response = await fetch(`${BACKEND_URL}/api/pacs/studies${queryParam}`);
            const data = await response.json();
            
            // Filter by Modality: CR (Computed Radiography), DX (Digital Radiography), PX (Panoramic X-Ray)
            // Orthanc returns studies in an array where each study has 'ModalitiesInStudy'
            const filtered = (Array.isArray(data) ? data : []).filter(study => {
                const modalities = study.ModalitiesInStudy || "";
                // If modalities are explicitly known, filter. If unknown, show (safer).
                if (!modalities) return true; 
                
                const isRadiography = modalities.includes('CR') || modalities.includes('DX') || 
                                     modalities.includes('PX') || modalities.includes('RF') || 
                                     modalities.includes('RG');
                return isRadiography;
            });

            setStudies(filtered);
            setShowPacsList(true);
            if (filtered.length === 0) alert("No se encontraron estudios de RX para esa fecha.");
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };
    
    const { 
        setResultImage, setResultDicomUrl, setSourceImages, 
        setInitialOffsets, setManualOffsets, setRawFiles 
    } = useDicom();

    // Stable callback to handle previews
    const handlePreviewGenerated = useCallback((key, url) => {
        setPreviews(prev => ({ ...prev, [key]: url }));
    }, []);

    const swapSlots = (idx1, idx2) => {
        const slotKeys = ['sup', 'medSup', 'medInf', 'inf'];
        const key1 = slotKeys[idx1];
        const key2 = slotKeys[idx2];
        
        setImages(prev => ({ ...prev, [key1]: prev[key2], [key2]: prev[key1] }));
        setPreviews(prev => ({ ...prev, [key1]: prev[key2], [key2]: prev[key1] }));
    };

    const handleClearAll = () => {
        setImages({ sup: null, medSup: null, medInf: null, inf: null });
        setPreviews({ sup: null, medSup: null, medInf: null, inf: null });
        setResultImage(null);
        setResultDicomUrl(null);
        setSourceImages([]);
        setInitialOffsets([]);
        setManualOffsets([]);
        setRawFiles([]);
    };

    const handleImportStudy = async (studyId) => {
        setLoading(true);
        try {
            const idsResp = await fetch(`${BACKEND_URL}/api/pacs/study-instances/${studyId}`);
            if (!idsResp.ok) throw new Error("Error fetching instances");
            const ids = await idsResp.json();
            
            if (ids.length === 0) return alert("El estudio está vacío");
            
            handleClearAll();
            
            const slotKeys = ['sup', 'medSup', 'medInf', 'inf'];
            const newImages = { sup: null, medSup: null, medInf: null, inf: null };
            
            for (let i = 0; i < ids.length && i < 4; i++) {
                const fileResp = await fetch(`${BACKEND_URL}/api/pacs/download/${ids[i]}`);
                if (!fileResp.ok) continue;
                
                const blob = await fileResp.blob();
                const file = new File([blob], `pacs_image_${i+1}.dcm`, { type: 'application/dicom' });
                newImages[slotKeys[i]] = file;
            }
            
            setImages(newImages);
            setShowPacsList(false);
            alert("Imágenes descargadas correctamente.");
        } catch (error) {
            console.error(error);
            alert("Error importando el estudio: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    const handleProcess = async () => {
        const filesToUpload = [images.sup, images.medSup, images.medInf, images.inf].filter(Boolean);
        if (filesToUpload.length < 2) return alert("Sube al menos 2 imágenes para procesar");

        setLoading(true);
        setResultImage(null);
        try {
            const formData = new FormData();
            filesToUpload.forEach(file => formData.append('images', file));
            const response = await fetch(`${BACKEND_URL}/api/process-panorama`, { method: 'POST', body: formData });
            if (!response.ok) throw new Error('Error en el servidor');
            
            const data = await response.json();
            if (data.status === 'success') {
                const resImgUrl = data.resultUrl.startsWith('http') ? data.resultUrl : `${BACKEND_URL}${data.resultUrl}`;
                const resDcmUrl = data.resultDicomUrl.startsWith('http') ? data.resultDicomUrl : `${BACKEND_URL}${data.resultDicomUrl}`;
                setResultImage(`${resImgUrl}?t=${Date.now()}`);
                setResultDicomUrl(resDcmUrl);

                const sources = [
                    { id: 'sup', label: 'Superior', file: images.sup, preview: previews.sup },
                    { id: 'medSup', label: 'Media Sup', file: images.medSup, preview: previews.medSup },
                    { id: 'medInf', label: 'Media Inf', file: images.medInf, preview: previews.medInf },
                    { id: 'inf', label: 'Inferior', file: images.inf, preview: previews.inf }
                ].filter(s => s.file).map(s => ({
                    id: s.id,
                    label: s.label,
                    url: s.preview || URL.createObjectURL(s.file),
                    name: s.file.name
                }));
                
                setSourceImages(sources);
                setInitialOffsets(data.offsets || []);
                setManualOffsets((data.offsets || []).map(o => ({ ...o })));
                setRawFiles(filesToUpload);
            }
        } catch (error) {
            alert("Error: " + error.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <aside className="w-[320px] bg-white border-r border-slate-200 flex flex-col h-full z-10 flex-shrink-0">
            <div className="p-6 border-b border-slate-100 flex flex-col gap-1">
                <h2 className="text-lg font-bold text-slate-800 tracking-tight">Espinografía RX</h2>
                <span className="text-[10px] text-indigo-600 font-black uppercase tracking-widest">Motor DICOM Activo</span>
            </div>

            <div className="p-6 flex-1 overflow-y-auto space-y-1 custom-scrollbar">
                <div className="mb-4">
                    <label className="block text-[0.65rem] font-bold text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
                        Filtrar por Fecha
                    </label>
                    <input 
                        type="date" 
                        value={dateFilter} 
                        onChange={(e) => setDateFilter(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 text-slate-700 text-xs p-2 rounded-xl focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 transition-all font-medium"
                    />
                </div>
                <div className="mb-6 flex gap-2">
                    <button 
                        onClick={fetchStudies}
                        disabled={loading}
                        className="flex-1 bg-slate-900 border border-slate-800 text-white py-2.5 px-4 rounded-xl text-[11px] font-black uppercase tracking-widest flex items-center justify-center gap-2 transition-all hover:bg-slate-800 active:scale-95 disabled:opacity-50"
                    >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
                        Traer de PACS
                    </button>
                    {showPacsList && (
                        <button onClick={() => setShowPacsList(false)} className="bg-slate-100 text-slate-500 p-2.5 rounded-xl hover:bg-slate-200"><X size={18} /></button>
                    )}
                </div>

                {showPacsList && studies.length > 0 && (
                    <div className="mb-6 bg-slate-50 rounded-2xl border border-slate-100 overflow-hidden divide-y divide-slate-100 animate-in fade-in slide-in-from-top-4 duration-500">
                        <div className="bg-slate-100/50 px-4 py-2 flex items-center justify-between">
                            <span className="text-[10px] font-black uppercase text-slate-500 tracking-wider">Estudios en PACS</span>
                        </div>
                        {studies.slice(0, 5).map(study => (
                            <div key={study.ID} className="p-3 hover:bg-indigo-50 transition-colors cursor-pointer group">
                                <div className="flex justify-between items-start mb-1">
                                    <span className="text-[11px] font-bold text-slate-700 truncate max-w-[150px]">{study.PatientMainDicomTags.PatientName}</span>
                                    <span className="text-[9px] font-medium text-slate-400">{study.MainDicomTags.StudyDate}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-slate-400 truncate max-w-[150px]">{study.MainDicomTags.StudyDescription || 'Estudio sin descripción'}</span>
                                    <button 
                                        className="text-[9px] font-black text-indigo-600 uppercase opacity-0 group-hover:opacity-100 transition-all"
                                        onClick={() => handleImportStudy(study.ID)}
                                    >
                                        Importar
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
                <DicomUploader id="up-s" label="Superior" file={images.sup} setFile={f => setImages(p => ({ ...p, sup: f }))} onPreviewGenerated={u => handlePreviewGenerated('sup', u)} isFirst={true} onMoveDown={() => swapSlots(0, 1)} />
                <DicomUploader id="up-ms" label="Media Superior" file={images.medSup} setFile={f => setImages(p => ({ ...p, medSup: f }))} onPreviewGenerated={u => handlePreviewGenerated('medSup', u)} onMoveUp={() => swapSlots(1, 0)} onMoveDown={() => swapSlots(1, 2)} />
                <DicomUploader id="up-mi" label="Media Inferior" file={images.medInf} setFile={f => setImages(p => ({ ...p, medInf: f }))} onPreviewGenerated={u => handlePreviewGenerated('medInf', u)} onMoveUp={() => swapSlots(2, 1)} onMoveDown={() => swapSlots(2, 3)} />
                <DicomUploader id="up-i" label="Inferior" file={images.inf} setFile={f => setImages(p => ({ ...p, inf: f }))} onPreviewGenerated={u => handlePreviewGenerated('inf', u)} isLast={true} onMoveUp={() => swapSlots(3, 2)} />
            </div>

            <div className="p-6 border-t border-slate-100 bg-slate-50 space-y-3">
                <button onClick={handleProcess} disabled={loading} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white p-3.5 rounded-xl font-bold transition-all shadow-md active:scale-95 disabled:opacity-50">
                    {loading ? <div className="flex items-center justify-center gap-2"><Loader2 className="animate-spin w-4 h-4" /> Uniendo...</div> : "Procesar Espinografía"}
                </button>
                <button onClick={handleClearAll} disabled={loading} className="w-full bg-white border border-slate-200 text-slate-500 p-3 rounded-xl hover:bg-red-50 hover:text-red-500 transition-all text-sm font-medium">Limpiar</button>
            </div>
        </aside>
    );
}
