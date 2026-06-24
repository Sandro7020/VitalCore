class DoctorRepository:
    def __init__(self, db):
        self.collection = db.medicos

    def find_all(self):
        return list(self.collection.find({}).sort("nombre", 1))

    def find_by_id(self, doctor_id):
        return self.collection.find_one({"_id": doctor_id})
