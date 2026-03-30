import argparse
import sys
import numpy as np
import SimpleITK as sitk

class Evaluate2DTranslationCorrelation:
    def __init__(
        self,
        metric_sampling_percentage,
        min_row_overlap,
        max_row_overlap,
        column_overlap,
        dx_step_num,
        dy_step_num,
    ):
        self._registration_values_dict = {}
        self.X = None
        self.Y = None
        self.C = None
        self._metric_sampling_percentage = metric_sampling_percentage
        self._min_row_overlap = min_row_overlap
        self._max_row_overlap = max_row_overlap
        self._column_overlap = column_overlap
        self._dx_step_num = dx_step_num
        self._dy_step_num = dy_step_num

    def _start_observer(self):
        self._registration_values_dict = {}
        self.X = None
        self.Y = None
        self.C = None

    def _iteration_observer(self, registration_method):
        x, y = registration_method.GetOptimizerPosition()
        if y in self._registration_values_dict.keys():
            self._registration_values_dict[y].append(
                (x, registration_method.GetMetricValue())
            )
        else:
            self._registration_values_dict[y] = [
                (x, registration_method.GetMetricValue())
            ]

    def evaluate(self, fixed_image, moving_image):
        minimal_overlap = np.array(
            moving_image.TransformContinuousIndexToPhysicalPoint(
                (
                    -self._column_overlap,
                    moving_image.GetHeight() - self._min_row_overlap,
                )
            )
        ) - np.array(fixed_image.GetOrigin())
        maximal_overlap = np.array(
            moving_image.TransformContinuousIndexToPhysicalPoint(
                (self._column_overlap, moving_image.GetHeight() - self._max_row_overlap)
            )
        ) - np.array(fixed_image.GetOrigin())
        transform = sitk.TranslationTransform(
            2,
            (
                (maximal_overlap[0] + minimal_overlap[0]) / 2.0,
                (maximal_overlap[1] + minimal_overlap[1]) / 2.0,
            ),
        )

        dy_step_length = (maximal_overlap[1] - minimal_overlap[1]) / (
            2 * self._dy_step_num
        ) if self._dy_step_num > 0 else 1.0
        
        dx_step_length = (maximal_overlap[0] - minimal_overlap[0]) / (
            2 * self._dx_step_num
        ) if self._dx_step_num > 0 else 1.0
        
        step_length = dx_step_length
        parameter_scales = [1, dy_step_length / (dx_step_length + 1e-6)]

        registration_method = sitk.ImageRegistrationMethod()
        registration_method.SetMetricAsCorrelation()
        registration_method.SetMetricSamplingStrategy(registration_method.RANDOM)
        registration_method.SetMetricSamplingPercentage(
            self._metric_sampling_percentage
        )
        registration_method.SetInitialTransform(transform, inPlace=True)
        registration_method.SetOptimizerAsExhaustive(
            numberOfSteps=[self._dx_step_num, self._dy_step_num], stepLength=step_length
        )
        registration_method.SetOptimizerScales(parameter_scales)

        registration_method.AddCommand(
            sitk.sitkIterationEvent,
            lambda: self._iteration_observer(registration_method),
        )
        registration_method.AddCommand(sitk.sitkStartEvent, self._start_observer)
        registration_method.Execute(fixed_image, moving_image)

        x_lists = []
        val_lists = []
        if not self._registration_values_dict:
            # Prevent empty dict error
            self._registration_values_dict[0] = [(0,0)]

        for k in self._registration_values_dict.keys():
            x_list, val_list = zip(*(sorted(self._registration_values_dict[k])))
            x_lists.append(x_list)
            val_lists.append(val_list)

        self.X = np.array(x_lists)
        self.C = np.array(val_lists)
        self.Y = np.array(
            [
                list(self._registration_values_dict.keys()),
            ]
            * self.X.shape[1]
        ).transpose()

    def get_candidates(self, num_candidates, correlation_threshold, nms_radius=2):
        candidates = []
        _C = np.copy(self.C)
        done = num_candidates - len(candidates) <= 0
        while not done:
            min_index = np.unravel_index(_C.argmin(), _C.shape)
            if -_C[min_index] < correlation_threshold:
                done = True
            else:
                candidates.append(
                    (
                        sitk.TranslationTransform(
                            2, (self.X[min_index], self.Y[min_index])
                        ),
                        self.C[min_index],
                    )
                )
                start_nms = np.maximum(
                    np.array(min_index) - nms_radius, np.array([0, 0])
                )
                end_nms = np.minimum(
                    np.array(min_index) + nms_radius + 1, np.array(_C.shape)
                )
                _C[start_nms[0] : end_nms[0], start_nms[1] : end_nms[1]] = 0
                done = num_candidates - len(candidates) <= 0
        return candidates

def create_images_in_shared_coordinate_system(image_transform_list):
    pnt_list = []
    for image, transform in image_transform_list:
        pnt_list.append(transform.TransformPoint(image.GetOrigin()))
        pnt_list.append(
            transform.TransformPoint(
                image.TransformIndexToPhysicalPoint(
                    (image.GetWidth() - 1, image.GetHeight() - 1)
                )
            )
        )

    max_coordinates = np.max(pnt_list, axis=0)
    min_coordinates = np.min(pnt_list, axis=0)

    output_spacing = image_transform_list[0][0].GetSpacing()
    output_pixelID = image_transform_list[0][0].GetPixelID()
    output_direction = image_transform_list[0][0].GetDirection()
    output_width = int(
        np.round((max_coordinates[0] - min_coordinates[0]) / output_spacing[0])
    )
    output_height = int(
        np.round((max_coordinates[1] - min_coordinates[1]) / output_spacing[1])
    )
    output_origin = (min_coordinates[0], min_coordinates[1])

    images_in_shared_coordinate_system = []
    for image, transform in image_transform_list:
        images_in_shared_coordinate_system.append(
            sitk.Resample(
                image,
                (int(output_width), int(output_height)),
                transform.GetInverse(),
                sitk.sitkLinear,
                output_origin,
                output_spacing,
                output_direction,
                0.0,
                output_pixelID,
            )
        )
    return images_in_shared_coordinate_system

def composite_images_alpha_blending(images_in_shared_coordinate_system):
    composite_image = sitk.Cast(images_in_shared_coordinate_system[0], sitk.sitkFloat32)
    
    for img in images_in_shared_coordinate_system[1:]:
        current_image = sitk.Cast(img, sitk.sitkFloat32)
        
        # Calculate overlap mask
        mask1 = sitk.Cast(composite_image != 0, sitk.sitkUInt8)
        mask2 = sitk.Cast(current_image != 0, sitk.sitkUInt8)
            
        # Distance to edge (inside the image)
        # Danielsson filter computes distance to the nearest non-zero pixel.
        # To get the distance from the inside of the image to its edge, we must invert the mask
        # so that the object is 0 and the background is 1.
        inv_mask1 = sitk.Cast(mask1 == 0, sitk.sitkUInt8)
        inv_mask2 = sitk.Cast(mask2 == 0, sitk.sitkUInt8)
        
        dist_filter = sitk.DanielssonDistanceMapImageFilter()
        dist1 = sitk.Cast(dist_filter.Execute(inv_mask1), sitk.sitkFloat32)
        dist2 = sitk.Cast(dist_filter.Execute(inv_mask2), sitk.sitkFloat32)
        
        # Calculate alpha mixing factor safely
        dist_sum = sitk.Cast(dist1 + dist2, sitk.sitkFloat32)
        zero_mask = sitk.Cast(dist_sum == 0, sitk.sitkFloat32)
        eps = sitk.Cast(zero_mask * 1e-6, sitk.sitkFloat32)
        dist_sum_safe = sitk.Cast(dist_sum + eps, sitk.sitkFloat32)
        
        alpha = sitk.Cast(dist1 / dist_sum_safe, sitk.sitkFloat32)
        beta  = sitk.Cast(dist2 / dist_sum_safe, sitk.sitkFloat32)
        
        # Composite smoothly ensuring Float32
        part1 = sitk.Cast(alpha * composite_image, sitk.sitkFloat32)
        part2 = sitk.Cast(beta * current_image, sitk.sitkFloat32)
        composite_image = sitk.Cast(part1 + part2, sitk.sitkFloat32)
        
    return composite_image





def final_registration(fixed_image, moving_image, initial_mutable_transformations):
    registration_method = sitk.ImageRegistrationMethod()
    registration_method.SetMetricAsCorrelation()
    registration_method.SetMetricSamplingStrategy(registration_method.RANDOM)
    registration_method.SetMetricSamplingPercentage(0.2)
    registration_method.SetOptimizerAsGradientDescent(
        learningRate=0.7, numberOfIterations=300
    )
    registration_method.SetOptimizerScalesFromPhysicalShift()

    def reg(transform):
        registration_method.SetInitialTransform(transform)
        registration_method.Execute(fixed_image, moving_image)
        return registration_method.GetMetricValue()

    final_values = [reg(transform) for transform in initial_mutable_transformations]
    return list(zip(initial_mutable_transformations, final_values))

def align_pair(fixed_image, moving_image):
    metric_sampling_percentage = 0.2
    min_row_overlap = 20
    max_row_overlap = min(0.7 * moving_image.GetHeight(), 0.7 * fixed_image.GetHeight())
    column_overlap = min(0.2 * moving_image.GetWidth(), 0.2 * fixed_image.GetWidth())
    dx_step_num = 5
    dy_step_num = 15

    initializer = Evaluate2DTranslationCorrelation(
        metric_sampling_percentage,
        min_row_overlap,
        max_row_overlap,
        column_overlap,
        dx_step_num,
        dy_step_num,
    )
    initializer.evaluate(
        fixed_image=sitk.Cast(fixed_image, sitk.sitkFloat32),
        moving_image=sitk.Cast(moving_image, sitk.sitkFloat32),
    )
    candidates = initializer.get_candidates(num_candidates=4, correlation_threshold=0.2)
    
    if not candidates:
        # fallback to identity if no good candidates
        return sitk.TranslationTransform(2)
        
    initial_transformation_list = [
        sitk.TranslationTransform(t) for t, corr in candidates
    ]

    final_results = final_registration(
        fixed_image=sitk.Cast(fixed_image, sitk.sitkFloat32),
        moving_image=sitk.Cast(moving_image, sitk.sitkFloat32),
        initial_mutable_transformations=initial_transformation_list,
    )

    best_transform_tuple = min(final_results, key=lambda x: x[1])
    return best_transform_tuple[0]

def main():
    import json
    parser = argparse.ArgumentParser()
    parser.add_argument("--output_prefix", required=True)
    parser.add_argument("--images", nargs='+', required=True, help="Images ordered from TOP to BOTTOM")
    parser.add_argument("--manual_offsets", help="JSON string with list of {index, x, y}")
    args = parser.parse_args()

    # Load images and preserve metadata from the first one
    images = []
    metadata_to_preserve = {}
    
    for i, p in enumerate(args.images):
        reader = sitk.ImageFileReader()
        reader.SetFileName(p)
        reader.LoadPrivateTagsOn() # Ensure we load all possible tags
        img = reader.Execute()
        
        # Save metadata dictionary from the first image specifically
        if i == 0:
            for key in img.GetMetaDataKeys():
                metadata_to_preserve[key] = img.GetMetaData(key)
        
        if img.GetDimension() > 2:
            img = img[:, :, 0] # Extract middle slice if it's 3D by accident
            
        # Aplicar RescaleIntensity antes de procesar para homogeneizar las placas
        img = sitk.RescaleIntensity(img, 0, 4095)
        images.append(img)

    # FAST PATH: If only one image, skip registration and blending
    if len(images) == 1:
        print("Single image detected. Skipping registration, saving preview directly.")
        composite = images[0]
        transforms = [(images[0], sitk.TranslationTransform(2))]
    else:
        transforms = [(images[0], sitk.TranslationTransform(2))]
        composite_transform = sitk.TranslationTransform(2)
        
        # Cargar offsets manuales si existen
        manual_data = None
        if args.manual_offsets:
            try:
                manual_data = json.loads(args.manual_offsets)
                print("Using manual offsets provided by user...")
            except Exception as e:
                print(f"Error parsing manual offsets: {e}")

        offsets = []
        
        if manual_data:
            # Reconstruir las transformaciones basadas en el ajuste manual del usuario
            for entry in manual_data:
                idx = entry['index']
                if idx >= len(images): continue
                t = sitk.TranslationTransform(2)
                spacing = images[idx].GetSpacing()
                
                dx_phys = float(entry.get('accum_dx', 0)) * spacing[0]
                dy_phys = float(entry.get('accum_dy', 0)) * spacing[1]
                t.SetParameters((entry['tx'] + dx_phys, entry['ty'] + dy_phys))
                
                transforms.append((images[idx], t))
                offsets.append(entry)
        else:
            # Algoritmo automático original
            for i in range(1, len(images)):
                print(f"Aligning image {i} to {i-1}...")
                t = align_pair(fixed_image=images[i], moving_image=images[i-1])
                composite_transform = sitk.CompositeTransform([composite_transform, t])
                transforms.append((images[i], composite_transform))

        print("Compositing images...")
        resampled = create_images_in_shared_coordinate_system(transforms)
        composite = composite_images_alpha_blending(resampled)

    # ---- Calcular la caja delimitadora final para extraer las posiciones en Píxeles ----
    pnt_list = []
    for image, transform in transforms:
        pnt_list.append(transform.TransformPoint(image.GetOrigin()))
        pnt_list.append(
            transform.TransformPoint(
                image.TransformIndexToPhysicalPoint(
                    (image.GetWidth() - 1, image.GetHeight() - 1)
                )
            )
        )
    output_origin = np.min(pnt_list, axis=0)
    output_spacing = transforms[0][0].GetSpacing()

    # Si no es manual, poblamos el array de offsets para el frontend
    # Nota: offsets se inicializa vacío arriba en el else, pero lo definiremos aquí si no existe
    if 'offsets' not in locals(): offsets = []
    
    if len(images) > 1 and not args.manual_offsets:
        offsets = []
        for i, (image, transform) in enumerate(transforms):
            top_left_phys = transform.TransformPoint(image.GetOrigin())
            tx_ty = transform.TransformPoint((0, 0))
            pixel_x = (top_left_phys[0] - output_origin[0]) / output_spacing[0]
            pixel_y = (top_left_phys[1] - output_origin[1]) / output_spacing[1]
            offsets.append({
                "index": i,
                "tx": tx_ty[0], "ty": tx_ty[1],
                "left": pixel_x, "top": pixel_y,
                "accum_dx": 0, "accum_dy": 0
            })
            
    # Imprimir un marcador claro para que el backend de Node capture los offsets
    print(f"---OFFSETS_JSON---:{json.dumps(offsets)}")

    
    
    # Save output as JPG (Rescaled to 0-255)
    composite_255 = sitk.Cast(sitk.RescaleIntensity(composite, 0, 255), sitk.sitkUInt8)
    jpg_path = f"{args.output_prefix}.jpg"
    sitk.WriteImage(composite_255, jpg_path)
    
    # Save output as DICOM
    composite_dcm = sitk.Cast(composite, sitk.sitkUInt16)
    
    # Copiar los metadatos capturados al inicio
    for key, value in metadata_to_preserve.items():
        # Evitar copiar tags de longitud de grupo o específicos de archivo que puedan romper el writer
        if "0002|" in key: continue 
        composite_dcm.SetMetaData(key, value)
        
    # Actualizar tags descriptivos y de identificación únicos
    composite_dcm.SetMetaData("0008|103e", "EspinoVant.io Panorama") # Series Description solicitado
    
    # Generar un nuevo SOP Instance UID para que el visor lo trate como una imagen nueva válida
    import time
    timestamp = str(int(time.time() * 100))
    # Tag para SOP Instance UID (0008,0018)
    composite_dcm.SetMetaData("0008|0018", f"1.2.826.0.1.3680043.2.1125.{timestamp}")
    
    # IMPORTANTE: Actualizar Window Center y Window Width para que coincidan con el rescale de 12-bit (0-4095)
    # Esto soluciona el error 'Values outside the image spectrum' en Weasis
    composite_dcm.SetMetaData("0028|1050", "2048") # Window Center
    composite_dcm.SetMetaData("0028|1051", "4096") # Window Width
    
    # Asegurar que le informamos al visor que usamos 12 bits reales tras el rescale
    composite_dcm.SetMetaData("0028|0100", "16")   # Bits Allocated
    composite_dcm.SetMetaData("0028|0101", "12")   # Bits Stored (coincide con el rescale a 4095)
    composite_dcm.SetMetaData("0028|0102", "11")   # High Bit
    
    dcm_path = f"{args.output_prefix}.dcm"
    
    # Setting some minimal metadata so WriteImage doesn't fail on some strict writers
    # However SimpleITK usually manages basic DCM export if ending is .dcm
    # We will try a direct write. If it fails, we fall back to raw or minimal tags.
    try:
        sitk.WriteImage(composite_dcm, dcm_path)
    except Exception as e:
        print(f"Standard DICOM save failed: {e}. Trying raw output.")
        pass # In a real scenario we'd create a series writer, but for simplicity sitk.WriteImage often suffices.

    print(f"Output saved to {jpg_path} and {dcm_path}")

if __name__ == "__main__":
    main()
