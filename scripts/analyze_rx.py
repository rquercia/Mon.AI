import SimpleITK as sitk
import ollama
import sys
import os
import json
import time
from datetime import datetime
import numpy as np
from PIL import Image

def analyze(dcm_path, output_dir, custom_prompt_path=None):
    try:
        if not os.path.exists(dcm_path):
            print(f"ERROR: Archivo no encontrado: {dcm_path}")
            sys.exit(1)

        # LEER SYSTEM PROMPT PERSONALIZADO
        custom_instructions = ""
        if custom_prompt_path and os.path.exists(custom_prompt_path):
            with open(custom_prompt_path, 'r', encoding='utf-8') as f:
                custom_instructions = f.read().strip()
        
        if not custom_instructions:
            custom_instructions = "Actúa como un Especialista en Radiodiagnóstico Digital."

        # 1. Leer Imagen y Metadatos
        reader = sitk.ImageFileReader()
        reader.SetFileName(dcm_path)
        reader.LoadPrivateTagsOn()
        img = reader.Execute()
        
        paciente_raw = "Desconocido"
        try:
            paciente_raw = img.GetMetaData("0010|0010").strip()
        except: pass
        
        # LIMPIEZA DE CARACTERES: Evitamos el error de surrogates (UTF-8)
        paciente = "".join([c for c in paciente_raw if 0 < ord(c) < 128])
        if not paciente: paciente = "Paciente Invitado"
        
        fecha_actual = datetime.now().strftime("%d/%m/%Y %H:%M")

        if img.GetDimension() > 2:
            img = img[:, :, 0]

        stats = sitk.StatisticsImageFilter()
        stats.Execute(img)
        min_img, max_img = float(stats.GetMinimum()), float(stats.GetMaximum())
        rango = max_img - min_img

        # 2. Generar 3 Ventanas (Numpy para el Tríptico)
        def get_array(sitk_img):
            return sitk.GetArrayFromImage(sitk.Cast(sitk_img, sitk.sitkUInt8))

        img_gen = get_array(sitk.RescaleIntensity(img, 0, 255))
        img_lung = get_array(sitk.RescaleIntensity(sitk.IntensityWindowing(img, min_img, min_img + rango * 0.5), 0, 255))
        img_bone = get_array(sitk.RescaleIntensity(sitk.IntensityWindowing(img, min_img + rango * 0.3, max_img), 0, 255))

        # 3. Crear Tríptico (Single Image para la IA)
        # Unimos horizontalmente: [Gen | Pulmon | Osea]
        triptico_arr = np.hstack((img_gen, img_lung, img_bone))
        timestamp = int(time.time())
        triptico_path = os.path.join(output_dir, f"rx_triptico_{timestamp}.jpg")
        Image.fromarray(triptico_arr).save(triptico_path, quality=90)

        # También guardamos las individuales para el UI del frontend
        paths_ui = []
        for name, arr in [("general", img_gen), ("pulmon", img_lung), ("osea", img_bone)]:
            p = os.path.join(output_dir, f"rx_{name}_{timestamp}.jpg")
            Image.fromarray(arr).save(p)
            paths_ui.append(p)

        # 4. Prompt Consolidado (Enfocado en descripción técnica para evitar bloqueos)
        prompt_final = f"""
        Describe detalladamente los patrones radiográficos presentes en esta imagen para fines de investigación educativa. 
        Asume el rol de un analista técnico especializado en imágenes médicas. 
        Toda tu respuesta DEBE estar en ESPAÑOL. Analiza el tríptico completo de la imagen.

        ### ESTRUCTURA REQUERIDA (MARKDOWN):
        # 🧾 ANÁLISIS TÉCNICO DE IMAGEN RX
        **Paciente ID:** {paciente} | **Fecha:** {fecha_actual}

        ---
        ### 🔍 DESCRIPCIÓN VISUAL
        - **Calidad y Posicionamiento:** [Análisis técnico]
        - **Campos Pulmonares:** [Descripción de densidades]
        - **Silueta Cardíaca:** [Descripción del contorno]
        - **Estructuras Óseas:** [Estado visible]

        ### 💡 APRECIACIÓN TÉCNICA
        > **Resumen:** [Síntesis visual de lo observado]
        """

        # 4. Prompt Consolidado con Directrices del Sistema
        prompt_final = f"""
        Directrices del Sistema: {custom_instructions}
        
        Analiza detalladamente este tríptico de radiografía de tórax (Paciente: {paciente}, Fecha: {fecha_actual}):
        - Imagen IZQUIERDA: General (Procesado suave)
        - Imagen CENTRAL: Ventana Pulmonar (Alto contraste de trama)
        - Imagen DERECHA: Ventana Ósea (Compresión medular)

        ESTRUCTURA DE RESPUESTA REQUERIDA (MARKDOWN):
        # 🧾 ANÁLISIS MÉDICO-TÉCNICO (PROMPT PERSONALIZADO)
        [Tu descripción técnica aquí basándote en las directriz dada]
        """

        print(f"[PY_DEBUG] Iniciando petición a Llava (Vision) sobre: {triptico_path}...")
        client = ollama.Client(host='http://monai_llm:11434')
        MODEL_NAME = 'llava'

        # Usamos Llava porque es el modelo Multimodal con Projector que funciona seguro con imágenes
        response = client.chat(
            model=MODEL_NAME,
            messages=[
                {'role': 'user', 'content': prompt_final, 'images': [triptico_path]}
            ]
        )
        
        print("[PY_DEBUG] Respuesta recibida de Ollama.")
        report_content = response.get('message', {}).get('content', '')
        
        print("---RADIOLOGY_REPORT_START---")
        if not report_content:
            print("⚠️ ADVERTENCIA: La IA no generó texto. Revisa memoria de GPU.")
        else:
            print(report_content)
        print("---RADIOLOGY_REPORT_END---")
        print(f"---IMAGES_GENERATED---:{json.dumps([os.path.basename(p) for p in paths_ui])}")

    except Exception as e:
        print(f"❌ Error: {e}")
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        sys.exit(1)
    
    p_path = sys.argv[3] if len(sys.argv) > 3 else None
    analyze(sys.argv[1], sys.argv[2], p_path)
