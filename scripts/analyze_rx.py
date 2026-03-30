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

        # 4. Prompt Consolidado con Lógica de Clasificación y Protocolos
        prompt_final = f"""
        Actúa como un Especialista Radiólogo experto. Tu tarea es analizar la imagen médica adjunta (tríptico) y generar un informe estructurado.
        
        INSTRUCCIONES CRÍTICAS:
        1. Identifica visualmente el tipo de estudio (Tórax, Columna, Extremidad, Rodilla/Tobillo o Abdomen).
        2. Selecciona únicamente EL PROTOCOLO que corresponda de la lista técnica inferior.
        3. Rellena los campos basándote en lo observado en las tres ventanas (General, Blanda/Pulmonar, Ósea).
        4. Toda la respuesta DEBE estar en ESPAÑOL.
        5. Mantén un tono técnico y profesional.

        ### PROTOCOLOS TÉCNICOS DISPONIBLES:

        --- PROTOCOLO 1: TÓRAX Y REJA COSTAL ---
        # 🧾 INFORME DE TÓRAX Y REJA COSTAL
        - **TÓRAX:** (Simétrico o asimétrico)
        - **ÍNDICE CARDIO-TORÁCICO:** (Conservado o alterado)
        - **ÁNGULOS COSTO Y CARDIO-FRÉNICOS:** (Libres u ocupados)
        - **HEMIDIAFRAGMAS:** (Libres o no valorables)
        - **LESIONES PLEUROPARENQUIMATOSAS:** (Presencia o ausencia de lesiones evidenciables)
        - **PARRILLA COSTAL:** (Estado de la reja costal y lesiones osteo-traumáticas)

        --- PROTOCOLO 2: COLUMNA VERTEBRAL ---
        # 🧾 INFORME DE COLUMNA VERTEBRAL
        - **APÓFISIS ESPINOSAS:** (Alineadas o desviadas)
        - **ESPACIOS INTERVERTEBRALES:** (Sin alteraciones, conservados o con espondiloartrosis)
        - **CUERPOS VERTEBRALES:** (Altura y morfología)
        - **HALLAZGOS ESCOLIÓTICOS (Si aplica):** (Curvatura, convexidad, ángulo de Cobb y Risser)

        --- PROTOCOLO 3: EXTREMIDADES Y ARTICULACIONES ---
        # 🧾 INFORME DE EXTREMIDADES Y ARTICULACIONES
        - **CONGRUENCIA ARTICULAR:** (Conservada, aspecto normal o alterada)
        - **LESIONES OSTEO-TRAUMÁTICAS:** (Ausencia o presencia de lesiones agudas)
        - **TEJIDOS BLANDOS / OTROS:** (Sínfisis púbica, arcos del carpo, etc.)

        --- PROTOCOLO 4: MIEMBROS INFEIORES (RODILLA/TOBILO) ---
        # 🧾 INFORME DE MIEMBROS INFERIORES
        - **RODILLA:** (Espacio femoro-tibial y patelo-femoral, posición de la patela)
        - **RÓTULA AXIAL:** (Clasificación Wiberg, índice Insall-Salvati y ángulo femoro-rotuliano)
        - **TOBILLO:** (Congruencia trimaleolar, sindesmosis tibio peroneal y domo astragalino)

        --- PROTOCOLO 5: ABDOMEN Y ÁRBOL URINARIO ---
        # 🧾 INFORME DE ABDOMEN Y ÁRBOL URINARIO
        - **DISTRIBUCIÓN GASEOSA:** (Habitual o patológica)
        - **NIVELES HIDROAÉREOS / NEUMOPERITONEO:** (Presencia o ausencia)
        - **SOMBRAS RENALES:** (Visibilidad y aspecto bilateral)
        - **LITOS RADIOPACOS:** (Presencia en topografía de uréteres)

        ### DATOS DEL ANALISIS:
        Paciente: {paciente}
        Fecha del estudio: {fecha_actual}
        Instrucciones Adicionales: {custom_instructions}

        Responde directamente con el informe del protocolo seleccionado en formato Markdown.
        """

        print(f"[PY_DEBUG] Iniciando petición a MedGemma 1.5 Vision sobre: {triptico_arr.shape}...")
        client = ollama.Client(host='http://monai_llm:11434')
        MODEL_NAME = 'dcarrascosa/medgemma-1.5-4b-it:q8_0'

        # Usamos MedGemma (Multimodal en su versión 1.5)
        response = client.chat(
            model=MODEL_NAME,
            messages=[
                {'role': 'user', 'content': prompt_final, 'images': [triptico_path]}
            ],
            options={'temperature': 0.0}
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
        print("Uso: python analyze_rx.py <input_dcm> <output_dir> [custom_prompt_path]")
        sys.exit(1)
    
    p_path = sys.argv[3] if len(sys.argv) > 3 else None
    analyze(sys.argv[1], sys.argv[2], p_path)
