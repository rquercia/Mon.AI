import React, { useState, useCallback, useRef, useEffect } from 'react';
import { TransformWrapper, TransformComponent } from 'react-zoom-pan-pinch';
import {
    ZoomIn,
    ZoomOut,
    Maximize,
    Download,
    Image as ImageIcon,
    Move,
    Sun,
    MousePointer2,
    Layers,
    Save,
    RotateCcw,
    CheckCircle,
    Loader2,
    RefreshCw,
    Database
} from 'lucide-react';
import { useDicom } from '../context/DicomContext';

const BACKEND_URL = 'http://localhost:809';

export default function Viewer() {
    const {
        resultImage,
        setResultImage,
        resultDicomUrl,
        setResultDicomUrl,
        sourceImages,
        initialOffsets,
        manualOffsets,
        setManualOffsets,
        rawFiles
    } = useDicom();

    const [activeTool, setActiveTool] = useState('pan');
    const [isManualMode, setIsManualMode] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isPushing, setIsPushing] = useState(false);
    const [draggingIdx, setDraggingIdx] = useState(null);
    const [dragStartPos, setDragStartPos] = useState({ x: 0, y: 0 });
    const [brightness, setBrightness] = useState(100);
    const [contrast, setContrast] = useState(100);
    
    const windowingRef = useRef({ isDragging: false, startX: 0, startY: 0, initialB: 100, initialC: 100 });

    const handlePushToPacs = async () => {
        if (!resultDicomUrl) return;
        setIsPushing(true);
        try {
            const fileName = resultDicomUrl.split('/').pop();
            const response = await fetch(`${BACKEND_URL}/api/pacs/push`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filePath: fileName })
            });
            if (response.ok) {
                alert('Estudio enviado al PACS con éxito!');
            } else {
                alert('Error al enviar al PACS');
            }
        } catch (error) {
            console.error(error);
            alert('Error de conexión');
        } finally {
            setIsPushing(false);
        }
    };

    const handleMouseDown = (e) => {
        if (activeTool !== 'window') return;
        windowingRef.current = {
            isDragging: true,
            startX: e.clientX,
            startY: e.clientY,
            initialB: brightness,
            initialC: contrast
        };
    };

    const handleMouseMove = useCallback((e) => {
        if (!windowingRef.current.isDragging) return;
        const dx = e.clientX - windowingRef.current.startX;
        const dy = e.clientY - windowingRef.current.startY;

        setContrast(prev => Math.max(10, windowingRef.current.initialC + dx * 0.5));
        setBrightness(prev => Math.max(10, windowingRef.current.initialB - dy * 0.5));
    }, []);

    const handleManualDragStart = (e, index) => {
        if (!isManualMode) return;
        e.stopPropagation();
        setDraggingIdx(index);
        setDragStartPos({ x: e.clientX, y: e.clientY });
    };

    const handleGlobalMouseMove = useCallback((e) => {
        if (isManualMode && draggingIdx !== null) {
            const dx = (e.clientX - dragStartPos.x);
            const dy = (e.clientY - dragStartPos.y);

            setManualOffsets(prev => {
                const updated = [...prev];
                const found = updated.findIndex(o => o.index === draggingIdx);
                if (found !== -1) {
                    updated[found] = {
                        ...updated[found],
                        left: updated[found].left + dx,
                        top: updated[found].top + dy,
                        accum_dx: updated[found].accum_dx + dx,
                        accum_dy: updated[found].accum_dy + dy
                    };
                }
                return updated;
            });
            setDragStartPos({ x: e.clientX, y: e.clientY });
        } else {
            handleMouseMove(e);
        }
    }, [isManualMode, draggingIdx, dragStartPos, setManualOffsets, handleMouseMove]);

    const handleMouseUp = () => {
        windowingRef.current.isDragging = false;
    };

    const handleGlobalMouseUp = () => {
        setDraggingIdx(null);
        handleMouseUp();
    };

    const resetWindowing = () => {
        setBrightness(100);
        setContrast(100);
    };

    const handleResetManual = () => {
        setManualOffsets(initialOffsets.map(o => ({ ...o })));
    };

    const handleSaveManual = async () => {
        if (!rawFiles || rawFiles.length === 0) {
            alert("No hay archivos originales disponibles para re-procesar.");
            return;
        }
        setIsSaving(true);
        try {
            const formData = new FormData();
            rawFiles.forEach(file => formData.append('images', file));
            formData.append('manualOffsets', JSON.stringify(manualOffsets));

            const response = await fetch(`${BACKEND_URL}/api/process-panorama`, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) throw new Error('Error en el servidor al guardar el ajuste manual');

            const data = await response.json();
            if (data.status === 'success') {
                const resImgUrl = data.resultUrl.startsWith('http') ? data.resultUrl : `${BACKEND_URL}${data.resultUrl}`;
                const resDcmUrl = data.resultDicomUrl.startsWith('http') ? data.resultDicomUrl : `${BACKEND_URL}${data.resultDicomUrl}`;
                
                setResultImage(`${resImgUrl}?t=${Date.now()}`);
                setResultDicomUrl(resDcmUrl);
                setIsManualMode(false);
                alert("Ajuste guardado exitosamente. DICOM actualizado.");
            }
        } catch (err) {
            console.error(err);
            alert("Error al guardar: " + err.message);
        } finally {
            setIsSaving(false);
        }
    };

    if (!resultImage) {
        return (
            <div className="flex-1 h-full flex items-center justify-center bg-slate-100 flex-col opacity-50">
                <ImageIcon className="w-16 h-16 text-slate-300 mb-4" />
                <p className="text-slate-500 font-medium text-lg">No hay espinografía disponible</p>
                <p className="text-slate-400 text-sm mt-1">Sube las placas en el lateral para comenzar.</p>
            </div>
        );
    }

    return (
        <div className="flex-1 h-full flex flex-col bg-black relative overflow-hidden select-none">
            {/* Toolbar */}
            <div className="h-14 bg-slate-900 border-b border-white/10 flex items-center justify-between px-6 z-30 shrink-0">
                <div className="flex items-center gap-6">
                    <h2 className="text-white font-bold tracking-wider text-xs uppercase opacity-70">Visor de Estación</h2>
                    <div className="flex bg-slate-800 p-1 rounded-lg gap-1 border border-white/5">
                        <button
                            onClick={() => setActiveTool('pan')}
                            className={`p-2 rounded-md transition-all ${activeTool === 'pan' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                        >
                            <Move className="w-4 h-4" />
                        </button>
                        <button
                            onClick={() => setActiveTool('window')}
                            className={`p-2 rounded-md transition-all ${activeTool === 'window' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'}`}
                        >
                            <Sun className="w-4 h-4" />
                        </button>
                        <button onClick={resetWindowing} className="p-2 text-slate-400 hover:text-white"><RefreshCw className="w-4 h-4" /></button>
                    </div>
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={() => setIsManualMode(!isManualMode)}
                        className={`flex items-center gap-2 text-xs font-bold px-4 py-2 rounded-lg transition-all border ${isManualMode ? 'bg-yellow-500 text-black border-yellow-600 shadow-[0_0_15px_rgba(234,179,8,0.3)]' : 'bg-slate-800 text-slate-300 border-white/5 hover:bg-slate-700'}`}
                    >
                        <Layers className="w-3.5 h-3.5" /> {isManualMode ? 'Salir Edición' : 'Ajuste Manual'}
                    </button>

                    {isManualMode && (
                        <div className="flex gap-2 bg-yellow-500/10 p-1 rounded-lg border border-yellow-500/20 mr-2">
                            <button onClick={handleResetManual} className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-tighter bg-slate-900 text-white px-3 py-1.5 rounded-md hover:bg-slate-800 transition-colors">
                                <RotateCcw className="w-3 h-3" /> Deshacer
                            </button>
                            <button onClick={handleSaveManual} disabled={isSaving} className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-tighter bg-green-600 text-white px-3 py-1.5 rounded-md hover:bg-green-500 transition-colors shadow-lg">
                                {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />} Guardar
                            </button>
                        </div>
                    )}

                    <a href={resultImage} download="panorama.jpg" className="flex items-center gap-2 text-xs font-bold text-slate-300 hover:text-white bg-slate-800 px-4 py-2 rounded-lg">
                        <Download className="w-3.5 h-3.5" /> JPG
                    </a>
                    {resultDicomUrl && (
                        <>
                            <a href={resultDicomUrl} download="panorama.dcm" className="flex items-center gap-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 px-4 py-2 rounded-lg shadow-lg transition-colors">
                                <Download className="w-3.5 h-3.5" /> DICOM
                            </a>
                            <button 
                                onClick={handlePushToPacs} 
                                disabled={isPushing}
                                className="flex items-center gap-2 text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-500 px-4 py-2 rounded-lg transition-all active:scale-95 disabled:opacity-50 shadow-lg"
                            >
                                {isPushing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
                                SUBIR A PACS
                            </button>
                        </>
                    )}
                </div>
            </div>

            <div
                className={`flex-1 relative w-full h-full overflow-hidden flex items-center justify-center ${activeTool === 'window' || draggingIdx === 'window' ? 'cursor-ns-resize' : 'cursor-move'}`}
                onMouseDown={handleMouseDown}
                onMouseMove={handleGlobalMouseMove}
                onMouseUp={handleGlobalMouseUp}
                onMouseLeave={handleGlobalMouseUp}
            >
                <TransformWrapper
                    initialScale={0.4}
                    minScale={0.05}
                    maxScale={4}
                    panning={{ disabled: activeTool !== 'pan' || draggingIdx !== null, velocityDisabled: true }}
                    centerOnInit={true}
                    limitToBounds={false}
                >
                    {({ zoomIn, zoomOut, resetTransform }) => (
                        <>
                            {/* Floating Tools */}
                            <div className="absolute top-4 right-4 z-40 flex flex-col gap-1 bg-slate-900/60 backdrop-blur-md p-1.5 rounded-xl border border-white/10 shadow-2xl">
                                <button onClick={() => zoomIn(0.5)} className="w-10 h-10 flex items-center justify-center rounded-lg text-white hover:bg-indigo-600 transition-colors">
                                    <ZoomIn className="w-5 h-5" />
                                </button>
                                <button onClick={() => zoomOut(0.5)} className="w-10 h-10 flex items-center justify-center rounded-lg text-white hover:bg-indigo-600 transition-colors">
                                    <ZoomOut className="w-5 h-5" />
                                </button>
                                <hr className="border-white/10 my-1 mx-2" />
                                <button onClick={() => resetTransform()} className="w-10 h-10 flex items-center justify-center rounded-lg text-white hover:bg-indigo-600 transition-colors">
                                    <Maximize className="w-5 h-5" />
                                </button>
                            </div>

                            <TransformComponent wrapperClass="!w-full !h-full">
                                <div className="flex justify-center items-center w-full h-full relative" style={{ minWidth: isManualMode ? '2500px' : 'auto', minHeight: isManualMode ? '6000px' : 'auto' }}>
                                    {!isManualMode ? (
                                        <img
                                            src={resultImage}
                                            alt="Espinografía"
                                            draggable={false}
                                            style={{
                                                filter: `brightness(${brightness}%) contrast(${contrast}%)`,
                                                maxHeight: 'none',
                                                maxWidth: 'none',
                                                height: '92vh',
                                                transition: activeTool === 'window' ? 'none' : 'filter 0.3s ease'
                                            }}
                                            className="object-contain"
                                        />
                                    ) : (
                                        <div className="relative w-[2500px] h-[6000px] bg-slate-900/20 border border-white/5 rounded-3xl">
                                            {sourceImages.map((src, i) => {
                                                const off = manualOffsets.find(o => o.index === i) || { left: 0, top: 0 };
                                                return (
                                                    <div
                                                        key={src.id}
                                                        onMouseDown={(e) => {
                                                            if (activeTool === 'window') return;
                                                            handleManualDragStart(e, i);
                                                        }}
                                                        className={`absolute cursor-grab active:cursor-grabbing border-4 ${draggingIdx === i ? 'border-yellow-400 z-50 shadow-[0_0_30px_rgba(250,204,21,0.5)]' : 'border-yellow-500/50 z-10'} rounded-sm hover:border-yellow-400 transition-colors`}
                                                        style={{
                                                            left: `${off.left || 0}px`,
                                                            top: `${off.top || 0}px`,
                                                            filter: `brightness(${brightness}%) contrast(${contrast}%)`
                                                        }}
                                                    >
                                                        <div className="absolute -top-12 left-0 bg-yellow-500 text-lg font-bold text-black px-4 py-1 rounded uppercase shadow-lg pointer-events-none">
                                                            {src.label}
                                                        </div>
                                                        <img
                                                            src={src.url}
                                                            alt={src.label}
                                                            draggable={false}
                                                            className={`w-auto h-auto max-w-none transition-opacity duration-200 ${draggingIdx !== null ? 'opacity-80' : 'opacity-100'}`}
                                                            style={{ display: 'block', mixBlendMode: 'difference' }}
                                                        />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            </TransformComponent>
                        </>
                    )}
                </TransformWrapper>

                {/* Status Indicator */}
                <div className="absolute bottom-6 left-6 z-40 bg-black/40 backdrop-blur-sm border border-white/10 px-4 py-2 rounded-full flex gap-4 text-[10px] text-white/50 font-bold tracking-widest uppercase">
                    <span>Brillo: {Math.round(brightness)}%</span>
                    <span>Contraste: {Math.round(contrast)}%</span>
                </div>
            </div>
        </div>
    );
}
