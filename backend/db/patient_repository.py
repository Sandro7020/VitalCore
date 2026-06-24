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

    @staticmethod
    def _compute_risk(patient, alert_evaluator):
        """Contar cuantos sensores criticos tiene en la ultima lectura."""
        ultima = patient.get("ultima_lectura_vital")
        if not ultima:
            return 0
        sensor = ultima.get("tipo_sensor")
        valor = ultima.get("valor")
        if sensor is None or valor is None:
            return 0
        result = alert_evaluator.evaluate_reading(sensor, float(valor))
        return 1 if result["is_critical"] else 0

    def find_active_by_medico_with_risk(self, medico_id, alert_evaluator):
        pacientes = list(self.collection.find(
            {"medico_principal_id": medico_id, "activo": True},
            {"nombre": 1, "condicion_cronica": 1, "ultima_lectura_vital": 1,
             "fecha_nacimiento": 1, "genero": 1}
        ))
        for p in pacientes:
            p["riesgo"] = self._compute_risk(p, alert_evaluator)
        pacientes.sort(key=lambda x: x["riesgo"], reverse=True)
        return pacientes

    def find_all_critical_patients(self, alert_evaluator):
        """Pacientes cuya ultima lectura vital es critica para cualquier sensor."""
        pacientes = list(self.collection.find(
            {"activo": True, "ultima_lectura_vital": {"$ne": None}},
            {"nombre": 1, "condicion_cronica": 1, "ultima_lectura_vital": 1,
             "medico_principal_id": 1}
        ))
        criticos = []
        for p in pacientes:
            alerts = alert_evaluator.evaluate_patient(p)
            criticos.extend(alerts)
        criticos.sort(key=lambda x: x.get("timestamp") or "", reverse=True)
        return criticos
