class PatientRepository:
    def __init__(self, db):
        self.collection = db.pacientes

    def find_all(self):
        return list(self.collection.find(
            {},
            {"nombre": 1, "condicion_cronica": 1, "medico_principal_id": 1, "activo": 1}
        ).sort("nombre", 1))

    def find_by_id(self, patient_id):
        return self.collection.find_one(
            {"_id": patient_id},
            {"nombre": 1, "condicion_cronica": 1, "medico_principal_id": 1}
        )

    def find_active_by_medico(self, medico_id):
        return list(self.collection.find(
            {"medico_principal_id": medico_id, "activo": True},
            {"nombre": 1, "condicion_cronica": 1, "ultima_lectura_vital": 1,
             "fecha_nacimiento": 1, "genero": 1}
        ).sort("nombre", 1))

    def find_alert_patients(self, sensor, op, threshold):
        return list(self.collection.find(
            {
                "ultima_lectura_vital.tipo_sensor": sensor,
                "ultima_lectura_vital.valor": {op: threshold},
                "activo": True,
            },
            {"nombre": 1, "ultima_lectura_vital": 1,
             "medico_principal_id": 1, "condicion_cronica": 1}
        ))
