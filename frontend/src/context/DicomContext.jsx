import React, { createContext, useState, useContext } from 'react';

const DicomContext = createContext();

export function DicomProvider({ children }) {
    const [resultImage, setResultImage] = useState(null);
    const [resultDicomUrl, setResultDicomUrl] = useState(null);
    const [sourceImages, setSourceImages] = useState([]);
    const [initialOffsets, setInitialOffsets] = useState([]);
    const [manualOffsets, setManualOffsets] = useState([]);
    const [rawFiles, setRawFiles] = useState([]);

    const value = {
        resultImage, setResultImage,
        resultDicomUrl, setResultDicomUrl,
        sourceImages, setSourceImages,
        initialOffsets, setInitialOffsets,
        manualOffsets, setManualOffsets,
        rawFiles, setRawFiles
    };

    return (
        <DicomContext.Provider value={value}>
            {children}
        </DicomContext.Provider>
    );
}

export function useDicom() {
    const context = useContext(DicomContext);
    if (context === undefined) {
        throw new Error('useDicom must be used within a DicomProvider');
    }
    return context;
}
