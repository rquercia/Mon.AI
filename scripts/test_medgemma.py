import sys
import ollama

def chat_medgemma(prompt):
    print(f"📡 Conectando con monai_llm (Ollama) para analizar con MedGemma-4B Q8...")
    print(f"🗣️  Consulta: '{prompt}'\n")
    
    # Apuntamos el cliente al host del contenedor de Ollama
    client = ollama.Client(host='http://monai_llm:11434')
    
    # Nombre exacto del modelo que descargamos desde Ollama Library
    MODEL_NAME = 'MedAIBase/MedGemma1.5:4b'
    
    try:
        response = client.chat(model=MODEL_NAME, messages=[
          {
            'role': 'system',
            'content': 'Eres MedGemma, un asistente de IA especializado en medicina clínica. Responde siempre en español, con lenguaje profesional pero comprensible, y estructurando la información.'
          },
          {
            'role': 'user',
            'content': prompt
          }
        ])
        print("=== RESPUESTA MEDGEMMA (google-medgemma-4b-it-Q8_0) ===")
        print(response['message']['content'])
        print("=======================================================")
    except Exception as e:
        print(f"❌ Error al interactuar con el modelo: {e}")
        print("\n⚠️  TIP: Comprueba que el contenedor monai_llm esté corriendo y hayas descargado el modelo.")

if __name__ == '__main__':
    prompt = sys.argv[1] if len(sys.argv) > 1 else "Como asistente de radiología, explícame brevemente el significado clínico de encontrar un micro-nódulo subpleural en una TAC de tórax."
    chat_medgemma(prompt)
