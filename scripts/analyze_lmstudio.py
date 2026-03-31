import SimpleITK as sitk
import requests
import sys
import os
import json
import time
import base64
import argparse
from datetime import datetime
import numpy as np
from PIL import Image

def encode_image(image_path):
    with open(image_path, "rb") as image_file:
        return base64.b64encode(image_file.read()).decode('utf-8')

def generate_filters(img, win_gral=None, win_lung=None, win_bone=None):
    stats = sitk.StatisticsImageFilter()
    stats.Execute(img)
    min_val, max_val = float(stats.GetMinimum()), float(stats.GetMaximum())
    rango = (max_val - min_val) if (max_val > min_val) else 1.0
    
    print(f"[DICOM_STATS] Image Min: {min_val} | Max: {max_val} | Range: {rango}")

    # Intentamos leer la ventana por defecto del DICOM (WindowCenter/Width)
    d_center, d_width = None, None
    try:
        d_center = float(img.GetMetaData('0028|1050').split('\\')[0]) if img.HasMetaDataKey('0028|1050') else None
        d_width = float(img.GetMetaData('0028|1051').split('\\')[0]) if img.HasMetaDataKey('0028|1051') else None
    except: pass

    def get_array(sitk_img):
        return sitk.GetArrayFromImage(sitk.Cast(sitk_img, sitk.sitkUInt8))

    # Gral Window: Prioridad 1: User | Prioridad 2: DICOM Meta | Prioridad 3: Full Range
    if win_gral:
        g_min, g_max = float(win_gral[0]), float(win_gral[1])
    elif d_center and d_width:
        g_min, g_max = d_center - d_width/2, d_center + d_width/2
    else:
        g_min, g_max = min_val, max_val
        
    img_gen = get_array(sitk.RescaleIntensity(sitk.IntensityWindowing(img, int(g_min), int(g_max)), 0, 255))
    
    # Lung Window
    l_min = float(win_lung[0]) if win_lung else min_val
    l_max = float(win_lung[1]) if win_lung else (min_val + rango * 0.5)
    img_lung = get_array(sitk.RescaleIntensity(sitk.IntensityWindowing(img, int(l_min), int(l_max)), 0, 255))
    
    # Bone Window
    b_min = float(win_bone[0]) if win_bone else (min_val + rango * 0.3)
    b_max = float(win_bone[1]) if win_bone else max_val
    img_bone = get_array(sitk.RescaleIntensity(sitk.IntensityWindowing(img, int(b_min), int(b_max)), 0, 255))
    
    return img_gen, img_lung, img_bone

def analyze_lmstudio():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_dir")
    parser.add_argument("output_dir")
    parser.add_argument("info_json")
    parser.add_argument("prompt_path", nargs='?')
    parser.add_argument("--preview", action="store_true")
    
    # New Window Params % (Optional)
    parser.add_argument("--win-gral", nargs=2, type=float, help="Min and Max % for General window")
    parser.add_argument("--win-lung", nargs=2, type=float, help="Min and Max % for Lung window")
    parser.add_argument("--win-bone", nargs=2, type=float, help="Min and Max % for Bone window")

    args = parser.parse_args()

    try:
        info = json.loads(args.info_json)
        p_name, p_age, p_sex, p_study = info.get('name', 'N/A'), info.get('age', 'N/A'), info.get('sex', 'N/A'), info.get('study', 'N/A')

        if not os.path.exists(args.input_dir): sys.exit(1)
        dcm_files = sorted([f for f in os.listdir(args.input_dir) if f.lower().endswith('.dcm')])
        if not dcm_files: sys.exit(1)

        generated_files = []
        timestamp = int(time.time())

        # Procesamos solo la primera radiografía
        dcm = dcm_files[0]
        img_original = sitk.ReadImage(os.path.join(args.input_dir, dcm))
        if img_original.GetDimension() > 2: img_original = img_original[:, :, 0]

        # PROCESO FULL PLATE
        img_rescaled = img_original

        # Generar las 3 versiones por separado con valores opcionales en %
        img_gen, img_lung, img_bone = generate_filters(img_original, win_gral=args.win_gral, win_lung=args.win_lung, win_bone=args.win_bone)
        
        filter_names = ["general", "pulmon", "hueso"]
        filter_arrays = [img_gen, img_lung, img_bone]
        
        encoded_images = []
        prefix = "preview" if args.preview else "final_ia"

        for name, arr in zip(filter_names, filter_arrays):
            fname = f"{prefix}_{name}_{timestamp}.jpg"
            fpath = os.path.join(args.output_dir, fname)
            
            # Convertir a PIL para redimensionado seguro sin recortes espaciales
            pill_img = Image.fromarray(arr)
            
            # Redimensionar solo si es mayor a 2048 para agilizar visión IA sin perder la placa
            if pill_img.width > 2048:
                w, h = pill_img.size
                scale = 2048 / w
                pill_img = pill_img.resize((2048, int(h * scale)), Image.Resampling.LANCZOS)
                
            pill_img.save(fpath, quality=90)
            generated_files.append(fname)
            
            if not args.preview:
                encoded_images.append(encode_image(fpath))

        if args.preview:
            # Mandamos la lista de imágenes generadas para la preview
            print(f"---PREVIEW_IMAGES---:{json.dumps(generated_files)}")
            return

        # SI NO ES PREVIEW, ENVIAR A LM STUDIO
        fecha = datetime.now().strftime("%d/%m/%Y %H:%M")
        
        custom_instructions = ""
        if args.prompt_path and os.path.exists(args.prompt_path):
            with open(args.prompt_path, 'r', encoding='utf-8') as f: custom_instructions = f.read().strip()

        # Prompt optimizado para múltiples imágenes separadas
        system_msg = f"""RESPONDE EXCLUSIVAMENTE EN CASTELLANO.
        Actúa como un médico radiólogo sénior. 
        Te adjunto TRES versiones de la MISMA radiografía del paciente, procesadas con distintos ventaneos para mejorar la visualización:
        1. Visión General
        2. Ventana de Pulmón (Blanda)
        3. Ventana Ósea
        
        DATOS DEL PACIENTE: Nombre: {p_name} | Edad: {p_age} | Sexo: {p_sex} | Estudio: {p_study} | Fecha: {fecha}
        
        Tu tarea es correlacionar los hallazgos entre las tres imágenes para dar un diagnóstico preciso.
        SOLO DEVUELVE EL INFORME EN MARKDOWN. NO INCLUYAS INTRODUCCIONES.
        
        Instrucción específica: {custom_instructions}
        """

        # Construir el contenido del mensaje con las 3 imágenes por separado
        user_content = [{"type": "text", "text": system_msg}]
        for b64 in encoded_images:
            user_content.append({
                "type": "image_url", 
                "image_url": {"url": f"data:image/jpeg;base64,{b64}"}
            })

        payload = {
            "model": "Medgemma 1.5 4B Instruct",
            "messages": [
                {"role": "system", "content": "Análisis clínico multicanal. Correlaciona las ventanas adjuntas."},
                {"role": "user", "content": user_content}
            ],
            "temperature": 0.1
        }

        print(f"[LM_STUDIO] Enviando {len(encoded_images)} imágenes separadas...")
        response = requests.post("http://host.docker.internal:1234/v1/chat/completions", json=payload, timeout=600)
        if response.status_code == 200:
            print("---RADIOLOGY_REPORT_START---")
            print(response.json()['choices'][0]['message']['content'])
            print("---RADIOLOGY_REPORT_END---")
            print(f"---IMAGES_GENERATED---:{json.dumps(generated_files)}")
        else:
            print(f"Error API: {response.status_code}")
            sys.exit(1)

    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    analyze_lmstudio()
