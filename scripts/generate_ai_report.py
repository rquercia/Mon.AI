import sys
import json
import ollama

def generate_report(json_path):
    # 1. Leer el archivo JSON de inferencia
    try:
        with open(json_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        print(f"Error al leer el archivo JSON: {e}")
        sys.exit(1)
        
    # 2. Preparar el prompt para MedGemma
    resultados_str = json.dumps(data, indent=2, ensure_ascii=False)
    
    prompt = f"""
    Eres un radiólogo experto e IA clínica (MedGemma). He procesado una tomografía computarizada (TAC) de tórax con un modelo de IA y obtuvimos las siguientes detecciones preliminares en formato JSON: 
    
    {resultados_str}
    
    Basándote estrictamente en estos hallazgos numéricos y de localización, redacta un informe radiológico formal.
    El informe debe estructurarse de la siguiente manera:
    1. **Hallazgos:** Describe la ubicación anatómica del/los nódulo(s) (ej: lóbulo superior derecho), su tamaño estimado basado en las cajas delimitadoras, y su apariencia sugerida.
    2. **Impresión Diagnóstica:** Concluye brevemente la severidad de los hallazgos.
    3. **Clasificación Lung-RADS:** Sugiere una categoría Lung-RADS (1 a 4X) justificada según el tamaño y tipo del nódulo detectado.
    4. **Recomendaciones:** Menciona los pasos a seguir (ej: seguimiento a 6 meses, biopsia, correlación clínica).
    
    Evita inventar datos del paciente. Si falta información en el JSON, indícalo educadamente.
    """
    
    # 3. Consultar a Ollama / MedGemma Q8
    client = ollama.Client(host='http://monai_llm:11434')
    MODEL_NAME = 'dcarrascosa/medgemma-1.5-4b-it:q8_0'
    
    try:
        response = client.chat(model=MODEL_NAME, messages=[
          {'role': 'system', 'content': 'Eres MedGemma, un radiólogo asistente clínico avanzado de IA. Redacta informes estructurados en español altamente profesionales.'},
          {'role': 'user', 'content': prompt}
        ], options={'temperature': 0.0})
        
        # OJO: Solo imprimimos el texto para que el child_process de Node.js lo capture limpio
        print(response['message']['content'])
    except Exception as e:
        print(f"ERROR_MODELO: Ocurrió un fallo con MedGemma: {e}")

if __name__ == '__main__':
    if len(sys.argv) < 2:
        print("Uso: python generate_ai_report.py /ruta/al/json_resultados.json")
        sys.exit(1)
    
    generate_report(sys.argv[1])
