class DoctorRepository:
    def __init__(self, db):
        self.collection = db.medicos

    def count_all(self):
        return self.collection.count_documents({})

    def find_all(self):
        return list(self.collection.find({}).sort("nombre", 1))

    def find_all_paginated(self, page=1, per_page=20):
        skip = (page - 1) * per_page
        return list(self.collection.find({}).sort("nombre", 1).skip(skip).limit(per_page))

    def find_by_id(self, doctor_id):
        return self.collection.find_one({"_id": doctor_id})
