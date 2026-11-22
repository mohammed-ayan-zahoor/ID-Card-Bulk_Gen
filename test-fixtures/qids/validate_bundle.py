"""Usage: python3 -I validate_bundle.py schema.json bundle.qids [...]
Checks: JSON Schema, unique studentId, photo file presence, SHA-256."""
import hashlib, json, sys, zipfile
from jsonschema import Draft202012Validator

schema = json.load(open(sys.argv[1]))
v = Draft202012Validator(schema)
for path in sys.argv[2:]:
    z = zipfile.ZipFile(path)
    m = json.loads(z.read("manifest.json"))
    errs = [f"schema: {'/'.join(map(str, e.absolute_path))}: {e.message}" for e in v.iter_errors(m)]
    ids = [s["studentId"] for s in m["students"]]
    if len(ids) != len(set(ids)):
        errs.append("duplicate studentId")
    names = set(z.namelist())
    photo_errs = []
    for s in m["students"]:
        if s["photo"]:
            if s["photo"] not in names:
                photo_errs.append((s["studentId"], "missing file"))
            elif hashlib.sha256(z.read(s["photo"])).hexdigest() != s["photoSha256"]:
                photo_errs.append((s["studentId"], "sha mismatch"))
    print(f"{path.split('/')[-1]}: manifest {'OK' if not errs else 'INVALID'}; "
          f"students={len(ids)}; photoErrors={photo_errs}")
    for e in errs:
        print("  ", e)
