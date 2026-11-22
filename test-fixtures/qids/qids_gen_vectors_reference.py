import hashlib, json, re, sys, unicodedata, uuid

NS = uuid.uuid5(uuid.NAMESPACE_DNS, "qids.3ftech.in")


def norm(s):
    s = unicodedata.normalize("NFKC", s).lower()
    s = re.sub("[​-‍﻿]", "", s)
    s = "".join(" " if (unicodedata.category(c)[0] in "PC" or c == "|") else c for c in s)
    return " ".join(s.split())


def row_hash(values):
    joined = "\x1f".join(norm(v) for v in values)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()[:16]


def canonical(school, cls, sec, name, dob=None, father=None, roll=None, row_values=None, ord_=None):
    if row_values is not None:
        tag = "row=" + row_hash(row_values)
        if ord_:
            tag += f"|ord={ord_}"
    elif dob:
        tag = "dob=" + dob            # ISO yyyy-mm-dd, inserted raw
    elif father:
        tag = "father=" + norm(father)
    elif roll:
        tag = "roll=" + norm(roll)
    else:
        tag = "none="
    return "|".join(["qids:gen:v1", norm(school), norm(cls), norm(sec), norm(name), tag])


def vec(vid, equals=None, **kw):
    c = canonical(**kw)
    return {"id": vid, "input": kw, "canonical": c, "studentId": "gen:" + str(uuid.uuid5(NS, c)),
            "mustEqual": equals}


S = "Test Institute of Science"
V = []
V.append(vec("v1_basic", school=S, cls="10", sec="A", name="Aryan Sharma", dob="2012-03-04"))
V.append(vec("v2_case_whitespace", equals="v1_basic", school="  TEST   Institute of Science ",
             cls="10", sec="a", name=" ARYAN   sharma\t", dob="2012-03-04"))
V.append(vec("v2b_fullwidth_nbsp", equals="v1_basic", school=S, cls="10", sec="A",
             name="Ａryan Sharma", dob="2012-03-04"))
V.append(vec("v3_devanagari_father", school="सरस्वती विद्यालय",
             cls="10", sec="A", name="राहुल शर्मा",
             father="सुरेश शर्मा"))
V.append(vec("v4a_nukta_precomposed", school=S, cls="10", sec="A",
             name="क़ासिम ख़ान",
             father="अब्दुल रहमान"))
V.append(vec("v4b_nukta_decomposed_zwj", equals="v4a_nukta_precomposed", school=S, cls="10", sec="A",
             name="क़ासिम ख़ा‍न",
             father="अब्दुल रहमान"))
V.append(vec("v5_roll_only", school=S, cls="10", sec="A", name="Isha Patil", roll="12"))
V.append(vec("v5b_none", school=S, cls="10", sec="A", name="Isha Patil"))
V.append(vec("v6a_punctuation", school=S, cls="10", sec="A", name="Dr. Anne-Marie O'Brien",
             father="Mr. J. O'Brien"))
V.append(vec("v6b_punctuation_plain", equals="v6a_punctuation", school=S, cls="10", sec="A",
             name="dr anne marie o brien", father="mr j o brien"))
RV = ["Rahul Sharma", "10", "A", "Bus 3", ""]
V.append(vec("v7_collision_row", school=S, cls="10", sec="A", name="Rahul Sharma", row_values=RV))
V.append(vec("v7b_collision_row_ord2", school=S, cls="10", sec="A", name="Rahul Sharma",
             row_values=RV, ord_=2))

by = {v["id"]: v for v in V}
for v in V:
    if v["mustEqual"]:
        assert v["studentId"] == by[v["mustEqual"]]["studentId"], v["id"]
ids = [v["studentId"] for v in V if not v["mustEqual"]]
assert len(ids) == len(set(ids))

out = {
    "namespace": {"derivation": "uuid5(NAMESPACE_DNS, 'qids.3ftech.in')", "value": str(NS)},
    "canonicalFormat": "qids:gen:v1|norm(school)|norm(class)|norm(section)|norm(fullName)|<tag>=<value>",
    "tagPriority": ["dob (ISO, raw)", "father (norm)", "roll (norm)", "none (empty)"],
    "collisionEscalation": "row=<first16hex sha256(US-joined norm(values in column order))>, then |ord=<n>",
    "normalize": "NFKC; lowercase; delete U+200B-U+200D,U+FEFF; each Unicode P* or C* char and '|' -> space; split on whitespace and join with one space",
    "vectors": V,
}
with open(sys.argv[1], "w") as f:
    json.dump(out, f, indent=2)
print("namespace", NS)
for v in V:
    print(f"{v['id']:28s} {v['studentId']}")
