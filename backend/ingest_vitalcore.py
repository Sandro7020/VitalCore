"""
VitalCore - Pipeline de Ingesta de Datos Sinteticos
=====================================================
Genera datos medicamente coherentes para la plataforma VitalCore y los
inserta directamente en MongoDB usando pymongo.

Volumen generado:
    - 500 pacientes
    - 50 medicos (5 especialidades)
    - 1,000 consultas clinicas
    - 200,000 lecturas de telemetria (6 meses simulados)

Requisitos:
    pip install faker pymongo

Uso:
    1. Asegurate de tener un servidor MongoDB corriendo (local o Atlas).
    2. Ajusta MONGO_URI si es necesario.
    3. Ejecuta: python ingest_vitalcore.py
"""

import random
import sys
import os
from datetime import datetime, timedelta

from faker import Faker
from pymongo import ASCENDING, DESCENDING

# Agregar el directorio raiz al path para importar config
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from config.settings import MONGO_URI, DB_NAME, get_client
from config.thresholds import RANGOS_SENSORES

NUM_PACIENTES = 500
NUM_MEDICOS = 50
NUM_CONSULTAS = 1000
NUM_LECTURAS = 200_000
MESES_SIMULADOS = 6

ESPECIALIDADES = [
    "Cardiologia",
    "Endocrinologia",
    "Medicina General",
    "Neumologia",
    "Geriatria",
]

# Condiciones cronicas plausibles que influyen en los rangos de telemetria.
CONDICIONES_CRONICAS = [
    "Diabetes Tipo 2",
    "Hipertension",
    "Asma",
    "Ninguna",
    "Apnea del sueno",
]

fake = Faker("es_ES")
random.seed(42)  # Reproducibilidad para la defensa


# ---------------------------------------------------------------------------
# FUNCIONES DE GENERACION CON COHERENCIA MEDICA
# ---------------------------------------------------------------------------

def generar_valor_sensor(tipo_sensor: str, tiene_condicion_relacionada: bool) -> float:
    """
    Genera un valor realista para un tipo de sensor.
    Si el paciente tiene una condicion relacionada (ej. Diabetes -> glucosa),
    el rango se desplaza hacia valores mas altos para reflejar la realidad
    clinica, sin dejar de ser fisiologicamente plausible.
    """
    rango = RANGOS_SENSORES[tipo_sensor]
    minimo, maximo = rango["min"], rango["max"]

    if tiene_condicion_relacionada and tipo_sensor == "glucosa":
        # Un paciente diabetico tiende a tener glucosa mas alta en promedio
        return round(random.uniform(110, maximo), 1)
    if tiene_condicion_relacionada and tipo_sensor == "presion_sistolica":
        return round(random.uniform(130, maximo), 1)

    return round(random.uniform(minimo, maximo), 1)


def generar_paciente(paciente_id: int, medicos_ids: list) -> dict:
    """Genera un documento de paciente con datos demograficos embebidos."""
    condicion = random.choice(CONDICIONES_CRONICAS)
    fecha_registro = fake.date_time_between(
        start_date=f"-{MESES_SIMULADOS}M", end_date="now"
    )

    return {
        "_id": f"PAC{paciente_id:05d}",
        "nombre": fake.name(),
        "fecha_nacimiento": fake.date_of_birth(minimum_age=18, maximum_age=90).isoformat(),
        "genero": random.choice(["M", "F"]),
        "condicion_cronica": condicion,
        "medico_principal_id": random.choice(medicos_ids),
        "activo": random.random() > 0.05,  # 95% de pacientes activos
        "fecha_registro": fecha_registro,
        # Se actualizara despues de generar telemetria (patron de acceso #3)
        "ultima_lectura_vital": None,
    }


def generar_medico(medico_id: int) -> dict:
    """Genera un documento de medico."""
    return {
        "_id": f"MED{medico_id:04d}",
        "nombre": fake.name(),
        "especialidad": random.choice(ESPECIALIDADES),
        "anios_experiencia": random.randint(1, 35),
    }


def generar_consulta(consulta_id: int, paciente: dict, todos_medicos_ids: list) -> dict:
    """
    Genera una consulta clinica con notas embebidas.
    El 35% de las consultas se asignan a un especialista distinto al medico
    principal, simulando referidos para poblar la red de referidos (consulta 5).
    """
    fecha_min = paciente["fecha_registro"]
    fecha_consulta = fake.date_time_between(start_date=fecha_min, end_date="now")

    # 35% de probabilidad de que la consulta sea con un especialista
    if random.random() < 0.35:
        otros = [m for m in todos_medicos_ids if m != paciente["medico_principal_id"]]
        medico_id = random.choice(otros) if otros else paciente["medico_principal_id"]
    else:
        medico_id = paciente["medico_principal_id"]

    notas = (
        f"Paciente refiere {fake.sentence(nb_words=8)} "
        f"Se recomienda {fake.sentence(nb_words=6)}"
    )

    return {
        "_id": f"CONS{consulta_id:06d}",
        "paciente_id": paciente["_id"],
        "medico_id": medico_id,
        "fecha_consulta": fecha_consulta,
        "motivo": random.choice(
            ["Control rutinario", "Seguimiento", "Sintomas agudos", "Revision de resultados"]
        ),
        "notas_clinicas": notas,
    }


def generar_lecturas_para_paciente(paciente: dict, num_lecturas: int) -> list:
    """
    Genera N lecturas de telemetria distribuidas en el periodo simulado
    para un paciente especifico, manteniendo coherencia con su condicion
    cronica.
    """
    lecturas = []
    tiene_condicion = paciente["condicion_cronica"] != "Ninguna"
    fecha_inicio = paciente["fecha_registro"]
    fecha_fin = datetime.now()
    rango_total_segundos = (fecha_fin - fecha_inicio).total_seconds()

    if rango_total_segundos <= 0:
        rango_total_segundos = 1  # evita division por cero en casos limite

    for _ in range(num_lecturas):
        tipo_sensor = random.choice(list(RANGOS_SENSORES.keys()))
        offset_segundos = random.uniform(0, rango_total_segundos)
        timestamp = fecha_inicio + timedelta(seconds=offset_segundos)
        valor = generar_valor_sensor(tipo_sensor, tiene_condicion)

        lecturas.append({
            "timestamp": timestamp,
            "paciente_id": paciente["_id"],
            "tipo_sensor": tipo_sensor,
            "valor": valor,
            "unidad": RANGOS_SENSORES[tipo_sensor]["unidad"],
        })

    return lecturas


# ---------------------------------------------------------------------------
# PIPELINE PRINCIPAL
# ---------------------------------------------------------------------------

def main():
    print("Conectando a MongoDB...")
    client = get_client()
    db = client[DB_NAME]

    # Limpieza de colecciones previas (idempotencia para re-ejecutar el script)
    db.pacientes.drop()
    db.medicos.drop()
    db.consultas_clinicas.drop()
    db.telemetria.drop()

    # Recrear telemetria como Time Series Collection (requiere MongoDB 5.0+)
    db.create_collection(
        "telemetria",
        timeseries={
            "timeField": "timestamp",
            "metaField": "paciente_id",
            "granularity": "minutes",
        },
    )

    # --- 1. Medicos ---
    print(f"Generando {NUM_MEDICOS} medicos...")
    medicos = [generar_medico(i) for i in range(1, NUM_MEDICOS + 1)]
    db.medicos.insert_many(medicos)
    medicos_ids = [m["_id"] for m in medicos]

    # --- 2. Pacientes ---
    print(f"Generando {NUM_PACIENTES} pacientes...")
    pacientes = [generar_paciente(i, medicos_ids) for i in range(1, NUM_PACIENTES + 1)]
    db.pacientes.insert_many(pacientes)

    # --- 3. Consultas clinicas ---
    # Se pasa todos_medicos_ids para que el 35% de consultas sean con especialistas
    print(f"Generando {NUM_CONSULTAS} consultas clinicas...")
    consultas = []
    for i in range(1, NUM_CONSULTAS + 1):
        paciente = random.choice(pacientes)
        consultas.append(generar_consulta(i, paciente, medicos_ids))
    db.consultas_clinicas.insert_many(consultas)

    # --- 4. Telemetria (200,000 lecturas distribuidas entre pacientes) ---
    print(f"Generando {NUM_LECTURAS} lecturas de telemetria...")
    lecturas_por_paciente = NUM_LECTURAS // NUM_PACIENTES
    resto = NUM_LECTURAS % NUM_PACIENTES

    BATCH_SIZE = 5000
    buffer_lecturas = []
    ultima_lectura_por_paciente = {}

    for idx, paciente in enumerate(pacientes):
        n = lecturas_por_paciente + (1 if idx < resto else 0)
        lecturas = generar_lecturas_para_paciente(paciente, n)

        # Guardamos la lectura mas reciente para actualizar el patron de
        # acceso #3 (dashboard del medico: ultima lectura vital por paciente)
        if lecturas:
            mas_reciente = max(lecturas, key=lambda x: x["timestamp"])
            ultima_lectura_por_paciente[paciente["_id"]] = mas_reciente

        buffer_lecturas.extend(lecturas)

        if len(buffer_lecturas) >= BATCH_SIZE:
            db.telemetria.insert_many(buffer_lecturas)
            buffer_lecturas = []

    if buffer_lecturas:
        db.telemetria.insert_many(buffer_lecturas)

    # --- 5. Actualizar 'ultima_lectura_vital' en cada paciente ---
    print("Actualizando ultima lectura vital por paciente...")
    for paciente_id, lectura in ultima_lectura_por_paciente.items():
        db.pacientes.update_one(
            {"_id": paciente_id},
            {"$set": {
                "ultima_lectura_vital": {
                    "tipo_sensor": lectura["tipo_sensor"],
                    "valor": lectura["valor"],
                    "unidad": lectura["unidad"],
                    "timestamp": lectura["timestamp"],
                }
            }},
        )

    # --- 6. Indices ---
    print("Creando indices...")
    db.pacientes.create_index([("medico_principal_id", ASCENDING), ("activo", ASCENDING)])
    db.consultas_clinicas.create_index([("paciente_id", ASCENDING), ("fecha_consulta", DESCENDING)])
    db.telemetria.create_index([("paciente_id", ASCENDING), ("tipo_sensor", ASCENDING), ("timestamp", DESCENDING)])

    print("\nIngesta completada:")
    print(f"  Pacientes: {db.pacientes.count_documents({})}")
    print(f"  Medicos: {db.medicos.count_documents({})}")
    print(f"  Consultas clinicas: {db.consultas_clinicas.count_documents({})}")
    print(f"  Lecturas de telemetria: {db.telemetria.count_documents({})}")

    client.close()


if __name__ == "__main__":
    main()
