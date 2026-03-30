import SimpleITK as sitk
import sys
import os
import zipfile
import time

def convert_nifti_to_dicom(nifti_file, output_zip):
    print(f"Leyendo NIfTI: {nifti_file}")
    try:
        image = sitk.ReadImage(nifti_file)
    except Exception as e:
        print(f"Error al leer el NIfTI: {str(e)}")
        return False
    
    # Cast a uint16 que es estándar para DICOM
    image = sitk.Cast(image, sitk.sitkUInt16)

    base_dir = os.path.dirname(output_zip)
    temp_dicom_dir = os.path.join(base_dir, f"temp_dicom_{int(time.time())}")
    os.makedirs(temp_dicom_dir, exist_ok=True)

    print(f"Escribiendo {image.GetDepth()} slices DICOM en directorio temporal...")
    
    # Metadatos básicos para engañar a los visores DICOM
    series_tag_values = [
        ("0008|0031", "150000"), # Series Time
        ("0008|0021", time.strftime("%Y%m%d")), # Series Date
        ("0008|0008", "DERIVED\\SECONDARY"), # Image Type
        ("0020|000e", "1.2.826.0.1.3680043.2.1125." + str(int(time.time()))), # Series Instance UID
        ("0020|0037", "1\\0\\0\\0\\1\\0"), # Image Orientation (Patient)
        ("0008|103e", "MONAI Segmentacion AI"), # Series Description
        ("0010|0010", os.path.basename(nifti_file).replace(".nii.gz", "")) # Patient Name
    ]
    
    writer = sitk.ImageFileWriter()
    writer.KeepOriginalImageUIDOn()
    
    size = image.GetSize()
    
    for i in range(size[2]):
        # Extraer el slice 2D del volumen 3D
        extract_size = list(size)
        extract_size[2] = 0 # 0 indica que se reduce esa dimensión
        
        index = [0, 0, i]
        
        image_slice = sitk.Extract(image, extract_size, index)
        
        # Inyectar tags
        for tag, value in series_tag_values:
            image_slice.SetMetaData(tag, value)
            
        image_slice.SetMetaData("0008|0012", time.strftime("%Y%m%d")) # Instance Creation Date
        image_slice.SetMetaData("0008|0013", time.strftime("%H%M%S")) # Instance Creation Time
        # La posición del paciente es crítica para que el visor alinee los cortes
        image_slice.SetMetaData("0020|0032", "\\".join(map(str, image.TransformIndexToPhysicalPoint((0, 0, i))))) 
        image_slice.SetMetaData("0020|0013", str(i+1)) # Instance Number
        
        filename = os.path.join(temp_dicom_dir, f"slice_{i:04d}.dcm")
        writer.SetFileName(filename)
        writer.Execute(image_slice)

    print(f"Empaquetando {size[2]} slices en formato ZIP...")
    with zipfile.ZipFile(output_zip, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, _, files in os.walk(temp_dicom_dir):
            for file in files:
                file_path = os.path.join(root, file)
                zipf.write(file_path, arcname=file)

    print("Limpiando archivos temporales...")
    for file in os.listdir(temp_dicom_dir):
        os.remove(os.path.join(temp_dicom_dir, file))
    os.rmdir(temp_dicom_dir)

    print(f"Éxito: Serie DICOM comprimida creada en {output_zip}")
    return True

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Uso: python nifti_to_dicom.py <nifti_file> <output_zip>")
        sys.exit(1)
        
    nifti_path = sys.argv[1]
    zip_path = sys.argv[2]
    
    success = convert_nifti_to_dicom(nifti_path, zip_path)
    sys.exit(0 if success else 1)
