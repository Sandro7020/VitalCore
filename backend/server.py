"""
VitalCore - API Server
======================
Servidor Flask que expone los endpoints para el dashboard.
Requiere: pip install flask flask-cors pymongo

Uso: python server.py
Luego abrir: http://localhost:5000
"""

from datetime import datetime
from flask import Flask, jsonify, request, send_from_directory
from flask_cors import CORS
from pymongo import MongoClient

# ---------------------------------------------------------------------------
# CONFIGURACION — ajusta estos valores si tu MongoDB no corre en localhost
# ---------------------------------------------------------------------------
MONGO_URI = "mongodb://localhost:27017/"   # ← CAMBIAR para MongoDB Atlas u otro host
DB_NAME   = "vitalcore"
PORT      = 5000

# Umbrales criticos por defecto (los mismos del script de ingesta)
UMBRALES_DEFAULT = {
    "frecuencia_cardiaca": {"valor": 120, "direccion": "mayor"},
    "glucosa":             {"valor": 180, "direccion": "mayor"},
    "saturacion_oxigeno":  {"valor": 92,  "direccion": "menor"},   # critico si BAJA de 92%
    "presion_sistolica":   {"valor": 140, "direccion": "mayor"},
}

# ---------------------------------------------------------------------------
app = Flask(__name__, static_folder="frontend", static_url_path="")
CORS(app)

client = MongoClient(MONGO_URI)
db = client[DB_NAME]


# ---------------------------------------------------------------------------
# Serializacion de documentos MongoDB (datetime → ISO string)
# ---------------------------------------------------------------------------
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


# ---------------------------------------------------------------------------
# Servir el frontend
# ---------------------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory("frontend", "index.html")


# ---------------------------------------------------------------------------
# Endpoints auxiliares para poblar los dropdowns
# ---------------------------------------------------------------------------
@app.route("/api/pacientes")
def listar_pacientes():
    try:
        docs = list(db.pacientes.find(
            {},
            {"nombre": 1, "condicion_cronica": 1, "medico_principal_id": 1, "activo": 1}
        ).sort("nombre", 1))
        return ok(docs)
    except Exception as e:
        return err(str(e))


@app.route("/api/medicos")
def listar_medicos():
    try:
        docs = list(db.medicos.find({}).sort("nombre", 1))
        return ok(docs)
    except Exception as e:
        return err(str(e))


# ---------------------------------------------------------------------------
# CONSULTA 1: Historial clínico completo de un paciente (cronológico)
# ---------------------------------------------------------------------------
@app.route("/api/historial/<paciente_id>")
def historial(paciente_id):
    try:
        consultas = list(
            db.consultas_clinicas
            .find({"paciente_id": paciente_id})
            .sort("fecha_consulta", 1)
        )
        # Join con medicos
        medico_ids = list({c["medico_id"] for c in consultas})
        medicos = {m["_id"]: m for m in db.medicos.find({"_id": {"$in": medico_ids}})}
        for c in consultas:
            c["medico"] = medicos.get(c["medico_id"])
        return ok(consultas)
    except Exception as e:
        return err(str(e))


# ---------------------------------------------------------------------------
# CONSULTA 2: Lecturas de sensor en rango de fechas
# ---------------------------------------------------------------------------
@app.route("/api/telemetria/<paciente_id>")
def telemetria(paciente_id):
    sensor = request.args.get("sensor", "glucosa")
    desde  = request.args.get("desde")
    hasta  = request.args.get("hasta")

    if not desde or not hasta:
        return err("Parametros 'desde' y 'hasta' requeridos (YYYY-MM-DD)", 400)

    try:
        filtro = {
            "paciente_id": paciente_id,
            "tipo_sensor":  sensor,
            "timestamp": {
                "$gte": datetime.fromisoformat(desde),
                "$lte": datetime.fromisoformat(hasta + "T23:59:59"),
            },
        }
        lecturas = list(
            db.telemetria.find(filtro).sort("timestamp", 1).limit(500)
        )
        # Estadisticas basicas
        valores = [l["valor"] for l in lecturas]
        stats = {}
        if valores:
            stats = {
                "total":   len(valores),
                "minimo":  round(min(valores), 1),
                "maximo":  round(max(valores), 1),
                "promedio": round(sum(valores) / len(valores), 1),
            }
        return ok({"lecturas": lecturas, "estadisticas": stats})
    except Exception as e:
        return err(str(e))


# ---------------------------------------------------------------------------
# CONSULTA 3: Pacientes activos de un médico con última lectura vital
# ---------------------------------------------------------------------------
@app.route("/api/medico/<medico_id>/pacientes-activos")
def pacientes_activos(medico_id):
    try:
        pacientes = list(
            db.pacientes.find(
                {"medico_principal_id": medico_id, "activo": True},
                {"nombre": 1, "condicion_cronica": 1, "ultima_lectura_vital": 1,
                 "fecha_nacimiento": 1, "genero": 1}
            ).sort("nombre", 1)
        )
        return ok(pacientes)
    except Exception as e:
        return err(str(e))


# ---------------------------------------------------------------------------
# CONSULTA 4: Alertas cuando un vital supera el umbral crítico
# ---------------------------------------------------------------------------
@app.route("/api/alertas")
def alertas():
    # El médico puede ajustar los umbrales via query params
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
            pacientes = list(db.pacientes.find(
                {
                    "ultima_lectura_vital.tipo_sensor": sensor,
                    "ultima_lectura_vital.valor": {op: cfg["valor"]},
                    "activo": True,
                },
                {"nombre": 1, "ultima_lectura_vital": 1,
                 "medico_principal_id": 1, "condicion_cronica": 1}
            ))
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
        # Orden: más recientes primero
        alertas_result.sort(key=lambda x: x.get("timestamp") or "", reverse=True)
        return ok(alertas_result)
    except Exception as e:
        return err(str(e))


# ---------------------------------------------------------------------------
# CONSULTA 5: Red de referidos de un paciente
# ---------------------------------------------------------------------------
@app.route("/api/red-referidos/<paciente_id>")
def red_referidos(paciente_id):
    try:
        paciente = db.pacientes.find_one(
            {"_id": paciente_id},
            {"nombre": 1, "condicion_cronica": 1, "medico_principal_id": 1}
        )
        if not paciente:
            return err("Paciente no encontrado", 404)

        # Agrupar consultas por médico con conteo y fecha de última consulta
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
        nodos = list(db.consultas_clinicas.aggregate(pipeline))

        medico_principal = db.medicos.find_one({"_id": paciente["medico_principal_id"]})

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


# ---------------------------------------------------------------------------
if __name__ == "__main__":
    print(f"VitalCore API corriendo en http://localhost:{PORT}")
    print(f"Conectado a MongoDB: {MONGO_URI}{DB_NAME}")
    app.run(debug=True, port=PORT)
