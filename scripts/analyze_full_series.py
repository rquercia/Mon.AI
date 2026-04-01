import SimpleITK as sitk
import requests
import sys
import os
import json
import time
import base64
from datetime import datetime
import numpy as np
from PIL import Image

def encode_image(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

def generate_filters(img):
    # Generar 3 Ventanas
    stats = sitk.StatisticsImageFilter()
    stats.Execute(img)
    min_img, max_img = float(stats.GetMinimum()), float(stats.GetMaximum())
    rango = max_img - min_img

    def get_array(sitk_img):
        return sitk.GetArrayFromImage(sitk.Cast(sitk_img, sitk.sitkUInt8))

    img_gen = get_array(sitk.RescaleIntensity(img, 0, 255))
    img_lung = get_array(sitk.RescaleIntensity(sitk.IntensityWindowing(img, min_img, min_img + rango * 0.5), 0, 255))
    img_bone = get_array(sitk.RescaleIntensity(sitk.IntensityWindowing(img, min_img + rango * 0.3, max_img), 0, 255))
    
    return img_gen, img_lung, img_bone

def analyze_full(input_dir, output_dir, patient_name="Paciente", custom_prompt_path=None):
    try:
        if not os.path.exists(input_dir):
            sys.exit(1)

        dcm_files = sorted([f for f in os.listdir(input_dir) if f.lower().endswith('.dcm')])
        if not dcm_files:
            sys.exit(1)

        # LEER SYSTEM PROMPT
        custom_instructions = ""
        if custom_prompt_path and os.path.exists(custom_prompt_path):
            with open(custom_prompt_path, 'r', encoding='utf-8') as f:
                custom_instructions = f.read().strip()

        rows = []
        ui_paths = []
        timestamp = int(time.time())

        for idx, dcm in enumerate(dcm_files):
            dcm_path = os.path.join(input_dir, dcm)
            reader = sitk.ImageFileReader()
            reader.SetFileName(dcm_path)
            img = reader.Execute()
            
            if img.GetDimension() > 2:
                img = img[:, :, 0]

            # Re-escalar para que todas las placas tengan el mismo ancho antes de procesar
            target_width = 2048
            original_size = img.GetSize()
            scale = target_width / original_size[0]
            target_height = int(original_size[1] * scale)
            
            # Resampling a tamaño estándar
            resample = sitk.ResampleImageFilter()
            resample.SetOutputSpacing([s/scale for s in img.GetSpacing()])
            resample.SetSize([target_width, target_height])
            resample.SetOutputDirection(img.GetDirection())
            resample.SetOutputOrigin(img.GetOrigin())
            resample.SetInterpolator(sitk.sitkLinear)
            img = resample.Execute(img)

            # Generate filters for this image
            img_gen, img_lung, img_bone = generate_filters(img)
            
            # Stack horizontally for the row
            row_arr = np.hstack((img_gen, img_lung, img_bone))
            rows.append(row_arr)
            
            # Save individual "general" for UI preview if needed
            p_ui = os.path.join(output_dir, f"full_{idx}_{timestamp}.jpg")
            Image.fromarray(img_gen).save(p_ui)
            ui_paths.append(os.path.basename(p_ui))

        # Create Mosaico (Stack rows vertically)
        mosaico_arr = np.vstack(rows)
        mosaico_path = os.path.join(output_dir, f"mosaico_full_{timestamp}.jpg")
        Image.fromarray(mosaico_arr).save(mosaico_path, quality=85)

        fecha_actual = datetime.now().strftime("%d/%m/%Y %H:%M")

        prompt_final = f"""
        Actúa como un Especialista Radiólogo Sénior. Estás analizando un ESTUDIO COMPLETO que incluye múltiples proyecciones (Frente, Perfil u otras).
        
        LA IMAGEN ADJUNTA ES UN MOSAICO:
        - Cada fila representa una placa distinta del mismo paciente.
        - Cada fila tiene 3 filtros: [GENERAL | PULMÓN | ÓSEO] de izquierda a derecha.

        ### TAREA:
        Analiza integralmente todas las imágenes visibles. Correlaciona los hallazgos entre las distintas proyecciones.
        Tu respuesta DEBE estar en ESPAÑOL y seguir el PROTOCOLO SÉNIOR DE TÓRAX.

        --- PROTOCOLO SÉNIOR UNIFICADO ---
        # 🧾 INFORME RADIOLÓGICO INTEGRAL (SÉNIOR)
        **PACIENTE:** {patient_name} | **FECHA:** {fecha_actual}
        
        - **ESTADO TÉCNICO Y PROYECCIONES:** [Menciona las vistas analizadas]
        - **TRAMA BRONCOVASCULAR:** [Hallazgos hiliares y perihiliares]
        - **PARÉNQUIMA PULMONAR:** [Infiltrados, opacidades o transparencia]
        - **ÁREA CARDIOMEDIASTINAL:** [Silueta, índice CT y grandes vasos]
        - **PLEURA Y ÁNGULOS:** [Senos costofrenicos y cardiofrenicos]
        - **ESQUELETO Y PARTES BLANDAS:** [Reja costal, clavículas, columna]
        
        - **🔍 CORRELACIÓN CLÍNICA / CONCLUSIÓN:** [Síntesis final unificada de todas las vistas]
        
        ### CONTEXTO ADICIONAL:
        {custom_instructions}

        Responde directamente en formato Markdown.
        """

        # Preparar envío a LM Studio
        base64_mosaico = encode_image(mosaico_path)
        
        payload = {
            "model": "Medgemma 1.5 4B Instruct",
            "messages": [
                {"role": "system", "content": "Análisis clínico integral multicanal. Correlaciona las proyecciones adjuntas."},
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt_final},
                        {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_mosaico}"}}
                    ]
                }
            ],
            "temperature": 0.1
        }

        print(f"[LM_STUDIO] Enviando mosaico integral a LM Studio...")
        response = requests.post("http://host.docker.internal:1234/v1/chat/completions", json=payload, timeout=600)
        
        if response.status_code == 200:
            report_content = response.json()['choices'][0]['message']['content']
        else:
            print(f"Error API: {response.status_code}")
            report_content = "Error al conectar con LM Studio."
        
        print("---RADIOLOGY_REPORT_START---")
        print(report_content)
        print("---RADIOLOGY_REPORT_END---")
        print(f"---IMAGES_GENERATED---:{json.dumps(ui_paths)}")

    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    # Params: <input_dir> <output_dir> <patient_name> [custom_prompt_path]
    p_name = sys.argv[3] if len(sys.argv) > 3 else "Paciente"
    p_prompt = sys.argv[4] if len(sys.argv) > 4 else None
    analyze_full(sys.argv[1], sys.argv[2], p_name, p_prompt)
