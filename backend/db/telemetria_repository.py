from datetime import datetime


class TelemetriaRepository:
    def __init__(self, db):
        self.collection = db.telemetria

    def _build_range_filter(self, paciente_id, sensor, desde, hasta):
        return {
            "paciente_id": paciente_id,
            "tipo_sensor": sensor,
            "timestamp": {
                "$gte": datetime.fromisoformat(desde),
                "$lte": datetime.fromisoformat(hasta + "T23:59:59"),
            },
        }

    def count_by_range(self, paciente_id, sensor, desde, hasta):
        return self.collection.count_documents(
            self._build_range_filter(paciente_id, sensor, desde, hasta)
        )

    def stats_by_range(self, paciente_id, sensor, desde, hasta):
        pipeline = [
            {"$match": self._build_range_filter(paciente_id, sensor, desde, hasta)},
            {"$group": {
                "_id": None,
                "total": {"$sum": 1},
                "minimo": {"$min": "$valor"},
                "maximo": {"$max": "$valor"},
                "promedio": {"$avg": "$valor"},
            }},
        ]
        result = list(self.collection.aggregate(pipeline))
        if result:
            r = result[0]
            return {
                "total": r["total"],
                "minimo": round(r["minimo"], 1),
                "maximo": round(r["maximo"], 1),
                "promedio": round(r["promedio"], 1),
            }
        return {"total": 0, "minimo": 0, "maximo": 0, "promedio": 0}

    def find_by_range(self, paciente_id, sensor, desde, hasta):
        return list(self.collection.find(
            self._build_range_filter(paciente_id, sensor, desde, hasta)
        ).sort("timestamp", 1).limit(500))

    def find_by_range_paginated(self, paciente_id, sensor, desde, hasta, page=1, per_page=20):
        skip = (page - 1) * per_page
        return list(self.collection.find(
            self._build_range_filter(paciente_id, sensor, desde, hasta)
        ).sort("timestamp", 1).skip(skip).limit(per_page))

    def find_latest_by_patient(self, paciente_id, limit=20):
        return list(
            self.collection
            .find({"paciente_id": paciente_id})
            .sort("timestamp", -1)
            .limit(limit)
        )

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
