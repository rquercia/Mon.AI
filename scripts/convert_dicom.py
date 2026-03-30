import os
import dicom2nifti
import dicom2nifti.settings as settings
import sys
import pydicom

# Deshabilitar validación de incremento constante de slice para datos del mundo real
settings.disable_validate_slice_increment()

def is_dicom_file(filepath):
    """
    Verifica si un archivo es DICOM chequeando el preámbulo 'DICM' en el offset 128
    """
    try:
        if os.path.isdir(filepath): return False
        with open(filepath, 'rb') as f:
            f.seek(128)
            return f.read(4) == b'DICM'
    except:
        return False

def get_patient_name(dicom_dir):
    try:
        for f in os.listdir(dicom_dir):
            file_path = os.path.join(dicom_dir, f)
            if is_dicom_file(file_path) or f.lower().endswith('.dcm'):
                ds = pydicom.dcmread(file_path, stop_before_pixels=True)
                name = str(ds.PatientName).replace("^", "_").replace(" ", "_").strip()
                return name if name else "PacienteSeg"
    except Exception as e:
        print(f"No se pudo extraer el paciente: {str(e)}")
    return "PacienteSeg"

def find_dicom_dir(root_dir):
    """
    Busca recursivamente el primer directorio que contenga archivos DICOM
    (con o sin extensión .dcm)
    """
    for root, dirs, files in os.walk(root_dir):
        # Primero intentamos por extensión (rápido)
        if any(f.lower().endswith('.dcm') for f in files):
            return root
        # Si no hay .dcm, chequeamos la firma de los archivos
        for f in files:
            if is_dicom_file(os.path.join(root, f)):
                return root
    return root_dir # fallback

def convert_dicom_to_nifti(input_dir, output_file):
    """
    Convierte una serie de archivos DICOM en un solo archivo NIfTI (.nii.gz)
    """
    try:
        # Buscar el subdirectorio real con imágenes (por si el zip traía carpetas)
        real_input_dir = find_dicom_dir(input_dir)
        print(f"Iniciando conversión. Directorio detectado: {real_input_dir}")
        
        if not os.path.exists(real_input_dir):
            print(f"Error: El directorio {real_input_dir} no existe.")
            return False
            
        patient_name = get_patient_name(real_input_dir)
        
        output_dir = os.path.dirname(output_file)
        if not os.path.exists(output_dir):
            os.makedirs(output_dir)
            
        dicom2nifti.dicom_series_to_nifti(real_input_dir, output_file, reorient_nifti=True)
        
        print(f"Éxito: Archivo NIfTI creado en {output_file}")
        return True
    except Exception as e:
        print(f"Error durante la conversión: {str(e)}")
        return False

if __name__ == "__main__":
    # Uso: python convert_dicom.py /ruta/a/dicoms /ruta/al/output.nii.gz
    if len(sys.argv) < 3:
        print("Uso: python convert_dicom.py <input_dir> <output_file>")
        sys.exit(1)
        
    input_path = sys.argv[1]
    output_path = sys.argv[2]
    
    success = convert_dicom_to_nifti(input_path, output_path)
    sys.exit(0 if success else 1)
