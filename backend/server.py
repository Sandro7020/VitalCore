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
import time
import threading
from collections import defaultdict, deque
from datetime import datetime
from bson import ObjectId
from flask import Flask, jsonify, request, g, send_from_directory
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
from backend.alert_evaluator import AlertEvaluator

# ---------------------------------------------------------------------------
# Repositories (module-level globals, set by create_app)
# ---------------------------------------------------------------------------
patient_repo: PatientRepository = None
doctor_repo: DoctorRepository = None
consulta_repo: ConsultaRepository = None
telemetria_repo: TelemetriaRepository = None
alert_evaluator: AlertEvaluator = None


# ---------------------------------------------------------------------------
# Factory
# ---------------------------------------------------------------------------
def create_app(db):
    global patient_repo, doctor_repo, consulta_repo, telemetria_repo, alert_evaluator

    patient_repo = PatientRepository(db)
    doctor_repo = DoctorRepository(db)
    consulta_repo = ConsultaRepository(db)
    telemetria_repo = TelemetriaRepository(db)
    
    # Create thresholds with direction for all sensors
    thresholds_with_direction = {}
    for sensor, config in RANGOS_SENSORES.items():
        # Get direction from UMBRALES_DEFAULT if exists, else default to "mayor"
        direction = UMBRALES_DEFAULT.get(sensor, {}).get("direccion", "mayor")
        thresholds_with_direction[sensor] = {
            "umbral_critico": config["umbral_critico"],
            "direccion": direction,
            "min": config["min"],
            "max": config["max"]
        }
    alert_evaluator = AlertEvaluator(thresholds_with_direction)

    _root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    _frontend = os.path.join(_root, "frontend")

    app = Flask(__name__, static_folder=_frontend, static_url_path="")
    CORS(app)

    # -----------------------------------------------------------------------
    # Timing middleware — mide el tiempo de respuesta de cada endpoint
    # -----------------------------------------------------------------------
    _metricas = defaultdict(lambda: deque(maxlen=200))
    _metricas_lock = threading.Lock()

    @app.before_request
    def _before():
        g._t0 = time.perf_counter()

    @app.after_request
    def _after(response):
        elapsed_ms = (time.perf_counter() - g._t0) * 1000
        endpoint = request.path
        with _metricas_lock:
            _metricas[endpoint].append(round(elapsed_ms, 2))
        response.headers["X-Response-Time"] = f"{elapsed_ms:.1f}ms"
        return response

    # -----------------------------------------------------------------------
    # Serializacion de documentos MongoDB (datetime → ISO string)
    # -----------------------------------------------------------------------
    def serial(obj):
        if isinstance(obj, ObjectId):
            return str(obj)
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
        """Umbrales de alerta críticos con dirección (fuente de verdad: AlertEvaluator)."""
        return ok(alert_evaluator.get_all_thresholds())

    # -----------------------------------------------------------------------
    # Endpoint: Evaluar una lectura vital contra umbrales
    # -----------------------------------------------------------------------
    @app.route("/api/evaluate-reading")
    def evaluate_reading():
        """Evalúa una lectura vital contra umbrales configurados."""
        sensor = request.args.get("sensor")
        value = request.args.get("value")
        
        if not sensor or not value:
            return err("Parámetros 'sensor' y 'value' requeridos", 400)
        
        try:
            value = float(value)
        except ValueError:
            return err("El parámetro 'value' debe ser un número", 400)
        
        try:
            result = alert_evaluator.evaluate_reading(sensor, value)
            return ok(result)
        except Exception as e:
            return err(str(e))

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
        """Alertas cuando un vital supera el umbral crítico.
        Usa AlertEvaluator como fuente única de verdad para dirección y umbrales."""
        try:
            alertas_result = []
            # Iterate over all sensors in the evaluator
            for sensor, config in alert_evaluator.get_all_thresholds().items():
                # Get default threshold value (can be overridden via request args)
                default_threshold = config.get("umbral_critico")
                if default_threshold is None:
                    continue  # Skip sensors without threshold (e.g., horas_sueno)
                
                # Allow threshold override via query parameters
                param_map = {
                    "frecuencia_cardiaca": "fc",
                    "glucosa": "glucosa",
                    "saturacion_oxigeno": "spo2",
                    "presion_sistolica": "pa",
                    "horas_sueno": "hs"
                }
                param_name = param_map.get(sensor, sensor)
                threshold_value = float(request.args.get(param_name, default_threshold))
                
                # Use evaluator to get direction
                direction = config["direccion"]
                op = "$gt" if direction == "mayor" else "$lt"
                
                # Query patients using MongoDB operator
                pacientes = patient_repo.find_alert_patients(sensor, op, threshold_value)
                
                for p in pacientes:
                    # Use evaluator to evaluate the patient's reading
                    alerts = alert_evaluator.evaluate_patient(p)
                    for alert in alerts:
                        # Override threshold with request-specific value
                        alert["umbral"] = threshold_value
                        alertas_result.append(alert)
            
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

    # -----------------------------------------------------------------------
    # KPI 1: Metricas de rendimiento
    # -----------------------------------------------------------------------
    @app.route("/api/metricas")
    def metricas():
        """Estadisticas de tiempo de respuesta por endpoint."""
        result = []
        with _metricas_lock:
            for endpoint, tiempos in _metricas.items():
                if not tiempos:
                    continue
                sorted_t = sorted(tiempos)
                n = len(sorted_t)
                result.append({
                    "endpoint": endpoint,
                    "total_llamadas": n,
                    "promedio_ms": round(sum(sorted_t) / n, 2),
                    "minimo_ms": sorted_t[0],
                    "maximo_ms": sorted_t[-1],
                    "p95_ms": sorted_t[int(n * 0.95)] if n >= 2 else sorted_t[-1],
                })
        result.sort(key=lambda x: x["promedio_ms"], reverse=True)
        return ok(result)

    # -----------------------------------------------------------------------
    # KPI 2: Salud del paciente — ultimas N lecturas
    # -----------------------------------------------------------------------
    @app.route("/api/paciente/<paciente_id>/lecturas-recientes")
    def lecturas_recientes(paciente_id):
        """Ultimas N lecturas de telemetria de un paciente con indicadores de riesgo."""
        n = request.args.get("n", 20, type=int)
        try:
            paciente = patient_repo.find_by_id(paciente_id)
            if not paciente:
                return err("Paciente no encontrado", 404)

            lecturas = telemetria_repo.find_latest_by_patient(paciente_id, limit=n)

            for l in lecturas:
                result_eval = alert_evaluator.evaluate_reading(l["tipo_sensor"], l["valor"])
                l["critico"] = result_eval["is_critical"]
                l["alert_level"] = result_eval["alert_level"]

            return ok({"paciente": paciente, "lecturas": lecturas})
        except Exception as e:
            return err(str(e))

    # -----------------------------------------------------------------------
    # KPI 3: Pacientes por riesgo
    # -----------------------------------------------------------------------
    @app.route("/api/medico/<medico_id>/pacientes-por-riesgo")
    def pacientes_por_riesgo(medico_id):
        """Pacientes activos de un medico ordenados por nivel de riesgo."""
        try:
            pacientes = patient_repo.find_active_by_medico_with_risk(
                medico_id, alert_evaluator
            )
            return ok(pacientes)
        except Exception as e:
            return err(str(e))

    # -----------------------------------------------------------------------
    # KPI 4: Mapa de alertas activas
    # -----------------------------------------------------------------------
    @app.route("/api/alertas-activas")
    def alertas_activas():
        """Pacientes con lecturas criticas activas en tiempo real."""
        try:
            pacientes = patient_repo.find_all_critical_patients(alert_evaluator)
            return ok(pacientes)
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
