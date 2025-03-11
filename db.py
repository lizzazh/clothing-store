from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

server = "lizapk"
database = "kvr"
username = "liza"
password = "222907"

DATABASE_URL = f"mssql+pymssql://{username}:{password}@{server}/{database}"

# Спочатку створюємо engine, а потім SessionLocal
engine = create_engine(DATABASE_URL)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()