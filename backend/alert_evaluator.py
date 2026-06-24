"""
VitalCore — Alert Evaluation Module
====================================
Central module for evaluating if vital readings are dangerous.
Single source of truth for alert direction logic.
"""

from typing import Dict, List, Optional, Any


class AlertEvaluator:
    """
    Evaluates vital readings against thresholds to determine alert status.
    
    Single source of truth for:
    - Threshold comparisons
    - Alert direction (above/below threshold)
    - Alert level calculation
    """
    
    def __init__(self, thresholds: Dict[str, Dict[str, Any]]):
        """
        Initialize with threshold configuration.
        
        Args:
            thresholds: Dict mapping sensor types to threshold configs.
                Each config should have:
                - umbral_critico: float - critical threshold value
                - direccion: str - "mayor" (above) or "menor" (below)
                - min: float - minimum plausible value (optional, for validation)
                - max: float - maximum plausible value (optional, for validation)
        """
        self.thresholds = thresholds
    
    def evaluate_reading(self, sensor: str, value: float) -> Dict[str, Any]:
        """
        Evaluate a single vital reading against thresholds.
        
        Args:
            sensor: Sensor type (e.g., "glucosa", "frecuencia_cardiaca")
            value: The reading value
            
        Returns:
            Dict with:
                - is_critical: bool - True if reading exceeds critical threshold
                - alert_level: str - "none", "warning", "critical"
                - direction: str - "above" or "below"
                - threshold: float - the threshold value used
                - excess: float - how much value exceeds threshold (positive) or is below (negative)
        """
        if sensor not in self.thresholds:
            return {
                "is_critical": False,
                "alert_level": "none",
                "direction": "unknown",
                "threshold": None,
                "excess": 0.0
            }
        
        config = self.thresholds[sensor]
        threshold = config.get("umbral_critico")
        direction = config.get("direccion", "mayor")
        
        if threshold is None:
            return {
                "is_critical": False,
                "alert_level": "none",
                "direction": direction,
                "threshold": None,
                "excess": 0.0
            }
        
        # Calculate excess based on direction
        if direction == "mayor":
            excess = value - threshold
        else:  # direction == "menor"
            excess = threshold - value
        
        # Determine alert level
        is_critical = excess > 0
        alert_level = "critical" if is_critical else "none"
        
        return {
            "is_critical": is_critical,
            "alert_level": alert_level,
            "direction": direction,
            "threshold": threshold,
            "excess": excess
        }
    
    def evaluate_patient(self, patient: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Evaluate all sensors for a patient's latest vital reading.
        
        Args:
            patient: Patient document with ultima_lectura_vital
            
        Returns:
            List of alert dicts for each sensor that exceeds threshold
        """
        alerts = []
        
        # Extract the latest vital reading
        ultima_lectura = patient.get("ultima_lectura_vital")
        if not ultima_lectura:
            return alerts
        
        sensor = ultima_lectura.get("tipo_sensor")
        value = ultima_lectura.get("valor")
        
        if sensor is None or value is None:
            return alerts
        
        # Evaluate this sensor
        result = self.evaluate_reading(sensor, float(value))
        
        if result["is_critical"]:
            alerts.append({
                "paciente_id": patient.get("_id"),
                "nombre": patient.get("nombre"),
                "condicion": patient.get("condicion_cronica"),
                "medico_id": patient.get("medico_principal_id"),
                "sensor": sensor,
                "valor": value,
                "unidad": ultima_lectura.get("unidad"),
                "umbral": result["threshold"],
                "direccion": result["direction"],
                "timestamp": ultima_lectura.get("timestamp"),
                "excess": result["excess"]
            })
        
        return alerts
    
    def get_threshold(self, sensor: str) -> Optional[Dict[str, Any]]:
        """Get threshold configuration for a sensor."""
        return self.thresholds.get(sensor)
    
    def get_all_thresholds(self) -> Dict[str, Dict[str, Any]]:
        """Get all threshold configurations."""
        return self.thresholds.copy()