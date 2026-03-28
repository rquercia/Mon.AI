import os
import sys
import numpy as np
import pydicom
import SimpleITK as sitk
from highdicom import AlgorithmIdentificationSequence
from highdicom.seg.content import SegmentDescription
from highdicom.seg.enum import SegmentAlgorithmTypeValues, SegmentationTypeValues
from highdicom.seg.sop import Segmentation
from pydicom.uid import generate_uid
import datetime

def resample_mask_to_dicom(mask_itk, dicom_dir):
    """Resample NIfTI mask to match exact DICOM space using SimpleITK."""
    reader = sitk.ImageSeriesReader()
    dicom_names = reader.GetGDCMSeriesFileNames(dicom_dir)
    reader.SetFileNames(dicom_names)
    dicom_image = reader.Execute()

    resampler = sitk.ResampleImageFilter()
    resampler.SetReferenceImage(dicom_image)
    # Use NearestNeighbor for mask to avoid blurring labels
    resampler.SetInterpolator(sitk.sitkNearestNeighbor)
    resampler.SetDefaultPixelValue(0)
    resampled_mask = resampler.Execute(mask_itk)
    return resampled_mask

def create_seg_object(nifti_mask_path, original_dicom_dir, output_file):
    print(f"Generando objeto DICOM SEG real con highdicom desde {nifti_mask_path}...")
    
    # 1. Cargar máscara NIfTI y remuestrear a geometría DICOM original
    mask_itk = sitk.ReadImage(nifti_mask_path)
    
    try:
        print("Remuestreando NIFTI temporalmente para asegurar 1:1 con DICOM (HighDicom)...")
        mask_itk = resample_mask_to_dicom(mask_itk, original_dicom_dir)
    except Exception as e:
        print(f"Advertencia: Falló el remuestreo SITK: {e}")
        
    mask_data = sitk.GetArrayFromImage(mask_itk)
    mask_data = mask_data.astype(np.uint8)
    
    unique_labels = np.unique(mask_data)
    unique_labels = unique_labels[unique_labels > 0]
    
    if len(unique_labels) == 0:
        print("Error: La máscara no tiene píxeles positivos, no hay nada que segmentar.")
        return False
        
    # 2. Cargar DICOMs originales
    orig_files = [os.path.join(original_dicom_dir, f) for f in os.listdir(original_dicom_dir) if f.lower().endswith('.dcm')]
    datasets = [pydicom.dcmread(f) for f in orig_files]
    # Importante: para highdicom, ordenarlos correctamente por ImagePositionPatient (normalmente Z)
    datasets.sort(key=lambda x: float(x.ImagePositionPatient[2]))
    
    # 3. Descripciones de Segmentos (highdicom)
    segment_descriptions = []
    
    for label in unique_labels:
        from pydicom.sr.coding import Code
        
        algorithm_identification = AlgorithmIdentificationSequence(
            name="MONAI SwinUNETR v1",
            version="1.0",
            family=Code("110542", "DCM", "Artificial Intelligence")
        )
        
        description = SegmentDescription(
            segment_number=int(label),
            segment_label=f"Nodule {int(label)}",
            segmented_property_category=Code("44808001", "SCT", "Anatomy"),
            segmented_property_type=Code("4147007", "SCT", "Mass"),
            algorithm_type=SegmentAlgorithmTypeValues.AUTOMATIC,
            algorithm_identification=algorithm_identification
        )
        segment_descriptions.append(description)
        
    # Highdicom espera que aseguremos el tipo a bool si es binary o int para discretas
    # En este caso usamos etiquetas enteras y pedimos highdicom mapearlas
    print(f"Empaquetando Segmentos: {len(datasets)} frames.")

    # 4. Crear el Objeto DICOM SEG
    try:
        seg_dataset = Segmentation(
            source_images=datasets,
            pixel_array=mask_data,
            segmentation_type=SegmentationTypeValues.BINARY,
            segment_descriptions=segment_descriptions,
            series_instance_uid=generate_uid(),
            series_number=300,
            sop_instance_uid=generate_uid(),
            instance_number=1,
            manufacturer="Antigravity MONAI Integration",
            manufacturer_model_name="AI-Lung",
            software_versions="1.0",
            device_serial_number="DCM-001"
        )
        
        seg_dataset.save_as(output_file)
        print(f"Objeto DICOM SEG guardado exitosamente en: {output_file}")
        return True
    except Exception as e:
        print(f"Error generando DICOM SEG con HighDicom: {str(e)}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Uso: python create_dicom_seg.py <mask.nii.gz> <orig_dicom_dir> <output.dcm>")
        sys.exit(1)
        
    nifti_mask = sys.argv[1]
    orig_dir = sys.argv[2]
    out_file = sys.argv[3]
    
    create_seg_object(nifti_mask, orig_dir, out_file)
