import csv

with open("Women_s_E-Commerce_Clothing_Reviews_1594_1.csv", encoding="utf-8", errors="replace") as f:
    reader = csv.reader(f)
    header = next(reader)
    print("Headers:", header)
    row = next(reader)
    print("First row:", row)
    print()
    print("Header count:", len(header))
    print("Row count:", len(row))
