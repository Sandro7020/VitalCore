"""
VitalCore — Shared Sensor Configuration
========================================
Single source of truth for sensor ranges and alert thresholds.
Imported by ingest_vitalcore.py, server.py, and exposed via /api/thresholds.
"""

# Rangos medicamente plausibles por tipo de sensor.
# (valor_min, valor_max, unidad, umbral_critico)
# Umbral_critico se usa para generar datos (ingest) y para alertas (server).
RANGOS_SENSORES = {
    "frecuencia_cardiaca": {"min": 50, "max": 140, "unidad": "bpm", "umbral_critico": 120},
    "glucosa": {"min": 60, "max": 250, "unidad": "mg/dL", "umbral_critico": 180},
    "saturacion_oxigeno": {"min": 88, "max": 100, "unidad": "%", "umbral_critico": 92},
    "presion_sistolica": {"min": 90, "max": 180, "unidad": "mmHg", "umbral_critico": 140},
    "horas_sueno": {"min": 2, "max": 10, "unidad": "horas", "umbral_critico": None},
}

# Umbrales por defecto para el endpoint /api/alertas.
# Extraidos de RANGOS_SENSORES para consumo del server.
UMBRALES_DEFAULT = {
    "frecuencia_cardiaca": {"valor": RANGOS_SENSORES["frecuencia_cardiaca"]["umbral_critico"], "direccion": "mayor"},
    "glucosa": {"valor": RANGOS_SENSORES["glucosa"]["umbral_critico"], "direccion": "mayor"},
    "saturacion_oxigeno": {"valor": RANGOS_SENSORES["saturacion_oxigeno"]["umbral_critico"], "direccion": "menor"},
    "presion_sistolica": {"valor": RANGOS_SENSORES["presion_sistolica"]["umbral_critico"], "direccion": "mayor"},
}
