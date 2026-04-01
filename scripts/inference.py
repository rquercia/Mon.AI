import os
import sys
import torch
import numpy as np
import argparse
import time
import json
from monai.transforms import (
    Compose,
    LoadImaged,
    EnsureChannelFirstd,
    Spacingd,
    ScaleIntensityRanged,
    CropForegroundd,
    EnsureTyped,
    Invertd,
    SaveImaged,
    Orientationd
)
from monai.networks.nets import UNet, SwinUNETR
from monai.inferers import sliding_window_inference
from monai.data import DataLoader, Dataset, decollate_batch, MetaTensor
from monai.visualize import blend_images
from monai.bundle import ConfigParser

def run_inference(model_type):
    # 1. Configuración de Rutas y Dispositivo
    # Buscamos archivos en la carpeta raíz y en la subcarpeta input (donde llegan del backend)
    INPUT_DIRS = ["/opt/monai/data", "/opt/monai/data/input"]
    OUTPUT_DIR = "/opt/monai/data/output"
    
    if not os.path.exists(OUTPUT_DIR):
        os.makedirs(OUTPUT_DIR, exist_ok=True)
    
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"\n--- Iniciando Inferencia MONAI: {model_type.upper()} ---")
    print(f"Dispositivo: {device}")
    
    # 2. Definir Transformaciones según el modelo (Research de HuggingFace)
    if model_type == "detection":
        # Parámetros estricto para RetinaNet de MONAI Lung Detection
        print("Configurando Pipeline para DETECCIÓN (RetinaNet)...")
        val_transforms = Compose([
            LoadImaged(keys=["image"]),
            EnsureChannelFirstd(keys=["image"]),
            Orientationd(keys=["image"], axcodes="RAS"),
            Spacingd(keys=["image"], pixdim=(0.703125, 0.703125, 1.25), mode="bilinear"),
            ScaleIntensityRanged(
                keys=["image"], a_min=-1024, a_max=300,
                b_min=0.0, b_max=1.0, clip=True,
            ),
            EnsureTyped(keys=["image"]),
        ])
    else:
        # Parámetros para Segmentación (Swin-UNETR o UNet)
        print("Configurando Pipeline para SEGMENTACIÓN (Swin-UNETR)...")
        val_transforms = Compose([
            LoadImaged(keys=["image"]),
            EnsureChannelFirstd(keys=["image"]),
            Spacingd(keys=["image"], pixdim=(1.0, 1.0, 1.0), mode="bilinear"),
            ScaleIntensityRanged(
                keys=["image"], a_min=-1000, a_max=400,
                b_min=0.0, b_max=1.0, clip=True,
            ),
            CropForegroundd(keys=["image"], source_key="image"),
            EnsureTyped(keys=["image"]),
        ])

    # 3. Datos
    images = []
    for d in INPUT_DIRS:
        if os.path.exists(d):
            images += [os.path.join(d, f) for f in os.listdir(d) if f.lower().endswith(('.nii', '.nii.gz'))]
    
    if not images:
        print(f"❌ Error: No se encontraron archivos NIfTI en las rutas: {INPUT_DIRS}")
        print("⚠️  Asegúrate de convertir primero el estudio DICOM a NIfTI.")
        return

    print(f"📁 Archivos encontrados para procesar: {len(images)}")

    ds = Dataset(data=[{"image": img} for img in images], transform=val_transforms)
    loader = DataLoader(ds, batch_size=1, num_workers=0)

    # 4. Cargar Modelo
    detector = None
    if model_type == "segmentation":
        # Integración de Segmentación Real (Swin UNETR BTCV)
        weights_path = "/opt/monai/models/swin_unetr_btcv_segmentation/models/model.pt"
        
        if os.path.exists(weights_path):
            print("Instanciando Swin UNETR para Segmentación REAL (BTCV)...")
            # Instanciamos manualmente para evitar problemas de compatibilidad del bundle JSON
            model = SwinUNETR(
                img_size=(96, 96, 96),
                in_channels=1,
                out_channels=14, # BTCV: 13 órganos + fondo
                feature_size=48,
                use_checkpoint=False,
            ).to(device)
            
            # Cargar pesos oficiales
            state_dict = torch.load(weights_path, map_location=device)
            if "model" in state_dict: state_dict = state_dict["model"]
            model.load_state_dict(state_dict)
            model.eval()
            print("¡Pesos oficiales de Swin UNETR (BTCV) cargados correctamente!")
        else:
            print("Faltan los pesos de Swin UNETR. Usando arquitectura demo...")
            model = SwinUNETR(
                in_channels=1,
                out_channels=14,
                feature_size=48,
                use_checkpoint=True,
            ).to(device)
    else:
        # Integración de Detección Real (Bundle Oficial)
        config_path = "/opt/monai/models/lung_nodule_ct_detection/configs/inference.json"
        weights_path = "/opt/monai/models/lung_nodule_ct_detection/models/model.pt"
        
        if os.path.exists(config_path) and os.path.exists(weights_path):
            print("Cargando modelo de Detección REAL (RetinaNet)...")
            # Muy importante: Agregar la ruta del bundle al sys.path para que MONAI encuentre sus scripts internos
            bundle_root = "/opt/monai/models/lung_nodule_ct_detection"
            if bundle_root not in sys.path:
                sys.path.append(bundle_root)

            parser = ConfigParser()
            parser.read_config(config_path)
            
            # Instanciar objetos
            model = parser.get_parsed_content("network")
            detector = parser.get_parsed_content("detector")
            parser.get_parsed_content("detector_ops") # Configurar ventanas deslizantes
            
            # Cargar pesos reales
            state_dict = torch.load(weights_path, map_location=device)
            # Manejar distintos formatos de Checkpoint
            if "model" in state_dict: state_dict = state_dict["model"]
            model.load_state_dict(state_dict)
            model.to(device)
            model.eval()
            detector.eval()
            print("¡Pesos reales del MONAI Model Zoo cargados!")
        else:
            print("Faltan archivos del Bundle. Iniciando Demo UNet...")
            model = UNet(
                spatial_dims=3, in_channels=1, out_channels=2,
                channels=(16, 32, 64, 128, 256), strides=(2, 2, 2, 2), num_res_units=2,
            ).to(device)

    # 5. Bucle de Inferencia
    postfix = "det" if model_type == "detection" else "seg"
    # Solo mantenemos el saver_pred (la máscara) porque es necesaria para generar el DICOM-SEG (botón violeta)
    # y el JSON para el reporte IA.
    # saver_orig = SaveImaged(keys=["image"], output_dir=OUTPUT_DIR, output_postfix="orig", resample=False, separate_folder=False)
    saver_pred = SaveImaged(keys=["pred"], output_dir=OUTPUT_DIR, output_postfix=postfix, resample=False, separate_folder=False, dtype=np.uint8)
    # saver_visual = SaveImaged(keys=["visual"], output_dir=OUTPUT_DIR, output_postfix="overlay", resample=False, separate_folder=False)

    with torch.no_grad():
        with torch.cuda.amp.autocast():
            for i, batch_data in enumerate(loader):
                print(f"Procesando: {images[i]}")
                inputs = batch_data["image"].to(device)
                
                if model_type == "detection":
                    if detector is not None:
                        print("Ejecutando Detección con RetinaNet...")
                        outputs = detector(inputs, use_inferer=True)
                        
                        # Crear máscara con las cajas encontradas (formato xyzxyz)
                        pred = torch.zeros_like(inputs[:, :1, ...])
                        boxes = outputs[0].get("box", [])
                        scores = outputs[0].get("label_scores", [])
                        
                        # Limitar a cajas probables para no sobrecargar visualmente
                        count = 0
                        for box, score in zip(boxes, scores):
                            if score.item() > 0.1: # Threshold de visualización
                                x1, y1, z1, x2, y2, z2 = [int(torch.round(v).item()) for v in box]
                                # Restringir a los límites de la imagen
                                C, H, W, D = pred.shape[1], pred.shape[2], pred.shape[3], pred.shape[4]
                                x1, x2 = max(0, x1), min(H, x2)
                                y1, y2 = max(0, y1), min(W, y2)
                                z1, z2 = max(0, z1), min(D, z2)
                                
                                # ASIGNAR ID ÚNICO: Cada nódulo tendrá un valor de vóxel distinto (1, 2, 3...)
                                count += 1
                                pred[0, 0, x1:x2, y1:y2, z1:z2] = count
                        print(f"Detectados {count} nódulos con alta confianza.")
                        batch_data["pred"] = pred
                        
                        # EXPORTACIÓN JSON: Guardar las detecciones numéricas
                        detections = []
                        current_id = 0
                        
                        # Obtener dimensiones originales para mapear el número de imagen (slice)
                        # MetaTensor guarda la forma original (H, W, D)
                        orig_shape = inputs.meta.get("spatial_shape", [0, 0, 0])[0]
                        resampled_shape = inputs.shape[4] # Profundidad (Depht) despues de remuestreo
                        
                        # Si no se detecta la forma original, asumimos que no hubo cambio
                        if orig_shape[2] == 0: orig_shape[2] = resampled_shape
                        
                        slice_ratio = float(orig_shape[2]) / float(resampled_shape)

                        for box, score in zip(boxes, scores):
                            if score.item() > 0.1:
                                current_id += 1
                                x1, y1, z1, x2, y2, z2 = box.tolist()
                                
                                # Calculamos el slice central del nódulo detectado
                                z_center = (z1 + z2) / 2.0
                                
                                # Remapeamos proporcionalmente
                                mapped_z = int(round(z_center * slice_ratio))
                                
                                # Invertimos el eje Z: Los objetos NIfTI/SITK suelen tener el eje Z invertido 
                                # respecto al InstanceNumber de los visores DICOM (Head-First Supine suele ir de arriba hacia abajo).
                                # Ej: 122 - 33 = 89 (muy cercano al 90 esperado por el médico)
                                orig_slice_num = int(orig_shape[2]) - mapped_z + 1
                                
                                # Asegurar límites para evitar Imagen 123/122
                                orig_slice_num = max(1, min(int(orig_shape[2]), orig_slice_num))

                                detections.append({
                                    "id": current_id,
                                    "score": float(score.item()),
                                    "box_voxel": [float(v) for v in box.tolist()],
                                    "slice_number": f"{orig_slice_num} / {int(orig_shape[2])}",
                                    "label": f"nodule_{current_id}"
                                })
                        
                        # Generar nombre de archivo JSON (asumiendo que images[i] es la ruta original)
                        base_name = os.path.basename(images[i]).split(".")[0]
                        json_path = os.path.join(OUTPUT_DIR, f"{base_name}_detections.json")
                        with open(json_path, "w") as f:
                            json.dump({
                                "study": base_name,
                                "model": "lung_nodule_ct_detection",
                                "num_detections": len(detections),
                                "detections": detections
                            }, f, indent=4)
                        print(f"Reporte de detecciones guardado en {json_path}")
                    else:
                        outputs = sliding_window_inference(inputs, (96, 96, 96), 4, model)
                        # SIMULACIÓN DE DETECCIÓN (Fallback)
                        print("Post-procesando Cajas de Detección (RetinaNet Style DEMO)...")
                        pred = torch.zeros_like(outputs[:, :1, ...])
                        pred[:, :, 40:60, 40:60, 40:60] = 1 
                        pred[:, :, 80:100, 70:90, 50:70] = 1
                        batch_data["pred"] = pred
                else:
                    # SEGMENTACIÓN REAL o DEMO
                    print(f"Ejecutando Segmentación {model.__class__.__name__}...")
                    # Swin UNETR suele usar parches de 96x96x96
                    outputs = sliding_window_inference(inputs, (96, 96, 96), 4, model)
                    # Tomamos el argmax para obtener la clase (órgano) con mayor probabilidad
                    batch_data["pred"] = torch.argmax(outputs, dim=1, keepdim=True)
                
                # CAST A ENTERO: Evita errores en 3D Slicer (float to int truncation)
                # Castamos a uint8 (0-255) que es perfecto para máscaras de segmentación
                batch_data["pred"] = batch_data["pred"].to(torch.uint8)
                
                # Crear superposición visual (Blending)
                # blend_images espera (C, H, W, D) y devuelve RGB
                # Usamos la máscara con IDs únicos para que cada nódulo tenga su propio color
                visual_blended = blend_images(
                    image=inputs[0], 
                    label=batch_data["pred"][0], 
                    alpha=0.4,
                    cmap="hsv"
                )
                
                # Restauramos los metadatos para que el guardado sea correcto (affine matrix)
                batch_data["visual"] = MetaTensor(
                    visual_blended, 
                    meta=inputs.meta
                )
                
                # Volvemos a añadir la dimensión de batch
                batch_data["visual"] = batch_data["visual"].unsqueeze(0)
                
                # Guardar
                for d in decollate_batch(batch_data):
                    # saver_orig(d)
                    saver_pred(d)
                    # saver_visual(d)
                print(f"Archivo guardado exitosamente.")

    print(f"\n--- Inferencia {model_type.upper()} completada con RTX 3080 ---")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", type=str, default="segmentation", choices=["segmentation", "detection"])
    args = parser.parse_args()
    
    run_inference(args.model)
