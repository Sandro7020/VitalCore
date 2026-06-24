class ConsultaRepository:
    def __init__(self, db):
        self.collection = db.consultas_clinicas

    def find_by_paciente(self, paciente_id):
        return list(
            self.collection
            .find({"paciente_id": paciente_id})
            .sort("fecha_consulta", 1)
        )

    def find_medico_ids_for_paciente(self, paciente_id):
        consultas = self.find_by_paciente(paciente_id)
        return list({c["medico_id"] for c in consultas})

    def aggregate_by_medico(self, paciente_id):
        pipeline = [
            {"$match": {"paciente_id": paciente_id}},
            {"$group": {
                "_id": "$medico_id",
                "total_consultas": {"$sum": 1},
                "ultima_consulta": {"$max": "$fecha_consulta"},
                "motivos": {"$addToSet": "$motivo"},
            }},
            {"$lookup": {
                "from": "medicos",
                "localField": "_id",
                "foreignField": "_id",
                "as": "medico_info",
            }},
            {"$unwind": "$medico_info"},
            {"$sort": {"ultima_consulta": -1}},
        ]
        return list(self.collection.aggregate(pipeline))
