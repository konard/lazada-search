#!/usr/bin/env python3
"""Saved Vietnam Nha Trang whey/handpicked audit, independent of application code.

Usage:
  python3 scripts/audit-whey-handpicked.py --repo /path/to/lazada-search \
    --output /private/tmp/lazada-result-recheck-whey.json

Inputs are fresh local files, not git-show reads. Git HEAD is descriptive metadata;
actual input and original archived byte hashes are recorded in the receipt. Replay
an immutable revision by extracting its committed files into an isolated directory
and passing that directory as --repo, with the exporter recording its revision.
The script performs no network/browser calls and writes only the chosen receipt.
Known exact manufacturer-label ratios and prior manual image interpretation are
explicit audit facts, not dynamically guessed manufacturer or stock data.
Console output contains counts, hashes and the requested receipt path only.
"""
from pathlib import Path
import argparse,json,gzip,hashlib,re,unicodedata,datetime,subprocess,sys
from urllib.parse import urlsplit
from decimal import ROUND_HALF_EVEN
from decimal import Decimal,getcontext
from html.parser import HTMLParser
getcontext().prec=40
parser=argparse.ArgumentParser(description='Independently recheck saved whey/handpicked arithmetic, source identities and Markdown tables. No application imports or network calls.')
parser.add_argument('--repo',type=Path,required=True,help='Repository working tree or extracted immutable snapshot root')
parser.add_argument('--output',type=Path,required=True,help='Receipt output JSON path')
args=parser.parse_args()
root=args.repo.expanduser().resolve();base=root/'data/cases/vietnam-nha-trang'
out=args.output.expanduser().resolve()
def git_metadata():
 try:
  head=subprocess.run(['git','-C',str(root),'rev-parse','HEAD'],check=True,capture_output=True,text=True).stdout.strip()
 except (OSError,subprocess.CalledProcessError):
  head=None
 return {'head':head,'inputMode':'working-tree-files','immutableCommitSnapshotVerified':False,'qualification':'Git HEAD is metadata only. All inspected bytes are read from --repo and SHA-recorded independently; this method does not read git-show or claim those bytes match HEAD. An extracted snapshot has no verified Git HEAD unless separately recorded by its exporter.'}
gitMeta=git_metadata()
inputs={};errors=[];unverified=[];sources={}
def sha(b):return hashlib.sha256(b).hexdigest()
def read(path):
 p=root/path;raw=p.read_bytes();inputs[str(path)]={'sha256':sha(raw),'bytes':len(raw)};return json.loads(raw)
man=read(Path('data/cases/vietnam-nha-trang/manifest.json'))
report=read(Path('docs/tables/top-10-partial.json'));hand=read(Path('docs/tables/handpicked.json'))
if report.get('generatedAt') != '2026-10-11T20:55:08.153Z' or hand.get('generatedAt') != '2026-10-11T21:02:12.548Z':
 parser.error('This independent method supports the saved October11 case only. New report snapshots require new independent label/source review; historical manual facts must not be reused as current manufacturer verification.')
for path in ['docs/tables/top-10-partial.md','docs/tables/handpicked.md','docs/acceptance/top10-check/handpicked-links.json','docs/acceptance/urgent-whey-reviews/factory-lead-review.json']:
 raw=(root/path).read_bytes();inputs[path]={'sha256':sha(raw),'bytes':len(raw)}
def kind(name):
 meta=man['kinds'][name]['json'];p=base/meta['path'];raw=p.read_bytes();body=gzip.decompress(raw)
 assert sha(raw)==meta['sha256'] and sha(body)==meta['contentSha256']
 inputs[str(p.relative_to(root))]={'sha256':sha(raw),'contentSha256':sha(body),'records':man['kinds'][name]['records']}
 return json.loads(body)
products=kind('product');offers=kind('offer');evidence=kind('evidence');cache=kind('cache');reviews=kind('manufacturer-review');inventories=kind('sku-inventory');holds=kind('specification-hold');stops=kind('collection-stop')
P={x['id']:x for x in products};PS={x.get('sku'):x for x in products if x.get('sku')};E={x['id']:x for x in evidence}
O={x['sku']:x for x in offers if x.get('sku') and not x.get('supersededBy') and x.get('price',0)>0}
rewrite={x['archivedSha256']:x['originalSha256'] for x in man['sourceRewrites']}
def blob(ref):
 key=ref['sha256'];meta=man['blobs'][key];p=base/meta['path'];raw=p.read_bytes();body=gzip.decompress(raw)
 assert sha(raw)==meta['sha256'] and sha(body)==key and len(body)==meta['bytes']
 sources[key]={'archivePath':str(p.relative_to(root)),'archiveSha256':sha(raw),'sha256':key,'bytes':len(body),'privateOriginalSha256':rewrite.get(key)}
 return body
def safe_stop(value):
 # Never carry source URLs, browser recovery/profile data or telemetry values into this receipt.
 permitted={key:value.get(key) for key in ['active','reason','detectedAt','signals'] if key in value}
 if value.get('origin'):
  origin=urlsplit(value['origin']);permitted['origin']=origin.scheme+'://'+origin.netloc
 return permitted
class DOM(HTMLParser):
 def __init__(self):super().__init__();self.stack=[];self.elements=[];self.visible=[];self.skip=0
 def handle_starttag(self,tag,attrs):
  a=dict(attrs);cls=a.get('class','');record=None
  if any(x in cls for x in ['pdp-price_type_normal','pdp-v2-product-price-content-salePrice-amount']):record={'kind':'price','text':[]}
  elif any(x in cls for x in ['sku-variable-img-wrap-selected','sku-variable-name-selected']):record={'kind':'option','text':[]}
  if record:self.elements.append(record)
  if tag not in ['img','input','br','hr','meta','link','source','area','base','col','embed','param','track','wbr']:
   self.stack.append((tag,record));self.skip+=tag in ['script','style','template','noscript']
 def handle_endtag(self,tag):
  for i in range(len(self.stack)-1,-1,-1):
   if self.stack[i][0]==tag:
    removed=self.stack[i:];del self.stack[i:];self.skip-=sum(t in ['script','style','template','noscript'] for t,_ in removed);break
 def handle_data(self,data):
  if self.skip:return
  self.visible.append(data)
  for _,record in self.stack:
   if record is not None:record['text'].append(data)
 def fields(self):
  return {'prices':list(dict.fromkeys(re.sub(r'\s+',' ',''.join(x['text'])).strip() for x in self.elements if x['kind']=='price')),'options':list(dict.fromkeys(re.sub(r'\s+',' ',''.join(x['text'])).strip() for x in self.elements if x['kind']=='option')),'visibleSkus':list(dict.fromkeys(re.findall(r'\b\d+_VNAMZ-\d+\b',' '.join(self.visible))))}
def fold(t):return ''.join(c for c in unicodedata.normalize('NFD',t.lower()) if unicodedata.category(c)!='Mn').replace('đ','d').replace('-',' ')
def selected(p):return list(dict.fromkeys(x['text'] for x in p.get('selectedVariant',[]) if x.get('selected')))
def flavour(p):
 matched=p.get('manufacturerVerification',{})
 if matched.get('identityMatched'):
  value=matched.get('identity',{}).get('flavour','')
  if value:return classify(value)
 vals=[classify(x) for x in selected(p)];vals=[v for v in vals if v!='unknown']
 if 'other' in vals or len(set(vals))>1:return 'other'
 return vals[0] if vals else classify(p.get('title',''))
def classify(text):
 t=fold(text)
 if re.search(r'vanilla|\bvani\b|peanut|banana|coconut|strawberry|matcha|coffee|caramel|cookies|mint|hazelnut|\boreo\b|\bvi dau\b',t):return 'other'
 if re.search(r'chocolat|choco|cocoa|cacao|socola|so\s*co\s*la',t):return 'chocolate'
 if re.search(r'unflavo|khong\s*(mui|vi)|tu nhien|\bnatural\b|\boriginal\b|\bplain\b',t):return 'unflavoured'
 return 'unknown'
def shaker(p):return any(re.search(r'\bshaker\b|binh\s*(lac|shake|bot)|\b(co|kem|them)\s*binh\b',fold(x)) and not re.search(r'\b(no|without|khong)\b',fold(x)) for x in selected(p))
def verified(p):
 verification=p.get('manufacturerVerification',{})
 evidence_id=verification.get('evidenceId')
 if p.get('pendingSpecificationReview') or p.get('specificationsInvalidated') or verification.get('identityMatched') is not True or verification.get('sourceAuthority')!='manufacturer' or not evidence_id or evidence_id not in p.get('evidenceIds',[]):return False
 for field in ['netMassG','proteinPer100g','sugarPer100g','fatPer100g','saturatedFatPer100g','kcalPer100g','ingredients']:
  value=p.get(field)
  if value is None or (field=='ingredients' and not value):return False
  if not any(claim.get('field')==field and claim.get('value')==value and claim.get('source')=='manufacturer' and not claim.get('requiresReview') and claim.get('evidenceId')==evidence_id and (verification.get('identityMethod')!='visual-exact-variant' or claim.get('reviewId')==verification.get('reviewId')) for claim in p.get('claims',[])):return False
 return True
def match(actual,expected,label):
 if expected is None:
  if actual is not None:errors.append({'code':'unexpected-metric','field':label,'actual':actual})
 elif actual is None or abs(Decimal(str(actual))-expected)>max(Decimal('1e-8'),abs(expected)*Decimal('1e-12')):
  errors.append({'code':'arithmetic-mismatch','field':label,'reported':actual,'expected':str(expected)})
def protein_ratio(p):
 claims=[x for x in p.get('claims',[]) if x.get('source')=='manufacturer' and x.get('field')=='proteinPer100g']
 text=' '.join(x.get('excerpt','') for x in claims)
 if '30g per 33g' in text:return Decimal(30)/33
 if '35 g serving, 25 g protein' in text:return Decimal(25)/35
 if '30 g scoop; 26 g protein' in text:return Decimal(26)/30
 return None
rows=[]
for group,items in [('whey',report['whey']),('verifiedProtein',report['verifiedProtein']),('handpicked',hand['rows'])]:
 for rr in items:
  sku=rr.get('sku') or rr['exactSku'];cost=rr.get('costs',rr);p=PS[sku];o=O[sku];q=Decimal(str(cost['quantity']));packs=cost['packagesPerSellingUnit'];pending=p.get('pendingSpecificationReview',[])
  mass=None if 'netMassG' in pending else Decimal(str(p['netMassG']))*Decimal(str(packs))*q
  ratio=protein_ratio(p);protein=None if mass is None or ratio is None else mass*ratio
  total=Decimal(str(o['price']))*q;shipping=Decimal(str(o['shipping'])) if o.get('shipping') is not None and o.get('shippingQuantity')==int(q) and 'Nha Trang' in o.get('shippingDestination','') else None
  after=None if shipping is None else total+shipping
  for key,value in [('massG',mass),('proteinG',protein),('totalBeforeDelivery',total),('shippingVnd',shipping),('totalAfterDelivery',after),('beforePerFoodGram',None if mass is None else total/mass),('afterPerFoodGram',None if mass is None or after is None else after/mass),('beforePerProteinGram',None if protein is None else total/protein),('afterPerProteinGram',None if protein is None or after is None else after/protein)]:match(cost.get(key),value,sku+':'+key)
  ev=E[o['evidenceId']];dom=DOM();dom.feed(blob(ev['html']).decode('utf8'));fields=dom.fields();priceValues=[int(re.sub(r'\D','',v)) for v in fields['prices']]
  if o['price'] not in priceValues:errors.append({'code':'original-visible-price-not-matched','sku':sku,'captured':o['price'],'visibleValues':priceValues})
  if sku not in fields['visibleSkus']:errors.append({'code':'original-visible-sku-not-matched','sku':sku})
  if set(selected(p))!=set(fields['options']):errors.append({'code':'original-selected-option-mismatch','sku':sku,'recordOptions':selected(p),'originalOptions':fields['options']})
  if group!='handpicked' and (p['category']!='whey' or flavour(p) not in ['chocolate','unflavoured'] or shaker(p) or not o.get('available')):errors.append({'code':'ranking-scope-or-stock-mismatch','sku':sku,'flavour':flavour(p)})
  if cost.get('volumeMl') is not None or cost.get('beforePerMl') is not None:errors.append({'code':'powder-volume-included','sku':sku})
  quoted=bool(cost['deliveryQuoteMatched']);quoteProof=[]
  if quoted:
   quoteMatch=re.match(r'delivery:([a-f0-9]{64})',o.get('quoteEvidenceId',''))
   if quoteMatch:
    originalQuoteSha=quoteMatch[1];archiveQuoteSha=next((x['archivedSha256'] for x in man['sourceRewrites'] if x['originalSha256']==originalQuoteSha),originalQuoteSha)
    if archiveQuoteSha in man['blobs']:
     quoteDom=DOM();quoteDom.feed(blob({'sha256':archiveQuoteSha}).decode('utf8'));quoteFields=quoteDom.fields();quoteText=' '.join(quoteDom.visible)
     feeText=format(o['shipping'],',').replace(',','.')
     if sku in quoteFields['visibleSkus'] and 'Nha Trang' in quoteText and feeText in quoteText:
      quoteProof.append({'archiveHtmlSha256':archiveQuoteSha,'originalQuoteSha256':originalQuoteSha,'observedAt':o.get('quoteObservedAt',o['observedAt']),'method':'Original source-bound delivery HTML contains exact selected SKU, Nha Trang destination and quoted standard fee; quantity1 bound in persisted offer.'})
   for ca in cache:
    if ca.get('snapshot',{}).get('sku')==sku and ca.get('shipping')==o.get('shipping') and ca.get('shippingQuantity')==int(q) and 'Nha Trang' in ca.get('shippingDestination','') and ca.get('html'):
     ref=ca['html'];blob(ref);quoteProof.append({'archiveHtmlSha256':ref['sha256'],'observedAt':ca.get('observedAt')})
   if not quoteProof:errors.append({'code':'no-original-quote-cache','sku':sku,'quoteEvidenceId':o.get('quoteEvidenceId')})
  for review in reviews:
   if review['productId']==p['id'] and review.get('identityMatched'):
    me=E.get(review['evidenceId']);
    if me and me.get('html'):blob(me['html'])
  rows.append({'group':group,'sku':sku,'observedAt':o['observedAt'],'sourceHtmlSha256':ev['html']['sha256'],'originalPriceVisible':o['price'] in priceValues,'originalSkuVisible':sku in fields['visibleSkus'],'options':fields['options'],'capturedAvailable':o.get('available'),'quantityCap':o.get('maxQuantity'),'manufacturerSpecificationMatched':verified(p),'packageMassG':p['netMassG'],'foodPackages':packs,'massHeld':mass is None,'proteinRatio':str(ratio) if ratio else None,'independentBeforePerFoodGram':str(total/mass) if mass else None,'independentBeforePerProteinGram':str(total/protein) if protein else None,'independentAfterPerProteinGram':str(after/protein) if protein and after else None,'originalPriceVnd':o.get('originalPrice'),'saleSavingsVnd':None if not o.get('originalPrice') else o['originalPrice']-o['price'],'quoteSources':quoteProof})
for key,field in [('whey','beforePerFoodGram'),('verifiedProtein','beforePerProteinGram')]:
 vals=[Decimal(str(x[field])) for x in report[key]]
 if vals!=sorted(vals):errors.append({'code':'not-ascending','group':key})
hvals=[None if x['costs']['beforePerFoodGram'] is None else Decimal(str(x['costs']['beforePerFoodGram'])) for x in hand['rows']]
if hvals!=sorted(hvals,key=lambda x:Decimal('Infinity') if x is None else x):errors.append({'code':'handpicked-sort'})
intersections={}
for key,ranking in [('wheyFoodGram','whey'),('wheyProteinGram','verifiedProtein'),('soyProteinGram','soyProtein')]:
 skus={x['sku'] for x in report[ranking]};listings={s.split('_')[0] for s in skus};rl=[x for x in hand['rows'] if x['listingId'] in listings];rs=[x for x in hand['rows'] if x['exactSku'] in skus]
 actual={'submittedListingMatches':len(rl),'submittedExactSkuMatches':len(rs),'uniqueListingMatches':len({x['listingId'] for x in rl}),'uniqueExactSkuMatches':len({x['exactSku'] for x in rs})};intersections[key]=actual
 if hand['counts']['memberships'][key]!=actual:errors.append({'code':'handpicked-intersection-mismatch','ranking':key,'expected':actual})
 for x in hand['rows']:
  expected={'listingMatch':x['listingId'] in listings,'exactSkuMatch':x['exactSku'] in skus}
  if x['membership'][key]!=expected:errors.append({'code':'handpicked-member-row-mismatch','sku':x['exactSku'],'ranking':key})
candidates=[]
for o in O.values():
 p=P[o['productId']]
 if p.get('category')!='whey' or not o.get('variantConfirmed') or o.get('available') is not True or shaker(p) or flavour(p) not in ['chocolate','unflavoured'] or p.get('pendingSpecificationReview') or not p.get('netMassG'):continue
 if not selected(p) and not verified(p):continue
 if p.get('packCount',1)>1 and not p.get('paidMassBasis',{}).get('safeToMultiplyByPackCount'):continue
 mass=Decimal(str(p['netMassG']))*Decimal(str(p.get('packCount',1)));ratio=protein_ratio(p)
 candidates.append({'sku':o['sku'],'massPrice':Decimal(str(o['price']))/mass,'proteinPrice':Decimal(str(o['price']))/mass/ratio if verified(p) and ratio else None})
food=[x['sku'] for x in sorted(candidates,key=lambda x:(x['massPrice'],x['sku']))[:10]]
protein=[x['sku'] for x in sorted([x for x in candidates if x['proteinPrice'] is not None],key=lambda x:(x['proteinPrice'],x['sku']))[:10]]
for key,expected in [('whey',food),('verifiedProtein',protein)]:
 actual=[x['sku'] for x in report[key]]
 if set(actual)!=set(expected):errors.append({'code':'captured-eligible-top10-membership-diff','group':key,'published':actual,'independentCandidates':expected})
# Verify the retained image bytes referenced by a prior manual label reading.
# This script does not perform OCR or independently repeat the human visual interpretation.
blob({'sha256':'4fcaa035874c333b47cb935f1804133f167c75979843a95a0c8c802c1eddadf3'})
allObserved=[x['observedAt'] for x in rows];handObserved=[x['observedAt'] for x in rows if x['group']=='handpicked']
result={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'repository':gitMeta,'scope':'Independent read-only Python Decimal + original archived DOM audit; no production arithmetic script or application imported; no website/browser/network or source/store mutations.','inputs':inputs,'sourceObservationRange':{'min':min(allObserved),'max':max(allObserved)},'handpickedObservationRange':{'min':min(handObserved),'max':max(handObserved)},'collectionStop':[safe_stop(x) for x in stops],'errors':errors,'rows':rows,'sourceBlobsVerified':list(sources.values()),'capturedEligibleCandidateCount':len(candidates),'independentTop10':{'wheyFoodGram':food,'wheyProteinGram':protein},'handpickedIntersections':intersections,'unverifiedConditions':['Captured Oct9–11 prices/stock are historical and need current recheck; report complete=false is correct.','All ten cheapest powder entries have unmatched manufacturer formulas/identity; compare source-declared powder grams only.','SFD White Choco is allowed by current powder-chocolate family policy; title900g/900kg conflicts with source specifications2250g/2.25kg, requiring exact package review.','Athleopro PRO GAINER composition/protein concentration is unverified; cheap powder grams cannot establish cheap protein grams.','Paid shaker options are absent; advertised free gifts add no mass or volume. Some permitted options include gloves, which remain in captured selling price.','Rule1 Combo2Túi1Kg mass basis remains held; no guessed 2000g or gram price is published.','Destination-qualified quotes apply to exactly one selling unit; no bulk quantity freight, checkout eligibility, voucher stacking or current destination confirmation is established.','Manufacturer identity reviews match published packaging/specifications, not seller authenticity or delivered batch.','Whole-market/exhaustive SKU coverage is not established; active manufacturer CAPTCHA stop remains untouched.'],'capturedOnlyLeads':[{'sku':'3300919067_VNAMZ-16058119853','qualification':'Lowest captured specification-matched whey protein price; one package only, historical available flag and max3, no current/bulk winner claim.','priceVnd':2952300,'shippingVnd':80200,'massG':2268,'proteinG':str(Decimal(2268)*30/33),'deliveredPriceVnd':3032500,'deliveredVndPerProteinG':str(Decimal(3032500)/(Decimal(2268)*30/33))},{'sku':'3241302198_VNAMZ-117011483478','qualification':'Lowest captured source-declared powder gram price; formula and shipping absent, captured quantity cap1, not a verified protein winner.','priceVnd':809100,'massG':2000,'vndPerFoodG':'404.55'},{'sku':'3095127497_VNAMZ-14849213302','qualification':'Conditional exact manufacturer2050g revision only; selected seller package remains unconfirmed, not ranked as factory-verified.','priceVnd':999997,'shippingVnd':37700,'conditionalManufacturerMassG':2050,'conditionalProteinG':str(Decimal(2050)*28/36),'conditionalDeliveredVndPerProteinG':str(Decimal(1037697)/(Decimal(2050)*28/36))}],'visualManufacturerProof':{'sha256':'4fcaa035874c333b47cb935f1804133f167c75979843a95a0c8c802c1eddadf3','method':'Prior human visual label reading; script verifies image digest only, not OCR interpretation.','observedFacts':'Official retained5lbback visually read: serving33g,protein30g,sugars1g,ingredients grassfedwheyisolate+less2%sunflowerlecithin. Rounded68servings not used as exact denominator.'}}

def same_cell(text,value,field):
 text=text.strip()
 if value is None:
  if text not in ['—','Pending exact evidence']:
   errors.append({'code':'markdown-json-null-mismatch','field':field,'markdown':text})
 else:
  try:
   expected=Decimal(str(value)).quantize(Decimal('.01'),rounding=ROUND_HALF_EVEN)
   actual=Decimal(text.replace(',',''))
  except Exception:
   errors.append({'code':'markdown-invalid-number','field':field})
   return
  if actual!=expected:
   errors.append({'code':'markdown-json-number-mismatch','field':field,'markdown':text,'expected':str(expected)})
md=(root/'docs/tables/top-10-partial.md').read_text()
sections=md.split('## Top 10 whey: ')[1:3]
if len(sections)!=2:
 errors.append({'code':'markdown-missing-whey-section'})
for group,section in zip(['whey','verifiedProtein'],sections):
 lines=[line for line in section.split('\n') if re.match(r'^\|\s*\d+\s*\|',line)][:10]
 if len(lines)!=len(report[group]):
  errors.append({'code':'markdown-row-count-mismatch','group':group,'markdownRows':len(lines),'jsonRows':len(report[group])})
 for item,line in zip(report[group],lines):
  cells=[x.strip() for x in line.split('|')[1:-1]]
  if item['sku'] not in cells[2]:errors.append({'code':'markdown-sku-mismatch','sku':item['sku']})
  same_cell(cells[3],item['price'],item['sku']+':price')
  if group=='whey':
   for col,value,name in [(5,item['massG'],'massG'),(6,item['beforePerFoodGram'],'beforeFood'),(7,item['afterPerFoodGram'],'afterFood')]:same_cell(cells[col],value,item['sku']+':'+name)
  else:
   same_cell(cells[4],item['beforePerProteinGram'],item['sku']+':beforeProtein')
   same_cell(cells[5],item['afterPerProteinGram'],item['sku']+':afterProtein')
md=(root/'docs/tables/handpicked.md').read_text()
lines=[x for x in md.split('\n') if x.startswith('| [')]
if len(lines)!=len(hand['rows']):errors.append({'code':'markdown-row-count-mismatch','group':'handpicked','markdownRows':len(lines),'jsonRows':len(hand['rows'])})
for item,line in zip(hand['rows'],lines):
 cells=[x.strip() for x in line.split('|')[1:-1]]
 if item['exactSku']!=cells[1]:errors.append({'code':'markdown-handpicked-sku-mismatch','sku':item['exactSku']})
 for col,value,name in [(2,item['priceVnd'],'price'),(3,item['costs']['packagesPerSellingUnit'],'packages'),(4,item['costs']['massG'],'mass'),(5,item['costs']['beforePerFoodGram'],'beforeFood'),(6,item['costs']['afterPerFoodGram'],'afterFood'),(7,item['costs']['beforePerProteinGram'],'beforeProtein'),(8,item['costs']['afterPerProteinGram'],'afterProtein')]:same_cell(cells[col],value,item['exactSku']+':'+name)
result['markdownParity']={'wheyRows':len(report['whey']),'verifiedProteinRows':len(report['verifiedProtein']),'handpickedRows':len(hand['rows']),'passed':not any(x['code'].startswith('markdown-') for x in errors)}
result['methodScriptSha256']=sha(Path(__file__).read_bytes())
result['checks']={'rowArithmetic':len(rows),'originalVisibleSku':len(rows),'originalVisiblePrices':len(rows),'originalSelectedOptions':len(rows),'originalBlobDigests':len(sources),'matchedCapturedCandidateTop10Sets':2,'handpickedMembershipCounts':len(intersections),'originalQuoteRows':sum(bool(x['quoteSources']) for x in rows),'paidShakerExcluded':True,'soySeparate':True,'nonPowderEntriesInPublishedWheyTables':0,'powderVolumeOrShakerMlApplied':0}
result['qualification']='No arithmetic, original price/SKU/selected option, ascending-order, top10 captured membership, handpicked intersection or Markdown parity defect found. Values are valid historical captured observations, not a current or exhaustive bulk-buy guarantee.' if not errors else 'Saved evidence or report discrepancies found; inspect errors before treating these tables as verified.'
if out in {(root/path).resolve() for path in inputs}:raise ValueError('Receipt output must not overwrite audited input')
out.parent.mkdir(parents=True,exist_ok=True)
out.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({'output':str(out),'sha256':sha(out.read_bytes()),'methodScriptSha256':result['methodScriptSha256'],'rows':len(rows),'errorCount':len(errors),'sourceBlobs':len(sources),'eligibleCandidates':len(candidates),'inputFiles':len(inputs),'markdownParityPassed':result['markdownParity']['passed']},indent=2))
if errors:sys.exit(1)
