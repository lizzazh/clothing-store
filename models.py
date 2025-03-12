from sqlalchemy import Column, Integer, String, Text, Float, Boolean, ForeignKey
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship

Base = declarative_base()


class Product(Base):
    __tablename__ = "products"
    number = Column(Integer, primary_key=True, index=True)
    clothing_id = Column(Integer, index=True)
    age = Column(Integer, nullable=True)
    title = Column(String, nullable=True)
    review_text = Column(Text, nullable=True)
    rating = Column(Float, nullable=True)
    recommended_ind = Column(Boolean, nullable=True)
    positive_feedback_count = Column(Integer, default=0)
    division_name = Column(String, nullable=True)
    department_name = Column(String, nullable=True)
    class_name = Column(String, nullable=True)
