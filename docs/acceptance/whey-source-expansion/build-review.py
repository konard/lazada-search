#!/usr/bin/env python3
"""Build a public source-only review without touching the associative store."""
import gzip
import hashlib
import json
import pathlib
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent
REPO = ROOT.parents[2]


def read_json(path):
    return json.loads(path.read_text())


def digest(data):
    return hashlib.sha256(data).hexdigest()


def source(name):
    return read_json(ROOT / f"{name}.source.json")


def fact(value, unit, basis, name, excerpt, factory_variant_matched=True):
    r = source(name)
    return {"value": value, "unit": unit, "basis": basis, "sourceUrl": r["url"],
            "sourceSha256": r["sha256"], "sourceArtifact": r["artifact"],
            "sourceAuthority": r["sourceAuthority"], "excerpt": excerpt,
            "factoryVariantMatched": factory_variant_matched, "identityMatched": False}


def nutrition(serving, protein, sugar, fat, saturated, kcal, name):
    numbers = {"servingMassG": (serving, "g", "per serving"),
               "proteinPerServingG": (protein, "g", "per serving"),
               "sugarPerServingG": (sugar, "g", "per serving"),
               "fatPerServingG": (fat, "g", "per serving"),
               "saturatedFatPerServingG": (saturated, "g", "per serving"),
               "kcalPerServing": (kcal, "kcal", "per serving")}
    values = {}
    for field, (value, unit, basis) in numbers.items():
        if value is None:
            continue
        values[field] = fact(value, unit, basis, name, f"Manufacturer label: {field} = {value}; serving mass {serving} g")
        if field not in {"servingMassG", "kcalPerServing"} and isinstance(value, (int, float)):
            field100 = field.replace("PerServingG", "Per100g")
            values[field100] = fact(value * 100 / serving, "g", "per100g, calculated from labelled serving", name, f"{value} g per {serving} g serving; {value} *100/{serving}")
            values[field100]["derivation"] = {"numerator": value, "servingMassG": serving, "scale": 100}
    values["kcalPer100g"] = fact(kcal * 100 / serving, "kcal", "per100g, calculated from labelled serving", name, f"{kcal} kcal per {serving} g serving")
    return values


def product(identifier, name, flavour, facts, gaps=None):
    return {"id": identifier, "name": name, "flavour": flavour,
            "facts": facts, "manufacturerReviewsApplied": 0,
            "sellerIdentityMatched": False, "blockingEvidenceGaps": gaps or []}


def build_products():
    products = []
    for key, flavour, protein, panel, front, variant, gtin, ingredients in [
        ("levels-double-chocolate-5lb", "Double Chocolate", 24, "levels-double-chocolate-5lb-panel", "levels-double-chocolate-5lb-front", "39623456424006", "857965007762", ["whey protein concentrate", "cocoa powder", "sunflower lecithin", "sea salt", "stevia leaf extract", "monk fruit extract"]),
        ("levels-unflavored-5lb", "Unflavored", 25, "levels-unflavored-5lb-panel", "levels-unflavored-5lb-front", "39438823260230", "857965007038", ["whey protein concentrate", "sunflower lecithin"]),
    ]:
        facts = nutrition(32, protein, 2, 2.5, 1.5, 130, panel)
        facts.update(netMassG=fact(2270, "g", "one factory tub", front, "NET WT.5LB (80OZ) (2.27KG);71 servings"),
                     packCount=fact(1, "container", "manufacturer product image", front, "One factory tub"),
                     ingredients=fact(ingredients, "ingredients", f"exact manufacturer variant {variant}", "levels-current-whey", "Exact variant's ingredients and nutritionalFacts metadata in original product HTML"),
                     gtin=fact(gtin, "GTIN", "exact factory variant", "levels-current-whey", f"JSON-LD hasVariant {variant}:gtin {gtin}"))
        products.append(product(key, "Levels Grass Fed Whey Protein", flavour, facts, ["No current exact chocolate/plain Lazada SKU package label is mapped; selected handpicked Vanilla80-serving bag is another flavour and package.", "Do not transfer current71-serving2270g tubs to old80-serving2560g bags."]))

    facts = nutrition(33, 30, 1, 1, 0, 130, "its-just-5lb-official-back")
    facts.update(netMassG=fact(2268, "g", "one factory5lb tub", "its-just-5lb-official-front", "NET WT.5 LBS (2268g)"),
                 ingredients=fact(["grass fed whey protein isolate", "sunflower lecithin (less than2%)"], "ingredients", "exact plain5lb label", "its-just-5lb-official-back", "Grass Fed Whey Protein Isolate, less than2% Sunflower Lecithin"),
                 packCount=fact(1, "container", "manufacturer product image", "its-just-5lb-official-front", "One5lb factory tub"))
    products.append(product("its-just-unflavored-5lb", "IT'S JUST Whey Protein Isolate", "Unflavored", facts, ["Existing exact matched reviews remain authoritative; this bundle does not apply or duplicate them.", "Primary page default barcode/smaller variant must not replace the5lb gallery identity."]))

    facts = nutrition(29.5, 25, 0, 0, 0, 110, "rule1-unflavored-nutrition")
    facts.update(netMassG=fact(767, "g", "one pictured26-serving factory tub", "rule1-unflavored-old-2lb-label", "NET WT27.1OZ (1.69LB)767G;26 servings;Unflavored"),
                 ingredients=fact(["whey protein isolate", "hydrolyzed whey protein isolate", "contains less than2% of soy lecithin", "sunflower lecithin"], "ingredients", "exact manufacturer plain panel", "rule1-unflavored-nutrition", "Ingredients: Whey Protein Isolate, Hydrolyzed Whey Protein Isolate, Contains Less Than2% of Soy Lecithin, Sunflower Lecithin"),
                 allergens=fact(["milk", "soy"], "allergens", "exact label", "rule1-unflavored-nutrition", "Contains: Milk & Soy"))
    products.append(product("rule1-naturally-flavored-unflavored", "Rule One Naturally Flavored R1 Protein Whey Isolate", "Unflavored", facts, ["Seller selected2×1kg repacks do not match factory767g/other approximate-size tubs.", "Exact parent factory batch/GTIN and repack label are absent; do not transfer factory formula yet.", "Manufacturer image filenames/approximate lb selectors do not override printed767g mass."]))

    lead = read_json(REPO / "docs/acceptance/urgent-whey-reviews/factory-lead-review.json")["manufacturerSpecCandidate"]
    facts = nutrition(36, 28, 1, 1, 0.5, 130, "nutrabolics-extreme-chocolate-official-panel")
    facts.update(netMassG=fact(2050, "g", "one current Extreme Chocolate factory tub", "nutrabolics-current-official-front", "Extreme Chocolate4.5lb factory front prints2.05kg"),
                 ingredients=fact(lead["facts"]["ingredients"], "ingredients", "exact current Extreme Chocolate panel", "nutrabolics-extreme-chocolate-official-panel", "Ingredient list on exact Extreme Chocolate4.5lb current label"),
                 carbohydratePerServingG=fact(2, "g", "per36g serving", "nutrabolics-extreme-chocolate-official-panel", "Total carbohydrate2g"),
                 allergens=fact(["milk", "soy"], "allergens", "exact label", "nutrabolics-extreme-chocolate-official-panel", "Contains milk and soy"))
    products.append(product("nutrabolics-extreme-chocolate-2050g", lead["name"], "Extreme Chocolate", facts, lead["sellerLimits"]))

    for key, flavour, protein, saturated, panel, ingredients in [
        ("biox-regular-chocolate", "Chocolate", 30, 0, "biox-cached-isolate-product", ["100% pure cross flow microfiltered, ultrafiltered and diafiltered whey protein isolate", "Dutch cocoa powder", "natural flavour", "guar gum", "gum acacia", "xanthan gum", "sea salt", "sucralose"]),
        ("biox-natural-chocolate", "Chocolate Natural", 28, 0.5, "biox-natural-isolate", ["100% pure cross flow microfiltered, ultrafiltered and diafiltered whey protein isolate", "inulin (FOS)", "Dutch cocoa powder", "natural flavours", "glycine", "sea salt", "stevia"]),
    ]:
        facts = nutrition(35, protein, 0, 1, saturated, 140, panel)
        facts.update(ingredients=fact(ingredients, "ingredients", "explicit Chocolate nutrition section", panel, "Ingredient list immediately after Chocolate Nutrition Facts, before Chocolate Peanut Butter section"),
                     declaredOptionMassG=fact(1800, "g", "manufacturer option selector only", panel, "Chocolate is offered under1.8kg selector; other page metadata may conflict", False))
        gaps = ["Compare exact seller front/back and declared mass before formula approval; selected text alone does not establish packaging revision.", "Keep regular Chocolate30g/35g and Natural Chocolate28g/35g formulas separate."]
        if "natural" in key:
            gaps.append("Current manufacturer's1.8kg option name conflicts with description Chocolate(2.27kg) and2.27kg artwork; package mass remains unresolved.")
        else:
            gaps.append("Manufacturer JSON-LD regular Chocolate option description says Chocolate Peanut Butter; use explicit Chocolate nutrient section, not description metadata for identity.")
        products.append(product(key, "BioX Natural Whey Isolate" if "natural" in key else "BioX Power Whey Isolate", flavour, facts, gaps))

    facts = nutrition(27, 20, None, 0.5, None, 100, "clean-simple-eats-chocolate-30serv-label")
    facts.update(netMassG=fact(810, "g", "one30-serving factory bag", "clean-simple-eats-chocolate-30serv-front", "NET WT28.5OZ (1.7LB)810g;30 servings"),
                 sugarPerServingG=fact({"operator": "<", "upperBound": 1}, "g", "per27g serving", "clean-simple-eats-chocolate-30serv-label", "Total Sugars<1g; not zero and not exactly1g"),
                 ingredients=fact(["grass-fed whey protein isolate", "cocoa powder", "natural flavors", "sea salt", "coconut milk powder", "stevia leaf extract"], "ingredients", "current simplified Chocolate Brownie Batter formula", "clean-simple-eats-chocolate-30serv-label", "Ingredient list under exact30-serving label; NEW FORMULA, XYLITOL FREE, NO XANTHAN GUM"))
    products.append(product("cse-brownie-batter-current-810g", "Clean Simple Eats Chocolate Brownie Batter", "Chocolate Brownie Batter", facts, ["Manufacturer declares a new formula. Exact seller original back must match this revision.", "Manufacturer supplement panel omits saturated fat; omission does not mean zero.", "Sugars are<1g per27g serving, an upper bound that must not become an exact scalar.", "KID'S Chocolate Brow is not the adult30-serving product; no formula transfer."]))

    facts = nutrition(35, 25, 1, 0.9, 0.5, 125, "musaking-500g-chocolate-factory-panel")
    facts.update(netMassG=fact(500, "g", "one factory500g bag", "musaking-cached-500g-product", "Khối lượng tịnh:500g"),
                 ingredients=fact(["whey protein isolate", "whey protein concentrate", "cocoa powder", "natural and artificial flavors", "sunflower lecithin", "salt", "sucralose(955)", "stevia leaf extract(960d)"], "ingredients", "manufacturer500g Chocolate formula", "musaking-500g-chocolate-factory-panel", "English ingredient list on manufacturer-published Chocolate nutrition image"))
    products.append(product("musaking-chocolate-500g", "MusaKing Isolate Whey Protein Blend", "Chocolate", facts, ["Existing reviewed500g SKUs are reusable, but new combo SKU needs exact bag and food pack count.", "Do not transfer500g bag identity automatically to2205g tub."]))
    facts = {"netMassG": fact(2205, "g", "one factory tub", "musaking-cached-2205g-product", "Khối lượng tịnh:2205g(4.68lb)"),
             "servingMassG": fact(35, "g", "manufacturer family usage directions", "musaking-cached-2205g-product", "Pha1muỗng(35g)", False),
             "proteinPerServingG": fact(25, "g", "manufacturer Chocolate/Vanilla family advertising", "musaking-cached-2205g-product", "25g Protein/serving", False)}
    products.append(product("musaking-isolate-blend-2205g", "MusaKing Isolate Whey Protein Blend2205g", "Chocolate candidate", facts, ["Full exact Chocolate2205g tub nutrient label must match; shared family text has both Chocolate and Vanilla.", "Source's2205g and4.68lb statements disagree numerically; retain explicitly declared grams."]))
    facts = {"netMassG": fact(1816, "g", "manufacturer1816g product page", "scitec-isolate-1816g", "100% Whey Isolate(1,816kg);Packaging1,816kg"),
             "chocolateIngredients": fact(["instant whey protein isolate(milk)84%", "soy lecithins", "L-glutamine5.3%", "fat-reduced cocoa powder", "flavouring", "L-arginine1.2%", "salt", "xanthan gum", "sucralose", "acesulfame K"], "ingredients", "explicit CHOCOLATE FLAVORED section", "scitec-isolate-1816g", "CHOCOLATE FLAVORED: Instant whey protein isolate(milk)84%; L-Glutamine5.3%; L-Arginine1.2%"),
             "genericProteinPer100g": fact(83, "g", "generic product table; flavour unspecified", "scitec-isolate-1816g", "Protein21g per25g;83g per100g; table also lists700/2000/4000g packaging", False)}
    products.append(product("scitec-isolate-1816g", "Scitec100% Whey Isolate1816g", "Chocolate candidate", facts, ["Generic table has no flavour binding and references700/2000/4000g; exact chocolate nutrition panel required.", "One seller listing declares OstroVit brand while title says Scitec; resolve from original selected packaging before trust.", "72-serving new selected option alone does not establish1816g package."]))
    return products


def mappings(worklist):
    results = []
    for r in worklist["capturedSkus"]:
        if not r["scopeEligible"] or r["proteinSource"] != "whey" or r["manufacturerVerified"]:
            continue
        title = r["title"].lower()
        key, gaps = [], []
        if "hydropure" in title:
            key = ["nutrabolics-extreme-chocolate-2050g"]
            gaps = ["Exact selected Extreme Chocolate seller front/back and current revision are missing; gallery depicts other flavours."]
        elif r["sku"].startswith("13392889869"):
            key = ["rule1-naturally-flavored-unflavored"]
            gaps = ["2×1kg seller repack; exact factory parent and batch not shown."]
        elif "biox" in title:
            key = ["biox-natural-chocolate" if any("natural" in x.lower() for x in r["selectedOptions"]) else "biox-regular-chocolate"]
            gaps = ["Exact selected seller label/revision and package needed; natural and regular formulas differ."]
        elif "musaking" in title:
            key = ["musaking-chocolate-500g" if r.get("netMassG") == 500 else "musaking-isolate-blend-2205g"]
            gaps = ["Exact selected seller package and numeric selling food count must be visually matched to factory; no new review applied."]
        elif "clean simple eats" in title:
            if any("kid" in x.lower() for x in r["selectedOptions"]):
                gaps = ["KID'S product identity differs from adult Chocolate Brownie Batter; dedicated primary label needed."]
            else:
                key = ["cse-brownie-batter-current-810g"]
                gaps = ["Current reformulated factory bag must match seller; sat-fat omission and sugar bound remain explicit."]
        elif "scitec" in title:
            key = ["scitec-isolate-1816g"]
            gaps = ["Seller exact brand/revision/grams and flavour-bound factory nutrition remain unverified."]
        elif "warrior" in title:
            gaps = ["Seller source nutrition is Strawberry Creme. Cached factory Double Chocolate source lacks a complete exact label; do not transfer strawberry or white-chocolate formulas."]
        elif "critical" in title:
            gaps = ["Old seller20.3g/30g scoop/110kcal formula differs from current factory24g/33g/122kcal; trial repack also lacks exact parent label."]
        elif "mutant" in title:
            gaps = ["Seller36g scoop/22g protein/140kcal differs from factory38g scoop/22g/150kcal; no revision transfer."]
        elif "vbest" in title:
            gaps = ["No primary manufacturer identified for exact VBest450g. Similarly named Vitobest and other brands cannot be substituted."]
        elif r.get("brand") == "ProSupps":
            gaps = ["Exact premium2lb Chocolate Ice Cream revision differs from current published family;907g food mass alone does not establish formula."]
        elif "rule 1" in title:
            gaps = ["Selected generic Chocolate does not distinguish factory Chocolate Fudge/Milk Chocolate or package revision; exact original panel required."]
        elif "musclenation" in title or "muscle nation" in title:
            gaps = ["Exact selected Milk Chocolate300g product family remains unresolved; manufacturer Daily Shake includes whey and milk proteins, so do not assume pure whey or transfer a casein formula.", "Official linked Milk Chocolate Flake product currently returns404; original failure is cached without repeating the request."]
        else:
            gaps = ["Exact Optimum product/flavour/batch and original factory package remain unmatched; seller repacks are not factory tub masses."]
        results.append({"productId": r["productId"], "sku": r["sku"], "listingKey": r["listingKey"],
                        "selectedOptions": r["selectedOptions"], "title": r["title"], "flavour": r["flavour"],
                        "capturedNetMassG": r["netMassG"], "capturedPackCount": r["packCount"],
                        "manufacturerCandidateProductIds": key, "sellerIdentityMatched": False,
                        "manufacturerReviewApplied": False, "blockingEvidenceGaps": gaps,
                        "originalSellerEvidenceIds": r["evidenceIds"]})
    return results


def main():
    snapshot_path = ROOT / "input-snapshot.json"
    if snapshot_path.exists():
        snapshot = read_json(snapshot_path)
    else:
        wpath = REPO / "docs/acceptance/whey-verification/worklist.json"
        raw = wpath.read_bytes()
        w = json.loads(raw)
        snapshot = {"worklistPath": str(wpath.relative_to(REPO)), "worklistSha256": digest(raw),
                    "catalogInput": w["input"], "catalogCheckedAt": w["catalogCheckedAt"], "capturedSkus": w["capturedSkus"]}
        snapshot_path.write_text(json.dumps(snapshot, ensure_ascii=False, indent=2) + "\n")
    rows = mappings(snapshot)
    sources = []
    for p in sorted(ROOT.glob("*.source.json")):
        r = read_json(p)
        body = (ROOT / r["artifact"]).read_bytes()
        original = gzip.decompress(body) if r["artifact"].endswith(".gz") else body
        assert digest(original) == r["sha256"], p
        assert len(original) == r["bytes"], p
        r.update(receipt=p.name, digestMatched=True, storageSha256=digest(body))
        sources.append(r)
    products = build_products()
    known = {p["id"] for p in products}
    assert len(rows) == 26, "Snapshot must retain all26 original strict-whey factory gaps"
    assert len({r["sku"] for r in rows}) == len(rows)
    assert all(set(r["manufacturerCandidateProductIds"]) <= known for r in rows)
    handpicked = [
        {"sku": "13451810835_VNAMZ-117268785502", "label": "Levels80-serving Vanilla", "strictFlavourEligible": False, "manufacturerCandidateProductIds": [], "blockingEvidenceGaps": ["Seller front prints2560g andVanilla80servings. Current official chocolate/plain5lb tubs print2270g/71servings; no cross-flavour/version transfer."]},
        {"sku": "3201573592_VNAMZ-15280912681", "label": "IT'S JUST plain5lb", "strictFlavourEligible": True, "manufacturerCandidateProductIds": ["its-just-unflavored-5lb"], "existingExactReview": "docs/acceptance/manufacturer-reviews/its-just-15280912681.json", "newReviewApplied": False},
        {"sku": "3095127497_VNAMZ-14849213302", "label": "HydropureExtremeChocolate", "manufacturerCandidateProductIds": ["nutrabolics-extreme-chocolate-2050g"], "sellerIdentityMatched": False},
        {"sku": "3095127497_VNAMZ-14849213308", "label": "Hydropurehandpicked sibling", "manufacturerCandidateProductIds": [], "blockingEvidenceGaps": ["Previously resolved URL rendered selectedChocolatePeanutButter; do not forceExtremeChocolate facts into another selectedSKU."]},
        {"sku": "13392889869_VNAMZ-117024762283", "label": "Rule1plain2×1kg seller repack", "manufacturerCandidateProductIds": ["rule1-naturally-flavored-unflavored"], "sellerIdentityMatched": False},
        {"sku": "3265021607_VNAMZ-15762183506", "label": "ON900g seller repack", "manufacturerCandidateProductIds": [], "blockingEvidenceGaps": ["Seller's900g zip repack does not match a907g factory tub or original10lb parent bag. Exact factory batch/formula remains unverified."]},
    ]
    output = {"schemaVersion": 1, "reviewedAt": datetime.now(timezone.utc).isoformat(),
              "scope": "Public manufacturer evidence only. Source facts are factory candidates; existing matched reviews remain authoritative. No private store/browser/Lazada request/shared source change.",
              "input": {k: v for k, v in snapshot.items() if k != "capturedSkus"},
              "sources": sources, "factoryProducts": products, "gapSkuMappings": rows,
              "handpicked": handpicked,
              "invariants": {"newManufacturerReviewsApplied": 0, "sharedStoreWrites": 0,
                             "browserRequests": 0, "lazadaRequests": 0, "densityConversions": 0,
                             "minimumSameHostIntervalSeconds": 61,
                             "omittedNutrientsBecomeZero": False, "unknownBrandSubstitution": False,
                             "differentFlavourFormulaTransfer": False},
              "researchQueries": ["Levels official whey product and exact per-variant labels", "Rule One Naturally Flavored Unflavored official product", "BioX Natural Whey Isolate official Chocolate section", "Clean Simple Eats Chocolate Brownie Batter official30-serving label", "Scitec official homepage linked1816g isolate", "Muscle Nation Milk Chocolate Daily Shake official introduction", "VBest Nutrition official manufacturer search; similarly namedVitobest rejected"],
              "counts": {"originalSourcesDigestVerified": len(sources), "reusedOriginalSources": sum(bool(r.get("cacheHit")) for r in sources),
                         "newManufacturerResponses": sum(not r.get("cacheHit", False) for r in sources),
                         "cachedHttpFailures": sum(r.get("status", 200) >= 400 for r in sources),
                         "factoryProductCandidates": len(products), "originalGapSkusCovered": len(rows),
                         "handpickedMappings": len(handpicked)}}
    (ROOT / "review.json").write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    (ROOT / "validation.json").write_text(json.dumps({"checkedAt": output["reviewedAt"], "counts": output["counts"], "allOriginalBodyDigestsMatch": True, "allGapSkuIdentitiesUnique": True, "allCandidateReferencesResolve": True, "reviewsApplied": 0}, indent=2) + "\n")
    print(json.dumps(output["counts"]))


if __name__ == "__main__":
    main()
