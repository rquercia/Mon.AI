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

def generate_filters(img):
    stats = sitk.StatisticsImageFilter()
    stats.Execute(img)
    min_val, max_val = float(stats.GetMinimum()), float(stats.GetMaximum())
    rango = (max_val - min_val) if (max_val > min_val) else 1.0

    def get_array(sitk_img):
        return sitk.GetArrayFromImage(sitk.Cast(sitk_img, sitk.sitkUInt8))

    img_gen = get_array(sitk.RescaleIntensity(img, 0, 255))
    img_lung = get_array(sitk.RescaleIntensity(sitk.IntensityWindowing(img, min_val, min_val + rango * 0.5), 0, 255))
    img_bone = get_array(sitk.RescaleIntensity(sitk.IntensityWindowing(img, min_val + rango * 0.3, max_val), 0, 255))
    
    return img_gen, img_lung, img_bone

def crop_with_zoom(img, zoom_factor=1.0):
    """Detects content, applies a zoom factor centered on the content."""
    arr = sitk.GetArrayFromImage(img)
    active = np.where(arr > (np.max(arr) * 0.05))
    if active[0].size == 0: return img
    
    y_min, y_max = np.min(active[0]), np.max(active[0])
    x_min, x_max = np.min(active[1]), np.max(active[1])
    
    y_center = (y_min + y_max) // 2
    x_center = (x_min + x_max) // 2
    y_size = (y_max - y_min)
    x_size = (x_max - x_min)

    # Apply zoom factor (reduce the size of the window and center it)
    new_y_size = int(y_size / zoom_factor)
    new_x_size = int(x_size / zoom_factor)
    
    y_min_z = max(0, y_center - new_y_size // 2)
    y_max_z = min(arr.shape[0], y_center + new_y_size // 2)
    x_min_z = max(0, x_center - new_x_size // 2)
    x_max_z = min(arr.shape[1], x_center + new_x_size // 2)
    
    return img[x_min_z:x_max_z, y_min_z:y_max_z]

def analyze_lmstudio():
    parser = argparse.ArgumentParser()
    parser.add_argument("input_dir")
    parser.add_argument("output_dir")
    parser.add_argument("info_json")
    parser.add_argument("prompt_path", nargs='?')
    parser.add_argument("--zoom", type=float, default=1.0)
    parser.add_argument("--preview", action="store_true")

    args = parser.parse_args()

    try:
        info = json.loads(args.info_json)
        p_name, p_age, p_sex, p_study = info.get('name', 'N/A'), info.get('age', 'N/A'), info.get('sex', 'N/A'), info.get('study', 'N/A')

        if not os.path.exists(args.input_dir): sys.exit(1)
        dcm_files = sorted([f for f in os.listdir(args.input_dir) if f.lower().endswith('.dcm')])
        if not dcm_files: sys.exit(1)

        rows = []
        timestamp = int(time.time())

        for dcm in dcm_files:
            img = sitk.ReadImage(os.path.join(args.input_dir, dcm))
            if img.GetDimension() > 2: img = img[:, :, 0]

            # ZOOM + CROP
            img = crop_with_zoom(img, args.zoom)

            # High Quality Rescale for Vision
            target_width = 2048
            orig_size = img.GetSize()
            scale = target_width / orig_size[0]
            img = sitk.Resample(img, [target_width, int(orig_size[1] * scale)], sitk.Transform(), sitk.sitkLinear, img.GetOrigin(), img.GetSpacing(), img.GetDirection(), 0.0, img.GetPixelID())

            img_gen, img_lung, img_bone = generate_filters(img)
            # Aplicar filtro de nitidez (Unsharp Masking simplificado en numpy si sitk falla)
            row_arr = np.hstack((img_gen, img_lung, img_bone))
            rows.append(row_arr)

        mosaico_arr = np.vstack(rows)
        final_img = Image.fromarray(mosaico_arr)
        
        # Guardar mosaico
        prefix = "preview" if args.preview else "final_lm"
        mosaico_name = f"{prefix}_{timestamp}.jpg"
        mosaico_path = os.path.join(args.output_dir, mosaico_name)
        final_img.save(mosaico_path, quality=85)

        if args.preview:
            print(f"---PREVIEW_IMAGE---:{mosaico_name}")
            return

        # SI NO ES PREVIEW, ENVIAR A LM STUDIO
        base64_image = encode_image(mosaico_path)
        fecha = datetime.now().strftime("%d/%m/%Y %H:%M")
        
        custom_instructions = ""
        if args.prompt_path and os.path.exists(args.prompt_path):
            with open(args.prompt_path, 'r', encoding='utf-8') as f: custom_instructions = f.read().strip()

        system_msg = f"""RESPONDE EXCLUSIVAMENTE EN CASTELLANO.
        Actúa como un médico radiólogo sénior.Analiza la imagen BASADA EN ZOOM ({args.zoom}x).
        
        DATOS: Nombre: {p_name} | Edad: {p_age} | Sexo: {p_sex} | Estudio: {p_study} | Fecha: {fecha}
        
        Regla de oro: Hallazgos normales = 'impresionan normal' o 'sin particularidades'.
        SOLO DEVUELVE EL INFORME EN MARKDOWN. NO INCLUYAS INTRODUCCIONES.
        
        Protocolos: (Tórax | Columna | Extremidades | Rodilla/Tobillo | Abdomen) [Selecciona el correcto]

        Instrucción: {custom_instructions}
        """

        payload = {
            "model": "Medgemma 1.5 4B Instruct",
            "messages": [
                {"role": "system", "content": "Olvida análisis anteriores. Sesión nueva clínica."},
                {"role": "user", "content": [
                    {"type": "text", "text": system_msg},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{base64_image}"}}
                ]}
            ],
            "temperature": 0.1
        }

        response = requests.post("http://host.docker.internal:1234/v1/chat/completions", json=payload, timeout=400)
        if response.status_code == 200:
            print("---RADIOLOGY_REPORT_START---")
            print(response.json()['choices'][0]['message']['content'])
            print("---RADIOLOGY_REPORT_END---")
            print(f"---IMAGES_GENERATED---:[\"{mosaico_name}\"]")
        else:
            print(f"Error API: {response.status_code}")
            sys.exit(1)

    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    analyze_lmstudio()
