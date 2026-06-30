# VitalCore

Dashboard de monitoreo médico con datos sintéticos. Flask API + MongoDB + JavaScript vanilla.

## Caracteristicas

- **Historial Clinico** — Consultas cronologicas de un paciente con info del medico
- **Telemetria** — Lecturas de sensor por rango de fechas con estadisticas (min, max, promedio)
- **Pacientes Activos** — Lista de pacientes asignados a un medico con su ultimo vital
- **Alertas** — Deteccion de valores criticos con umbrales configurables
- **Red de Referidos** — Visualizacion de la cadena medica (principal + especialistas)

## Prerrequisitos

- Python 3.10+
- MongoDB 5.0+ (local o Atlas) — necesario para Time Series Collection

## Instalacion y ejecucion

```bash
# 1. Instalar dependencias
py -m pip install -r requirements.txt

# 2. Iniciar MongoDB (local)
net start MongoDB
# O usar MongoDB Atlas: copiar la URI en un archivo .env (ver Configuracion)

# 3. Poblar la base de datos (genera ~260k documentos)
python backend/ingest_vitalcore.py

# 4. Levantar el servidor
python backend/server.py
# Abrir http://localhost:5000
```

## Arquitectura

```
VitalCore/
├── config/
│   ├── settings.py          # Configuracion via .env (MONGO_URI, DB_NAME, PORT)
│   └── thresholds.py        # Rangos de sensores y umbrales criticos (fuente unica)
├── backend/
│   ├── server.py            # API Flask con factory pattern (create_app)
│   ├── ingest_vitalcore.py  # Pipeline de ingesta de datos sinteticos
│   ├── alert_evaluator.py   # Evalua lecturas contra umbrales
│   └── db/                  # Repositorios de acceso a datos
│       ├── patient_repository.py
│       ├── doctor_repository.py
│       ├── consulta_repository.py
│       └── telemetria_repository.py
├── frontend/
│   ├── index.html           # Dashboard con 5 tabs
│   ├── app.js               # Logica del frontend ( vanilla JS )
│   └── style.css
├── requirements.txt
└── .env                     # (opcional) Variables de entorno
```

## Base de datos

| Coleccion | Tipo | Descripcion |
|---|---|---|
| `pacientes` | Documentos | 500 pacientes con datos demograficos embebidos |
| `medicos` | Documentos | 50 medicos (5 especialidades) |
| `consultas_clinicas` | Documentos | 1,000 consultas con notas embebidas |
| `telemetria` | **Time Series** | 200,000 lecturas (6 meses simulados) |

La coleccion `telemetria` es una Time Series Collection (requiere MongoDB 5.0+). El script de ingesta la dropea y recrea en cada ejecucion.

## Endpoints API

### Listados

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | `/api/pacientes` | Todos los pacientes |
| GET | `/api/medicos` | Todos los medicos |
| GET | `/api/thresholds` | Umbrales criticos por sensor |

### Consultas principales

| Metodo | Ruta | Descripcion |
|---|---|---|
| GET | `/api/historial/<paciente_id>` | Historial clinico cronologico |
| GET | `/api/telemetria/<paciente_id>?sensor=glucosa&desde=YYYY-MM-DD&hasta=YYYY-MM-DD` | Lecturas de sensor en rango de fechas |
| GET | `/api/medico/<medico_id>/pacientes-activos` | Pacientes activos con ultimo vital |
| GET | `/api/alertas?fc=120&glucosa=180&spo2=92&pa=140` | Alertas (umbrales opcionales via query params) |
| GET | `/api/red-referidos/<paciente_id>` | Red de referidos del paciente |

### Ejemplos con curl

```bash
# Listar pacientes
curl http://localhost:5000/api/pacientes

# Historial clinico
curl http://localhost:5000/api/historial/PAC00001

# Telemetria: glucosa del paciente PAC00001 en marzo 2026
curl "http://localhost:5000/api/telemetria/PAC00001?sensor=glucosa&desde=2026-03-01&hasta=2026-03-31"

# Alertas con umbrales personalizados
curl "http://localhost:5000/api/alertas?fc=110&glucosa=160&spo2=94&pa=130"

# Red de referidos
curl http://localhost:5000/api/red-referidos/PAC00001

# Evaluar una lectura individual
curl "http://localhost:5000/api/evaluate-reading?sensor=glucosa&value=195"
```

## Configuracion

Las variables de entorno se cargan desde un archivo `.env` en la raiz del proyecto (via `python-dotenv`):

| Variable | Por defecto | Descripcion |
|---|---|---|
| `MONGO_URI` | `mongodb://localhost:27017/` | URI de conexion a MongoDB |
| `DB_NAME` | `vitalcore` | Nombre de la base de datos |
| `PORT` | `5000` | Puerto del servidor Flask |
| `SKIP_PING` | `false` | Saltar ping de conexion (util en dev con SSL) |

Ejemplo de `.env` para MongoDB Atlas:

```
MONGO_URI=mongodb+srv://usuario:password@cluster.mongodb.net/
DB_NAME=vitalcore
```

## Volumen de datos (ingest)

El script `ingest_vitalcore.py` genera datos medicamente coherentes:

- **500** pacientes (95% activos, edades 18-90)
- **50** medicos en 5 especialidades
- **1,000** consultas clinicas (35% con especialistas referidos)
- **200,000** lecturas de telemetria distribuidas en 6 meses
- Condiciones cronicas que afectan rangos de sensores (ej. diabetes -> glucosa mas alta)

Usa `random.seed(42)` para reproducibilidad. **Ejecutar dropea todas las colecciones.**

## Notas tecnicas

- `ultima_lectura_vital` esta denormalizada en cada documento de paciente (actualizada por el ingest, no por el server)
- `config/thresholds.py` es la fuente unica de verdad para rangos y umbrales — importado por ingest, server, y expuesto via `/api/thresholds`
- El frontend hardcodea `API = 'http://localhost:5000/api'` — cambiar en `frontend/app.js` si el puerto difiere
