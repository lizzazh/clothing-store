from sqlalchemy import Column, Integer, String, Text, Float, Boolean
from sqlalchemy.orm import relationship
from sqlalchemy.ext.declarative import declarative_base

Base = declarative_base()

class Product(Base):
    __tablename__ = "products"
    clothing_id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True)
    class_name = Column(String, index=True)
    department_name = Column(String, index=True)
    division_name = Column(String, nullable=True)
    rating = Column(Float, nullable=True)
    recommended_ind = Column(Boolean, nullable=True)
    positive_feedback_count = Column(Integer, default=0)
   