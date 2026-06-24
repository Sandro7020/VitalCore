"""
VitalCore - API Server
======================
Servidor Flask que expone los endpoints para el dashboard.
Requiere: pip install flask flask-cors pymongo

Uso: python server.py
Luego abrir: http://localhost:5000
"""

import sys
import os
from datetime import datetime
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS

# Agregar el directorio raiz al path para importar config
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from config.settings import MONGO_URI, DB_NAME, PORT, get_client
from config.thresholds import RANGOS_SENSORES, UMBRALES_DEFAULT
from backend.db import (
    PatientRepository,
    DoctorRepository,
    ConsultaRepository,
    TelemetriaRepository,
)

# ---------------------------------------------------------------------------
# Repositories (module-level globals, set by create_app)
# ---------------------------------------------------------------------------
patient_repo: PatientRepository = None
doctor_repo: DoctorRepository = None
consulta_repo: ConsultaRepository = None
telemetria_repo: TelemetriaRepository = None


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------
def create_app(db):
    global patient_repo, doctor_repo, consulta_repo, telemetria_repo

    patient_repo = PatientRepository(db)
    doctor_repo = DoctorRepository(db)
    consulta_repo = ConsultaRepository(db)
    telemetria_repo = TelemetriaRepository(db)

    _root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    _frontend = os.path.join(_root, "frontend")

    app = Flask(__name__, static_folder=_frontend, static_url_path="")
    CORS(app)

    # -----------------------------------------------------------------------
    # Serializacion de documentos MongoDB (datetime → ISO string)
    # -----------------------------------------------------------------------
    def serial(obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        if isinstance(obj, list):
            return [serial(i) for i in obj]
        if isinstance(obj, dict):
            return {k: serial(v) for k, v in obj.items()}
        return obj

    def ok(data):
        return jsonify(serial(data))

    def err(msg, code=500):
        return jsonify({"error": msg}), code

    # -----------------------------------------------------------------------
    # Servir el frontend
    # -----------------------------------------------------------------------
    @app.route("/")
    def index():
        return send_from_directory(_frontend, "index.html")

    # -----------------------------------------------------------------------
    # Endpoints auxiliares para poblar los dropdowns
    # -----------------------------------------------------------------------
    @app.route("/api/pacientes")
    def listar_pacientes():
        try:
            docs = patient_repo.find_all()
            return ok(docs)
        except Exception as e:
            return err(str(e))

    @app.route("/api/medicos")
    def listar_medicos():
        try:
            docs = doctor_repo.find_all()
            return ok(docs)
        except Exception as e:
            return err(str(e))

    @app.route("/api/thresholds")
    def listar_umbrales():
        """Umbrales de alerta criticos (fuente de verdad: config/thresholds.py)."""
        return ok(RANGOS_SENSORES)

    # -----------------------------------------------------------------------
    # CONSULTA 1: Historial clinico completo de un paciente (cronologico)
    # -----------------------------------------------------------------------
    @app.route("/api/historial/<paciente_id>")
    def historial(paciente_id):
        try:
            consultas = consulta_repo.find_by_paciente(paciente_id)
            medico_ids = list({c["medico_id"] for c in consultas})
            medicos = {m["_id"]: m for m in doctor_repo.collection.find({"_id": {"$in": medico_ids}})}
            for c in consultas:
                c["medico"] = medicos.get(c["medico_id"])
            return ok(consultas)
        except Exception as e:
            return err(str(e))

    # -----------------------------------------------------------------------
    # CONSULTA 2: Lecturas de sensor en rango de fechas
    # -----------------------------------------------------------------------
    @app.route("/api/telemetria/<paciente_id>")
    def telemetria(paciente_id):
        sensor = request.args.get("sensor", "glucosa")
        desde  = request.args.get("desde")
        hasta  = request.args.get("hasta")

        if not desde or not hasta:
            return err("Parametros 'desde' y 'hasta' requeridos (YYYY-MM-DD)", 400)

        try:
            lecturas = telemetria_repo.find_by_range(paciente_id, sensor, desde, hasta)
            stats = TelemetriaRepository.compute_stats(lecturas)
            return ok({"lecturas": lecturas, "estadisticas": stats})
        except Exception as e:
            return err(str(e))

    # -----------------------------------------------------------------------
    # CONSULTA 3: Pacientes activos de un medico con ultima lectura vital
    # -----------------------------------------------------------------------
    @app.route("/api/medico/<medico_id>/pacientes-activos")
    def pacientes_activos(medico_id):
        try:
            pacientes = patient_repo.find_active_by_medico(medico_id)
            return ok(pacientes)
        except Exception as e:
            return err(str(e))

    # -----------------------------------------------------------------------
    # CONSULTA 4: Alertas cuando un vital supera el umbral critico
    # -----------------------------------------------------------------------
    @app.route("/api/alertas")
    def alertas():
        umbrales = {
            "frecuencia_cardiaca": {
                "valor": float(request.args.get("fc",      UMBRALES_DEFAULT["frecuencia_cardiaca"]["valor"])),
                "direccion": "mayor"
            },
            "glucosa": {
                "valor": float(request.args.get("glucosa", UMBRALES_DEFAULT["glucosa"]["valor"])),
                "direccion": "mayor"
            },
            "saturacion_oxigeno": {
                "valor": float(request.args.get("spo2",    UMBRALES_DEFAULT["saturacion_oxigeno"]["valor"])),
                "direccion": "menor"
            },
            "presion_sistolica": {
                "valor": float(request.args.get("pa",      UMBRALES_DEFAULT["presion_sistolica"]["valor"])),
                "direccion": "mayor"
            },
        }

        try:
            alertas_result = []
            for sensor, cfg in umbrales.items():
                op = "$gt" if cfg["direccion"] == "mayor" else "$lt"
                pacientes = patient_repo.find_alert_patients(sensor, op, cfg["valor"])
                for p in pacientes:
                    ulv = p.get("ultima_lectura_vital", {})
                    alertas_result.append({
                        "paciente_id":  p["_id"],
                        "nombre":        p["nombre"],
                        "condicion":     p.get("condicion_cronica"),
                        "medico_id":     p.get("medico_principal_id"),
                        "sensor":        sensor,
                        "valor":         ulv.get("valor"),
                        "unidad":        ulv.get("unidad"),
                        "umbral":        cfg["valor"],
                        "direccion":     cfg["direccion"],
                        "timestamp":     ulv.get("timestamp"),
                    })
            alertas_result.sort(key=lambda x: x.get("timestamp") or "", reverse=True)
            return ok(alertas_result)
        except Exception as e:
            return err(str(e))

    # -----------------------------------------------------------------------
    # CONSULTA 5: Red de referidos de un paciente
    # -----------------------------------------------------------------------
    @app.route("/api/red-referidos/<paciente_id>")
    def red_referidos(paciente_id):
        try:
            paciente = patient_repo.find_by_id(paciente_id)
            if not paciente:
                return err("Paciente no encontrado", 404)

            nodos = consulta_repo.aggregate_by_medico(paciente_id)
            medico_principal = doctor_repo.find_by_id(paciente["medico_principal_id"])

            red = {
                "paciente": {
                    "id":        paciente["_id"],
                    "nombre":    paciente["nombre"],
                    "condicion": paciente.get("condicion_cronica"),
                },
                "medico_principal": medico_principal,
                "nodos": nodos,
            }
            return ok(red)
        except Exception as e:
            return err(str(e))

    return app


# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print(f"VitalCore API corriendo en http://localhost:{PORT}")
    print(f"Conectado a MongoDB: {MONGO_URI}{DB_NAME}")

    client = get_client()
    db = client[DB_NAME]
    app = create_app(db)
    app.run(debug=True, port=PORT)
