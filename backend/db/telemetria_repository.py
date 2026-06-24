from datetime import datetime


class TelemetriaRepository:
    def __init__(self, db):
        self.collection = db.telemetria

    def find_by_range(self, paciente_id, sensor, desde, hasta):
        filtro = {
            "paciente_id": paciente_id,
            "tipo_sensor": sensor,
            "timestamp": {
                "$gte": datetime.fromisoformat(desde),
                "$lte": datetime.fromisoformat(hasta + "T23:59:59"),
            },
        }
        return list(self.collection.find(filtro).sort("timestamp", 1).limit(500))

    @staticmethod
    def compute_stats(lecturas):
        valores = [l["valor"] for l in lecturas]
        if not valores:
            return {}
        return {
            "total": len(valores),
            "minimo": round(min(valores), 1),
            "maximo": round(max(valores), 1),
            "promedio": round(sum(valores) / len(valores), 1),
        }
