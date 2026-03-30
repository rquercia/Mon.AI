import SimpleITK as sitk
import os
import sys
import zipfile
import time
import shutil
import glob
import pydicom

def export_full_bundle(nifti_mask_path, original_dicom_dir, output_zip):
    """
    Crea un ZIP que contiene:
    1. Una serie DICOM con las imágenes originales (conservando sus UIDs).
    2. Una serie DICOM con la máscara de segmentación asociada al mismo paciente/estudio.
    """
    print(f"Iniciando exportación de bundle DICOM (Modo Sincronización)...")
    
    # Directorio temporal de trabajo
    temp_root = f"/tmp/export_{int(time.time())}"
    orig_temp_dir = os.path.join(temp_root, "ORIGINAL_IMAGINES")
    mask_temp_dir = os.path.join(temp_root, "AI_SEG_MASKS")
    os.makedirs(orig_temp_dir, exist_ok=True)
    os.makedirs(mask_temp_dir, exist_ok=True)

    # 1. Buscar y Leer Metadatos de un DICOM Original de forma recursiva
    print("Buscando archivos DICOM en el directorio de entrada...")
    all_files = []
    for root, _, files in os.walk(original_dicom_dir):
        for f in files:
            # Excluir archivos NIfTI o temporales
            if not f.endswith(('.nii.gz', '.nii', '.json', '.zip')):
                all_files.append(os.path.join(root, f))
    
    # Filtrar solo archivos que sean DICOM reales (probando con pydicom)
    original_files = []
    for f in all_files:
        try:
            # Intentar leer el preámbulo DICOM sin cargar todo el archivo (más rápido)
            with open(f, 'rb') as fp:
                fp.seek(128)
                if fp.read(4) == b'DICM':
                    original_files.append(f)
        except:
            continue
    
    if not original_files:
        print("Error: No se encontraron archivos DICOM válidos en la estructura.")
        return False

    # Tomar la primera imagen como plantilla de metadatos (Patient ID, Study UID, FrameOfRef)
    try:
        ds_template = pydicom.dcmread(original_files[0])
        patient_name = str(ds_template.get("PatientName", "DESCONOCIDO"))
        patient_id = str(ds_template.get("PatientID", "000000"))
        study_uid = str(ds_template.get("StudyInstanceUID", ""))
        frame_of_ref = str(ds_template.get("FrameOfReferenceUID", ""))
        orientation = ds_template.get("ImageOrientationPatient", [1, 0, 0, 0, 1, 0])
        
        print(f"Sincronizando Paciente: {patient_name} [{patient_id}]")
        print(f"Study UID: {study_uid}")
    except Exception as e:
        print(f"Error al leer metadatos de plantilla: {e}")
        return False

    # 2. Copiar imágenes originales al bundle
    for i, f in enumerate(original_files):
        shutil.copy(f, os.path.join(orig_temp_dir, os.path.basename(f)))
    
    # 3. Convertir NIfTI Mask a DICOM (Sincronizado 1:1 con Original)
    print(f"Convirtiendo máscara NIfTI con geometría 1:1 del original...")
    try:
        mask_image = sitk.ReadImage(nifti_mask_path)
        # Asegurar que esté en uint16 para DICOM
        mask_image = sitk.Cast(mask_image, sitk.sitkUInt16)
        
        # Generar un NUEVO Series Instance UID para la máscara (MISMO STUDY, DISTINTA SERIE)
        mask_series_uid = pydicom.uid.generate_uid()
        
        writer = sitk.ImageFileWriter()
        writer.KeepOriginalImageUIDOn()
        
        # Ordenar archivos originales por posición Z para procesar en orden
        sorted_originals = []
        for f in original_files:
            try:
                ds = pydicom.dcmread(f, stop_before_pixels=True)
                sorted_originals.append((float(ds.ImagePositionPatient[2]), f, ds))
            except:
                continue
        sorted_originals.sort() # Ordenar por Z

        print(f"Generando {len(sorted_originals)} cortes sincronizados...")
        
        for i, (z_pos, orig_fn, ds_orig) in enumerate(sorted_originals):
            # Obtener geometría del original
            orientation = [float(x) for x in ds_orig.ImageOrientationPatient]
            position = [float(x) for x in ds_orig.ImagePositionPatient]
            pixel_spacing = [float(x) for x in ds_orig.PixelSpacing]
            rows = int(ds_orig.Rows)
            cols = int(ds_orig.Columns)

            # Usar SimpleITK para remuestrear el volumen de la máscara a esta geometría 2D exacta
            # Esto garantiza que si la IA dividió cortes, aquí se vuelvan a unir para coincidir con el original
            resampler = sitk.ResampleImageFilter()
            resampler.SetOutputSpacing([pixel_spacing[0], pixel_spacing[1], 1.0])
            resampler.SetSize([cols, rows, 1])
            resampler.SetOutputDirection([orientation[0], orientation[1], 0, orientation[3], orientation[4], 0, 0, 0, 1])
            resampler.SetOutputOrigin([position[0], position[1], position[2]])
            resampler.SetInterpolator(sitk.sitkNearestNeighbor) # Nearest para no promediar etiquetas (labels)
            
            mask_slice_vol = resampler.Execute(mask_image)
            mask_slice = sitk.Extract(mask_slice_vol, [cols, rows, 0], [0, 0, 0])

            # Tags de Sincronización
            mask_slice.SetMetaData("0010|0010", patient_name)
            mask_slice.SetMetaData("0010|0020", patient_id)
            mask_slice.SetMetaData("0020|000d", study_uid)
            mask_slice.SetMetaData("0020|0052", frame_of_ref)
            
            mask_slice.SetMetaData("0020|000e", mask_series_uid)
            mask_slice.SetMetaData("0008|103e", "AI Segmentacion (Sincronizada 1:1)")
            mask_slice.SetMetaData("0008|0060", "CT") 
            
            # Tags de Visualización
            mask_slice.SetMetaData("0028|1050", "5")
            mask_slice.SetMetaData("0028|1051", "10")
            mask_slice.SetMetaData("0028|1052", "0")
            mask_slice.SetMetaData("0028|1053", "1")
            
            mask_slice.SetMetaData("0020|0037", "\\".join(map(str, orientation)))
            mask_slice.SetMetaData("0020|0032", "\\".join(map(str, position)))
            mask_slice.SetMetaData("0020|0013", str(i+1)) # Instance Number
            
            slice_fn = os.path.join(mask_temp_dir, f"mask_{i:04d}.dcm")
            writer.SetFileName(slice_fn)
            writer.Execute(mask_slice)
            
    except Exception as e:
        print(f"Error procesando la máscara sincronizada: {str(e)}")
        import traceback
        traceback.print_exc()
        return False
        
    # 4. Comprimir todo
    print(f"Empaquetando bundle final sincronizado 1:1 en {output_zip}...")
    with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED) as zipf:
        # Añadir máscaras
        for root, _, files in os.walk(mask_temp_dir):
            for file in files:
                zipf.write(os.path.join(root, file), arcname=os.path.join("SEG_AI_LABELS", file))

    shutil.rmtree(temp_root)
    print("¡Bundle DICOM Sincronizado correctamente!")
    return True

if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Uso: python export_full_dicom.py <nifti_mask> <orig_dicom_dir> <output_zip>")
        sys.exit(1)
        
    mask_path = sys.argv[1]
    orig_dir = sys.argv[2]
    out_zip = sys.argv[3]
    
    success = export_full_bundle(mask_path, orig_dir, out_zip)
    sys.exit(0 if success else 1)
