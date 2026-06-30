import os
import sys
from dotenv import load_dotenv
from pymongo import MongoClient
from pymongo.server_api import ServerApi

load_dotenv()

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017/")
DB_NAME = os.getenv("DB_NAME", "vitalcore")
PORT = int(os.getenv("PORT", "5000"))

# Set to "true" to skip the server ping on connect (useful in dev when SSL
# certificates are not available, e.g. MSYS2/MinGW environments).
SKIP_PING = os.getenv("SKIP_PING", "false").lower() == "true"


def get_client() -> MongoClient:
    """Crea un MongoClient con Atlas Stable API cuando aplica.

    Para URIs de Atlas (mongodb+srv://) el Stable API v1 se activa en el modo restrictivo.
    Un ``ping`` verifica la conexión a menos que SKIP_PING sea verdadero.
    """
    is_atlas = MONGO_URI.startswith("mongodb+srv://")

    kwargs: dict = {}
    if is_atlas:
        kwargs["server_api"] = ServerApi("1", strict=True, deprecation_errors=True)

    client = MongoClient(MONGO_URI, **kwargs)

    if not SKIP_PING:
        try:
            client.admin.command("ping")
            print("Conexion a MongoDB verificada (ping OK)")
        except Exception as exc:
            print(
                f"Advertencia: no se pudo verificar la conexion (ping fallo): {exc}",
                file=sys.stderr,
            )

    return client
