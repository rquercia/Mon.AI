import SimpleITK as sitk
import ollama
import sys
import os
import json
import time
from datetime import datetime
import numpy as np
from PIL import Image

def test_vision(dcm_path, output_dir):
    try:
        print(f"--- INICIO TEST MEDGEMMA 1.5 VISION ---")
        if not os.path.exists(dcm_path):
            print(f"ERROR: Archivo no encontrado: {dcm_path}")
            sys.exit(1)

        # 1. Leer Imagen DICOM
        print(f"Leyendo DICOM: {os.path.basename(dcm_path)}")
        reader = sitk.ImageFileReader()
        reader.SetFileName(dcm_path)
        img = reader.Execute()
        
        # Reducir a 2D si es necesario
        if img.GetDimension() > 2:
            img = img[:, :, img.GetSize()[2]//2] # Tomar slice central si es 3D

        # 2. Procesamiento de imagen (Ventaneo básico para visualización)
        stats = sitk.StatisticsImageFilter()
        stats.Execute(img)
        min_img, max_img = float(stats.GetMinimum()), float(stats.GetMaximum())
        
        # Generar una imagen re-escalada (0-255)
        img_array = sitk.GetArrayFromImage(sitk.RescaleIntensity(img, 0, 255)).astype(np.uint8)
        
        # Guardar JPG temporal
        timestamp = int(time.time())
        jpg_path = os.path.join(output_dir, f"test_vision_{timestamp}.jpg")
        Image.fromarray(img_array).save(jpg_path, quality=95)
        print(f"Imagen temporal generada: {jpg_path}")

        # 3. Preparar el Prompt para MedGemma 1.5
        prompt = "Actúa como un radiólogo experto. Analiza esta radiografía y describe detalladamente los hallazgos anatómicos y cualquier anomalía que detectes en español."

        MODEL_NAME = 'dcarrascosa/medgemma-1.5-4b-it:q8_0'
        print(f"Enviando a Ollama ({MODEL_NAME})... esto puede tardar dependiendo de la GPU.")
        
        client = ollama.Client(host='http://monai_llm:11434')
        
        t0 = time.time()
        response = client.chat(
            model=MODEL_NAME,
            messages=[
                {
                    'role': 'user', 
                    'content': prompt, 
                    'images': [jpg_path]
                }
            ],
            options={'temperature': 0.0}
        )
        t1 = time.time()

        print(f"\n--- RESPUESTA DE MEDGEMMA (Tiempo: {t1-t0:.2f}s) ---")
        report = response.get('message', {}).get('content', '')
        if report:
            print(report)
        else:
            print("No se recibió respuesta del modelo.")
        print(f"--- FIN DEL TEST ---")

    except Exception as e:
        print(f"❌ Error durante el test: {e}")

if __name__ == "__main__":
    # Parametros: <input_dcm> <output_dir>
    # Si no hay argumentos, usamos valores por defecto para pruebas rápidas
    input_dcm = sys.argv[1] if len(sys.argv) > 1 else "/opt/monai/data/006caa04-bf78d284-9ca0e933-8a994629-ebaa6516.dcm"
    output_dir = sys.argv[2] if len(sys.argv) > 2 else "/opt/monai/output"
    
    test_vision(input_dcm, output_dir)
